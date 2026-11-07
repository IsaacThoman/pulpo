"""Shared helpers for the sheets fidelity tools.

The tools run with ``python -I`` (isolated mode), which does not put the
script directory on ``sys.path``. Each tool therefore inserts its own directory
explicitly before importing this module; the corpus files are never on the path.
"""

from __future__ import annotations

import datetime as _dt
import json
import math
import posixpath
import sys
import warnings
import zipfile
from typing import Any, Iterable
from xml.etree import ElementTree as ET

# Hard ceiling on how much of a single zip part we will decompress for raw XML
# inspection. The corpus is untrusted, so a zip bomb must not exhaust memory.
MAX_PART_BYTES = 256 * 1024 * 1024

NS_REL_PKG = "http://schemas.openxmlformats.org/package/2006/relationships"
NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types"
NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_STRICT_MAIN = "http://purl.oclc.org/ooxml/spreadsheetml/main"
NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_STRICT_R = "http://purl.oclc.org/ooxml/officeDocument/relationships"

CFB_MAGIC = bytes.fromhex("d0cf11e0a1b11ae1")


class XmlRefused(ValueError):
    """Raised for XML we refuse to parse (DTDs / entity declarations)."""


def emit(obj: Any, exit_code: int = 0) -> None:
    """Print canonical JSON (sorted keys) and exit."""
    sys.stdout.write(json.dumps(obj, sort_keys=True, indent=1, ensure_ascii=False, allow_nan=False, default=str))
    sys.stdout.write("\n")
    sys.stdout.flush()
    sys.exit(exit_code)


def sniff_container(path: str) -> str:
    """Return 'zip', 'cfb' (OLE2: encrypted OOXML or legacy .xls), 'empty' or 'unknown'."""
    with open(path, "rb") as fh:
        head = fh.read(8)
    if not head:
        return "empty"
    if head == CFB_MAGIC:
        return "cfb"
    if head[:2] == b"PK":
        return "zip"
    return "unknown"


def error_payload(path: str, exc: BaseException) -> dict:
    container = "missing"
    try:
        container = sniff_container(path)
    except OSError:
        pass
    kind = type(exc).__name__
    hint = None
    if container == "cfb":
        hint = "OLE2/CFB container: an encrypted (password-protected) OOXML file or a legacy .xls"
    elif container == "zip" and is_strict_ooxml(path):
        hint = "Strict OOXML (ISO/IEC 29500 strict namespaces), not transitional"
    return {"error": {"type": kind, "message": str(exc)[:500], "container": container, "hint": hint}}


def is_strict_ooxml(path: str) -> bool:
    try:
        with zipfile.ZipFile(path) as zf:
            for name in ("xl/workbook.xml",):
                if name in zf.namelist():
                    data = read_part(zf, name, limit=4 * 1024 * 1024)
                    return NS_STRICT_MAIN.encode() in data
            rels = read_part(zf, "_rels/.rels", limit=1024 * 1024) if "_rels/.rels" in zf.namelist() else b""
            return b"purl.oclc.org/ooxml" in rels
    except Exception:
        return False


def read_part(zf: zipfile.ZipFile, name: str, limit: int = MAX_PART_BYTES) -> bytes:
    info = zf.getinfo(name)
    if info.file_size > limit:
        raise ValueError(f"part {name} too large ({info.file_size} bytes)")
    with zf.open(info) as fh:
        data = fh.read(limit + 1)
    if len(data) > limit:
        raise ValueError(f"part {name} too large")
    return data


def parse_xml(data: bytes) -> ET.Element:
    """Parse untrusted XML. DTDs are refused outright (no entity expansion at all)."""
    head = data[:4096].lstrip()
    if b"<!DOCTYPE" in data[:65536] or b"<!ENTITY" in data[:65536] or b"<!doctype" in head.lower():
        raise XmlRefused("XML contains a DTD/entity declaration; refusing to parse")
    return ET.fromstring(data)


def resolve_rel_target(source_part: str, target: str) -> str:
    if target.startswith("/"):
        return target.lstrip("/")
    base = posixpath.dirname(source_part)
    return posixpath.normpath(posixpath.join(base, target))


def rels_path_for(part: str) -> str:
    d, f = posixpath.split(part)
    return posixpath.join(d, "_rels", f + ".rels")


def read_rels(zf: zipfile.ZipFile, part: str) -> list[dict]:
    rp = rels_path_for(part)
    if rp not in zf.namelist():
        return []
    root = parse_xml(read_part(zf, rp))
    out = []
    for rel in root:
        if rel.tag.rsplit("}", 1)[-1] != "Relationship":
            continue
        tgt = rel.get("Target", "")
        mode = rel.get("TargetMode")
        out.append({
            "id": rel.get("Id"),
            "type": rel.get("Type", "").rsplit("/", 1)[-1],
            "target": tgt if mode == "External" else resolve_rel_target(part, tgt),
            "external": mode == "External",
        })
    return out


