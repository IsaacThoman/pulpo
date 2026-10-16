// Standalone macOS worker injection ONLY; never included in product targets.
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/file.h>
#include <sqlite3.h>
static atomic_int fired = 0;
static int matches(const char *kind) {
 const char *mode = getenv("R33_GATE");
 return mode && strcmp(mode, kind) == 0 && !atomic_exchange(&fired, 1);
}
static void barrier(void) {
 char b='G'; const char *n=getenv("R33_NOTIFY_FD"), *r=getenv("R33_RELEASE_FD");
 if (!n || !r || write(atoi(n),&b,1)!=1 || read(atoi(r),&b,1)!=1) _exit(81);
}
static int gated_flock(int fd, int operation) {
 char path[1024];
 if ((operation & LOCK_EX) && fcntl(fd,F_GETPATH,path)==0) {
  size_t n=strlen(path);
  if (n>=5 && strcmp(path+n-5,".lock")==0 && matches("beforeTransaction")) barrier();
 }
 return flock(fd,operation);
}
static int gated_exec(sqlite3 *db,const char *sql,int(*callback)(void*,int,char**,char**),void *arg,char **error) {
 int commit=sql && strcmp(sql,"COMMIT")==0;
 if (commit && matches("beforeCommit")) barrier();
 if (commit && matches("failCommit")) return SQLITE_IOERR;
 int result=sqlite3_exec(db,sql,callback,arg,error);
 if (commit && result==SQLITE_OK && matches("afterCommitBeforeAck")) barrier();
 if (commit && result==SQLITE_OK && matches("reportCommitError")) return SQLITE_IOERR;
 return result;
}
static int gated_step(sqlite3_stmt *statement) {
 const char *sql=sqlite3_sql(statement);
 if (sql && strstr(sql,"INSERT INTO tokens") && matches("failAdmission")) return SQLITE_IOERR;
 return sqlite3_step(statement);
}
#define INTERPOSE(replacement,original) __attribute__((used)) static struct {const void *replacement; const void *original;} pair_##original __attribute__((section("__DATA,__interpose"))) = {(const void *)&replacement,(const void *)&original};
INTERPOSE(gated_flock,flock)
INTERPOSE(gated_exec,sqlite3_exec)
INTERPOSE(gated_step,sqlite3_step)
