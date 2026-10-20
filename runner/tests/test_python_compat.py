"""Python compatibility suite: the language, built-ins, standard library, files, concurrency,
third-party packages, missing packages, recording, and limits, all through the real runner.
Each program checks itself with assertions and prints ok:<name> or FAIL:<name>: <error>."""
from e2e import *


def py(files, mode="run", stdin="", main=None):
    body = {"mode": mode, "language": "python", "files": [{"path": p, "content": c} for p, c in files.items()], "stdin": stdin}
    if main: body["mainClass"] = main
    status, job = call("POST", "/v1/executions", body, client="tests")
    if status != 202: return status, job
    for _ in range(900):
        s, j = call("GET", "/v1/executions/" + job["id"])
        if "result" in j: return s, j
        time.sleep(0.1)
    raise RuntimeError("execution never finished")


def out(j): return (j["result"].get("stdout") or "")

HARNESS = '''import traceback
_results = []
def check(name):
    def wrap(fn):
        try:
            fn()
            print("ok:" + name)
        except BaseException as e:
            print("FAIL:" + name + ": " + type(e).__name__ + ": " + str(e)[:200])
        return fn
    return wrap
'''


def suite(name, body, expect, mode="run", files=None, stdin=""):
    src = {"main.py": HARNESS + body}
    src.update(files or {})
    s, j = py(src, mode=mode, main="main.py", stdin=stdin)
    o = out(j)
    oks = [l[3:] for l in o.splitlines() if l.startswith("ok:")]
    fails = [l for l in o.splitlines() if l.startswith("FAIL:")]
    check(f"{name}: {len(oks)}/{expect} pass", len(oks) == expect and not fails and j["status"] == "completed",
          fails[:4] or (j["status"], j["result"].get("stderr", "")[-400:], j["result"].get("error")))
    return j, o


