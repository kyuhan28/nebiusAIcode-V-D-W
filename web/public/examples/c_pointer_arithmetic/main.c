/*
 * Pointer arithmetic and arrays.
 * p + i moves i elements, not i bytes: for int (4 bytes) that is 4 * i bytes. end points one past
 * the last element, which is allowed to form and compare but never to dereference.
 */
#include <stdio.h>

int main(void) {
    int values[5] = {3, 1, 4, 1, 5};
    int *p = values;
    int *end = values + 5;
    int sum = 0;
    while (p < end) {
        sum += *p;
        p++;
    }
    int *third = values + 2;
    printf("sum=%d third=%d distance=%ld\n", sum, *third, (long)(end - third));
    return 0;
}
