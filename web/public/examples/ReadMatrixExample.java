import java.util.Scanner;

/**
 * Reading a matrix: the first line gives rows and columns, then each row's values.
 * The matrix fills in cell by cell as the numbers are read.
 */
public class ReadMatrixExample {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int rows = sc.nextInt();
        int cols = sc.nextInt();
        int[][] grid = new int[rows][cols];
        for (int r = 0; r < rows; r++) {
            for (int c = 0; c < cols; c++) {
                grid[r][c] = sc.nextInt();
            }
        }
        for (int r = 0; r < rows; r++) {
            int sum = 0;
            for (int c = 0; c < cols; c++) {
                sum += grid[r][c];
            }
            System.out.println("Row " + r + " sum: " + sum);
        }
    }
}
