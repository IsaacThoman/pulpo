#!/usr/bin/env python3
"""Apply "agent-style" edits to a workbook with openpyxl and save it.

    ~/.cache/pulpo-sheets-venv/bin/python -I edit_with_openpyxl.py IN OUT OPS

OPS is a JSON array (inline, ``@path/to/ops.json``, or ``-`` for stdin). This
simulates an AI agent editing the file with openpyxl, so tests can check that
our ``applyFile`` merges such an edit into the live document. Note that an
openpyxl load/save drops what openpyxl does not model (shapes, x14 extLst,
threaded comments, slicers, sparklines, ...); that loss is part of what is
being simulated. ``[]`` performs a plain load/save round-trip.

Operations (``sheet`` defaults to the active sheet):
  {"op": "set", "sheet": "S", "cell": "B2", "value": 42}
      value may be a number, string, bool or null; strings starting with "="
      are formulas. {"formula": "=SUM(A1:A3)"} or {"date": "2024-01-31"} /
      {"datetime": "2024-01-31T12:00:00"} are also accepted instead of value.
  {"op": "set_range", "sheet": "S", "start": "A1", "rows": [[1, 2], ["x", "=A1*2"]]}
  {"op": "insert_rows", "sheet": "S", "idx": 3, "amount": 1}      (1-based)
  {"op": "delete_rows", "sheet": "S", "idx": 3, "amount": 1}
  {"op": "insert_cols", "sheet": "S", "idx": 2, "amount": 1}
  {"op": "delete_cols", "sheet": "S", "idx": 2, "amount": 1}
  {"op": "add_sheet", "name": "New", "index": 1}
  {"op": "delete_sheet", "name": "Old"}
  {"op": "rename_sheet", "name": "Old", "new_name": "New"}
  {"op": "copy_sheet", "name": "S", "new_name": "S copy"}
  {"op": "style", "sheet": "S", "range": "A1:C1",
      "font": {"bold": true, "italic": true, "color": "FF0000", "size": 14, "name": "Arial", "underline": "single"},
      "fill": {"color": "FFFF00", "pattern": "solid"},
      "number_format": "0.00%",
      "alignment": {"horizontal": "center", "vertical": "top", "wrap": true},
      "border": {"style": "thin", "color": "000000"}}
  {"op": "merge", "sheet": "S", "range": "A1:C1"} / {"op": "unmerge", ...}
  {"op": "column_width", "sheet": "S", "column": "B", "width": 20}
  {"op": "row_height", "sheet": "S", "row": 2, "height": 30}
  {"op": "freeze", "sheet": "S", "cell": "B2"}          (null cell unfreezes)
  {"op": "comment", "sheet": "S", "cell": "A1", "text": "hi", "author": "agent"}
  {"op": "hyperlink", "sheet": "S", "cell": "A1", "target": "https://example.com"}
  {"op": "define_name", "name": "Total", "value": "Sheet1!$B$10"}
  {"op": "sheet_state", "name": "S", "state": "hidden"}

Prints ``{"ok": true, "applied": N, "output": OUT, "sheets": [...]}``; exit 2
with ``{"ok": false, "error": ...}`` on failure.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sys

sys.dont_write_bytecode = True  # keep the scripts dir free of __pycache__
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _sheets_common import WarningCollector, emit  # noqa: E402


def load_ops(arg: str) -> list:
    if arg == "-":
        text = sys.stdin.read()
    elif arg.startswith("@"):
        with open(arg[1:], encoding="utf-8") as fh:
            text = fh.read()
    else:
        text = arg
    ops = json.loads(text)
    if not isinstance(ops, list):
        raise ValueError("ops must be a JSON array")
    return ops


def sheet_of(wb, op):
    name = op.get("sheet")
    if name is None:
        return wb.active
    if name not in wb.sheetnames:
        raise KeyError(f"no sheet named {name!r}")
    return wb[name]


def cell_input(op):
    if "formula" in op:
        f = op["formula"]
        return f if f.startswith("=") else "=" + f
    if "date" in op:
        return dt.date.fromisoformat(op["date"])
    if "datetime" in op:
        return dt.datetime.fromisoformat(op["datetime"])
    return op.get("value")


def color(c):
    from openpyxl.styles.colors import Color

    if c is None:
        return None
    if isinstance(c, dict) and "theme" in c:
        return Color(theme=c["theme"], tint=c.get("tint", 0.0))
    text = str(c).lstrip("#").upper()
    return Color(rgb=("FF" + text) if len(text) == 6 else text)


def apply_style(ws, op):
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

    for row in ws[op["range"]] if ":" in op["range"] else [[ws[op["range"]]]]:
        for cell in row:
            if "font" in op:
                f = op["font"]
                base = cell.font
                cell.font = Font(
                    name=f.get("name", base.name),
                    sz=f.get("size", base.sz),
                    b=f.get("bold", base.b),
                    i=f.get("italic", base.i),
                    u=f.get("underline", base.u),
                    strike=f.get("strike", base.strike),
                    color=color(f["color"]) if "color" in f else base.color,
                    vertAlign=base.vertAlign,
                    scheme=base.scheme if "name" not in f else None,
                    family=base.family,
                    charset=base.charset,
                )
            if "fill" in op:
                fl = op["fill"]
                c = color(fl.get("color"))
                cell.fill = PatternFill(patternType=fl.get("pattern", "solid"), fgColor=c, bgColor=c)
            if "number_format" in op:
                cell.number_format = op["number_format"]
            if "alignment" in op:
                al = op["alignment"]
                base = cell.alignment
                cell.alignment = Alignment(
                    horizontal=al.get("horizontal", base.horizontal),
                    vertical=al.get("vertical", base.vertical),
                    wrap_text=al.get("wrap", base.wrap_text),
                    text_rotation=al.get("rotation", base.text_rotation),
                    indent=al.get("indent", base.indent),
                    shrink_to_fit=al.get("shrink", base.shrink_to_fit),
                )
            if "border" in op:
                b = op["border"]
                side = Side(style=b.get("style", "thin"), color=color(b.get("color", "000000")))
                cell.border = Border(left=side, right=side, top=side, bottom=side)


def apply(wb, op) -> None:
    from openpyxl.comments import Comment
    from openpyxl.utils.cell import coordinate_from_string, column_index_from_string
    from openpyxl.workbook.defined_name import DefinedName

    kind = op.get("op")
    if kind == "set":
        sheet_of(wb, op)[op["cell"]] = cell_input(op)
    elif kind == "set_range":
        ws = sheet_of(wb, op)
        col_letter, row0 = coordinate_from_string(op.get("start", "A1"))
        col0 = column_index_from_string(col_letter)
        for r, values in enumerate(op["rows"]):
            for c, v in enumerate(values):
                ws.cell(row=row0 + r, column=col0 + c, value=v)
    elif kind in ("insert_rows", "delete_rows", "insert_cols", "delete_cols"):
        ws = sheet_of(wb, op)
        getattr(ws, kind)(int(op["idx"]), int(op.get("amount", 1)))
    elif kind == "add_sheet":
        wb.create_sheet(title=op["name"], index=op.get("index"))
    elif kind == "delete_sheet":
        del wb[op["name"]]
    elif kind == "rename_sheet":
        wb[op["name"]].title = op["new_name"]
    elif kind == "copy_sheet":
        copy = wb.copy_worksheet(wb[op["name"]])
        if op.get("new_name"):
            copy.title = op["new_name"]
    elif kind == "style":
        apply_style(sheet_of(wb, op), op)
    elif kind == "merge":
        sheet_of(wb, op).merge_cells(op["range"])
    elif kind == "unmerge":
        sheet_of(wb, op).unmerge_cells(op["range"])
    elif kind == "column_width":
        sheet_of(wb, op).column_dimensions[op["column"]].width = float(op["width"])
    elif kind == "row_height":
        sheet_of(wb, op).row_dimensions[int(op["row"])].height = float(op["height"])
    elif kind == "freeze":
        sheet_of(wb, op).freeze_panes = op.get("cell")
    elif kind == "comment":
        sheet_of(wb, op)[op["cell"]].comment = Comment(op["text"], op.get("author", "agent"))
    elif kind == "hyperlink":
        sheet_of(wb, op)[op["cell"]].hyperlink = op["target"]
    elif kind == "define_name":
        dn = DefinedName(op["name"], attr_text=op["value"])
        if op.get("scope"):
            wb[op["scope"]].defined_names[op["name"]] = dn
        else:
            wb.defined_names[op["name"]] = dn
    elif kind == "sheet_state":
        wb[op["name"]].sheet_state = op["state"]
    else:
        raise ValueError(f"unknown op {kind!r}")


def main() -> None:
    if len(sys.argv) != 4 or sys.argv[1] in ("-h", "--help"):
        print(__doc__, file=sys.stderr)
        sys.exit(64)
    src, dst, ops_arg = sys.argv[1:4]
    import openpyxl

    applied = 0
    with WarningCollector() as wc:
        try:
            ops = load_ops(ops_arg)
            keep_vba = src.lower().endswith((".xlsm", ".xltm"))
            wb = openpyxl.load_workbook(src, keep_vba=keep_vba, keep_links=True, rich_text=True)
            if src.lower().endswith((".xltx", ".xltm")) and dst.lower().endswith((".xltx", ".xltm")):
                wb.template = True
            for op in ops:
                apply(wb, op)
                applied += 1
            wb.save(dst)
        except Exception as exc:
            emit({"ok": False, "applied": applied, "error": {"type": type(exc).__name__, "message": str(exc)[:500]},
                  "warnings": wc.messages()}, 2)
    emit({"ok": True, "applied": applied, "output": dst, "sheets": wb.sheetnames, "warnings": wc.messages()})


if __name__ == "__main__":
    main()
