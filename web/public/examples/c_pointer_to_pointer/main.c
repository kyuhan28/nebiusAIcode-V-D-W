/*
 * Pointer parameters and pointer-to-pointer parameters.
 * set_value(int *) changes the caller's int. make_buffer(int **) changes the caller's pointer: it
 * allocates a block and stores its address in the caller's variable.
 */
#include <stdio.h>
#include <stdlib.h>

void set_value(int *target, int v) {
    *target = v;
}

int make_buffer(int **out, int n) {
    int *block = malloc(n * sizeof(int));
    if (!block) return 0;
    for (int i = 0; i < n; i++) block[i] = i + 1;
    *out = block;
    return 1;
}

int main(void) {
    int number = 0;
    set_value(&number, 7);
    int *buffer = NULL;
    if (make_buffer(&buffer, 3)) {
        printf("number=%d buffer=%d %d %d\n", number, buffer[0], buffer[1], buffer[2]);
        free(buffer);
    }
    return 0;
}
