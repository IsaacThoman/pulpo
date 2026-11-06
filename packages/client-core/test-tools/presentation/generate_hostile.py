#!/usr/bin/env python3
"""Generates hostile / malformed presentation packages for robustness tests.

    python generate_hostile.py                  # writes fixtures/presentation/hostile/*
    python generate_hostile.py --extra DIR      # also writes large variants (not committed) into DIR

Every committed output stays well under 200 KB. None of these files is meant to
open successfully; tests assert the engine fails cleanly (typed error, bounded
memory and time) or degrades gracefully (missing parts rendered as placeholders).
See fixtures/presentation/README.md for what each file contains.
"""

from __future__ import annotations

import argparse
import io
import re
import struct
import sys
import zipfile
import zlib
from pathlib import Path

from pptx import Presentation
from pptx.util import Inches

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate_fixtures import FIXTURES, png_bytes, set_core  # noqa: E402

HOSTILE = FIXTURES / 'hostile'
P_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main'
A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'


# --------------------------------------------------------------------------- base packages


def base_deck(slides: int = 1, picture: bool = False) -> dict[str, bytes]:
    """A small valid deck as an ordered {name: bytes} map."""
    prs = Presentation()
    set_core(prs, 'Hostile base')
    for i in range(slides):
        s = prs.slides.add_slide(prs.slide_layouts[5])
        s.shapes.title.text = f'Slide {i + 1}'
        if picture:
            s.shapes.add_picture(io.BytesIO(png_bytes(32, 24, seed=i)), Inches(1), Inches(2), Inches(2), Inches(1.5))
    buf = io.BytesIO()
    prs.save(buf)
    z = zipfile.ZipFile(buf)
    return {n: z.read(n) for n in z.namelist()}


def write_parts(path: Path, parts: dict[str, bytes] | list[tuple[str, bytes]]) -> None:
    items = parts.items() if isinstance(parts, dict) else parts
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as out:
        for name, blob in items:
            zi = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            out.writestr(zi, blob)


def sub(blob: bytes, pattern: str, repl: str, count: int = 1) -> bytes:
    new, n = re.subn(pattern.encode(), repl.encode(), blob, count=count)
    if n == 0:
        raise ValueError(f'pattern not found: {pattern}')
    return new


def slide_xml(body: str, extra_root: str = '') -> bytes:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<p:sld xmlns:a="{A_NS}" xmlns:r="{R_NS}" xmlns:p="{P_NS}"{extra_root}><p:cSld><p:spTree>'
        '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
        '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
        f'{body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'
    ).encode()


def rels_xml(rels: list[tuple[str, str, str] | tuple[str, str, str, str]]) -> bytes:
    body = ''
    for r in rels:
        rid, typ, target = r[0], r[1], r[2]
        mode = f' TargetMode="{r[3]}"' if len(r) > 3 else ''
        body += f'<Relationship Id="{rid}" Type="{RT}/{typ}" Target="{target}"{mode}/>'
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + body + '</Relationships>').encode()


def sp(sid: int, name: str, x='914400', y='914400', cx='1828800', cy='914400', text='', rot='0', extra_xfrm='') -> str:
    txt = f'<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>{text}</a:t></a:r></a:p></p:txBody>' if text else ''
    return (
        f'<p:sp><p:nvSpPr><p:cNvPr id="{sid}" name="{name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
        f'<p:spPr><a:xfrm rot="{rot}"{extra_xfrm}><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
        f'<a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></p:spPr>{txt}</p:sp>'
    )


def pic(sid: int, name: str, rid: str, attr: str = 'r:embed') -> str:
    return (
        f'<p:pic><p:nvPicPr><p:cNvPr id="{sid}" name="{name}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>'
        f'<p:blipFill><a:blip {attr}="{rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
        f'<p:spPr><a:xfrm><a:off x="914400" y="1828800"/><a:ext cx="1828800" cy="1371600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'
    )