LANGUAGE = r'''
import asyncio, dataclasses, enum, functools, abc, contextlib, typing

@check("match statement")
def _():
    def kind(x):
        match x:
            case {"type": "point", "x": int(px), "y": py_}: return f"point {px},{py_}"
            case [first, *rest]: return f"list {first} +{len(rest)}"
            case str() as s if s.isupper(): return "shout"
            case _: return "other"
    assert kind({"type": "point", "x": 1, "y": 2}) == "point 1,2" and kind([1, 2, 3]) == "list 1 +2" and kind("HI") == "shout" and kind(3.5) == "other"

@check("walrus and f-string specifiers")
def _():
    data = [3, 8, 1]
    assert (n := len(data)) == 3 and f"{n=}" == "n=3" and f"{3.14159:.2f}|{255:#x}|{'a':>3}|{1234567:,}" == "3.14|0xff|  a|1,234,567"

@check("PEP 695 generics (3.12)")
def _():
    def first[T](items: list[T]) -> T:
        return items[0]
    type Pair = tuple[int, int]
    assert first(["a", "b"]) == "a" and Pair.__value__ == tuple[int, int]

@check("dataclasses, enums, properties")
def _():
    @dataclasses.dataclass(order=True, frozen=True)
    class P:
        x: int
        y: int = 0
    class Color(enum.Enum):
        RED = 1
        GREEN = enum.auto()
    class Temp:
        def __init__(self): self._c = 0
        @property
        def f(self): return self._c * 9 / 5 + 32
        @f.setter
        def f(self, v): self._c = (v - 32) * 5 / 9
    t = Temp(); t.f = 212
    assert P(1) < P(2) and dataclasses.asdict(P(1, 2)) == {"x": 1, "y": 2} and Color.GREEN.value == 2 and t._c == 100

@check("operator overloading")
def _():
    @functools.total_ordering
    class V:
        def __init__(self, x): self.x = x
        def __add__(self, o): return V(self.x + o.x)
        def __eq__(self, o): return self.x == o.x
        def __lt__(self, o): return self.x < o.x
        def __len__(self): return abs(self.x)
        def __getitem__(self, i): return self.x * i
        def __call__(self): return "called"
        def __repr__(self): return f"V({self.x})"
    assert V(1) + V(2) == V(3) and V(5) >= V(4) and len(V(-3)) == 3 and V(2)[5] == 10 and V(0)() == "called" and repr(V(1)) == "V(1)"

@check("multiple inheritance and the MRO")
def _():
    class A:
        def who(self): return "A"
    class B(A):
        def who(self): return "B" + super().who()
    class C(A):
        def who(self): return "C" + super().who()
    class D(B, C):
        def who(self): return "D" + super().who()
    assert D().who() == "DBCA" and [k.__name__ for k in D.__mro__] == ["D", "B", "C", "A", "object"]

@check("closures, nonlocal, decorators, lambdas")
def _():
    def counter():
        n = 0
        def inc():
            nonlocal n
            n += 1
            return n
        return inc
    def twice(fn):
        @functools.wraps(fn)
        def w(*a, **k): return fn(fn(*a, **k))
        return w
    @twice
    def add3(x): return x + 3
    c = counter(); c(); c()
    assert c() == 3 and add3(1) == 7 and add3.__name__ == "add3" and sorted([3, 1, 2], key=lambda v: -v) == [3, 2, 1]

@check("generators, yield from, iterators")
def _():
    def gen(n):
        yield from range(n)
        return "done"
    class Count:
        def __init__(self): self.i = 0
        def __iter__(self): return self
        def __next__(self):
            self.i += 1
            if self.i > 3: raise StopIteration
            return self.i
    g = gen(3)
    assert list(g) == [0, 1, 2] and list(Count()) == [1, 2, 3] and sum(x * x for x in range(4)) == 14

@check("arguments: defaults, keyword-only, positional-only, *args, **kwargs")
def _():
    def f(a, /, b=2, *args, c, **kw): return (a, b, args, c, kw)
    assert f(1, c=3) == (1, 2, (), 3, {}) and f(1, 5, 6, 7, c=0, z=9) == (1, 5, (6, 7), 0, {"z": 9})

@check("exceptions: custom, chained, groups, finally")
def _():
    class AppError(Exception): pass
    try:
        try:
            1 / 0
        except ZeroDivisionError as e:
            raise AppError("wrapped") from e
    except AppError as e:
        assert isinstance(e.__cause__, ZeroDivisionError)
    seen = []
    try:
        raise ExceptionGroup("many", [ValueError(1), TypeError(2)])
    except* ValueError:
        seen.append("v")
    except* TypeError:
        seen.append("t")
    order = []
    try:
        order.append("try")
    finally:
        order.append("finally")
    assert seen == ["v", "t"] and order == ["try", "finally"]

@check("context managers")
def _():
    log = []
    class CM:
        def __enter__(self): log.append("in"); return self
        def __exit__(self, *e): log.append("out"); return False
    @contextlib.contextmanager
    def cm():
        log.append("gen-in"); yield 5; log.append("gen-out")
    with CM(), cm() as v:
        log.append(v)
    assert log == ["in", "gen-in", 5, "gen-out", "out"]

@check("abstract classes, slots, class and static methods")
def _():
    class Shape(abc.ABC):
        __slots__ = ()  # slots only remove __dict__ when every base declares them too
        @abc.abstractmethod
        def area(self): ...
    class Sq(Shape):
        __slots__ = ("s",)
        def __init__(self, s): self.s = s
        def area(self): return self.s ** 2
        @classmethod
        def unit(cls): return cls(1)
        @staticmethod
        def sides(): return 4
    try:
        Shape(); raise AssertionError("abstract class was instantiated")
    except TypeError:
        pass
    assert Sq.unit().area() == 1 and Sq.sides() == 4 and not hasattr(Sq(2), "__dict__")

@check("typing: TypedDict, Protocol, generics, annotations")
def _():
    class Movie(typing.TypedDict):
        title: str
        year: int
    class Greets(typing.Protocol):
        def hello(self) -> str: ...
    def ann(x: int, y: "list[str]" = ()) -> dict[str, int]: return {}
    m: Movie = {"title": "Up", "year": 2009}
    assert m["year"] == 2009 and typing.get_type_hints(ann)["x"] is int

@check("async and await")
def _():
    async def work(i):
        await asyncio.sleep(0.01)
        return i * 2
    async def agen():
        for i in range(3):
            yield i
    async def main():
        results = await asyncio.gather(*(work(i) for i in range(4)))
        items = [x async for x in agen()]
        return results, items
    assert asyncio.run(main()) == ([0, 2, 4, 6], [0, 1, 2])

@check("comprehensions, slicing, unpacking, bitwise")
def _():
    grid = [[r * c for c in range(3)] for r in range(3)]
    first, *middle, last = range(6)
    assert grid[2] == [0, 2, 4] and {k: v for k, v in zip("ab", (1, 2))} == {"a": 1, "b": 2} and {x % 3 for x in range(9)} == {0, 1, 2}
    assert "python"[::-2] == "nhy" and middle == [1, 2, 3, 4] and last == 5 and (6 & 3, 6 | 3, 6 ^ 3, ~6, 1 << 4, 64 >> 2) == (2, 7, 5, -7, 16, 16)

@check("recursion and lru_cache")
def _():
    @functools.lru_cache(maxsize=None)
    def fib(n): return n if n < 2 else fib(n - 1) + fib(n - 2)
    assert fib(80) == 23416728348467685 and functools.reduce(lambda a, b: a * b, range(1, 6)) == 120
'''

