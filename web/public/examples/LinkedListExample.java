/**
 * A singly linked list built from explicit Node objects.
 *
 * Inserting at the head is O(1). Inserting at the tail, searching, and deleting are O(n),
 * because the list has to be walked one node at a time.
 */
public class LinkedListExample {
    static class Node {
        int value;
        Node next;

        Node(int value) {
            this.value = value;
        }
    }

    static class SinglyLinkedList {
        Node head;
        int size;

        void addFirst(int value) {
            Node node = new Node(value);
            node.next = head;
            head = node;
            size++;
        }

        void addLast(int value) {
            Node node = new Node(value);
            if (head == null) {
                head = node;
            } else {
                Node current = head;
                while (current.next != null) {
                    current = current.next;
                }
                current.next = node;
            }
            size++;
        }

        boolean contains(int value) {
            Node current = head;
            while (current != null) {
                if (current.value == value) {
                    return true;
                }
                current = current.next;
            }
            return false;
        }

        boolean remove(int value) {
            if (head == null) {
                return false;
            }
            if (head.value == value) {
                head = head.next;
                size--;
                return true;
            }
            Node current = head;
            while (current.next != null && current.next.value != value) {
                current = current.next;
            }
            if (current.next == null) {
                return false;
            }
            current.next = current.next.next;
            size--;
            return true;
        }

        String describe() {
            if (head == null) {
                return "(empty)";
            }
            StringBuilder out = new StringBuilder();
            for (Node current = head; current != null; current = current.next) {
                out.append(current.value);
                if (current.next != null) {
                    out.append(" -> ");
                }
            }
            return out.toString();
        }
    }

    public static void main(String[] args) {
        SinglyLinkedList list = new SinglyLinkedList();
        System.out.println("Start: " + list.describe());

        list.addLast(20);
        list.addLast(30);
        list.addFirst(10);
        list.addLast(40);
        System.out.println("After inserts: " + list.describe());

        System.out.println("Contains 30: " + list.contains(30));
        System.out.println("Contains 99: " + list.contains(99));

        list.remove(30);
        System.out.println("After removing 30: " + list.describe());
        list.remove(10);
        System.out.println("After removing the head 10: " + list.describe());
        System.out.println("Removing 99 succeeded: " + list.remove(99));
        System.out.println("Size: " + list.size);
    }
}
