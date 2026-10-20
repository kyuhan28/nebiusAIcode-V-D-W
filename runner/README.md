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

**Process mode is for running your own code on your own machine.** Programs get no network, their
own process tree, a cleared environment, and CPU, memory, and output limits, but **no filesystem
isolation**: a program can read and write any file the runner's user can, including `web/.env.local`
(where the NVIDIA key lives) and the runner's own files. Use Docker mode for anything shared, public,
or not written by you. The runner prints a reminder when it starts in process mode.

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

## Python programs

The runner also runs Python 3 with the real interpreter (CPython, not a reimplementation). A request
with `"language": "python"` (or a `mainClass` ending in `.py`) is a Python job; `mainClass` is then the
entry file's path, such as `examples/py_pascal/pascal_memo.py`.

- **Interpreter.** Docker mode uses the sandbox image's `python3`, Python 3.12 from Ubuntu 24.04
  (`eclipse-temurin:21-jdk-noble`). Process mode uses the host's `python3`, or `RUNNER_PYTHON` if
  set; 3.11 or newer is recommended (older versions work, with less exact class names in traces).
  `GET /v1/runtime` reports the version as `python.version`.
- **Steps.** `bin/pyrun.py` is copied into each job folder and does the work: `check` compiles every
  `.py` file and reports syntax errors as diagnostics (the Compile step), `run` executes the entry
  file, and `trace` records it with `sys.settrace` in the same trace format as Java (below).
- **Files and imports.** All project files keep their folders. The entry file's folder and the
  project root are on `sys.path`, so sibling modules and packages import as they would with
  `python main.py` run from the project folder. An entry file inside a package (folders with
  `__init__.py`) runs as that package's module, so relative imports work.
- **Input.** The program reads the request's `stdin` (the Input tab) through `input()` and
  `sys.stdin`; at the end of the input, `input()` raises `EOFError` as usual. Input is given in
  full before the run starts; it is not a live console, so prompts and answers are not interleaved.
- **Errors.** A crash gives Python's traceback on stderr (project-relative paths, the bootstrap's
  own frames removed) and `exception: { type, message, sourcePath, line, method }`.
- **Class model.** Run and trace results include `hierarchy` (see below), read from the real class
  objects after the run, so overrides follow Python's method resolution order.
- **Isolation.** Python runs in exactly the same sandbox as Java: the same container or namespace
  isolation, no network, a cleared environment (no runner token, no API keys), the same timeouts
  and output caps. `pyrun.py` also sets hard limits on memory (512 MB, 1 GB when tracing), CPU time,
  and file size that the program cannot raise. Problem tests (`mode: "test"`) are Java only.

What a Python trace records: every line about to run in project files, each call as its own frame
with its parameters and local variables (with their runtime types), return values, module-level
globals (as `statics`, keyed `module.name`), lists, tuples, dicts, sets, deques, and objects with
their attributes, `input()` calls, and the line of an uncaught exception. `self` is the receiver.
Not recorded: code in the standard library, conversions such as `int(text)` as separate input
events, values inside generators between yields (their steps are recorded, their returns are not),
and C-level internals. Long loops stop at the step limit like Java.

### Python compatibility, level by level

These are different things and are reported separately. Every line below was checked by
`tests/test_python_compat.py` (or `tests/test_python.py`) unless it says otherwise.

| Level | What is available |
| --- | --- |
| Language | Everything CPython 3.12 implements: it is the real interpreter, unmodified. Checked: `match`, the walrus operator, f-string specifiers, PEP 695 generics, dataclasses, enums, properties, operator overloading, multiple inheritance and the MRO, closures, `nonlocal`, decorators, generators and `yield from`, iterators, positional-only, keyword-only, `*args` and `**kwargs`, custom and chained exceptions, `except*` groups, context managers, ABCs, `__slots__`, class and static methods, typing (`TypedDict`, `Protocol`, annotations), `async`/`await`, async generators, comprehensions, slicing, unpacking, bitwise operators, `lru_cache`. |
| Built-ins | All of them, unchanged (the recorder wraps `input()` while tracing and calls the real one). Checked: about 90 built-ins, including `eval`, `exec`, `compile`, `help()` (prints to the output, no pager). |
| Standard library | The whole library that ships with Python 3.12. Checked: 100 modules import in the sandbox (math to `sqlite3`, `zoneinfo`, `asyncio`, `multiprocessing`, `tomllib`, `unittest`, `doctest`, `pdb`, ...), and about 50 of them are exercised. |
| Files | Programs run in their project folder and may read project files (data files such as `.csv`, `.json`, `.txt` can be part of a project) and create, change, and delete files there; `tempfile` and `HOME` point at the job's own tmp folder. Everything is removed when the run ends. Checked: text and binary files, encodings, `pathlib`, `csv`, `json`, an SQLite file, zip, tar, gzip, bz2, lzma, `shutil`, `glob`. |
| Concurrency | Threads, `queue`, thread and process pools, `multiprocessing.Pool`, and `asyncio` all run. Checked. |
| Third-party packages | Only what `python-requirements.txt` installs into the image (pinned). Checked at those versions: numpy, pandas, matplotlib, scipy, scikit-learn, sympy, networkx, Pillow, python-dateutil, requests (imports; requests cannot reach the network). Listed but not yet checked: pytest, tzdata. In process mode, packages are whatever the runner's Python has installed. |
| Sandbox restrictions | No network (sockets fail; `requests` raises `ConnectionError`), a cleared environment, no files outside the job folder in Docker mode (process mode has no filesystem isolation; see Process mode above), memory capped (`MemoryError`), CPU and wall time capped (the run is stopped), output capped, process count capped (Docker `--pids-limit 128`). matplotlib has no display: use `savefig`; `plt.show()` does nothing. Input is given before the run, not typed live. |
| Recording (Visualize) | What runs in project files: lines, calls and returns, frames, locals and types, module globals, lists, tuples, dicts, sets, deques, objects, numpy arrays (1-D and 2-D, first rows) and scalars, pandas Series and DataFrames (first rows and columns), `input()` calls, uncaught exceptions. Library code (standard or third-party) runs at full speed and is not recorded step by step. Only the main thread is recorded; other threads and child processes run but are not recorded, and in Visualize mode their printed output is not captured. Checked: a recorded run prints exactly what the normal run prints. |

