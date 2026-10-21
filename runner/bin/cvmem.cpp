// C++ side: the C wrappers plus replacements for the global operator new and delete (replacing them
// is standard C++). Containers allocate through these, so their buffers are logged too.
#include "cvmem.c"
#include <new>
static void *cv_new(std::size_t n, unsigned long kind) {
  void *p = __real_malloc(n ? n : 1);
  if (!p) throw std::bad_alloc();
  memset(p, 0xBE, n);  /* storage before construction: whatever a constructor leaves unset shows as uninitialized */
  __cv_log(kind, p, 0, n, 1);
  return p;
}
static void cv_delete(void *p, unsigned long kind) { if (!p) return; __cv_log(kind, p, 0, 0, 0); __real_free(p); }
void *operator new(std::size_t n) { return cv_new(n, CV_NEW); }
void *operator new[](std::size_t n) { return cv_new(n, CV_NEW_ARRAY); }
void *operator new(std::size_t n, const std::nothrow_t &) noexcept { void *p = __real_malloc(n ? n : 1); if (p) __cv_log(CV_NEW, p, 0, n, 1); return p; }
void *operator new[](std::size_t n, const std::nothrow_t &) noexcept { void *p = __real_malloc(n ? n : 1); if (p) __cv_log(CV_NEW_ARRAY, p, 0, n, 1); return p; }
void operator delete(void *p) noexcept { cv_delete(p, CV_DELETE); }
void operator delete[](void *p) noexcept { cv_delete(p, CV_DELETE_ARRAY); }
void operator delete(void *p, std::size_t) noexcept { cv_delete(p, CV_DELETE); }
void operator delete[](void *p, std::size_t) noexcept { cv_delete(p, CV_DELETE_ARRAY); }