BUILTINS = r'''
@check("builtins")
def _():
    assert len("abc") == 3 and list(range(1, 10, 3)) == [1, 4, 7] and list(enumerate("ab", 1)) == [(1, "a"), (2, "b")]
    assert list(zip([1, 2], "xy")) == [(1, "x"), (2, "y")] and list(map(str, [1, 2])) == ["1", "2"] and list(filter(None, [0, 1, 2])) == [1, 2]
    assert sorted("cab") == ["a", "b", "c"] and list(reversed([1, 2])) == [2, 1] and sum([1, 2], 10) == 13 and min(3, 1) == 1 and max("ab") == "b"
    assert abs(-2.5) == 2.5 and round(2.675, 2) == 2.67 and round(7.5) == 8 and all([1, True]) and any([0, 1])
    it = iter([1, 2]); assert next(it) == 1 and next(it) == 2 and next(it, "end") == "end"
    assert isinstance(True, int) and issubclass(bool, int) and type(3) is int and isinstance(id(object()), int)
    assert int("ff", 16) == 255 and float("1e3") == 1000.0 and str(1.5) == "1.5" and bool([]) is False and complex(1, 2).imag == 2.0
    assert bytes([65, 66]) == b"AB" and bytearray(b"a") + b"b" == bytearray(b"ab") and list((1, 2)) == [1, 2] and tuple("ab") == ("a", "b")
    assert dict(a=1) == {"a": 1} and set("aab") == {"a", "b"} and frozenset([1]) == frozenset({1}) and isinstance(object(), object)
    class C:
        x = 1
    c = C(); setattr(c, "y", 2)
    assert getattr(c, "y") == 2 and hasattr(c, "x") and getattr(c, "z", None) is None
    delattr(c, "y"); assert not hasattr(c, "y")
    assert repr("a") == "'a'" and format(3.5, ".1f") == "3.5" and ord("A") == 65 and chr(97) == "a" and bin(5) == "0b101" and oct(8) == "0o10" and hex(255) == "0xff"
    assert divmod(17, 5) == (3, 2) and pow(2, 10) == 1024 and pow(3, 4, 5) == 1 and isinstance(hash("x"), int) and callable(len) and not callable(3)
    assert "__name__" in globals() and isinstance(locals(), dict) and "x" in vars(C) and "append" in dir([])
    assert type(help).__name__ == "_Helper" and isinstance(open, type(print)) and issubclass(KeyError, LookupError) and NotImplemented is not None
    assert eval("1 + 2") == 3 and (exec("z = 4", ns := {}) or ns["z"] == 4) and compile("1", "<x>", "eval").co_filename == "<x>"
    assert max([], default=7) == 7 and sorted({"b": 1, "a": 2}.items(), key=lambda kv: kv[1])[0] == ("b", 1) and slice(1, 3).stop == 3
    assert isinstance(memoryview(b"ab"), memoryview) and ascii("é") == "'\\xe9'" and len(range(10**12)) == 10**12 and isinstance(super, type)

@check("help() works without a terminal")
def _():
    import io, contextlib
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        help(len)
    assert "Return the number of items" in buf.getvalue()
'''

