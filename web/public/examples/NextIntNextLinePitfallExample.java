import java.util.Scanner;

/**
 * The classic Scanner pitfall. nextInt() reads the number but leaves the newline after it,
 * so a nextLine() right after it returns an empty string. The fix is one extra nextLine()
 * to consume that newline.
 */
public class NextIntNextLinePitfallExample {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);

        int age = sc.nextInt();
        String name = sc.nextLine();
        System.out.println("age=" + age + " name=[" + name + "]");

        String leftover = sc.nextLine();
        System.out.println("The name was still waiting: " + leftover);

        int age2 = sc.nextInt();
        sc.nextLine(); // Consume the remaining newline
        String name2 = sc.nextLine();
        System.out.println("Fixed: age=" + age2 + " name=[" + name2 + "]");
    }
}
