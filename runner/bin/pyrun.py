#!/usr/bin/env python3
"""
codeviz Python bootstrap. Runs inside the same sandbox as Java programs (process isolation or a
Docker container); the runner copies it into each job folder.

  pyrun.py check SRC                        syntax-check every .py file, print one JSON line
  pyrun.py run   SRC ENTRY RESULT           run ENTRY with the real stdin and stdout
  pyrun.py trace SRC ENTRY REQUEST RESULT   record ENTRY step by step, write the trace as JSON

The trace uses the same format as the Java tracer (TraceMain), so every visualizer reads it as is:
one step per line about to run, a "return" step with the real value as a function returns, frames
with their own ids, locals with their runtime types, module globals, and a heap of the objects
reachable from them. Nothing is simulated: this is the real interpreter, observed through
sys.settrace.
"""
import builtins
import collections
import inspect
import io
import json
import math
import os
import sys
import time
import traceback
import types

MAX_FRAMES = 16
MAX_OBJECTS = 200
MAX_ITEMS = 256
MAX_STRING = 300
MAX_STATICS = 24
SKIP_RETURNS = {"<module>", "<lambda>", "<listcomp>", "<dictcomp>", "<setcomp>", "<genexpr>"}
CO_GENERATOR_LIKE = 0x20 | 0x100 | 0x200  # generator, coroutine, async generator


def limit_resources(memory_mb, cpu_seconds):
    """Defense in depth inside the sandbox: hard caps the program cannot raise again."""
    try:
        import resource
        mem = memory_mb * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds + 1))
        resource.setrlimit(resource.RLIMIT_FSIZE, (32 * 1024 * 1024, 32 * 1024 * 1024))
    except Exception:
        pass


def setup_environment(src):
    """A normal environment for normal programs, kept inside the job: home and temporary files go to
    the job's tmp folder (removed afterwards), matplotlib draws without a display, and math libraries
    use one thread, matching the sandbox's CPU share."""
    tmp = os.path.join(os.path.dirname(src), "tmp")
    if not os.path.isdir(tmp):
        tmp = os.path.join(src, ".tmp")
        os.makedirs(tmp, exist_ok=True)
    mpl = os.path.join(tmp, "matplotlib")
    os.environ.update({
        "TMPDIR": tmp, "TEMP": tmp, "TMP": tmp, "HOME": tmp,
        "MPLBACKEND": "Agg", "MPLCONFIGDIR": mpl,
        "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1", "MKL_NUM_THREADS": "1", "NUMEXPR_MAX_THREADS": "1",
        "PYTHONIOENCODING": "utf-8",
    })
    # A font cache built into the image saves matplotlib a slow first-use scan; each job gets its own copy.
    prebuilt = "/opt/codeviz/mpl-cache"
    if os.path.isdir(prebuilt):
        try:
            import shutil
            shutil.copytree(prebuilt, mpl, dirs_exist_ok=True)
        except Exception:
            pass


def user_files(src):
    out = set()
    for base, dirs, files in os.walk(src):
        for f in files:
            if f.endswith(".py"):
                out.add(os.path.realpath(os.path.join(base, f)))
    return out


def rel(path, src):
    try:
        r = os.path.relpath(os.path.realpath(path), src)
        return r.replace(os.sep, "/") if not r.startswith("..") else path
    except Exception:
        return path


def package_module(entry, src):
    """The dotted module name when ENTRY sits inside packages (folders with __init__.py), else None."""
    parts = []
    d = os.path.dirname(entry)
    while os.path.realpath(d) != src and os.path.isfile(os.path.join(d, "__init__.py")):
        parts.insert(0, os.path.basename(d))
        d = os.path.dirname(d)
    if not parts or os.path.realpath(d) != src:
        return None
    return ".".join(parts + [os.path.splitext(os.path.basename(entry))[0]])


