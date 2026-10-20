import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Queue;

/**
 * Breadth-first search explores a graph in rings: first the start, then every vertex one edge
 * away, then two edges away, and so on. A queue keeps the frontier in that order, and a visited
 * array stops any vertex from being processed twice. O(V + E) time, O(V) extra space.
 */
public class BFSExample {
    static List<List<Integer>> graph = new ArrayList<>();

    static void addEdge(int u, int v) {
        graph.get(u).add(v);
        graph.get(v).add(u);
    }

    static List<Integer> bfs(int start) {
        boolean[] visited = new boolean[graph.size()];
        int[] level = new int[graph.size()];
        List<Integer> order = new ArrayList<>();
        Queue<Integer> queue = new ArrayDeque<>();
        visited[start] = true;
        queue.add(start);
        while (!queue.isEmpty()) {
            int u = queue.poll();
            order.add(u);
            for (int v : graph.get(u)) {
                if (!visited[v]) {
                    visited[v] = true;
                    level[v] = level[u] + 1;
                    queue.add(v);
                }
            }
        }
        for (int v : order) {
            System.out.println("Vertex " + v + " is " + level[v] + " edge(s) from " + start);
        }
        return order;
    }

    public static void main(String[] args) {
        for (int i = 0; i < 7; i++) {
            graph.add(new ArrayList<>());
        }
        addEdge(0, 1);
        addEdge(0, 2);
        addEdge(1, 3);
        addEdge(1, 4);
        addEdge(2, 5);
        addEdge(4, 6);
        addEdge(5, 6);
        System.out.println("BFS order from 0: " + bfs(0));
    }
}
