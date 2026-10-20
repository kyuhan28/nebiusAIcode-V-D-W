import java.util.*;

public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int n = in.nextInt(), m = in.nextInt();
        List<List<long[]>> g = new ArrayList<>();
        for (int i = 0; i < n; i++) g.add(new ArrayList<>());
        for (int i = 0; i < m; i++) {
            int u = in.nextInt(), v = in.nextInt();
            long w = in.nextLong();
            g.get(u).add(new long[] {v, w});
            g.get(v).add(new long[] {u, w});
        }
        int s = in.nextInt();
        long[] dist = new long[n];
        Arrays.fill(dist, Long.MAX_VALUE);
        dist[s] = 0;
        PriorityQueue<long[]> pq = new PriorityQueue<>(Comparator.comparingLong(a -> a[0]));
        pq.add(new long[] {0, s});
        while (!pq.isEmpty()) {
            long[] t = pq.poll();
            int u = (int) t[1];
            if (t[0] > dist[u]) continue;
            for (long[] e : g.get(u)) {
                int v = (int) e[0];
                if (dist[u] + e[1] < dist[v]) { dist[v] = dist[u] + e[1]; pq.add(new long[] {dist[v], v}); }
            }
        }
        StringBuilder out = new StringBuilder();
        for (long d : dist) out.append(d == Long.MAX_VALUE ? "INF" : String.valueOf(d)).append('\n');
        System.out.print(out);
    }
}
