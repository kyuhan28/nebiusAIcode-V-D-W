package codeviz.runner;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Runs one job through its stages: validate, compile, then run or trace, then clean up. */
public final class Executor {
  private final Config cfg;
  private final Sandbox sandbox;
  private final Docker docker;
  private final String runnerClasspath;

  Executor(Config cfg, Sandbox sandbox, Docker docker) {
    this.cfg = cfg;
    this.sandbox = sandbox;
    this.docker = docker;
    try {
      this.runnerClasspath = Path.of(Executor.class.getProtectionDomain().getCodeSource().getLocation().toURI()).toString();
    } catch (Exception e) {
      throw new IllegalStateException("Cannot locate the runner's own classes", e);
    }
  }

  record TestCase(String id, String stdin) {}

  /* Paths and commands differ between process isolation and per-job containers. */
  private boolean inDocker() { return docker != null; }
  private String path(Workspace ws, Path p) { return inDocker() ? Docker.map(ws, p) : p.toString(); }
  private String java() { return inDocker() ? "java" : cfg.javaBin(); }
  private String classes() { return inDocker() ? Docker.CLASSES : runnerClasspath; }
  private List<String> isolate(List<String> cmd, Workspace ws, Job job, String memory, int cpu, boolean trace) {
    if (inDocker()) {
      job.killHook = () -> docker.remove(job);
      return docker.wrap(cmd, ws, job, memory, cpu);
    }
    return trace ? sandbox.wrapTrace(cmd, cpu, cfg) : sandbox.wrap(cmd, cpu, cfg);
  }
  record Request(String mode, List<Workspace.SourceFile> files, String mainClass, String stdin, List<TestCase> tests) {}

  void execute(Job job, Request req) {
    job.startedAt = System.currentTimeMillis();
    Map<String, Object> res = new LinkedHashMap<>();
    res.put("mode", req.mode());
    res.put("javaVersion", inDocker() && docker.javaVersion != null ? docker.javaVersion : Runtime.version().toString());
    res.put("sandbox", inDocker() ? "docker" : sandbox.level());
    try (Workspace ws = Workspace.create(cfg, req.files())) {
      if (inDocker()) Docker.prepare(ws);
      List<Workspace.EntryPoint> entries = Workspace.entryPoints(req.files());
      res.put("entryPoints", entries.stream().map(e -> Map.of("className", e.className(), "path", e.path())).toList());

      /* 1. Compile, in its own limited JVM. */
      job.status = "compiling";
      long c0 = System.nanoTime();
      Map<String, Object> compiled = compile(ws, job);
      res.put("compileMs", (System.nanoTime() - c0) / 1_000_000);
      res.put("diagnostics", compiled.getOrDefault("diagnostics", List.of()));
      if (job.cancelRequested()) { finish(job, res, "cancelled"); return; }
      if (compiled.get("timedOut") == Boolean.TRUE) { res.put("error", "Compilation took too long and was stopped."); finish(job, res, "timed_out"); return; }
      if (compiled.get("fatal") != null) { res.put("error", compiled.get("fatal")); finish(job, res, "failed"); return; }
      if (compiled.get("ok") != Boolean.TRUE) { finish(job, res, "compile_failed"); return; }
      if (req.mode().equals("compile")) { finish(job, res, "completed"); return; }

      /* 2. Pick the entry point. */
      String main = req.mainClass();
      List<String> classes = ws.compiledClasses();
      if (main == null || main.isBlank()) {
        if (entries.size() == 1) main = entries.get(0).className();
        else if (entries.isEmpty()) throw new RunnerException(422, "no_main", "No class has a public static void main(String[] args) method.");
        else throw new RunnerException(422, "choose_main", "More than one class has a main method. Choose which one to run.");
      }
      if (!classes.contains(main)) throw new RunnerException(422, "unknown_main", "The entry point " + main + " was not found in the compiled classes.");
      res.put("entryPoint", main);

      /* 3. Run or trace. */
      job.status = "running";
      byte[] stdin = req.stdin() == null ? new byte[0] : req.stdin().getBytes(StandardCharsets.UTF_8);
      if (req.mode().equals("trace")) trace(ws, main, classes, req.stdin(), job, res);
      else if (req.mode().equals("test")) test(ws, main, req.tests(), job, res);
      else run(ws, main, stdin, job, res);
    } catch (RunnerException e) {
      res.put("error", e.getMessage());
      res.put("errorCode", e.code);
      finish(job, res, "failed");
    } catch (Exception e) {
      res.put("error", "The runner hit an internal problem and stopped this execution.");
      System.err.println("[runner] job " + job.id + " failed: " + e);
      finish(job, res, "failed");
    }
  }

