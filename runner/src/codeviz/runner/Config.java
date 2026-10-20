package codeviz.runner;

import java.nio.file.Path;

/** All runner settings come from environment variables with safe defaults. */
public record Config(
    String host,
    int port,
    String token,
    boolean requireSandbox,
    int maxConcurrent,
    int maxQueued,
    int runTimeoutMs,
    int traceTimeoutMs,
    int compileTimeoutMs,
    int maxSteps,
    int heapMb,
    int maxOutputBytes,
    int maxFiles,
    int maxSourceBytes,
    int maxStdinBytes,
    int ratePerMinute,
    Path workRoot,
    String javaBin,
    String isolation,
    String dockerImage) {

  static Config fromEnv() {
    return new Config(
        env("RUNNER_HOST", "127.0.0.1"),
        intEnv("RUNNER_PORT", 8787),
        System.getenv("RUNNER_TOKEN"),
        "1".equals(System.getenv("RUNNER_REQUIRE_SANDBOX")),
        intEnv("RUNNER_MAX_CONCURRENT", 2),
        intEnv("RUNNER_MAX_QUEUED", 16),
        intEnv("RUNNER_RUN_TIMEOUT_MS", 10_000),
        intEnv("RUNNER_TRACE_TIMEOUT_MS", 20_000),
        intEnv("RUNNER_COMPILE_TIMEOUT_MS", 20_000),
        intEnv("RUNNER_MAX_STEPS", 2_000),
        intEnv("RUNNER_HEAP_MB", 256),
        intEnv("RUNNER_MAX_OUTPUT_BYTES", 64 * 1024),
        intEnv("RUNNER_MAX_FILES", 64),
        intEnv("RUNNER_MAX_SOURCE_BYTES", 512 * 1024),
        intEnv("RUNNER_MAX_STDIN_BYTES", 64 * 1024),
        intEnv("RUNNER_RATE_PER_MINUTE", 30),
        Path.of(env("RUNNER_WORK_DIR", System.getProperty("java.io.tmpdir") + "/codeviz-runs")),
        Path.of(System.getProperty("java.home"), "bin", "java").toString(),
        env("RUNNER_ISOLATION", "process"),
        env("RUNNER_DOCKER_IMAGE", "codeviz-java-sandbox:21"));
  }

  private static String env(String k, String d) {
    String v = System.getenv(k);
    return v == null || v.isBlank() ? d : v;
  }

  private static int intEnv(String k, int d) {
    try { return Integer.parseInt(env(k, String.valueOf(d))); } catch (NumberFormatException e) { return d; }
  }
}
