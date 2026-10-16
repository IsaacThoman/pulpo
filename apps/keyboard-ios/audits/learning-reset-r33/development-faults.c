// Additional development-only syscall/SQLite failures. Never linked into app.
#include <sqlite3.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
static atomic_int fired=0, deny_begin=0, deny_rollback=0, partial=0;
static int mode(const char *s) {const char *p=getenv("R33_GATE");return p && !strcmp(p,s);}
static void triggered(const char *s) {fprintf(stderr,"R33_FAULT:%s\n",s);fflush(stderr);}
static int exec_fault(sqlite3 *db,const char *sql,int(*cb)(void*,int,char**,char**),void *arg,char **error) {
 if (!strcmp(sql,"BEGIN IMMEDIATE") && atomic_exchange(&deny_begin,0)) {triggered("reconciliation-read");return SQLITE_IOERR;}
 if (!strcmp(sql,"ROLLBACK") && atomic_load(&deny_rollback)>0) {atomic_fetch_sub(&deny_rollback,1);triggered("rollback");return SQLITE_IOERR;}
 if (!strcmp(sql,"COMMIT") && mode("rollbackStuck") && !atomic_exchange(&fired,1)) {
  atomic_store(&deny_rollback,2);triggered("precommit-stuck-rollback");return SQLITE_IOERR;
 }
 int rc=sqlite3_exec(db,sql,cb,arg,error);
 if (!strcmp(sql,"COMMIT") && rc==SQLITE_OK && mode("uncertainCommit") && !atomic_exchange(&fired,1)) {
  atomic_store(&deny_begin,1);triggered("successful-commit-reported-error");return SQLITE_IOERR;
 }
 return rc;
}
static int journal(int fd) {char p[1024];return fcntl(fd,F_GETPATH,p)==0 && strstr(p,".learning-v2.sqlite-journal");}
static ssize_t pwrite_fault(int fd,const void *data,size_t n,off_t offset) {
 if (journal(fd)) {
  if (mode("partialJournal") && !atomic_load(&fired)) {
   if (!atomic_exchange(&partial,1)) {triggered("partial-journal-write");return pwrite(fd,data,n>1?n/2:0,offset);}
   atomic_store(&fired,1);triggered("partial-journal-error");errno=EIO;return -1;
  }
  if (mode("failJournalWrite") && !atomic_exchange(&fired,1)) {triggered("journal-write-error");errno=EIO;return -1;}
 }
 return pwrite(fd,data,n,offset);
}
extern ssize_t pwrite_nocancel(int,const void*,size_t,off_t) __asm("_pwrite$NOCANCEL");
extern ssize_t write_nocancel(int,const void*,size_t) __asm("_write$NOCANCEL");
static int write_failure(int fd,size_t n, size_t *amount) {
 if (!journal(fd)) return 0;
 if (mode("partialJournal") && !atomic_load(&fired)) {
  if (!atomic_exchange(&partial,1)) {triggered("partial-journal-write");*amount=n>1?n/2:0;return 1;}
  atomic_store(&fired,1);triggered("partial-journal-error");errno=EIO;return -1;
 }
 if (mode("failJournalWrite") && !atomic_exchange(&fired,1)) {triggered("journal-write-error");errno=EIO;return -1;}
 return 0;
}
static ssize_t write_fault(int fd,const void *data,size_t n) {
 size_t amount=n;int fault=write_failure(fd,n,&amount);if(fault<0)return -1;return write(fd,data,amount);
}
static ssize_t write_nocancel_fault(int fd,const void *data,size_t n) {
 size_t amount=n;int fault=write_failure(fd,n,&amount);if(fault<0)return -1;return write_nocancel(fd,data,amount);
}
static ssize_t pwrite_nocancel_fault(int fd,const void *data,size_t n,off_t offset) {
 size_t amount=n;int fault=write_failure(fd,n,&amount);if(fault<0)return -1;return pwrite_nocancel(fd,data,amount,offset);
}
static int fsync_fault(int fd) {
 if (journal(fd) && mode("failJournalSync") && !atomic_exchange(&fired,1)) {triggered("journal-fsync-error");errno=EIO;return -1;}
 return fsync(fd);
}
#define INTERPOSE(replacement,original) __attribute__((used)) static struct {const void *replacement; const void *original;} pair_##original __attribute__((section("__DATA,__interpose")))={(const void *)&replacement,(const void *)&original};
INTERPOSE(exec_fault,sqlite3_exec)
INTERPOSE(pwrite_fault,pwrite)
INTERPOSE(fsync_fault,fsync)

INTERPOSE(write_fault,write)
INTERPOSE(write_nocancel_fault,write_nocancel)
INTERPOSE(pwrite_nocancel_fault,pwrite_nocancel)
// Apple SQLite's darwinPwrite preserves a guarded descriptor. Forward its guard
// unchanged; replacing that VFS function with plain POSIX pwrite is invalid.
#include <stdint.h>
extern ssize_t guarded_pwrite_np(int,const uint64_t*,const void*,size_t,off_t);
extern ssize_t guarded_write_np(int,const uint64_t*,const void*,size_t);
static ssize_t guarded_pwrite_fault(int fd,const uint64_t *guard,const void *data,size_t n,off_t offset) {
 size_t amount=n;int fault=write_failure(fd,n,&amount);if(fault<0)return -1;
 return guarded_pwrite_np(fd,guard,data,amount,offset);
}
static ssize_t guarded_write_fault(int fd,const uint64_t *guard,const void *data,size_t n) {
 size_t amount=n;int fault=write_failure(fd,n,&amount);if(fault<0)return -1;
 return guarded_write_np(fd,guard,data,amount);
}
INTERPOSE(guarded_pwrite_fault,guarded_pwrite_np)
INTERPOSE(guarded_write_fault,guarded_write_np)
