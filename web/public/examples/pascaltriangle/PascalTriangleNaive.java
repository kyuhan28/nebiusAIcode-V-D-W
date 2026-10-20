package examples.pascaltriangle;

import java.util.Arrays;
import java.util.Scanner;

/**
 * Pascal's triangle by plain recursion, with no cache: pascal(r, c) recomputes the same values
 * again and again. Compare the call count with PascalTriangleMemoized.
 *
 * Input: how many rows, 1 to 7 (6 if none is given). The work roughly doubles with every row,
 * so this version is kept small on purpose.
 */
public class PascalTriangleNaive {
    static int calls = 0;

    static long pascal(int r, int c) {
        calls++;
        if (c == 0 || c == r) {
            return 1;
        }
        return pascal(r - 1, c - 1) + pascal(r - 1, c);
    }

    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int n = in.hasNextInt() ? in.nextInt() : 6;
        if (n < 1 || n > 7) {
            System.out.println("Choose between 1 and 7 rows; building 6.");
            n = 6;
        }

        for (int r = 0; r < n; r++) {
            long[] row = new long[r + 1];
            for (int c = 0; c <= r; c++) {
                row[c] = pascal(r, c);
            }
            System.out.println(Arrays.toString(row));
        }
        System.out.println(calls + " calls without a cache");
    }
}
