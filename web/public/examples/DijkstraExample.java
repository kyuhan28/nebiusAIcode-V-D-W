import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedList;
import java.util.List;
import java.util.PriorityQueue;

/**
 * Dijkstra's algorithm finds the cheapest path from a source to every vertex when all edge
 * weights are nonnegative. A priority queue always expands the closest unsettled vertex next.
 * O((V + E) log V) with a binary heap.
 *
 * Unlike BFS or DFS, which only decide an order in which to visit vertices, Dijkstra minimizes
 * the total weight of the path, so a route with more edges can still be the shortest.
 */
public class DijkstraExample {
    record Edge(int to, int weight) {}

    static final int INF = Integer.MAX_VALUE;
    static List<List<Edge>> graph = new ArrayList<>();

    static void addEdge(int u, int v, int weight) {
        if (weight < 0) {
            throw new IllegalArgumentException("Dijkstra needs nonnegative weights, got " + weight);
        }
        graph.get(u).add(new Edge(v, weight));
        graph.get(v).add(new Edge(u, weight));
    }

    public static void main(String[] args) {
        for (int i = 0; i < 6; i++) {
            graph.add(new ArrayList<>());
        }
        addEdge(0, 1, 4);
        addEdge(0, 2, 1);
        addEdge(2, 1, 2);
        addEdge(1, 3, 1);
        addEdge(2, 3, 5);
        addEdge(3, 4, 3);

        int source = 0;
        int[] dist = new int[graph.size()];
        int[] prev = new int[graph.size()];
        Arrays.fill(dist, INF);
        Arrays.fill(prev, -1);
        dist[source] = 0;

        PriorityQueue<int[]> pq = new PriorityQueue<>((a, b) -> Integer.compare(a[0], b[0]));
        pq.add(new int[] {0, source});
        while (!pq.isEmpty()) {
            int[] top = pq.poll();
            int u = top[1];
            if (top[0] > dist[u]) {
                continue;
            }
            for (Edge e : graph.get(u)) {
                int candidate = dist[u] + e.weight();
                if (candidate < dist[e.to()]) {
                    dist[e.to()] = candidate;
                    prev[e.to()] = u;
                    pq.add(new int[] {candidate, e.to()});
                }
            }
        }

        for (int v = 0; v < dist.length; v++) {
            System.out.println("Distance to " + v + ": " + (dist[v] == INF ? "unreachable" : dist[v]));
        }

        int target = 4;
        LinkedList<Integer> path = new LinkedList<>();
        for (int v = target; v != -1; v = prev[v]) {
            path.addFirst(v);
        }
        System.out.println("Shortest path to " + target + ": " + path + " (cost " + dist[target] + ")");

        try {
            addEdge(4, 5, -2);
        } catch (IllegalArgumentException e) {
            System.out.println("Rejected: " + e.getMessage());
        }
    }
}
