import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int n = in.nextInt();
        int[] a = new int[n];
        for (int i = 0; i < n; i++) a[i] = in.nextInt();
        StringBuilder out = new StringBuilder();
        for (int i = n - 1; i >= 0; i--) {
            out.append(a[i]);
            if (i > 0) out.append(' ');
        }
        System.out.println(out);
    }
}