def content_types(zf: zipfile.ZipFile) -> dict[str, str]:
    """Map every part name to its content type."""
    if "[Content_Types].xml" not in zf.namelist():
        return {}
    root = parse_xml(read_part(zf, "[Content_Types].xml"))
    defaults: dict[str, str] = {}
    overrides: dict[str, str] = {}
    for el in root:
        tag = el.tag.rsplit("}", 1)[-1]
        if tag == "Default":
            defaults[(el.get("Extension") or "").lower()] = el.get("ContentType", "")
        elif tag == "Override":
            overrides[(el.get("PartName") or "").lstrip("/")] = el.get("ContentType", "")
    out = {}
    for name in zf.namelist():
        if name.endswith("/"):
            continue
        ct = overrides.get(name)
        if ct is None:
            ct = defaults.get(name.rsplit(".", 1)[-1].lower() if "." in name else "", "")
        out[name] = ct
    return out


def workbook_part(zf: zipfile.ZipFile) -> str | None:
    for rel in read_rels(zf, ""):
        if rel["type"] == "officeDocument":
            return rel["target"]
    return None


def sheet_parts(zf: zipfile.ZipFile) -> dict[str, str]:
    """Map sheet name -> part path using workbook.xml and its rels (raw, no openpyxl)."""
    wb_part = workbook_part(zf)
    if not wb_part or wb_part not in zf.namelist():
        return {}
    rels = {r["id"]: r["target"] for r in read_rels(zf, wb_part)}
    root = parse_xml(read_part(zf, wb_part))
    out = {}
    for el in root.iter():
        if el.tag.rsplit("}", 1)[-1] == "sheet":
            rid = el.get(f"{{{NS_R}}}id") or el.get(f"{{{NS_STRICT_R}}}id")
            if rid in rels:
                out[el.get("name", "")] = rels[rid]
    return out


def raw_calc_pr(path: str) -> dict | None:
    """Attributes of <calcPr> exactly as stored (openpyxl fills in defaults such as fullCalcOnLoad=1)."""
    try:
        with zipfile.ZipFile(path) as zf:
            part = workbook_part(zf)
            if not part or part not in zf.namelist():
                return None
            root = parse_xml(read_part(zf, part))
    except Exception:
        return None
    for el in root:
        if el.tag.rsplit("}", 1)[-1] == "calcPr":
            return {k.rsplit("}", 1)[-1]: v for k, v in sorted(el.attrib.items())}
    return None


def ext_uris(zf: zipfile.ZipFile, part: str) -> list[str]:
    """URIs of <extLst><ext uri=...> children directly under the part's root element."""
    try:
        root = parse_xml(read_part(zf, part))
    except Exception:
        return []
    uris = []
    for child in root:
        if child.tag.rsplit("}", 1)[-1] == "extLst":
            for ext in child:
                uris.append(ext.get("uri", ""))
    return sorted(uris)


# ---------------------------------------------------------------------------
# value / style normalisation


def norm_number(v: float | int) -> float | int:
    """Integral floats become ints (1.0 and 1 are the same cell value in a sheet)."""
    if isinstance(v, bool):
        return v
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return repr(v)  # type: ignore[return-value]
        if v.is_integer() and abs(v) < 2**53:
            return int(v)
    return v


def excel_serial(value: Any, epoch: _dt.datetime) -> float | int | None:
    """Convert openpyxl's converted date/time objects back to the stored serial number."""
    from openpyxl.utils.datetime import to_excel

    try:
        if isinstance(value, _dt.timedelta):
            return norm_number(round(value.total_seconds() / 86400.0, 12))
        return norm_number(round(to_excel(value, epoch), 12))
    except Exception:
        return None


class DateSerial(float):
    """A raw date/time serial from a date-formatted numeric cell (see keep_raw_date_serials)."""


def keep_raw_date_serials() -> None:
    """Make openpyxl keep the stored serial number for date-formatted numeric cells.

    openpyxl normally converts them to datetime objects (microsecond resolution,
    so 2/3 comes back as 0.666666666667) and turns out-of-range serials into
    '#VALUE!' errors. For fidelity dumps we want the exact stored number; the
    cell still reports data_type 'd'.
    """
    import openpyxl.worksheet._reader as reader

    def raw(value, epoch=None, timedelta=False):  # noqa: ARG001 - signature mirrors from_excel
        return DateSerial(value)

    reader.from_excel = raw


