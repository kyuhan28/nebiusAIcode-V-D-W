import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Backtracking: every ordering (permutation) of a set of numbers.
 *
 * The search builds one permutation in path, one position at a time. For each position it tries
 * every number that is not used yet (choose), fills the remaining positions recursively (explore),
 * and then gives the number back (un-choose) so the next one can be tried. That undo step is the
 * "backtracking".
 *
 * Watch the call stack grow one frame per position and shrink back, and path being filled and
 * overwritten. Three numbers have 3 x 2 x 1 = 6 permutations.
 */
public class PermutationsExample {
    static List<String> results = new ArrayList<>();

    static void permute(int[] nums, boolean[] used, int[] path, int depth) {
        if (depth == nums.length) {
            results.add(Arrays.toString(path));   // every position is filled: one complete permutation
            return;
        }
        for (int i = 0; i < nums.length; i++) {
            if (used[i]) {
                continue;                         // this number is already in the permutation
            }
            used[i] = true;                       // choose
            path[depth] = nums[i];
            permute(nums, used, path, depth + 1); // explore the next position
            used[i] = false;                      // un-choose: backtrack
        }
    }

    public static void main(String[] args) {
        int[] nums = {1, 2, 3};
        permute(nums, new boolean[nums.length], new int[nums.length], 0);
        for (String p : results) {
            System.out.println(p);
        }
        System.out.println(results.size() + " permutations");
    }
}
