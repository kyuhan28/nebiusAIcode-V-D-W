import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int n = in.nextInt();
        int max = in.nextInt();
        for (int i = 1; i < n; i++) max = Math.max(max, in.nextInt());
        System.out.println(max);
    }
}
