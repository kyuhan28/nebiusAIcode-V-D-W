/**
 * Binary search halves a sorted range each step by comparing against its middle element.
 * O(log n) time, O(1) space. The array must already be sorted.
 */
public class BinarySearchExample {
    static int binarySearch(int[] arr, int target) {
        int lo = 0;
        int hi = arr.length - 1;
        while (lo <= hi) {
            int mid = lo + (hi - lo) / 2;
            if (arr[mid] == target) {
                return mid;
            } else if (arr[mid] < target) {
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        return -1;
    }

    public static void main(String[] args) {
        int[] arr = {2, 5, 8, 12, 16, 23, 38, 56, 72, 91};
        System.out.println("Index of 23: " + binarySearch(arr, 23));
        System.out.println("Index of 7: " + binarySearch(arr, 7));
    }
}