def prepare_paths(src, entry):
    """Imports resolve like `python ENTRY` run from the project folder: the entry's folder first, then the project root."""
    here = os.path.dirname(os.path.realpath(__file__))
    rest = [p for p in sys.path[1:] if p and os.path.realpath(p) != here]
    sys.path[:] = [os.path.dirname(entry), src] + rest
    os.chdir(src)


def run_entry(src, entry):
    """Executes the entry file as __main__ and returns its globals (for the class model afterwards)."""
    module = package_module(entry, src)
    if module:
        import runpy
        sys.path[0] = src
        return runpy.run_module(module, run_name="__main__", alter_sys=True)
    with open(entry, "rb") as fh:
        code = compile(fh.read(), entry, "exec", dont_inherit=True)
    main = types.ModuleType("__main__")
    main.__file__ = entry
    main.__builtins__ = builtins
    sys.modules["__main__"] = main
    sys.argv = [entry]
    exec(code, main.__dict__)
    return main.__dict__


def short_traceback(exc, src, userset):
    """The traceback as Python prints it, without this bootstrap's frames and with project-relative paths."""
    frames = [f for f in traceback.extract_tb(exc.__traceback__) if os.path.realpath(f.filename) in userset]
    lines = ["Traceback (most recent call last):\n"] if frames else []
    for f in frames:
        lines.append(f'  File "{rel(f.filename, src)}", line {f.lineno}, in {f.name}\n')
        if f.line:
            lines.append(f"    {f.line.strip()}\n")
    lines.extend(traceback.format_exception_only(type(exc), exc))
    if isinstance(exc, ModuleNotFoundError) and exc.name:
        top = exc.name.split(".")[0]
        local = os.path.exists(os.path.join(src, top + ".py")) or os.path.isdir(os.path.join(src, top))
        if top not in getattr(sys, "stdlib_module_names", ()) and not local:
            lines.append(f"\nNote: the package '{top}' is not installed in this runner. Installed packages are listed in "
                         "runner/python-requirements.txt; add it there and rebuild the sandbox image (Docker mode), "
                         "or install it into the runner's Python (process mode).\n")
    return "".join(lines)


def describe_exception(exc, src, userset):
    info = {"type": type(exc).__name__, "message": str(exc) or None}
    if isinstance(exc, SyntaxError) and exc.filename and os.path.realpath(exc.filename) in userset:
        info.update(sourcePath=rel(exc.filename, src), line=exc.lineno, method="<module>")
        return info
    for f in reversed(traceback.extract_tb(exc.__traceback__)):
        if os.path.realpath(f.filename) in userset:
            info.update(sourcePath=rel(f.filename, src), line=f.lineno, method=f.name)
            break
    return info


# ---------------------------------------------------------------- class model

def qualname(cls):
    return f"{cls.__module__}.{cls.__qualname__}"


