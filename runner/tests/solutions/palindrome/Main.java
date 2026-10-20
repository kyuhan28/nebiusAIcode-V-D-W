import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        String s = new Scanner(System.in).nextLine().trim();
        int i = 0, j = s.length() - 1;
        boolean ok = true;
        while (i < j) {
            if (s.charAt(i++) != s.charAt(j--)) { ok = false; break; }
        }
        System.out.println(ok ? "YES" : "NO");
    }
}
