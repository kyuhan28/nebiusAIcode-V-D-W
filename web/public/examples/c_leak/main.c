/*
 * A controlled memory-leak diagnostic.
 * Two blocks are allocated; only one is freed, and the pointer to the other is overwritten, so it
 * can never be freed. Visualize shows the block still live when the program ends; Run reports the
 * leak with LeakSanitizer, naming the line that allocated it.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void) {
    char *kept = malloc(16);
    char *lost = malloc(24);
    if (!kept || !lost) return 1;
    strcpy(kept, "freed later");
    strcpy(lost, "never freed");
    lost = NULL;           /* the only pointer to the 24-byte block is gone */
    printf("%s\n", kept);
    free(kept);
    return 0;
}