def class_model(namespaces, src, userset):
    """Every class defined in the project, from the real class objects after the run: bases, the
    method resolution order, and which method overrides which."""
    import ast
    found = {}
    for ns in namespaces:
        for value in list(ns.values()):
            if not isinstance(value, type) or qualname(value) in found:
                continue
            try:
                path = inspect.getsourcefile(value)
            except (TypeError, OSError):
                continue
            if not path or os.path.realpath(path) not in userset:
                continue
            found[qualname(value)] = value
    out = []
    for name, cls in found.items():
        bases = [b for b in cls.__bases__ if b is not object]
        try:
            line = inspect.getsourcelines(cls)[1]
        except (OSError, TypeError):
            line = None
        methods = []
        for attr, raw in cls.__dict__.items():
            fn = raw.__func__ if isinstance(raw, (staticmethod, classmethod)) else raw
            if not inspect.isfunction(fn):
                continue
            params = [p for i, p in enumerate(inspect.signature(fn).parameters) if not (i == 0 and p in ("self", "cls") and not isinstance(raw, staticmethod))]
            overrides = None
            for base in cls.__mro__[1:]:
                if base is object:
                    break
                if attr in base.__dict__:
                    overrides = f"{qualname(base)}#{'<init>' if attr == '__init__' else attr}"
                    break
            mods = []
            if isinstance(raw, staticmethod):
                mods.append("static")
            if getattr(fn, "__isabstractmethod__", False):
                mods.append("abstract")
            methods.append({
                "name": "<init>" if attr == "__init__" else attr,
                "descriptor": "(" + ",".join(params) + ")",
                "params": params,
                "returns": "",
                "modifiers": mods,
                "implicit": False,
                "line": fn.__code__.co_firstlineno,
                "overrides": overrides,
            })
        fields, seen = [], set()
        try:
            tree = ast.parse(inspect.getsource(cls))
            for node in ast.walk(tree):
                targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, ast.AnnAssign) else []
                for t in targets:
                    if isinstance(t, ast.Attribute) and isinstance(t.value, ast.Name) and t.value.id == "self" and t.attr not in seen:
                        seen.add(t.attr)
                        ann = ast.unparse(node.annotation) if isinstance(node, ast.AnnAssign) else ""
                        fields.append({"name": t.attr, "type": ann, "modifiers": [], "line": (line or 1) + t.lineno - 1})
        except Exception:
            pass
        out.append({
            "name": name,
            "simpleName": cls.__name__,
            "kind": "class",
            "abstract": inspect.isabstract(cls),
            "file": rel(inspect.getsourcefile(cls), src),
            "line": line,
            "superclass": qualname(bases[0]) if bases else None,
            "interfaces": [qualname(b) for b in bases[1:]],
            "methods": methods,
            "fields": fields,
        })
    return out


def user_namespaces(main_globals, userset):
    spaces = [main_globals] if main_globals else []
    for mod in list(sys.modules.values()):
        f = getattr(mod, "__file__", None)
        if f and os.path.realpath(f) in userset and mod.__dict__ is not main_globals:
            spaces.append(mod.__dict__)
    return spaces


# ---------------------------------------------------------------- check

def cmd_check(src):
    diags = []
    for path in sorted(user_files(src)):
        try:
            with open(path, "rb") as fh:
                compile(fh.read(), rel(path, src), "exec", dont_inherit=True)
        except SyntaxError as e:
            diags.append({"file": rel(path, src), "line": e.lineno, "column": e.offset, "severity": "error",
                          "message": f"{type(e).__name__}: {e.msg}"})
        except ValueError as e:
            diags.append({"file": rel(path, src), "line": 1, "column": None, "severity": "error", "message": str(e)})
    print(json.dumps({"ok": not diags, "diagnostics": diags}))


# ---------------------------------------------------------------- run

def cmd_run(src, entry, result_path):
    setup_environment(src)
    userset = user_files(src)
    prepare_paths(src, entry)
    result = {"exitCode": 0}
    main_globals = None
    try:
        main_globals = run_entry(src, entry)
    except SystemExit as e:
        code = e.code
        result["exitCode"] = code if isinstance(code, int) else (0 if code is None else 1)
        if code is not None and not isinstance(code, int):
            print(code, file=sys.stderr)
    except BaseException as e:
        sys.stderr.write(short_traceback(e, src, userset))
        result["exitCode"] = 1
        result["exception"] = describe_exception(e, src, userset)
    finally:
        sys.stdout.flush()
    try:
        result["hierarchy"] = class_model(user_namespaces(main_globals or getattr(sys.modules.get("__main__"), "__dict__", {}), userset), src, userset)
    except Exception:
        pass
    with open(result_path, "w", encoding="utf-8") as fh:
        json.dump(result, fh)
    sys.exit(result["exitCode"] if isinstance(result["exitCode"], int) else 1)


# ---------------------------------------------------------------- trace

class StopRecording(BaseException):
    """Raised from the trace hook to end a run at the step or time limit."""
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


