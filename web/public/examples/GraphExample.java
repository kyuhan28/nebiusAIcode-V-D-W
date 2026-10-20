import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/**
 * An undirected graph stored as an adjacency list: one list of neighbors per vertex.
 * Adding a vertex or an edge is O(1); listing a vertex's neighbors is O(degree).
 * Space is O(V + E), which suits sparse graphs.
 */
public class GraphExample {
    static List<List<Integer>> graph = new ArrayList<>();

    static int addVertex() {
        graph.add(new ArrayList<>());
        return graph.size() - 1;
    }

    static void addEdge(int u, int v) {
        graph.get(u).add(v);
        graph.get(v).add(u);
    }

    /** Every vertex reachable from start, found with an explicit stack. */
    static List<Integer> connected(int start) {
        boolean[] seen = new boolean[graph.size()];
        List<Integer> found = new ArrayList<>();
        Deque<Integer> stack = new ArrayDeque<>();
        stack.push(start);
        seen[start] = true;
        while (!stack.isEmpty()) {
            int u = stack.pop();
            found.add(u);
            for (int v : graph.get(u)) {
                if (!seen[v]) {
                    seen[v] = true;
                    stack.push(v);
                }
            }
        }
        return found;
    }

    public static void main(String[] args) {
        for (int i = 0; i < 6; i++) {
            addVertex();
        }
        addEdge(0, 1);
        addEdge(0, 2);
        addEdge(1, 3);
        addEdge(2, 3);
        addEdge(4, 5);

        for (int u = 0; u < graph.size(); u++) {
            System.out.println("Neighbors of " + u + ": " + graph.get(u));
        }
        List<Integer> reach = connected(0);
        reach.sort(null);
        System.out.println("Connected to 0: " + reach);
        System.out.println("4 and 5 form their own component.");
    }
}
