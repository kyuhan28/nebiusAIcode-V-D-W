# codeviz Java runner

Compiles, runs, traces, and tests untrusted Java for the codeviz workspace. It is a small HTTP
service built on the JDK alone (no build tool, no libraries) and it never runs user code in its
own process.

**Java:** OpenJDK 21 LTS, using the JDK's real compiler and a real JVM per program. The version
is reported by `GET /v1/runtime` and shown in the workspace toolbar.

## Two isolation modes

| Mode | Set with | Each job runs in | Use it for |
| --- | --- | --- | --- |
| Process (default) | nothing | a separate limited JVM, in new user, network, and PID namespaces when the host allows | quick local development |
| Docker | `RUNNER_ISOLATION=docker` | its own short-lived container from the sandbox image | anything others can reach |

In Docker mode every compile, run, trace, and test container gets `--network none`,
`--read-only` with a small `/tmp` tmpfs, a non-root user (10001), `--cap-drop ALL`,
`no-new-privileges`, memory and swap caps, one CPU, a 128-process limit, CPU-time, file-size, and
open-file limits, and only its own job directory mounted at `/work`. Containers are named and
labeled, so Stop and timeouts run `docker rm -f` on them, and leftovers are removed at startup.
If Docker mode is configured but Docker is unavailable, the runner refuses executions with
`503 docker_unavailable`. It never falls back to process mode on its own.

## Start it

### Process mode

```bash
cd runner
RUNNER_TOKEN=dev-token ./start.sh
```

### Docker mode (recommended once Docker works)

From the repo root:

```bash
docker build -t codeviz-java-sandbox:21 -f runner/sandbox.Dockerfile runner
cd runner
RUNNER_ISOLATION=docker RUNNER_TOKEN=dev-token ./start.sh
```

The runner prints `isolation docker (ready, image codeviz-java-sandbox:21)` when it is working.
Rebuild the sandbox image after changing anything in `src/`.

### Docker Compose (runner in a container too)

```bash
cp runner/.env.example runner/.env          # then set RUNNER_TOKEN
docker compose --profile image build        # sandbox image + runner image
docker compose up -d runner
docker compose logs -f runner
docker compose down
```

The runner container holds the Docker socket so it can start sandboxes; it is trusted code.
Sandbox containers never get the socket or any host mount besides their job directory.

In every mode, point the web app at the runner in `web/.env.local`:

```
RUNNER_URL=http://127.0.0.1:8787
RUNNER_TOKEN=dev-token
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/runtime` | Java version, compiler, isolation level, Docker status, limits |
| POST | `/v1/executions` | `{ mode, files: [{ path, content }], mainClass?, stdin?, tests? }` returns `202 { id, status }` |
| GET | `/v1/executions/{id}` | Status; includes `result` once finished |
| POST | `/v1/executions/{id}/cancel` | Stops the real process or container |
| GET | `/healthz` | Liveness |

Modes: `compile`, `run`, `trace` (line-by-line recording for the visualizer), and `test`
(compile once, run each `{ id, stdin }` in its own JVM or container, up to 25 tests). The runner
only executes tests; the web server compares outputs, so hidden expected answers never leave it.

Statuses: `queued`, `compiling`, `running`, then `completed`, `compile_failed`, `runtime_error`,
`timed_out`, `cancelled`, or `failed`. Errors look like `{ error: { code, message } }`.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `RUNNER_HOST` / `RUNNER_PORT` | `127.0.0.1` / `8787` | Listen address |
| `RUNNER_TOKEN` | none | Shared secret with the web app |
| `RUNNER_ISOLATION` | `process` | `docker` for per-job containers |
| `RUNNER_DOCKER_IMAGE` | `codeviz-java-sandbox:21` | Sandbox image for Docker mode |
| `RUNNER_REQUIRE_SANDBOX` | off | `1` refuses process mode without full isolation |
| `RUNNER_MAX_CONCURRENT` / `RUNNER_MAX_QUEUED` | `2` / `16` | Parallel jobs; queue depth before `503 busy` |
| `RUNNER_RUN_TIMEOUT_MS` / `RUNNER_TRACE_TIMEOUT_MS` | `10000` / `20000` | Wall-clock limits (tests: 5 s each) |
| `RUNNER_MAX_STEPS` | `2000` | Trace length limit |
| `RUNNER_HEAP_MB` | `256` | Heap for user programs |
| `RUNNER_RATE_PER_MINUTE` | `30` | Runs per client per minute |

## Security notes

- Users cannot pass JVM arguments, commands, images, or paths outside their project. Paths,
  sizes, file counts, and stdin are validated before anything is queued.
- Docker is one layer of defense, not a guarantee. For hostile multi-tenant use, run the runner
  on its own VM and consider gVisor (`--runtime=runsc`) for the sandbox containers.
- Process mode on hosts without user namespaces reports `partial` and does not isolate the
  network. Set `RUNNER_REQUIRE_SANDBOX=1` anywhere that matters.
- Java's Security Manager is deprecated and not used.

## Tests

With a runner on port 8787 and `RUNNER_TOKEN=devtoken`:

```bash
cd runner/tests
python3 test_basic.py        # output, diagnostics, exceptions, packages, entry points, stdin
python3 test_security.py     # timeouts, stop, caps, paths, memory, network, files, processes, rate limits
python3 test_trace.py        # traces of sorting, objects, recursion, collections, exceptions, limits
python3 test_examples.py     # all 20 examples: exact output, no warnings, complete traces
python3 test_problems.py     # reference solutions pass; wrong ones fail for the right reasons
```

`test_docker_plumbing.py` checks Docker mode's commands and cleanup using `tests/fake-docker`,
a stand-in for the docker CLI. It verifies flags, path mapping, and container removal, but not
isolation itself; that needs real Docker. Problem test data comes from `gen_problems.py`.
