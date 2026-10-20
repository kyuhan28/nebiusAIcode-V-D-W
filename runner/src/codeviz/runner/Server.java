package codeviz.runner;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import javax.tools.ToolProvider;

/**
 * The codeviz Java runner: a small HTTP service that compiles and runs untrusted Java in
 * separate, resource-limited JVMs. It never runs user code in its own process.
 */
public final class Server {
  private static final Set<String> MODES = Set.of("compile", "run", "trace", "test");
  private static final int MAX_TESTS = 25;
  private static final int MAX_BODY = 1024 * 1024;
  private static final long RETAIN_MS = 10 * 60 * 1000;

  private final Config cfg;
  private final Sandbox sandbox;
  private final Docker docker;
  private final Executor executor;
  private final ThreadPoolExecutor pool;
  private final Map<String, Job> jobs = new ConcurrentHashMap<>();
  private final Map<String, long[]> buckets = new ConcurrentHashMap<>();

  Server(Config cfg, Sandbox sandbox, Docker docker) {
    this.cfg = cfg;
    this.sandbox = sandbox;
    this.docker = docker;
    this.executor = new Executor(cfg, sandbox, docker != null && docker.ready ? docker : null);
    this.pool = new ThreadPoolExecutor(cfg.maxConcurrent(), cfg.maxConcurrent(), 30, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(cfg.maxQueued()));
  }

  public static void main(String[] args) throws Exception {
    Config cfg = Config.fromEnv();
    Path home = runnerHome();
    Sandbox sandbox = Sandbox.probe(home);
    Docker docker = null;
    if (cfg.isolation().equals("docker")) {
      docker = Docker.probe(cfg.dockerImage(), cfg.workRoot());
      if (docker.ready) docker.sweep();
      else System.err.println("[runner] RUNNER_ISOLATION=docker but Docker is unavailable: " + docker.problem + " Executions will be refused until this is fixed and the runner restarts.");
      new Server(cfg, sandbox, docker).start();
      return;
    }
    if (cfg.requireSandbox() && !sandbox.level().equals("full") && !sandbox.level().equals("container")) {
      System.err.println("[runner] RUNNER_REQUIRE_SANDBOX=1 but this host cannot isolate network and limit resources. Refusing to start.");
      System.exit(2);
    }
    new Server(cfg, sandbox, null).start();
  }

  /** The runner's install directory: RUNNER_HOME, or the nearest parent of the classes that holds bin/. */
  static Path runnerHome() throws Exception {
    String env = System.getenv("RUNNER_HOME");
    if (env != null && !env.isBlank()) return Path.of(env);
    Path p = Path.of(Server.class.getProtectionDomain().getCodeSource().getLocation().toURI());
    for (int i = 0; i < 4 && p != null; i++, p = p.getParent()) {
      if (java.nio.file.Files.exists(p.resolve("bin/netns-exec.py"))) return p;
    }
    return Path.of(".");
  }

  void start() throws IOException {
    HttpServer http = HttpServer.create(new InetSocketAddress(cfg.host(), cfg.port()), 64);
    http.setExecutor(Executors.newFixedThreadPool(8));
    http.createContext("/", this::route);
    http.start();
    Executors.newSingleThreadScheduledExecutor().scheduleAtFixedRate(this::expire, 1, 1, TimeUnit.MINUTES);
    System.out.println("[runner] listening on http://" + cfg.host() + ":" + cfg.port()
        + " | Java " + Runtime.version() + " | "
        + (docker != null ? "isolation docker (" + (docker.ready ? "ready, image " + docker.image + ", Java " + docker.javaVersion : "UNAVAILABLE: " + docker.problem) + ")"
            : "sandbox " + sandbox.level() + (sandbox.level().equals("partial") ? " (network isolation unavailable on this host)" : "")));
  }

  /* ---------------- Routing ---------------- */