class _BinaryCapture(io.RawIOBase):
    """sys.stdout.buffer for programs that write bytes; decoded into the same capture."""
    def __init__(self, text):
        self.text_capture = text

    def writable(self):
        return True

    def write(self, b):
        self.text_capture.write(bytes(b).decode("utf-8", "replace"))
        return len(b)


class Capture(io.TextIOBase):
    """Collects what the program prints, up to a limit; position = characters written so far.
    Behaves like a real text stream (encoding, buffer, isatty) so programs that check them work."""
    encoding = "utf-8"
    errors = "strict"
    newlines = None

    def __init__(self, limit):
        self.parts, self.size, self.limit, self.truncated = [], 0, limit, False
        self.buffer = _BinaryCapture(self)

    def writable(self):
        return True

    def isatty(self):
        return False

    def fileno(self):
        raise io.UnsupportedOperation("fileno")

    def write(self, s):
        s = str(s)
        room = self.limit - self.size
        if room <= 0:
            self.truncated = True
            return len(s)
        if len(s) > room:
            self.truncated = True
            s = s[:room]
        self.parts.append(s)
        self.size += len(s)
        return len(s)

    def text(self):
        return "".join(self.parts)


def type_name(v):
    t = type(v)
    if t.__module__ in ("builtins", "__builtin__"):
        return "None" if v is None else t.__name__
    return t.__qualname__


def is_noise(v):
    return isinstance(v, (types.ModuleType, types.FunctionType, types.BuiltinFunctionType, type, types.MethodType))


