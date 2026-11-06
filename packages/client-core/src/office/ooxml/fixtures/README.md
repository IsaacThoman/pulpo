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

The subsequent #941 re-review supplied `proto-main.docx` (an extensionless main part
named `__proto__`) and `tz-change.docx` (the review's `fresh.docx`, a synthetic python-docx
example). The writer tests use these directly. `unsigned-zip64-crc-signature.bin` is an
exact 24-byte slice from its valid `unsigned-zip64-crc-signature.zip`: the unsigned ZIP64
descriptor and the next local-header signature. Its CRC, compressed size and original size
are all `0x08074b50`. The full stored input is 134,696,034 bytes; only this slice is committed
so the ambiguous-layout regression exercises the production descriptor parser without
allocating hundreds of MiB on every run. The complete input was also verified through
`OoxmlPackage.read` during the fix.

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

`printerSettings1.bin` and `printerSettings3.bin` are the original 2,452-byte payloads from
`xl/printerSettings/printerSettings{1,3}.bin` in Apache POI's
[sample.xlsx](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/sample.xlsx).
The complete workbook is `poi-sample.xlsx` (12,348 bytes), copied from the sheets branch's
pinned POI corpus. These fixtures are Apache-2.0, covered by the included POI license and
notice. Streaming `ZipDeflate` at level 6 generates invalid distances for both binary parts;
one-shot `deflateSync` at level 6 round-trips them through Python zlib and our bounded reader.
The writer regressions cover both the isolated payloads and the complete workbook.