**Adding a package.** Packages are installed when the sandbox image is built, never by user programs
and never while a program runs, so one project cannot change another's environment:

1. Add a pinned line to `runner/python-requirements.txt`, for example `beautifulsoup4==4.12.3`.
2. Rebuild the image: `docker build -t codeviz-java-sandbox:21 -f runner/sandbox.Dockerfile runner`.
   The image records what it installed in `/opt/codeviz/python-installed.txt`.
3. Add a check to `tests/test_python_compat.py` and run it.

`GET /v1/runtime` lists the installed packages and versions as `python.packages`. Importing a
package that is not installed gives the normal `ModuleNotFoundError` plus a note saying so.
Packages that need a display, a GPU, root, or the network will not work in the sandbox; packages
with native code work when their wheels support Linux x86-64 or arm64 (all of the above do). For a
smaller image, build with `--build-arg PY_REQUIREMENTS=<a shorter file>`. In process mode, install
packages into a virtual environment and point the runner at it:
`python3 -m venv .pyenv && .pyenv/bin/pip install -r python-requirements.txt`, then start the runner
with `RUNNER_PYTHON=$PWD/.pyenv/bin/python`.

After changing `bin/pyrun.py` or anything in `src/`, rebuild the sandbox image in Docker mode
(`docker build -t codeviz-java-sandbox:21 -f sandbox.Dockerfile .` or `docker compose --profile image build`).
In process mode `start.sh` picks up changes by itself.

## Trace format (version 2)

A `trace` result holds `steps`, one per recorded moment, plus `classes` (declared field and static
types per user class, from the class files) and the input-replay fields (`io`, `stdin`). The
visualizer reads only these facts; any recorder that emits them (a future Python tracer, for
example) gets the same frames, labels, and call stack.

| Step field | Meaning |
| --- | --- |
| `kind` | `line` (a line is about to run), `return` (a method is returning, its frame still on the stack), or `exception` |
| `line`, `sourcePath`, `cls`, `method` | Where execution is |
| `out` | Length of stdout so far, so output can be replayed in step |
| `stack` | User-code frames, innermost first, at most 16 |
| `stackDepth` | How many user frames there really were (more than `stack` holds in deep recursion) |
| `ret`, `retType` | On `return` steps: the value the JVM actually returned (`{ "t": "void" }` for void) and the declared return type |
| `statics` | Static fields of user classes, keyed `Class.field` (constants are skipped) |
| `heap` | Objects reachable from frames and statics, by id; `null` when unchanged since the last step |

| Frame field | Meaning |
| --- | --- |
| `id` | One per invocation: two calls of the same method, recursive or one after another, never share an id |
| `depth` | 0 for the outermost user frame |
| `locals` | Visible variables, plus `this` for instance methods |
| `args` | Parameter names, sent on the frame's first step only |
| `types` | Declared types of the visible variables (`java.util.Map<java.lang.String, java.lang.Integer>`), sent when they change |

Values are `{ "t": type, "v": value }` for primitives, boxed values, and strings, `{ "t": "null" }`,
or `{ "t": "ref", "id": "..." }` pointing into `heap`. Version 1 traces (no `id`, `types`, or `return`
steps) are still read; their frames are keyed by depth and their labels use runtime classes.

Frames also carry `sig`, the running method's JVM descriptor (`(I)V`), on their first step, so a
frame can be matched to one overload in the class model below.

### Class model (`hierarchy`)

Every clean compile, in any mode, adds `hierarchy` to the result: one entry per class, interface,
enum, or record, collected from javac's own analysis while it compiles (nothing is guessed from
file or class names). Each entry has `name` (binary name), `kind`, `abstract`, `file`, `line`,
`superclass`, `interfaces`, `fields`, and `methods`; each method has its `descriptor`, `params`,
`modifiers`, `line`, `implicit` (a constructor the compiler wrote), and `overrides`, the nearest
supertype method it overrides by javac's rules, as `binary.Class#name`. A failed compile sends no
`hierarchy`, so a diagram is never drawn from half-analyzed code.

Known limits: a frame unwound by an exception is retired at the next recorded step rather than at
the throw (the JVM sends no exit event for it); two variables with the same name in sibling blocks
of one method share a row; `long` values past 2^53 lose precision in the browser and are flagged;
NaN and infinities are recorded as non-finite without telling them apart.

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
python3 test_trace.py        # traces of sorting, objects, recursion, frames and returns, declared types, exceptions, limits
python3 test_python.py       # Python: output, input, errors, limits, imports, recording, sandbox boundaries
python3 test_python_compat.py  # Python compatibility: language, built-ins, stdlib, files, concurrency, packages, limits
python3 test_examples.py     # all 20 examples: exact output, no warnings, complete traces
python3 test_problems.py     # reference solutions pass; wrong ones fail for the right reasons
```

`test_docker_plumbing.py` checks Docker mode's commands and cleanup using `tests/fake-docker`,
a stand-in for the docker CLI. It verifies flags, path mapping, and container removal, but not
isolation itself; that needs real Docker. Problem test data comes from `gen_problems.py`.
