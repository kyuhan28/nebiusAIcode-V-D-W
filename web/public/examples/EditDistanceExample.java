/**
 * Edit distance (Levenshtein): the fewest single-character inserts, deletes, and substitutions
 * that turn one string into another. dist[i][j] is the answer for the first i characters of a
 * and the first j of b, built from its three neighbors. O(m * n) time and space.
 */
public class EditDistanceExample {
    static int editDistance(String a, String b) {
        int m = a.length();
        int n = b.length();
        int[][] dist = new int[m + 1][n + 1];
        for (int i = 0; i <= m; i++) {
            dist[i][0] = i;
        }
        for (int j = 0; j <= n; j++) {
            dist[0][j] = j;
        }
        for (int i = 1; i <= m; i++) {
            for (int j = 1; j <= n; j++) {
                int substitute = dist[i - 1][j - 1] + (a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1);
                int delete = dist[i - 1][j] + 1;
                int insert = dist[i][j - 1] + 1;
                dist[i][j] = Math.min(substitute, Math.min(delete, insert));
            }
        }
        return dist[m][n];
    }

    public static void main(String[] args) {
        System.out.println("kitten -> sitting: " + editDistance("kitten", "sitting"));
        System.out.println("sunday -> saturday: " + editDistance("sunday", "saturday"));
        System.out.println("same -> same: " + editDistance("same", "same"));
    }
}