class Recorder:
    def __init__(self, src, userset, req):
        self.src, self.userset = src, userset
        self.max_steps = int(req.get("maxSteps", 2000))
        self.deadline = time.monotonic() + int(req.get("timeoutMs", 20000)) / 1000.0
        self.out = Capture(int(req.get("maxOutput", 64 * 1024)))
        self.err = Capture(int(req.get("maxOutput", 64 * 1024)))
        self.steps, self.io = [], []
        self.frame_ids, self.next_id, self.announced, self.last_types = {}, 1, set(), {}
        self.obj_ids, self.keep, self.last_heap = {}, [], None
        self.stopped = None

    # -- values
    def oid(self, o):
        key = id(o)
        if key not in self.obj_ids:
            self.obj_ids[key] = str(len(self.obj_ids) + 1)
            self.keep.append(o)  # keeps the id from being reused while the trace is open
        return self.obj_ids[key]

    def val(self, v, pending):
        # numpy scalars (numpy.int64, numpy.float32, ...) are recorded as the Python number they hold.
        if type(v).__module__ == "numpy" and getattr(v, "ndim", None) == 0 and hasattr(v, "item"):
            try:
                v = v.item()
            except Exception:
                pass
        if v is None:
            return {"t": "null"}
        if v is True or v is False:
            return {"t": "bool", "v": v}
        if isinstance(v, int):
            return {"t": "int", "v": v if -(2 ** 53) < v < 2 ** 53 else str(v)}
        if isinstance(v, float):
            return {"t": "float", "v": v if math.isfinite(v) else None}
        if isinstance(v, str):
            return {"t": "str", "v": v if len(v) <= MAX_STRING else v[:MAX_STRING] + "…"}
        pending.append(v)
        return {"t": "ref", "id": self.oid(v)}

    def obj(self, o, pending, heap=None):
        items = lambda seq: [self.val(x, pending) for x in list(seq)[:MAX_ITEMS]]
        lib = self.library_value(o, pending, heap)
        if lib is not None:
            return lib
        if isinstance(o, list):
            return {"t": "list", "cls": "list", "items": items(o)}
        if isinstance(o, tuple):
            return {"t": "list", "cls": "tuple", "items": items(o)}
        if isinstance(o, (set, frozenset)):
            return {"t": "set", "cls": type(o).__name__, "items": items(o)}
        if isinstance(o, collections.deque):
            return {"t": "deque", "cls": "deque", "items": items(o)}
        if isinstance(o, dict):
            return {"t": "map", "cls": type(o).__name__, "entries": [[self.val(k, pending), self.val(x, pending)] for k, x in list(o.items())[:MAX_ITEMS]]}
        if not is_noise(o) and (hasattr(o, "__dict__") or hasattr(type(o), "__slots__")):
            fields = {}
            for k, x in list(getattr(o, "__dict__", {}).items()):
                if not k.startswith("__"):
                    fields[k] = self.val(x, pending)
            for k in getattr(type(o), "__slots__", ()):
                if isinstance(k, str) and hasattr(o, k):
                    fields[k] = self.val(getattr(o, k), pending)
            return {"t": "object", "cls": f"{type(o).__module__}.{type(o).__qualname__}", "fields": fields}
        return {"t": "opaque", "cls": type(o).__name__}

    def library_value(self, o, pending, heap):
        """numpy arrays and pandas Series/DataFrames as the values they hold (first rows only).
        The real library computes everything; this only shows the result."""
        mod = type(o).__module__ or ""
        try:
            if mod.startswith("numpy") and hasattr(o, "ndim") and hasattr(o, "tolist"):
                if o.ndim == 1:
                    return {"t": "list", "cls": "numpy.ndarray", "items": [self.val(x, pending) for x in o[:MAX_ITEMS].tolist()]}
                if o.ndim == 2 and heap is not None:
                    key = self.oid(o)
                    rows = []
                    for i, row in enumerate(o[:64].tolist()):
                        rid = f"{key}.{i}"
                        heap[rid] = {"t": "list", "cls": "list", "items": [self.val(x, pending) for x in row[:MAX_ITEMS]]}
                        rows.append({"t": "ref", "id": rid})
                    return {"t": "list", "cls": "list", "items": rows}
                return {"t": "opaque", "cls": f"numpy.ndarray{tuple(o.shape)}"}
            if mod.startswith("pandas"):
                name = type(o).__name__
                if name == "Series":
                    return {"t": "list", "cls": "pandas.Series", "items": [self.val(x, pending) for x in o.head(MAX_ITEMS).tolist()]}
                if name == "DataFrame" and heap is not None:
                    key = self.oid(o)
                    entries = []
                    for j, col in enumerate(list(o.columns)[:20]):
                        cid = f"{key}.c{j}"
                        heap[cid] = {"t": "list", "cls": "pandas.Series", "items": [self.val(x, pending) for x in o[col].head(50).tolist()]}
                        entries.append([self.val(str(col), pending), {"t": "ref", "id": cid}])
                    return {"t": "map", "cls": "pandas.DataFrame", "entries": entries}
        except Exception:
            return {"t": "opaque", "cls": type(o).__name__}
        return None

    # -- frames
    def owner(self, frame):
        code = frame.f_code
        module = frame.f_globals.get("__name__", "")
        qual = getattr(code, "co_qualname", None)
        if qual is None:  # before Python 3.11: find the class through self
            qual = code.co_name
            first = code.co_varnames[0] if code.co_argcount else None
            if first in ("self", "cls") and first in frame.f_locals:
                target = frame.f_locals[first]
                for klass in (target if isinstance(target, type) else type(target)).__mro__:
                    fn = klass.__dict__.get(code.co_name)
                    fn = getattr(fn, "__func__", fn)
                    if getattr(fn, "__code__", None) is code:
                        qual = f"{klass.__qualname__}.{code.co_name}"
                        break
        if "." in qual and "<locals>" not in qual.rsplit(".", 1)[0]:
            cls, method = qual.rsplit(".", 1)
            return f"{module}.{cls}", method
        return module, code.co_name

    def record(self, frame, kind, ret=None):
        if len(self.steps) >= self.max_steps:
            raise StopRecording("steps")
        if time.monotonic() > self.deadline:
            raise StopRecording("timeout")
        pending = []
        chain, f = [], frame
        while f is not None:
            if os.path.realpath(f.f_code.co_filename) in self.userset:
                chain.append(f)
            f = f.f_back
        frames = []
        for i, uf in enumerate(chain[:MAX_FRAMES]):
            fid = self.frame_ids.get(id(uf))
            if fid is None:
                fid = self.frame_ids[id(uf)] = self.next_id
                self.next_id += 1
            code = uf.f_code
            cls, method = self.owner(uf)
            entry = {"id": fid, "depth": len(chain) - 1 - i, "cls": cls, "method": "<init>" if method == "__init__" else method, "line": uf.f_lineno}
            if fid not in self.announced:
                self.announced.add(fid)
                entry["args"] = list(code.co_varnames[:code.co_argcount + code.co_kwonlyargcount])
            local_vars = {} if code.co_name == "<module>" else {k: v for k, v in uf.f_locals.items() if not (k.startswith("__") and k.endswith("__")) and not is_noise(v)}
            entry["locals"] = {k: self.val(v, pending) for k, v in local_vars.items()}
            type_table = {k: type_name(v) for k, v in local_vars.items()}
            if type_table != self.last_types.get(fid):
                entry["types"] = type_table
                self.last_types[fid] = type_table
            frames.append(entry)
        statics = {}
        for ns in self.namespaces():
            modname = ns.get("__name__", "")
            for k, v in ns.items():
                if len(statics) >= MAX_STATICS:
                    break
                if k.startswith("__") or is_noise(v) or k in ("In", "Out"):
                    continue
                statics[f"{modname}.{k}"] = self.val(v, pending)
        ret_val = self.val(ret, pending) if kind == "return" else None
        heap, queue = {}, list(pending)
        while queue and len(heap) < MAX_OBJECTS:
            o = queue.pop(0)
            key = self.oid(o)
            if key not in heap:
                heap[key] = self.obj(o, queue, heap)
        heap_json = json.dumps(heap, sort_keys=False)
        top = frames[0] if frames else {"cls": "", "method": "", "line": frame.f_lineno}
        step = {
            "kind": kind,
            "line": frame.f_lineno,
            "sourcePath": rel(frame.f_code.co_filename, self.src),
            "cls": top["cls"],
            "method": top["method"],
            "out": self.out.size,
            "stackDepth": len(chain),
            "stack": frames,
            "statics": statics,
            "heap": None if heap_json == self.last_heap else heap,
        }
        if kind == "return":
            step["ret"] = ret_val
            step["retType"] = type_name(ret)
        self.last_heap = heap_json
        self.steps.append(step)

    def namespaces(self):
        main = sys.modules.get("__main__")
        spaces = [main.__dict__] if main is not None and os.path.realpath(getattr(main, "__file__", "") or "") in self.userset else []
        for mod in list(sys.modules.values()):
            f = getattr(mod, "__file__", None)
            if mod is not main and f and os.path.realpath(f) in self.userset:
                spaces.append(mod.__dict__)
        return spaces

    # -- hooks
    def hook(self, frame, event, arg):
        if event != "call" or os.path.realpath(frame.f_code.co_filename) not in self.userset:
            return None
        self.frame_ids[id(frame)] = self.next_id
        self.next_id += 1
        return self.local

    def local(self, frame, event, arg):
        if event == "line":
            self.record(frame, "line")
        elif event == "return":
            code = frame.f_code
            if code.co_name not in SKIP_RETURNS and not (code.co_flags & CO_GENERATOR_LIKE):
                self.record(frame, "return", arg)
            self.frame_ids.pop(id(frame), None)
        return self.local

    def traced_input(self, real):
        def input_(prompt=""):
            caller = sys._getframe(1)
            event = {"seq": len(self.io), "cls": "builtins", "op": "input", "receiver": None,
                     "args": [str(prompt)] if prompt != "" else [], "file": rel(caller.f_code.co_filename, self.src),
                     "line": caller.f_lineno, "step": max(0, len(self.steps) - 1)}
            try:
                value = real(prompt)
            except EOFError:
                event.update(ok=False, error={"type": "EOFError", "message": "EOF when reading a line"})
                self.io.append(event)
                raise
            event.update(ok=True, result=value)
            self.io.append(event)
            return value
        return input_


