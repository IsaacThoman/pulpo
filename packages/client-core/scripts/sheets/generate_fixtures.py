#!/usr/bin/env python3
"""Generate the synthetic sheets fixtures (openpyxl workbooks + CSV/TSV files).

    ~/.cache/pulpo-sheets-venv/bin/python -I generate_fixtures.py [--out DIR] [--libreoffice]
        [--large] [--large-only] [--large-dir DIR]

Default output is packages/client-core/test-fixtures/sheets/{generated,csv}. Output is
deterministic (fixed document timestamps and zip entry dates), so regenerating
without changes produces byte-identical files.

--libreoffice   also round-trip selected generated workbooks through headless
                LibreOffice into test-fixtures/sheets/libreoffice/*.lo.xlsx so
                that LibreOffice-calculated cached values exist (formula oracle)
--large         also write the large (not committed) fixtures into --large-dir
--large-only    only write the large fixtures
--large-dir     default ~/.cache/pulpo-sheets-corpus/generated

openpyxl never computes formula results, so every formula in generated/*.xlsx has
NO cached value; use the libreoffice/*.lo.xlsx twins (or POI files) as an oracle.
"""

from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_FIXTURES = os.path.normpath(os.path.join(HERE, "..", "..", "test-fixtures", "sheets"))
FIXED_TIME = dt.datetime(2024, 1, 2, 3, 4, 5)
ZIP_TIME = (2024, 1, 2, 3, 4, 6)


# ---------------------------------------------------------------------------
# helpers


def new_workbook():
    from openpyxl import Workbook

    wb = Workbook()
    wb.properties.creator = "pulpo-sheets-fixtures"
    wb.properties.lastModifiedBy = "pulpo-sheets-fixtures"
    wb.properties.created = FIXED_TIME
    wb.properties.modified = FIXED_TIME
    return wb


def save(wb, path: str) -> str:
    wb.save(path)
    normalize_zip(path)
    return path


def normalize_zip(path: str) -> None:
    """Rewrite the zip with fixed entry timestamps and a fixed dcterms:modified."""
    with zipfile.ZipFile(path) as zin:
        entries = [(info, zin.read(info)) for info in zin.infolist()]
    stamp = FIXED_TIME.strftime("%Y-%m-%dT%H:%M:%SZ").encode()
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zout:
        for info, data in entries:
            if info.filename == "docProps/core.xml":
                data = re.sub(rb"(<dcterms:modified[^>]*>)[^<]*(</dcterms:modified>)", rb"\g<1>" + stamp + rb"\g<2>", data)
                data = re.sub(rb"(<dcterms:created[^>]*>)[^<]*(</dcterms:created>)", rb"\g<1>" + stamp + rb"\g<2>", data)
            zi = zipfile.ZipInfo(info.filename, date_time=ZIP_TIME)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            zout.writestr(zi, data)


def header(ws, values, bold=True):
    from openpyxl.styles import Font

    for i, v in enumerate(values, start=1):
        c = ws.cell(row=1, column=i, value=v)
        if bold:
            c.font = Font(bold=True)


# ---------------------------------------------------------------------------
# workbooks


