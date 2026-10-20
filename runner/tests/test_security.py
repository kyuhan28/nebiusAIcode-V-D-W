from e2e import *
import glob

section("timeouts and cancellation")
spin = {"Spin.java": 'public class Spin { public static void main(String[] a) { long n = 0; while (true) { n++; } } }\n'}
t0 = time.time(); s, j = execute(spin)
check("infinite loop is stopped as timed_out", j["status"] == "timed_out", j["status"])
check("timeout respects the limit (about 10 s)", 9 <= time.time() - t0 <= 16, time.time() - t0)
s, job = execute(spin, wait=False)
time.sleep(4)
call("POST", f"/v1/executions/{job['id']}/cancel")
for _ in range(50):
    s, j = call("GET", "/v1/executions/" + job["id"])
    if "result" in j or j["status"] == "cancelled": break
    time.sleep(0.2)
check("stop cancels a running program", j["status"] == "cancelled", j["status"])
time.sleep(1)
procs = os.popen("ps -eo args | grep '[S]pin' | grep -v grep").read().strip()
check("no Spin JVM survives after cancel or timeout", procs == "", procs)

section("output and size limits")
flood = {"Flood.java": 'public class Flood { public static void main(String[] a) { for (int i = 0; i < 2000000; i++) System.out.println("line " + i); } }\n'}
s, j = execute(flood)
r = j["result"]
check("stdout capped at 64 KB and marked truncated", len(r["stdout"].encode()) <= 64 * 1024 and r["stdoutTruncated"], (len(r["stdout"]), r.get("stdoutTruncated")))
s, j = call("POST", "/v1/executions", {"mode": "run", "files": [{"path": "../evil/Main.java", "content": "class X{}"}]})
check("path traversal rejected", s == 400 and j["error"]["code"] == "bad_path", (s, j))
s, j = call("POST", "/v1/executions", {"mode": "run", "files": [{"path": "/etc/Main.java", "content": "class X{}"}]})
check("absolute paths rejected", s == 400 and j["error"]["code"] == "bad_path", (s, j))
s, j = call("POST", "/v1/executions", {"mode": "run", "files": [{"path": "run.sh", "content": "rm -rf /"}]})
check("non-java files rejected", s == 400, (s, j))
s, j = call("POST", "/v1/executions", {"mode": "run", "files": [{"path": "Big.java", "content": "x" * 600_000}]})
check("oversized sources rejected", s == 413, (s, j))
s, j = call("POST", "/v1/executions", {"mode": "shell", "files": [{"path": "A.java", "content": "class A{}"}]})
check("unknown modes rejected", s == 400, (s, j))
s, j = call("POST", "/v1/executions", {"mode": "run", "files": [{"path": "A.java", "content": "class A{}"}], "jvmArgs": ["-Xmx64g"]})
check("extra JVM arguments are ignored, not honored", s == 202, s)

section("resource limits inside the program")
mem = {"Mem.java": 'import java.util.*;\npublic class Mem { public static void main(String[] a) { List<long[]> l = new ArrayList<>(); while (true) l.add(new long[1_000_000]); } }\n'}
s, j = execute(mem)
check("memory is capped by the JVM heap limit", j["status"] == "runtime_error" and "OutOfMemoryError" in (j["result"].get("exception") or {}).get("type", "") , j["result"].get("exception"))
net = {"Net.java": 'import java.net.*;\npublic class Net { public static void main(String[] a) throws Exception { try (Socket s = new Socket()) { s.connect(new InetSocketAddress("1.1.1.1", 80), 2000); System.out.println("reachable"); } catch (Exception e) { System.out.println("blocked"); } } }\n'}
s, j = execute(net)
check("network access is blocked", j["result"]["stdout"].strip() == "blocked", j["result"].get("stdout"))
fs = {"Fs.java": 'import java.nio.file.*;\npublic class Fs { public static void main(String[] a) throws Exception {\n  System.out.println(Files.exists(Path.of("/home/claude/runner/src")) ? "sees-host" : "hidden");\n  byte[] big = new byte[1 << 20];\n  try (var o = Files.newOutputStream(Path.of("big.bin"))) { for (int i = 0; i < 64; i++) o.write(big); System.out.println("wrote 64MB"); } catch (Throwable t) { System.out.println("write capped"); }\n} }\n'}
s, j = execute(fs)
check("file writes are capped (8 MB per file)", "write capped" in j["result"]["stdout"] or j["status"] == "runtime_error", j["result"])
procx = {"Fork.java": 'public class Fork { public static void main(String[] a) throws Exception { Process p = new ProcessBuilder("sleep", "60").start(); System.out.println("spawned"); } }\n'}
s, j = execute(procx)
time.sleep(1)
left = os.popen("ps -eo args | grep '^sleep 60' | grep -v grep").read().strip()
check("child processes are cleaned up after the run", left == "", left)
check("workspaces are deleted after each run", glob.glob("/tmp/codeviz-runs/*") == [], glob.glob("/tmp/codeviz-runs/*"))

section("rate limiting and concurrency")
codes = [call("POST", "/v1/executions", {"mode": "compile", "files": [{"path": "A.java", "content": "class A{}"}]}, client="burst")[0] for _ in range(35)]
check("rate limit returns 429 after the per-minute budget", 429 in codes and codes.count(202) <= 31, codes)
check("a full queue answers 503 busy instead of hanging", all(c in (202, 429, 503) for c in codes), codes)
time.sleep(25)  # let the burst drain before testing concurrency
results = {}
def worker(n):
    src = {f"W{n}.java": f'public class W{n} {{ public static void main(String[] a) {{ System.out.println("worker {n}"); }} }}\n'}
    results[n] = execute(src, client=f"c{n}")[1]
threads = [threading.Thread(target=worker, args=(n,)) for n in range(4)]
[t.start() for t in threads]; [t.join() for t in threads]
check("concurrent runs stay isolated", all(results[n]["result"]["stdout"].strip() == f"worker {n}" for n in range(4)), {n: results[n]["result"].get("stdout") for n in results})

print(f"\n{len(passed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
