"""Docker-mode plumbing, verified with a stand-in docker CLI (tests/fake-docker). Not an isolation test."""
from e2e import *
import glob, pathlib
LOG = "/tmp/fakedocker/log.jsonl"
def runs(): return [json.loads(l) for l in open(LOG) if json.loads(l)[0] == "run"]
def rms(): return [json.loads(l) for l in open(LOG) if json.loads(l)[0] == "rm"]

s, rt = call("GET", "/v1/runtime")
check("runtime reports docker isolation, image, and daemon version", rt["sandbox"]["level"] == "docker" and rt["docker"]["ready"] and rt["docker"]["image"] == "codeviz-java-sandbox:21" and rt["docker"]["serverVersion"] == "27.3.1-fake", rt.get("docker"))
check("runtime reports the sandbox image's Java version, not the runner's", rt["docker"]["javaVersion"] and rt["javaVersion"] == rt["docker"]["javaVersion"], (rt.get("javaVersion"), rt["docker"].get("javaVersion")))
s, j = execute({"Hello.java": 'public class Hello { public static void main(String[] a) { System.out.println("in a container"); } }\n'})
check("run mode works through docker run", j["status"] == "completed" and j["result"]["stdout"].strip() == "in a container" and j["result"]["sandbox"] == "docker", j["result"])
modes = [json.loads(l)[1] for l in open(LOG) if json.loads(l)[0] == "modes"][-1]
check("sources reach the sandbox world-readable regardless of the host's umask", all(int(m, 8) & 0o004 for m in modes.values()) and int(modes["src"], 8) & 0o001, modes)
r = runs()[-1]
flags = " ".join(r)
for f in ["--network none", "--read-only", "--cap-drop ALL", "--security-opt no-new-privileges", "--user 10001:10001", "--pids-limit 128", "--memory 512m", "--memory-swap 512m", "--cpus 1", "--label codeviz.runner=1", "--rm"]:
    check(f"every user-code container gets {f}", f in flags, flags[:300])
check("only the job directory is mounted, at /work", sum(1 for a in r if a == "-v") == 1 and r[r.index("-v") + 1].endswith(":/work:rw"), r)
check("paths inside the container are /work paths, never host paths", all("/tmp/codeviz-runs" not in a for a in r[r.index("codeviz-java-sandbox:21") + 1:]), r)
check("compile and run are separate containers", len([x for x in runs() if "CompileMain" in " ".join(x)]) >= 1 and len(runs()) >= 2)
s, j = execute({"Bad.java": "public class Bad { int x = ; }\n"})
check("compiler diagnostics come back from the container", j["status"] == "compile_failed" and j["result"]["diagnostics"][0]["file"] == "Bad.java" and j["result"]["diagnostics"][0]["line"] == 1, j["result"].get("diagnostics"))
s, j = execute({"Echo.java": 'public class Echo { public static void main(String[] a) { System.out.println(new java.util.Scanner(System.in).nextInt() * 2); } }\n'}, stdin="21\n")
check("stdin reaches the container (docker run -i)", j["result"]["stdout"].strip() == "42", j["result"])
s, j = execute({"Sort.java": open(pathlib.Path(__file__).resolve().parent.parent.parent / "web" / "public" / "examples" / "BubbleSortExample.java").read().replace("BubbleSortExample", "Sort")}, mode="trace")
check("trace mode runs the tracer and program together in one container", j["status"] == "completed" and j["result"]["trace"]["stepCount"] > 20, (j["status"], j["result"].get("error")))
body = {"mode": "test", "files": [{"path": "Main.java", "content": open("solutions/sum-of-array/Main.java").read()}], "tests": [{"id": "a", "stdin": "2\n3 4\n"}, {"id": "b", "stdin": "1\n-9\n"}]}
st, job = call("POST", "/v1/executions", body)
while "result" not in (j := call("GET", "/v1/executions/" + job["id"])[1]): time.sleep(0.15)
check("test mode runs one container per test case", [t["stdout"].strip() for t in j["result"]["tests"]] == ["7", "-9"], j["result"].get("tests"))
before = len(rms())
s, job = execute({"Spin.java": "public class Spin { public static void main(String[] a) { while (true) {} } }\n"}, wait=False)
time.sleep(3.5)
call("POST", f"/v1/executions/{job['id']}/cancel")
for _ in range(40):
    s, j = call("GET", "/v1/executions/" + job["id"])
    if j["status"] == "cancelled": break
    time.sleep(0.2)
removed = [x for x in rms()[before:]]
check("Stop removes the job's container with docker rm -f", j["status"] == "cancelled" and any(n.startswith("codeviz-" + job["id"][:8]) for x in removed for n in x[2:]), removed)
time.sleep(1)
check("no Spin process survives the stop", os.popen("ps -eo args | grep '[S]pin' | grep -v grep").read().strip() == "")
check("job directories are deleted afterwards", glob.glob("/tmp/codeviz-runs/*") == [], glob.glob("/tmp/codeviz-runs/*"))
print(f"\n{len(passed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
