/*
 * Safe demonstrations of invalid memory operations.
 * By default this only creates a dangling pointer and shows it (no invalid access happens).
 * Change the Input to "use" or "double" and press Run: AddressSanitizer stops the program at the
 * invalid operation and explains it, instead of letting undefined behavior continue.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void) {
    char mode[16] = "show";
    if (scanf("%15s", mode) != 1) strcpy(mode, "show");
    int *p = malloc(sizeof(int));
    if (!p) return 1;
    *p = 5;
    free(p);                       /* p is dangling from here on */
    if (strcmp(mode, "use") == 0) {
        printf("%d\n", *p);        /* use after free */
    } else if (strcmp(mode, "double") == 0) {
        free(p);                   /* double free */
    } else {
        printf("p was freed and still holds its old address; it is not used.\n");
    }
    return 0;
}
