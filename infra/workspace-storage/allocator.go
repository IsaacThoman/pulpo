//go:build linux

package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"

	"github.com/containerd/containerd/v2/core/mount"
	"github.com/containerd/containerd/v2/core/snapshots"
	"github.com/containerd/errdefs"
	"golang.org/x/sys/unix"
)

// The disk files are the durable reservation ledger. Incomplete allocations and
// snapshots awaiting deletion continue counting after a process restart.
// All lifecycle mutations share a lock; only one process may open the state root.
const sandboxDiskBytes int64 = 128 << 20

type boundedSnapshotter struct {
	sandboxParent string
	snapshots.Snapshotter
	mu                                    sync.Mutex
	root                                  string
	diskBytes, budgetBytes, headroomBytes int64
}

func (s *boundedSnapshotter) reservedBytes() (int64, error) {
	var total int64
	seen := map[[2]uint64]bool{}
	count := func(info os.FileInfo) error {
		if !info.Mode().IsRegular() {
			return fmt.Errorf("invalid disk file")
		}
		st := info.Sys().(*syscall.Stat_t)
		id := [2]uint64{uint64(st.Dev), st.Ino}
		if seen[id] {
			return nil
		}
		seen[id] = true
		n := info.Size()
		if n == 0 {
			n = s.diskBytes
		}
		if total > s.budgetBytes-n {
			return fmt.Errorf("writable storage budget exhausted: %w", errdefs.ErrUnavailable)
		}
		total += n
		return nil
	}
	err := filepath.WalkDir(filepath.Join(s.root, "snapshots"), func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("unexpected symlink in snapshot state: %s", path)
		}
		if d.Name() != "rwlayer.img" && d.Name() != "rwlayer.img.allocating" {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		return count(info)
	})
	if err != nil {
		return 0, err
	}
	// A removed snapshot can still be held by QEMU after a failed task deletion.
	// Count those unlinked images until the final descriptor closes. Physical
	// preallocation also makes statfs account for them throughout the interval.
	processes, err := os.ReadDir("/proc")
	if err != nil {
		return 0, err
	}
	for _, process := range processes {
		if _, err := strconv.Atoi(process.Name()); err != nil {
			continue
		}
		dir := filepath.Join("/proc", process.Name(), "fd")
		fds, err := os.ReadDir(dir)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return 0, err
		}
		for _, fd := range fds {
			path := filepath.Join(dir, fd.Name())
			target, err := os.Readlink(path)
			if os.IsNotExist(err) {
				continue
			}
			if err != nil {
				return 0, err
			}
			if !strings.HasPrefix(target, filepath.Join(s.root, "snapshots")+"/") || !strings.HasSuffix(target, "rwlayer.img (deleted)") {
				continue
			}
			info, err := os.Stat(path)
			if os.IsNotExist(err) {
				continue
			}
			if err != nil {
				return 0, err
			}
			if err := count(info); err != nil {
				return 0, err
			}
		}
	}
	return total, nil
}

func (s *boundedSnapshotter) allocate(ctx context.Context, mounts []mount.Mount) error {
	return s.allocateSized(ctx, mounts, s.diskBytes)
}

