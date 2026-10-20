import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Depth-first search follows one branch as far as it goes, then backtracks to the most recent
 * vertex with an unexplored neighbor. The visited array prevents infinite loops on cycles.
 * Neighbors are sorted so the order is deterministic. O(V + E) time.
 */
public class DFSExample {
    static List<List<Integer>> graph = new ArrayList<>();
    static boolean[] visited;
    static List<Integer> order = new ArrayList<>();

    static void addEdge(int u, int v) {
        graph.get(u).add(v);
        graph.get(v).add(u);
    }

    static void dfs(int u) {
        visited[u] = true;
        order.add(u);
        for (int v : graph.get(u)) {
            if (!visited[v]) {
                dfs(v);
            }
        }
        System.out.println("Backtrack from " + u);
    }

    public static void main(String[] args) {
        for (int i = 0; i < 6; i++) {
            graph.add(new ArrayList<>());
        }
        addEdge(0, 1);
        addEdge(0, 2);
        addEdge(1, 3);
        addEdge(2, 3);
        addEdge(3, 4);
        addEdge(4, 5);
        addEdge(5, 1);
        for (List<Integer> neighbors : graph) {
            Collections.sort(neighbors);
        }
        visited = new boolean[graph.size()];
        dfs(0);
        System.out.println("DFS order from 0: " + order);
    }
}
