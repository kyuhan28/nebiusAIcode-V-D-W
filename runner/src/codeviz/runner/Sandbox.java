package codeviz.runner;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Wraps every child process in the strongest isolation this host supports, and reports
 * honestly what that is. Child JVMs always get resource limits; network isolation is added
 * when the kernel allows an unprivileged network namespace.
 */
public final class Sandbox {
  final boolean prlimit;
  final boolean networkIsolated;
  /** Tracing needs loopback inside the namespace so the debugger can attach. */
  final String loopbackHelper;
  final boolean container;
  /** The platform (e.g. an internal-only container network) blocks egress, so no namespace is needed. */
  final boolean platformNetwork;

  private Sandbox(boolean prlimit, boolean networkIsolated, String loopbackHelper, boolean container, boolean platformNetwork) {
    this.prlimit = prlimit;
    this.networkIsolated = networkIsolated;
    this.loopbackHelper = loopbackHelper;
    this.container = container;
    this.platformNetwork = platformNetwork;
  }

  static Sandbox probe(Path runnerHome) {
    boolean pr = works(List.of("prlimit", "--nofile=64", "--", "true"));
    boolean net = works(List.of("unshare", "-rnpf", "--kill-child", "true"));
    String helper = runnerHome.resolve("bin/netns-exec.py").toString();
    boolean lo = net && works(List.of("unshare", "-rnpf", "--kill-child", "python3", helper, "true"));
    boolean container = Files.exists(Path.of("/.dockerenv")) || "1".equals(System.getenv("RUNNER_IN_CONTAINER"));
    if ("1".equals(System.getenv("RUNNER_PLATFORM_NETWORK_ISOLATION"))) return new Sandbox(pr, false, null, true, true);
    return new Sandbox(pr, net, lo ? helper : null, container, false);
  }

  private static boolean works(List<String> cmd) {
    try {
      Process p = new ProcessBuilder(cmd).redirectErrorStream(true).start();
      p.getInputStream().readAllBytes();
      return p.waitFor(5, TimeUnit.SECONDS) && p.exitValue() == 0;
    } catch (Exception e) {
      return false;
    }
  }

  /** "full" only when processes are network-isolated and resource-limited. */
  String level() {
    if (platformNetwork && prlimit) return "container";
    if (networkIsolated && prlimit && loopbackHelper != null) return container ? "container" : "full";
    return "partial";
  }

  boolean networkBlocked() { return networkIsolated || platformNetwork; }

  boolean traceIsolated() { return platformNetwork || (networkIsolated && loopbackHelper != null); }

  /** Builds the final command line around a child JVM invocation. */
  List<String> wrap(List<String> javaCommand, int cpuSeconds, Config cfg) {
    return wrap(javaCommand, cpuSeconds, false);
  }

  /** Tracing runs the debugger and the program together inside the namespace, with loopback up. */
  List<String> wrapTrace(List<String> javaCommand, int cpuSeconds, Config cfg) {
    return wrap(javaCommand, cpuSeconds, true);
  }

  private List<String> wrap(List<String> javaCommand, int cpuSeconds, boolean needsLoopback) {
    List<String> cmd = new ArrayList<>();
    if (networkIsolated && (!needsLoopback || loopbackHelper != null)) {
      /* New user, network, and PID namespaces. When the program's first process exits, the kernel
         kills everything else it started, so nothing outlives the run. */
      cmd.addAll(List.of("unshare", "-rnpf", "--kill-child"));
      if (needsLoopback) cmd.addAll(List.of("python3", loopbackHelper));
    }
    if (prlimit) {
      cmd.add("prlimit");
      cmd.add("--cpu=" + cpuSeconds);
      cmd.add("--fsize=" + (8L * 1024 * 1024));
      cmd.add("--nofile=256");
      cmd.add("--core=0");
      /* Without a PID namespace, a per-user process cap is what stops fork bombs. */
      if (platformNetwork) cmd.add("--nproc=512");
      cmd.add("--");
    }
    cmd.addAll(javaCommand);
    return cmd;
  }

  /** Common hardening flags for user JVMs. Users can never add their own JVM arguments. */
  static List<String> jvmFlags(Config cfg, Path tmp) {
    return List.of(
        "-Xmx" + cfg.heapMb() + "m",
        "-Xss16m",
        "-XX:+UseSerialGC",
        "-XX:TieredStopAtLevel=1",
        "-XX:ActiveProcessorCount=1",
        "-XX:-UsePerfData",
        "-Xshare:auto",
        "-Djava.awt.headless=true",
        "-Dfile.encoding=UTF-8",
        "-Dstdout.encoding=UTF-8",
        "-Djava.io.tmpdir=" + tmp);
  }
}