def gen_formulas(out: str) -> str:
    from openpyxl.workbook.defined_name import DefinedName
    from openpyxl.worksheet.formula import ArrayFormula

    wb = new_workbook()
    inp = wb.active
    inp.title = "Inputs"
    header(inp, ["Number", "Text", "Date", "Bool", "Category", "Amount", "Rate"])
    rows = [
        (10, "alpha", dt.date(2024, 1, 15), True, "East", 120.5, 0.05),
        (20, "Beta", dt.date(2024, 2, 29), False, "West", 80.25, 0.1),
        (30, "gamma ", dt.date(2023, 12, 31), True, "East", 300, 0.075),
        (-5, "", dt.date(2000, 1, 1), False, "North", 0, 0.2),
        (2.5, "delta", dt.date(1900, 3, 1), True, "West", 45.75, 0.15),
        (None, "epsilon", dt.date(2024, 6, 30), None, "East", 99.99, 0.05),
    ]
    for r, row in enumerate(rows, start=2):
        for c, v in enumerate(row, start=1):
            inp.cell(row=r, column=c, value=v)
        inp.cell(row=r, column=3).number_format = "yyyy-mm-dd"
    inp["I1"], inp["I2"] = "Lookup key", "gamma "
    inp["K1"], inp["L1"], inp["M1"] = "H1", "H2", "H3"
    inp["K2"], inp["L2"], inp["M2"] = 1, 2, 3

    other = wb.create_sheet("Sheet With Spaces")
    other["A1"] = 7
    other["A2"] = 11
    data = wb.create_sheet("Data")
    data["A1"] = 100
    data["A2"] = 200

    wb.defined_names["TaxRate"] = DefinedName("TaxRate", attr_text="Inputs!$G$2")
    wb.defined_names["Numbers"] = DefinedName("Numbers", attr_text="Inputs!$A$2:$A$7")
    wb.defined_names["Constant"] = DefinedName("Constant", attr_text="42")
    wb.defined_names["FormulaName"] = DefinedName("FormulaName", attr_text="SUM(Inputs!$F$2:$F$7)")

    ws = wb.create_sheet("Formulas", 1)
    ws.defined_names["LocalScale"] = DefinedName("LocalScale", attr_text="Formulas!$E$1")
    ws["D1"], ws["E1"] = "LocalScale", 3
    header(ws, ["Group", "Name", "Formula"])
    formulas = [
        # math
        ("math", "SUM", "=SUM(Inputs!A2:A7)"),
        ("math", "SUM multi-area", "=SUM(Inputs!A2:A3,Inputs!A5,100)"),
        ("math", "SUMIF", '=SUMIF(Inputs!E2:E7,"East",Inputs!F2:F7)'),
        ("math", "SUMIFS", '=SUMIFS(Inputs!F2:F7,Inputs!E2:E7,"East",Inputs!A2:A7,">10")'),
        ("math", "SUMPRODUCT", "=SUMPRODUCT(Inputs!A2:A6,Inputs!G2:G6)"),
        ("math", "PRODUCT", "=PRODUCT(Inputs!A2:A3)"),
        ("math", "ROUND", "=ROUND(2.5,0)"),
        ("math", "ROUND negative half", "=ROUND(-2.5,0)"),
        ("math", "ROUNDUP", "=ROUNDUP(3.14159,2)"),
        ("math", "ROUNDDOWN", "=ROUNDDOWN(-3.14159,2)"),
        ("math", "MROUND", "=MROUND(10,3)"),
        ("math", "INT negative", "=INT(-3.5)"),
        ("math", "TRUNC", "=TRUNC(-3.5)"),
        ("math", "MOD negative", "=MOD(-3,2)"),
        ("math", "ABS", "=ABS(-4)"),
        ("math", "SQRT", "=SQRT(16)"),
        ("math", "POWER", "=POWER(2,10)"),
        ("math", "EXP/LN", "=LN(EXP(1))"),
        ("math", "LOG", "=LOG(1000)"),
        ("math", "LOG10", "=LOG10(0.01)"),
        ("math", "PI", "=PI()"),
        ("math", "CEILING", "=CEILING(4.3,2)"),
        ("math", "FLOOR", "=FLOOR(4.7,2)"),
        ("math", "SIGN", "=SIGN(-0.1)"),
        ("math", "FACT", "=FACT(10)"),
        ("math", "GCD/LCM", "=GCD(12,18)+LCM(4,6)"),
        ("math", "QUOTIENT", "=QUOTIENT(7,2)"),
        ("math", "EVEN/ODD", "=EVEN(3)+ODD(2)"),
        ("math", "COMBIN", "=COMBIN(10,3)"),
        ("math", "trig", "=ROUND(SIN(PI()/6)+COS(0)+TAN(PI()/4)+ATAN2(1,1),10)"),
        ("math", "DEGREES/RADIANS", "=DEGREES(RADIANS(180))"),
        ("math", "SUBTOTAL", "=SUBTOTAL(9,Inputs!F2:F7)"),
        ("math", "float noise", "=0.1+0.2"),
        ("math", "precision 15 digits", "=1/3*3"),
        ("math", "big", "=2^53+1"),
        # operators
        ("operators", "unary minus vs power", "=-2^2"),
        ("operators", "power left-assoc", "=2^3^2"),
        ("operators", "percent", "=50%*10"),
        ("operators", "concat", '=Inputs!B2&"-"&Inputs!A2'),
        ("operators", "compare text case-insensitive", '="abc"="ABC"'),
        ("operators", "bool arithmetic", "=TRUE+TRUE"),
        ("operators", "text number coercion", '="3"+4'),
        ("operators", "intersection", "=SUM(Inputs!A2:C4 Inputs!B3:D5)"),
        ("operators", "union", "=SUM((Inputs!A2,Inputs!A4))"),
        ("operators", "not equal", "=Inputs!A2<>Inputs!A3"),
        # stats
        ("stats", "AVERAGE", "=AVERAGE(Inputs!A2:A7)"),
        ("stats", "AVERAGEIF", '=AVERAGEIF(Inputs!E2:E7,"West",Inputs!F2:F7)'),
        ("stats", "AVERAGEIFS", '=AVERAGEIFS(Inputs!F2:F7,Inputs!E2:E7,"East",Inputs!D2:D7,TRUE)'),
        ("stats", "COUNT", "=COUNT(Inputs!A1:A7)"),
        ("stats", "COUNTA", "=COUNTA(Inputs!B1:B7)"),
        ("stats", "COUNTBLANK", "=COUNTBLANK(Inputs!A2:A7)"),
        ("stats", "COUNTIF wildcard", '=COUNTIF(Inputs!B2:B7,"*a")'),
        ("stats", "COUNTIFS", '=COUNTIFS(Inputs!E2:E7,"East",Inputs!F2:F7,">100")'),
        ("stats", "MAX/MIN", "=MAX(Inputs!A2:A7)-MIN(Inputs!A2:A7)"),
        ("stats", "MEDIAN", "=MEDIAN(Inputs!A2:A7)"),
        ("stats", "MODE", "=MODE(1,2,2,3)"),
        ("stats", "STDEV", "=STDEV(Inputs!A2:A6)"),
        ("stats", "VAR", "=VAR(Inputs!A2:A6)"),
        ("stats", "LARGE/SMALL", "=LARGE(Inputs!A2:A7,2)+SMALL(Inputs!A2:A7,2)"),
        ("stats", "RANK", "=RANK(Inputs!A3,Inputs!A2:A6)"),
        ("stats", "PERCENTILE", "=PERCENTILE(Inputs!A2:A6,0.25)"),
        ("stats", "QUARTILE", "=QUARTILE(Inputs!A2:A6,3)"),
        ("stats", "CORREL", "=CORREL(Inputs!A2:A6,Inputs!F2:F6)"),
        ("stats", "MAXIFS (_xlfn)", '=_xlfn.MAXIFS(Inputs!F2:F7,Inputs!E2:E7,"East")'),
        ("stats", "MINIFS (_xlfn)", '=_xlfn.MINIFS(Inputs!F2:F7,Inputs!E2:E7,"East")'),
        # logical
        ("logical", "IF", '=IF(Inputs!A2>15,"big","small")'),
        ("logical", "nested IF", '=IF(Inputs!A4>25,"a",IF(Inputs!A4>15,"b","c"))'),
        ("logical", "AND/OR/NOT", "=AND(Inputs!D2,OR(Inputs!D3,NOT(Inputs!D5)))"),
        ("logical", "IFERROR", '=IFERROR(1/0,"div0")'),
        ("logical", "IFNA", '=_xlfn.IFNA(NA(),"na")'),
        ("logical", "IFS (_xlfn)", '=_xlfn.IFS(Inputs!A2>50,"x",Inputs!A2>5,"y")'),
        ("logical", "SWITCH (_xlfn)", '=_xlfn.SWITCH(Inputs!E3,"East",1,"West",2,0)'),
        ("logical", "XOR (_xlfn)", "=_xlfn.XOR(TRUE,FALSE,TRUE)"),
        ("logical", "TRUE()", "=TRUE()"),
        # text
        ("text", "CONCATENATE", '=CONCATENATE(Inputs!B2," ",Inputs!B3)'),
        ("text", "CONCAT (_xlfn)", "=_xlfn.CONCAT(Inputs!B2:B4)"),
        ("text", "TEXTJOIN (_xlfn)", '=_xlfn.TEXTJOIN(", ",TRUE,Inputs!B2:B7)'),
        ("text", "LEFT/RIGHT/MID", '=LEFT(Inputs!B2,2)&MID(Inputs!B2,2,3)&RIGHT(Inputs!B2,1)'),
        ("text", "LEN", "=LEN(Inputs!B4)"),
        ("text", "UPPER/LOWER/PROPER", '=UPPER("a")&LOWER("B")&PROPER("hello world")'),
        ("text", "TRIM", '=TRIM("  a   b  ")'),
        ("text", "SUBSTITUTE", '=SUBSTITUTE("a-b-c","-","+",2)'),
        ("text", "REPLACE", '=REPLACE("abcdef",2,3,"X")'),
        ("text", "FIND (case-sensitive)", '=FIND("B","abcB")'),
        ("text", "SEARCH (case-insensitive)", '=SEARCH("b","abcB")'),
        ("text", "TEXT number", '=TEXT(1234.567,"#,##0.00")'),
        ("text", "TEXT date", '=TEXT(Inputs!C2,"dddd, mmmm d, yyyy")'),
        ("text", "TEXT percent", '=TEXT(0.1234,"0.0%")'),
        ("text", "VALUE", '=VALUE("1,234.5")'),
        ("text", "REPT", '=REPT("ab",3)'),
        ("text", "EXACT", '=EXACT("a","A")'),
        ("text", "CHAR/CODE", "=CHAR(65)&CODE(\"a\")"),
        ("text", "FIXED", "=FIXED(1234.567,1)"),
        ("text", "DOLLAR", "=DOLLAR(1234.567,2)"),
        ("text", "CLEAN", '=CLEAN("a"&CHAR(7)&"b")'),
        ("text", "T/N", '=T("x")&N(TRUE)'),
        ("text", "unicode", '="naïve café ✓ 日本"&LEN("日本")'),
        # lookup
        ("lookup", "VLOOKUP exact", "=VLOOKUP(Inputs!I2,Inputs!B2:F7,4,FALSE)"),
        ("lookup", "VLOOKUP approx", "=VLOOKUP(25,Inputs!A2:B4,2,TRUE)"),
        ("lookup", "HLOOKUP", '=HLOOKUP("H2",Inputs!K1:M2,2,FALSE)'),
        ("lookup", "INDEX/MATCH", '=INDEX(Inputs!F2:F7,MATCH("delta",Inputs!B2:B7,0))'),
        ("lookup", "MATCH approx", "=MATCH(25,Inputs!A2:A4,1)"),
        ("lookup", "LOOKUP", "=LOOKUP(20,Inputs!A2:A3,Inputs!B2:B3)"),
        ("lookup", "CHOOSE", '=CHOOSE(2,"a","b","c")'),
        ("lookup", "OFFSET", "=SUM(OFFSET(Inputs!A1,1,0,3,1))"),
        ("lookup", "INDIRECT", '=INDIRECT("Inputs!A"&3)'),
        ("lookup", "ROW/COLUMN", "=ROW(Inputs!C5)*100+COLUMN(Inputs!C5)"),
        ("lookup", "ROWS/COLUMNS", "=ROWS(Inputs!A1:C7)*COLUMNS(Inputs!A1:C7)"),
        ("lookup", "ADDRESS", "=ADDRESS(2,3,1,FALSE,\"Inputs\")"),
        ("lookup", "XLOOKUP (_xlfn)", '=_xlfn.XLOOKUP("Beta",Inputs!B2:B7,Inputs!F2:F7,"none")'),
        # date
        ("date", "DATE", "=DATE(2024,2,29)"),
        ("date", "DATE overflow", "=DATE(2024,14,35)"),
        ("date", "YEAR/MONTH/DAY", "=YEAR(Inputs!C3)*10000+MONTH(Inputs!C3)*100+DAY(Inputs!C3)"),
        ("date", "WEEKDAY", "=WEEKDAY(Inputs!C2,2)"),
        ("date", "WEEKNUM", "=WEEKNUM(Inputs!C2)"),
        ("date", "EDATE", "=EDATE(Inputs!C2,1)"),
        ("date", "EOMONTH", "=EOMONTH(Inputs!C3,0)"),
        ("date", "DATEDIF", '=DATEDIF(Inputs!C5,Inputs!C2,"y")'),
        ("date", "DAYS (_xlfn)", "=_xlfn.DAYS(Inputs!C2,Inputs!C4)"),
        ("date", "NETWORKDAYS", "=NETWORKDAYS(Inputs!C4,Inputs!C2)"),
        ("date", "WORKDAY", "=WORKDAY(Inputs!C2,10)"),
        ("date", "TIME", "=TIME(13,30,15)"),
        ("date", "HOUR/MINUTE/SECOND", "=HOUR(0.75)*10000+MINUTE(0.75)*100+SECOND(0.75)"),
        ("date", "DATEVALUE", '=DATEVALUE("2024-03-15")'),
        ("date", "TIMEVALUE", '=TIMEVALUE("6:45 PM")'),
        ("date", "YEARFRAC", "=YEARFRAC(Inputs!C4,Inputs!C2,1)"),
        ("date", "1900 leap bug", "=DATE(1900,3,1)-DATE(1900,2,28)"),
        # info
        ("info", "ISBLANK", "=ISBLANK(Inputs!A7)"),
        ("info", "ISNUMBER/ISTEXT", "=ISNUMBER(Inputs!A2)&ISTEXT(Inputs!B2)"),
        ("info", "ISERROR/ISNA/ISERR", "=ISERROR(1/0)&ISNA(NA())&ISERR(NA())"),
        ("info", "ISLOGICAL", "=ISLOGICAL(Inputs!D2)"),
        ("info", "ISEVEN/ISODD", "=ISEVEN(4)&ISODD(4)"),
        ("info", "TYPE", '=TYPE("x")'),
        ("info", "ERROR.TYPE", "=ERROR.TYPE(1/0)"),
        # financial
        ("financial", "PMT", "=PMT(0.05/12,360,-200000)"),
        ("financial", "FV", "=FV(0.06/12,10,-200,-500,1)"),
        ("financial", "PV", "=PV(0.08/12,240,500)"),
        ("financial", "NPV", "=NPV(0.1,-10000,3000,4200,6800)"),
        ("financial", "IRR", "=IRR({-70000,12000,15000,18000,21000,26000})"),
        ("financial", "RATE", "=RATE(48,-200,8000)"),
        ("financial", "NPER", "=NPER(0.01,-100,1000)"),
        ("financial", "IPMT/PPMT", "=IPMT(0.1/12,1,36,8000)+PPMT(0.1/12,1,36,8000)"),
        ("financial", "SLN", "=SLN(30000,7500,10)"),
        # references
        ("refs", "cross-sheet", "=Inputs!A2*2"),
        ("refs", "quoted sheet", "='Sheet With Spaces'!A1+'Sheet With Spaces'!A2"),
        ("refs", "3D reference", "=SUM('Sheet With Spaces:Data'!A1)"),
        ("refs", "mixed absolute", "=Inputs!$A$2+Inputs!A$3+Inputs!$A4"),
        ("refs", "whole column", "=SUM(Inputs!F:F)"),
        ("refs", "whole row", "=SUM(Inputs!2:2)"),
        ("refs", "defined name", "=TaxRate*100"),
        ("refs", "defined name range", "=SUM(Numbers)"),
        ("refs", "constant name", "=Constant+1"),
        ("refs", "formula name", "=FormulaName"),
        ("refs", "sheet-local name", "=LocalScale*2"),
        # errors
        ("errors", "DIV/0 error", "=1/0"),
        ("errors", "N/A error", "=NA()"),
        ("errors", "VALUE error", '="a"+1'),
        ("errors", "NUM error", "=SQRT(-1)"),
        ("errors", "NAME error", "=NoSuchName+1"),
        ("errors", "REF error", "=INDIRECT(\"NoSheet!A1\")"),
        ("errors", "NULL error", "=SUM(Inputs!A2:A3 Inputs!C2:C3)"),
        ("errors", "error propagation", "=SUM(Inputs!A2,1/0)"),
    ]
    for r, (group, name, formula) in enumerate(formulas, start=2):
        ws.cell(row=r, column=1, value=group)
        ws.cell(row=r, column=2, value=name).data_type = "s"  # labels like "#N/A" would otherwise become error cells
        ws.cell(row=r, column=3, value=formula)
    nxt = len(formulas) + 3
    ws.cell(row=nxt, column=1, value="array")
    ws.cell(row=nxt, column=2, value="CSE array SUM")
    ws.cell(row=nxt, column=3).value = ArrayFormula(f"C{nxt}", "=SUM(Inputs!A2:A6*Inputs!G2:G6)")
    ws.cell(row=nxt + 1, column=1, value="array")
    ws.cell(row=nxt + 1, column=2, value="CSE multi-cell TRANSPOSE")
    ws.cell(row=nxt + 1, column=3).value = ArrayFormula(f"C{nxt + 1}:E{nxt + 1}", "=TRANSPOSE(Inputs!A2:A4)")
    ws.column_dimensions["B"].width = 28
    ws.column_dimensions["C"].width = 60

    vol = wb.create_sheet("Volatile")
    vol["A1"], vol["B1"] = "TODAY", "=TODAY()"
    vol["A2"], vol["B2"] = "NOW", "=NOW()"
    vol["A3"], vol["B3"] = "RAND", "=RAND()"
    vol["A4"], vol["B4"] = "RANDBETWEEN", "=RANDBETWEEN(1,6)"
    vol["B1"].number_format = "yyyy-mm-dd"
    vol["B2"].number_format = "yyyy-mm-dd hh:mm"
    return save(wb, os.path.join(out, "gen-formulas.xlsx"))


