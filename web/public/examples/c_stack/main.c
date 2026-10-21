/*
 * Stack variables and function calls.
 * Watch each call get its own frame with its own variables. swap() receives addresses (&x, &y),
 * so its parameters a and b point back into main's frame. When a call returns, its frame is gone.
 */
#include <stdio.h>

void swap(int *a, int *b) {
    int t = *a;
    *a = *b;
    *b = t;
}

int square(int n) {
    int result = n * n;
    return result;
}

int main(void) {
    int x = 3;
    int y = 8;
    swap(&x, &y);
    int s = square(x);
    printf("x=%d y=%d square=%d\n", x, y, s);
    return 0;
}
