/**
 * Factorial, n! = n * (n - 1) * ... * 1, written recursively and iteratively.
 * Both are O(n) time. The recursive version uses O(n) stack frames; the loop uses O(1) space.
 * long holds results up to 20!; larger inputs would need BigInteger.
 */
public class FactorialExample {
    static long factorial(int n) {
        if (n <= 1) {
            return 1;
        }
        return n * factorial(n - 1);
    }

    static long factorialLoop(int n) {
        long result = 1;
        for (int k = 2; k <= n; k++) {
            result *= k;
        }
        return result;
    }

    public static void main(String[] args) {
        System.out.println("5! recursively = " + factorial(5));
        System.out.println("10! with a loop = " + factorialLoop(10));
        System.out.println("20! = " + factorialLoop(20));
    }
}
