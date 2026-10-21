/*
 * Structs and pointers to structs.
 * a is a struct on the stack; copy is a separate copy of it; ref points at a. Changing a through
 * ref changes a but not copy. heap_point is a struct allocated with malloc and reached with ->.
 */
#include <stdio.h>
#include <stdlib.h>

struct Point {
    int x;
    int y;
};

void move(struct Point *p, int dx, int dy) {
    p->x += dx;
    p->y += dy;
}

int main(void) {
    struct Point a = {1, 2};
    struct Point copy = a;
    struct Point *ref = &a;
    move(ref, 10, 20);
    struct Point *heap_point = malloc(sizeof *heap_point);
    if (!heap_point) return 1;
    *heap_point = a;
    heap_point->y = 99;
    printf("a=(%d,%d) copy=(%d,%d) heap=(%d,%d)\n", a.x, a.y, copy.x, copy.y, heap_point->x, heap_point->y);
    free(heap_point);
    return 0;
}
