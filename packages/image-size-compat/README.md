# DMG image size compatibility

`appdmg` 0.6.6 calls the legacy `image-size(filename, callback)` API. The
patched image-size 2 API returns a promise instead. This private workspace
adapts that one callback API and delegates all parsing to upstream image-size
2.0.4, installed as `image-size-patched`.

The root override routes appdmg to this workspace. Its private prerelease
version distinguishes the adapter from the upstream package. Remove the
adapter and override when appdmg supports the patched API itself.
