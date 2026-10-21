/** The built-in Java example library. Sources live in public/examples and load on demand. */
export type Example = {
  id: string;
  file: string;
  title: string;
  category: "Data structures" | "Graph algorithms" | "Sorting and searching" | "Recursion and dynamic programming" | "Compression" | "Machine learning" | "Input and output" | "Object-oriented programming" | "Python" | "C: memory and pointers" | "C++";
  summary: string;
  complexity: string;
  visual: "tree" | "list" | "graph" | "map" | "array" | "stack" | "grid" | "points" | "input" | "none";
  /** Standard input the example expects; filled into the Input tab when it opens. */
  stdin?: string;
  /**
   * Multi-file examples: paths under public/examples/<dir>/, already written with packages under
   * examples.<dir>. `file` is then the entry point, relative to the same folder.
   */
  dir?: string;
  files?: string[];
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
  e("PermutationsExample", "Permutations (backtracking)", "Recursion and dynamic programming", "Every ordering of 1, 2, 3: choose a number, recurse, then undo the choice.", "O(n · n!) time; recursion uses O(n) stack", "array"),
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
  {
    ...e("CStack", "Stack variables and calls", "C: memory and pointers", "Each call gets its own frame; swap receives addresses into main's frame.", "", "none"),
    file: "main.c",
    dir: "c_stack",
    files: ["main.c"],
  },
  {
    ...e("CMallocFree", "malloc and free", "C: memory and pointers", "Allocate, use, free, and see the pointer left dangling.", "", "none"),
    file: "main.c",
    dir: "c_malloc_free",
    files: ["main.c"],
  },
  {
    ...e("CCalloc", "calloc versus malloc", "C: memory and pointers", "calloc zeroes its memory; malloc's stays unset until written.", "", "none"),
    file: "main.c",
    dir: "c_calloc",
    files: ["main.c"],
  },
  {
    ...e("CRealloc", "realloc and a growing array", "C: memory and pointers", "Capacity doubles; watch realloc keep or move the block.", "", "none"),
    file: "main.c",
    dir: "c_realloc",
    files: ["main.c"],
  },
  {
    ...e("CPointerArithmetic", "Pointer arithmetic", "C: memory and pointers", "p + i moves i elements; one past the end may be formed, not used.", "", "none"),
    file: "main.c",
    dir: "c_pointer_arithmetic",
    files: ["main.c"],
  },
  {
    ...e("CStrings", "Dynamic strings", "C: memory and pointers", "A heap buffer grows with realloc as words are appended.", "", "none"),
    file: "main.c",
    dir: "c_strings",
    files: ["main.c"],
  },
  {
    ...e("CStructs", "Structs and pointers to structs", "C: memory and pointers", "A copy, a pointer, and a heap struct reached with ->.", "", "none"),
    file: "main.c",
    dir: "c_structs",
    files: ["main.c"],
  },
  {
    ...e("CLinkedList", "Linked list (3 files)", "C: memory and pointers", "Nodes on the heap, push through a pointer-to-pointer, freeing in order.", "", "none"),
    file: "main.c",
    dir: "c_linked_list",
    files: ["main.c", "list.c", "list.h"],
  },
  {
    ...e("CStackQueue", "Stack and queue", "C: memory and pointers", "An array stack and a linked queue that frees as it dequeues.", "", "none"),
    file: "main.c",
    dir: "c_stack_queue",
    files: ["main.c"],
  },
  {
    ...e("CBinaryTree", "Binary search tree", "C: memory and pointers", "One heap node per value, an in-order walk, and freeing children first.", "", "none"),
    file: "main.c",
    dir: "c_binary_tree",
    files: ["main.c"],
  },
  {
    ...e("CPointerToPointer", "Pointer-to-pointer parameters", "C: memory and pointers", "A function that changes the caller's int, and one that sets the caller's pointer.", "", "none"),
    file: "main.c",
    dir: "c_pointer_to_pointer",
    files: ["main.c"],
  },
  {
    ...e("CLeak", "A memory leak (diagnostic)", "C: memory and pointers", "A block whose last pointer is lost: leaked at exit, reported by LeakSanitizer.", "", "none"),
    file: "main.c",
    dir: "c_leak",
    files: ["main.c"],
  },
  {
    ...e("CInvalidOps", "Invalid memory operations (safe demo)", "C: memory and pointers", "A dangling pointer by default; Input use or double shows the sanitizer stopping it.", "", "none"),
    file: "main.c",
    dir: "c_invalid_ops",
    files: ["main.c"],
    stdin: "show\n",
  },
  {
    ...e("CppNewDelete", "new and delete", "C++", "new and delete for one object, new[] and delete[] for an array.", "", "none"),
    file: "main.cpp",
    dir: "cpp_new_delete",
    files: ["main.cpp"],
  },
  {
    ...e("CppVector", "std::vector growth", "C++", "Watch the vector's buffer get reallocated as it grows.", "", "none"),
    file: "main.cpp",
    dir: "cpp_vector",
    files: ["main.cpp"],
  },
  {
    ...e("CppSmartPointers", "unique_ptr, shared_ptr, weak_ptr", "C++", "Moving ownership, counting owners, and watching without owning.", "", "none"),
    file: "main.cpp",
    dir: "cpp_smart_pointers",
    files: ["main.cpp"],
  },
  {
    ...e("CppRaii", "RAII and object lifetime", "C++", "Constructors acquire, destructors release, in reverse order at scope end.", "", "none"),
    file: "main.cpp",
    dir: "cpp_raii",
    files: ["main.cpp"],
  },
  {
    ...e("CppStackObjects", "Stack objects and references", "C++", "Objects in main's frame, references to them, and destruction in reverse order.", "", "none"),
    file: "main.cpp",
    dir: "cpp_stack_objects",
    files: ["main.cpp"],
  },
  {
    ...e("CppArrays", "Arrays and pointer arithmetic", "C++", "A built-in array walked by pointer, std::array, and new[] with delete[].", "", "none"),
    file: "main.cpp",
    dir: "cpp_arrays",
    files: ["main.cpp"],
  },
  {
    ...e("CppConstructors", "Constructors and destructors", "C++", "Base, member, then body; destruction in exactly the reverse order.", "", "none"),
    file: "main.cpp",
    dir: "cpp_constructors",
    files: ["main.cpp"],
  },
  {
    ...e("CppCopyMove", "Copy and move semantics", "C++", "Copying allocates a new block; moving takes it over and empties the source.", "", "none"),
    file: "main.cpp",
    dir: "cpp_copy_move",
    files: ["main.cpp"],
  },
  {
    ...e("CppInheritance", "Inheritance and polymorphism", "C++", "Virtual dispatch through unique_ptr<Animal>, and virtual destructors.", "", "none"),
    file: "main.cpp",
    dir: "cpp_inheritance",
    files: ["main.cpp"],
  },
  {
    ...e("CppContainers", "Standard containers", "C++", "vector, map, set, unordered_map, stack, queue, and priority_queue.", "", "none"),
    file: "main.cpp",
    dir: "cpp_containers",
    files: ["main.cpp"],
  },
  {
    ...e("CppListTree", "Linked list and tree with unique_ptr", "C++", "Nodes own their successors, so everything is freed with no delete.", "", "none"),
    file: "main.cpp",
    dir: "cpp_list_tree",
    files: ["main.cpp"],
  },
  {
    ...e("CppLifetimeMistakes", "Lifetime mistakes (safe demo)", "C++", "Dangling references, moved-from objects, and weak_ptr expiry, by Input.", "", "none"),
    file: "main.cpp",
    dir: "cpp_lifetime_mistakes",
    files: ["main.cpp"],
    stdin: "safe\n",
  },
  {
    ...e("PyHello", "Python basics", "Python", "Variables, runtime types, arithmetic, and f-strings.", "watch a name change type", "none"),
    file: "hello.py",
    dir: "py_basics",
    files: ["hello.py"],
  },
  {
    ...e("PyInput", "Reading input in Python", "Python", "input(), int(), split(), and map(), fed from the Input tab.", "one input() per line", "input"),
    file: "greet.py",
    dir: "py_input",
    files: ["greet.py"],
    stdin: "Kyu\n19\n3 4\n",
  },
  {
    ...e("PyCollections", "Lists, dicts, sets, tuples", "Python", "Python's collections, slicing, and comprehensions.", "values as they change", "list"),
    file: "collections_demo.py",
    dir: "py_collections",
    files: ["collections_demo.py"],
  },
  {
    ...e("PyFunctions", "Functions, loops, and recursion", "Python", "for and while loops, functions, and a recursive factorial.", "one frame per call", "none"),
    file: "functions_loops.py",
    dir: "py_functions",
    files: ["functions_loops.py"],
  },
  {
    ...e("PyInheritance", "Python inheritance", "Python", "Classes across two files, overriding, and super().", "dispatch picks the object's own method", "none"),
    file: "main.py",
    dir: "py_inheritance",
    files: ["main.py", "animals.py"],
  },
  {
    ...e("PyProject", "A Python package", "Python", "A multi-file project: a package with a relative import.", "imports across folders", "none"),
    file: "main.py",
    dir: "py_project",
    files: ["main.py", "geometry/__init__.py", "geometry/shapes.py", "geometry/report.py"],
  },
  {
    ...e("PyPascal", "Pascal's triangle in Python (DP)", "Python", "Bottom-up, memoized with a dict, and with no cache. Open the Dynamic programming tab.", "O(n²); plain recursion grows exponentially", "grid"),
    file: "pascal_triangle.py",
    dir: "py_pascal",
    files: ["pascal_triangle.py", "pascal_memo.py", "pascal_naive.py"],
    stdin: "6\n",
  },
  {
    ...e("PascalTriangle", "Pascal's triangle (dynamic programming)", "Recursion and dynamic programming", "Build the triangle bottom-up, then top-down with a cache, then without one. Open the Dynamic programming tab.", "O(n²) for n rows; plain recursion grows exponentially", "grid"),
    dir: "pascaltriangle",
    files: ["PascalTriangle.java", "PascalTriangleMemoized.java", "PascalTriangleNaive.java"],
    stdin: "6\n",
  },
  {
    ...e("InheritanceExample", "Inheritance and polymorphism", "Object-oriented programming", "An abstract Animal, Dog and Cat below it, and ServiceDog below Dog, across folders and packages.", "dispatch picks the object's own method", "none"),
    dir: "inheritance",
    files: ["InheritanceExample.java", "animals/Animal.java", "animals/Dog.java", "animals/Cat.java", "animals/ServiceDog.java", "animals/Trained.java"],
  },
];

export const CATEGORIES = [...new Set(EXAMPLES.map((x) => x.category))];
export const exampleById = (id: string) => EXAMPLES.find((x) => x.id === id) ?? null;
