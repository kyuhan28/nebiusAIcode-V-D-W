import java.util.Arrays;

/**
 * Coin change: the fewest coins that add up to an amount, or -1 if it can't be made.
 * best[a] = 1 + min(best[a - coin]) over every coin. O(amount * coins) time, O(amount) space.
 */
public class CoinChangeExample {
    static int minCoins(int[] coins, int amount) {
        int[] best = new int[amount + 1];
        Arrays.fill(best, amount + 1);
        best[0] = 0;
        for (int a = 1; a <= amount; a++) {
            for (int coin : coins) {
                if (coin <= a && best[a - coin] + 1 < best[a]) {
                    best[a] = best[a - coin] + 1;
                }
            }
        }
        return best[amount] > amount ? -1 : best[amount];
    }

    public static void main(String[] args) {
        System.out.println("Fewest coins for 11 with {1, 2, 5}: " + minCoins(new int[] {1, 2, 5}, 11));
        System.out.println("Fewest coins for 3 with {2}: " + minCoins(new int[] {2}, 3));
    }
}