def gen_values(out: str) -> str:
    from openpyxl.cell.rich_text import CellRichText, TextBlock
    from openpyxl.cell.text import InlineFont

    wb = new_workbook()
    ws = wb.active
    ws.title = "Values"
    header(ws, ["Kind", "Value", "Note"])
    rows = [
        ("int", 42, ""),
        ("negative", -17, ""),
        ("zero", 0, ""),
        ("negative zero", -0.0, "stored as -0 or 0"),
        ("float", 3.141592653589793, ""),
        ("0.1", 0.1, ""),
        ("tiny", 1e-300, ""),
        ("huge", 1.7976931348623157e308, "max double"),
        ("15 digits", 123456789012345, ""),
        ("17 digits", 12345678901234567, "beyond Excel precision"),
        ("2^53+1 as float", 9007199254740993.0, ""),
        ("text", "hello", ""),
        ("empty string", "", "openpyxl writes nothing for ''"),
        ("leading/trailing spaces", "  padded  ", ""),
        ("newline", "line1\nline2", ""),
        ("tab", "a\tb", ""),
        ("numeric text", "00123", "text, not number"),
        ("formula-looking text", "'=1+1", "leading apostrophe stored literally"),
        ("unicode", "naïve café Ελληνικά 日本語 עברית 🎉", ""),
        ("xml specials", "<a href=\"x\">&amp;</a>", ""),
        ("escaped control char", "bell_x0007_char", "stored as _x0007_; readers decode it to U+0007"),
        ("escaped underscore", "_x005F_x0041_", "decodes to the literal text '_x0041_'"),
        ("bare escape", "_x0041_", "decodes to 'A' per ECMA-376 (openpyxl does not escape)"),
        ("bool true", True, ""),
        ("bool false", False, ""),
        ("date", dt.date(2024, 2, 29), ""),
        ("datetime", dt.datetime(2024, 2, 29, 13, 45, 30), ""),
        ("time", dt.time(6, 30), ""),
        ("pre-1900-03-01 date", dt.date(1900, 2, 28), "1900 leap-year bug boundary"),
        ("error #N/A", "#N/A", "written as error"),
        ("error #DIV/0!", "#DIV/0!", "written as error"),
    ]
    for r, (kind, value, note) in enumerate(rows, start=2):
        ws.cell(row=r, column=1, value=kind)
        c = ws.cell(row=r, column=2, value=value)
        ws.cell(row=r, column=3, value=note)
        if isinstance(value, str) and value.startswith("#") and value.endswith(("!", "A")):
            c.data_type = "e"
    long_row = len(rows) + 2
    ws.cell(row=long_row, column=1, value="32767 chars")
    ws.cell(row=long_row, column=2, value=("0123456789" * 3277)[:32767])
    rich_row = long_row + 1
    ws.cell(row=rich_row, column=1, value="rich text")
    ws.cell(row=rich_row, column=2).value = CellRichText(
        "plain ",
        TextBlock(InlineFont(b=True), "bold "),
        TextBlock(InlineFont(i=True, color="FFFF0000"), "red italic "),
        TextBlock(InlineFont(u="single", sz=14, rFont="Courier New"), "big mono"),
        TextBlock(InlineFont(vertAlign="superscript"), "sup"),
    )
    ws.column_dimensions["A"].width = 24
    ws.column_dimensions["B"].width = 40

    sparse = wb.create_sheet("Sparse")
    sparse["A1"] = "top-left"
    sparse["XFD1"] = "last column"
    sparse["A1048576"] = "last row"
    sparse["AA100"] = 1
    return save(wb, os.path.join(out, "gen-values.xlsx"))


def gen_1904(out: str) -> str:
    from openpyxl.utils.datetime import CALENDAR_MAC_1904

    wb = new_workbook()
    wb.epoch = CALENDAR_MAC_1904
    ws = wb.active
    ws.title = "Dates1904"
    header(ws, ["Date", "Serial (=N())", "Note"])
    for r, d in enumerate([dt.date(1904, 1, 1), dt.date(1904, 1, 2), dt.date(2000, 1, 1), dt.date(2024, 2, 29)], start=2):
        ws.cell(row=r, column=1, value=d).number_format = "yyyy-mm-dd"
        ws.cell(row=r, column=2, value=f"=A{r}*1")
    ws["C2"] = "serial 0 in the 1904 system"
    ws["A7"] = dt.datetime(2024, 2, 29, 12, 0)
    ws["A7"].number_format = "yyyy-mm-dd hh:mm"
    ws["B7"] = "=A7-INT(A7)"
    return save(wb, os.path.join(out, "gen-1904.xlsx"))