LAYOUT_REL = ('rId1', 'slideLayout', '../slideLayouts/slideLayout6.xml')


# --------------------------------------------------------------------------- raw zip writer (for bombs)


def deflate_raw(data: bytes) -> bytes:
    c = zlib.compressobj(9, zlib.DEFLATED, -15, 9)
    return c.compress(data) + c.flush()


def zeros_deflated(size: int) -> tuple[bytes, int]:
    c = zlib.compressobj(9, zlib.DEFLATED, -15, 9)
    chunk = bytes(1 << 20)
    out = []
    crc = 0
    left = size
    while left:
        n = min(left, len(chunk))
        out.append(c.compress(chunk[:n]))
        crc = zlib.crc32(chunk[:n], crc)
        left -= n
    out.append(c.flush())
    return b''.join(out), crc & 0xFFFFFFFF


class RawZip:
    """Minimal zip writer that lets central-directory entries lie or share data."""

    def __init__(self):
        self.buf = io.BytesIO()
        self.central: list[bytes] = []

    def local(self, name: str, data: bytes, crc: int, usize: int, method: int = 8) -> int:
        off = self.buf.tell()
        nb = name.encode()
        self.buf.write(struct.pack('<IHHHHHIIIHH', 0x04034B50, 20, 0, method, 0, 0x21, crc, len(data), usize, len(nb), 0) + nb + data)
        return off

    def cd(self, name: str, offset: int, csize: int, usize: int, crc: int, method: int = 8) -> None:
        nb = name.encode()
        self.central.append(struct.pack('<IHHHHHHIIIHHHHHII', 0x02014B50, 20, 20, 0, method, 0, 0x21, crc, csize, usize, len(nb), 0, 0, 0, 0, 0o644 << 16, offset) + nb)

    def add(self, name: str, data: bytes) -> None:
        comp = deflate_raw(data)
        crc = zlib.crc32(data) & 0xFFFFFFFF
        off = self.local(name, comp, crc, len(data))
        self.cd(name, off, len(comp), len(data), crc)

    def finish(self) -> bytes:
        start = self.buf.tell()
        for c in self.central:
            self.buf.write(c)
        size = self.buf.tell() - start
        n = len(self.central)
        self.buf.write(struct.pack('<IHHHHIIH', 0x06054B50, 0, 0, n, n, size, start, 0))
        return self.buf.getvalue()


def overlap_bomb(path: Path, copies: int, kernel_mb: int, understate: bool) -> None:
    """Valid deck plus `copies` central-directory entries sharing one deflate stream of zeros."""
    z = RawZip()
    for name, blob in base_deck().items():
        z.add(name, blob)
    usize = kernel_mb << 20
    data, crc = zeros_deflated(usize)
    declared = 1024 if understate else usize
    off = z.local('ppt/media/bomb00.bin', data, crc, declared)
    for i in range(copies):
        z.cd(f'ppt/media/bomb{i:02d}.bin', off, len(data), declared, crc)
    path.write_bytes(z.finish())


def declared_bomb(path: Path, declared: int) -> None:
    """A single entry whose headers claim `declared` bytes but whose data inflates to 16 bytes."""
    z = RawZip()
    for name, blob in base_deck().items():
        z.add(name, blob)
    payload = b'\0' * 16
    comp = deflate_raw(payload)
    crc = zlib.crc32(payload) & 0xFFFFFFFF
    off = z.local('ppt/media/huge.bin', comp, crc, declared)
    z.cd('ppt/media/huge.bin', off, len(comp), declared, crc)
    path.write_bytes(z.finish())


# --------------------------------------------------------------------------- hostile decks


def deep_nesting_groups(path: Path, depth: int = 100_000) -> None:
    parts = base_deck()
    open_g = '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="2" name="g"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>'
    body = open_g * depth + sp(3, 'leaf', text='deepest') + '</p:grpSp>' * depth
    parts['ppt/slides/slide1.xml'] = slide_xml(body)
    write_parts(path, parts)


