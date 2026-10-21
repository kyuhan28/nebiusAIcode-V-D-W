/*
 * calloc() versus malloc().
 * Both reserve 4 ints. calloc sets every byte to zero; malloc leaves the contents unspecified
 * (shown as ? until written). Only the first two malloc'd elements are written here.
 */
#include <stdio.h>
#include <stdlib.h>

int main(void) {
    int *zeroed = calloc(4, sizeof(int));
    int *unset = malloc(4 * sizeof(int));
    if (!zeroed || !unset) return 1;
    unset[0] = 10;
    unset[1] = 20;
    printf("calloc: %d %d %d %d\n", zeroed[0], zeroed[1], zeroed[2], zeroed[3]);
    printf("malloc: %d %d (the rest were never written)\n", unset[0], unset[1]);
    free(zeroed);
    free(unset);
    return 0;
}