STDLIB = r'''
import importlib
MODULES = """math cmath decimal fractions statistics random numbers collections itertools functools heapq bisect array
string re textwrap difflib unicodedata json csv configparser tomllib datetime time calendar zoneinfo os pathlib shutil
glob tempfile fnmatch pickle struct base64 binascii copy types enum dataclasses typing abc unittest doctest traceback
pdb logging warnings pprint timeit argparse sys platform threading multiprocessing concurrent.futures asyncio queue
zipfile tarfile gzip bz2 lzma zlib sqlite3 html html.parser xml.etree.ElementTree xml.dom.minidom hashlib hmac secrets
uuid io contextlib operator inspect dis ast weakref gc locale codecs shlex graphlib urllib.parse email ipaddress
""".split()

@check("standard library: every module imports")
def _():
    missing = []
    for m in MODULES:
        try:
            importlib.import_module(m)
        except Exception as e:
            missing.append(f"{m} ({type(e).__name__}: {e})")
    assert not missing, missing

@check("standard library: modules work")
def _():
    import math, cmath, decimal, fractions, statistics, random, collections, itertools, heapq, bisect, array, re, textwrap, difflib
    import json, csv, io, configparser, tomllib, datetime, calendar, zoneinfo, pickle, struct, base64, hashlib, copy, uuid, graphlib, ipaddress, urllib.parse
    import xml.etree.ElementTree as ET, html, unicodedata, statistics, pprint, timeit, shlex, operator
    assert math.isclose(math.sqrt(2) ** 2, 2) and cmath.sqrt(-1) == 1j and decimal.Decimal("0.1") * 3 == decimal.Decimal("0.3")
    assert fractions.Fraction(1, 3) + fractions.Fraction(1, 6) == fractions.Fraction(1, 2) and statistics.median([3, 1, 2]) == 2
    random.seed(1); a = random.random(); random.seed(1); assert random.random() == a
    assert collections.Counter("abca").most_common(1) == [("a", 2)] and list(itertools.combinations("abc", 2))[0] == ("a", "b")
    h = [5, 1, 3]; heapq.heapify(h); assert heapq.heappop(h) == 1 and bisect.bisect([1, 3, 5], 4) == 2 and array.array("i", [1, 2]).tolist() == [1, 2]
    assert re.findall(r"\d+", "a1b22") == ["1", "22"] and textwrap.wrap("aaa bbb", 3) == ["aaa", "bbb"] and difflib.SequenceMatcher(None, "ab", "abc").ratio() > 0.7
    assert json.loads(json.dumps({"a": [1, 2]})) == {"a": [1, 2]} and list(csv.reader(io.StringIO("a,b\n1,2")))[1] == ["1", "2"]
    cp = configparser.ConfigParser(); cp.read_string("[s]\nk = v"); assert cp["s"]["k"] == "v" and tomllib.loads('x = 1')["x"] == 1
    assert (datetime.date(2024, 3, 1) - datetime.timedelta(days=1)).day == 29 and calendar.isleap(2024)
    assert datetime.datetime(2024, 1, 1, 12, tzinfo=zoneinfo.ZoneInfo("Asia/Seoul")).utcoffset() == datetime.timedelta(hours=9)
    assert pickle.loads(pickle.dumps({1, 2})) == {1, 2} and struct.unpack("<I", struct.pack("<I", 7))[0] == 7 and base64.b64decode(base64.b64encode(b"hi")) == b"hi"
    assert hashlib.sha256(b"").hexdigest().startswith("e3b0c442") and copy.deepcopy([[1]]) == [[1]] and uuid.UUID(int=0).hex == "0" * 32
    assert list(graphlib.TopologicalSorter({"b": {"a"}}).static_order()) == ["a", "b"] and ipaddress.ip_address("10.0.0.1").is_private
    assert urllib.parse.urlparse("https://x.org/p?q=1").query == "q=1" and ET.fromstring("<a><b>1</b></a>").find("b").text == "1"
    assert html.escape("<a>") == "&lt;a&gt;" and unicodedata.name("A") == "LATIN CAPITAL LETTER A" and shlex.split("a 'b c'") == ["a", "b c"]
    assert operator.itemgetter(1)([1, 2]) == 2 and pprint.pformat({"a": 1}) == "{'a': 1}" and timeit.timeit("1+1", number=10) >= 0

@check("logging, warnings, unittest, doctest")
def _():
    import logging, warnings, unittest, doctest, io
    stream = io.StringIO(); log = logging.getLogger("t"); log.addHandler(logging.StreamHandler(stream)); log.warning("hi")
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always"); warnings.warn("careful")
    class T(unittest.TestCase):
        def test_add(self): self.assertEqual(1 + 1, 2)
    result = unittest.TextTestRunner(stream=io.StringIO()).run(unittest.defaultTestLoader.loadTestsFromTestCase(T))
    def sq(x):
        """
        >>> sq(3)
        9
        """
        return x * x
    finder = doctest.DocTestFinder(); runner = doctest.DocTestRunner()
    for t in finder.find(sq, "sq", globs={"sq": sq}): runner.run(t, out=lambda s: None)
    assert stream.getvalue() == "hi\n" and str(w[0].message) == "careful" and result.wasSuccessful() and runner.failures == 0 and runner.tries == 1

@check("argparse, platform, sys")
def _():
    import argparse, platform, sys
    p = argparse.ArgumentParser(); p.add_argument("--n", type=int, default=3)
    assert p.parse_args([]).n == 3 and p.parse_args(["--n", "5"]).n == 5 and platform.python_version().startswith("3.") and sys.version_info >= (3, 11)
'''