def deep_nesting_xml(path: Path, depth: int = 100_000) -> None:
    parts = base_deck()
    nested = '<x:n>' * depth + '</x:n>' * depth
    ext = f'<p:extLst><p:ext uri="{{00000000-0000-0000-0000-000000000001}}"><x:root xmlns:x="urn:pulpo:hostile">{nested}</x:root></p:ext></p:extLst>'
    blob = slide_xml(sp(2, 'Text', text='The slide extLst holds 100k nested elements'))
    parts['ppt/slides/slide1.xml'] = blob.replace(b'</p:sld>', ext.encode() + b'</p:sld>')
    # Deep nesting inside text too: 100k nested a:p is invalid schema-wise but tests parsers
    write_parts(path, parts)


def xml_entities(path: Path) -> None:
    parts = base_deck(slides=2)
    lol = '<!DOCTYPE p:sld [<!ENTITY a "aaaaaaaaaa">' + ''.join(
        f'<!ENTITY {chr(98 + i)} "{("&" + chr(97 + i) + ";") * 10}">' for i in range(9)
    ) + ']>'
    s1 = slide_xml(sp(2, 'Laughs', text='&j;'))
    parts['ppt/slides/slide1.xml'] = s1.replace(b'standalone="yes"?>\n', b'standalone="yes"?>\n' + lol.encode() + b'\n')
    xxe = '<!DOCTYPE p:sld [<!ENTITY xxe SYSTEM "file:///etc/passwd"><!ENTITY remote SYSTEM "http://127.0.0.1:9/pulpo-xxe">]>'
    s2 = slide_xml(sp(2, 'XXE', text='&xxe;&remote;'))
    parts['ppt/slides/slide2.xml'] = s2.replace(b'standalone="yes"?>\n', b'standalone="yes"?>\n' + xxe.encode() + b'\n')
    write_parts(path, parts)


def missing_parts(path: Path) -> None:
    parts = base_deck(slides=3, picture=True)
    # slide1: picture rel targets a part that is not in the package
    parts['ppt/slides/_rels/slide1.xml.rels'] = sub(parts['ppt/slides/_rels/slide1.xml.rels'], r'Target="\.\./media/image1\.png"', 'Target="../media/missing.png"')
    # slide2: no layout relationship at all, and a picture whose r:embed id is not defined
    parts['ppt/slides/_rels/slide2.xml.rels'] = rels_xml([])
    parts['ppt/slides/slide2.xml'] = slide_xml(sp(2, 'No layout', text='slide without layout rel') + pic(3, 'Dangling rId', 'rId42'))
    # slide3's notes part is referenced but missing; chart frame points at a missing chart
    parts['ppt/slides/_rels/slide3.xml.rels'] = rels_xml([LAYOUT_REL, ('rId2', 'notesSlide', '../notesSlides/notesSlide99.xml'), ('rId3', 'chart', '../charts/chart99.xml')])
    frame = (
        '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Missing chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>'
        '<p:xfrm><a:off x="914400" y="914400"/><a:ext cx="3657600" cy="2743200"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">'
        '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId3"/></a:graphicData></a:graphic></p:graphicFrame>'
    )
    parts['ppt/slides/slide3.xml'] = slide_xml(sp(2, 'Missing notes + chart', text='missing notes and chart parts') + frame)
    # presentation lists a fourth slide whose relationship id does not exist, and a fifth whose part is missing
    pres = parts['ppt/presentation.xml']
    pres = sub(pres, r'</p:sldIdLst>', '<p:sldId id="900" r:id="rId900"/><p:sldId id="901" r:id="rId901"/></p:sldIdLst>')
    parts['ppt/presentation.xml'] = pres
    prels = parts['ppt/_rels/presentation.xml.rels']
    parts['ppt/_rels/presentation.xml.rels'] = prels.replace(b'</Relationships>', f'<Relationship Id="rId901" Type="{RT}/slide" Target="slides/slide99.xml"/></Relationships>'.encode())
    # content type override for a part that does not exist
    ct = parts['[Content_Types].xml']
    parts['[Content_Types].xml'] = ct.replace(b'</Types>', b'<Override PartName="/ppt/slides/slide99.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>')
    write_parts(path, parts)


