/**
 * The whole scroll journey is described here. Every visual is a pure function of
 * scroll progress p in [0, 1], so scrolling backward or jumping always lands on a
 * consistent state.
 */

export type Phase = { id: string; label: string; start: number; end: number };
export type Chapter = { id: string; title: string; body: string; start: number; end: number; phases: Phase[] };

export const CHAPTERS: Chapter[] = [
  {
    id: "tree",
    title: "Binary search tree",
    body: "Smaller values branch left, larger values branch right. Here is the same tree, walked three ways.",
    start: 0.0,
    end: 0.23,
    phases: [
      { id: "preorder", label: "Preorder: node, then left, then right", start: 0.055, end: 0.105 },
      { id: "inorder", label: "Inorder: left, then node, then right", start: 0.11, end: 0.16 },
      { id: "postorder", label: "Postorder: left, then right, then node", start: 0.165, end: 0.215 },
    ],
  },
  {
    id: "list",
    title: "Linked list",
    body: "Each node only knows where the next one lives. To reach the end, you follow every link.",
    start: 0.23,
    end: 0.37,
    phases: [
      { id: "traverse", label: "Traversal from head to tail", start: 0.27, end: 0.335 },
      { id: "morph", label: "Packing the nodes into contiguous memory", start: 0.345, end: 0.395 },
    ],
  },
  {
    id: "array",
    title: "Array",
    body: "Cells sit side by side in memory, so any index is a single jump away.",
    start: 0.37,
    end: 0.53,
    phases: [
      { id: "index", label: "Index access", start: 0.4, end: 0.425 },
      { id: "linear", label: "Linear search for 30", start: 0.43, end: 0.47 },
      { id: "binary", label: "Binary search for 30", start: 0.475, end: 0.52 },
    ],
  },
  {
    id: "hash",
    title: "Hash map",
    body: "A hash function sends each key straight to a bucket. Keys that collide share a chain.",
    start: 0.53,
    end: 0.67,
    phases: [
      { id: "insert", label: "Insert: bucket = key % 5", start: 0.545, end: 0.615 },
      { id: "lookup", label: "Lookup: get(41)", start: 0.62, end: 0.66 },
    ],
  },
  {
    id: "graph",
    title: "Graph",
    body: "Nodes and edges with no fixed shape. Breadth-first search spreads in rings; depth-first dives down one path at a time.",
    start: 0.67,
    end: 0.83,
    phases: [
      { id: "emerge", label: "Building the graph", start: 0.67, end: 0.705 },
      { id: "bfs", label: "Breadth-first search from A", start: 0.71, end: 0.75 },
      { id: "dfs", label: "Depth-first search from A", start: 0.755, end: 0.79 },
      { id: "path", label: "Shortest path from A to J", start: 0.795, end: 0.82 },
    ],
  },
  {
    id: "linear",
    title: "Stack and queue",
    body: "A stack serves the newest item first. A queue serves the oldest.",
    start: 0.83,
    end: 0.94,
    phases: [{ id: "ops", label: "push and pop, enqueue and dequeue", start: 0.855, end: 0.93 }],
  },
];

export const OPENING_END = 0.04;
export const FINALE_START = 0.945;

export type Vec3 = [number, number, number];
export type CameraKey = { p: number; pos: Vec3; look: Vec3; travel?: boolean };

/* Where each structure lives in the world. The camera travels forward (negative z) through the grid. */
export const ANCHORS = {
  tree: [0, 1.6, 0] as Vec3,
  sequence: [-7, 0.6, -46] as Vec3,
  graph: [10, 3.2, -96] as Vec3,
  linear: [-6, 0.4, -142] as Vec3,
};

export const CAMERA_KEYS: CameraKey[] = [
  { p: 0.0, pos: [0, 0.6, 21], look: [0, 1.6, 0] },
  { p: 0.05, pos: [2.5, 2.6, 18], look: [0, 1.4, 0] },
  { p: 0.135, pos: [-1.5, 3.4, 17.5], look: [0, 1.2, 0] },
  { p: 0.215, pos: [-4.5, 4.2, 16.5], look: [0, 1.2, 0] },
  { p: 0.27, pos: [-4, 4.4, -27], look: [-7, 0.6, -46], travel: true },
  { p: 0.34, pos: [-9.5, 4.6, -28], look: [-7, 0.6, -46] },
  { p: 0.4, pos: [-7, 3.6, -33.5], look: [-7, 0.6, -46] },
  { p: 0.52, pos: [-9.5, 4.4, -33.5], look: [-7, 0.8, -47] },
  { p: 0.55, pos: [-6, 8.6, -31], look: [-7, 2, -50] },
  { p: 0.66, pos: [-9.5, 7.6, -31.5], look: [-7, 2, -50] },
  { p: 0.705, pos: [17, 6, -80], look: [10, 3.2, -96], travel: true },
  { p: 0.76, pos: [21, 5, -88], look: [10, 3.2, -96] },
  { p: 0.82, pos: [5, 8, -81], look: [10, 3.2, -96] },
  { p: 0.86, pos: [-3, 3.4, -130.5], look: [-5.2, 0.2, -142], travel: true },
  { p: 0.935, pos: [-7.8, 3.8, -131], look: [-5.2, 0.2, -142] },
  { p: 1.0, pos: [84, 88, -144], look: [-0.8, -4.5, -71], travel: true },
];

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const local = (p: number, start: number, end: number) => clamp01((p - start) / (end - start));
export const smooth = (x: number) => x * x * (3 - 2 * x);
export const smoother = (x: number) => x * x * x * (x * (x * 6 - 15) + 10);

export function chapterAt(p: number): Chapter | null {
  if (p < OPENING_END || p >= FINALE_START) return null;
  return CHAPTERS.find((c) => p >= c.start && p < c.end) ?? null;
}

export function phaseAt(chapter: Chapter, p: number): Phase | null {
  return chapter.phases.find((ph) => p >= ph.start && p <= ph.end) ?? null;
}

export function phase(chapterId: string, phaseId: string): Phase {
  const ph = CHAPTERS.find((c) => c.id === chapterId)?.phases.find((x) => x.id === phaseId);
  if (!ph) throw new Error(`Unknown phase ${chapterId}/${phaseId}`);
  return ph;
}

/** Progress through a phase: 0 before it starts, 1 after it ends. */
export const phaseProgress = (p: number, chapterId: string, phaseId: string) => {
  const ph = phase(chapterId, phaseId);
  return local(p, ph.start, ph.end);
};

/** The scroll position (as progress) that best shows a chapter, used by the chapter rail. */
export const chapterFocus = (c: Chapter) => (c.phases[0]?.start ?? c.start) + 0.004;