  private void route(HttpExchange ex) throws IOException {
    try {
      String path = ex.getRequestURI().getPath();
      String method = ex.getRequestMethod();
      if (path.equals("/healthz")) { send(ex, 200, Map.of("ok", true)); return; }
      if (!authorized(ex)) { error(ex, 401, "unauthorized", "Missing or invalid runner token."); return; }

      if (path.equals("/v1/runtime") && method.equals("GET")) { send(ex, 200, runtime()); return; }
      if (path.equals("/v1/executions") && method.equals("POST")) { create(ex); return; }
      if (path.startsWith("/v1/executions/")) {
        String[] parts = path.substring("/v1/executions/".length()).split("/");
        Job job = jobs.get(parts[0]);
        if (job == null) { error(ex, 404, "not_found", "That execution does not exist or has expired."); return; }
        if (parts.length == 1 && method.equals("GET")) { send(ex, 200, view(job)); return; }
        if (parts.length == 2 && parts[1].equals("cancel") && method.equals("POST")) {
          job.cancel();
          if (job.status.equals("queued")) {
            job.status = "cancelled";
            job.finishedAt = System.currentTimeMillis();
          }
          send(ex, 202, view(job));
          return;
        }
      }
      error(ex, 404, "not_found", "Unknown endpoint.");
    } catch (Exception e) {
      System.err.println("[runner] request failed: " + e);
      error(ex, 500, "internal", "The runner could not handle this request.");
    } finally {
      ex.close();
    }
  }

  private boolean authorized(HttpExchange ex) {
    if (cfg.token() == null || cfg.token().isBlank()) return true;
    String h = ex.getRequestHeaders().getFirst("Authorization");
    return h != null && constantTimeEquals(h, "Bearer " + cfg.token());
  }

  private static boolean constantTimeEquals(String a, String b) {
    byte[] x = a.getBytes(StandardCharsets.UTF_8);
    byte[] y = b.getBytes(StandardCharsets.UTF_8);
    return java.security.MessageDigest.isEqual(x, y);
  }

  /* ---------------- Endpoints ---------------- */

  private Map<String, Object> runtime() {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("javaVersion", docker != null && docker.javaVersion != null ? docker.javaVersion : Runtime.version().toString());
    m.put("javaVendor", System.getProperty("java.vendor"));
    m.put("runtimeName", System.getProperty("java.runtime.name"));
    m.put("compilerAvailable", ToolProvider.getSystemJavaCompiler() != null);
    Map<String, Object> sb = new LinkedHashMap<>();
    if (docker != null) {
      Map<String, Object> d = new LinkedHashMap<>();
      d.put("ready", docker.ready);
      d.put("image", docker.image);
      d.put("serverVersion", docker.serverVersion);
      d.put("problem", docker.problem);
      d.put("javaVersion", docker.javaVersion);
      m.put("docker", d);
    }
    sb.put("level", docker != null ? (docker.ready ? "docker" : "unavailable") : sandbox.level());
    sb.put("networkIsolated", sandbox.networkBlocked());
    sb.put("traceNetworkIsolated", sandbox.traceIsolated());
    sb.put("resourceLimits", sandbox.prlimit);
    sb.put("container", sandbox.container);
    m.put("sandbox", sb);
    Map<String, Object> lim = new LinkedHashMap<>();
    lim.put("runTimeoutMs", cfg.runTimeoutMs());
    lim.put("traceTimeoutMs", cfg.traceTimeoutMs());
    lim.put("heapMb", cfg.heapMb());
    lim.put("maxSteps", cfg.maxSteps());
    lim.put("maxOutputBytes", cfg.maxOutputBytes());
    lim.put("maxFiles", cfg.maxFiles());
    lim.put("maxSourceBytes", cfg.maxSourceBytes());
    lim.put("maxStdinBytes", cfg.maxStdinBytes());
    m.put("limits", lim);
    m.put("modes", MODES);
    return m;
  }

