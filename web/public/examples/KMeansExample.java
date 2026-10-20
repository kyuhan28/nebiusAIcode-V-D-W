import java.util.Arrays;

/**
 * K-means clustering groups points around k centers. It alternates two steps until nothing
 * changes: assign every point to its nearest centroid, then move each centroid to the mean of
 * its points. Each round is O(n * k); it finds a local optimum that depends on the start.
 */
public class KMeansExample {
    static double distance(double[] a, double[] b) {
        double dx = a[0] - b[0];
        double dy = a[1] - b[1];
        return Math.sqrt(dx * dx + dy * dy);
    }

    public static void main(String[] args) {
        double[][] points = {
            {1.0, 1.0}, {1.5, 2.0}, {2.0, 1.2}, {1.1, 0.8},
            {6.0, 6.5}, {6.5, 7.0}, {7.0, 6.0}, {5.7, 6.1},
            {1.0, 7.0}, {1.8, 6.5}, {1.2, 6.0}, {0.8, 7.5},
        };
        int k = 3;
        double[][] centroids = {points[0].clone(), points[4].clone(), points[8].clone()};
        int[] assignment = new int[points.length];
        Arrays.fill(assignment, -1);

        int round = 0;
        boolean changed = true;
        while (changed && round < 20) {
            changed = false;
            round++;
            for (int p = 0; p < points.length; p++) {
                int best = 0;
                for (int c = 1; c < k; c++) {
                    if (distance(points[p], centroids[c]) < distance(points[p], centroids[best])) {
                        best = c;
                    }
                }
                if (assignment[p] != best) {
                    assignment[p] = best;
                    changed = true;
                }
            }
            for (int c = 0; c < k; c++) {
                double sumX = 0;
                double sumY = 0;
                int count = 0;
                for (int p = 0; p < points.length; p++) {
                    if (assignment[p] == c) {
                        sumX += points[p][0];
                        sumY += points[p][1];
                        count++;
                    }
                }
                if (count > 0) {
                    centroids[c][0] = sumX / count;
                    centroids[c][1] = sumY / count;
                }
            }
        }
        System.out.println("Converged after " + round + " rounds");
        for (int c = 0; c < k; c++) {
            System.out.printf("Cluster %d center: (%.2f, %.2f)%n", c, centroids[c][0], centroids[c][1]);
        }
        System.out.println("Assignments: " + Arrays.toString(assignment));
    }
}
