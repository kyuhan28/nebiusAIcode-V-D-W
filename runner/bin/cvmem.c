/* C side of the allocation log: wraps malloc, calloc, realloc, and free via the linker's --wrap. */
#include <stdio.h>
#include "cvmem.h"
#ifdef __cplusplus
extern "C" {
#endif
struct cv_event __cv_events[CV_MAX_EVENTS];
volatile unsigned long __cv_count = 0;
volatile unsigned long __cv_dropped = 0;

void *__real_malloc(size_t);
void *__real_calloc(size_t, size_t);
void *__real_realloc(void *, size_t);
void __real_free(void *);

/* Return addresses up the frame-pointer chain (everything here is built with frame pointers). */
__attribute__((noinline)) void __cv_log(unsigned long kind, void *addr, void *old, unsigned long size, unsigned long count) {
  if (__cv_count >= CV_MAX_EVENTS) { __cv_dropped++; return; }
  struct cv_event *e = &__cv_events[__cv_count];
  e->kind = kind; e->addr = addr; e->old = old; e->size = size; e->count = count;
  void **fp = (void **)__builtin_frame_address(0);
  for (int i = 0; i < CV_FRAMES; i++) {
    if (!fp || ((unsigned long)fp & 7)) { e->callers[i] = 0; continue; }
    e->callers[i] = fp[1];
    void **next = (void **)fp[0];
    fp = (next > fp) ? next : 0;
  }
  __cv_count++;
}

void *__wrap_malloc(size_t n) { void *p = __real_malloc(n); __cv_log(CV_MALLOC, p, 0, n, 1); return p; }
void *__wrap_calloc(size_t c, size_t n) { void *p = __real_calloc(c, n); __cv_log(CV_CALLOC, p, 0, c * n, c); return p; }
void *__wrap_realloc(void *old, size_t n) { void *p = __real_realloc(old, n); __cv_log(CV_REALLOC, p, old, n, 1); return p; }
void __wrap_free(void *p) { __cv_log(CV_FREE, p, 0, 0, 0); __real_free(p); }

/* Output appears as it is printed, so each recorded step knows how much was printed by then. */
__attribute__((constructor)) static void __cv_unbuffered(void) { setvbuf(stdout, NULL, _IONBF, 0); }
#ifdef __cplusplus
}
#endif
