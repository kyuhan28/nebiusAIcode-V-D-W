/**
 * Fibonacci three ways. Plain recursion recomputes the same values and takes O(2^n) time, so it
 * is only used for a small n. Memoization caches each answer: O(n). The bottom-up table needs
 * no recursion at all: O(n) time.
 */
public class FibonacciExample {
    static int calls = 0;

    static long naive(int n) {
        calls++;
        if (n < 2) {
            return n;
        }
        return naive(n - 1) + naive(n - 2);
    }

    static long memo(int n, long[] cache) {
        if (n < 2) {
            return n;
        }
        if (cache[n] != 0) {
            return cache[n];
        }
        cache[n] = memo(n - 1, cache) + memo(n - 2, cache);
        return cache[n];
    }

    static long bottomUp(int n) {
        long[] fib = new long[n + 1];
        fib[1] = 1;
        for (int i = 2; i <= n; i++) {
            fib[i] = fib[i - 1] + fib[i - 2];
        }
        return fib[n];
    }

    public static void main(String[] args) {
        System.out.println("fib(10) by plain recursion = " + naive(10) + " (" + calls + " calls)");
        System.out.println("fib(50) with memoization = " + memo(50, new long[51]));
        System.out.println("fib(12) bottom-up = " + bottomUp(12));
    }
}
