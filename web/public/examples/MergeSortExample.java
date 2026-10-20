import java.util.Arrays;

/**
 * Merge sort splits the array in half, sorts each half, and merges the two sorted halves.
 * O(n log n) time in every case, O(n) extra space for the merge, and it is stable.
 */
public class MergeSortExample {
    static void mergeSort(int[] arr, int lo, int hi) {
        if (hi - lo < 1) {
            return;
        }
        int mid = (lo + hi) / 2;
        mergeSort(arr, lo, mid);
        mergeSort(arr, mid + 1, hi);
        merge(arr, lo, mid, hi);
    }

    static void merge(int[] arr, int lo, int mid, int hi) {
        int[] left = Arrays.copyOfRange(arr, lo, mid + 1);
        int[] right = Arrays.copyOfRange(arr, mid + 1, hi + 1);
        int i = 0;
        int j = 0;
        int k = lo;
        while (i < left.length && j < right.length) {
            if (left[i] <= right[j]) {
                arr[k] = left[i];
                i++;
            } else {
                arr[k] = right[j];
                j++;
            }
            k++;
        }
        while (i < left.length) {
            arr[k] = left[i];
            i++;
            k++;
        }
        while (j < right.length) {
            arr[k] = right[j];
            j++;
            k++;
        }
    }

    public static void main(String[] args) {
        int[] arr = {38, 27, 43, 3, 9, 82, 10};
        mergeSort(arr, 0, arr.length - 1);
        System.out.println("Sorted: " + Arrays.toString(arr));
    }
}
