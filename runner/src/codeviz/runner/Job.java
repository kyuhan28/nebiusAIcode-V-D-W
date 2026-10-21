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

  /* ---- Interactive runs: input typed while the program runs, and its output so far. ---- */
  volatile boolean interactive;
  private java.io.OutputStream input;
  volatile ChildProcess.Capture liveOut;
  volatile ChildProcess.Capture liveErr;

  synchronized void openInput(java.io.OutputStream os, ChildProcess.Capture out, ChildProcess.Capture err) {
    input = os;
    liveOut = out;
    liveErr = err;
  }

  synchronized void closeInput() {
    if (input == null) return;
    try { input.close(); } catch (java.io.IOException ignored) {}
    input = null;
  }

  synchronized boolean acceptsInput() { return input != null; }

  /** Writes text to the running program's standard input; eof closes it (as Ctrl+D does in a terminal). */
  synchronized boolean sendInput(String text, boolean eof) {
    if (input == null) return false;
    try {
      if (text != null && !text.isEmpty()) {
        input.write(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        input.flush();
      }
    } catch (java.io.IOException e) {
      closeInput();
      return false;
    }
    if (eof) closeInput();
    return true;
  }

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
