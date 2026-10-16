// Standalone macOS test injection ONLY. Never linked into product targets.
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/file.h>
#include <sys/stdio.h>
#include <errno.h>
static atomic_int fired = 0;
static int matches(const char *kind) {
  const char *mode = getenv("R33_GATE");
  return mode && strcmp(mode, kind) == 0 && !atomic_exchange(&fired, 1);
}
static void barrier(void) {
  char b = 'G';
  const char *n = getenv("R33_NOTIFY_FD"), *r = getenv("R33_RELEASE_FD");
  if (!n || !r || write(atoi(n), &b, 1) != 1 || read(atoi(r), &b, 1) != 1) _exit(81);
}
static int gated_flock(int fd, int operation) {
  char path[1024];
  if ((operation & LOCK_EX) && fcntl(fd, F_GETPATH, path) == 0) {
    size_t n = strlen(path);
    if (n >= 5 && strcmp(path+n-5, ".lock") == 0 && matches("beforeLock")) barrier();
  }
  return flock(fd, operation);
}
static int gated_rename(const char *a, const char *b) {
  if (b && strstr(b, "PersonalDictionary.json")) {
    if (matches("beforeRename")) barrier();
    else if (matches("failRename")) { errno = EIO; return -1; }
  }
  return rename(a, b);
}
#define INTERPOSE(replacement, original) __attribute__((used)) static struct {const void *replacement; const void *original;} pair_##original __attribute__((section("__DATA,__interpose"))) = {(const void *)&replacement, (const void *)&original};
INTERPOSE(gated_flock, flock)
INTERPOSE(gated_rename, rename)
