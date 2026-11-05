"""Regenerate standard-library ZIP variants; no third-party Python packages needed.

The python.* inputs were created with python-docx, openpyxl and python-pptx.
The fixtures intentionally exercise Python's ZIP64 path even with tiny payloads.
"""
from pathlib import Path
import io
import zipfile

ROOT = Path(__file__).parent


class Unseekable(io.BytesIO):
    def seekable(self):
        return False

    def seek(self, *args):
        raise io.UnsupportedOperation('seek')


def simple(name, *, descriptor=False, zip64=False, force_local=False, stored=False):
    old_limit = zipfile.ZIP64_LIMIT
    zipfile.ZIP64_LIMIT = 0 if zip64 else old_limit
    output = Unseekable() if descriptor else io.BytesIO()
    try:
        with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED) as archive:
            info = zipfile.ZipInfo('[Content_Types].xml', (1980, 1, 1, 0, 0, 0))
            info.compress_type = archive.compression
            with archive.open(info, 'w', force_zip64=force_local or zip64) as part:
                part.write(b'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        (ROOT / name).write_bytes(output.getvalue())
    finally:
        zipfile.ZIP64_LIMIT = old_limit


simple('python-descriptor.zip', descriptor=True)
simple('python-stored-descriptor.zip', descriptor=True, stored=True)
simple('python-zip64-descriptor.zip', descriptor=True, zip64=True)
simple('python-local-zip64.zip', force_local=True)
for extension in ['docx', 'xlsx', 'pptx']:
    old_limit = zipfile.ZIP64_LIMIT
    zipfile.ZIP64_LIMIT = 0
    try:
        with zipfile.ZipFile(ROOT / ('python.' + extension)) as source:
            with zipfile.ZipFile(ROOT / ('zip64.' + extension), 'w', compression=zipfile.ZIP_DEFLATED) as output:
                for name in source.namelist():
                    info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                    info.compress_type = output.compression
                    output.writestr(info, source.read(name))
    finally:
        zipfile.ZIP64_LIMIT = old_limit
