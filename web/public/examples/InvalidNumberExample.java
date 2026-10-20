import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;

/**
 * Integer.parseInt throws NumberFormatException for text that isn't a whole number, such as
 * "abc" or "3.5". Catching it lets the program report the bad line and keep going.
 */
public class InvalidNumberExample {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        String line;
        while ((line = br.readLine()) != null) {
            try {
                int value = Integer.parseInt(line);
                System.out.println("ok: " + value);
            } catch (NumberFormatException e) {
                System.out.println("not an int: " + line);
            }
        }
    }
}
