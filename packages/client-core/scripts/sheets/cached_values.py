#!/usr/bin/env python3
"""Formula oracle: every formula cell with its formula text and cached value.

    ~/.cache/pulpo-sheets-venv/bin/python -I cached_values.py FILE [--sheet NAME]... [--only-cached]

Loads the workbook twice (formulas, then ``data_only=True``) and joins them.
Cached values are reported as stored: dates/times are converted back to their
serial number (``isDate`` marks cells whose number format made openpyxl treat
them as dates), errors are strings like ``#DIV/0!`` with ``type: "e"``, and a
formula without a stored ``<v>`` has ``cached: null`` / ``type: null``.

Output: {"file", "date1904", "summary": {...}, "cells": [{"sheet", "cell",
"formula", "array"?, "cached", "type", "isDate"?, "numFmt"?}]} sorted by sheet
order then row/column. Exit 2 if the file cannot be loaded.
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import sys

sys.dont_write_bytecode = True  # keep the scripts dir free of __pycache__
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _sheets_common import (  # noqa: E402
    DateSerial,
    WarningCollector,
    emit,
    error_payload,
    excel_serial,
    is_strict_ooxml,
    keep_raw_date_serials,
    norm_number,
)


def collect(path: str, only_sheets: list[str] | None = None, only_cached: bool = False) -> dict:
    import openpyxl
    from openpyxl.worksheet.formula import ArrayFormula, DataTableFormula

    keep_raw_date_serials()
    if is_strict_ooxml(path):
        return {"error": {"type": "StrictOoxml", "message": "Strict OOXML is not supported by openpyxl"}}
    with WarningCollector() as wc:
        try:
            wb_f = openpyxl.load_workbook(path, data_only=False)
            wb_v = openpyxl.load_workbook(path, data_only=True)
        except Exception as exc:
            return error_payload(path, exc)
        epoch = wb_f.epoch
        cells = []
        for ws in wb_f.worksheets:
            if only_sheets and ws.title not in only_sheets:
                continue
            ws_v = wb_v[ws.title]
            for key in sorted(ws._cells):
                cell = ws._cells[key]
                v = cell.value
                if isinstance(v, ArrayFormula):
                    formula, array = v.text, v.ref
                elif isinstance(v, DataTableFormula):
                    formula, array = "{=TABLE()}", getattr(v, "ref", None)
                elif cell.data_type == "f":
                    formula, array = v, None
                else:
                    continue
                cv_cell = ws_v._cells.get(key)
                cached = cv_cell.value if cv_cell is not None else None
                entry: dict = {"sheet": ws.title, "cell": cell.coordinate, "formula": formula}
                if array:
                    entry["array"] = array
                if cached is None:
                    if only_cached:
                        continue
                    entry["cached"] = None
                    entry["type"] = None
                elif isinstance(cached, DateSerial):
                    entry["cached"] = norm_number(float(cached))
                    entry["type"] = "n"
                    entry["isDate"] = True
                elif isinstance(cached, (dt.datetime, dt.date, dt.time, dt.timedelta)):
                    # t="d" (ISO 8601) cached value
                    entry["cached"] = excel_serial(cached, epoch)
                    entry["type"] = "n"
                    entry["isDate"] = True
                elif isinstance(cached, bool):
                    entry["cached"] = cached
                    entry["type"] = "b"
                elif isinstance(cached, (int, float)):
                    entry["cached"] = norm_number(cached)
                    entry["type"] = "n"
                else:
                    entry["cached"] = str(cached)
                    entry["type"] = cv_cell.data_type if cv_cell.data_type in ("e", "s") else "s"
                if cell.number_format and cell.number_format != "General":
                    entry["numFmt"] = cell.number_format
                cells.append(entry)
    with_cache = sum(1 for c in cells if c["type"] is not None)
    return {
        "file": os.path.basename(path),
        "date1904": epoch.year == 1904,
        "summary": {
            "formulaCells": len(cells),
            "withCachedValue": with_cache,
            "withoutCachedValue": len(cells) - with_cache,
            "errors": sum(1 for c in cells if c["type"] == "e"),
        },
        "cells": cells,
        "warnings": wc.messages(),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file")
    ap.add_argument("--sheet", action="append")
    ap.add_argument("--only-cached", action="store_true", help="skip formulas without a stored value")
    args = ap.parse_args()
    if not os.path.isfile(args.file):
        emit({"error": {"type": "FileNotFoundError", "message": args.file}}, 2)
    result = collect(args.file, args.sheet, args.only_cached)
    emit(result, 2 if "error" in result else 0)


if __name__ == "__main__":
    main()
