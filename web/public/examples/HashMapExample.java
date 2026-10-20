import java.util.HashMap;
import java.util.Map;
import java.util.TreeMap;

/**
 * HashMap stores key-value pairs. put, get, containsKey, and remove are O(1) on average:
 * the key's hash picks a bucket directly. Iteration order is not guaranteed, so this example
 * sorts keys before printing to keep the output stable.
 */
public class HashMapExample {
    public static void main(String[] args) {
        Map<String, Integer> stock = new HashMap<>();
        stock.put("apples", 12);
        stock.put("pears", 5);
        stock.put("plums", 8);
        System.out.println("Pears in stock: " + stock.get("pears"));

        stock.put("pears", 7);
        System.out.println("After restocking pears: " + stock.get("pears"));

        System.out.println("Has kiwis? " + stock.containsKey("kiwis"));
        System.out.println("Kiwis, with a default: " + stock.getOrDefault("kiwis", 0));

        stock.remove("plums");
        System.out.println("After removing plums, size is " + stock.size());

        for (Map.Entry<String, Integer> entry : new TreeMap<>(stock).entrySet()) {
            System.out.println(entry.getKey() + " = " + entry.getValue());
        }
    }
}
