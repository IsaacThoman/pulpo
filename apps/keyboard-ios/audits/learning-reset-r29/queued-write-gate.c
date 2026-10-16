// Test-only Darwin syscall gate. No production source/private state is changed.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <stdatomic.h>
#include <sys/stdio.h>
#include <fcntl.h>
static atomic_int fired = 0;
static void gate(const char *destination) {
  if (!destination || !strstr(destination, "PersonalDictionary.json") || !getenv("R29_ARMED")) return;
  if (atomic_exchange(&fired, 1)) return;
  int notify_fd = atoi(getenv("R29_NOTIFY_FD"));
  int release_fd = atoi(getenv("R29_RELEASE_FD"));
  char byte = 'x';
  if (write(notify_fd, &byte, 1) != 1 || read(release_fd, &byte, 1) != 1) _exit(71);
}
static int gated_rename(const char *a, const char *b) { gate(b); return rename(a,b); }
static int gated_renameat(int a, const char *b, int c, const char *d) { gate(d); return renameat(a,b,c,d); }
static int gated_renamex_np(const char *a, const char *b, unsigned int f) { gate(b); return renamex_np(a,b,f); }
static int gated_renameatx_np(int a, const char *b, int c, const char *d, unsigned int f) { gate(d); return renameatx_np(a,b,c,d,f); }
#define INTERPOSE(replacement, original) __attribute__((used)) static struct { const void *new_fn; const void *old_fn; } pair_##original __attribute__((section("__DATA,__interpose"))) = { (const void *)&replacement, (const void *)&original };
INTERPOSE(gated_rename, rename)
INTERPOSE(gated_renameat, renameat)
INTERPOSE(gated_renamex_np, renamex_np)
INTERPOSE(gated_renameatx_np, renameatx_np)