def cmd_trace(src, entry, request_path, result_path):
    with open(request_path, encoding="utf-8") as fh:
        req = json.load(fh)
    setup_environment(src)
    userset = user_files(src)
    prepare_paths(src, entry)
    rec = Recorder(src, userset, req)
    stdin_text = req.get("stdin") or ""
    sys.stdin = io.StringIO(stdin_text)
    real_stdout, real_stderr = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = rec.out, rec.err
    real_input = builtins.input
    builtins.input = rec.traced_input(real_input)
    exit_code, exception, stop = 0, None, None
    main_globals = None
    sys.settrace(rec.hook)
    try:
        main_globals = run_entry(src, entry)
    except StopRecording as e:
        stop = e.reason
    except SystemExit as e:
        exit_code = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
    except BaseException as e:
        sys.settrace(None)
        exit_code = 1
        if isinstance(e, StopRecording):
            stop = e.reason
        else:
            exception = describe_exception(e, src, userset)
            rec.err.write(short_traceback(e, src, userset))
            tb, last = e.__traceback__, None
            while tb is not None:
                if os.path.realpath(tb.tb_frame.f_code.co_filename) in userset:
                    last = tb
                tb = tb.tb_next
            if last is not None and len(rec.steps) < rec.max_steps + 1:
                rec.max_steps += 1
                try:
                    rec.record(last.tb_frame, "exception")
                    rec.steps[-1]["line"] = last.tb_lineno
                    if rec.steps[-1]["stack"]:
                        rec.steps[-1]["stack"][0]["line"] = last.tb_lineno
                except StopRecording:
                    pass
    finally:
        sys.settrace(None)
        builtins.input = real_input
        sys.stdout, sys.stderr = real_stdout, real_stderr
    try:
        hierarchy = class_model(user_namespaces(main_globals or getattr(sys.modules.get("__main__"), "__dict__", {}), userset), src, userset)
    except Exception:
        hierarchy = []
    result = {
        "steps": rec.steps,
        "stepCount": len(rec.steps),
        "truncated": stop is not None,
        "stopReason": stop,
        "stdout": rec.out.text(),
        "stderr": rec.err.text(),
        "stdoutTruncated": rec.out.truncated,
        "stderrTruncated": rec.err.truncated,
        "exitCode": None if stop else exit_code,
        "io": rec.io,
        "ioTruncated": False,
        "stdin": stdin_text,
        "classes": {},
        "hierarchy": hierarchy,
    }
    if exception:
        result["exception"] = exception
    with open(result_path, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False)


def main(argv):
    if len(argv) < 3:
        print("usage: pyrun.py check SRC | run SRC ENTRY RESULT | trace SRC ENTRY REQUEST RESULT", file=sys.stderr)
        return 2
    cmd, src = argv[1], os.path.realpath(argv[2])
    argv = argv[:3] + [argv[3]] + [os.path.abspath(a) for a in argv[4:]] if len(argv) > 3 else argv  # result paths survive chdir
    if cmd == "check":
        cmd_check(src)
        return 0
    entry = os.path.realpath(os.path.join(src, argv[3]))
    if not entry.startswith(src + os.sep) or not os.path.isfile(entry):
        print(f"No such file: {argv[3]}", file=sys.stderr)
        return 2
    if cmd == "run":
        limit_resources(int(os.environ.get("CODEVIZ_MEMORY_MB", "512")), int(os.environ.get("CODEVIZ_CPU_SECONDS", "12")))
        cmd_run(src, entry, argv[4])
    elif cmd == "trace":
        limit_resources(int(os.environ.get("CODEVIZ_MEMORY_MB", "1024")), int(os.environ.get("CODEVIZ_CPU_SECONDS", "30")))
        cmd_trace(src, entry, argv[4], argv[5])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv) or 0)
