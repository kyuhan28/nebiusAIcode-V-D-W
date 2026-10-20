package examples.pascaltriangle;

import java.util.Arrays;
import java.util.Scanner;

/**
 * Pascal's triangle, bottom-up (tabulation): each row is built from the row above it.
 * The first and last values of a row are 1; every value inside is the sum of the two above it.
 *
 * Input: how many rows to build, 1 to 12 (6 if none is given).
 * Cost for n rows: O(n^2) additions, O(n^2) stored values.
 */
public class PascalTriangle {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int n = in.hasNextInt() ? in.nextInt() : 6;
        if (n < 1 || n > 12) {
            System.out.println("Choose between 1 and 12 rows; building 6.");
            n = 6;
        }

        long[][] triangle = new long[n][];
        for (int r = 0; r < n; r++) {
            triangle[r] = new long[r + 1];
            triangle[r][0] = 1;
            triangle[r][r] = 1;
            for (int c = 1; c < r; c++) {
                triangle[r][c] = triangle[r - 1][c - 1] + triangle[r - 1][c];
            }
        }

        for (long[] row : triangle) {
            System.out.println(Arrays.toString(row));
        }
    }
}
