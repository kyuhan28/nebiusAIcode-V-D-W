/*
 * A binary search tree on the heap.
 * insert() allocates one node per value and links it left (smaller) or right (larger). The in-order
 * walk prints the values sorted; destroy() frees children before their parent.
 */
#include <stdio.h>
#include <stdlib.h>

struct Tree {
    int value;
    struct Tree *left;
    struct Tree *right;
};

struct Tree *insert(struct Tree *root, int value) {
    if (root == NULL) {
        struct Tree *n = malloc(sizeof *n);
        if (!n) return NULL;
        n->value = value;
        n->left = n->right = NULL;
        return n;
    }
    if (value < root->value) root->left = insert(root->left, value);
    else root->right = insert(root->right, value);
    return root;
}

void in_order(const struct Tree *t) {
    if (!t) return;
    in_order(t->left);
    printf("%d ", t->value);
    in_order(t->right);
}

void destroy(struct Tree *t) {
    if (!t) return;
    destroy(t->left);
    destroy(t->right);
    free(t);
}

int main(void) {
    int values[] = {50, 30, 70, 20, 40};
    struct Tree *root = NULL;
    for (int i = 0; i < 5; i++) root = insert(root, values[i]);
    in_order(root);
    printf("\n");
    destroy(root);
    return 0;
}