FILES = r'''
import os, pathlib, csv, json, sqlite3, zipfile, tarfile, gzip, bz2, lzma, shutil, tempfile, glob

@check("text and binary files in the working folder")
def _():
    with open("notes.txt", "w", encoding="utf-8") as f:
        f.write("héllo\nwörld\n")
    with open("notes.txt", encoding="utf-8") as f:
        assert f.read().splitlines() == ["héllo", "wörld"]
    pathlib.Path("raw.bin").write_bytes(bytes(range(5)))
    assert pathlib.Path("raw.bin").read_bytes()[-1] == 4 and "notes.txt" in os.listdir(".")
    assert "héllo".encode("latin-1").decode("latin-1") == "héllo"

@check("reading a data file that is part of the project")
def _():
    with open("data/scores.csv", newline="") as f:
        rows = list(csv.DictReader(f))
    assert [r["name"] for r in rows] == ["ann", "bo"] and sum(int(r["score"]) for r in rows) == 170

@check("csv and json files")
def _():
    with open("out.csv", "w", newline="") as f:
        csv.writer(f).writerows([["a", "b"], [1, 2]])
    json.dump({"rows": list(csv.reader(open("out.csv")))}, open("out.json", "w"))
    assert json.load(open("out.json")) == {"rows": [["a", "b"], ["1", "2"]]}

@check("sqlite3 database file")
def _():
    db = sqlite3.connect("test.db")
    db.execute("create table t (x int)"); db.executemany("insert into t values (?)", [(1,), (2,)]); db.commit()
    assert db.execute("select sum(x) from t").fetchone() == (3,)
    db.close()

@check("archives and compression")
def _():
    with zipfile.ZipFile("a.zip", "w") as z: z.writestr("x.txt", "zip!")
    with tarfile.open("a.tar.gz", "w:gz") as t: t.add("notes.txt")
    data = b"compress me " * 50
    assert zipfile.ZipFile("a.zip").read("x.txt") == b"zip!" and "notes.txt" in tarfile.open("a.tar.gz").getnames()
    assert gzip.decompress(gzip.compress(data)) == data and bz2.decompress(bz2.compress(data)) == data and lzma.decompress(lzma.compress(data)) == data

@check("tempfile, shutil, glob, pathlib")
def _():
    with tempfile.TemporaryDirectory() as d:
        p = pathlib.Path(d) / "sub" / "f.txt"; p.parent.mkdir(); p.write_text("x")
        shutil.copy(p, pathlib.Path(d) / "copy.txt")
        assert sorted(x.name for x in pathlib.Path(d).rglob("*.txt")) == ["copy.txt", "f.txt"]
    assert "notes.txt" in glob.glob("*.txt") and tempfile.gettempdir() != "/tmp" or os.environ.get("TMPDIR")
'''

