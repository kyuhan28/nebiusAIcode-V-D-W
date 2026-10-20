import java.io.BufferedReader;
import java.io.InputStreamReader;

public class Main {
    public static void main(String[] args) throws Exception {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));
        int q = Integer.parseInt(in.readLine().trim());
        int[] stack = new int[q];
        int size = 0;
        StringBuilder out = new StringBuilder();
        for (int k = 0; k < q; k++) {
            String[] op = in.readLine().trim().split("\\s+");
            switch (op[0]) {
                case "push" -> stack[size++] = Integer.parseInt(op[1]);
                case "pop" -> out.append(size == 0 ? "EMPTY" : String.valueOf(stack[--size])).append('\n');
                case "peek" -> out.append(size == 0 ? "EMPTY" : String.valueOf(stack[size - 1])).append('\n');
                case "size" -> out.append(size).append('\n');
                default -> throw new IllegalArgumentException(op[0]);
            }
        }
        System.out.print(out);
    }
}
