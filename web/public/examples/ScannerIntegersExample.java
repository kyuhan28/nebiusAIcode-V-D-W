import java.util.Scanner;

/**
 * nextInt() skips any spaces or newlines, then reads one integer token.
 * Three calls read three numbers, wherever they sit in the input.
 */
public class ScannerIntegersExample {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int a = sc.nextInt();
        int b = sc.nextInt();
        int c = sc.nextInt();
        System.out.println("Sum: " + (a + b + c));
        System.out.println("Largest: " + Math.max(a, Math.max(b, c)));
    }
}
