/**
 * A stack backed by an array. Last in, first out (LIFO): the most recently pushed item
 * is the first one popped. push, pop, peek, and isEmpty are all O(1).
 */
public class StackExample {
    static class IntStack {
        int[] items;
        int top = -1;

        IntStack(int capacity) {
            items = new int[capacity];
        }

        void push(int value) {
            if (top == items.length - 1) {
                throw new IllegalStateException("stack is full");
            }
            top++;
            items[top] = value;
        }

        int pop() {
            if (isEmpty()) {
                throw new IllegalStateException("cannot pop from an empty stack");
            }
            int value = items[top];
            items[top] = 0;
            top--;
            return value;
        }

        int peek() {
            if (isEmpty()) {
                throw new IllegalStateException("cannot peek at an empty stack");
            }
            return items[top];
        }

        boolean isEmpty() {
            return top == -1;
        }
    }

    public static void main(String[] args) {
        IntStack stack = new IntStack(5);
        stack.push(10);
        stack.push(20);
        stack.push(30);
        System.out.println("Pushed 10, 20, 30. Top is " + stack.peek());

        System.out.println("pop() returns " + stack.pop());
        System.out.println("pop() returns " + stack.pop());
        System.out.println("Empty? " + stack.isEmpty());
        System.out.println("pop() returns " + stack.pop());
        System.out.println("Empty? " + stack.isEmpty());

        try {
            stack.pop();
        } catch (IllegalStateException e) {
            System.out.println("Underflow handled: " + e.getMessage());
        }
    }
}
