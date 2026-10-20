package examples.pascaltriangle;

import java.util.Arrays;
import java.util.Scanner;

/**
 * Pascal's triangle, top-down with memoization: pascal(r, c) asks for the two values above it,
 * and every value it works out is kept in memo, so asking again is just a lookup.
 *
 * Input: how many rows, 1 to 10 (6 if none is given).
 * Each value is computed once: O(n^2) work and O(n^2) cache for n rows.
 */
public class PascalTriangleMemoized {
    static long[][] memo;
    static int calls = 0;
    static int hits = 0;

    static long pascal(int r, int c) {
        calls++;
        if (c == 0 || c == r) {
            return 1;
        }
        if (memo[r][c] != 0) {
            hits++;
            return memo[r][c];
        }
        long value = pascal(r - 1, c - 1) + pascal(r - 1, c);
        memo[r][c] = value;
        return value;
    }

    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int n = in.hasNextInt() ? in.nextInt() : 6;
        if (n < 1 || n > 10) {
            System.out.println("Choose between 1 and 10 rows; building 6.");
            n = 6;
        }
        memo = new long[n][n];

        for (int r = 0; r < n; r++) {
            long[] row = new long[r + 1];
            for (int c = 0; c <= r; c++) {
                row[c] = pascal(r, c);
            }
            System.out.println(Arrays.toString(row));
        }
        System.out.println(calls + " calls, " + hits + " answered from the cache");
    }
}
