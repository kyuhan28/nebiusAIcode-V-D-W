import { binarySearch, linearSearch } from "../algorithms/search";
import { bfs, dfs, makeGraph, pathTo } from "../algorithms/graph";
import { buildBST, traverse, type TraversalKind } from "../algorithms/tree";
import { hashInserts, hashLookup } from "../algorithms/hashmap";
import { runLinear } from "../algorithms/linear";

/* Binary search tree */
export const TREE_VALUES = [50, 28, 74, 15, 39, 62, 88, 8, 22, 33, 45, 81, 95];
export const TREE = buildBST(TREE_VALUES);
export const TRAVERSALS: TraversalKind[] = ["preorder", "inorder", "postorder"];
export const TREE_ORDERS = Object.fromEntries(TRAVERSALS.map((k) => [k, traverse(TREE.nodes, TREE.root, k)])) as Record<
  TraversalKind,
  number[]
>;

/* One sorted sequence that is a linked list, then an array, then the keys of a hash map */
export const SEQUENCE = [3, 8, 12, 17, 21, 26, 30, 34, 41, 47];
export const INDEX_TARGET = 6;
export const SEARCH_TARGET = 30;
export const LINEAR_STEPS = linearSearch(SEQUENCE, SEARCH_TARGET);
export const BINARY_STEPS = binarySearch(SEQUENCE, SEARCH_TARGET);
export const BUCKETS = 5;
export const HASH_INSERTS = hashInserts(SEQUENCE, BUCKETS);
export const LOOKUP_KEY = 41;
export const HASH_LOOKUP = hashLookup(HASH_INSERTS, BUCKETS, LOOKUP_KEY);

/* Graph */
export const GRAPH_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
export const GRAPH_EDGES: [number, number][] = [
  [0, 1], [0, 2], [1, 3], [1, 4], [2, 4], [2, 5], [3, 6], [4, 6], [4, 7], [5, 7], [6, 8], [7, 9], [8, 9],
];
export const GRAPH = makeGraph(GRAPH_LABELS, GRAPH_EDGES);
export const GRAPH_START = 0;
export const GRAPH_TARGET = 9;
export const BFS = bfs(GRAPH, GRAPH_START);
export const DFS = dfs(GRAPH, GRAPH_START);
export const SHORTEST_PATH = pathTo(BFS.parent, GRAPH_START, GRAPH_TARGET);

/* Stack and queue, run side by side with the same number of operations */
export const STACK_FRAMES = runLinear("stack", [
  { kind: "push", value: 7 },
  { kind: "push", value: 3 },
  { kind: "push", value: 9 },
  { kind: "push", value: 5 },
  { kind: "pop" },
  { kind: "pop" },
]);
export const QUEUE_FRAMES = runLinear("queue", [
  { kind: "enqueue", value: 4 },
  { kind: "enqueue", value: 1 },
  { kind: "enqueue", value: 6 },
  { kind: "enqueue", value: 2 },
  { kind: "dequeue" },
  { kind: "dequeue" },
]);
