import java.util.ArrayDeque;
import java.util.Queue;

/**
 * Push-relabel maximum flow. Instead of finding whole augmenting paths, it floods the network:
 * the source saturates its edges, and each vertex with excess flow pushes it downhill to a
 * neighbor with spare capacity, rising (relabeling) when it has nowhere lower to push.
 * This FIFO version runs in O(V^3) time.
 */
public class PushRelabelExample {
    static int maxFlow(int[][] cap, int source, int sink) {
        int n = cap.length;
        int[][] flow = new int[n][n];
        int[] height = new int[n];
        int[] excess = new int[n];
        Queue<Integer> active = new ArrayDeque<>();
        height[source] = n;
        for (int v = 0; v < n; v++) {
            if (cap[source][v] > 0) {
                flow[source][v] = cap[source][v];
                flow[v][source] = -cap[source][v];
                excess[v] = cap[source][v];
                excess[source] -= cap[source][v];
                if (v != sink) {
                    active.add(v);
                }
            }
        }
        while (!active.isEmpty()) {
            int u = active.poll();
            while (excess[u] > 0) {
                boolean pushed = false;
                for (int v = 0; v < n && excess[u] > 0; v++) {
                    int residual = cap[u][v] - flow[u][v];
                    if (residual > 0 && height[u] == height[v] + 1) {
                        int amount = Math.min(excess[u], residual);
                        flow[u][v] += amount;
                        flow[v][u] -= amount;
                        excess[u] -= amount;
                        excess[v] += amount;
                        if (v != source && v != sink && excess[v] == amount) {
                            active.add(v);
                        }
                        pushed = true;
                    }
                }
                if (!pushed) {
                    int lowest = Integer.MAX_VALUE;
                    for (int v = 0; v < n; v++) {
                        if (cap[u][v] - flow[u][v] > 0) {
                            lowest = Math.min(lowest, height[v]);
                        }
                    }
                    height[u] = lowest + 1;
                }
            }
        }
        return excess[sink];
    }

    public static void main(String[] args) {
        int[][] cap = new int[6][6];
        cap[0][1] = 16;
        cap[0][2] = 13;
        cap[1][3] = 12;
        cap[2][1] = 4;
        cap[2][4] = 14;
        cap[3][2] = 9;
        cap[3][5] = 20;
        cap[4][3] = 7;
        cap[4][5] = 4;
        System.out.println("Maximum flow from 0 to 5: " + maxFlow(cap, 0, 5));
    }
}