def rels_traversal(path: Path) -> None:
    parts = base_deck(slides=1, picture=True)
    rels = [
        LAYOUT_REL,
        ('rId2', 'image', '../media/image1.png'),
        ('rId3', 'image', '../../../etc/passwd'),
        ('rId4', 'image', '/etc/passwd'),
        ('rId5', 'image', '../../../../../../../../../../etc/hosts'),
        ('rId6', 'image', 'file:///etc/passwd', 'External'),
        ('rId7', 'hyperlink', 'javascript:alert(1)', 'External'),
        ('rId8', 'image', '..\\..\\..\\windows\\win.ini'),
        ('rId9', 'image', 'http://127.0.0.1:9/pulpo-ssrf.png', 'External'),
        ('rId10', 'image', '%2e%2e/%2e%2e/%2e%2e/etc/passwd'),
    ]
    parts['ppt/slides/_rels/slide1.xml.rels'] = rels_xml(rels)
    body = (
        pic(3, 'Valid image', 'rId2')
        + pic(4, 'Parent traversal', 'rId3')
        + pic(5, 'Absolute part name', 'rId4')
        + pic(6, 'Deep traversal', 'rId5')
        + pic(7, 'External file link', 'rId6', 'r:link')
        + pic(8, 'Backslash traversal', 'rId8')
        + pic(9, 'External http link', 'rId9', 'r:link')
        + pic(10, 'Percent-encoded traversal', 'rId10')
        + '<p:sp><p:nvSpPr><p:cNvPr id="11" name="JS link"><a:hlinkClick r:id="rId7"/></p:cNvPr><p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
        '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>'
        '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"><a:hlinkClick r:id="rId7"/></a:rPr><a:t>click</a:t></a:r></a:p></p:txBody></p:sp>'
    )
    parts['ppt/slides/slide1.xml'] = slide_xml(body)
    # A zip entry whose own name escapes the package root ("zip slip")
    items = list(parts.items()) + [('../../pulpo-zip-slip.txt', b'zip slip'), ('/tmp/pulpo-absolute-entry.txt', b'absolute entry name')]
    write_parts(path, items)


