"""Every example in the library compiles, prints exactly what it should, and traces cleanly."""
from e2e import *
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
EXAMPLES = pathlib.Path(os.environ.get("EXAMPLES", HERE.parent.parent / "web" / "public" / "examples"))
EXPECTED = {
  "ArrayListExample": ["After adding 10, 20, 30: [10, 20, 30]", "Element at index 1: 20", "After setting index 1 to 25: [10, 25, 30]", "After inserting 15 at index 1: [10, 15, 25, 30]", "After removing the value 30: [10, 15, 25]", "After removing index 0: [15, 25]", "Sum while iterating: 40", "Size: 2, contains 25: true"],
  "LinkedListExample": ["Start: (empty)", "After inserts: 10 -> 20 -> 30 -> 40", "Contains 30: true", "Contains 99: false", "After removing 30: 10 -> 20 -> 40", "After removing the head 10: 20 -> 40", "Removing 99 succeeded: false", "Size: 2"],
  "StackExample": ["Pushed 10, 20, 30. Top is 30", "pop() returns 30", "pop() returns 20", "Empty? false", "pop() returns 10", "Empty? true", "Underflow handled: cannot pop from an empty stack"],
  "QueueExample": ["Enqueued 1, 2, 3. Front is 1", "dequeue() returns 1", "Enqueued 4 and 5; the tail wrapped around the array.", "dequeue() returns 2", "dequeue() returns 3", "dequeue() returns 4", "dequeue() returns 5", "Empty queue handled: cannot dequeue from an empty queue"],
  "HashMapExample": ["Pears in stock: 5", "After restocking pears: 7", "Has kiwis? false", "Kiwis, with a default: 0", "After removing plums, size is 2", "apples = 12", "pears = 7"],
  "BinarySearchTreeExample": ["Inorder (sorted): [20, 30, 40, 50, 60, 70, 80]", "Preorder: [50, 30, 20, 40, 70, 60, 80]", "Postorder: [20, 40, 30, 60, 80, 70, 50]", "Contains 60: true", "Contains 65: false"],
  "MinHeapExample": ["Minimum after inserting 5, 3, 8, 1, 4: 1", "Polled in order: 1 3 4 5 8"],
  "GraphExample": ["Neighbors of 0: [1, 2]", "Neighbors of 1: [0, 3]", "Neighbors of 2: [0, 3]", "Neighbors of 3: [1, 2]", "Neighbors of 4: [5]", "Neighbors of 5: [4]", "Connected to 0: [0, 1, 2, 3]", "4 and 5 form their own component."],
  "BFSExample": ["Vertex 0 is 0 edge(s) from 0", "Vertex 1 is 1 edge(s) from 0", "Vertex 2 is 1 edge(s) from 0", "Vertex 3 is 2 edge(s) from 0", "Vertex 4 is 2 edge(s) from 0", "Vertex 5 is 2 edge(s) from 0", "Vertex 6 is 3 edge(s) from 0", "BFS order from 0: [0, 1, 2, 3, 4, 5, 6]"],
  "DFSExample": ["Backtrack from 2", "Backtrack from 5", "Backtrack from 4", "Backtrack from 3", "Backtrack from 1", "Backtrack from 0", "DFS order from 0: [0, 1, 3, 2, 4, 5]"],
  "DijkstraExample": ["Distance to 0: 0", "Distance to 1: 3", "Distance to 2: 1", "Distance to 3: 4", "Distance to 4: 7", "Distance to 5: unreachable", "Shortest path to 4: [0, 2, 1, 3, 4] (cost 7)", "Rejected: Dijkstra needs nonnegative weights, got -2"],
  "LinearSearchExample": ["Index of 4: 3", "Index of 6: -1"],
  "BinarySearchExample": ["Index of 23: 5", "Index of 7: -1"],
  "BubbleSortExample": ["Sorted: [1, 2, 4, 5, 8]"],
  "MergeSortExample": ["Sorted: [3, 9, 10, 27, 38, 43, 82]"],
  "QuickSortExample": ["Sorted: [1, 5, 7, 8, 9, 10]"],
  "FactorialExample": ["5! recursively = 120", "10! with a loop = 3628800", "20! = 2432902008176640000"],
  "FibonacciExample": ["fib(10) by plain recursion = 55 (177 calls)", "fib(50) with memoization = 12586269025", "fib(12) bottom-up = 144"],
  "ClimbingStairsExample": ["Ways to climb 5 steps: 8", "Ways to climb 10 steps: 89"],
  "CoinChangeExample": ["Fewest coins for 11 with {1, 2, 5}: 3", "Fewest coins for 3 with {2}: -1"],
}
EXPECTED.update({
 "RunLengthEncodingExample": [
  "Original: AAABBBCCDAA (11 chars)",
  "Encoded:  3A3B2C1D2A (10 chars)",
  "Decoded:  AAABBBCCDAA",
  "Round trip matches: true",
  "Without runs it grows: ABCD becomes 1A1B1C1D"
 ],
 "LZWCompressionExample": [
  "Alphabet: [B, E, N, O, R, T]",
  "Codes: [5, 3, 0, 1, 3, 4, 2, 3, 5, 6, 8, 10, 15, 9, 11, 13]",
  "24 characters became 16 codes",
  "Decompressed: TOBEORNOTTOBEORTOBEORNOT",
  "Round trip matches: true"
 ],
 "EditDistanceExample": [
  "kitten -> sitting: 3",
  "sunday -> saturday: 3",
  "same -> same: 0"
 ],
 "BellmanFordExample": [
  "Distances from 0: [0, 2, 7, 4, -2]",
  "Graph with a negative cycle: negative cycle detected"
 ],
 "PushRelabelExample": [
  "Maximum flow from 0 to 5: 23"
 ],
 "KMeansExample": ["Converged after 2 rounds", "Cluster 0 center: (1.40, 1.25)", "Cluster 1 center: (6.30, 6.40)", "Cluster 2 center: (1.20, 6.75)", "Assignments: [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2]"],
 "UnboundedKnapsackExample": [
  "Best value for capacity 8: 110",
  "Best value for capacity 2: 20"
 ],
 "BoundedKnapsackExample": [
  "Best value for capacity 10: 15",
  "Taken: item 0 x3, item 1 x0, item 2 x1"
 ]
})
EXPECTED.update({
 "ScannerBasicsExample": [
  "Name: Kyu Han",
  "Age: 20",
  "GPA: 3.85"
 ],
 "ScannerIntegersExample": [
  "Sum: 20",
  "Largest: 9"
 ],
 "NextIntNextLinePitfallExample": [
  "age=20 name=[]",
  "The name was still waiting: Kyu",
  "Fixed: age=21 name=[Han]"
 ],
 "NumbersOnOneLineExample": [
  "Sum: 25",
  "Smallest: -2"
 ],
 "BufferedReaderLinesExample": [
  "1: [first line]",
  "2: []",
  "3: [  third, with spaces]"
 ],
 "StringTokenizerExample": [
  "Kyu Han",
  "20",
  "20"
 ],
 "ParseIntExample": [
  "Sum: 154"
 ],
 "ReadUntilEndExample": [
  "4 numbers, sum 50"
 ],
 "InvalidNumberExample": [
  "ok: 12",
  "not an int: abc",
  "ok: 7",
  "not an int: 3.5"
 ],
 "ReadMatrixExample": [
  "Row 0 sum: 6",
  "Row 1 sum: 15"
 ]
})
# Input examples run with the stdin the example library gives them.
STDIN = {
 "ScannerBasicsExample": "Kyu Han\n20\n3.85\n",
 "ScannerIntegersExample": "4 7 9\n",
 "NextIntNextLinePitfallExample": "20\nKyu\n21\nHan\n",
 "NumbersOnOneLineExample": "5\n3 8 -2 10 6\n",
 "BufferedReaderLinesExample": "first line\n\n  third, with spaces\n",
 "StringTokenizerExample": "Kyu Han\n20\n12 8\n",
 "ParseIntExample": "42 17 -5 100\n",
 "ReadUntilEndExample": "5 10 15\n20\n",
 "InvalidNumberExample": "12\nabc\n7\n3.5\n",
 "ReadMatrixExample": "2 3\n1 2 3\n4 5 6\n"
}
files = sorted(EXAMPLES.glob("*.java"))
check(f"all {len(EXPECTED)} examples are present", {f.stem for f in files} == set(EXPECTED), sorted(f.stem for f in files))
for f in files:
    src = {f.name: f.read_text()}
    s, j = execute(src, stdin=STDIN.get(f.stem, ""))
    out = j["result"].get("stdout", "").strip().split("\n")
    check(f"{f.stem}: compiles with no warnings and prints the expected output",
          j["status"] == "completed" and out == EXPECTED[f.stem] and not j["result"]["diagnostics"],
          (j["status"], j["result"].get("diagnostics"), out, j["result"].get("stderr", "")[:300]))
    s, j = execute(src, mode="trace", stdin=STDIN.get(f.stem, ""))
    t = j["result"].get("trace") or {}
    check(f"{f.stem}: traces to completion ({t.get('stepCount')} steps)", j["status"] == "completed" and not t.get("truncated"), (j["status"], t.get("stopReason"), j["result"].get("error")))
    (HERE / "fixtures").mkdir(exist_ok=True)
    json.dump({"files": src, "result": j["result"]}, open(HERE / "fixtures" / f"ex_{f.stem}.json", "w"))

