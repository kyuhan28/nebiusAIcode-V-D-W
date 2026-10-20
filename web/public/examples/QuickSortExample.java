import java.util.Arrays;

/**
 * Quicksort picks a pivot, moves smaller values before it and larger values after it, then
 * sorts each side. O(n log n) on average, O(n^2) in the worst case (for example, sorted input
 * with a last-element pivot), and O(log n) stack space on average. Not stable.
 */
public class QuickSortExample {
    static void quickSort(int[] arr, int lo, int hi) {
        if (lo >= hi) {
            return;
        }
        int p = partition(arr, lo, hi);
        quickSort(arr, lo, p - 1);
        quickSort(arr, p + 1, hi);
    }

    /** Lomuto partition with the last element as the pivot. */
    static int partition(int[] arr, int lo, int hi) {
        int pivot = arr[hi];
        int i = lo;
        for (int j = lo; j < hi; j++) {
            if (arr[j] < pivot) {
                swap(arr, i, j);
                i++;
            }
        }
        swap(arr, i, hi);
        return i;
    }

    static void swap(int[] arr, int a, int b) {
        int tmp = arr[a];
        arr[a] = arr[b];
        arr[b] = tmp;
    }

    public static void main(String[] args) {
        int[] arr = {10, 7, 8, 9, 1, 5};
        quickSort(arr, 0, arr.length - 1);
        System.out.println("Sorted: " + Arrays.toString(arr));
    }
}