  private Map<String, Object> compile(Workspace ws, Job job) throws IOException {
    List<String> javaCmd = new ArrayList<>(List.of(java(), "-Xmx384m", "-XX:+UseSerialGC", "-XX:TieredStopAtLevel=1",
        "-cp", classes(), "codeviz.runner.CompileMain", path(ws, ws.src), path(ws, ws.out)));
    for (Path p : ws.sourcePaths()) javaCmd.add(path(ws, p));
    List<String> cmd = isolate(javaCmd, ws, job, "768m", cfg.compileTimeoutMs() / 1000 + 2, false);
    ChildProcess.Result r = ChildProcess.run(cmd, ws.root, null, cfg.compileTimeoutMs(), 1024 * 1024, job);
    if (r.timedOut()) return Map.of("timedOut", true);
    if (r.cancelled()) return Map.of();
    String line = r.stdout().lines().filter(l -> l.startsWith("{")).reduce((a, b) -> b).orElse(null);
    if (line == null) return Map.of("fatal", "The compiler did not start. Check that the runner uses a full JDK.");
    @SuppressWarnings("unchecked")
    Map<String, Object> parsed = (Map<String, Object>) Json.parse(line);
    return parsed;
  }

  private List<String> userJvm(Workspace ws, String main) {
    List<String> cmd = new ArrayList<>();
    cmd.add(java());
    cmd.addAll(Sandbox.jvmFlags(cfg, Path.of(path(ws, ws.tmp))));
    cmd.addAll(List.of("-cp", path(ws, ws.out), main));
    return cmd;
  }

  private void run(Workspace ws, String main, byte[] stdin, Job job, Map<String, Object> res) throws IOException {
    List<String> cmd = isolate(userJvm(ws, main), ws, job, "512m", cfg.runTimeoutMs() / 1000 + 2, false);
    ChildProcess.Result r = ChildProcess.run(cmd, ws.root, stdin, cfg.runTimeoutMs(), cfg.maxOutputBytes(), job);
    res.put("stdout", r.stdout());
    res.put("stderr", r.stderr());
    res.put("stdoutTruncated", r.stdoutTruncated());
    res.put("stderrTruncated", r.stderrTruncated());
    res.put("exitCode", r.timedOut() || r.cancelled() ? null : r.exitCode());
    res.put("durationMs", r.durationMs());
    Map<String, Object> ex = parseException(r.stderr());
    if (ex != null) res.put("exception", ex);
    if (r.cancelled()) finish(job, res, "cancelled");
    else if (r.timedOut()) { res.put("error", "The program ran longer than " + cfg.runTimeoutMs() / 1000 + " seconds and was stopped."); finish(job, res, "timed_out"); }
    else if (ex != null || r.exitCode() != 0) finish(job, res, "runtime_error");
    else finish(job, res, "completed");
  }

  /**
   * Runs the compiled program once per test input, each in a fresh limited JVM with its own
   * timeout. The runner only executes; comparing against expected output is the caller's job,
   * so expected answers never have to leave the server that owns them.
   */
  private void test(Workspace ws, String main, List<TestCase> tests, Job job, Map<String, Object> res) throws IOException {
    int perTest = Math.min(cfg.runTimeoutMs(), 5_000);
    List<Object> results = new ArrayList<>();
    long t0 = System.nanoTime();
    for (TestCase t : tests) {
      if (job.cancelRequested()) break;
      List<String> cmd = isolate(userJvm(ws, main), ws, job, "512m", perTest / 1000 + 2, false);
      ChildProcess.Result r = ChildProcess.run(cmd, ws.root, t.stdin().getBytes(StandardCharsets.UTF_8), perTest, 16 * 1024, job);
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("id", t.id());
      Map<String, Object> ex = parseException(r.stderr());
      m.put("status", r.cancelled() ? "cancelled" : r.timedOut() ? "timed_out" : ex != null || r.exitCode() != 0 ? "runtime_error" : "ok");
      m.put("stdout", r.stdout());
      m.put("stdoutTruncated", r.stdoutTruncated());
      m.put("stderr", r.stderr().length() > 2000 ? r.stderr().substring(0, 2000) : r.stderr());
      m.put("exitCode", r.timedOut() || r.cancelled() ? null : r.exitCode());
      m.put("durationMs", r.durationMs());
      if (ex != null) m.put("exception", ex);
      results.add(m);
    }
    res.put("tests", results);
    res.put("durationMs", (System.nanoTime() - t0) / 1_000_000);
    finish(job, res, job.cancelRequested() ? "cancelled" : "completed");
  }

