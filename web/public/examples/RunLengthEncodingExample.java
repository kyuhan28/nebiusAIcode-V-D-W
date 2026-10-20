/**
 * Run-length encoding replaces each run of a repeated character with a count and the character:
 * "AAABBC" becomes "3A2B1C". It shrinks data with long runs and can grow data without them.
 * Encoding and decoding are both O(n).
 */
public class RunLengthEncodingExample {
    static String encode(String text) {
        char[] chars = text.toCharArray();
        StringBuilder out = new StringBuilder();
        int i = 0;
        while (i < chars.length) {
            int j = i;
            while (j < chars.length && chars[j] == chars[i]) {
                j++;
            }
            out.append(j - i).append(chars[i]);
            i = j;
        }
        return out.toString();
    }

    static String decode(String encoded) {
        StringBuilder out = new StringBuilder();
        int count = 0;
        for (char c : encoded.toCharArray()) {
            if (Character.isDigit(c)) {
                count = count * 10 + (c - '0');
            } else {
                out.append(String.valueOf(c).repeat(count));
                count = 0;
            }
        }
        return out.toString();
    }

    public static void main(String[] args) {
        String text = "AAABBBCCDAA";
        String encoded = encode(text);
        System.out.println("Original: " + text + " (" + text.length() + " chars)");
        System.out.println("Encoded:  " + encoded + " (" + encoded.length() + " chars)");
        System.out.println("Decoded:  " + decode(encoded));
        System.out.println("Round trip matches: " + decode(encoded).equals(text));
        System.out.println("Without runs it grows: ABCD becomes " + encode("ABCD"));
    }
}
