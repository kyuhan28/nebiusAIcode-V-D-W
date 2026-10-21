/*
 * Dynamic strings and buffers.
 * A heap buffer grows with realloc as words are appended. strlen counts characters; the buffer
 * needs one more byte for the terminating '\0'.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void) {
    const char *words[] = {"heap", "and", "stack"};
    size_t length = 0;
    char *text = malloc(1);
    if (!text) return 1;
    text[0] = '\0';
    for (int i = 0; i < 3; i++) {
        size_t add = strlen(words[i]) + (i > 0 ? 1 : 0);
        char *grown = realloc(text, length + add + 1);
        if (!grown) { free(text); return 1; }
        text = grown;
        if (i > 0) strcat(text, " ");
        strcat(text, words[i]);
        length += add;
    }
    printf("\"%s\" (%zu characters)\n", text, length);
    free(text);
    return 0;
}
