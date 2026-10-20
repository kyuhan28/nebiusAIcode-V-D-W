import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.util.StringTokenizer;

/**
 * Split one line into tokens and convert each with Integer.parseInt, until hasMoreTokens()
 * says the line is used up.
 */
public class ParseIntExample {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringTokenizer st = new StringTokenizer(br.readLine());
        int sum = 0;
        while (st.hasMoreTokens()) {
            int value = Integer.parseInt(st.nextToken());
            sum += value;
        }
        System.out.println("Sum: " + sum);
    }
}
