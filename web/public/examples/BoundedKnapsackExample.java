/**
 * Bounded knapsack: item i can be taken at most count[i] times (0/1 knapsack is the case where
 * every count is 1). best[i][w] is the highest value using the first i items within capacity w,
 * trying every allowed number of copies of item i. O(W * total copies) time, O(n * W) space.
 */
public class BoundedKnapsackExample {
    public static void main(String[] args) {
        int[] weight = {2, 3, 4};
        int[] value = {3, 4, 6};
        int[] count = {3, 2, 1};
        int capacity = 10;
        int n = weight.length;

        int[][] best = new int[n + 1][capacity + 1];
        for (int i = 1; i <= n; i++) {
            for (int w = 0; w <= capacity; w++) {
                best[i][w] = best[i - 1][w];
                for (int copies = 1; copies <= count[i - 1] && copies * weight[i - 1] <= w; copies++) {
                    int candidate = best[i - 1][w - copies * weight[i - 1]] + copies * value[i - 1];
                    if (candidate > best[i][w]) {
                        best[i][w] = candidate;
                    }
                }
            }
        }
        System.out.println("Best value for capacity " + capacity + ": " + best[n][capacity]);

        /* Walk back through the table to see which copies were taken. */
        int w = capacity;
        StringBuilder taken = new StringBuilder();
        for (int i = n; i >= 1; i--) {
            for (int copies = count[i - 1]; copies >= 0; copies--) {
                if (copies * weight[i - 1] <= w && best[i - 1][w - copies * weight[i - 1]] + copies * value[i - 1] == best[i][w]) {
                    taken.insert(0, "item " + (i - 1) + " x" + copies + (taken.length() > 0 ? ", " : ""));
                    w -= copies * weight[i - 1];
                    break;
                }
            }
        }
        System.out.println("Taken: " + taken);
    }
}
