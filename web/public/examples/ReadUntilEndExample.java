import java.util.Scanner;

/**
 * Reading an unknown number of integers: hasNextInt() checks for another integer without
 * consuming it, and turns false at the end of the input.
 */
public class ReadUntilEndExample {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int sum = 0;
        int count = 0;
        while (sc.hasNextInt()) {
            sum += sc.nextInt();
            count++;
        }
        System.out.println(count + " numbers, sum " + sum);
    }
}
