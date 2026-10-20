import java.util.*;

public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int n = in.nextInt(), m = in.nextInt();
        List<List<Integer>> g = new ArrayList<>();
        for (int i = 0; i < n; i++) g.add(new ArrayList<>());
        for (int i = 0; i < m; i++) {
            int u = in.nextInt(), v = in.nextInt();
            g.get(u).add(v);
            g.get(v).add(u);
        }
        int s = in.nextInt();
        for (List<Integer> l : g) Collections.sort(l);
        boolean[] seen = new boolean[n];
        ArrayDeque<Integer> q = new ArrayDeque<>();
        List<String> order = new ArrayList<>();
        seen[s] = true;
        q.add(s);
        while (!q.isEmpty()) {
            int u = q.poll();
            order.add(String.valueOf(u));
            for (int v : g.get(u)) if (!seen[v]) { seen[v] = true; q.add(v); }
        }
        System.out.println(String.join(" ", order));
    }
}
