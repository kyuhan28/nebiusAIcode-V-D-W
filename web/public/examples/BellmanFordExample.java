import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Bellman-Ford finds shortest paths from a source even when some edge weights are negative.
 * It relaxes every edge V - 1 times; if any edge can still be relaxed afterwards, the graph has
 * a negative cycle and shortest paths are undefined. O(V * E) time.
 */
public class BellmanFordExample {
    record Edge(int from, int to, int weight) {}

    static final int INF = Integer.MAX_VALUE;

    /** Returns distances from source, or null if a negative cycle is reachable. */
    static int[] bellmanFord(int vertices, List<Edge> edges, int source) {
        int[] dist = new int[vertices];
        Arrays.fill(dist, INF);
        dist[source] = 0;
        for (int round = 1; round < vertices; round++) {
            boolean changed = false;
            for (Edge e : edges) {
                if (dist[e.from()] != INF && dist[e.from()] + e.weight() < dist[e.to()]) {
                    dist[e.to()] = dist[e.from()] + e.weight();
                    changed = true;
                }
            }
            if (!changed) {
                break;
            }
        }
        for (Edge e : edges) {
            if (dist[e.from()] != INF && dist[e.from()] + e.weight() < dist[e.to()]) {
                return null;
            }
        }
        return dist;
    }

    public static void main(String[] args) {
        List<Edge> edges = new ArrayList<>();
        edges.add(new Edge(0, 1, 6));
        edges.add(new Edge(0, 2, 7));
        edges.add(new Edge(1, 2, 8));
        edges.add(new Edge(1, 3, 5));
        edges.add(new Edge(1, 4, -4));
        edges.add(new Edge(2, 3, -3));
        edges.add(new Edge(2, 4, 9));
        edges.add(new Edge(3, 1, -2));
        edges.add(new Edge(4, 0, 2));
        edges.add(new Edge(4, 3, 7));
        System.out.println("Distances from 0: " + Arrays.toString(bellmanFord(5, edges, 0)));

        List<Edge> cycle = new ArrayList<>();
        cycle.add(new Edge(0, 1, 1));
        cycle.add(new Edge(1, 2, -1));
        cycle.add(new Edge(2, 1, -1));
        System.out.println("Graph with a negative cycle: " + (bellmanFord(3, cycle, 0) == null ? "negative cycle detected" : "no cycle"));
    }
}
