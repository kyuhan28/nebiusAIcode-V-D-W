/*
 * A dynamically allocated linked list, across three files.
 * Each node is a separate heap block; next pointers chain them. Watch push() change main's head
 * through a pointer-to-pointer, and free_list() release every block in order.
 */
#include <stdio.h>
#include "list.h"

int main(void) {
    struct Node *head = NULL;
    for (int v = 1; v <= 4; v++) {
        push(&head, v * 10);
    }
    printf("first=%d length=%d\n", head->value, length(head));
    free_list(head);
    head = NULL;
    return 0;
}
