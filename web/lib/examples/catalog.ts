/** The built-in Java example library. Sources live in public/examples and load on demand. */
export type Example = {
  id: string;
  file: string;
  title: string;
  category: "Data structures" | "Graph algorithms" | "Sorting and searching" | "Recursion and dynamic programming" | "Compression" | "Machine learning" | "Input and output";
  summary: string;
  complexity: string;
  visual: "tree" | "list" | "graph" | "map" | "array" | "stack" | "grid" | "points" | "input" | "none";
  /** Standard input the example expects; filled into the Input tab when it opens. */
  stdin?: string;
};

const e = (id: string, title: string, category: Example["category"], summary: string, complexity: string, visual: Example["visual"]): Example => ({
  id,
  file: `${id}.java`,
  title,
  category,
  summary,
  complexity,
  visual,
});

export const EXAMPLES: Example[] = [
  e("ArrayListExample", "ArrayList", "Data structures", "Add, read, update, insert, remove, and iterate over a resizable array.", "get O(1), add at end amortized O(1), insert or remove in the middle O(n)", "array"),
  e("LinkedListExample", "Linked list", "Data structures", "A singly linked list of Node objects: insert at either end, search, delete, traverse.", "insert at head O(1); insert at tail, search, delete O(n)", "list"),
  e("StackExample", "Stack", "Data structures", "Push, pop, peek, and underflow on an array-backed stack. Last in, first out.", "every operation O(1)", "stack"),
  e("QueueExample", "Queue", "Data structures", "Enqueue and dequeue on a circular array that wraps around. First in, first out.", "every operation O(1)", "stack"),
  e("HashMapExample", "HashMap", "Data structures", "Insert, look up, update, check, remove, and iterate over key-value pairs.", "put, get, remove O(1) on average", "map"),
  e("BinarySearchTreeExample", "Binary search tree", "Data structures", "Insert and search, then inorder, preorder, and postorder traversals.", "insert and search O(h), traversals O(n)", "tree"),
  e("MinHeapExample", "Min-heap", "Data structures", "An array-backed heap that keeps the minimum at the root as values come and go.", "peek O(1), insert and poll O(log n)", "array"),
  e("GraphExample", "Graph", "Data structures", "An undirected adjacency-list graph with neighbors and connected vertices.", "add edge O(1), space O(V + E)", "graph"),
  e("BFSExample", "Breadth-first search", "Graph algorithms", "Explore a graph ring by ring with a queue, recording each vertex's distance in edges.", "O(V + E) time, O(V) space", "graph"),
  e("DFSExample", "Depth-first search", "Graph algorithms", "Follow one branch to its end, then backtrack, on a graph with a cycle.", "O(V + E) time", "graph"),
  e("DijkstraExample", "Dijkstra's shortest paths", "Graph algorithms", "Cheapest routes on a weighted graph with a priority queue, plus path reconstruction.", "O((V + E) log V)", "graph"),
  e("BellmanFordExample", "Bellman-Ford", "Graph algorithms", "Shortest paths that allow negative weights, plus negative-cycle detection, on an edge list.", "O(V × E)", "graph"),
  e("PushRelabelExample", "Push-relabel max flow", "Graph algorithms", "Flood a network from the source, pushing excess downhill and relabeling heights.", "O(V³) with a FIFO queue", "graph"),
  e("LinearSearchExample", "Linear search", "Sorting and searching", "Check each element in turn until the target turns up.", "O(n) time, O(1) space", "array"),
  e("BinarySearchExample", "Binary search", "Sorting and searching", "Halve a sorted range each step with lo, mid, and hi.", "O(log n) time, O(1) space", "array"),
  e("BubbleSortExample", "Bubble sort", "Sorting and searching", "Swap adjacent out-of-order pairs until a pass makes no swaps.", "O(n²) time, O(1) space", "array"),
  e("MergeSortExample", "Merge sort", "Sorting and searching", "Split in half, sort each half, and merge them back together.", "O(n log n) time, O(n) space", "array"),
  e("QuickSortExample", "Quicksort", "Sorting and searching", "Partition around a pivot, then sort each side.", "O(n log n) average, O(n²) worst", "array"),
  e("FactorialExample", "Factorial", "Recursion and dynamic programming", "n! recursively and with a loop, and why long stops at 20!.", "O(n) time; recursion uses O(n) stack", "none"),
  e("FibonacciExample", "Fibonacci", "Recursion and dynamic programming", "Plain recursion, memoization, and a bottom-up table, side by side.", "naive O(2ⁿ); memoized and bottom-up O(n)", "array"),
  e("ClimbingStairsExample", "Climbing stairs", "Recursion and dynamic programming", "Count the ways to climb n steps one or two at a time.", "O(n) time and space", "array"),
  e("CoinChangeExample", "Coin change", "Recursion and dynamic programming", "The fewest coins for an amount, or -1 when it can't be made.", "O(amount × coins) time, O(amount) space", "array"),
  e("EditDistanceExample", "Edit distance", "Recursion and dynamic programming", "Fewest inserts, deletes, and substitutions between two strings, as a 2D table.", "O(m × n) time and space", "grid"),
  e("UnboundedKnapsackExample", "Unbounded knapsack", "Recursion and dynamic programming", "Best value when every item can be taken any number of times.", "O(n × W) time, O(W) space", "array"),
  e("BoundedKnapsackExample", "Bounded knapsack", "Recursion and dynamic programming", "Best value when each item has a limited number of copies, with the choice reconstructed.", "O(W × total copies) time, O(n × W) space", "grid"),
  e("RunLengthEncodingExample", "Run-length encoding", "Compression", "Replace runs of repeated characters with counts, then decode them back.", "O(n) both ways", "array"),
  e("LZWCompressionExample", "LZW compression", "Compression", "Build a dictionary while reading, emit codes, and rebuild it to decompress.", "O(n) dictionary lookups", "map"),
  e("KMeansExample", "K-means clustering", "Machine learning", "Assign points to the nearest centroid, move centroids to the mean, repeat.", "O(n × k) per round", "points"),
  { ...e("ScannerBasicsExample", "Scanner basics", "Input and output", "nextLine() for a name, nextInt() for an age, nextDouble() for a GPA.", "one token or line per call", "input"), stdin: "Kyu Han\n20\n3.85\n" },
  { ...e("ScannerIntegersExample", "Reading integers", "Input and output", "nextInt() skips whitespace and reads one integer at a time.", "one token per call", "input"), stdin: "4 7 9\n" },
  { ...e("NextIntNextLinePitfallExample", "The nextInt() and nextLine() pitfall", "Input and output", "Why nextLine() can return \"\" after nextInt(), and the one-line fix.", "the newline left behind", "input"), stdin: "20\nKyu\n21\nHan\n" },
  { ...e("NumbersOnOneLineExample", "Numbers on one line", "Input and output", "Read a count, then that many numbers from a single line.", "token reads ignore line breaks", "input"), stdin: "5\n3 8 -2 10 6\n" },
  { ...e("BufferedReaderLinesExample", "BufferedReader lines", "Input and output", "readLine() keeps spaces and empty lines, and returns null at the end.", "one line per call", "input"), stdin: "first line\n\n  third, with spaces\n" },
  { ...e("StringTokenizerExample", "StringTokenizer", "Input and output", "Read lines, split one into tokens, and parse each token.", "lines, then tokens, then ints", "input"), stdin: "Kyu Han\n20\n12 8\n" },
  { ...e("ParseIntExample", "Integer.parseInt", "Input and output", "Turn every token on a line into an int until none are left.", "text in, int out", "input"), stdin: "42 17 -5 100\n" },
  { ...e("ReadUntilEndExample", "Read until the end", "Input and output", "hasNextInt() keeps a loop going until the input runs out.", "reading an unknown amount", "input"), stdin: "5 10 15\n20\n" },
  { ...e("InvalidNumberExample", "Invalid numbers", "Input and output", "Catch NumberFormatException for lines like \"abc\" and \"3.5\".", "parse errors, handled", "input"), stdin: "12\nabc\n7\n3.5\n" },
  { ...e("ReadMatrixExample", "Reading a matrix", "Input and output", "Read the size, then fill a 2D array value by value.", "a grid filled from input", "input"), stdin: "2 3\n1 2 3\n4 5 6\n" },
];

export const CATEGORIES = [...new Set(EXAMPLES.map((x) => x.category))];
export const exampleById = (id: string) => EXAMPLES.find((x) => x.id === id) ?? null;
