# codeviz

**An AI code visualizer, debugger, and writer for Java, Python, C, and C++.**

codeviz runs your program for real, in a sandbox, records every step, and lets you play the execution forward and backward. You can watch variables change, data structures take shape in 3D, call stacks grow and shrink, and (for C and C++) memory get allocated, pointed at, and freed. A built-in NVIDIA Nemotron assistant can explain code, find bugs, complete TODOs, and suggest fixes. It checks every suggestion with the real compiler before you apply it.

Everything you see comes from an actual run of your code. Nothing is simulated from the source text.

---

## Contents

- [Quick start](#quick-start)
- [Features](#features)
- [How it works](#how-it-works)
- [Configuration](#configuration)
- [The Nemotron assistant](#the-nemotron-assistant)
- [Security](#security)
- [Running the tests](#running-the-tests)
- [Troubleshooting](#troubleshooting)
- [Limitations](#limitations)
- [Project layout](#project-layout)

---

## Quick start

These steps work in GitHub Codespaces or on any Linux machine with Docker. On macOS or Windows, use Codespaces or a Linux VM. C/C++ recording needs Linux on x86-64.

### Prerequisites

- **Docker** (recommended; it provides the sandbox)
- **JDK 21 or newer**, to build and run the runner
- **Node.js 20.9 or newer** and npm, for the web app
- *Only for process mode without Docker:* `python3`, `gcc`, and `g++` on the machine itself

### 1. Build the sandbox image (once, and again after the Dockerfile changes)

```bash
docker build -t codeviz-java-sandbox:21 -f runner/sandbox.Dockerfile runner
```

### 2. Start the runner (terminal 1)

```bash
cd runner
RUNNER_ISOLATION=docker RUNNER_TOKEN=dev-token ./start.sh
```

`start.sh` rebuilds the runner whenever its source changed. You should see:

```
[runner] running build <number>
[runner] listening on http://127.0.0.1:8787 | ... | isolation docker
```

If it says `UNAVAILABLE`, see [Troubleshooting](#troubleshooting).

### 3. Start the web app (terminal 2)

```bash
cd web
printf 'RUNNER_URL=http://127.0.0.1:8787\nRUNNER_TOKEN=dev-token\n' >> .env.local
npm install
npm run dev
```

Open **http://localhost:3000/workspace**. In Codespaces, open the forwarded port 3000 and add `/workspace` to the URL.

> `RUNNER_TOKEN` must be the same in both terminals. `dev-token` is fine on your own machine. Use a long random string anywhere else.

### Alternative: run the runner with Docker Compose

```bash
cp runner/.env.example runner/.env        # then set RUNNER_TOKEN
docker compose --profile image build
docker compose up -d runner
```

The web app still runs separately with `npm run dev`.

---

## Features

### Languages

| | Runs on | Visualize (step-by-step) | Highlights |
|---|---|---|---|
| **Java** | JDK 21+ (`javac` + JVM) | Recorded through the JVM's debugger interface | Arrays and collections, linked structures, trees and graphs, inheritance and virtual dispatch, dynamic programming tables |
| **Python** | CPython 3.12 with numpy, pandas, matplotlib, scipy, scikit-learn, sympy, networkx, pillow | Recorded with `sys.settrace` | Lists, tuples, dicts, sets, matrices, NumPy arrays; values shown in Python notation |
| **C** | gcc 13, C17 | Recorded by a small `ptrace` debugger that reads the program's own DWARF debug info | **Memory tab**: stack frames, heap blocks, pointer arrows, `malloc`/`calloc`/`realloc`/`free` lifecycle, dangling pointers, leaks |
| **C++** | g++ 13, C++20 | Same recorder as C | Everything in C, plus object lifetime (constructors, copy and move, destructors), `unique_ptr`/`shared_ptr`/`weak_ptr` with real owner counts, `std::vector` size and capacity, `std::string` |

### In the workspace

- **Editor and file explorer** with multi-file projects, folders, right-click menus, and ZIP import.
- **Run and Visualize.** Run prints the output. Visualize records the run so you can step through it with playback controls (play, pause, step, seek, reset).
- **Views:** a 3D scene for arrays and data structures, a call-stack and variables panel, plus **Memory** (C/C++), **Inheritance**, and **Dynamic programming** tabs.
- **Memory checks on every C/C++ run.** AddressSanitizer, UndefinedBehaviorSanitizer, and LeakSanitizer report use-after-free, buffer overflows, double frees, leaks, and undefined behavior on the exact line, with a plain-language explanation in Problems.
- **Expected Output & Given Inputs.** Run the open file with an input, compare against an expected output, and ask Nemotron to explain any difference.
- **Example library** with ready-made programs in every language. Adding an example never touches your own files.

---

## How it works

```
┌──────────────┐   HTTP    ┌──────────────┐  one locked-down container per job  ┌──────────────┐
│  web (Next)  │ ────────▶ │    runner    │ ──────────────────────────────────▶ │   sandbox    │
│  editor, 3D  │ ◀──────── │  (Java HTTP  │ ◀────────────────────────────────── │ compile, run,│
│  views, AI   │  results  │   service)   │      output and recordings          │    record    │
└──────────────┘           └──────────────┘                                     └──────────────┘
       │
       └── NVIDIA Nemotron (server-side only; the API key never reaches the browser)
```

- **`web/`** is a Next.js 16 + React 19 + three.js app: the editor, the visualizations, and the server routes that talk to the runner and to NVIDIA.
- **`runner/`** is a small Java HTTP service. It receives your files, then compiles, runs, or records them inside a sandbox, and returns the output plus a step-by-step recording (the trace).
- **The sandbox** is a Docker image (`runner/sandbox.Dockerfile`) with a JDK, Python 3.12 with its packages, and gcc/g++. Every job gets a fresh container with no network, a read-only filesystem, no capabilities, and limits on memory, CPU, processes, and file size.

The recorders live in `runner/` too. `bin/pyrun.py` records Python, `bin/ctrace.py` records C and C++, and the Java recorder is built into the runner. The trace format is documented in [`runner/README.md`](runner/README.md).

---

## Configuration

### Web app (`web/.env.local`)

| Variable | Required | Purpose |
|---|---|---|
| `RUNNER_URL` | yes | Where the runner listens, e.g. `http://127.0.0.1:8787` |
| `RUNNER_TOKEN` | yes | Shared secret; must match the runner's |
| `NVIDIA_NEMOTRON_API_KEY` | for the AI assistant | Your NVIDIA API key (`nvapi-...`) |
| `NVIDIA_NEMOTRON_MODEL` | no | Preferred model; the app falls back through known Nemotron models and NVIDIA's live catalog |
| `NVIDIA_NEMOTRON_FALLBACK_MODELS` | no | Comma-separated extra models to try |
| `NVIDIA_NEMOTRON_TIMEOUT_MS` | no | Request timeout (default 90000) |
| `NVIDIA_API_BASE_URL` | no | Defaults to `https://integrate.api.nvidia.com/v1` |

`.env.local` is read by the server only. Never commit it.

### Runner (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `RUNNER_TOKEN` | *(none)* | Required: requests without it are refused |
| `RUNNER_ISOLATION` | `process` | `docker` (recommended) or `process` (see [Security](#security)) |
| `RUNNER_DOCKER_IMAGE` | `codeviz-java-sandbox:21` | Sandbox image for Docker mode |
| `RUNNER_HOST` / `RUNNER_PORT` | `127.0.0.1` / `8787` | Where the runner listens |
| `RUNNER_RUN_TIMEOUT_MS` | `10000` | Wall-clock limit for a run |
| `RUNNER_TRACE_TIMEOUT_MS` | `20000` | Limit for a recording |
| `RUNNER_COMPILE_TIMEOUT_MS` | `20000` | Limit for compiling |
| `RUNNER_MAX_STEPS` | `2000` | Steps recorded per program |
| `RUNNER_MAX_CONCURRENT` / `RUNNER_MAX_QUEUED` | `2` / `16` | Jobs at once / waiting |
| `RUNNER_RATE_PER_MINUTE` | `30` | Executions per client per minute |
| `RUNNER_MAX_OUTPUT_BYTES` | `65536` | Output kept per run |
| `RUNNER_WORK_DIR` | `/tmp/codeviz-runs` | Temporary job folders |

The complete list, including file and input size limits, is in [`runner/README.md`](runner/README.md#configuration).

---

## The Nemotron assistant

Open it with the green button in the bottom-right corner of the workspace. It works on the file you have open, in that file's language. The panel says exactly which language and file it is writing for before anything is sent.

**Actions:** Complete the TODO, Explain this code, Find the bug, Suggest a fix, Explain the compiler error, Improve or refactor, Generate tests, Explain the algorithm step by step, complexity and edge-case questions, and free-form questions.

**How a suggestion reaches your code:**

1. The browser sends the open file (including unsaved edits) and up to 6 related files: headers it `#include`s, modules it imports, and same-folder sources. It also sends evidence from the last run of *this* program: errors, exceptions, and sanitizer findings.
2. The server tells the model which language and toolchain it is writing for, and accepts code back only in that language.
3. The suggestion is **compiled (or syntax-checked) in the sandbox** before you see an Apply button. If it fails, you see the real compiler errors and can send them back to Nemotron, at most twice.
4. Nothing changes until you review the diff and apply it, and Undo restores your version.

Get an API key at [build.nvidia.com](https://build.nvidia.com) and put it in `web/.env.local` as `NVIDIA_NEMOTRON_API_KEY`. The key stays on the server: it is never sent to the browser, written to logs, or passed into sandboxes.

---

## Security

codeviz runs code that users type, which for C and C++ means native code. Choose the isolation mode accordingly.

**Docker mode (`RUNNER_ISOLATION=docker`, recommended).** Each compile, run, and recording happens in a fresh container started from the sandbox image, with:

- no network (`--network none`)
- a read-only root filesystem and a 64 MB writable `/tmp`
- all Linux capabilities dropped, `no-new-privileges`, and a non-root user
- limits on memory, CPU (1 core, plus a CPU-time cap), processes (128), file size (8 MB), and open files (256)
- only that job's own folder mounted; no secrets and no other workspace files

**Process mode (the default when Docker isn't set up)** uses Linux namespaces and resource limits, but **it does not isolate the filesystem**. A program can read files the runner's user can read. Use it only on your own machine with your own code. Never expose a process-mode runner to other people.

In both modes:

- The runner listens on `127.0.0.1` and requires `RUNNER_TOKEN`.
- Every C and C++ run is checked by the sanitizers, so memory errors are stopped instead of continuing as undefined behavior.

Before deploying publicly, put the web app behind authentication, keep Docker mode on, and add monitoring.

---

## Running the tests

Start the runner first (Docker or process mode), then pass the same token to the tests:

```bash
cd runner/tests
export RUNNER_TOKEN=dev-token     # the tests default to "devtoken"; match your runner
python3 test_basic.py             # compile and run basics
python3 test_trace.py             # Java recording
python3 test_python.py            # Python running and recording
python3 test_native.py            # C and C++: compiling, sanitizers, recording, memory, C++ lifetime
python3 test_examples.py          # every example in the library
python3 test_security.py          # sandbox limits
python3 test_programs.py          # 39 programs; saves recordings for the web checks below
```

Web-side checks (no runner needed once the recordings exist):

```bash
cd web
npx tsx tests/visual-check.ts               # what the visualizer shows (uses test_programs.py's recordings)
npx tsx tests/python-collections-check.ts   # Python lists, matrices, dicts, sets, NumPy (fixtures included)
```

---

## Troubleshooting

**`isolation docker (UNAVAILABLE: The runner could not check that Docker can see its work directory: /tmp/codeviz-runs/...)`**
The work folder is owned by `root`, usually because something ran with `sudo`, or because Docker created the folder for a bind mount. Fix it, then start the runner **without** `sudo`:

```bash
sudo rm -rf /tmp/codeviz-runs
```

**`Docker cannot see files in the runner's work directory`**
The Docker daemon runs somewhere other than the runner (for example, a remote daemon). Run the runner where the daemon is, or use Docker Compose.

**"Runner offline" in the web app**
Check that terminal 1 is still running, and that `RUNNER_URL` and `RUNNER_TOKEN` in `web/.env.local` match the runner. Restart `npm run dev` after editing `.env.local`.

**`Module not found` when starting the web app**
Run `npm install` in `web/`; a dependency was added since your last install.

**C or C++ Visualize says recording isn't available, or fails in Docker**
The C/C++ recorder needs Linux on x86-64 and permission to `ptrace` its own child process. That permission is allowed by Docker's default security profile on current Docker versions.

**The sandbox image is missing or outdated**
Rebuild it with `docker build -t codeviz-java-sandbox:21 -f runner/sandbox.Dockerfile runner`.

---

## Limitations

- Recordings stop after `RUNNER_MAX_STEPS` steps (2000 by default) and record the main thread only.
- Input is given before the run, not typed live.
- Library internals (JDK classes, NumPy's C code, the C/C++ standard library) are not recorded step by step.
- C/C++ recording needs Linux x86-64 and unoptimized builds (the runner builds with `-O0`). Node-based containers (`map`, `set`, `list`, unordered ones) show their size but not their elements. Trivial compiler-generated constructors are not visible.
- Problem tests (graded exercises) are Java-only.

---

## Project layout

```
.
├── compose.yaml               # optional: run the runner itself in Docker
├── runner/                    # the execution service (Java)
│   ├── src/codeviz/runner/    # HTTP server, jobs, sandboxing, Java recorder, C/C++ reports
│   ├── bin/
│   │   ├── pyrun.py           # Python runner and recorder
│   │   ├── ctrace.py          # C/C++ recorder (ptrace + DWARF)
│   │   └── cvmem.*            # allocation log linked into C/C++ recordings
│   ├── sandbox.Dockerfile     # the sandbox image: JDK, Python 3.12 + packages, gcc/g++
│   ├── start.sh / build.sh    # start (rebuilding when needed) / build
│   ├── tests/                 # end-to-end test suites
│   └── README.md              # runner details: API, trace format, configuration
└── web/                       # the Next.js app
    ├── app/                   # pages and API routes (runner proxy, AI assistant)
    ├── components/workspace/  # editor, explorer, visualizers, memory view, assistant
    ├── lib/trace/             # turns recordings into what the views draw
    ├── lib/three/             # the 3D scenes
    ├── lib/ai/                # language profiles for the assistant
    ├── lib/server/            # server-only code (runner client, Nemotron)
    ├── public/examples/       # the example library
    └── tests/                 # visualizer checks against real recordings
```