def norm_color(color: Any) -> str | None:
    """Canonical colour string: '#RRGGBB', 'theme:N', 'theme:N/tint:T', 'indexed:N', 'auto'.

    The alpha byte is dropped: Excel ignores it for cell formatting and writers
    disagree on '00' vs 'FF'.
    """
    if color is None:
        return None
    ctype = getattr(color, "type", None)
    tint = getattr(color, "tint", 0) or 0
    if ctype == "rgb":
        rgb = getattr(color, "rgb", None)
        if not isinstance(rgb, str):
            return None
        rgb = rgb.upper()
        base = "#" + (rgb[-6:] if len(rgb) >= 6 else rgb)
    elif ctype == "theme":
        base = f"theme:{color.theme}"
    elif ctype == "indexed":
        base = f"indexed:{color.indexed}"
    elif ctype == "auto":
        base = "auto"
    else:
        return None
    if tint:
        base += f"/tint:{round(float(tint), 6)}"
    return base


def norm_tree(obj: Any) -> Any:
    """Apply norm_number to every float in a JSON-like tree."""
    if isinstance(obj, dict):
        return {k: norm_tree(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [norm_tree(v) for v in obj]
    if isinstance(obj, float):
        return norm_number(obj)
    return obj


NS_X14 = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"
NS_XM = "http://schemas.microsoft.com/office/excel/2006/main"


def raw_x14(zf: zipfile.ZipFile, part: str) -> dict:
    """Summarise x14 extLst content openpyxl drops: CF rules, data validations, sparklines."""
    try:
        root = parse_xml(read_part(zf, part))
    except Exception:
        return {}
    cf = []
    dvs = []
    sparklines = 0
    for el in root.iter(f"{{{NS_X14}}}conditionalFormatting"):
        sq = el.find(f"{{{NS_XM}}}sqref")
        ranges = " ".join(sorted((sq.text or "").split())) if sq is not None else ""
        for rule in el.findall(f"{{{NS_X14}}}cfRule"):
            entry: dict = {"ranges": ranges, "type": rule.get("type"), "priority": rule.get("priority")}
            db = rule.find(f"{{{NS_X14}}}dataBar")
            if db is not None:
                entry["dataBar"] = {k: v for k, v in sorted(db.attrib.items())}
            ic = rule.find(f"{{{NS_X14}}}iconSet")
            if ic is not None:
                entry["iconSet"] = {k: v for k, v in sorted(ic.attrib.items())}
                entry["customIcons"] = len(ic.findall(f"{{{NS_X14}}}cfIcon")) or None
            fs = [f.text for f in rule.findall(f"{{{NS_XM}}}f")]
            if fs:
                entry["formula"] = fs
            cf.append({k: v for k, v in entry.items() if v is not None})
    for el in root.iter(f"{{{NS_X14}}}dataValidation"):
        sq = el.find(f"{{{NS_XM}}}sqref")
        f1 = el.find(f"{{{NS_X14}}}formula1/{{{NS_XM}}}f")
        dvs.append({k: v for k, v in {
            "ranges": " ".join(sorted((sq.text or "").split())) if sq is not None else "",
            "type": el.get("type"),
            "formula1": f1.text if f1 is not None else None,
        }.items() if v is not None})
    for _ in root.iter(f"{{{NS_X14}}}sparklineGroup"):
        sparklines += 1
    out: dict = {}
    if cf:
        out["conditionalFormatting"] = sorted(cf, key=lambda r: (int(r.get("priority") or 0), r["ranges"]))
    if dvs:
        out["dataValidations"] = sorted(dvs, key=lambda d: d["ranges"])
    if sparklines:
        out["sparklineGroups"] = sparklines
    return out


def prune(obj: Any) -> Any:
    """Drop None / False / empty containers so dumps only carry meaningful facts."""
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            v = prune(v)
            if v is None or v is False or v == {} or v == []:
                continue
            out[k] = v
        return out
    if isinstance(obj, list):
        return [prune(v) for v in obj]
    return obj


class WarningCollector:
    def __init__(self) -> None:
        self._ctx = warnings.catch_warnings(record=True)
        self.records: list = []

    def __enter__(self) -> "WarningCollector":
        self.records = self._ctx.__enter__()
        warnings.simplefilter("always")
        return self

    def __exit__(self, *exc: Any) -> None:
        self._ctx.__exit__(*exc)

    def messages(self) -> list[str]:
        return sorted({str(w.message) for w in self.records})


def iter_ranges(sqref: Any) -> Iterable[str]:
    text = str(sqref) if sqref is not None else ""
    return sorted(part for part in text.split() if part)
