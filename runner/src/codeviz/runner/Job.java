package codeviz.runner;

import java.util.Map;
import java.util.UUID;

/** One execution request and its lifecycle. */
public final class Job {
  final String id = UUID.randomUUID().toString();
  final String mode;
  final long createdAt = System.currentTimeMillis();
  volatile long startedAt;
  volatile long finishedAt;
  volatile String status = "queued";
  volatile Map<String, Object> result;
  private volatile Process process;
  private volatile boolean cancelRequested;
  /** Containers this job started, so a stop or timeout removes them, not just the docker CLI. */
  final java.util.Set<String> containers = java.util.concurrent.ConcurrentHashMap.newKeySet();
  volatile Runnable killHook = () -> {};

  Job(String mode) { this.mode = mode; }

  synchronized void attach(Process p) {
    this.process = p;
    if (p != null && cancelRequested) ChildProcess.killTree(p);
  }

  /** Stops the real child process tree, not just the status shown to the user. */
  synchronized void cancel() {
    cancelRequested = true;
    ChildProcess.killTree(process);
    killHook.run();
  }

  boolean cancelRequested() { return cancelRequested; }

  boolean finished() {
    return switch (status) {
      case "completed", "compile_failed", "runtime_error", "timed_out", "cancelled", "failed" -> true;
      default -> false;
    };
  }
}
