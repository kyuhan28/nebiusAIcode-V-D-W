import java.util.ArrayList;
import java.util.List;

/**
 * ArrayList: a resizable array.
 *
 * get(i) and set(i, x) are O(1). Adding at the end is amortized O(1): the backing array
 * occasionally doubles. Inserting or removing in the middle is O(n), because later elements shift.
 */
public class ArrayListExample {
    public static void main(String[] args) {
        List<Integer> list = new ArrayList<>();
        list.add(10);
        list.add(20);
        list.add(30);
        System.out.println("After adding 10, 20, 30: " + list);

        System.out.println("Element at index 1: " + list.get(1));

        list.set(1, 25);
        System.out.println("After setting index 1 to 25: " + list);

        list.add(1, 15);
        System.out.println("After inserting 15 at index 1: " + list);

        list.remove(Integer.valueOf(30));
        System.out.println("After removing the value 30: " + list);

        list.remove(0);
        System.out.println("After removing index 0: " + list);

        int total = 0;
        for (int value : list) {
            total += value;
        }
        System.out.println("Sum while iterating: " + total);
        System.out.println("Size: " + list.size() + ", contains 25: " + list.contains(25));
    }
}
