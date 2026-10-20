import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.util.StringTokenizer;

/**
 * BufferedReader reads whole lines; StringTokenizer splits a line into tokens; and
 * Integer.parseInt turns each token, still a String, into an int.
 */
public class StringTokenizerExample {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(
            new InputStreamReader(System.in)
        );

        String name = br.readLine();
        int age = Integer.parseInt(br.readLine());

        StringTokenizer st = new StringTokenizer(br.readLine());
        int a = Integer.parseInt(st.nextToken());
        int b = Integer.parseInt(st.nextToken());

        System.out.println(name);
        System.out.println(age);
        System.out.println(a + b);
    }
}
