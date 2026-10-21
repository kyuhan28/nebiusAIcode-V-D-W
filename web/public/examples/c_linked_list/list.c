#include <stdlib.h>
#include "list.h"

/* head is a pointer to the caller's pointer, so push can change where the list starts. */
void push(struct Node **head, int value) {
    struct Node *n = malloc(sizeof *n);
    if (!n) return;
    n->value = value;
    n->next = *head;
    *head = n;
}

int length(const struct Node *head) {
    int n = 0;
    for (const struct Node *p = head; p != NULL; p = p->next) n++;
    return n;
}

/* Saves next before freeing each node: after free(p), p->next may no longer be read. */
void free_list(struct Node *head) {
    while (head != NULL) {
        struct Node *next = head->next;
        free(head);
        head = next;
    }
}
