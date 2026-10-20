"""Builds problem test data from independent Python reference solutions."""
import heapq, json, random
from collections import deque
random.seed(20261019)

def fmt_arr(a): return f"{len(a)}\n{' '.join(map(str, a))}\n"
def sol_sum(a): return f"{sum(a)}\n"
def sol_rev(a): return " ".join(map(str, reversed(a))) + "\n"
def sol_max(a): return f"{max(a)}\n"
def sol_pal(s): return ("YES" if s == s[::-1] else "NO") + "\n"
def sol_stack(ops):
    st, out = [], []
    for op in ops:
        if op[0] == "push": st.append(op[1])
        elif op[0] == "pop": out.append(str(st.pop()) if st else "EMPTY")
        elif op[0] == "peek": out.append(str(st[-1]) if st else "EMPTY")
        else: out.append(str(len(st)))
    return "".join(x + "\n" for x in out)
def fmt_stack(ops): return f"{len(ops)}\n" + "".join((f"push {o[1]}" if o[0] == "push" else o[0]) + "\n" for o in ops)
def sol_bfs(n, edges, s):
    g = [[] for _ in range(n)]
    for u, v in edges: g[u].append(v); g[v].append(u)
    for l in g: l.sort()
    seen, q, order = [False] * n, deque([s]), []
    seen[s] = True
    while q:
        u = q.popleft(); order.append(u)
        for v in g[u]:
            if not seen[v]: seen[v] = True; q.append(v)
    return " ".join(map(str, order)) + "\n"
def fmt_graph(n, edges, s): return f"{n} {len(edges)}\n" + "".join(" ".join(map(str, e)) + "\n" for e in edges) + f"{s}\n"
def sol_dij(n, edges, s):
    g = [[] for _ in range(n)]
    for u, v, w in edges: g[u].append((v, w)); g[v].append((u, w))
    dist = [None] * n; dist[s] = 0; pq = [(0, s)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]: continue
        for v, w in g[u]:
            if dist[v] is None or d + w < dist[v]: dist[v] = d + w; heapq.heappush(pq, (d + w, v))
    return "".join(("INF" if x is None else str(x)) + "\n" for x in dist)
def rand_edges(n, m, weighted=False):
    pairs = set()
    while len(pairs) < m:
        u, v = random.sample(range(n), 2)
        pairs.add((min(u, v), max(u, v)))
    return [(u, v, random.randint(0, 50)) if weighted else (u, v) for u, v in sorted(pairs)]

P = {}
def add(pid, label, inp, out, hidden):
    P.setdefault(pid, []).append({"id": f"{pid}-{len(P.get(pid, [])) + 1}", "label": label, "input": inp, "expected": out, "hidden": hidden})

big = [random.randint(-10**6, 10**6) for _ in range(1000)]
for label, a, hid in [("Sample 1", [1, 2, 3, 4, 5], False), ("Sample 2", [-2, 10, 5, -3], False), ("Single element", [42], True),
                      ("All negative", [-5, -1, -7, -3], True), ("Mixed values cancel out", [7, -7, 3, -3, 0], True),
                      ("1000 values at the limits", [10**6] * 1000, True), ("1000 random values", big, True), ("Large negative total", [-10**6] * 1000, True)]:
    add("sum-of-array", label, fmt_arr(a), sol_sum(a), hid)
for label, a, hid in [("Sample 1", [1, 2, 3, 4, 5], False), ("Sample 2", [9, -4, 0, 7], False), ("Single element", [8], True),
                      ("Even length", [1, 2, 3, 4], True), ("Negatives", [-1, -2, -3], True), ("1000 values", big, True)]:
    add("reverse-array", label, fmt_arr(a), sol_rev(a), hid)
for label, a, hid in [("Sample 1", [3, 9, 2, 7], False), ("Sample 2", [-8, -3, -12], False), ("All negative", [-50, -20, -90, -40], True),
                      ("Single element", [-7], True), ("Maximum at the end", [1, 2, 3, 1000000], True), ("Maximum at the start", [999999, 5, 3], True), ("1000 values", big, True)]:
    add("max-element", label, fmt_arr(a), sol_max(a), hid)
long_pal = "".join(random.choice("abc") for _ in range(499)); long_pal = long_pal + "x" + long_pal[::-1]
for label, s, hid in [("Sample 1", "racecar", False), ("Sample 2", "rocket", False), ("Single character", "z", True), ("Even length", "abba", True),
                      ("Almost a palindrome", "abcdba", True), ("Long palindrome", long_pal, True), ("Long, last letter differs", long_pal[:-1] + "q", True)]:
    add("palindrome", label, s + "\n", sol_pal(s), hid)
rand_ops = [random.choice([("push", random.randint(-100, 100)), ("pop",), ("peek",), ("size",)]) for _ in range(300)]
for label, ops, hid in [("Sample 1", [("push", 5), ("push", 8), ("peek",), ("pop",), ("size",)], False),
                        ("Sample 2", [("pop",), ("push", 3), ("pop",), ("peek",)], False),
                        ("Underflow on an empty stack", [("pop",), ("peek",), ("size",)], True),
                        ("Last in, first out", [("push", 1), ("push", 2), ("push", 3), ("pop",), ("pop",), ("pop",), ("pop",)], True),
                        ("300 random operations", rand_ops, True)]:
    add("implement-stack", label, fmt_stack(ops), sol_stack(ops), hid)
for label, (n, e, s), hid in [("Sample 1", (5, [(0, 1), (0, 2), (1, 3), (2, 4)], 0), False), ("Sample 2", (4, [(0, 1), (1, 2), (2, 3), (3, 0)], 2), False),
                              ("Disconnected vertices are skipped", (6, [(0, 1), (2, 3), (4, 5)], 2), True), ("Single vertex", (1, [], 0), True),
                              ("Neighbors visited in increasing order", (5, [(0, 4), (0, 3), (0, 1), (1, 2)], 0), True),
                              ("Random graph", (40, rand_edges(40, 70), 7), True)]:
    add("bfs", label, fmt_graph(n, e, s), sol_bfs(n, e, s), hid)
for label, (n, e, s), hid in [("Sample 1", (4, [(0, 1, 4), (0, 2, 1), (2, 1, 2), (1, 3, 5)], 0), False),
                              ("Sample 2", (3, [(0, 1, 7)], 0), False),
                              ("A longer route can be cheaper", (4, [(0, 3, 10), (0, 1, 1), (1, 2, 1), (2, 3, 1)], 0), True),
                              ("Zero-weight edges", (3, [(0, 1, 0), (1, 2, 0)], 0), True),
                              ("Source in the middle", (5, [(0, 1, 2), (1, 2, 2), (2, 3, 2), (3, 4, 2)], 2), True),
                              ("Random weighted graph", (30, rand_edges(30, 60, True), 0), True)]:
    add("dijkstra", label, fmt_graph(n, e, s), sol_dij(n, e, s), hid)
import os
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "problem_tests.json")
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump(P, open(out, "w"))
print({k: len(v) for k, v in P.items()})
