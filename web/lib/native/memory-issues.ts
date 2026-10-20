/**
 * Plain explanations for the problems AddressSanitizer, LeakSanitizer, and UndefinedBehaviorSanitizer
 * report. The finding itself (kind, line, sizes, where memory was allocated and freed) always comes
 * from the sanitizer's report; this file only explains what that kind of problem means.
 */
import type { MemoryIssue } from "@/lib/workspace/runner-client";

const WHY: Record<string, string> = {
  "heap-use-after-free": "The memory was already given back with free (or delete), but the program used it again. After free the pointer still holds the old address (free does not set it to NULL), so using it touches memory that may now belong to something else.",
  "heap-buffer-overflow": "The program read or wrote past the end (or before the start) of a block it allocated, into memory the block does not own.",
  "stack-buffer-overflow": "The program went past the end of a local array, into other variables or the function's bookkeeping on the stack.",
  "global-buffer-overflow": "The program went past the end of a global or static array.",
  "stack-use-after-scope": "The program used a local variable through a pointer after the block that declared it had ended.",
  "stack-overflow": "Calls nested too deeply (usually recursion that never reaches its base case) and used up the stack.",
  "double-free": "The same block was freed twice. The second free corrupts the allocator's records; setting a pointer to NULL after freeing it prevents this.",
  "invalid-free": "free was given an address that malloc, calloc, or realloc never returned, such as a local variable or the middle of a block.",
  "null-dereference": "The program read or wrote through a NULL pointer.",
  SEGV: "The program accessed memory it does not own.",
  "alloc-dealloc-mismatch": "Memory was released with the wrong function: new[] needs delete[], new needs delete, and malloc needs free.",
  "new-delete-type-mismatch": "An object was deleted through a pointer of the wrong type or size, often a base class without a virtual destructor.",
  leak: "This memory was allocated and never freed, and no pointer to it was left when the program ended.",
  "undefined-behavior": "The C and C++ standards give this operation no meaning, so after it the program could do anything; it is stopped here.",
};

/** One line for the Problems list: what happened, where, and what it means. */
export function describeIssue(i: MemoryIssue): string {
  let text = `${i.title}${i.message ? `: ${i.message}` : ""}`;
  if (i.access) text += ` (${i.access.op} of ${i.access.size} byte${i.access.size === 1 ? "" : "s"})`;
  if (i.region) text += `; ${i.region}`;
  if (i.kind === "leak" && i.bytes !== undefined) text += ` (${i.bytes} byte${i.bytes === 1 ? "" : "s"} in ${i.objects ?? 1} block${(i.objects ?? 1) === 1 ? "" : "s"}${i.direct === false ? ", reachable only through another leaked block" : ""})`;
  if (i.allocated?.line) text += `. Allocated at ${i.allocated.file ?? "?"}:${i.allocated.line}`;
  if (i.freed?.line) text += `, freed at ${i.freed.file ?? "?"}:${i.freed.line}`;
  const why = WHY[i.kind];
  return `${text}.${why ? ` ${why}` : ""} (${i.tool})`;
}