def gen_styles(out: str) -> str:
    from openpyxl.cell.rich_text import CellRichText, TextBlock
    from openpyxl.cell.text import InlineFont
    from openpyxl.styles import Alignment, Border, Color, Font, GradientFill, NamedStyle, PatternFill, Protection, Side

    wb = new_workbook()
    ws = wb.active
    ws.title = "Fonts"
    header(ws, ["Case", "Sample"])
    font_cases = [
        ("bold", Font(bold=True)),
        ("italic", Font(italic=True)),
        ("underline single", Font(underline="single")),
        ("underline double", Font(underline="double")),
        ("underline singleAccounting", Font(underline="singleAccounting")),
        ("underline doubleAccounting", Font(underline="doubleAccounting")),
        ("strike", Font(strike=True)),
        ("superscript", Font(vertAlign="superscript")),
        ("subscript", Font(vertAlign="subscript")),
        ("size 8", Font(size=8)),
        ("size 24", Font(size=24)),
        ("size 10.5", Font(size=10.5)),
        ("Arial", Font(name="Arial")),
        ("Times New Roman", Font(name="Times New Roman")),
        ("Courier New", Font(name="Courier New")),
        ("rgb red", Font(color="FFFF0000")),
        ("theme 4 (accent1)", Font(color=Color(theme=4))),
        ("theme 5 tint -0.25", Font(color=Color(theme=5, tint=-0.249977111117893))),
        ("theme 9 tint 0.4", Font(color=Color(theme=9, tint=0.3999755851924192))),
        ("indexed 10", Font(color=Color(indexed=10))),
        ("bold italic underline strike blue", Font(bold=True, italic=True, underline="single", strike=True, color="FF0000FF")),
        ("outline+shadow", Font(outline=True, shadow=True)),
    ]
    for r, (label, font) in enumerate(font_cases, start=2):
        ws.cell(row=r, column=1, value=label)
        ws.cell(row=r, column=2, value="The quick brown fox").font = font
    r = len(font_cases) + 2
    ws.cell(row=r, column=1, value="rich text runs")
    ws.cell(row=r, column=2).value = CellRichText(
        TextBlock(InlineFont(b=True, color="FF00AA00"), "green bold"), " normal ",
        TextBlock(InlineFont(strike=True), "struck"),
    )
    ws.column_dimensions["A"].width = 32
    ws.column_dimensions["B"].width = 28

    fills = wb.create_sheet("Fills")
    patterns = ["solid", "darkDown", "darkGray", "darkGrid", "darkHorizontal", "darkTrellis", "darkUp", "darkVertical",
                "gray0625", "gray125", "lightDown", "lightGray", "lightGrid", "lightHorizontal", "lightTrellis",
                "lightUp", "lightVertical", "mediumGray"]
    header(fills, ["Pattern", "Sample"])
    for r, p in enumerate(patterns, start=2):
        fills.cell(row=r, column=1, value=p)
        fills.cell(row=r, column=2).fill = PatternFill(patternType=p, fgColor="FF4472C4", bgColor="FFFFC000")
    r = len(patterns) + 2
    extra_fills = [
        ("solid theme 6 tint 0.6", PatternFill("solid", fgColor=Color(theme=6, tint=0.5999938962981048))),
        ("solid indexed 13", PatternFill("solid", fgColor=Color(indexed=13))),
        ("gradient linear 90", GradientFill(type="linear", degree=90, stop=("FFFFFFFF", "FF4472C4"))),
        ("gradient linear 45 3 stops", GradientFill(type="linear", degree=45, stop=("FFFF0000", "FFFFFF00", "FF00B050"))),
        ("gradient path", GradientFill(type="path", left=0.5, right=0.5, top=0.5, bottom=0.5, stop=("FFFFFFFF", "FF7030A0"))),
    ]
    for i, (label, fill) in enumerate(extra_fills):
        fills.cell(row=r + i, column=1, value=label)
        fills.cell(row=r + i, column=2).fill = fill
    fills.column_dimensions["A"].width = 28
    fills.column_dimensions["B"].width = 18

    borders = wb.create_sheet("Borders")
    styles = ["thin", "medium", "thick", "dashed", "dotted", "double", "hair", "mediumDashed", "dashDot",
              "mediumDashDot", "dashDotDot", "mediumDashDotDot", "slantDashDot"]
    header(borders, ["Style", "Box"])
    for r, s in enumerate(styles, start=2):
        borders.cell(row=r * 2, column=1, value=s)
        side = Side(style=s, color="FF000000")
        borders.cell(row=r * 2, column=2).border = Border(left=side, right=side, top=side, bottom=side)
    base = len(styles) * 2 + 6
    borders.cell(row=base, column=1, value="mixed colours/sides")
    borders.cell(row=base, column=2).border = Border(
        left=Side("thick", color="FFFF0000"), right=Side("dashed", color=Color(theme=4)),
        top=Side("double", color=Color(indexed=12)), bottom=Side("thin"))
    borders.cell(row=base + 2, column=1, value="diagonal up+down")
    borders.cell(row=base + 2, column=2).border = Border(diagonal=Side("thin", color="FF00B050"), diagonalUp=True, diagonalDown=True)
    borders.cell(row=base + 4, column=1, value="outline range (B..D)")
    for col in range(2, 5):
        borders.cell(row=base + 4, column=col).border = Border(
            top=Side("medium"), bottom=Side("medium"),
            left=Side("medium") if col == 2 else Side(), right=Side("medium") if col == 4 else Side())

    align = wb.create_sheet("Alignment")
    header(align, ["Case", "Sample"])
    cases = [
        ("left", Alignment(horizontal="left")), ("center", Alignment(horizontal="center")),
        ("right", Alignment(horizontal="right")), ("fill", Alignment(horizontal="fill")),
        ("justify", Alignment(horizontal="justify", wrap_text=True)),
        ("centerContinuous", Alignment(horizontal="centerContinuous")),
        ("distributed", Alignment(horizontal="distributed")),
        ("top", Alignment(vertical="top")), ("vcenter", Alignment(vertical="center")),
        ("vjustify", Alignment(vertical="justify")), ("vdistributed", Alignment(vertical="distributed")),
        ("wrap", Alignment(wrap_text=True)), ("shrink", Alignment(shrink_to_fit=True)),
        ("rotate 45", Alignment(text_rotation=45)), ("rotate 90", Alignment(text_rotation=90)),
        ("rotate -45 (135)", Alignment(text_rotation=135)), ("vertical stacked (255)", Alignment(text_rotation=255)),
        ("indent 2", Alignment(horizontal="left", indent=2)), ("indent 3 right", Alignment(horizontal="right", indent=3)),
        ("rtl reading order", Alignment(readingOrder=2)),
    ]
    for r, (label, al) in enumerate(cases, start=2):
        align.cell(row=r, column=1, value=label)
        c = align.cell(row=r, column=2, value="Alignment sample text that is fairly long")
        c.alignment = al
    align.column_dimensions["B"].width = 22

    numfmt = wb.create_sheet("NumberFormats")
    header(numfmt, ["Format", "Value", "Note"])
    formats = [
        ("General", 1234.5678), ("0", 1234.5678), ("0.00", 1234.5678), ("#,##0", 1234567.891), ("#,##0.00", -1234.5),
        ("0%", 0.256), ("0.00%", 0.25678), ("0.00E+00", 123456789), ("# ?/?", 1.25), ("# ??/??", 3.14159),
        ('"$"#,##0.00', 1234.5), ('"$"#,##0.00_);[Red]("$"#,##0.00)', -1234.5),
        ('_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)', 0),
        ("[$€-407] #,##0.00", 99.5), ("[$¥-411]#,##0", 1500), ("#,##0;[Red]-#,##0;\"zero\";@", 0),
        ("[>=1000]#,##0,\"K\";0", 123456), ("0000", 42), ("@", "text format"), ("@", 123),
        ("yyyy-mm-dd", dt.date(2024, 2, 29)), ("d-mmm-yy", dt.date(2024, 2, 29)), ("dddd, mmmm d, yyyy", dt.date(2024, 2, 29)),
        ("m/d/yyyy h:mm AM/PM", dt.datetime(2024, 2, 29, 15, 5)), ("hh:mm:ss", dt.time(13, 45, 30)),
        ("[h]:mm:ss", 1.75), ("mm:ss.0", 0.000694444), ("[$-409]mmmm yyyy", dt.date(2024, 7, 1)),
        ("[$-F800]dddd, mmmm dd, yyyy", dt.date(2024, 7, 1)), ("0.00;-0.00;;@", 0), (";;;", 123),
    ]
    for r, (fmt, value) in enumerate(formats, start=2):
        numfmt.cell(row=r, column=1, value=fmt)
        c = numfmt.cell(row=r, column=2, value=value)
        c.number_format = fmt
    numfmt.column_dimensions["A"].width = 50
    numfmt.column_dimensions["B"].width = 26

    misc = wb.create_sheet("Protection+Named")
    highlight = NamedStyle(name="Highlight")
    highlight.font = Font(bold=True, color="FF9C0006")
    highlight.fill = PatternFill("solid", fgColor="FFFFC7CE")
    highlight.border = Border(bottom=Side("thin", color="FF9C0006"))
    wb.add_named_style(highlight)
    misc["A1"] = "named style Highlight"
    misc["B1"].style = "Highlight"
    misc["B1"] = "styled"
    misc["A2"] = "builtin style 'Good'"
    misc["B2"] = "good"
    misc["B2"].style = "Good"
    misc["A3"] = "builtin style 'Currency'"
    misc["B3"] = 12.5
    misc["B3"].style = "Currency"
    misc["A4"] = "unlocked"
    misc["B4"] = "editable"
    misc["B4"].protection = Protection(locked=False)
    misc["A5"] = "hidden formula"
    misc["B5"] = "=1+1"
    misc["B5"].protection = Protection(locked=True, hidden=True)
    misc["A6"] = "styled empty cell ->"
    misc["B6"].fill = PatternFill("solid", fgColor="FFDDEBF7")
    misc["A7"] = "everything"
    misc["B7"] = 0.5
    misc["B7"].font = Font(name="Georgia", size=13, bold=True, italic=True, color=Color(theme=1))
    misc["B7"].fill = PatternFill("solid", fgColor=Color(theme=7, tint=0.7999816888943144))
    misc["B7"].border = Border(left=Side("thin"), right=Side("thin"), top=Side("thin"), bottom=Side("double"))
    misc["B7"].alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    misc["B7"].number_format = "0.0%"
    misc.column_dimensions["A"].width = 26
    return save(wb, os.path.join(out, "gen-styles.xlsx"))


