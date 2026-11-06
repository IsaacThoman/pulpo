# Converter fixtures

Real documents the converter's tests and image smoke test convert. They are untrusted input
like any user file.

| File | Source | License |
| --- | --- | --- |
| `SampleDoc.doc`, `SimpleMacro.doc`, `password_tika_binaryrc4.doc`, `sample.docx`, `test.dotx`, `protected_agile.docx`, `bug53475-password-is-pass.docx` | [Apache POI test-data](https://github.com/apache/poi/tree/trunk/test-data) (`document/`, `poifs/`), written by Microsoft Word | Apache-2.0 |
| `SampleSS.xls`, `password.xls`, `SampleSS.ods`, `test.xltx` | Apache POI test-data (`spreadsheet/`), written by Microsoft Excel (the `.ods` by OpenOffice) | Apache-2.0 |
| `basic_test_ppt_file.ppt`, `Password_Protected-hello.ppt` | Apache POI test-data (`slideshow/`), written by Microsoft PowerPoint | Apache-2.0 |
| `basic_test_ppt_file.pps` | A copy of `basic_test_ppt_file.ppt`: `.pps` files hold the same binary format | Apache-2.0 |
| `pages5-file.pages`, `numbers3-file.numbers`, `keynote5-file.key` | [libetonyek test data](https://github.com/LibreOffice/libetonyek/tree/master/src/test/data), written by Apple iWork | MPL-2.0 |
| `WP6.wpd` | [LibreOffice core](https://github.com/LibreOffice/core/tree/master/writerperfect/qa/unit/data/writer/libwpd/pass), a WordPerfect 6 document | MPL-2.0 |
| `SampleDoc.rtf`, `SampleDoc.odt`, `SampleDoc.ott`, `SampleSS.ots`, `basic_test_ppt_file.odp`, `basic_test_ppt_file.otp`, `basic_test_ppt_file.potx` | Saved by LibreOffice 26.8 from the POI files above (LibreOffice is the reference OpenDocument implementation) | Apache-2.0 |

`password_tika_binaryrc4.doc`, `password.xls`, `Password_Protected-hello.ppt`, and
`bug53475-password-is-pass.docx` are password-protected; `protected_agile.docx` uses Office's
default password, which LibreOffice opens. `SimpleMacro.doc` carries a VBA project, which is
never run.
