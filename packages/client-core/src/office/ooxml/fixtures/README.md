# OOXML ZIP regression fixtures

These small fixtures contain synthetic example content. Tests read and round-trip every part;
no fixture content is executed. Tests need neither Python nor an Office installation.

- `understated-deflate.zip`, `bypass-sentinel.zip`, `zip64-renamed-local.zip`,
  `local-method-mismatch.zip`, `mismatched-counts.zip`, `encrypted-real.zip`, and
  `valid-small-zip64.zip` are the supplied #941 review reproductions. The first declares
  32,618 bytes for a 32 MiB deflate stream; the encryption example contains only the text
  `SECRET MEDIA PAYLOAD`. The remaining cases mutate ZIP headers/counts or use Python ZIP64.
- `python.docx`, `python.xlsx`, and `python.pptx` were generated for that review with
  python-docx, openpyxl, and python-pptx respectively (a heading/paragraph/table, a small
  worksheet/formula, and one slide). `libreoffice.*` are their LibreOffice exports.
- `zip64.docx`, `zip64.xlsx`, and `zip64.pptx` repack the Python examples using Python's
  standard `zipfile`, with `ZIP64_LIMIT = 0`. This exercises ZIP64 extras, the ZIP64 end
  record and locator even though all documents are small.
- `python-*-descriptor.zip` and `python-descriptor.zip` are standard-library zipfile
  exports to a non-seekable stream. `python-local-zip64.zip` uses `force_zip64=True`
  without forcing ZIP64 end records. Each contains only `[Content_Types].xml`.

Run `python3 -I generate.py` in this directory to regenerate the ZIP64 repacks and the
small descriptor/local-ZIP64 fixtures, using only the standard library. Fixed timestamps
make these generated variants reproducible.

The three `office.*` files are Microsoft-authored examples from the Apache POI test-data
corpus at commit `7f4d36854109efa17152b27a5fb1b2c7d842c314` (their `docProps/app.xml`
identifies Word, Excel, and PowerPoint). They are distributed under Apache-2.0; the upstream
license and notice are included as `POI-LICENSE.txt` and `POI-NOTICE.txt`.

| Local file | Upstream source |
| --- | --- |
| `office.docx` | [document/SampleDoc.docx](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/document/SampleDoc.docx) |
| `office.xlsx` | [spreadsheet/45430.xlsx](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/45430.xlsx) |
| `office.pptx` | [slideshow/SampleShow.pptx](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/slideshow/SampleShow.pptx) |
