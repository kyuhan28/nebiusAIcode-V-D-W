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
  record Request(String mode, List<Workspace.SourceFile> files, String mainClass, String stdin, List<TestCase> tests, String language) {
    Request(String mode, List<Workspace.SourceFile> files, String mainClass, String stdin, List<TestCase> tests) {
      this(mode, files, mainClass, stdin, tests, "java");
    }
  }

  void execute(Job job, Request req) {
    job.startedAt = System.currentTimeMillis();
    Map<String, Object> res = new LinkedHashMap<>();
    res.put("mode", req.mode());
    res.put("javaVersion", inDocker() && docker.javaVersion != null ? docker.javaVersion : Runtime.version().toString());
    res.put("sandbox", inDocker() ? "docker" : sandbox.level());
    try (Workspace ws = Workspace.create(cfg, req.files())) {
      if (inDocker()) Docker.prepare(ws);
      if ("python".equals(req.language())) { executePython(job, req, ws, res); return; }
      if ("c".equals(req.language()) || "cpp".equals(req.language())) { executeNative(job, req, ws, res); return; }
      List<Workspace.EntryPoint> entries = Workspace.entryPoints(req.files());
      res.put("entryPoints", entries.stream().map(e -> Map.of("className", e.className(), "path", e.path())).toList());

      /* 1. Compile, in its own limited JVM. */
      job.status = "compiling";
      long c0 = System.nanoTime();
      Map<String, Object> compiled = compile(ws, job);
      res.put("compileMs", (System.nanoTime() - c0) / 1_000_000);
      res.put("diagnostics", compiled.getOrDefault("diagnostics", List.of()));
      /* The class model javac resolved, for the inheritance view; present only after a clean compile. */
      if (compiled.get("hierarchy") != null) res.put("hierarchy", compiled.get("hierarchy"));
      if (job.cancelRequested()) { finish(job, res, "cancelled"); return; }
      if (compiled.get("timedOut") == Boolean.TRUE) { res.put("error", "Compilation took too long and was stopped."); finish(job, res, "timed_out"); return; }
      if (compiled.get("fatal") != null) { res.put("error", compiled.get("fatal")); finish(job, res, "failed"); return; }
      if (compiled.get("ok") != Boolean.TRUE) { finish(job, res, "compile_failed"); return; }
      if (req.mode().equals("compile")) { finish(job, res, "completed"); return; }

      /* 2. Pick the entry point. */
      String main = req.mainClass();
      List<String> classes = compiledClasses(ws, compiled);
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
      /* Say what actually broke, so a failure here can be fixed instead of guessed at. */
      String what = e.getClass().getSimpleName() + (e.getMessage() == null ? "" : ": " + e.getMessage());
      if (what.length() > 220) what = what.substring(0, 217) + "...";
      res.put("error", "The runner hit an internal problem and stopped this execution (" + what + "). The runner's terminal has the details.");
      System.err.println("[runner] job " + job.id + " failed: " + e);
      e.printStackTrace();
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

  /**
   * Every compiled class name. Normally read from the output folder; if that cannot be walked (in
   * Docker mode, package folders are created by the sandbox user), the class model javac reported
   * names the same classes, so a run never fails just because a folder could not be listed.
   */
  @SuppressWarnings("unchecked")
  private static List<String> compiledClasses(Workspace ws, Map<String, Object> compiled) {
    java.util.LinkedHashSet<String> names = new java.util.LinkedHashSet<>();
    try {
      names.addAll(ws.compiledClasses());
    } catch (Exception e) {
      System.err.println("[runner] could not list compiled classes, using javac's class model instead: " + e);
    }
    if (compiled.get("hierarchy") instanceof List<?> model) {
      for (Object c : model) if (c instanceof Map<?, ?> m && m.get("name") instanceof String n) names.add(n);
    }
    return new ArrayList<>(names);
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
    /* Programs start in the project folder, so relative paths such as data/input.txt find project files (as in Python). */
    ChildProcess.Result r = ChildProcess.run(cmd, ws.src, stdin, runTimeoutMs(job), cfg.maxOutputBytes(), job, job.interactive);
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
      ChildProcess.Result r = ChildProcess.run(cmd, ws.src, t.stdin().getBytes(StandardCharsets.UTF_8), perTest, 16 * 1024, job);
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
    /* The traced program inherits this working folder: the project folder, like a normal run. */
    ChildProcess.Result r = ChildProcess.run(cmd, ws.src, null, cfg.traceTimeoutMs() + 8000, 256 * 1024, job);
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
    finishTrace(ws, t, job, res);
  }

  /** Turns a recorder's result (TraceMain for Java, pyrun.py for Python: same format) into the job result. */
  private void finishTrace(Workspace ws, Map<String, Object> t, Job job, Map<String, Object> res) {
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
    if (res.get("language") != null) trace.put("language", res.get("language"));
    /* C and C++: allocation totals and the blocks still allocated when the program ended. */
    if (t.get("memorySummary") != null) trace.put("memorySummary", t.get("memorySummary"));
    /* C and C++: allocations, frees, and blocks, from the allocation log. */
    if (t.get("memory") != null) trace.put("memory", t.get("memory"));
    res.put("trace", trace);
    /* Python's class model comes from the real classes after the run, so the recorder sends it. */
    if (t.get("hierarchy") instanceof List<?> h && !h.isEmpty()) res.put("hierarchy", h);
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
      /* A Python module's recorded source path is its project path. */
      if (!f.path().endsWith(".java")) { m.put(f.path(), f.path()); continue; }
      Matcher mm = pkg.matcher(Workspace.stripComments(f.content()));
      String name = f.path().substring(f.path().lastIndexOf('/') + 1);
      m.put((mm.find() ? mm.group(1).replace('.', '/') + "/" : "") + name, f.path());
    }
    return m;
  }

  private static final Pattern EXCEPTION = Pattern.compile("Exception in thread \"[^\"]*\" ([\\w.$]+)(?::\\s*(.*))?");
  private static final Pattern FRAME = Pattern.compile("^\\s+at ([\\w.$]+)\\.([\\w$<>]+)\\(([\\w$]+\\.java):(\\d+)\\)");

  /** Pulls the exception type, message, and first source location out of a JVM stack trace. */
  /* ---------------- Python ---------------- */

  private volatile Map<String, Object> pythonInfo;

  private String python() {
    return inDocker() ? "python3" : System.getenv().getOrDefault("RUNNER_PYTHON", "python3");
  }

  /** Asks the interpreter programs run with (the sandbox image's, in Docker mode) for its version and installed packages. */
  private static final String PY_INFO = "import json,sys,importlib.metadata as m;"
      + "print(json.dumps({'version':sys.version.split()[0],'packages':dict(sorted((d.metadata['Name'],d.version) for d in m.distributions() if d.metadata['Name']))}))";

  @SuppressWarnings("unchecked")
  Map<String, Object> pythonInfo() {
    if (pythonInfo == null) {
      Map<String, Object> found = Map.of();
      try {
        List<String> cmd = inDocker()
            ? List.of(docker.bin, "run", "--rm", "--network", "none", "--user", "10001:10001", docker.image, "python3", "-E", "-s", "-c", PY_INFO)
            : List.of(python(), "-E", "-s", "-c", PY_INFO);
        Process p = new ProcessBuilder(cmd).redirectErrorStream(true).start();
        byte[] out = p.getInputStream().readAllBytes();
        if (p.waitFor(30, java.util.concurrent.TimeUnit.SECONDS) && p.exitValue() == 0) {
          String line = new String(out, StandardCharsets.UTF_8).lines().filter(l -> l.startsWith("{")).reduce((x, y) -> y).orElse(null);
          if (line != null) found = (Map<String, Object>) Json.parse(line);
        } else p.destroyForcibly();
      } catch (Exception ignored) {}
      pythonInfo = found;
    }
    return pythonInfo;
  }

  /** The Python version programs run with, or null if there is none. */
  String pythonVersion() {
    return pythonInfo().get("version") instanceof String v ? v : null;
  }

  private static Path bootstrap;

  /** Copies bin/pyrun.py into the job folder, where the sandbox (or the container) can read but not change it. */
  private Path installBootstrap(Workspace ws) throws IOException {
    if (bootstrap == null) {
      try {
        bootstrap = Server.runnerHome().resolve("bin/pyrun.py");
      } catch (Exception e) {
        throw new IOException("Could not find bin/pyrun.py next to the runner", e);
      }
    }
    Path dir = Files.createDirectories(ws.root.resolve("codeviz"));
    Path dst = dir.resolve("pyrun.py");
    Files.copy(bootstrap, dst, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
    try {
      Files.setPosixFilePermissions(dir, java.nio.file.attribute.PosixFilePermissions.fromString("rwxr-xr-x"));
      Files.setPosixFilePermissions(dst, java.nio.file.attribute.PosixFilePermissions.fromString("r--r--r--"));
    } catch (UnsupportedOperationException ignored) {}
    return dst;
  }

  /**
   * A Python job: a syntax check of every .py file (the Compile step), then the entry file run with
   * the real interpreter, or recorded by pyrun.py's tracer. Same isolation, limits, and result shape
   * as Java.
   */
  private void executePython(Job job, Request req, Workspace ws, Map<String, Object> res) throws IOException, RunnerException {
    res.put("language", "python");
    String version = pythonVersion();
    if (version != null) res.put("pythonVersion", version);
    List<String> py = List.of(python(), "-E", "-s", "-B", "-u", path(ws, installBootstrap(ws)));

    job.status = "compiling";
    long c0 = System.nanoTime();
    List<String> check = new ArrayList<>(py);
    check.addAll(List.of("check", path(ws, ws.src)));
    ChildProcess.Result cr = ChildProcess.run(isolate(check, ws, job, "512m", 20, false), ws.root, null, cfg.runTimeoutMs(), 1 << 20, job);
    res.put("compileMs", (System.nanoTime() - c0) / 1_000_000);
    if (cr.cancelled()) { finish(job, res, "cancelled"); return; }
    if (cr.timedOut()) { res.put("error", "Checking the Python files took too long and was stopped."); finish(job, res, "timed_out"); return; }
    String line = cr.stdout().lines().filter(l -> l.startsWith("{")).reduce((x, y) -> y).orElse(null);
    if (line == null) {
      String why = cr.stderr().isBlank() ? "no output" : cr.stderr().lines().limit(3).reduce((x, y) -> x + " " + y).orElse("");
      res.put("error", (version == null ? "Python 3 is not available to the runner. " : "The Python check did not start. ") + why);
      finish(job, res, "failed");
      return;
    }
    @SuppressWarnings("unchecked")
    Map<String, Object> compiled = (Map<String, Object>) Json.parse(line);
    res.put("diagnostics", compiled.getOrDefault("diagnostics", List.of()));
    if (compiled.get("ok") != Boolean.TRUE) { finish(job, res, "compile_failed"); return; }
    if (req.mode().equals("compile")) { finish(job, res, "completed"); return; }

    List<String> pyFiles = req.files().stream().map(Workspace.SourceFile::path).filter(p -> p.endsWith(".py")).toList();
    String entry = req.mainClass();
    if (entry == null || entry.isBlank()) {
      if (pyFiles.size() == 1) entry = pyFiles.get(0);
      else throw new RunnerException(422, "choose_main", "Choose which .py file to run.");
    }
    if (!pyFiles.contains(entry)) throw new RunnerException(422, "unknown_main", "The file " + entry + " is not a .py file in this project.");
    if (req.mode().equals("test")) throw new RunnerException(400, "unsupported", "Problem tests run Java programs.");
    res.put("entryPoint", entry);
    job.status = "running";

    if (req.mode().equals("trace")) {
      Path reqFile = ws.root.resolve("trace-request.json");
      Path resultFile = ws.root.resolve("trace-result.json");
      Map<String, Object> treq = new LinkedHashMap<>();
      treq.put("maxSteps", cfg.maxSteps());
      treq.put("maxOutput", cfg.maxOutputBytes());
      treq.put("timeoutMs", cfg.traceTimeoutMs());
      treq.put("stdin", req.stdin() == null ? "" : req.stdin());
      Files.writeString(reqFile, Json.write(treq), StandardCharsets.UTF_8);
      List<String> cmd = new ArrayList<>(py);
      cmd.addAll(List.of("trace", path(ws, ws.src), entry, path(ws, reqFile), path(ws, resultFile)));
      long t0 = System.nanoTime();
      ChildProcess.Result r = ChildProcess.run(isolate(cmd, ws, job, "1g", cfg.traceTimeoutMs() / 1000 + 10, false), ws.root, null, cfg.traceTimeoutMs() + 8000, 256 * 1024, job);
      res.put("durationMs", (System.nanoTime() - t0) / 1_000_000);
      if (r.cancelled()) { finish(job, res, "cancelled"); return; }
      if (!Files.exists(resultFile)) {
        System.err.println("[runner] python tracer produced no result: " + r.stderr());
        res.put("error", r.timedOut() ? "Tracing took too long and was stopped." : "The Python tracer could not record this program: " + r.stderr().lines().reduce((x, y) -> y).orElse("no details"));
        finish(job, res, r.timedOut() ? "timed_out" : "failed");
        return;
      }
      @SuppressWarnings("unchecked")
      Map<String, Object> t = (Map<String, Object>) Json.parse(Files.readString(resultFile, StandardCharsets.UTF_8));
      finishTrace(ws, t, job, res);
      return;
    }

    Path result = ws.root.resolve("py-result.json");
    List<String> cmd = new ArrayList<>(py);
    /* Interactive: unbuffered, so every print reaches the terminal at once, not when the buffer fills. */
    if (job.interactive) cmd.add(1, "-u");
    cmd.addAll(List.of("run", path(ws, ws.src), entry, path(ws, result)));
    byte[] stdin = req.stdin() == null ? new byte[0] : req.stdin().getBytes(StandardCharsets.UTF_8);
    ChildProcess.Result r = ChildProcess.run(isolate(cmd, ws, job, "512m", cfg.runTimeoutMs() / 1000 + 2, false), ws.root, stdin, runTimeoutMs(job), cfg.maxOutputBytes(), job, job.interactive);
    res.put("stdout", r.stdout());
    res.put("stderr", r.stderr());
    res.put("stdoutTruncated", r.stdoutTruncated());
    res.put("stderrTruncated", r.stderrTruncated());
    res.put("exitCode", r.timedOut() || r.cancelled() ? null : r.exitCode());
    res.put("durationMs", r.durationMs());
    Map<String, Object> ex = null;
    if (Files.exists(result)) {
      @SuppressWarnings("unchecked")
      Map<String, Object> pr = (Map<String, Object>) Json.parse(Files.readString(result, StandardCharsets.UTF_8));
      if (pr.get("exception") instanceof Map<?, ?> e) {
        @SuppressWarnings("unchecked") Map<String, Object> m = (Map<String, Object>) e;
        ex = m;
        res.put("exception", ex);
      }
      if (pr.get("hierarchy") instanceof List<?> h && !h.isEmpty()) res.put("hierarchy", h);
    }
    if (r.cancelled()) finish(job, res, "cancelled");
    else if (r.timedOut()) { res.put("error", "The program ran longer than " + cfg.runTimeoutMs() / 1000 + " seconds and was stopped."); finish(job, res, "timed_out"); }
    else if (ex != null || r.exitCode() != 0) finish(job, res, "runtime_error");
    else finish(job, res, "completed");
  }

  /* ---------------- C and C++ ---------------- */

  private static Path nativeHelpers;

  /** True once the step-by-step C/C++ recorder (bin/ctrace.py) is part of the runner. */
  private boolean nativeRecorderAvailable() {
    try { return Files.exists(Server.runnerHome().resolve("bin/ctrace.py")); } catch (Exception e) { return false; }
  }

  /** Copies the allocation log sources and the recorder (bin/cvmem.*, bin/ctrace.py) into the job folder, for recording only. */
  private Path installNativeHelpers(Workspace ws) throws IOException {
    if (nativeHelpers == null) {
      try { nativeHelpers = Server.runnerHome().resolve("bin"); }
      catch (Exception e) { throw new IOException("Could not find the runner's bin folder", e); }
    }
    Path dir = Files.createDirectories(ws.root.resolve("codeviz"));
    for (String f : List.of("cvmem.h", "cvmem.c", "cvmem.cpp", "ctrace.py", "unbuffered.c")) {
      if (!Files.exists(nativeHelpers.resolve(f))) continue;
      Files.copy(nativeHelpers.resolve(f), dir.resolve(f), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
      try { Files.setPosixFilePermissions(dir.resolve(f), java.nio.file.attribute.PosixFilePermissions.fromString("r--r--r--")); }
      catch (UnsupportedOperationException ignored) {}
    }
    try { Files.setPosixFilePermissions(dir, java.nio.file.attribute.PosixFilePermissions.fromString("rwxr-xr-x")); }
    catch (UnsupportedOperationException ignored) {}
    return dir;
  }

  /**
   * A C or C++ job: GCC compiles every source file of the language (C17 or C++20, with debug
   * information), then the program runs under AddressSanitizer and UndefinedBehaviorSanitizer, or is
   * recorded step by step by bin/ctrace.py (without sanitizers, with the allocation log linked in).
   */
  private void executeNative(Job job, Request req, Workspace ws, Map<String, Object> res) throws IOException, RunnerException {
    boolean cpp = "cpp".equals(req.language());
    res.put("language", req.language());
    boolean trace = req.mode().equals("trace");
    if (trace && !nativeRecorderAvailable()) throw new RunnerException(422, "unsupported",
        "Step-by-step recording (Visualize) for C and C++ is not available yet. Run compiles your program and checks its memory with AddressSanitizer, LeakSanitizer, and UndefinedBehaviorSanitizer.");
    /* The program to build: the entry file (the one with main) and the sources that belong with it. */
    String entry = req.mainClass();
    boolean valid = entry != null && (cpp ? isCppSource(entry) : isCSource(entry)) && req.files().stream().anyMatch(f -> f.path().equals(req.mainClass()));
    if (!valid) {
      List<String> mains = req.files().stream().filter(f -> (cpp ? isCppSource(f.path()) : isCSource(f.path())) && NATIVE_MAIN.matcher(Workspace.stripComments(f.content())).find()).map(Workspace.SourceFile::path).toList();
      if (mains.size() == 1) entry = mains.get(0);
      else if (mains.isEmpty()) throw new RunnerException(422, "no_main", cpp ? "No .cpp file defines int main()." : "No .c file defines int main().");
      else throw new RunnerException(422, "choose_main", "More than one file defines main(). Open the one to run.");
    }
    List<String> sources = nativeUnits(req.files(), entry, cpp);
    res.put("units", sources);
    String entryDir = entry.contains("/") ? entry.substring(0, entry.lastIndexOf('/')) : "";
    Path helpers = installNativeHelpers(ws);
    Path program = ws.out.resolve("program");
    List<String> cmd = new ArrayList<>(List.of(cpp ? "g++" : "gcc", cpp ? "-std=c++20" : "-std=c17", "-g", "-O0", "-fno-omit-frame-pointer",
        "-Wall", "-Wextra", "-fdiagnostics-format=json", "-I", path(ws, ws.src)));
    /* Headers next to the entry file are found without a path, like a normal one-folder project. */
    if (!entryDir.isEmpty()) cmd.addAll(List.of("-I", path(ws, ws.src.resolve(entryDir))));
    if (trace) {
      /* Fixed addresses (no PIE) and the allocation log; no sanitizers while recording. */
      /* DWARF 4: the version bin/ctrace.py reads. */
      cmd.addAll(List.of("-gdwarf-4", "-no-pie", "-Wl,--wrap=malloc,--wrap=calloc,--wrap=realloc,--wrap=free", "-I", path(ws, helpers), path(ws, helpers.resolve(cpp ? "cvmem.cpp" : "cvmem.c"))));
    } else {
      cmd.addAll(List.of("-fsanitize=address,undefined", "-fno-sanitize-recover=undefined"));
      /* Output survives a sanitizer stopping the program (see bin/unbuffered.c). */
      cmd.add(path(ws, helpers.resolve("unbuffered.c")));
    }
    cmd.addAll(List.of("-o", path(ws, program)));
    for (String s : sources) cmd.add(path(ws, ws.src.resolve(s)));
    cmd.add("-lm");
    job.status = "compiling";
    long c0 = System.nanoTime();
    ChildProcess.Result cr = ChildProcess.run(isolate(cmd, ws, job, "1g", 60, false), ws.src, null, Math.max(cfg.compileTimeoutMs(), 30_000), 2 << 20, job);
    res.put("compileMs", (System.nanoTime() - c0) / 1_000_000);
    res.put("compiler", cpp ? "g++ (C++20)" : "gcc (C17)");
    if (cr.cancelled()) { finish(job, res, "cancelled"); return; }
    if (cr.timedOut()) { res.put("error", "Compilation took too long and was stopped."); finish(job, res, "timed_out"); return; }
    List<Map<String, Object>> diags = NativeReports.compilerDiagnostics(cr.stderr(), srcPrefixes(ws));
    res.put("diagnostics", diags);
    if (cr.exitCode() != 0 || !Files.exists(program)) {
      if (diags.isEmpty()) res.put("error", cr.stderr().isBlank() ? "The compiler (" + (cpp ? "g++" : "gcc") + ") is not available to the runner." : cr.stderr().lines().limit(6).reduce((a, b) -> a + "\n" + b).orElse(""));
      finish(job, res, "compile_failed");
      return;
    }
    if (req.mode().equals("compile")) { finish(job, res, "completed"); return; }
    if (req.mode().equals("test")) throw new RunnerException(400, "unsupported", "Problem tests run Java programs.");
    res.put("entryPoint", entry);
    job.status = "running";
    String stdinText = req.stdin() == null ? "" : req.stdin();

    if (trace) {
      Path reqFile = ws.root.resolve("trace-request.json");
      Path resultFile = ws.root.resolve("trace-result.json");
      Map<String, Object> treq = new LinkedHashMap<>();
      treq.put("maxSteps", cfg.maxSteps());
      treq.put("maxOutput", cfg.maxOutputBytes());
      treq.put("timeoutMs", cfg.traceTimeoutMs());
      treq.put("stdin", stdinText);
      treq.put("language", req.language());
      Files.writeString(reqFile, Json.write(treq), StandardCharsets.UTF_8);
      List<String> tcmd = List.of("python3", "-E", "-s", "-B", path(ws, helpers.resolve("ctrace.py")), path(ws, program), path(ws, ws.src), path(ws, reqFile), path(ws, resultFile));
      long t0 = System.nanoTime();
      ChildProcess.Result r = ChildProcess.run(isolate(tcmd, ws, job, "1g", cfg.traceTimeoutMs() / 1000 + 10, false), ws.src, null, cfg.traceTimeoutMs() + 8000, 256 * 1024, job);
      res.put("durationMs", (System.nanoTime() - t0) / 1_000_000);
      if (r.cancelled()) { finish(job, res, "cancelled"); return; }
      if (!Files.exists(resultFile)) {
        System.err.println("[runner] C/C++ recorder produced no result: " + r.stderr());
        res.put("error", r.timedOut() ? "Recording took too long and was stopped." : "The C/C++ recorder could not record this program: " + r.stderr().lines().reduce((x, y) -> y).orElse("no details"));
        finish(job, res, r.timedOut() ? "timed_out" : "failed");
        return;
      }
      @SuppressWarnings("unchecked")
      Map<String, Object> t = (Map<String, Object>) Json.parse(Files.readString(resultFile, StandardCharsets.UTF_8));
      finishTrace(ws, t, job, res);
      return;
    }

    /* Sanitizer options: leaks reported at exit, memory capped, and a NULL from malloc past the cap (as C allows). */
    /* A shell is process 1 of the sandbox's namespace (or container) and the program its child: Linux
       ignores signals sent to process 1, so as process 1 a failed assert() or abort() would not stop it. */
    List<String> run = List.of("sh", "-c", "\"$@\"; exit $?", "sh", "env",
        "ASAN_OPTIONS=detect_leaks=1:malloc_limit_mb=512:hard_rss_limit_mb=768:allocator_may_return_null=1:detect_stack_use_after_return=0:color=never",
        "UBSAN_OPTIONS=print_stacktrace=1:color=never", "LSAN_OPTIONS=exitcode=23", path(ws, program));
    byte[] stdin = stdinText.getBytes(StandardCharsets.UTF_8);
    ChildProcess.Result r = ChildProcess.run(isolate(run, ws, job, "1g", cfg.runTimeoutMs() / 1000 + 2, false), ws.src, stdin, runTimeoutMs(job), cfg.maxOutputBytes(), job, job.interactive);
    res.put("stdout", r.stdout());
    res.put("stderr", r.stderr());
    res.put("stdoutTruncated", r.stdoutTruncated());
    res.put("stderrTruncated", r.stderrTruncated());
    res.put("durationMs", r.durationMs());
    List<Map<String, Object>> issues = NativeReports.sanitizerReports(r.stderr(), srcPrefixes(ws));
    res.put("memoryIssues", issues);
    boolean leaksOnly = !issues.isEmpty() && issues.stream().allMatch(i -> "leak".equals(i.get("kind")));
    Integer code = r.timedOut() || r.cancelled() ? null : r.exitCode();
    res.put("exitCode", code);
    Map<String, Object> first = issues.stream().filter(i -> !"leak".equals(i.get("kind"))).findFirst().orElse(null);
    if (first != null) {
      Map<String, Object> ex = new LinkedHashMap<>();
      ex.put("type", first.get("tool") + ": " + first.get("kind"));
      ex.put("message", first.get("message"));
      if (first.get("file") != null) { ex.put("sourcePath", first.get("file")); ex.put("line", first.get("line")); }
      res.put("exception", ex);
    } else if (NativeReports.uncaughtException(r.stderr()) instanceof Map<?, ?> thrown) {
      /* Checked before signals: an uncaught exception ends in abort(), and the exception is what matters. */
      @SuppressWarnings("unchecked") Map<String, Object> m = (Map<String, Object>) thrown;
      res.put("exception", m);
    } else if (code != null && code > 128) {
      res.put("exception", Map.of("type", NativeReports.signalName(code - 128), "message", signalExplanation(code - 128)));
    }
    if (r.cancelled()) finish(job, res, "cancelled");
    else if (r.timedOut()) { res.put("error", "The program ran longer than " + cfg.runTimeoutMs() / 1000 + " seconds and was stopped."); finish(job, res, "timed_out"); }
    else if (first != null || (code != null && code != 0 && !(leaksOnly && code == 23))) finish(job, res, "runtime_error");
    else finish(job, res, "completed");
  }

  private static String signalExplanation(int sig) {
    return switch (sig) {
      case 11 -> "Segmentation fault: the program read or wrote memory it does not own, usually through a null, freed, or out-of-range pointer.";
      case 6 -> "The program aborted: an assert() failed, abort() was called, or the C library found corrupted memory.";
      case 8 -> "Arithmetic error: usually an integer division or remainder by zero.";
      case 7 -> "Bus error: a misaligned or invalid memory access.";
      case 9 -> "The program was killed, usually for using too much memory or time.";
      default -> "The program was stopped by signal " + sig + ".";
    };
  }

  static boolean isCSource(String p) { return p.endsWith(".c"); }
  static boolean isCppSource(String p) { return p.matches(".*\\.(cpp|cc|cxx)$"); }
  private static final Pattern NATIVE_MAIN = Pattern.compile("\\bint\\s+main\\s*\\(");

  /**
   * The sources of the program whose main() is in entry: sources in the entry's folder, and in its
   * subfolders unless a subfolder holds another main() (that is a separate program, such as another
   * example). Other files with their own main() are left out. Headers come in through include paths.
   */
  static List<String> nativeUnits(List<Workspace.SourceFile> files, String entry, boolean cpp) {
    String dir = entry.contains("/") ? entry.substring(0, entry.lastIndexOf('/') + 1) : "";
    Map<String, Boolean> hasMain = new java.util.TreeMap<>();
    for (Workspace.SourceFile f : files) {
      boolean src = cpp ? isCppSource(f.path()) : isCSource(f.path());
      if (src && f.path().startsWith(dir)) hasMain.put(f.path(), NATIVE_MAIN.matcher(Workspace.stripComments(f.content())).find());
    }
    java.util.Set<String> otherPrograms = new java.util.HashSet<>();
    hasMain.forEach((p, main) -> {
      String rest = p.substring(dir.length());
      if (main && !p.equals(entry) && rest.contains("/")) otherPrograms.add(dir + rest.substring(0, rest.indexOf('/') + 1));
    });
    List<String> units = new ArrayList<>();
    hasMain.forEach((p, main) -> {
      if (p.equals(entry) || (!main && otherPrograms.stream().noneMatch(p::startsWith))) units.add(p);
    });
    return units;
  }

  /** How source paths appear to the compiler and sanitizers (host path in process mode, /work/src in Docker). */
  private List<String> srcPrefixes(Workspace ws) {
    return List.of(path(ws, ws.src) + "/", ws.src.toString() + "/", ws.src.toAbsolutePath().normalize() + "/");
  }

  /*
   * Interactive runs wait for typing, so their wall-clock limit is longer (RUNNER_INTERACTIVE_TIMEOUT_MS,
   * 5 minutes by default). Their CPU-time limit is the usual one (set by isolate), so a busy loop still
   * stops after the normal run time of CPU.
   */
  private static final int INTERACTIVE_TIMEOUT_MS = parseIntOr(System.getenv("RUNNER_INTERACTIVE_TIMEOUT_MS"), 300_000);
  private static int parseIntOr(String s, int fallback) {
    try { return s == null ? fallback : Integer.parseInt(s.trim()); } catch (NumberFormatException e) { return fallback; }
  }
  private int runTimeoutMs(Job job) { return job.interactive ? INTERACTIVE_TIMEOUT_MS : cfg.runTimeoutMs(); }

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
