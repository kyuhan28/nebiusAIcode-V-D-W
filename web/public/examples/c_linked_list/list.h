#ifndef LIST_H
#define LIST_H

struct Node {
    int value;
    struct Node *next;
};

void push(struct Node **head, int value);
int length(const struct Node *head);
void free_list(struct Node *head);

#endif
