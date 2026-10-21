/*
 * A stack (array) and a queue (linked nodes).
 * The stack keeps its items in one array: push and pop work at the top. The queue allocates a node
 * per item: enqueue adds at the tail, dequeue removes (and frees) the head.
 */
#include <stdio.h>
#include <stdlib.h>

struct Stack { int items[8]; int top; };
struct QNode { int value; struct QNode *next; };
struct Queue { struct QNode *head, *tail; };

void stack_push(struct Stack *s, int v) { s->items[s->top++] = v; }
int stack_pop(struct Stack *s) { return s->items[--s->top]; }

void enqueue(struct Queue *q, int v) {
    struct QNode *n = malloc(sizeof *n);
    if (!n) return;
    n->value = v;
    n->next = NULL;
    if (q->tail) q->tail->next = n; else q->head = n;
    q->tail = n;
}

int dequeue(struct Queue *q) {
    struct QNode *n = q->head;
    int v = n->value;
    q->head = n->next;
    if (!q->head) q->tail = NULL;
    free(n);
    return v;
}

int main(void) {
    struct Stack s = {.top = 0};
    struct Queue q = {NULL, NULL};
    for (int i = 1; i <= 3; i++) {
        stack_push(&s, i);
        enqueue(&q, i);
    }
    int a = stack_pop(&s);
    int b = dequeue(&q);
    printf("stack pop=%d queue dequeue=%d\n", a, b);
    while (q.head) dequeue(&q);
    return 0;
}
