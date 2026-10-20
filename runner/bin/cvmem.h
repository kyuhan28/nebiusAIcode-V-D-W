/*
 * codeviz allocation log, linked into C and C++ programs only when they are recorded (Visualize).
 * Every allocation the program's own code makes (malloc, calloc, realloc, free, new, delete) is
 * logged with its real address, size, and the return addresses of the calling frames. The recorder
 * reads this log from the stopped process; nothing here changes what the allocator does.
 */
#ifndef CVMEM_H
#define CVMEM_H
#include <stddef.h>
#define CV_MAX_EVENTS 8192
#define CV_FRAMES 6
enum { CV_MALLOC = 1, CV_CALLOC, CV_REALLOC, CV_FREE, CV_NEW, CV_NEW_ARRAY, CV_DELETE, CV_DELETE_ARRAY };
struct cv_event {
  unsigned long kind;
  void *addr;        /* the block (result for allocations, argument for frees) */
  void *old;         /* realloc: the block it was asked to resize */
  unsigned long size;
  unsigned long count; /* calloc: number of elements */
  void *callers[CV_FRAMES];
};
#endif
