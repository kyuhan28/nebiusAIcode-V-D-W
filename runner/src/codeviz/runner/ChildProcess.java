package codeviz.runner;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/** Starts a child process with a minimal environment, capped output, a deadline, and tree kill. */
public final class ChildProcess {
  public record Result(int exitCode, String stdout, String stderr, boolean stdoutTruncated, boolean stderrTruncated,
      boolean timedOut, boolean cancelled, long durationMs) {}

  /** Reads a stream to completion but keeps at most `cap` bytes, so a chatty program can't block or flood us. */
  static final class Capture extends Thread {
    private final InputStream in;
    private final int cap;
    private final ByteArrayOutputStream buf = new ByteArrayOutputStream();
    volatile boolean truncated;

    Capture(InputStream in, int cap) {
      this.in = in;
      this.cap = cap;
      setDaemon(true);
      start();
    }

    @Override public void run() {
      byte[] chunk = new byte[8192];
      try {
        int n;
        while ((n = in.read(chunk)) != -1) {
          synchronized (buf) {
            int room = cap - buf.size();
            if (room > 0) buf.write(chunk, 0, Math.min(room, n));
            if (n > room) truncated = true;
          }
        }
      } catch (IOException ignored) {}
    }

    String text() {
      try { join(2000); } catch (InterruptedException ignored) {}
      synchronized (buf) { return buf.toString(StandardCharsets.UTF_8); }
    }

    /** What has arrived so far, without waiting for the stream to end (live output of interactive runs). */
    String snapshot() {
      synchronized (buf) { return buf.toString(StandardCharsets.UTF_8); }
    }
  }

  static ProcessBuilder builder(List<String> cmd, Path cwd) {
    ProcessBuilder pb = new ProcessBuilder(cmd).directory(cwd.toFile());
    Map<String, String> env = pb.environment();
    String javaHome = System.getProperty("java.home");
    env.clear();
    env.put("PATH", javaHome + "/bin:/usr/local/bin:/usr/bin:/bin");
    env.put("LANG", "C.UTF-8");
    env.put("HOME", cwd.toString());
    /* The docker CLI (trusted, ours) needs its own settings; containers never inherit them. */
    if (!cmd.isEmpty() && cmd.get(0).endsWith("/docker")) {
      for (String k : List.of("DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH")) {
        String v = System.getenv(k);
        if (v != null) env.put(k, v);
      }
      String home = System.getenv("HOME");
      if (home != null && System.getenv("DOCKER_CONFIG") == null) env.put("DOCKER_CONFIG", home + "/.docker");
    }
    return pb;
  }

  static void killTree(Process p) {
    if (p == null) return;
    p.descendants().forEach(ProcessHandle::destroyForcibly);
    p.destroyForcibly();
  }

  static Result run(List<String> cmd, Path cwd, byte[] stdin, int timeoutMs, int maxOutput, Job job) throws IOException {
    return run(cmd, cwd, stdin, timeoutMs, maxOutput, job, false);
  }

  /**
   * interactive: the program's standard input stays open, so lines typed while it runs reach it
   * (Job.sendInput), and its output so far can be read while it runs (Job.liveOut).
   */
  static Result run(List<String> cmd, Path cwd, byte[] stdin, int timeoutMs, int maxOutput, Job job, boolean interactive) throws IOException {
    long start = System.nanoTime();
    Process p = builder(cmd, cwd).start();
    job.attach(p);
    Capture out = new Capture(p.getInputStream(), maxOutput);
    Capture err = new Capture(p.getErrorStream(), maxOutput);
    if (interactive) {
      OutputStream os = p.getOutputStream();
      try {
        if (stdin != null && stdin.length > 0) { os.write(stdin); os.flush(); }
      } catch (IOException ignored) {}
      job.openInput(os, out, err);
    } else {
      try (OutputStream os = p.getOutputStream()) {
        if (stdin != null && stdin.length > 0) os.write(stdin);
      } catch (IOException ignored) {
        /* The program may exit before reading its input. */
      }
    }
    boolean finished;
    try {
      finished = p.waitFor(timeoutMs, TimeUnit.MILLISECONDS);
    } catch (InterruptedException e) {
      finished = false;
    }
    if (!finished) {
      killTree(p);
      job.killHook.run();
    }
    try { p.waitFor(2, TimeUnit.SECONDS); } catch (InterruptedException ignored) {}
    if (interactive) job.closeInput();
    job.attach(null);
    long ms = (System.nanoTime() - start) / 1_000_000;
    /* An interactive run has a long wall-clock limit (it waits for typing) but the usual CPU limit: when that
       stops it (SIGKILL 137, SIGXCPU 152), it ran too long, like any run over its time. */
    /* In process mode the sandbox wrapper (unshare) reports the killed child as status 1 with only its own
       "unshare: ..." line on stderr; a program's own error always prints more (a traceback, a message). */
    String errText = err.text();
    boolean wrapperOnly = errText.strip().startsWith("unshare:") && errText.strip().lines().count() == 1;
    boolean cpuLimit = interactive && finished && !job.cancelRequested() && (p.exitValue() == 137 || p.exitValue() == 152 || wrapperOnly);
    return new Result(finished ? p.exitValue() : -1, out.text(), cpuLimit ? "" : errText, out.truncated, err.truncated,
        (!finished && !job.cancelRequested()) || cpuLimit, job.cancelRequested(), ms);
  }
}