def gen_conditional(out: str) -> str:
    from openpyxl.formatting.rule import CellIsRule, ColorScaleRule, DataBarRule, FormulaRule, IconSetRule, Rule
    from openpyxl.styles import Border, Font, PatternFill, Side
    from openpyxl.styles.differential import DifferentialStyle

    wb = new_workbook()
    ws = wb.active
    ws.title = "CF"
    header(ws, ["Rule", "v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8"])
    values = [5, -3, 12, 0, 7, 25, 12, 40]
    red = DifferentialStyle(font=Font(color="FF9C0006"), fill=PatternFill(bgColor="FFFFC7CE"))
    green = DifferentialStyle(font=Font(color="FF006100", bold=True), fill=PatternFill(bgColor="FFC6EFCE"))
    yellow = DifferentialStyle(fill=PatternFill(bgColor="FFFFEB9C"), border=Border(bottom=Side("thin", color="FF9C5700")))
    numfmt = DifferentialStyle(numFmt=None)
    rules = []
    ops = [("between", ["0", "10"]), ("notBetween", ["0", "10"]), ("equal", ["12"]), ("notEqual", ["12"]),
           ("greaterThan", ["10"]), ("lessThan", ["0"]), ("greaterThanOrEqual", ["12"]), ("lessThanOrEqual", ["5"])]
    for op, formula in ops:
        rules.append((f"cellIs {op}", CellIsRule(operator=op, formula=formula, font=Font(color="FF9C0006"), fill=PatternFill(bgColor="FFFFC7CE"))))
    rules += [
        ("expression", FormulaRule(formula=["MOD(B{row},2)=0"], fill=PatternFill(bgColor="FFDDEBF7"))),
        ("expression stopIfTrue", FormulaRule(formula=["B{row}<0"], stopIfTrue=True, font=Font(strike=True))),
        ("colorScale 2", ColorScaleRule(start_type="min", start_color="FFF8696B", end_type="max", end_color="FF63BE7B")),
        ("colorScale 3", ColorScaleRule(start_type="num", start_value=0, start_color="FF5A8AC6", mid_type="percentile",
                                        mid_value=50, mid_color="FFFCFCFF", end_type="max", end_color="FFF8696B")),
        ("dataBar", DataBarRule(start_type="min", end_type="max", color="FF638EC6", showValue=True)),
        ("dataBar num/percent", DataBarRule(start_type="num", start_value=0, end_type="percent", end_value=80, color="FFFF555A")),
        ("iconSet 3Arrows", IconSetRule("3Arrows", "percent", [0, 33, 67])),
        ("iconSet 4Rating reverse", IconSetRule("4Rating", "percent", [0, 25, 50, 75], reverse=True)),
        ("iconSet 5Quarters no value", IconSetRule("5Quarters", "num", [-10, 0, 10, 20, 30], showValue=False)),
        ("iconSet 3TrafficLights1", IconSetRule("3TrafficLights1", "percentile", [0, 33, 67])),
        ("top10 top 3", Rule(type="top10", rank=3, dxf=green)),
        ("top10 bottom 2", Rule(type="top10", rank=2, bottom=True, dxf=red)),
        ("top10 top 25%", Rule(type="top10", rank=25, percent=True, dxf=yellow)),
        ("aboveAverage", Rule(type="aboveAverage", aboveAverage=True, dxf=green)),
        ("belowAverage", Rule(type="aboveAverage", aboveAverage=False, dxf=red)),
        ("above 1 stdDev", Rule(type="aboveAverage", aboveAverage=True, stdDev=1, dxf=yellow)),
        ("duplicateValues", Rule(type="duplicateValues", dxf=red)),
        ("uniqueValues", Rule(type="uniqueValues", dxf=green)),
    ]
    r = 2
    for label, rule in rules:
        ws.cell(row=r, column=1, value=label)
        for c, v in enumerate(values, start=2):
            ws.cell(row=r, column=c, value=v)
        if rule.formula:
            rule.formula = [f.replace("{row}", str(r)) for f in rule.formula]
        ws.conditional_formatting.add(f"B{r}:I{r}", rule)
        r += 1

    text_rows = [
        ("containsText", "containsText", "an", 'NOT(ISERROR(SEARCH("an",B{row})))'),
        ("notContainsText", "notContains", "an", 'ISERROR(SEARCH("an",B{row}))'),
        ("beginsWith", "beginsWith", "ba", 'LEFT(B{row},LEN("ba"))="ba"'),
        ("endsWith", "endsWith", "na", 'RIGHT(B{row},LEN("na"))="na"'),
    ]
    words = ["banana", "apple", "bandana", "cherry", "", "#N/A", "nan", "orange"]
    for label, op, text, formula in text_rows:
        ws.cell(row=r, column=1, value=label)
        for c, v in enumerate(words, start=2):
            cell = ws.cell(row=r, column=c, value=v if v != "#N/A" else "=NA()")
        rule = Rule(type=label, operator=op, text=text, formula=[formula.replace("{row}", str(r))], dxf=yellow)
        ws.conditional_formatting.add(f"B{r}:I{r}", rule)
        r += 1
    for label, formula in [("containsBlanks", "LEN(TRIM(B{row}))=0"), ("notContainsBlanks", "LEN(TRIM(B{row}))>0"),
                           ("containsErrors", "ISERROR(B{row})"), ("notContainsErrors", "NOT(ISERROR(B{row}))")]:
        ws.cell(row=r, column=1, value=label)
        for c, v in enumerate(words, start=2):
            ws.cell(row=r, column=c, value=v if v != "#N/A" else "=NA()")
        ws.conditional_formatting.add(f"B{r}:I{r}", Rule(type=label, formula=[formula.replace("{row}", str(r))], dxf=red))
        r += 1

    periods = [("today", "FLOOR(B{row},1)=TODAY()"), ("yesterday", "FLOOR(B{row},1)=TODAY()-1"),
               ("last7Days", "AND(TODAY()-FLOOR(B{row},1)<=6,FLOOR(B{row},1)<=TODAY())"),
               ("thisMonth", "AND(MONTH(B{row})=MONTH(TODAY()),YEAR(B{row})=YEAR(TODAY()))")]
    for period, formula in periods:
        ws.cell(row=r, column=1, value=f"timePeriod {period}")
        for c in range(2, 10):
            ws.cell(row=r, column=c, value=f"=TODAY()-{(c - 2) * 3}").number_format = "yyyy-mm-dd"
        ws.conditional_formatting.add(f"B{r}:I{r}", Rule(type="timePeriod", timePeriod=period,
                                                         formula=[formula.replace("{row}", str(r))], dxf=green))
        r += 1

    ws.cell(row=r, column=1, value="multi-range sqref")
    for c, v in enumerate(values, start=2):
        ws.cell(row=r, column=c, value=v)
        ws.cell(row=r + 1, column=c, value=v * 2)
    ws.conditional_formatting.add(f"B{r}:D{r} F{r}:I{r + 1}", CellIsRule(operator="greaterThan", formula=["10"], fill=PatternFill(bgColor="FFFFC000")))
    r += 2
    ws.cell(row=r, column=1, value="overlapping rules (priority)")
    for c, v in enumerate(values, start=2):
        ws.cell(row=r, column=c, value=v)
    ws.conditional_formatting.add(f"B{r}:I{r}", CellIsRule(operator="greaterThan", formula=["0"], fill=PatternFill(bgColor="FFC6EFCE"), stopIfTrue=False))
    ws.conditional_formatting.add(f"B{r}:I{r}", CellIsRule(operator="greaterThan", formula=["10"], fill=PatternFill(bgColor="FFFFC7CE")))
    ws.conditional_formatting.add(f"B{r}:I{r}", ColorScaleRule(start_type="min", start_color="FFFFFFFF", end_type="max", end_color="FF0070C0"))
    del numfmt
    ws.column_dimensions["A"].width = 28
    return save(wb, os.path.join(out, "gen-conditional-formatting.xlsx"))


def gen_validation(out: str) -> str:
    from openpyxl.workbook.defined_name import DefinedName
    from openpyxl.worksheet.datavalidation import DataValidation

    wb = new_workbook()
    ws = wb.active
    ws.title = "Validation"
    lists = wb.create_sheet("Lists")
    for i, v in enumerate(["Red", "Green", "Blue", "Yellow"], start=1):
        lists.cell(row=i, column=1, value=v)
    wb.defined_names["Colours"] = DefinedName("Colours", attr_text="Lists!$A$1:$A$4")
    header(ws, ["Rule", "Input"])
    dvs = [
        ("list inline", DataValidation(type="list", formula1='"Yes,No,Maybe"', allow_blank=True)),
        ("list range", DataValidation(type="list", formula1="Lists!$A$1:$A$4")),
        ("list defined name", DataValidation(type="list", formula1="Colours", showDropDown=False)),
        ("list hidden arrow", DataValidation(type="list", formula1='"a,b"', showDropDown=True)),
        ("whole between", DataValidation(type="whole", operator="between", formula1="1", formula2="10")),
        ("whole >=", DataValidation(type="whole", operator="greaterThanOrEqual", formula1="0")),
        ("decimal <", DataValidation(type="decimal", operator="lessThan", formula1="99.5")),
        ("date range", DataValidation(type="date", operator="between", formula1="DATE(2024,1,1)", formula2="DATE(2024,12,31)")),
        ("time >", DataValidation(type="time", operator="greaterThan", formula1="TIME(9,0,0)")),
        ("textLength <=", DataValidation(type="textLength", operator="lessThanOrEqual", formula1="5")),
        ("custom formula", DataValidation(type="custom", formula1="ISNUMBER(B13)")),
        ("any with prompt", DataValidation(type=None, showInputMessage=True, promptTitle="Hint", prompt="Type anything")),
        ("error style warning", DataValidation(type="whole", operator="equal", formula1="7", errorStyle="warning",
                                               showErrorMessage=True, errorTitle="Not seven", error="Are you sure?")),
        ("error style information", DataValidation(type="whole", operator="notEqual", formula1="0", errorStyle="information",
                                                   showErrorMessage=True, error="Zero is unusual")),
        ("stop with messages", DataValidation(type="decimal", operator="between", formula1="0", formula2="1",
                                              showErrorMessage=True, showInputMessage=True, errorTitle="Out of range",
                                              error="Enter 0..1", promptTitle="Probability", prompt="Between 0 and 1")),
    ]
    for r, (label, dv) in enumerate(dvs, start=2):
        ws.cell(row=r, column=1, value=label)
        ws.add_data_validation(dv)
        dv.add(f"B{r}")
    multi = DataValidation(type="list", formula1='"x,y"')
    ws.add_data_validation(multi)
    multi.add("D2:D5")
    multi.add("F2:F3")
    ws["D1"] = "multi-range list"
    ws.column_dimensions["A"].width = 24
    return save(wb, os.path.join(out, "gen-data-validation.xlsx"))


