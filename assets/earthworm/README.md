# Earthworm app icon

The Pulpo app icon is a headshot of this earthworm, rendered in the smiley's
style: a satin body lit from the upper left, with a faceted charcoal face.

- `build-earthworm.py` models the worm, renders it, and saves `earthworm.blend`.
- `install-app-icon.py` copies the renders into the app:
  - `apps/mobile/assets/Pulpo.icon` (Icon Composer, used by iOS and the macOS
    desktop app): `earthworm-body.png` with `earthworm-face.png` on top as a
    glass layer, the same split as the smiley's noface/justface layers.
  - `apps/mobile/assets/pulpo-app-icon.png`: the flattened icon (Android legacy
    icon, docs apple-touch-icon and og:image, desktop DMG check).
  - `apps/mobile/assets/earthworm-android-foreground.png`: Android adaptive icon.
  - `apps/desktop/assets/Pulpo.icns` and `Pulpo.ico`.

To regenerate everything, from the repository root:

```sh
blender --background --python-exit-code 1 \
  --python assets/earthworm/build-earthworm.py -- --size 2048 --samples 512 \
  --only earthworm-icon,earthworm-icon-body,earthworm-icon-face,earthworm-android-foreground
python3 assets/earthworm/install-app-icon.py
```

Leave out `--only` to also render the full-body previews into `renders/`, which
is not committed.