def cyclic_refs(path: Path) -> None:
    parts = base_deck(slides=2)
    # slide1: a SmartArt frame whose data/layout/style/color rels all point back to the slide itself,
    # and a picture whose image rel is the slide part
    parts['ppt/slides/_rels/slide1.xml.rels'] = rels_xml([
        LAYOUT_REL,
        ('rId2', 'diagramData', 'slide1.xml'), ('rId3', 'diagramLayout', 'slide1.xml'),
        ('rId4', 'diagramQuickStyle', 'slide1.xml'), ('rId5', 'diagramColors', 'slide1.xml'),
        ('rId6', 'image', 'slide1.xml'), ('rId7', 'slide', 'slide2.xml'),
    ])
    dgm = (
        '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Self-referencing SmartArt"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>'
        '<p:xfrm><a:off x="914400" y="914400"/><a:ext cx="3657600" cy="2743200"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram">'
        '<dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="rId2" r:lo="rId3" r:qs="rId4" r:cs="rId5"/></a:graphicData></a:graphic></p:graphicFrame>'
    )
    # group whose child reuses the group's id, nested groups with identical ids
    grp = (
        '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="5" name="Group A"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>'
        '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="5" name="Group A (same id)"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>'
        + sp(5, 'Child with group id', text='same id as ancestors') + '</p:grpSp></p:grpSp>'
    )
    # connector glued to itself and an animation targeting the group
    cxn = (
        '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="6" name="Self-glued connector"/><p:cNvCxnSpPr><a:stCxn id="6" idx="0"/><a:endCxn id="6" idx="1"/></p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr>'
        '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom></p:spPr></p:cxnSp>'
    )
    parts['ppt/slides/slide1.xml'] = slide_xml(sp(2, 'Title', text='cyclic references') + dgm + pic(3, 'Image is the slide', 'rId6') + grp + cxn)
    # slide2: its layout relationship points at slide2 itself
    parts['ppt/slides/_rels/slide2.xml.rels'] = rels_xml([('rId1', 'slideLayout', 'slide2.xml'), ('rId2', 'slide', 'slide1.xml')])
    # layout 1 -> "master" layout 2 -> "master" layout 1 (never reaches a real master)
    parts['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = rels_xml([('rId1', 'slideMaster', 'slideLayout2.xml')])
    parts['ppt/slideLayouts/_rels/slideLayout2.xml.rels'] = rels_xml([('rId1', 'slideMaster', 'slideLayout1.xml')])
    # slide 2's sibling uses layout 1 (cyclic chain)
    write_parts(path, parts)


def huge_values(path: Path) -> None:
    parts = base_deck(slides=2)
    pres = parts['ppt/presentation.xml']
    pres = sub(pres, r'<p:sldSz [^>]*/>', '<p:sldSz cx="2147483647" cy="2147483647"/>')
    pres = sub(pres, r'<p:notesSz [^>]*/>', '<p:notesSz cx="-1" cy="99999999999999999999"/>')
    parts['ppt/presentation.xml'] = pres
    body = (
        sp(2, 'Int32 max ext', x='0', y='0', cx='2147483647', cy='2147483647', text='int32 max')
        + sp(3, 'Int64 overflow', x='-9223372036854775808', y='9223372036854775807', cx='99999999999999999999', cy='1e308', text='overflow')
        + sp(4, 'Negative ext', x='914400', y='914400', cx='-1828800', cy='-914400', text='negative size')
        + sp(5, 'Huge rotation', rot='2147483647', text='rot max')
        + sp(6, 'NaN', x='NaN', y='Infinity', cx='-0', cy='0x10', text='NaN')
        + sp(7, 'Huge font', text='x').replace('<a:rPr lang="en-US"/>', '<a:rPr lang="en-US" sz="400000" spc="-400000" kern="999999999" baseline="2147483647"/>')
        + sp(8, 'Huge scaled child space', text='chExt 1').replace('<a:xfrm rot="0">', '<a:xfrm rot="0" flipH="2">')
    )
    grp = (
        '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="9" name="Group with zero chExt"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
        '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="6858000"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
        + sp(10, 'Child of zero chExt', text='divide by zero?') + '</p:grpSp>'
        '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="11" name="Group with 1-EMU chExt"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
        '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2147483647" cy="2147483647"/><a:chOff x="0" y="0"/><a:chExt cx="1" cy="1"/></a:xfrm></p:grpSpPr>'
        + sp(12, 'Child scaled 2^31', cx='914400', cy='914400', text='scaled') + '</p:grpSp>'
    )
    parts['ppt/slides/slide1.xml'] = slide_xml(body + grp)
    # slide2: a table with 1000 columns of 1 EMU and a 2^31 row height, plus a custGeom with a huge path
    cols = ''.join('<a:gridCol w="1"/>' for _ in range(1000))
    cells = ''.join('<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></a:txBody><a:tcPr/></a:tc>' for _ in range(1000))
    tbl = (
        '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="Wide table"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>'
        '<p:xfrm><a:off x="0" y="0"/><a:ext cx="1000" cy="2147483647"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">'
        f'<a:tbl><a:tblPr/><a:tblGrid>{cols}</a:tblGrid><a:tr h="2147483647">{cells}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>'
    )
    pts = ''.join(f'<a:lnTo><a:pt x="{(i * 7919) % 2147483647}" y="{(i * 104729) % 2147483647}"/></a:lnTo>' for i in range(2000))
    cust = (
        '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Huge path"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="6858000"/></a:xfrm>'
        f'<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="2147483647" h="1"><a:moveTo><a:pt x="0" y="0"/></a:moveTo>{pts}<a:close/></a:path>'
        '<a:path w="0" h="0"><a:moveTo><a:pt x="1" y="1"/></a:moveTo><a:arcTo wR="2147483647" hR="2147483647" stAng="0" swAng="2147483647"/></a:path></a:pathLst></a:custGeom></p:spPr></p:sp>'
    )
    parts['ppt/slides/slide2.xml'] = slide_xml(tbl + cust)
    write_parts(path, parts)


def duplicate_ids(path: Path) -> None:
    parts = base_deck(slides=3)
    pres = parts['ppt/presentation.xml']
    ids = re.findall(rb'<p:sldId id="(\d+)" r:id="(rId\d+)"/>', pres)
    (_, r1), (_, r2), (_, r3) = ids
    new_list = (
        f'<p:sldIdLst><p:sldId id="256" r:id="{r1.decode()}"/><p:sldId id="256" r:id="{r2.decode()}"/>'
        f'<p:sldId id="258" r:id="{r3.decode()}"/><p:sldId id="259" r:id="{r3.decode()}"/><p:sldId id="12" r:id="{r1.decode()}"/></p:sldIdLst>'
    )
    parts['ppt/presentation.xml'] = sub(pres, r'<p:sldIdLst>.*?</p:sldIdLst>', new_list)
    # duplicate shape ids and duplicate relationship ids on slide 1
    parts['ppt/slides/slide1.xml'] = slide_xml(sp(2, 'A', text='id 2') + sp(2, 'B', y='2743200', text='also id 2') + sp(2, 'C', y='4572000', text='id 2 again'))
    parts['ppt/slides/_rels/slide1.xml.rels'] = rels_xml([LAYOUT_REL, ('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml')])
    write_parts(path, parts)


def duplicate_zip_entries(path: Path) -> None:
    parts = base_deck(slides=1)
    first = slide_xml(sp(2, 'First copy', text='first zip entry for slide1.xml'))
    second = slide_xml(sp(2, 'Second copy', text='second zip entry for slide1.xml'))
    items = []
    for name, blob in parts.items():
        if name == 'ppt/slides/slide1.xml':
            items.append((name, first))
            items.append((name, second))
            # OPC part names compare case-insensitively: this collides with slide1.xml
            items.append(('ppt/slides/SLIDE1.xml', slide_xml(sp(2, 'Upper-case name', text='case-variant part name'))))
        else:
            items.append((name, blob))
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        write_parts(path, items)


def missing_presentation(path: Path) -> None:
    parts = base_deck()
    del parts['ppt/presentation.xml']
    write_parts(path, parts)


def missing_content_types(path: Path) -> None:
    parts = base_deck()
    del parts['[Content_Types].xml']
    write_parts(path, parts)


def wrong_main_type(path: Path) -> None:
    """A Word document's package relationship and content type wrapped in a .pptx name."""
    parts = base_deck()
    parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace(
        b'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
        b'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    )
    write_parts(path, parts)


def truncated(path: Path) -> None:
    buf = io.BytesIO()
    write_parts_buf = base_deck(slides=2)
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as out:
        for name, blob in write_parts_buf.items():
            out.writestr(zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0)), blob, compress_type=zipfile.ZIP_DEFLATED)
    data = buf.getvalue()
    path.write_bytes(data[: len(data) // 2])


def not_a_zip(path: Path) -> None:
    path.write_bytes(b'This is a plain text file renamed to .pptx.\n' + bytes(range(256)) * 4)


def encrypted(path: Path) -> str:
    """Password-encrypted (Agile) OOXML in a CFB container; password 'pulpo'."""
    buf = io.BytesIO()
    write_parts_buf = base_deck()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as out:
        for name, blob in write_parts_buf.items():
            out.writestr(zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0)), blob, compress_type=zipfile.ZIP_DEFLATED)
    try:
        from msoffcrypto.format.ooxml import OOXMLFile
    except ImportError:
        # Header-only stand-in: CFB magic followed by stream names an encrypted package would have
        cfb = bytes.fromhex('D0CF11E0A1B11AE1') + bytes(16) + struct.pack('<HHH', 0x3E, 3, 0xFFFE) + bytes(482)
        path.write_bytes(cfb + 'EncryptionInfo\0EncryptedPackage\0'.encode('utf-16-le'))
        return 'cfb-header-only'
    import tempfile
    with tempfile.NamedTemporaryFile(suffix='.pptx') as plain:
        plain.write(buf.getvalue())
        plain.flush()
        with open(plain.name, 'rb') as fin:
            f = OOXMLFile(fin)
            with open(path, 'wb') as out:
                f.encrypt('pulpo', out)
    return 'msoffcrypto-agile'


