import java.util.ArrayList;
import java.util.List;

/**
 * A binary search tree: every left descendant is smaller, every right descendant larger.
 * Insert and search are O(h), where h is the height: O(log n) when balanced, O(n) in the worst case.
 * Each traversal visits every node once: O(n).
 */
public class BinarySearchTreeExample {
    static class Node {
        int value;
        Node left;
        Node right;

        Node(int value) {
            this.value = value;
        }
    }

    static Node insert(Node node, int value) {
        if (node == null) {
            return new Node(value);
        }
        if (value < node.value) {
            node.left = insert(node.left, value);
        } else if (value > node.value) {
            node.right = insert(node.right, value);
        }
        return node;
    }

    static boolean contains(Node node, int value) {
        while (node != null) {
            if (value == node.value) {
                return true;
            }
            node = value < node.value ? node.left : node.right;
        }
        return false;
    }

    static void inorder(Node node, List<Integer> out) {
        if (node == null) {
            return;
        }
        inorder(node.left, out);
        out.add(node.value);
        inorder(node.right, out);
    }

    static void preorder(Node node, List<Integer> out) {
        if (node == null) {
            return;
        }
        out.add(node.value);
        preorder(node.left, out);
        preorder(node.right, out);
    }

    static void postorder(Node node, List<Integer> out) {
        if (node == null) {
            return;
        }
        postorder(node.left, out);
        postorder(node.right, out);
        out.add(node.value);
    }

    public static void main(String[] args) {
        Node root = null;
        int[] values = {50, 30, 70, 20, 40, 60, 80};
        for (int value : values) {
            root = insert(root, value);
        }

        List<Integer> in = new ArrayList<>();
        inorder(root, in);
        System.out.println("Inorder (sorted): " + in);

        List<Integer> pre = new ArrayList<>();
        preorder(root, pre);
        System.out.println("Preorder: " + pre);

        List<Integer> post = new ArrayList<>();
        postorder(root, post);
        System.out.println("Postorder: " + post);

        System.out.println("Contains 60: " + contains(root, 60));
        System.out.println("Contains 65: " + contains(root, 65));
    }
}
