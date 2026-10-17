import Foundation

/// A read-only memory map. Pages stay clean, so the dictionary barely counts
/// against the keyboard extension's memory limit.
public final class MappedFile: @unchecked Sendable {
  public let base: UnsafeRawPointer
  public let count: Int

  public init(url: URL) throws {
    let descriptor = open(url.path, O_RDONLY)
    guard descriptor >= 0 else { throw CocoaError(.fileReadNoSuchFile, userInfo: [NSFilePathErrorKey: url.path]) }
    defer { close(descriptor) }
    var info = stat()
    guard fstat(descriptor, &info) == 0, info.st_size > 0 else { throw CocoaError(.fileReadCorruptFile) }
    let size = Int(info.st_size)
    guard let address = mmap(nil, size, PROT_READ, MAP_PRIVATE, descriptor, 0), address != MAP_FAILED else {
      throw CocoaError(.fileReadUnknown)
    }
    base = UnsafeRawPointer(address)
    count = size
  }

  deinit {
    munmap(UnsafeMutableRawPointer(mutating: base), count)
  }
}

/// A typed view into a section of a mapped file.
struct MappedArray<Element>: @unchecked Sendable {
  let base: UnsafeRawPointer
  let count: Int

  init(base: UnsafeRawPointer, byteCount: Int) {
    self.base = base
    count = byteCount / MemoryLayout<Element>.stride
  }

  @inline(__always) subscript(index: Int) -> Element {
    base.loadUnaligned(fromByteOffset: index &* MemoryLayout<Element>.stride, as: Element.self)
  }
}