CONCURRENCY = r'''
import threading, queue, concurrent.futures, multiprocessing, asyncio

def square(x):
    return x * x

@check("threads and a queue")
def _():
    q, out = queue.Queue(), []
    lock = threading.Lock()
    def worker():
        while (item := q.get()) is not None:
            with lock: out.append(item * 2)
    ts = [threading.Thread(target=worker) for _ in range(3)]
    for t in ts: t.start()
    for i in range(10): q.put(i)
    for _ in ts: q.put(None)
    for t in ts: t.join()
    assert sorted(out) == [i * 2 for i in range(10)]

@check("thread and process pools")
def _():
    with concurrent.futures.ThreadPoolExecutor(4) as ex:
        assert list(ex.map(square, range(5))) == [0, 1, 4, 9, 16]
    with concurrent.futures.ProcessPoolExecutor(2) as ex:
        assert list(ex.map(square, range(5))) == [0, 1, 4, 9, 16]

@check("multiprocessing pool")
def _():
    with multiprocessing.Pool(2) as pool:
        assert pool.map(square, [1, 2, 3]) == [1, 4, 9]

@check("asyncio tasks, queues, timeouts")
def _():
    async def main():
        q = asyncio.Queue()
        async def producer():
            for i in range(3): await q.put(i)
        await asyncio.gather(producer())
        got = [await q.get() for _ in range(3)]
        try:
            async with asyncio.timeout(0.05):
                await asyncio.sleep(1)
        except TimeoutError:
            got.append("timeout")
        return got
    assert asyncio.run(main()) == [0, 1, 2, "timeout"]
'''

PACKAGES = r'''
@check("numpy")
def _():
    import numpy as np
    a = np.arange(12).reshape(3, 4)
    assert a.sum() == 66 and a.T.shape == (4, 3) and np.allclose(np.linalg.inv(np.eye(2) * 2), np.eye(2) / 2) and (a @ a.T).shape == (3, 3)

@check("pandas")
def _():
    import pandas as pd
    df = pd.DataFrame({"team": ["a", "b", "a"], "pts": [3, 5, 4]})
    assert df.groupby("team")["pts"].sum().to_dict() == {"a": 7, "b": 5} and df.sort_values("pts").iloc[-1]["team"] == "b"
    df.to_csv("pts.csv", index=False); assert pd.read_csv("pts.csv").shape == (3, 2)

@check("matplotlib (save to a file)")
def _():
    import matplotlib
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(); ax.plot([1, 2, 3], [1, 4, 9]); fig.savefig("chart.png")
    import os
    assert matplotlib.get_backend().lower() == "agg" and os.path.getsize("chart.png") > 1000

@check("scipy")
def _():
    from scipy import optimize, integrate, stats
    assert abs(optimize.minimize_scalar(lambda x: (x - 2) ** 2).x - 2) < 1e-6 and abs(integrate.quad(lambda x: x, 0, 2)[0] - 2) < 1e-9 and stats.norm.cdf(0) == 0.5

@check("scikit-learn")
def _():
    from sklearn.linear_model import LinearRegression
    from sklearn.cluster import KMeans
    m = LinearRegression().fit([[0], [1], [2]], [1, 3, 5])
    km = KMeans(n_clusters=2, n_init=3, random_state=0).fit([[0, 0], [0, 1], [10, 10], [10, 11]])
    assert round(m.coef_[0], 6) == 2 and len(set(km.labels_)) == 2

@check("sympy")
def _():
    import sympy as sp
    x = sp.symbols("x")
    assert sp.solve(x ** 2 - 4, x) == [-2, 2] and sp.diff(sp.sin(x), x) == sp.cos(x)

@check("networkx")
def _():
    import networkx as nx
    g = nx.Graph([(1, 2), (2, 3), (1, 3), (3, 4)])
    assert nx.shortest_path(g, 1, 4) == [1, 3, 4] and nx.is_connected(g)

@check("pillow")
def _():
    from PIL import Image
    Image.new("RGB", (4, 3), "red").save("img.png")
    assert Image.open("img.png").size == (4, 3)

@check("python-dateutil")
def _():
    from dateutil import parser, relativedelta
    d = parser.parse("2024-01-31")
    assert (d + relativedelta.relativedelta(months=1)).day == 29

@check("requests imports; the network is blocked")
def _():
    import requests
    try:
        requests.get("http://example.com", timeout=3)
        raise AssertionError("network request succeeded")
    except requests.exceptions.ConnectionError:
        pass
'''