  private void create(HttpExchange ex) throws IOException {
    String client = ex.getRequestHeaders().getFirst("X-Codeviz-Client");
    if (client == null || client.isBlank()) client = ex.getRemoteAddress().getAddress().getHostAddress();
    if (!allow(client)) { error(ex, 429, "rate_limited", "Too many runs in a short time. Wait a moment and try again."); return; }

    Map<?, ?> body;
    try {
      String text = readBody(ex.getRequestBody());
      if (!(Json.parse(text) instanceof Map<?, ?> m)) throw new IllegalArgumentException("Body must be a JSON object");
      body = m;
    } catch (IllegalArgumentException e) {
      error(ex, 400, "bad_request", e.getMessage());
      return;
    }
    if (docker != null && !docker.ready) {
      error(ex, 503, "docker_unavailable", "Docker isolation is configured but unavailable: " + docker.problem);
      return;
    }
    String mode = body.get("mode") instanceof String s ? s : "run";
    if (!MODES.contains(mode)) { error(ex, 400, "bad_mode", "mode must be compile, run, trace, or test."); return; }
    if (cfg.requireSandbox() && mode.equals("trace") && !sandbox.traceIsolated()) {
      error(ex, 503, "sandbox_unavailable", "Tracing needs network isolation, which this host cannot provide.");
      return;
    }
    String stdin = body.get("stdin") instanceof String s ? s : "";
    if (stdin.getBytes(StandardCharsets.UTF_8).length > cfg.maxStdinBytes()) {
      error(ex, 413, "stdin_too_large", "Program input is limited to " + cfg.maxStdinBytes() / 1024 + " KB.");
      return;
    }
    Executor.Request req;
    try {
      List<Workspace.SourceFile> files = Workspace.fromRequest(body.get("files"));
      Workspace.validate(cfg, files);
      List<Executor.TestCase> tests = List.of();
      if (mode.equals("test")) {
        if (!(body.get("tests") instanceof List<?> raw) || raw.isEmpty() || raw.size() > MAX_TESTS)
          throw new RunnerException(400, "bad_tests", "test mode needs 1 to " + MAX_TESTS + " tests of { id, stdin }.");
        List<Executor.TestCase> list = new java.util.ArrayList<>();
        long total = 0;
        for (Object o : raw) {
          if (!(o instanceof Map<?, ?> m) || !(m.get("id") instanceof String id) || !(m.get("stdin") instanceof String in))
            throw new RunnerException(400, "bad_tests", "Each test needs a string id and stdin.");
          total += in.length();
          list.add(new Executor.TestCase(id, in));
        }
        if (total > 512 * 1024) throw new RunnerException(413, "tests_too_large", "Test inputs are limited to 512 KB in total.");
        tests = list;
      }
      req = new Executor.Request(mode, files, body.get("mainClass") instanceof String s ? s : null, stdin, tests);
    } catch (RunnerException e) {
      error(ex, e.status, e.code, e.getMessage());
      return;
    }
    Job job = new Job(mode);
    try {
      pool.execute(() -> {
        if (job.cancelRequested()) return;
        executor.execute(job, req);
      });
    } catch (RejectedExecutionException e) {
      error(ex, 503, "busy", "The runner is busy. Try again in a few seconds.");
      return;
    }
    jobs.put(job.id, job);
    send(ex, 202, view(job));
  }

  private Map<String, Object> view(Job job) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", job.id);
    m.put("mode", job.mode);
    m.put("status", job.status);
    m.put("createdAt", job.createdAt);
    m.put("startedAt", job.startedAt == 0 ? null : job.startedAt);
    m.put("finishedAt", job.finishedAt == 0 ? null : job.finishedAt);
    if (job.finished() && job.result != null) m.put("result", job.result);
    return m;
  }

  /* ---------------- Limits and housekeeping ---------------- */

  /** A token bucket per client: `ratePerMinute` runs, refilling continuously. */
  private boolean allow(String client) {
    long now = System.currentTimeMillis();
    double rate = cfg.ratePerMinute() / 60_000.0;
    long[] b = buckets.computeIfAbsent(client, k -> new long[] {cfg.ratePerMinute() * 1000L, now});
    synchronized (b) {
      double tokens = Math.min(cfg.ratePerMinute() * 1000.0, b[0] + (now - b[1]) * rate * 1000);
      b[1] = now;
      if (tokens < 1000) { b[0] = (long) tokens; return false; }
      b[0] = (long) (tokens - 1000);
      return true;
    }
  }

  private void expire() {
    long now = System.currentTimeMillis();
    jobs.values().removeIf(j -> j.finished() && now - j.finishedAt > RETAIN_MS);
    buckets.entrySet().removeIf(e -> now - e.getValue()[1] > RETAIN_MS);
  }

  private static String readBody(InputStream in) throws IOException {
    byte[] data = in.readNBytes(MAX_BODY + 1);
    if (data.length > MAX_BODY) throw new IllegalArgumentException("Request body is larger than 1 MB.");
    return new String(data, StandardCharsets.UTF_8);
  }

  private static void error(HttpExchange ex, int status, String code, String message) throws IOException {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("error", Map.of("code", code, "message", message));
    send(ex, status, m);
  }

  private static void send(HttpExchange ex, int status, Object body) throws IOException {
    byte[] bytes = Json.write(body).getBytes(StandardCharsets.UTF_8);
    ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
    ex.getResponseHeaders().set("Cache-Control", "no-store");
    ex.sendResponseHeaders(status, bytes.length);
    try (OutputStream os = ex.getResponseBody()) {
      os.write(bytes);
    }
  }
}
