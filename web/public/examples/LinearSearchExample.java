/**
 * Linear search checks each element in turn. O(n) time, O(1) space, and it works on unsorted data.
 */
public class LinearSearchExample {
    static int linearSearch(int[] arr, int target) {
        for (int i = 0; i < arr.length; i++) {
            if (arr[i] == target) {
                return i;
            }
        }
        return -1;
    }

    public static void main(String[] args) {
        int[] arr = {7, 3, 9, 4, 1, 8};
        System.out.println("Index of 4: " + linearSearch(arr, 4));
        System.out.println("Index of 6: " + linearSearch(arr, 6));
    }
}
