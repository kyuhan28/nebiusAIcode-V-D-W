/**
 * A queue backed by a circular array. First in, first out (FIFO): items leave in the order
 * they arrived. enqueue, dequeue, peek, and isEmpty are all O(1); head and tail wrap around.
 */
public class QueueExample {
    static class IntQueue {
        int[] items;
        int head;
        int tail;
        int count;

        IntQueue(int capacity) {
            items = new int[capacity];
        }

        void enqueue(int value) {
            if (count == items.length) {
                throw new IllegalStateException("queue is full");
            }
            items[tail] = value;
            tail = (tail + 1) % items.length;
            count++;
        }

        int dequeue() {
            if (isEmpty()) {
                throw new IllegalStateException("cannot dequeue from an empty queue");
            }
            int value = items[head];
            items[head] = 0;
            head = (head + 1) % items.length;
            count--;
            return value;
        }

        int peek() {
            if (isEmpty()) {
                throw new IllegalStateException("cannot peek at an empty queue");
            }
            return items[head];
        }

        boolean isEmpty() {
            return count == 0;
        }
    }

    public static void main(String[] args) {
        IntQueue queue = new IntQueue(4);
        queue.enqueue(1);
        queue.enqueue(2);
        queue.enqueue(3);
        System.out.println("Enqueued 1, 2, 3. Front is " + queue.peek());

        System.out.println("dequeue() returns " + queue.dequeue());
        queue.enqueue(4);
        queue.enqueue(5);
        System.out.println("Enqueued 4 and 5; the tail wrapped around the array.");

        while (!queue.isEmpty()) {
            System.out.println("dequeue() returns " + queue.dequeue());
        }

        try {
            queue.dequeue();
        } catch (IllegalStateException e) {
            System.out.println("Empty queue handled: " + e.getMessage());
        }
    }
}