  private void trace(Workspace ws, String main, List<String> classes, String stdin, Job job, Map<String, Object> res) throws IOException {
    Path reqFile = ws.root.resolve("trace-request.json");
    Path resultFile = ws.root.resolve("trace-result.json");
    Map<String, Object> treq = new LinkedHashMap<>();
    treq.put("command", userJvm(ws, main));
    treq.put("mainClass", main);
    treq.put("classes", classes);
    treq.put("maxSteps", cfg.maxSteps());
    treq.put("maxOutput", cfg.maxOutputBytes());
    treq.put("timeoutMs", cfg.traceTimeoutMs());
    treq.put("stdin", stdin == null ? "" : stdin);
    Files.writeString(reqFile, Json.write(treq), StandardCharsets.UTF_8);

    List<String> javaCmd = List.of(java(), "-Xmx512m", "-XX:+UseSerialGC", "-cp", classes(),
        "codeviz.runner.TraceMain", path(ws, reqFile), path(ws, resultFile));
    List<String> cmd = isolate(javaCmd, ws, job, "1g", cfg.traceTimeoutMs() / 1000 + 10, true);
    long t0 = System.nanoTime();
    ChildProcess.Result r = ChildProcess.run(cmd, ws.root, null, cfg.traceTimeoutMs() + 8000, 256 * 1024, job);
    res.put("durationMs", (System.nanoTime() - t0) / 1_000_000);
    if (r.cancelled()) { finish(job, res, "cancelled"); return; }
    if (!Files.exists(resultFile)) {
      System.err.println("[runner] tracer produced no result: " + r.stderr());
      res.put("error", r.timedOut() ? "Tracing took too long and was stopped." : "The tracer could not record this program.");
      finish(job, res, r.timedOut() ? "timed_out" : "failed");
      return;
    }
    @SuppressWarnings("unchecked")
    Map<String, Object> t = (Map<String, Object>) Json.parse(Files.readString(resultFile, StandardCharsets.UTF_8));
    res.put("stdout", t.get("stdout"));
    res.put("stderr", t.get("stderr"));
    res.put("stdoutTruncated", t.get("stdoutTruncated"));
    res.put("stderrTruncated", t.get("stderrTruncated"));
    String reason = (String) t.get("stopReason");
    res.put("exitCode", reason == null ? t.get("exitCode") : null);
    Map<String, Object> trace = new LinkedHashMap<>();
    /* Version 2 adds frame ids and depth, parameter names, declared types, and return steps. */
    trace.put("version", 2);
    trace.put("steps", t.get("steps"));
    trace.put("stepCount", t.get("stepCount"));
    trace.put("truncated", t.get("truncated"));
    trace.put("stopReason", reason);
    trace.put("sourceMap", sourceMap(ws.files));
    /* Recorded input operations and the stdin they read, for the input visualizer. */
    trace.put("io", t.getOrDefault("io", List.of()));
    trace.put("ioTruncated", t.getOrDefault("ioTruncated", false));
    trace.put("stdin", t.getOrDefault("stdin", ""));
    /* Declared field and static types per user class, from the class files. */
    trace.put("classes", t.getOrDefault("classes", Map.of()));
    res.put("trace", trace);
    if (t.get("exception") instanceof Map<?, ?> ex) res.put("exception", ex);
    if ("timeout".equals(reason)) { res.put("error", "Tracing stopped after " + cfg.traceTimeoutMs() / 1000 + " seconds. The steps recorded so far are shown."); finish(job, res, "timed_out"); }
    else if (res.get("exception") != null || (t.get("exitCode") instanceof Number n && n.intValue() != 0 && reason == null)) finish(job, res, "runtime_error");
    else finish(job, res, "completed");
  }

  /** Maps each class's compiled source path (package/File.java) back to the path the user gave. */
  private static Map<String, String> sourceMap(List<Workspace.SourceFile> files) {
    Pattern pkg = Pattern.compile("(?m)^\\s*package\\s+([\\w.]+)\\s*;");
    Map<String, String> m = new LinkedHashMap<>();
    for (Workspace.SourceFile f : files) {
      Matcher mm = pkg.matcher(Workspace.stripComments(f.content()));
      String name = f.path().substring(f.path().lastIndexOf('/') + 1);
      m.put((mm.find() ? mm.group(1).replace('.', '/') + "/" : "") + name, f.path());
    }
    return m;
  }

  private static final Pattern EXCEPTION = Pattern.compile("Exception in thread \"[^\"]*\" ([\\w.$]+)(?::\\s*(.*))?");
  private static final Pattern FRAME = Pattern.compile("^\\s+at ([\\w.$]+)\\.([\\w$<>]+)\\(([\\w$]+\\.java):(\\d+)\\)");

  /** Pulls the exception type, message, and first source location out of a JVM stack trace. */
  static Map<String, Object> parseException(String stderr) {
    Matcher m = EXCEPTION.matcher(stderr);
    if (!m.find()) return null;
    Map<String, Object> ex = new LinkedHashMap<>();
    ex.put("type", m.group(1));
    ex.put("message", m.group(2));
    for (String line : stderr.substring(m.end()).lines().toList()) {
      Matcher f = FRAME.matcher(line);
      if (f.find() && !f.group(1).startsWith("java.") && !f.group(1).startsWith("jdk.")) {
        String cls = f.group(1);
        String pkg = cls.contains(".") ? cls.substring(0, cls.lastIndexOf('.')).replace('.', '/') + "/" : "";
        ex.put("sourcePath", pkg + f.group(3));
        ex.put("line", Integer.parseInt(f.group(4)));
        ex.put("method", f.group(2));
        break;
      }
    }
    return ex;
  }

  private static void finish(Job job, Map<String, Object> res, String status) {
    res.put("status", status);
    job.result = res;
    job.status = status;
    job.finishedAt = System.currentTimeMillis();
  }
}
