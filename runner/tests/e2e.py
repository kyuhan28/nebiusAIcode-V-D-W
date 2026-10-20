"""End-to-end tests for the codeviz Java runner, run against a live instance."""
import json, os, sys, time, threading, urllib.request, urllib.error

BASE = os.environ.get("RUNNER_URL", "http://127.0.0.1:8787")
TOKEN = os.environ.get("RUNNER_TOKEN", "devtoken")
passed, failed = [], []

def call(method, path, body=None, token=TOKEN, client="tests"):
    req = urllib.request.Request(BASE + path, method=method, data=None if body is None else json.dumps(body).encode())
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Codeviz-Client", client)
    if token: req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read())

def execute(files, mode="run", stdin="", main=None, client="tests", wait=True):
    body = {"mode": mode, "files": [{"path": p, "content": c} for p, c in files.items()], "stdin": stdin}
    if main: body["mainClass"] = main
    status, job = call("POST", "/v1/executions", body, client=client)
    if status != 202 or not wait: return status, job
    for _ in range(600):
        s, j = call("GET", "/v1/executions/" + job["id"])
        if "result" in j: return s, j
        time.sleep(0.1)
    raise RuntimeError("execution never finished")

def check(name, cond, detail=""):
    (passed if cond else failed).append(name)
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else "  -> " + str(detail)[:400]))

def section(t): print("\n== " + t)
