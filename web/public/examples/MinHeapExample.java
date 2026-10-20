/**
 * A min-heap stored in an array: the parent of index i is (i - 1) / 2, and every parent is
 * no larger than its children. The minimum is always at index 0, so peek is O(1).
 * insert and poll restore the heap property along one root-to-leaf path: O(log n).
 */
public class MinHeapExample {
    static class MinHeap {
        int[] heap;
        int size;

        MinHeap(int capacity) {
            heap = new int[capacity];
        }

        void insert(int value) {
            heap[size] = value;
            int child = size;
            size++;
            while (child > 0) {
                int parent = (child - 1) / 2;
                if (heap[parent] <= heap[child]) {
                    break;
                }
                swap(parent, child);
                child = parent;
            }
        }

        int peek() {
            if (size == 0) {
                throw new IllegalStateException("heap is empty");
            }
            return heap[0];
        }

        int poll() {
            int min = peek();
            size--;
            heap[0] = heap[size];
            heap[size] = 0;
            int parent = 0;
            while (true) {
                int left = 2 * parent + 1;
                int right = left + 1;
                int smallest = parent;
                if (left < size && heap[left] < heap[smallest]) {
                    smallest = left;
                }
                if (right < size && heap[right] < heap[smallest]) {
                    smallest = right;
                }
                if (smallest == parent) {
                    break;
                }
                swap(parent, smallest);
                parent = smallest;
            }
            return min;
        }

        void swap(int a, int b) {
            int tmp = heap[a];
            heap[a] = heap[b];
            heap[b] = tmp;
        }
    }

    public static void main(String[] args) {
        MinHeap heap = new MinHeap(8);
        int[] values = {5, 3, 8, 1, 4};
        for (int value : values) {
            heap.insert(value);
        }
        System.out.println("Minimum after inserting 5, 3, 8, 1, 4: " + heap.peek());

        StringBuilder order = new StringBuilder();
        while (heap.size > 0) {
            order.append(heap.poll()).append(' ');
        }
        System.out.println("Polled in order: " + order.toString().trim());
    }
}