def legacy_ppt_header(path: Path) -> None:
    """CFB magic with a 'PowerPoint Document' stream name: what a renamed .ppt looks like."""
    cfb = bytes.fromhex('D0CF11E0A1B11AE1') + bytes(16) + struct.pack('<HHH', 0x3E, 3, 0xFFFE) + bytes(482)
    path.write_bytes(cfb + 'PowerPoint Document\0Current User\0'.encode('utf-16-le'))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', type=Path, default=HOSTILE)
    ap.add_argument('--extra', type=Path, help='also write large variants (not committed) here')
    args = ap.parse_args(argv)
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)
    overlap_bomb(out / 'zip-bomb-overlap.pptx', copies=12, kernel_mb=64, understate=False)
    overlap_bomb(out / 'zip-bomb-understated.pptx', copies=12, kernel_mb=64, understate=True)
    declared_bomb(out / 'zip-bomb-declared-size.pptx', declared=700 * 1024 * 1024)
    deep_nesting_groups(out / 'deep-nesting-groups.pptx')
    deep_nesting_xml(out / 'deep-nesting-xml.pptx')
    xml_entities(out / 'xml-entities.pptx')
    missing_parts(out / 'missing-parts.pptx')
    rels_traversal(out / 'rels-path-traversal.pptx')
    cyclic_refs(out / 'cyclic-references.pptx')
    huge_values(out / 'huge-values.pptx')
    duplicate_ids(out / 'duplicate-slide-ids.pptx')
    duplicate_zip_entries(out / 'duplicate-zip-entries.pptx')
    missing_presentation(out / 'missing-presentation-xml.pptx')
    missing_content_types(out / 'missing-content-types.pptx')
    wrong_main_type(out / 'wrong-main-content-type.pptx')
    truncated(out / 'truncated-zip.pptx')
    not_a_zip(out / 'not-a-zip.pptx')
    how = encrypted(out / 'encrypted-password-pulpo.pptx')
    legacy_ppt_header(out / 'legacy-ppt-renamed.pptx')
    for f in sorted(out.iterdir()):
        print(f'{f.stat().st_size:>8}  {f.name}')
    print('encrypted fixture via', how)
    if args.extra:
        args.extra.mkdir(parents=True, exist_ok=True)
        z = RawZip()
        for name, blob in base_deck().items():
            z.add(name, blob)
        empty = deflate_raw(b'')
        off = z.local('ppt/media/e.bin', empty, 0, 0)
        for i in range(20_000):
            z.cd(f'ppt/media/e{i:05d}.bin', off, len(empty), 0, 0)
        (args.extra / 'too-many-entries.pptx').write_bytes(z.finish())
        overlap_bomb(args.extra / 'zip-bomb-overlap-4gb.pptx', copies=64, kernel_mb=64, understate=False)
        print('wrote extra variants into', args.extra)
    return 0


if __name__ == '__main__':
    sys.exit(main())
