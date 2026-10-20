import java.util.Scanner;

/**
 * Reading a count, then that many numbers from one line. Token reads don't care about line
 * breaks, so the same code works whether the numbers share a line or not.
 */
public class NumbersOnOneLineExample {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int sum = 0;
        int min = Integer.MAX_VALUE;
        for (int i = 0; i < n; i++) {
            int value = sc.nextInt();
            sum += value;
            min = Math.min(min, value);
        }
        System.out.println("Sum: " + sum);
        System.out.println("Smallest: " + min);
    }
}