def gen_layout(out: str) -> str:
    from openpyxl.styles import Alignment, Font
    from openpyxl.worksheet.page import PageMargins

    wb = new_workbook()
    ws = wb.active
    ws.title = "Layout"
    for r in range(1, 41):
        for c in range(1, 13):
            ws.cell(row=r, column=c, value=r * 100 + c)
    ws.merge_cells("A1:D1")
    ws["A1"] = "Merged A1:D1 title"
    ws["A1"].alignment = Alignment(horizontal="center")
    ws["A1"].font = Font(bold=True, size=14)
    ws.merge_cells("F3:G6")
    ws.merge_cells("A8:A12")
    ws.merge_cells(start_row=14, start_column=2, end_row=14, end_column=12)
    ws.freeze_panes = "B3"
    ws.column_dimensions["A"].width = 6.5
    ws.column_dimensions["B"].width = 30
    ws.column_dimensions["C"].width = 0.5
    ws.column_dimensions["H"].hidden = True
    ws.row_dimensions[2].height = 40
    ws.row_dimensions[3].height = 5
    ws.row_dimensions[16].hidden = True
    ws.row_dimensions.group(20, 24, outline_level=1, hidden=False)
    ws.row_dimensions.group(22, 23, outline_level=2, hidden=True)
    ws.column_dimensions.group("I", "J", outline_level=1, hidden=True)
    ws.sheet_properties.outlinePr.summaryBelow = False
    ws.sheet_view.zoomScale = 85
    ws.sheet_properties.tabColor = "FF00B050"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_options.gridLines = True
    ws.print_options.horizontalCentered = True
    ws.page_margins = PageMargins(left=0.5, right=0.5, top=0.75, bottom=0.75, header=0.3, footer=0.3)
    ws.oddHeader.center.text = "&B&14Layout fixture"
    ws.oddFooter.right.text = "Page &P of &N"
    ws.oddFooter.left.text = "&D &T"
    ws.print_title_rows = "1:2"
    ws.print_area = "A1:L40"

    split = wb.create_sheet("FrozenRows")
    for r in range(1, 30):
        split.cell(row=r, column=1, value=f"row {r}")
    split.freeze_panes = "A4"
    split.sheet_view.showGridLines = False
    split.sheet_properties.tabColor = "FFFF0000"

    rtl = wb.create_sheet("RightToLeft")
    rtl["A1"] = "مرحبا"
    rtl["B1"] = "שלום"
    rtl.sheet_view.rightToLeft = True
    rtl.sheet_properties.tabColor = "FF7030A0"

    hidden = wb.create_sheet("HiddenSheet")
    hidden["A1"] = "hidden sheet"
    hidden.sheet_state = "hidden"
    vhidden = wb.create_sheet("VeryHiddenSheet")
    vhidden["A1"] = "very hidden sheet"
    vhidden.sheet_state = "veryHidden"

    prot = wb.create_sheet("Protected")
    prot["A1"] = "sheet protected with password 'pulpo'"
    prot.protection.sheet = True
    prot.protection.password = "pulpo"
    prot.protection.formatColumns = False
    prot.protection.sort = False
    prot.protection.autoFilter = False

    defaults = wb.create_sheet("Defaults")
    defaults.sheet_format.defaultRowHeight = 20
    defaults.sheet_format.customHeight = True
    defaults.sheet_format.defaultColWidth = 14
    defaults["A1"] = "custom default row height / column width"
    return save(wb, os.path.join(out, "gen-layout.xlsx"))


def gen_tables(out: str) -> str:
    from openpyxl.worksheet.table import Table, TableColumn, TableFormula, TableStyleInfo

    wb = new_workbook()
    ws = wb.active
    ws.title = "Tables"
    rows = [("Region", "Product", "Qty", "Price", "Total"),
            ("East", "Widget", 10, 2.5, None), ("West", "Gadget", 4, 10.0, None), ("East", "Gizmo", 7, 3.25, None),
            ("North", "Widget", 1, 2.5, None), ("West", "Widget", 12, 2.5, None)]
    for r, row in enumerate(rows, start=1):
        for c, v in enumerate(row, start=1):
            ws.cell(row=r, column=c, value=v)
        if r > 1:
            ws.cell(row=r, column=5, value="=Sales[[#This Row],[Qty]]*Sales[[#This Row],[Price]]")
    total_row = len(rows) + 1
    ws.cell(row=total_row, column=1, value="Total")
    ws.cell(row=total_row, column=3, value="=SUBTOTAL(109,Sales[Qty])")
    ws.cell(row=total_row, column=5, value="=SUBTOTAL(109,Sales[Total])")
    table = Table(displayName="Sales", ref=f"A1:E{total_row}", totalsRowCount=1)
    table.tableStyleInfo = TableStyleInfo(name="TableStyleMedium9", showRowStripes=True, showColumnStripes=False)
    table._initialise_columns()
    cols = table.tableColumns
    cols[0].totalsRowLabel = "Total"
    cols[2].totalsRowFunction = "sum"
    cols[4].totalsRowFunction = "sum"
    cols[4].calculatedColumnFormula = TableFormula(attr_text="Sales[[#This Row],[Qty]]*Sales[[#This Row],[Price]]")
    table.autoFilter.ref = f"A1:E{total_row - 1}"
    ws.add_table(table)
    ws["G1"] = "Structured refs"
    ws["G2"] = "=SUM(Sales[Total])"
    ws["G3"] = "=COUNTA(Sales[[#Headers],[Region]:[Qty]])"
    ws["G4"] = '=SUMIFS(Sales[Qty],Sales[Region],"East")'
    ws["G5"] = "=ROWS(Sales[#Data])"
    ws["G6"] = "=Sales[[#Totals],[Qty]]"

    ws2 = wb.create_sheet("Second")
    for r, row in enumerate([("Name", "Score"), ("ann", 90), ("bob", 72), ("cy", 85)], start=3):
        for c, v in enumerate(row, start=2):
            ws2.cell(row=r, column=c, value=v)
    t2 = Table(displayName="Scores", ref="B3:C6")
    t2.tableStyleInfo = TableStyleInfo(name="TableStyleLight1", showRowStripes=False, showFirstColumn=True)
    ws2.add_table(t2)
    ws2["E3"] = "=AVERAGE(Scores[Score])"
    ws2["E4"] = "=VLOOKUP(\"bob\",Scores,2,FALSE)"

    filt = wb.create_sheet("AutoFilter")
    data = [("City", "Region", "Sales", "Date")] + [
        (f"City{i}", ["East", "West", "North", "South"][i % 4], (i * 37) % 100, dt.date(2024, 1 + i % 12, 1 + i % 28))
        for i in range(1, 21)
    ]
    for r, row in enumerate(data, start=1):
        for c, v in enumerate(row, start=1):
            cell = filt.cell(row=r, column=c, value=v)
            if c == 4 and r > 1:
                cell.number_format = "yyyy-mm-dd"
    filt.auto_filter.ref = "A1:D21"
    filt.auto_filter.add_filter_column(1, ["East", "West"])
    filt.auto_filter.add_sort_condition("C2:C21", descending=True)
    for r, row in enumerate(data[1:], start=2):
        if row[1] not in ("East", "West"):
            filt.row_dimensions[r].hidden = True  # what Excel stores for filtered-out rows
    return save(wb, os.path.join(out, "gen-tables.xlsx"))


def gen_links_comments(out: str) -> str:
    from openpyxl.comments import Comment
    from openpyxl.worksheet.hyperlink import Hyperlink

    wb = new_workbook()
    ws = wb.active
    ws.title = "Links"
    other = wb.create_sheet("Other Sheet")
    other["C5"] = "target of internal link"
    ws["A1"] = "external URL"
    ws["B1"] = "https://example.com/path?q=1&r=2#frag"
    ws["B1"].hyperlink = "https://example.com/path?q=1&r=2#frag"
    ws["B1"].style = "Hyperlink"
    ws["A2"] = "mailto"
    ws["B2"] = "write to us"
    ws["B2"].hyperlink = "mailto:someone@example.com?subject=Hi"
    ws["B2"].style = "Hyperlink"
    ws["A3"] = "internal location"
    ws["B3"] = "jump"
    ws["B3"].hyperlink = Hyperlink(ref="B3", location="'Other Sheet'!C5", display="jump", tooltip="Go to other sheet")
    ws["B3"].style = "Hyperlink"
    ws["A4"] = "relative file"
    ws["B4"] = "sibling file"
    ws["B4"].hyperlink = "other.xlsx"
    ws["A5"] = "HYPERLINK() formula"
    ws["B5"] = '=HYPERLINK("https://example.org","example.org")'

    ws["A7"] = "comment (single line)"
    ws["B7"] = "has note"
    ws["B7"].comment = Comment("Plain note", "Alice")
    ws["A8"] = "comment (multi-line, sized)"
    ws["B8"] = "has note"
    c = Comment("Line one\nLine two\nLine three", "Bob", width=300, height=120)
    ws["B8"].comment = c
    ws["A9"] = "comment unicode"
    ws["B9"] = "ünïcödé"
    ws["B9"].comment = Comment("Ελληνικά — 日本語 — emoji 🎉", "Zoë")
    other["A1"] = "comment on another sheet"
    other["A1"].comment = Comment("Second sheet note", "Alice")
    ws.column_dimensions["A"].width = 28
    ws.column_dimensions["B"].width = 40
    return save(wb, os.path.join(out, "gen-links-comments.xlsx"))


