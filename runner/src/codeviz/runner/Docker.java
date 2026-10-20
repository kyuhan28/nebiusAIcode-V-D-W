package codeviz.runner;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Runs each compile, run, trace, or test inside its own short-lived container from a trusted
 * image. The job's directory is the only mount; the container has no network, a read-only root
 * filesystem, a non-root user, no capabilities, and memory, CPU, process, and file limits.
 */
public final class Docker {
  static final String WORK = "/work";
  static final String CLASSES = "/opt/codeviz/classes";
  static final String LABEL = "codeviz.runner=1";

  final String bin;
  final String image;
  final boolean ready;
  final String serverVersion;
  final String problem;
  /** The Java version inside the sandbox image, which is what user programs actually run on. */
  final String javaVersion;

  private Docker(String bin, String image, boolean ready, String serverVersion, String problem, String javaVersion) {
    this.bin = bin;
    this.image = image;
    this.ready = ready;
    this.serverVersion = serverVersion;
    this.problem = problem;
    this.javaVersion = javaVersion;
  }

  static Docker probe(String image, Path workRoot) {
    String bin = which("docker");
    if (bin == null) return new Docker(null, image, false, null, "The docker command is not installed on the runner's host.", null);
    String[] version = run(List.of(bin, "version", "--format", "{{.Server.Version}}"));
    if (version == null) return new Docker(bin, image, false, null, "The Docker daemon is not reachable from the runner.", null);
    if (run(List.of(bin, "image", "inspect", "--format", "{{.Id}}", image)) == null)
      return new Docker(bin, image, false, version[0], "The sandbox image " + image + " is not built yet. See runner/README.md.", null);
    String java = null;
    String[] jv = run(List.of(bin, "run", "--rm", "--network", "none", image, "java", "-version"));
    if (jv != null) for (String line : jv) {
      int q = line.indexOf('"');
      if (line.contains("version") && q >= 0 && line.indexOf('"', q + 1) > q) { java = line.substring(q + 1, line.indexOf('"', q + 1)); break; }
    }
    String mount = mountCheck(bin, image, workRoot);
    if (mount != null) return new Docker(bin, image, false, version[0], mount, java);
    return new Docker(bin, image, true, version[0], null, java);
  }

  /**
   * Jobs reach their containers through a bind mount, so the daemon must see the runner's files.
   * That fails when the daemon runs on another machine or container. Checked once at startup,
   * with the same permissions and user that real jobs use, so a failure is explained up front.
   */
  private static String mountCheck(String bin, String image, Path workRoot) {
    Path dir = null;
    try {
      Files.createDirectories(workRoot);
      dir = Files.createTempDirectory(workRoot, "mount-check-");
      String token = "codeviz-" + java.util.UUID.randomUUID();
      Path file = dir.resolve("check.txt");
      Files.writeString(file, token);
      Files.setPosixFilePermissions(dir, PosixFilePermissions.fromString("rwxr-xr-x"));
      Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-r--r--"));
      String[] out = run(List.of(bin, "run", "--rm", "--network", "none", "--user", "10001:10001",
          "-v", dir + ":" + WORK + ":ro", image, "cat", WORK + "/check.txt"));
      if (out != null && String.join("\n", out).contains(token)) return null;
      return "Docker cannot see files in the runner's work directory (" + workRoot + "). This happens when the Docker daemon runs on a"
          + " different machine or container than the runner. Run the runner where the daemon is, for example with docker compose.";
    } catch (Exception e) {
      return "The runner could not check that Docker can see its work directory: " + e.getMessage();
    } finally {
      if (dir != null) {
        try (var walk = Files.walk(dir)) {
          walk.sorted(java.util.Comparator.reverseOrder()).forEach(p -> p.toFile().delete());
        } catch (Exception ignored) {}
      }
    }
  }

  private static String which(String name) {
    for (String dir : System.getenv().getOrDefault("PATH", "").split(":")) {
      Path p = Path.of(dir, name);
      if (Files.isExecutable(p)) return p.toString();
    }
    return null;
  }

  /** Runs a short docker command; returns its stdout lines, or null on failure. */
  static String[] run(List<String> cmd) {
    try {
      Process p = new ProcessBuilder(cmd).redirectErrorStream(true).start();
      String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
      if (!p.waitFor(20, TimeUnit.SECONDS) || p.exitValue() != 0) return null;
      return out.isEmpty() ? new String[] {""} : out.split("\n");
    } catch (Exception e) {
      return null;
    }
  }

  /** Removes containers left behind by a previous runner process. */
  void sweep() {
    if (!ready) return;
    String[] ids = run(List.of(bin, "ps", "-aq", "--filter", "label=" + LABEL));
    if (ids == null) return;
    List<String> cmd = new ArrayList<>(List.of(bin, "rm", "-f"));
    for (String id : ids) if (!id.isBlank()) cmd.add(id.trim());
    if (cmd.size() > 3) run(cmd);
  }

  void remove(Job job) {
    if (job.containers.isEmpty()) return;
    List<String> cmd = new ArrayList<>(List.of(bin, "rm", "-f"));
    cmd.addAll(job.containers);
    run(cmd);
  }

  /** The container sees the job directory at /work; everything it needs is mapped there. */
  static String map(Workspace ws, Path host) {
    return WORK + "/" + ws.root.relativize(host).toString().replace('\\', '/');
  }

  /**
   * Sets permissions explicitly instead of trusting the host's umask: the sandbox user can read
   * the sources and write compile output, temp files, and results, in this job's directory only.
   */
  static void prepare(Workspace ws) throws java.io.IOException {
    try (var walk = Files.walk(ws.src)) {
      for (Path p : walk.toList()) {
        Files.setPosixFilePermissions(p, PosixFilePermissions.fromString(Files.isDirectory(p) ? "rwxr-xr-x" : "rw-r--r--"));
      }
    }
    for (Path p : List.of(ws.root, ws.out, ws.tmp)) Files.setPosixFilePermissions(p, PosixFilePermissions.fromString("rwxrwxrwx"));
  }

  List<String> wrap(List<String> containerCommand, Workspace ws, Job job, String memory, int cpuSeconds) {
    String name = "codeviz-" + job.id.substring(0, 8) + "-" + job.containers.size();
    job.containers.add(name);
    List<String> cmd = new ArrayList<>(List.of(
        bin, "run", "--rm", "-i",
        "--name", name,
        "--label", LABEL,
        "--network", "none",
        "--read-only",
        "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m",
        "--memory", memory,
        "--memory-swap", memory,
        "--cpus", "1",
        "--pids-limit", "128",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
        "--user", "10001:10001",
        "--ulimit", "cpu=" + cpuSeconds + ":" + cpuSeconds,
        "--ulimit", "fsize=8388608:8388608",
        "--ulimit", "nofile=256:256",
        "-v", ws.root + ":" + WORK + ":rw",
        "-w", WORK,
        image));
    cmd.addAll(containerCommand);
    return cmd;
  }
}
