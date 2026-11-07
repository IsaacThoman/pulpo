#!/usr/bin/env python3
"""Canonical JSON dump of what openpyxl reads from an xlsx/xlsm/xltx file.

    ~/.cache/pulpo-sheets-venv/bin/python -I inspect_xlsx.py FILE [--values] [--no-styles]
        [--no-package] [--sheet NAME]... [--max-cells N]

Default mode dumps formulas (formula cells carry ``f``); ``--values`` loads with
``data_only=True`` so formula cells carry their cached value (``null`` if the
writer stored none). Dumps are designed to be diffed (see compare_xlsx.py):
keys are sorted, colours are normalised ('#RRGGBB', 'theme:N/tint:T',
'indexed:N', 'auto'), integral floats become ints, dates are emitted as their
serial number, default/empty properties are omitted, column ranges are
coalesced, and merged-cell placeholders are skipped.

Exit codes: 0 ok, 2 openpyxl could not load the file (JSON ``{"error": ...}``).
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import sys
import zipfile

sys.dont_write_bytecode = True  # keep the scripts dir free of __pycache__
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _sheets_common import (  # noqa: E402
    DateSerial,
    WarningCollector,
    content_types,
    emit,
    error_payload,
    is_strict_ooxml,
    keep_raw_date_serials,
    sniff_container,
    excel_serial,
    ext_uris,
    iter_ranges,
    norm_color,
    norm_number,
    norm_tree,
    prune,
    raw_calc_pr,
    raw_x14,
    sheet_parts,
    workbook_part,
)

TOOL_VERSION = 1


def font_dict(font) -> dict | None:
    if font is None:
        return None
    u = font.u
    return prune({
        "name": font.name,
        "size": norm_number(float(font.sz)) if font.sz is not None else None,
        "bold": bool(font.b),
        "italic": bool(font.i),
        "underline": u if u else None,
        "strike": bool(font.strike),
        "color": norm_color(font.color),
        "vertAlign": font.vertAlign,
        "scheme": font.scheme,
    })


def fill_dict(fill) -> dict | None:
    if fill is None:
        return None
    if getattr(fill, "tagname", "") == "gradientFill":
        return prune({
            "gradient": fill.type or "linear",
            "degree": norm_number(float(fill.degree)) if fill.degree else None,
            "box": [fill.left, fill.right, fill.top, fill.bottom] if fill.type == "path" else None,
            "stops": [[norm_number(float(s.position)), norm_color(s.color)] for s in (fill.stop or [])],
        }) or None
    pattern = fill.patternType
    if not pattern:
        return None
    return prune({
        "pattern": pattern,
        "fg": norm_color(fill.fgColor),
        "bg": norm_color(fill.bgColor),
    })


def border_dict(border) -> dict | None:
    if border is None:
        return None
    out = {}
    for side_name in ("left", "right", "top", "bottom", "diagonal", "vertical", "horizontal"):
        side = getattr(border, side_name, None)
        if side is not None and side.style:
            out[side_name] = prune({"style": side.style, "color": norm_color(side.color)})
    if out.get("diagonal"):
        out["diagonalUp"] = bool(border.diagonalUp)
        out["diagonalDown"] = bool(border.diagonalDown)
    return prune(out) or None


def alignment_dict(al) -> dict | None:
    if al is None:
        return None
    return prune({
        "horizontal": al.horizontal if al.horizontal not in (None, "general") else None,
        "vertical": al.vertical if al.vertical not in (None, "bottom") else None,
        "wrap": bool(al.wrapText),
        "rotation": int(al.textRotation) if al.textRotation else None,
        "indent": norm_number(float(al.indent)) if al.indent else None,
        "shrink": bool(al.shrinkToFit),
        "readingOrder": int(al.readingOrder) if al.readingOrder else None,
        "justifyLastLine": bool(al.justifyLastLine),
    }) or None


def protection_str(prot) -> str | None:
    if prot is None:
        return None
    flags = []
    if prot.locked is False:
        flags.append("unlocked")
    if prot.hidden:
        flags.append("hidden")
    return ",".join(flags) or None


def dxf_dict(dxf) -> dict | None:
    if dxf is None:
        return None
    return prune({
        "font": font_dict(dxf.font) if dxf.font is not None else None,
        "fill": dxf_fill(dxf.fill),
        "border": border_dict(dxf.border),
        "numFmt": dxf.numFmt.formatCode if dxf.numFmt is not None else None,
    }) or None


def dxf_fill(fill) -> dict | None:
    # Differential fills often omit patternType (meaning solid) and use bgColor.
    if fill is None:
        return None
    if getattr(fill, "tagname", "") == "gradientFill":
        return fill_dict(fill)
    return prune({
        "pattern": fill.patternType,
        "fg": norm_color(fill.fgColor),
        "bg": norm_color(fill.bgColor),
    }) or None


def rich_runs(value) -> list:
    runs = []
    for item in value:
        if isinstance(item, str):
            runs.append({"text": item})
        else:
            f = item.font
            runs.append(prune({
                "text": item.text,
                "font": prune({
                    "name": f.rFont,
                    "size": norm_number(float(f.sz)) if f.sz is not None else None,
                    "bold": bool(f.b),
                    "italic": bool(f.i),
                    "underline": f.u if f.u else None,
                    "strike": bool(f.strike),
                    "color": norm_color(f.color),
                    "vertAlign": f.vertAlign,
                }) if f is not None else None,
            }))
    return runs


def cell_value(cell, epoch) -> dict:
    from openpyxl.cell.rich_text import CellRichText
    from openpyxl.worksheet.formula import ArrayFormula, DataTableFormula

    v = cell.value
    t = cell.data_type
    out: dict = {"t": t}
    if isinstance(v, ArrayFormula):
        out["f"] = v.text
        out["array"] = v.ref
    elif isinstance(v, DataTableFormula):
        out["f"] = "{=TABLE()}"
        out["dataTable"] = prune({k: getattr(v, k, None) for k in ("ref", "ca", "dt2D", "dtr", "r1", "r2", "del1", "del2")})
    elif isinstance(v, CellRichText):
        out["v"] = str(v)
        out["rich"] = rich_runs(v)
    elif t == "f":
        out["f"] = v
    elif isinstance(v, DateSerial):
        out["v"] = norm_number(float(v))
        out["t"] = "d"
    elif isinstance(v, (dt.datetime, dt.date, dt.time, dt.timedelta)):
        out["v"] = excel_serial(v, epoch)
        out["t"] = "d"
    elif isinstance(v, (int, float)) and not isinstance(v, bool):
        out["v"] = norm_number(v)
    else:
        out["v"] = v
    return out


def anchor_dict(anchor) -> dict | str | None:
    if anchor is None:
        return None
    if isinstance(anchor, str):
        return anchor
    from openpyxl.utils import get_column_letter

    def marker(m):
        return prune({
            "cell": f"{get_column_letter(m.col + 1)}{m.row + 1}",
            "colOff": m.colOff or None,
            "rowOff": m.rowOff or None,
        })

    kind = type(anchor).__name__
    if kind == "TwoCellAnchor":
        return prune({"kind": "twoCell", "from": marker(anchor._from), "to": marker(anchor.to), "editAs": anchor.editAs})
    if kind == "OneCellAnchor":
        return prune({"kind": "oneCell", "from": marker(anchor._from), "ext": [anchor.ext.width, anchor.ext.height] if anchor.ext else None})
    if kind == "AbsoluteAnchor":
        return prune({"kind": "absolute", "pos": [anchor.pos.x, anchor.pos.y] if anchor.pos else None, "ext": [anchor.ext.width, anchor.ext.height] if anchor.ext else None})
    return {"kind": kind}


def chart_dict(chart) -> dict:
    types = [c.tagname for c in (getattr(chart, "_charts", None) or [chart])]
    title = None
    try:
        if chart.title is not None and chart.title.tx is not None and chart.title.tx.rich is not None:
            title = "".join(
                (r.t or "") for p in chart.title.tx.rich.p for r in (p.r or [])
            )
        elif chart.title is not None and chart.title.tx is not None and chart.title.tx.strRef is not None:
            title = "=" + chart.title.tx.strRef.f
    except Exception:
        title = None
    series = 0
    for c in getattr(chart, "_charts", None) or [chart]:
        series += len(getattr(c, "ser", None) or getattr(c, "series", None) or [])
    return prune({"types": types, "title": title, "series": series, "anchor": anchor_dict(chart.anchor)})


def col_runs(ws) -> dict:
    from openpyxl.utils import column_index_from_string, get_column_letter

    entries = []
    for key, dim in ws.column_dimensions.items():
        lo = dim.min or column_index_from_string(key)
        hi = dim.max or lo
        attrs = prune({
            "width": round(float(dim.width), 6) if dim.width else None,
            "hidden": bool(dim.hidden),
            "outlineLevel": dim.outlineLevel or None,
            "collapsed": bool(dim.collapsed),
            "bestFit": bool(dim.bestFit),
        })
        if attrs:
            entries.append((lo, hi, attrs))
    entries.sort(key=lambda e: (e[0], e[1]))
    merged: list = []
    for lo, hi, attrs in entries:
        if merged and merged[-1][1] + 1 == lo and merged[-1][2] == attrs:
            merged[-1] = (merged[-1][0], hi, attrs)
        else:
            merged.append((lo, hi, attrs))
    out = {}
    for lo, hi, attrs in merged:
        key = get_column_letter(lo) if lo == hi else f"{get_column_letter(lo)}:{get_column_letter(hi)}"
        out[key] = attrs
    return out


def row_dims(ws) -> dict:
    out = {}
    for idx, dim in ws.row_dimensions.items():
        attrs = prune({
            "height": round(float(dim.ht), 6) if dim.ht is not None and dim.customHeight else None,
            "hidden": bool(dim.hidden),
            "outlineLevel": dim.outlineLevel or None,
            "collapsed": bool(dim.collapsed),
        })
        if attrs:
            out[str(idx)] = attrs
    return out


def cf_rules(ws) -> list:
    out = []
    for cf in ws.conditional_formatting:
        ranges = " ".join(iter_ranges(cf.sqref))
        for rule in cf.rules:
            entry = {
                "ranges": ranges,
                "type": rule.type,
                "operator": rule.operator,
                "formula": list(rule.formula or []) or None,
                "priority": rule.priority,
                "stopIfTrue": bool(rule.stopIfTrue),
                "text": rule.text,
                "timePeriod": rule.timePeriod,
                "rank": rule.rank,
                "percent": bool(rule.percent),
                "bottom": bool(rule.bottom),
                "aboveAverage": None if rule.aboveAverage is None else bool(rule.aboveAverage),
                "equalAverage": bool(rule.equalAverage),
                "stdDev": rule.stdDev,
                "dxf": dxf_dict(rule.dxf),
            }
            if entry["type"] == "aboveAverage" and entry["aboveAverage"] is None:
                entry["aboveAverage"] = True
            if entry["aboveAverage"] is False:
                entry["aboveAverage"] = "below"
            if rule.colorScale is not None:
                cs = rule.colorScale
                entry["colorScale"] = {
                    "cfvo": [prune({"type": c.type, "val": c.val}) for c in cs.cfvo],
                    "colors": [norm_color(c) for c in cs.color],
                }
            if rule.dataBar is not None:
                db = rule.dataBar
                entry["dataBar"] = prune({
                    "cfvo": [prune({"type": c.type, "val": c.val}) for c in db.cfvo],
                    "color": norm_color(db.color),
                    "showValue": None if db.showValue is None else bool(db.showValue),
                    "minLength": db.minLength,
                    "maxLength": db.maxLength,
                })
            if rule.iconSet is not None:
                ic = rule.iconSet
                entry["iconSet"] = prune({
                    "iconSet": ic.iconSet or "3TrafficLights1",
                    "cfvo": [prune({"type": c.type, "val": c.val, "gte": None if c.gte is None else bool(c.gte)}) for c in ic.cfvo],
                    "showValue": None if ic.showValue is None else bool(ic.showValue),
                    "reverse": bool(ic.reverse),
                    "percent": None if ic.percent is None else bool(ic.percent),
                })
            out.append(prune(entry))
    out.sort(key=lambda r: (r.get("priority") or 0, r["ranges"], r["type"]))
    return out


def data_validations(ws) -> list:
    out = []
    for dv in ws.data_validations.dataValidation:
        out.append(prune({
            "ranges": " ".join(iter_ranges(dv.sqref)),
            "type": dv.type or "any",
            "operator": dv.operator if dv.type not in (None, "list", "custom", "any") else None,
            "formula1": dv.formula1,
            "formula2": dv.formula2,
            "allowBlank": bool(dv.allow_blank),
            "showDropDown": bool(dv.showDropDown),  # NB: true means the arrow is HIDDEN
            "showErrorMessage": bool(dv.showErrorMessage),
            "showInputMessage": bool(dv.showInputMessage),
            "errorStyle": dv.errorStyle if dv.errorStyle not in (None, "stop") else None,
            "errorTitle": dv.errorTitle,
            "error": dv.error,
            "promptTitle": dv.promptTitle,
            "prompt": dv.prompt,
        }))
    out.sort(key=lambda d: (d["ranges"], d["type"]))
    return out


def tables(ws) -> dict:
    out = {}
    for table in ws.tables.values():
        name = table.name
        cols = []
        for col in table.tableColumns:
            ccf = col.calculatedColumnFormula
            cols.append(prune({
                "name": col.name,
                "totalsRowFunction": col.totalsRowFunction,
                "totalsRowLabel": col.totalsRowLabel,
                "totalsRowFormula": getattr(col.totalsRowFormula, "attr_text", None),
                "calculatedColumnFormula": getattr(ccf, "attr_text", None),
            }))
        style = table.tableStyleInfo
        out[name] = prune({
            "displayName": table.displayName if table.displayName != name else None,
            "ref": table.ref,
            "headerRowCount": table.headerRowCount if table.headerRowCount != 1 else None,
            "totalsRowCount": table.totalsRowCount,
            "totalsRowShown": None if table.totalsRowShown is None else bool(table.totalsRowShown),
            "autoFilter": table.autoFilter.ref if table.autoFilter is not None else None,
            "style": prune({
                "name": style.name,
                "rowStripes": bool(style.showRowStripes),
                "columnStripes": bool(style.showColumnStripes),
                "firstColumn": bool(style.showFirstColumn),
                "lastColumn": bool(style.showLastColumn),
            }) if style is not None else None,
            "columns": cols,
        })
    return out


def autofilter(ws) -> dict | None:
    af = ws.auto_filter
    if af is None or not af.ref:
        return None
    cols = []
    for fc in af.filterColumn or []:
        entry = {"colId": fc.colId}
        if fc.filters is not None:
            entry["values"] = sorted(str(f) for f in (fc.filters.filter or []))
            entry["blank"] = bool(fc.filters.blank)
        if fc.customFilters is not None:
            entry["custom"] = [prune({"operator": c.operator, "val": c.val}) for c in fc.customFilters.customFilter]
            entry["and"] = bool(fc.customFilters._and)
        if fc.top10 is not None:
            entry["top10"] = prune({"top": fc.top10.top, "percent": fc.top10.percent, "val": fc.top10.val})
        if fc.dynamicFilter is not None:
            entry["dynamic"] = fc.dynamicFilter.type
        if fc.colorFilter is not None:
            entry["color"] = True
        cols.append(prune(entry))
    sort = None
    if af.sortState is not None:
        sort = prune({
            "ref": af.sortState.ref,
            "conditions": [prune({"ref": c.ref, "descending": bool(c.descending)}) for c in af.sortState.sortCondition],
        })
    return prune({"ref": af.ref, "columns": cols, "sort": sort})


def hyperlinks(ws) -> list:
    seen = {}
    for cell in ws._cells.values():
        link = getattr(cell, "hyperlink", None)
        if link is None:
            continue
        ref = link.ref or cell.coordinate
        key = (ref, link.target, link.location)
        seen[key] = prune({
            "ref": ref,
            "target": link.target,
            "location": link.location,
            "display": link.display,
            "tooltip": link.tooltip,
        })
    return [seen[k] for k in sorted(seen, key=lambda k: tuple(str(x) for x in k))]


def comments(ws) -> dict:
    out = {}
    for (row, col), cell in sorted(ws._cells.items()):
        c = getattr(cell, "comment", None)
        if c is not None:
            out[cell.coordinate] = prune({"author": c.author, "text": c.text})
    return out


def print_settings(ws) -> dict:
    ps = ws.page_setup
    po = ws.print_options
    pm = ws.page_margins
    hf = ws.HeaderFooter

    def hf_text(part):
        if part is None:
            return None
        return prune({k: getattr(getattr(part, k), "text", None) or None for k in ("left", "center", "right")}) or None

    fit = ws.sheet_properties.pageSetUpPr.fitToPage if ws.sheet_properties.pageSetUpPr is not None else None
    return prune({
        "orientation": ps.orientation,
        "paperSize": ps.paperSize,
        "scale": ps.scale if ps.scale not in (None, 100) else None,
        "fitToPage": bool(fit),
        "fitToWidth": ps.fitToWidth if fit else None,
        "fitToHeight": ps.fitToHeight if fit else None,
        "gridLines": bool(po.gridLines),
        "headings": bool(po.headings),
        "horizontalCentered": bool(po.horizontalCentered),
        "verticalCentered": bool(po.verticalCentered),
        "margins": [round(float(x), 4) for x in (pm.left, pm.right, pm.top, pm.bottom, pm.header, pm.footer)] if pm is not None else None,
        "printArea": ws.print_area or None,
        "printTitleRows": ws.print_title_rows,
        "printTitleCols": ws.print_title_cols,
        "header": hf_text(hf.oddHeader) if hf is not None else None,
        "footer": hf_text(hf.oddFooter) if hf is not None else None,
    })


def sheet_protection(ws) -> dict | None:
    p = ws.protection
    if p is None or not p.sheet:
        return None
    allowed = [
        k for k in ("selectLockedCells", "selectUnlockedCells", "formatCells", "formatColumns", "formatRows",
                    "insertColumns", "insertRows", "insertHyperlinks", "deleteColumns", "deleteRows", "sort",
                    "autoFilter", "pivotTables", "objects", "scenarios")
        if getattr(p, k, None) is False
    ]
    return prune({
        "sheet": True,
        "password": bool(p.password or getattr(p, "hashValue", None)),
        "allowed": sorted(allowed),  # openpyxl semantics: False = action is permitted
    })


def view_dict(ws) -> dict:
    view = ws.sheet_view
    return prune({
        "freeze": ws.freeze_panes,
        "split": bool(view.pane is not None and view.pane.state == "split"),
        "zoom": view.zoomScale if view.zoomScale not in (None, 100) else None,
        "showGridLines": None if view.showGridLines in (None, True) else False,
        "rightToLeft": bool(view.rightToLeft),
        "showFormulas": bool(view.showFormulas),
        "showZeros": None if view.showZeros in (None, True) else False,
    })


def tab_color(sheet) -> str | None:
    props = getattr(sheet, "sheet_properties", None) or getattr(sheet, "sheetPr", None)
    return norm_color(getattr(props, "tabColor", None)) if props is not None else None


def named_style(cell) -> str | None:
    try:
        name = cell.style
    except IndexError:  # xfId pointing past cellStyleXfs (seen in the wild)
        return "<invalid xfId>"
    return name if name not in (None, "Normal") else None


def dump_cells(ws, epoch, styles: bool, max_cells: int | None) -> tuple[dict, bool]:
    from openpyxl.cell.cell import MergedCell

    out = {}
    truncated = False
    for key in sorted(ws._cells):
        cell = ws._cells[key]
        if isinstance(cell, MergedCell):
            continue
        has_value = cell.value is not None
        has_style = cell.has_style and cell.style_id != 0
        if not has_value and not has_style:
            continue
        if max_cells is not None and len(out) >= max_cells:
            truncated = True
            break
        entry = cell_value(cell, epoch) if has_value else {"t": "empty"}
        if styles and has_style:
            nf = cell.number_format
            entry.update(prune({
                "numFmt": nf if nf != "General" else None,
                "font": font_dict(cell.font),
                "fill": fill_dict(cell.fill),
                "border": border_dict(cell.border),
                "alignment": alignment_dict(cell.alignment),
                "protection": protection_str(cell.protection),
                "style": named_style(cell),
            }))
        out[cell.coordinate] = prune(entry)
    return out, truncated


def drawing_counts(ws) -> dict:
    images = [prune({"format": getattr(img, "format", None), "anchor": anchor_dict(img.anchor)}) for img in ws._images]
    charts = [chart_dict(ch) for ch in ws._charts]
    return prune({"images": images, "charts": charts})


def defined_names(wb) -> list:
    out = []
    for name, dn in wb.defined_names.items():
        out.append(prune({"name": name, "value": dn.attr_text, "hidden": bool(dn.hidden), "scope": None}))
    for ws in wb.worksheets:
        for name, dn in getattr(ws, "defined_names", {}).items():
            out.append(prune({"name": name, "value": dn.attr_text, "hidden": bool(dn.hidden), "scope": ws.title}))
    out.sort(key=lambda d: (d.get("scope") or "", d["name"].lower()))
    return out


def package_info(path: str) -> dict:
    try:
        with zipfile.ZipFile(path) as zf:
            cts = content_types(zf)
            parts = sheet_parts(zf)
            ext = {}
            x14 = {}
            for sheet, part in parts.items():
                if part in zf.namelist():
                    uris = ext_uris(zf, part)
                    if uris:
                        ext[sheet] = uris
                        summary = raw_x14(zf, part)
                        if summary:
                            x14[sheet] = summary
            wb_part = workbook_part(zf)
            wb_ext = ext_uris(zf, wb_part) if wb_part and wb_part in zf.namelist() else []
            names = set(cts)
            features = prune({
                "vbaProject": any(n.endswith("vbaProject.bin") for n in names),
                "threadedComments": any("/threadedComments/" in n for n in names),
                "persons": any("/persons/" in n for n in names),
                "pivotTables": sum(1 for n in names if "/pivotTables/pivotTable" in n and n.endswith(".xml")) or None,
                "pivotCaches": sum(1 for n in names if "/pivotCache/pivotCacheDefinition" in n and n.endswith(".xml")) or None,
                "externalLinks": sum(1 for n in names if "/externalLinks/externalLink" in n and n.endswith(".xml")) or None,
                "slicers": sum(1 for n in names if "/slicers/" in n) or None,
                "customXml": any(n.startswith("customXml/") for n in names),
                "metadata": "xl/metadata.xml" in names,
                "calcChain": "xl/calcChain.xml" in names,
                "embeddings": sum(1 for n in names if "/embeddings/" in n) or None,
                "sheetExtLst": ext or None,
                "workbookExtLst": wb_ext or None,
            })
            return {"parts": {n: cts[n] for n in sorted(cts)}, "features": features, "x14": x14}
    except Exception as exc:  # malformed zips still get an openpyxl attempt
        return {"error": f"{type(exc).__name__}: {exc}"[:300]}


def inspect(path: str, values: bool = False, styles: bool = True, include_package: bool = True,
            only_sheets: list[str] | None = None, max_cells: int | None = None) -> dict:
    import openpyxl

    keep_raw_date_serials()
    if sniff_container(path) == "zip" and is_strict_ooxml(path):
        # openpyxl "loads" strict files as a workbook with zero sheets; say so instead.
        return {
            "error": {"type": "StrictOoxml", "container": "zip",
                      "message": "Strict OOXML (purl.oclc.org namespaces) is not supported by openpyxl; it would load as an empty workbook",
                      "hint": "Strict OOXML (ISO/IEC 29500 strict namespaces), not transitional"},
            "file": os.path.basename(path),
        }

    with WarningCollector() as wc:
        try:
            wb = openpyxl.load_workbook(path, data_only=values, rich_text=True, keep_links=True)
        except Exception as exc:
            payload = error_payload(path, exc)
            payload["file"] = os.path.basename(path)
            payload["warnings"] = wc.messages()
            return payload

        epoch = wb.epoch
        sheets_meta = []
        for sheet in wb._sheets:
            sheets_meta.append(prune({
                "name": sheet.title,
                "kind": "chartsheet" if type(sheet).__name__ == "Chartsheet" else "worksheet",
                "state": sheet.sheet_state if sheet.sheet_state != "visible" else None,
                "tabColor": tab_color(sheet),
            }))

        sec = wb.security
        workbook = prune({
            "sheets": sheets_meta,
            "active": wb.active.title if wb.active is not None else None,
            "date1904": epoch.year == 1904,
            "definedNames": defined_names(wb),
            "calc": raw_calc_pr(path),  # raw attributes; openpyxl invents defaults
            "protection": prune({
                "structure": bool(sec.lockStructure),
                "windows": bool(sec.lockWindows),
                "revision": bool(sec.lockRevision),
                "password": bool(sec.workbookPassword or getattr(sec, "workbookHashValue", None)),
            }) if sec is not None else None,
            "externalLinks": len(getattr(wb, "_external_links", []) or []) or None,
            "namedStyles": sorted(s for s in wb.named_styles if s != "Normal") or None,
        })

        sheets = {}
        truncated_any = False
        for sheet in wb._sheets:
            if only_sheets and sheet.title not in only_sheets:
                continue
            if type(sheet).__name__ == "Chartsheet":
                sheets[sheet.title] = prune({"charts": [chart_dict(ch) for ch in sheet._charts]})
                continue
            ws = sheet
            cells, truncated = dump_cells(ws, epoch, styles, max_cells)
            truncated_any = truncated_any or truncated
            outline = ws.sheet_properties.outlinePr
            fmt = ws.sheet_format
            errors: list = []

            def guard(label, fn, *a):
                try:
                    return fn(*a)
                except Exception as exc:  # keep dumping the rest of a malformed sheet
                    errors.append(f"{label}: {type(exc).__name__}: {exc}"[:300])
                    return None

            sheets[ws.title] = prune({
                "dimensions": ws.dimensions,
                "cells": cells,
                "truncated": truncated,
                "merged": sorted(str(r) for r in ws.merged_cells.ranges),
                "view": guard("view_dict", view_dict, ws),
                "columns": guard("col_runs", col_runs, ws),
                "rows": guard("row_dims", row_dims, ws),
                "format": prune({
                    "defaultRowHeight": round(float(fmt.defaultRowHeight), 4) if fmt.defaultRowHeight not in (None, 15) else None,
                    "defaultColWidth": round(float(fmt.defaultColWidth), 4) if fmt.defaultColWidth else None,
                    "baseColWidth": fmt.baseColWidth if fmt.baseColWidth not in (None, 8) else None,
                }),
                "outlineSummary": prune({
                    "below": None if outline is None or outline.summaryBelow in (None, True) else False,
                    "right": None if outline is None or outline.summaryRight in (None, True) else False,
                }),
                "conditionalFormatting": guard("cf_rules", cf_rules, ws),
                "dataValidations": guard("data_validations", data_validations, ws),
                "hyperlinks": guard("hyperlinks", hyperlinks, ws),
                "comments": guard("comments", comments, ws),
                "tables": guard("tables", tables, ws),
                "autoFilter": guard("autofilter", autofilter, ws),
                "drawings": guard("drawing_counts", drawing_counts, ws),
                "print": guard("print_settings", print_settings, ws),
                "protection": guard("sheet_protection", sheet_protection, ws),
                "inspectErrors": errors,
            })

        result = {
            "tool": "inspect_xlsx",
            "version": TOOL_VERSION,
            "file": os.path.basename(path),
            "mode": "values" if values else "formulas",
            "workbook": workbook,
            "sheets": sheets,
        }
        pkg = package_info(path)
        for sheet_name, summary in (pkg.pop("x14", None) or {}).items():
            if sheet_name in sheets:
                sheets[sheet_name]["x14"] = summary
        if include_package:
            result["package"] = pkg
        if truncated_any:
            result["truncated"] = True
    result["warnings"] = wc.messages()
    return norm_tree(result)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file")
    ap.add_argument("--values", action="store_true", help="load with data_only=True (cached values)")
    ap.add_argument("--no-styles", action="store_true", help="omit per-cell style information")
    ap.add_argument("--no-package", action="store_true", help="omit the raw package part listing")
    ap.add_argument("--sheet", action="append", help="only dump these sheets (repeatable)")
    ap.add_argument("--max-cells", type=int, default=None, help="cap cells per sheet")
    args = ap.parse_args()
    if not os.path.isfile(args.file):
        emit({"error": {"type": "FileNotFoundError", "message": args.file}}, 2)
    result = inspect(args.file, values=args.values, styles=not args.no_styles,
                     include_package=not args.no_package, only_sheets=args.sheet, max_cells=args.max_cells)
    emit(result, 2 if "error" in result else 0)


if __name__ == "__main__":
    main()
