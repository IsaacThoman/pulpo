//go:build linux

// pulpo-snapshotter adds eager disk allocation to containerd's EROFS snapshotter.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	snapshotsapi "github.com/containerd/containerd/api/services/snapshots/v1"
	"github.com/containerd/containerd/v2/contrib/snapshotservice"
	"github.com/containerd/containerd/v2/plugins/snapshots/erofs"
	"golang.org/x/sys/unix"
	"google.golang.org/grpc"
)

func main() {
	sandboxParent := flag.String("sandbox-parent", "", "immutable pause image chain ID eligible for a 128MiB disk")
	root := flag.String("root", "", "dedicated snapshotter state directory (required)")
	socket := flag.String("socket", "", "Unix socket (required)")
	size := flag.Int64("disk-bytes", 20<<30, "fixed writable disk size")
	budget := flag.Int64("budget-bytes", 120<<30, "maximum total reserved writable disk bytes")
	headroom := flag.Int64("headroom-bytes", 40<<30, "minimum host free bytes after allocation")
	flag.Parse()
	if !filepath.IsAbs(*root) || !filepath.IsAbs(*socket) || *size < 64<<20 || *budget < *size || *headroom < 0 {
		log.Fatal("invalid storage configuration")
	}
	if err := os.MkdirAll(*root, 0700); err != nil {
		log.Fatal(err)
	}
	lock, err := os.OpenFile(filepath.Join(*root, "allocator.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		log.Fatal(err)
	}
	defer lock.Close()
	if err = unix.Flock(int(lock.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		log.Fatal("another allocator owns this root: ", err)
	}
	upstream, err := erofs.NewSnapshotter(*root, erofs.WithDefaultSize(*size))
	if err != nil {
		log.Fatal(err)
	}
	defer upstream.Close()
	sn := &boundedSnapshotter{Snapshotter: upstream, root: *root, sandboxParent: *sandboxParent, diskBytes: *size, budgetBytes: *budget, headroomBytes: *headroom}
	if _, err = sn.reservedBytes(); err != nil {
		log.Fatal(err)
	}
	if err = os.MkdirAll(filepath.Dir(*socket), 0700); err != nil {
		log.Fatal(err)
	}
	// The exclusive state lock ensures a previous socket belongs to a stopped server.
	if err = os.Remove(*socket); err != nil && !os.IsNotExist(err) {
		log.Fatal(err)
	}
	listener, err := net.Listen("unix", *socket)
	if err != nil {
		log.Fatal(err)
	}
	defer listener.Close()
	if err = os.Chmod(*socket, 0600); err != nil {
		log.Fatal(err)
	}
	server := grpc.NewServer()
	snapshotsapi.RegisterSnapshotsServer(server, snapshotservice.FromSnapshotter(sn))
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	go func() { <-ctx.Done(); server.Stop() }()
	fmt.Printf("storage ready disk=%d budget=%d headroom=%d\n", *size, *budget, *headroom)
	if err = server.Serve(listener); err != nil {
		log.Fatal(err)
	}
}