def png_bytes(size=(64, 48)) -> bytes:
    from PIL import Image as PILImage, ImageDraw

    img = PILImage.new("RGB", size, (255, 255, 255))
    d = ImageDraw.Draw(img)
    d.rectangle([4, 4, size[0] - 5, size[1] - 5], outline=(68, 114, 196), width=3)
    d.ellipse([16, 10, 48, 38], fill=(255, 192, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def gen_image(out: str) -> str:
    from openpyxl.drawing.image import Image
    from openpyxl.drawing.spreadsheet_drawing import AnchorMarker, OneCellAnchor, TwoCellAnchor
    from openpyxl.drawing.xdr import XDRPositiveSize2D
    from openpyxl.utils.units import pixels_to_EMU

    wb = new_workbook()
    ws = wb.active
    ws.title = "Images"
    ws["A1"] = "one-cell anchored PNG at B2"
    img = Image(io.BytesIO(png_bytes()))
    img.anchor = "B2"
    ws.add_image(img)

    ws["A10"] = "two-cell anchored PNG D10:F14"
    img2 = Image(io.BytesIO(png_bytes((96, 64))))
    img2.anchor = TwoCellAnchor(_from=AnchorMarker(col=3, row=9, colOff=pixels_to_EMU(4), rowOff=pixels_to_EMU(2)),
                                to=AnchorMarker(col=6, row=14), editAs="oneCell")
    ws.add_image(img2)

    ws["A20"] = "oneCellAnchor with explicit ext"
    img3 = Image(io.BytesIO(png_bytes((32, 32))))
    img3.anchor = OneCellAnchor(_from=AnchorMarker(col=1, row=20), ext=XDRPositiveSize2D(pixels_to_EMU(32), pixels_to_EMU(32)))
    ws.add_image(img3)
    return save(wb, os.path.join(out, "gen-image.xlsx"))


def gen_charts(out: str) -> str:
    from openpyxl.chart import AreaChart, BarChart, DoughnutChart, LineChart, PieChart, Reference, ScatterChart, Series
    from openpyxl.chart.shapes import GraphicalProperties

    wb = new_workbook()
    ws = wb.active
    ws.title = "ChartData"
    rows = [("Month", "Sales", "Costs", "Margin %"), ("Jan", 120, 80, 0.33), ("Feb", 150, 95, 0.37), ("Mar", 90, 70, 0.22),
            ("Apr", 180, 110, 0.39), ("May", 210, 120, 0.43), ("Jun", 160, 100, 0.38)]
    for r, row in enumerate(rows, start=1):
        for c, v in enumerate(row, start=1):
            ws.cell(row=r, column=c, value=v)
    cats = Reference(ws, min_col=1, min_row=2, max_row=7)
    data = Reference(ws, min_col=2, min_row=1, max_col=3, max_row=7)

    def place(chart, anchor, title):
        chart.title = title
        chart.width, chart.height = 12, 7
        ws.add_chart(chart, anchor)

    col = BarChart()
    col.type = "col"
    col.add_data(data, titles_from_data=True)
    col.set_categories(cats)
    col.y_axis.title = "USD"
    col.x_axis.title = "Month"
    place(col, "F2", "Column (clustered)")

    bar = BarChart()
    bar.type = "bar"
    bar.grouping = "stacked"
    bar.overlap = 100
    bar.add_data(data, titles_from_data=True)
    bar.set_categories(cats)
    place(bar, "N2", "Bar (stacked)")

    line = LineChart()
    line.add_data(data, titles_from_data=True)
    line.set_categories(cats)
    line.series[0].marker.symbol = "circle"
    line.series[1].smooth = True
    place(line, "F18", "Line")

    area = AreaChart()
    area.grouping = "percentStacked"
    area.add_data(data, titles_from_data=True)
    area.set_categories(cats)
    place(area, "N18", "Area (100% stacked)")

    pie = PieChart()
    pie.add_data(Reference(ws, min_col=2, min_row=1, max_row=7), titles_from_data=True)
    pie.set_categories(cats)
    place(pie, "F34", "Pie")

    dough = DoughnutChart()
    dough.holeSize = 50
    dough.add_data(Reference(ws, min_col=3, min_row=1, max_row=7), titles_from_data=True)
    dough.set_categories(cats)
    place(dough, "N34", "Doughnut")

    scatter = ScatterChart()
    scatter.style = 13
    xs = Reference(ws, min_col=2, min_row=2, max_row=7)
    ys = Reference(ws, min_col=3, min_row=2, max_row=7)
    s = Series(ys, xs, title="Costs vs Sales")
    s.marker.symbol = "triangle"
    s.marker.size = 8
    s.marker.graphicalProperties = GraphicalProperties(solidFill="4472C4")
    s.marker.graphicalProperties.line.solidFill = "4472C4"
    s.graphicalProperties.line.noFill = True
    scatter.series.append(s)
    scatter.x_axis.title = "Sales"
    scatter.y_axis.title = "Costs"
    place(scatter, "F50", "Scatter")

    combo_bar = BarChart()
    combo_bar.add_data(data, titles_from_data=True)
    combo_bar.set_categories(cats)
    combo_line = LineChart()
    combo_line.add_data(Reference(ws, min_col=4, min_row=1, max_row=7), titles_from_data=True)
    combo_line.y_axis.axId = 200
    combo_line.y_axis.title = "Margin"
    combo_line.y_axis.number_format = "0%"
    combo_line.y_axis.crosses = "max"
    combo_bar += combo_line
    place(combo_bar, "N50", "Combo (bar + line, secondary axis)")

    cs = wb.create_chartsheet("ChartSheet")
    sheet_chart = BarChart()
    sheet_chart.add_data(data, titles_from_data=True)
    sheet_chart.set_categories(cats)
    sheet_chart.title = "Chart sheet"
    cs.add_chart(sheet_chart)
    return save(wb, os.path.join(out, "gen-charts.xlsx"))


def gen_multisheet(out: str) -> str:
    from openpyxl.workbook.defined_name import DefinedName
    from openpyxl.workbook.protection import WorkbookProtection

    wb = new_workbook()
    names = ["Summary", "Q1 Data", "It's quoted", "Ünïcödé 表", "2024", "A-B", "Hidden", "Last"]
    ws = wb.active
    ws.title = names[0]
    for n in names[1:]:
        wb.create_sheet(n)
    colours = ["FF4472C4", "FFED7D31", "FFA5A5A5", "FFFFC000", "FF5B9BD5", "FF70AD47", None, "FF264478"]
    for i, n in enumerate(names):
        sh = wb[n]
        sh["A1"] = f"sheet {i}: {n}"
        sh["B1"] = (i + 1) * 10
        if colours[i]:
            sh.sheet_properties.tabColor = colours[i]
    wb["Hidden"].sheet_state = "hidden"
    s = wb["Summary"]
    s["A3"] = "refs to every sheet"
    for i, n in enumerate(names[1:], start=4):
        quoted = "'" + n.replace("'", "''") + "'"
        s.cell(row=i, column=1, value=n)
        s.cell(row=i, column=2, value=f"={quoted}!B1")
    s["A13"] = "3D sum"
    s["B13"] = "=SUM('Q1 Data:Last'!B1)"
    wb.defined_names["GlobalTotal"] = DefinedName("GlobalTotal", attr_text="Summary!$B$13")
    wb.defined_names["QuotedRef"] = DefinedName("QuotedRef", attr_text="'It''s quoted'!$B$1")
    wb.defined_names["HiddenName"] = DefinedName("HiddenName", attr_text="Hidden!$B$1", hidden=True)
    wb["Q1 Data"].defined_names["LocalRate"] = DefinedName("LocalRate", attr_text="'Q1 Data'!$B$1")
    wb["2024"].defined_names["LocalRate"] = DefinedName("LocalRate", attr_text="'2024'!$B$1")
    s["A14"] = "names"
    s["B14"] = "=GlobalTotal+QuotedRef+HiddenName"
    wb.active = 1
    wb.security = WorkbookProtection(lockStructure=True)
    return save(wb, os.path.join(out, "gen-multisheet.xlsx"))


def gen_template(out: str) -> list[str]:
    wb = new_workbook()
    ws = wb.active
    ws.title = "Template"
    ws["A1"] = "Invoice template"
    ws["A3"], ws["B3"] = "Qty", "Price"
    ws["C4"] = "=A4*B4"
    wb.template = True
    path = save(wb, os.path.join(out, "gen-template.xltx"))
    return [path]


GENERATORS = [gen_formulas, gen_values, gen_1904, gen_styles, gen_conditional, gen_validation, gen_layout,
              gen_tables, gen_links_comments, gen_image, gen_charts, gen_multisheet, gen_template]


# ---------------------------------------------------------------------------
# CSV / TSV


CSV_SAMPLE_ROWS = [
    ["id", "name", "city", "amount", "date", "note"],
    ["1", "Zoë", "Zürich", "1234.50", "2024-01-15", "plain"],
    ["2", "José", "São Paulo", "-17", "2024-02-29", "accents"],
    ["3", "李雷", "北京", "0.1", "2023-12-31", "CJK"],
    ["4", "Emoji", "🌍", "1e3", "2024-06-30", "astral plane"],
]


def csv_line(fields, delim=",", quote_all=False):
    out = []
    for f in fields:
        needs = quote_all or any(ch in f for ch in (delim, '"', "\n", "\r")) or f != f.strip()
        out.append('"' + f.replace('"', '""') + '"' if needs else f)
    return delim.join(out)


def write_bytes(path: str, data: bytes) -> str:
    with open(path, "wb") as fh:
        fh.write(data)
    return path


def gen_csv(out: str) -> list[str]:
    paths = []
    lf = "\n".join(csv_line(r) for r in CSV_SAMPLE_ROWS) + "\n"
    paths.append(write_bytes(os.path.join(out, "utf8-lf.csv"), lf.encode("utf-8")))
    crlf = "\r\n".join(csv_line(r) for r in CSV_SAMPLE_ROWS) + "\r\n"
    paths.append(write_bytes(os.path.join(out, "utf8-bom-crlf.csv"), b"\xef\xbb\xbf" + crlf.encode("utf-8")))
    cr = "\r".join(csv_line(r) for r in CSV_SAMPLE_ROWS) + "\r"
    paths.append(write_bytes(os.path.join(out, "utf8-cr.csv"), cr.encode("utf-8")))
    paths.append(write_bytes(os.path.join(out, "utf8-no-trailing-newline.csv"), lf.rstrip("\n").encode("utf-8")))
    paths.append(write_bytes(os.path.join(out, "utf16le-bom.csv"), b"\xff\xfe" + crlf.encode("utf-16-le")))
    tab_crlf = "\r\n".join(csv_line(r, "\t") for r in CSV_SAMPLE_ROWS) + "\r\n"
    paths.append(write_bytes(os.path.join(out, "utf16le-bom-excel-unicode-text.txt"), b"\xff\xfe" + tab_crlf.encode("utf-16-le")))
    paths.append(write_bytes(os.path.join(out, "tab-delimited.tsv"), ("\n".join(csv_line(r, "\t") for r in CSV_SAMPLE_ROWS) + "\n").encode("utf-8")))

    quoted_rows = [
        ["field", "value"],
        ["comma", "a,b,c"],
        ["quote", 'she said "hi"'],
        ["only quotes", '""'],
        ["newline LF", "line1\nline2"],
        ["newline CRLF", "line1\r\nline2"],
        ["padded", "  spaces  "],
        ["quoted empty", ""],
    ]
    text = "\r\n".join(csv_line(r) for r in quoted_rows[:-1]) + '\r\nquoted empty,""\r\nunquoted empty,\r\n'
    text += '"quoted, then text"x,next\r\n'  # malformed: text after closing quote
    paths.append(write_bytes(os.path.join(out, "quoted-fields.csv"), text.encode("utf-8")))

    ragged = "a,b,c\n1,2\n1,2,3,4,5\n\n1\n,,,\n"
    paths.append(write_bytes(os.path.join(out, "ragged-rows.csv"), ragged.encode("utf-8")))
    trailing = "a,b,c,d\n1,2,,\n3,,,\n,,,\n\n\n"
    paths.append(write_bytes(os.path.join(out, "trailing-empty-fields.csv"), trailing.encode("utf-8")))

    euro = "Artikel;Preis;Menge;Datum\r\nKäse;1,50;3;15.01.2024\r\nBrot;2,99;1;29.02.2024\r\n\"Wein; rot\";12,00;2;31.12.2023\r\nSumme;1.234,56;6;\r\n"
    paths.append(write_bytes(os.path.join(out, "semicolon-european.csv"), euro.encode("utf-8")))

    cp1252 = "name,city,price\r\nCafé,Montréal,€4.50\r\nNaïve,Köln,£3\r\nFrançois,Málaga,“quoted”\r\n"
    paths.append(write_bytes(os.path.join(out, "windows-1252.csv"), cp1252.encode("cp1252")))

    paths.append(write_bytes(os.path.join(out, "header-only.csv"), b"id,name,amount\n"))
    paths.append(write_bytes(os.path.join(out, "empty.csv"), b""))

    long_field = "x" * 40000
    paths.append(write_bytes(os.path.join(out, "long-field.csv"), f"id,text\n1,{long_field}\n2,short\n".encode("utf-8")))

    types = ("value,kind\n00123,leading zeros\n12345678901234567890,20-digit integer\n1e5,scientific\n1E-3,scientific\n"
             "45%,percent\n$1,234.56,currency (unquoted comma!)\n\"$1,234.56\",currency quoted\n-0,negative zero\n"
             "TRUE,boolean\nfalse,boolean lowercase\n2024-02-29,ISO date\n02/03/2024,ambiguous date\n13:45,time\n"
             "#N/A,error literal\n NaN ,NaN padded\n=1+1,formula injection\n+cmd|' /C calc'!A0,DDE injection\n"
             "@SUM(1),at injection\n-2+3,minus injection\n")
    paths.append(write_bytes(os.path.join(out, "type-inference-and-injection.csv"), types.encode("utf-8")))
    return paths


# ---------------------------------------------------------------------------
# large (not committed)


def gen_large(out: str, rows: int = 50_000, cols: int = 10) -> list[str]:
    from openpyxl import Workbook
    from openpyxl.cell import WriteOnlyCell
    from openpyxl.styles import Font

    os.makedirs(out, exist_ok=True)
    wb = Workbook(write_only=True)
    wb.properties.created = FIXED_TIME
    ws = wb.create_sheet("Large")
    bold = Font(bold=True)
    head = []
    for c in range(cols):
        cell = WriteOnlyCell(ws, value=f"col{c + 1}")
        cell.font = bold
        head.append(cell)
    ws.append(head)
    base = dt.date(2020, 1, 1)
    for r in range(2, rows + 2):
        row = []
        for c in range(cols):
            k = c % 5
            if k == 0:
                row.append(r * 7 % 1000 + c)
            elif k == 1:
                row.append(round((r * 31 % 10007) / 7.0, 4))
            elif k == 2:
                row.append(f"text-{r % 977}-{c}")
            elif k == 3:
                row.append(base + dt.timedelta(days=r % 1500))
            else:
                row.append(f"=A{r}*2+B{r}")
        ws.append(row)
    xlsx = os.path.join(out, f"gen-large-{rows // 1000}k.xlsx")
    wb.save(xlsx)
    normalize_zip(xlsx)

    csv_path = os.path.join(out, f"gen-large-{rows // 1000}k.csv")
    with open(csv_path, "w", encoding="utf-8", newline="") as fh:
        fh.write(",".join(f"col{c + 1}" for c in range(cols)) + "\n")
        for r in range(2, rows + 2):
            fh.write(",".join(str(r * 7 % 1000 + c) if c % 2 == 0 else f'"t,{r}-{c}"' for c in range(cols)) + "\n")
    return [xlsx, csv_path]


# ---------------------------------------------------------------------------
# LibreOffice round trips


LO_ROUNDTRIP = ["gen-formulas.xlsx", "gen-values.xlsx", "gen-1904.xlsx", "gen-tables.xlsx", "gen-conditional-formatting.xlsx"]


def libreoffice_roundtrip(generated_dir: str, out: str) -> list[str]:
    os.makedirs(out, exist_ok=True)
    produced = []
    for name in LO_ROUNDTRIP:
        src = os.path.join(generated_dir, name)
        with tempfile.TemporaryDirectory(prefix="lo-sheets-rt-") as tmp:
            proc = subprocess.run([os.path.join(HERE, "lo_convert.sh"), src, tmp, "xlsx"], capture_output=True, text=True)
            try:
                result = json.loads(proc.stdout)
            except ValueError:
                result = {"ok": False, "error": proc.stdout + proc.stderr}
            if not result.get("ok"):
                print(f"warn: LibreOffice round-trip of {name} failed: {result.get('error')}", file=sys.stderr)
                continue
            dst = os.path.join(out, name.replace(".xlsx", ".lo.xlsx"))
            shutil.copyfile(result["outputs"][0], dst)
            produced.append(dst)
    return produced


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=REPO_FIXTURES, help="fixtures root (generated/, csv/, libreoffice/ inside)")
    ap.add_argument("--libreoffice", action="store_true")
    ap.add_argument("--large", action="store_true")
    ap.add_argument("--large-only", action="store_true")
    ap.add_argument("--large-dir", default=os.path.expanduser("~/.cache/pulpo-sheets-corpus/generated"))
    ap.add_argument("--large-rows", type=int, default=50_000)
    args = ap.parse_args()

    written: list[str] = []
    if not args.large_only:
        gen_dir = os.path.join(args.out, "generated")
        csv_dir = os.path.join(args.out, "csv")
        os.makedirs(gen_dir, exist_ok=True)
        os.makedirs(csv_dir, exist_ok=True)
        for fn in GENERATORS:
            res = fn(gen_dir)
            written.extend(res if isinstance(res, list) else [res])
        written.extend(gen_csv(csv_dir))
        if args.libreoffice:
            written.extend(libreoffice_roundtrip(gen_dir, os.path.join(args.out, "libreoffice")))
    if args.large or args.large_only:
        written.extend(gen_large(args.large_dir, rows=args.large_rows))
    json.dump({"written": [{"path": p, "size": os.path.getsize(p)} for p in written]}, sys.stdout, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
