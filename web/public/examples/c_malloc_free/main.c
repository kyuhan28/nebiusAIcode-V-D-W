/*
 * malloc() and free().
 * malloc reserves memory on the heap and returns its address; the contents start unset (shown as ?).
 * free gives the block back, but the pointer still holds the old address: it is now dangling.
 * Setting it to NULL afterwards makes the mistake visible instead of silent.
 */
#include <stdio.h>
#include <stdlib.h>

int main(void) {
    int *p = malloc(sizeof(int));
    if (p == NULL) return 1;
    *p = 42;
    printf("*p = %d\n", *p);
    free(p);
    /* p still holds the freed address here (dangling). */
    p = NULL;
    printf("p is %s\n", p == NULL ? "NULL" : "not NULL");
    return 0;
}