# The workspace adds each example in its own folder and package (examples/<slug>/, package
# examples.<slug>), so several examples and the user's own files compile together. Each one must
# behave exactly as it does on its own.
import re as _re
section("examples run the same from their own package")
together = {}
for f in sorted(EXAMPLES.glob("*.java")):
    if f.stem not in EXPECTED: continue
    slug = _re.sub(r"Example$", "", f.stem).lower()
    path = f"examples/{slug}/{f.name}"
    together[path] = f"package examples.{slug};\n\n" + f.read_text()
    s, j = execute({path: together[path]}, stdin=STDIN.get(f.stem, ""))
    out = j["result"].get("stdout", "").strip().split("\n")
    check(f"{f.stem}: same output from package examples.{slug}", j["status"] == "completed" and out == EXPECTED[f.stem], (j["status"], out[:3], j["result"].get("error")))
inherit = EXAMPLES / "inheritance"
together.update({f"examples/inheritance/{p.relative_to(inherit)}": p.read_text() for p in inherit.rglob("*.java")})
s, j = execute(together, mode="compile")
check(f"all {len(together)} example files compile together as one project", j["status"] == "completed", [d["message"] for d in j["result"].get("diagnostics", []) if d["severity"] == "error"][:3])

print(f"\n{len(passed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
