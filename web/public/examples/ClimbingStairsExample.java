/**
 * Climbing stairs: you can climb 1 or 2 steps at a time. How many distinct ways reach step n?
 * ways[i] = ways[i - 1] + ways[i - 2], because the last move was either one step or two.
 * O(n) time and space with a table.
 */
public class ClimbingStairsExample {
    static int countWays(int n) {
        int[] ways = new int[n + 1];
        ways[0] = 1;
        ways[1] = 1;
        for (int i = 2; i <= n; i++) {
            ways[i] = ways[i - 1] + ways[i - 2];
        }
        return ways[n];
    }

    public static void main(String[] args) {
        System.out.println("Ways to climb 5 steps: " + countWays(5));
        System.out.println("Ways to climb 10 steps: " + countWays(10));
    }
}
