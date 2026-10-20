import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;

/**
 * LZW compression learns a dictionary while it reads: each time it sees a string it hasn't
 * coded yet, it emits the code for the longest known prefix and adds prefix + next character
 * as a new entry. The decoder rebuilds the same dictionary, so it never has to be sent.
 * O(n) dictionary lookups for both directions.
 */
public class LZWCompressionExample {
    static List<Integer> compress(String text, List<Character> alphabet) {
        Map<String, Integer> dict = new HashMap<>();
        for (char c : alphabet) {
            dict.put(String.valueOf(c), dict.size());
        }
        List<Integer> codes = new ArrayList<>();
        String current = "";
        for (char c : text.toCharArray()) {
            String next = current + c;
            if (dict.containsKey(next)) {
                current = next;
            } else {
                codes.add(dict.get(current));
                dict.put(next, dict.size());
                current = String.valueOf(c);
            }
        }
        if (!current.isEmpty()) {
            codes.add(dict.get(current));
        }
        return codes;
    }

    static String decompress(List<Integer> codes, List<Character> alphabet) {
        Map<Integer, String> dict = new HashMap<>();
        for (char c : alphabet) {
            dict.put(dict.size(), String.valueOf(c));
        }
        String previous = dict.get(codes.get(0));
        StringBuilder out = new StringBuilder(previous);
        for (int k = 1; k < codes.size(); k++) {
            int code = codes.get(k);
            /* The one tricky case: a code that is being defined by this very step. */
            String entry = dict.containsKey(code) ? dict.get(code) : previous + previous.charAt(0);
            out.append(entry);
            dict.put(dict.size(), previous + entry.charAt(0));
            previous = entry;
        }
        return out.toString();
    }

    public static void main(String[] args) {
        String text = "TOBEORNOTTOBEORTOBEORNOT";
        List<Character> alphabet = new ArrayList<>();
        for (char c : new TreeSet<>(text.chars().mapToObj(x -> (char) x).toList())) {
            alphabet.add(c);
        }
        List<Integer> codes = compress(text, alphabet);
        System.out.println("Alphabet: " + alphabet);
        System.out.println("Codes: " + codes);
        System.out.println(text.length() + " characters became " + codes.size() + " codes");
        String restored = decompress(codes, alphabet);
        System.out.println("Decompressed: " + restored);
        System.out.println("Round trip matches: " + restored.equals(text));
    }
}
