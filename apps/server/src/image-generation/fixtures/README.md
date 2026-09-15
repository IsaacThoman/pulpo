# Synthetic MPO regression fixture

`oriented-mpo.jpg` is a two-image MPO container with a JPEG extension, matching
the container mismatch encountered with phone HDR JPEGs. It contains only red,
blue and gray rectangles, EXIF orientation 6, and a synthetic artist tag. There
is no user photo or other production data in this fixture.

Generate it with Pillow:

```python
from PIL import Image
im = Image.new('RGB', (64, 32), 'red')
im.paste('blue', (32, 0, 64, 32))
aux = Image.new('RGB', (32, 16), 'gray')
exif = Image.Exif()
exif[274] = 6
exif[315] = 'Pulpo synthetic test fixture'
im.save('oriented-mpo.jpg', format='MPO', save_all=True,
        append_images=[aux], exif=exif, quality=100, subsampling=0)
```

Pillow identifies two MPO frames. Sharp identifies JPEG and does not report
multiple pages, so signature checks and the existing animation check alone
cannot guarantee a provider-compatible single image. Tests verify that the
actual outgoing bytes contain one JPEG image, no MPF/EXIF metadata, and correctly
rotated pixels. The fixture intentionally does not reproduce Apple's private
HDR metadata; normalization should not depend on recognizing a vendor's tags.
