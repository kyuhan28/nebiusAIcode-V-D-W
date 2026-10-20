import java.util.Arrays;

/**
 * Bubble sort repeatedly swaps adjacent out-of-order pairs, so the largest remaining value
 * "bubbles" to the end of each pass. O(n^2) time, O(1) space; it stops early once a pass
 * makes no swaps, so already-sorted input takes O(n).
 */
public class BubbleSortExample {
    static void bubbleSort(int[] arr) {
        for (int i = 0; i < arr.length - 1; i++) {
            boolean swapped = false;
            for (int j = 0; j < arr.length - 1 - i; j++) {
                if (arr[j] > arr[j + 1]) {
                    int tmp = arr[j];
                    arr[j] = arr[j + 1];
                    arr[j + 1] = tmp;
                    swapped = true;
                }
            }
            if (!swapped) {
                break;
            }
        }
    }

    public static void main(String[] args) {
        int[] arr = {5, 1, 4, 2, 8};
        bubbleSort(arr);
        System.out.println("Sorted: " + Arrays.toString(arr));
    }
}
