//go:build linux

package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/containerd/containerd/v2/core/mount"
	"github.com/containerd/containerd/v2/plugins/snapshots/erofs"
)

const testDisk = 64 << 20

func newTestSnapshotter(t *testing.T, root string, budget int64) *boundedSnapshotter {
	t.Helper()
	up, err := erofs.NewSnapshotter(root, erofs.WithDefaultSize(testDisk))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { up.Close() })
	return &boundedSnapshotter{Snapshotter: up, root: root, diskBytes: testDisk, budgetBytes: budget}
}
func TestConcurrentAllocationsAndDeletion(t *testing.T) {
	s := newTestSnapshotter(t, t.TempDir(), 2*testDisk)
	var wg sync.WaitGroup
	var success atomic.Int32
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := s.Prepare(context.Background(), fmt.Sprint(i), "")
			if err == nil {
				success.Add(1)
			}
		}(i)
	}
	wg.Wait()
	if success.Load() != 2 {
		t.Fatalf("admitted %d instead of 2", success.Load())
	}
	total, err := s.reservedBytes()
	if err != nil || total != 2*testDisk {
		t.Fatalf("reserved %d: %v", total, err)
	}
	for i := 0; i < 8; i++ {
		_ = s.Remove(context.Background(), fmt.Sprint(i))
	}
	total, err = s.reservedBytes()
	if err != nil || total != 0 {
		t.Fatalf("cleanup reserved %d: %v", total, err)
	}
	if _, err = s.Prepare(context.Background(), "replacement", ""); err != nil {
		t.Fatal(err)
	}
}
func TestRestartPreservesDiskAndReservations(t *testing.T) {
	root := t.TempDir()
	s := newTestSnapshotter(t, root, testDisk)
	mounts, err := s.Prepare(context.Background(), "first", "")
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(mounts[0].Source)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	restarted := newTestSnapshotter(t, root, testDisk)
	if _, err = restarted.Prepare(context.Background(), "second", ""); err == nil {
		t.Fatal("restart lost reservation")
	}
	if _, err = restarted.Mounts(context.Background(), "first"); err != nil {
		t.Fatal(err)
	}
	after, _ := os.Stat(mounts[0].Source)
	if !after.ModTime().Equal(info.ModTime()) {
		t.Fatal("existing disk modified on remount")
	}
	usage, err := restarted.Usage(context.Background(), "first")
	if err != nil || usage.Size < testDisk {
		t.Fatalf("disk not physically reserved: %+v %v", usage, err)
	}
}
func TestFailedAllocationAndSymlinkFailClosed(t *testing.T) {
	root := t.TempDir()
	s := newTestSnapshotter(t, root, testDisk)
	dir := filepath.Join(root, "snapshots", "orphan")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "rwlayer.img.allocating"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	total, err := s.reservedBytes()
	if err != nil || total != testDisk {
		t.Fatalf("incomplete reservation not counted: %d %v", total, err)
	}
	// A failed new Prepare can garbage collect truly orphaned snapshot directories;
	// check admission directly before upstream's cleanup runs.
	target := filepath.Join(dir, "rwlayer.img")
	if err = s.allocate(context.Background(), []mount.Mount{{Type: "mkfs/ext4", Source: target}}); err == nil {
		t.Fatal("ignored incomplete reservation")
	}
	if err = os.Symlink(t.TempDir(), filepath.Join(root, "snapshots", "link")); err != nil {
		t.Fatal(err)
	}
	if _, err = s.reservedBytes(); err == nil {
		t.Fatal("followed symlink in reservation ledger")
	}
}
func TestHeadroomRefusesBeforeAllocation(t *testing.T) {
	s := newTestSnapshotter(t, t.TempDir(), testDisk)
	s.headroomBytes = 1 << 60
	if _, err := s.Prepare(context.Background(), "too-large", ""); err == nil {
		t.Fatal("ignored headroom")
	}
	total, err := s.reservedBytes()
	if err != nil || total != 0 {
		t.Fatalf("failed request leaked reservation: %d %v", total, err)
	}
}

func TestDeletedOpenDiskRetainsReservation(t *testing.T) {
	s := newTestSnapshotter(t, t.TempDir(), testDisk)
	mounts, err := s.Prepare(context.Background(), "held", "")
	if err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(mounts[0].Source)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err = s.Remove(context.Background(), "held"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Prepare(context.Background(), "replacement", ""); err == nil {
		t.Fatal("reused deleted but open storage")
	}
	f.Close()
	if _, err = s.Prepare(context.Background(), "replacement", ""); err != nil {
		t.Fatal(err)
	}
}
func TestKataReceivesFormattedBlockMount(t *testing.T) {
	s := newTestSnapshotter(t, t.TempDir(), testDisk)
	if _, err := s.Prepare(context.Background(), "guest", ""); err != nil {
		t.Fatal(err)
	}
	mounts, err := s.Mounts(context.Background(), "guest")
	if err != nil {
		t.Fatal(err)
	}
	if mounts[0].Type != "ext4" {
		t.Fatalf("Kata would ignore %s and use memory", mounts[0].Type)
	}
}
