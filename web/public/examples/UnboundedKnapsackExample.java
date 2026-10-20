/**
 * Unbounded knapsack: each item can be taken any number of times. best[w] is the highest value
 * that fits in capacity w; every item is tried on top of best[w - weight]. O(n * W) time,
 * O(W) space.
 */
public class UnboundedKnapsackExample {
    static int unboundedKnapsack(int[] weight, int[] value, int capacity) {
        int[] best = new int[capacity + 1];
        for (int w = 1; w <= capacity; w++) {
            for (int i = 0; i < weight.length; i++) {
                if (weight[i] <= w && best[w - weight[i]] + value[i] > best[w]) {
                    best[w] = best[w - weight[i]] + value[i];
                }
            }
        }
        return best[capacity];
    }

    public static void main(String[] args) {
        int[] weight = {1, 3, 4, 5};
        int[] value = {10, 40, 50, 70};
        System.out.println("Best value for capacity 8: " + unboundedKnapsack(weight, value, 8));
        System.out.println("Best value for capacity 2: " + unboundedKnapsack(weight, value, 2));
    }
}
