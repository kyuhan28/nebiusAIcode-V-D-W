import java.util.Scanner;

/**
 * Reading different kinds of input with Scanner. nextLine() reads a whole line, nextInt()
 * reads one whole-number token, and nextDouble() reads one decimal token.
 */
public class ScannerBasicsExample {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);

        String name = sc.nextLine();
        int age = sc.nextInt();
        double gpa = sc.nextDouble();

        System.out.println("Name: " + name);
        System.out.println("Age: " + age);
        System.out.println("GPA: " + gpa);

        sc.close();
    }
}