section("language features")
suite("modern Python 3.12 language", LANGUAGE, 16)
section("built-in functions and types")
suite("built-ins", BUILTINS, 2)
section("standard library")
suite("standard library", STDLIB, 4)
section("files inside the sandbox")
suite("file operations", FILES, 6, files={"data/scores.csv": "name,score\nann,90\nbo,80\n"})
section("concurrency and async")
suite("threads, processes, asyncio", CONCURRENCY, 4)
section("third-party packages")
suite("installed packages", PACKAGES, 10)
s, j = py({"main.py": "import pytest\n"}, main="main.py")
check("a package that is not installed gives ModuleNotFoundError and says how to add it",
      j["result"].get("exception", {}).get("type") == "ModuleNotFoundError" and "not installed in this runner" in j["result"]["stderr"] and "python-requirements.txt" in j["result"]["stderr"], j["result"].get("stderr", "")[-300:])
s, j = py({"main.py": "import helpers\nprint(helpers.x)\n", "helpers.py": "import notreal\nx = 1\n"}, main="main.py")
check("  the note names the missing package, not the project module that imported it", "'notreal' is not installed" in j["result"]["stderr"], j["result"].get("stderr", "")[-200:])

section("recording does not change what programs do")
for name, body in [("language", LANGUAGE), ("built-ins", BUILTINS), ("standard library", STDLIB)]:
    s, run = py({"main.py": HARNESS + body}, main="main.py")
    s, rec = py({"main.py": HARNESS + body}, mode="trace", main="main.py")
    t = rec["result"]["trace"]
    same = out(rec) == out(run) if not t["truncated"] else out(run).startswith(out(rec))
    check(f"{name}: the recorded run prints {'the same' if not t['truncated'] else 'the same, up to the step limit'} ({t['stepCount']} steps)", same and "FAIL:" not in out(rec), out(rec)[-300:])
s, rec = py({"main.py": "import numpy as np\nimport pandas as pd\na = np.array([3, 1, 2])\nm = np.eye(2)\ns = pd.Series([5, 6])\ndf = pd.DataFrame({'x': [1, 2]})\nn = np.int64(7)\nprint(int(a.sum()))\n"}, mode="trace", main="main.py")
st = rec["result"]["trace"]["steps"]; heap = {}
for x in st:
    if x["heap"] is not None: heap = x["heap"]
g = st[-1]["statics"]
val = lambda name: heap.get(g[f"__main__.{name}"].get("id"), {}) if g.get(f"__main__.{name}", {}).get("t") == "ref" else g.get(f"__main__.{name}")
check("numpy arrays and pandas values are recorded as their values", [v["v"] for v in val("a")["items"]] == [3, 1, 2] and len(val("m")["items"]) == 2 and [v["v"] for v in val("s")["items"]] == [5, 6] and val("df")["t"] == "map" and val("n") == {"t": "int", "v": 7}, {k: val(k) for k in ["a", "s", "n"]})

section("limits")
s, j = py({"main.py": "def f(n):\n    return f(n + 1)\nf(0)\n"}, main="main.py")
check("runaway recursion is a RecursionError", j["result"].get("exception", {}).get("type") == "RecursionError", j["result"].get("exception"))
s, j = py({"main.py": "import numpy as np\nx = np.ones((40000, 40000))\n"}, main="main.py")
check("a 12 GB numpy array is refused by the memory limit", j["status"] == "runtime_error" and j["result"].get("exception", {}).get("type") in ("MemoryError", "_ArrayMemoryError"), j["result"].get("exception"))
s, j = py({"main.py": "import time\nwhile True:\n    sum(range(10**6))\n"}, main="main.py")
check("CPU-bound code is stopped by the timeout", j["status"] == "timed_out", j["status"])

print(f"\n{len(passed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