func (s *boundedSnapshotter) allocateSized(ctx context.Context, mounts []mount.Mount, size int64) error {
	for _, m := range mounts {
		if m.Type != "mkfs/ext4" {
			continue
		}
		path := filepath.Clean(m.Source)
		if !strings.HasPrefix(path, filepath.Join(s.root, "snapshots")+string(os.PathSeparator)) || filepath.Base(path) != "rwlayer.img" {
			return fmt.Errorf("unexpected writable image path")
		}
		if info, err := os.Lstat(path); err == nil {
			if !info.Mode().IsRegular() || info.Size() != size {
				return fmt.Errorf("invalid existing writable disk")
			}
			// Never reformat an existing disk, including when replaying Mounts after restart.
			return nil
		} else if !os.IsNotExist(err) {
			return err
		}
		total, err := s.reservedBytes()
		if err != nil {
			return err
		}
		if total > s.budgetBytes-size {
			return fmt.Errorf("writable storage budget exhausted: %w", errdefs.ErrUnavailable)
		}
		var st unix.Statfs_t
		if err = unix.Statfs(s.root, &st); err != nil {
			return err
		}
		available := int64(st.Bavail) * int64(st.Bsize)
		if available < size+s.headroomBytes {
			return fmt.Errorf("host storage headroom exhausted: %w", errdefs.ErrUnavailable)
		}
		temporary := path + ".allocating"
		f, err := os.OpenFile(temporary, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
		if err != nil {
			return err
		}
		// Keep failed files reserved until snapshot cleanup, including process crashes.
		err = f.Truncate(size)
		if err == nil {
			err = unix.Fallocate(int(f.Fd()), 0, 0, size)
		}
		if err == nil {
			err = f.Sync()
		}
		f.Close()
		if err != nil {
			return fmt.Errorf("reserve backing blocks: %w", err)
		}
		// nodiscard avoids punching holes in the reservation during formatting.
		cmd := exec.CommandContext(ctx, "/usr/sbin/mkfs.ext4", "-q", "-F", "-m", "0", "-E", "nodiscard,lazy_itable_init=0,lazy_journal_init=0", temporary)
		if out, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("format writable disk: %w: %s", err, out)
		}
		f, err = os.OpenFile(temporary, os.O_RDWR, 0)
		if err != nil {
			return err
		}
		err = f.Sync()
		f.Close()
		if err != nil {
			return err
		}
		if err = os.Rename(temporary, path); err != nil {
			return err
		}
		dir, err := os.Open(filepath.Dir(path))
		if err != nil {
			return err
		}
		err = dir.Sync()
		dir.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *boundedSnapshotter) Prepare(ctx context.Context, key, parent string, opts ...snapshots.Opt) ([]mount.Mount, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	size := s.diskBytes
	if s.sandboxParent != "" && (parent == s.sandboxParent || strings.HasSuffix(parent, "/"+s.sandboxParent)) {
		size = sandboxDiskBytes
	}
	mounts, err := s.Snapshotter.Prepare(ctx, key, parent, opts...)
	if err != nil {
		return nil, err
	}
	if err = s.allocateSized(ctx, mounts, size); err != nil {
		_ = s.Snapshotter.Remove(context.WithoutCancel(ctx), key)
		return nil, err
	}
	for _, m := range mounts {
		if m.Type == "mkfs/ext4" {
			_, err = s.Snapshotter.Update(ctx, snapshots.Info{Name: key, Labels: map[string]string{"pulpo.dev/writable-image": m.Source, "pulpo.dev/writable-bytes": strconv.FormatInt(size, 10)}}, "labels.pulpo.dev/writable-image", "labels.pulpo.dev/writable-bytes")
			if err != nil {
				return nil, err
			}
		}
	}
	return mounts, nil
}
func (s *boundedSnapshotter) Mounts(ctx context.Context, key string) ([]mount.Mount, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	mounts, err := s.Snapshotter.Mounts(ctx, key)
	if err != nil {
		return nil, err
	}
	info, err := s.Snapshotter.Stat(ctx, key)
	if err != nil {
		return nil, err
	}
	size := s.diskBytes
	if recorded := info.Labels["pulpo.dev/writable-bytes"]; recorded != "" {
		size, err = strconv.ParseInt(recorded, 10, 64)
		if err != nil || (size != s.diskBytes && size != sandboxDiskBytes) {
			return nil, fmt.Errorf("invalid recorded disk size")
		}
	}
	if err = s.allocateSized(ctx, mounts, size); err != nil {
		return nil, err
	}
	if info.Labels["containerd.io/snapshot.ref"] == "" {
		readyMounts(mounts)
	}
	return mounts, nil
}
func (s *boundedSnapshotter) View(ctx context.Context, key, parent string, opts ...snapshots.Opt) ([]mount.Mount, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	mounts, err := s.Snapshotter.View(ctx, key, parent, opts...)
	if err != nil {
		return nil, err
	}
	if err = s.allocate(ctx, mounts); err != nil {
		_ = s.Snapshotter.Remove(context.WithoutCancel(ctx), key)
		return nil, err
	}
	return mounts, nil
}
func (s *boundedSnapshotter) Remove(ctx context.Context, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.Snapshotter.Remove(ctx, key)
}
func (s *boundedSnapshotter) Commit(ctx context.Context, name, key string, opts ...snapshots.Opt) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	info, err := s.Snapshotter.Stat(ctx, key)
	if err != nil {
		return err
	}
	path := info.Labels["pulpo.dev/writable-image"]
	if path != "" && (!strings.HasPrefix(path, filepath.Join(s.root, "snapshots")+"/") || filepath.Base(path) != "rwlayer.img") {
		return fmt.Errorf("invalid writable-image label")
	}
	if err = s.Snapshotter.Commit(ctx, name, key, opts...); err != nil {
		return err
	}
	// Committed images use layer.erofs. Retaining the temporary upper disk would
	// permanently consume one writable reservation for every imported image layer.
	if path != "" {
		if err = os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}
func (s *boundedSnapshotter) Usage(ctx context.Context, key string) (snapshots.Usage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	info, err := s.Snapshotter.Stat(ctx, key)
	if err != nil {
		return snapshots.Usage{}, err
	}
	if info.Kind != snapshots.KindActive {
		return s.Snapshotter.Usage(ctx, key)
	}
	mounts, err := s.Snapshotter.Mounts(ctx, key)
	if err != nil {
		return snapshots.Usage{}, err
	}
	for _, m := range mounts {
		if m.Type == "mkfs/ext4" {
			info, err := os.Stat(m.Source)
			if err != nil {
				return snapshots.Usage{}, err
			}
			st := info.Sys().(*syscall.Stat_t)
			return snapshots.Usage{Size: st.Blocks * 512, Inodes: 1}, nil
		}
	}
	return snapshots.Usage{}, fmt.Errorf("active snapshot has no bounded disk")
}

// Kata accepts a prepared ext4 mount. Passing mkfs/ext4 directly is unsafe:
// runtime-rs ignores it and can use an in-memory upper filesystem instead.
// Keep mkfs descriptors only on containerd's trusted image-unpack path, where
// the EROFS differ needs them to locate the target layer directory.
func readyMounts(mounts []mount.Mount) {
	for i := range mounts {
		if mounts[i].Type != "mkfs/ext4" {
			continue
		}
		mounts[i].Type = "ext4"
		options := []string{}
		for _, o := range mounts[i].Options {
			if !strings.HasPrefix(o, "X-containerd.mkfs.") {
				options = append(options, o)
			}
		}
		mounts[i].Options = options
	}
}
