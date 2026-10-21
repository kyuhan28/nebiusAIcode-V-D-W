/*
 * realloc() and a growing array.
 * The array doubles its capacity when full. realloc may keep the block where it is or move it to a
 * new address (copying the contents and releasing the old block). Always use the pointer realloc
 * returns, and keep the old one until you know realloc succeeded.
 */
#include <stdio.h>
#include <stdlib.h>

int main(void) {
    int capacity = 2;
    int count = 0;
    int *items = malloc(capacity * sizeof(int));
    if (!items) return 1;
    for (int v = 1; v <= 9; v++) {
        if (count == capacity) {
            capacity *= 2;
            int *bigger = realloc(items, capacity * sizeof(int));
            if (!bigger) { free(items); return 1; }
            items = bigger;
        }
        items[count++] = v * v;
    }
    printf("count=%d capacity=%d last=%d\n", count, capacity, items[count - 1]);
    free(items);
    return 0;
}
