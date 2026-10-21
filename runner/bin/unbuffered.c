/*
 * Linked into C and C++ runs: stdout is written as it is printed. Otherwise output to a pipe waits in
 * a buffer until exit, and when a sanitizer stops the program (a leak, a use after free) that buffer
 * is never flushed, so everything the program printed would be lost.
 */
#include <stdio.h>
__attribute__((constructor)) static void codeviz_unbuffered_stdout(void) { setvbuf(stdout, NULL, _IONBF, 0); }
