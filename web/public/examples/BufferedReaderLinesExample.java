import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;

/**
 * readLine() returns one whole line without its line break, keeping every space, and returns
 * an empty string for an empty line. It returns null only at the end of the input.
 */
public class BufferedReaderLinesExample {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        String first = br.readLine();
        String second = br.readLine();
        String third = br.readLine();
        System.out.println("1: [" + first + "]");
        System.out.println("2: [" + second + "]");
        System.out.println("3: [" + third + "]");
    }
}
