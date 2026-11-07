#!/usr/bin/env python3
"""Generates the python-pptx authored presentation fixtures.

Usage (run with the fidelity venv, see README.md):

    python generate_fixtures.py                       # writes fixtures/presentation/generated/*
    python generate_fixtures.py --libreoffice         # also re-saves two decks through LibreOffice
    python generate_fixtures.py --big 200 --big-out /tmp/big.pptx   # performance deck, not committed

Output is deterministic apart from the workbooks python-pptx embeds behind charts
(XlsxWriter stamps them with the current time). Zip entry timestamps and core
properties are pinned so unchanged decks produce identical package parts.
"""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from lxml import etree
from PIL import Image, ImageDraw
from pptx import Presentation
from pptx.chart.data import CategoryChartData, XyChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION, XL_LABEL_POSITION
from pptx.enum.dml import MSO_LINE_DASH_STYLE, MSO_PATTERN_TYPE, MSO_THEME_COLOR
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE, MSO_UNDERLINE, PP_ALIGN
from pptx.opc.constants import RELATIONSHIP_TYPE as RT
from pptx.opc.package import Part
from pptx.opc.packuri import PackURI
from pptx.oxml.ns import qn
from pptx.util import Emu, Inches, Pt

HERE = Path(__file__).resolve().parent
FIXTURES = HERE.parent.parent / 'fixtures' / 'presentation'
GENERATED = FIXTURES / 'generated'
LIBREOFFICE = FIXTURES / 'libreoffice'

FIXED_TIME = dt.datetime(2026, 1, 1, 12, 0, 0)
WIDE = (Emu(12192000), Emu(6858000))  # 16:9

NS = {
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'p14': 'http://schemas.microsoft.com/office/powerpoint/2010/main',
}


def xml(fragment: str):
    """Parses a fragment that may use the a:, p:, r: and p14: prefixes."""
    decls = ' '.join(f'xmlns:{k}="{v}"' for k, v in NS.items())
    wrapper = etree.fromstring(f'<root {decls}>{fragment}</root>')
    return wrapper[0]


# --------------------------------------------------------------------------- helpers


def new_presentation(wide: bool = True) -> Presentation:
    prs = Presentation()
    if wide:
        # python-pptx's default template is 4:3; stretch master/layout placeholders horizontally
        factor = WIDE[0] / prs.slide_width
        prs.slide_width, prs.slide_height = WIDE
        for master in prs.slide_masters:
            for shape in [*master.shapes, *(s for layout in master.slide_layouts for s in layout.shapes)]:
                for off in shape._element.xpath('./p:spPr/a:xfrm/a:off'):
                    off.set('x', str(round(int(off.get('x')) * factor)))
                for ext in shape._element.xpath('./p:spPr/a:xfrm/a:ext'):
                    ext.set('cx', str(round(int(ext.get('cx')) * factor)))
    return prs


def set_core(prs: Presentation, title: str) -> None:
    cp = prs.core_properties
    cp.title = title
    cp.author = 'Pulpo fixtures'
    cp.last_modified_by = 'generate_fixtures.py'
    cp.subject = 'Presentation engine test fixture'
    cp.keywords = 'pulpo; fixture'
    cp.revision = 1
    cp.created = FIXED_TIME
    cp.modified = FIXED_TIME
    cp.last_printed = FIXED_TIME


def save(prs: Presentation, path: Path, content_type: str | None = None) -> Path:
    """Saves with pinned zip timestamps; optionally swaps the main part content type (.potx)."""
    buf = io.BytesIO()
    prs.save(buf)
    rewrite_zip(buf.getvalue(), path, content_type)
    return path


def rewrite_zip(data: bytes, path: Path, content_type: str | None = None, patch=None) -> None:
    src = zipfile.ZipFile(io.BytesIO(data))
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as out:
        for info in src.infolist():
            blob = src.read(info.filename)
            if content_type and info.filename == '[Content_Types].xml':
                blob = re.sub(
                    rb'(PartName="/ppt/presentation.xml" ContentType=")[^"]+',
                    rb'\g<1>' + content_type.encode(),
                    blob,
                )
            if patch:
                blob = patch(info.filename, blob)
            zi = zipfile.ZipInfo(info.filename, date_time=(1980, 1, 1, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            out.writestr(zi, blob)


def png_bytes(width: int = 160, height: int = 120, seed: int = 0) -> bytes:
    """A small deterministic PNG with a gradient, a circle and an alpha corner."""
    img = Image.new('RGBA', (width, height))
    px = img.load()
    for y in range(height):
        for x in range(width):
            px[x, y] = ((x * 255) // width, (y * 255) // height, (seed * 60 + 120) % 256, 255)
    d = ImageDraw.Draw(img)
    d.ellipse((width * 0.25, height * 0.2, width * 0.75, height * 0.8), fill=(255, 255, 255, 255), outline=(0, 0, 0, 255), width=3)
    d.rectangle((0, 0, width // 6, height // 6), fill=(0, 0, 0, 0))
    d.line((0, height - 1, width - 1, 0), fill=(200, 0, 0, 255), width=2)
    out = io.BytesIO()
    img.save(out, 'PNG', optimize=True)
    return out.getvalue()


def blank(prs):
    return prs.slides.add_slide(prs.slide_layouts[6])


def titled(prs, title: str, layout: int = 5):
    s = prs.slides.add_slide(prs.slide_layouts[layout])
    s.shapes.title.text = title
    return s


def text_box(slide, x, y, w, h, text='', size=None):
    tb = slide.shapes.add_textbox(x, y, w, h)
    tb.text_frame.word_wrap = True
    if text:
        tb.text_frame.text = text
        if size:
            for r in tb.text_frame.paragraphs[0].runs:
                r.font.size = Pt(size)
    return tb


def set_bullet(paragraph, char: str | None = None, autonum: str | None = None, start: int | None = None, font: str | None = None, color: str | None = None):
    pPr = paragraph._p.get_or_add_pPr()
    for tag in ('a:buClr', 'a:buFont', 'a:buNone', 'a:buAutoNum', 'a:buChar', 'a:buBlip'):
        for el in pPr.findall(qn(tag)):
            pPr.remove(el)
    els = []
    if color:
        els.append(xml(f'<a:buClr><a:srgbClr val="{color}"/></a:buClr>'))
    if font:
        els.append(xml(f'<a:buFont typeface="{font}"/>'))
    if char:
        els.append(xml(f'<a:buChar char="{char}"/>'))
    elif autonum:
        attrs = f' startAt="{start}"' if start else ''
        els.append(xml(f'<a:buAutoNum type="{autonum}"{attrs}/>'))
    else:
        els.append(xml('<a:buNone/>'))
    for el in els:
        pPr.insert_element_before(el, 'a:tabLst', 'a:defRPr', 'a:extLst')
    pPr.set('marL', str(342900 + 342900 * paragraph.level))
    pPr.set('indent', '-342900')


def add_arrowheads(connector_or_shape, head: str | None = 'none', tail: str | None = 'triangle', w='med', length='med'):
    ln = connector_or_shape.line._get_or_add_ln()
    for tag in ('a:headEnd', 'a:tailEnd'):
        for el in ln.findall(qn(tag)):
            ln.remove(el)
    if head:
        ln.insert_element_before(xml(f'<a:headEnd type="{head}" w="{w}" len="{length}"/>'), 'a:extLst')
    if tail:
        ln.insert_element_before(xml(f'<a:tailEnd type="{tail}" w="{w}" len="{length}"/>'), 'a:extLst')


def set_flip(shape, h=False, v=False):
    xfrm = shape._element.xpath('./*[1]/a:xfrm')[0] if shape._element.xpath('./*[1]/a:xfrm') else None
    xfrm = xfrm if xfrm is not None else shape._element.xpath('.//a:xfrm')[0]
    if h:
        xfrm.set('flipH', '1')
    if v:
        xfrm.set('flipV', '1')


def add_transition(slide, fragment: str = '<p:fade/>', spd: str = 'med', advance_ms: int | None = None):
    attrs = f' spd="{spd}"'
    if advance_ms is not None:
        attrs += f' advTm="{advance_ms}"'
    el = xml(f'<p:transition{attrs}>{fragment}</p:transition>')
    sld = slide._element
    anchor = sld.find(qn('p:timing'))
    if anchor is None:
        anchor = sld.find(qn('p:extLst'))
    if anchor is not None:
        anchor.addprevious(el)
    else:
        sld.append(el)


def add_appear_animation(slide, shape_ids: list[int]):
    """Entrance 'Appear' on click for each shape, in order."""
    pars = []
    ctn = 3
    for spid in shape_ids:
        pars.append(
            f'<p:par><p:cTn id="{ctn}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>'
            f'<p:par><p:cTn id="{ctn + 1}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>'
            f'<p:par><p:cTn id="{ctn + 2}" presetID="1" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="clickEffect">'
            f'<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:set><p:cBhvr>'
            f'<p:cTn id="{ctn + 3}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>'
            f'<p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>'
            f'</p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set></p:childTnLst></p:cTn></p:par>'
            f'</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>'
        )
        ctn += 4
    bld = ''.join(f'<p:bldP spid="{spid}" grpId="0"/>' for spid in shape_ids)
    timing = xml(
        '<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>'
        '<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>'
        + ''.join(pars)
        + '</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>'
        '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>'
        f'</p:childTnLst></p:cTn></p:par></p:tnLst><p:bldLst>{bld}</p:bldLst></p:timing>'
    )
    sld = slide._element
    ext = sld.find(qn('p:extLst'))
    if ext is not None:
        ext.addprevious(timing)
    else:
        sld.append(timing)


def add_sections(prs, sections: list[tuple[str, list]]):
    """sections: [(name, [slide, ...])] written as a p14:sectionLst extension."""
    pres = prs.part._element
    ext_lst = pres.find(qn('p:extLst'))
    if ext_lst is None:
        ext_lst = etree.SubElement(pres, qn('p:extLst'))
    body = ''
    for i, (name, slides) in enumerate(sections):
        ids = ''.join(f'<p14:sldId id="{s.slide_id}"/>' for s in slides)
        body += f'<p14:section name="{name}" id="{{6B1C0D3A-0000-4000-8000-00000000000{i}}}"><p14:sldIdLst>{ids}</p14:sldIdLst></p14:section>'
    ext_lst.append(xml(f'<p:ext uri="{{521415D9-36F7-43E2-AB2F-B90AF26B5E84}}"><p14:sectionLst>{body}</p14:sectionLst></p:ext>'))


def add_legacy_comments(prs, slide, comments: list[tuple[int, str, int, int]], authors: list[tuple[int, str, str]]):
    """Legacy (pre-365) comments: commentAuthors.xml + comments/commentN.xml."""
    pkg = prs.part.package
    p = NS['p']
    authors_xml = (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:cmAuthorLst xmlns:p="{p}">'
        + ''.join(f'<p:cmAuthor id="{aid}" name="{name}" initials="{ini}" lastIdx="{sum(1 for c in comments if c[0] == aid)}" clrIdx="{aid}"/>' for aid, name, ini in authors)
        + '</p:cmAuthorLst>'
    ).encode()
    authors_part = Part(PackURI('/ppt/commentAuthors.xml'), 'application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml', pkg, authors_xml)
    prs.part.relate_to(authors_part, RT.COMMENT_AUTHORS)
    idx: dict[int, int] = {}
    cms = ''
    for aid, text, x, y in comments:
        idx[aid] = idx.get(aid, 0) + 1
        cms += f'<p:cm authorId="{aid}" dt="2026-01-01T12:0{idx[aid]}:00.000" idx="{idx[aid]}"><p:pos x="{x}" y="{y}"/><p:text>{text}</p:text></p:cm>'
    cm_xml = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:cmLst xmlns:p="{p}">{cms}</p:cmLst>'.encode()
    n = len([pt for pt in pkg.iter_parts() if str(pt.partname).startswith('/ppt/comments/')]) + 1
    cm_part = Part(PackURI(f'/ppt/comments/comment{n}.xml'), 'application/vnd.openxmlformats-officedocument.presentationml.comments+xml', pkg, cm_xml)
    slide.part.relate_to(cm_part, RT.COMMENTS)


def picture_fill(slide, shape, image: bytes, tile: bool = False):
    _, rid = slide.part.get_or_add_image_part(io.BytesIO(image))
    spPr = shape._element.spPr
    for tag in ('a:noFill', 'a:solidFill', 'a:gradFill', 'a:blipFill', 'a:pattFill', 'a:grpFill'):
        for el in spPr.findall(qn(tag)):
            spPr.remove(el)
    mode = '<a:tile tx="0" ty="0" sx="50000" sy="50000" flip="none" algn="tl"/>' if tile else '<a:stretch><a:fillRect/></a:stretch>'
    fill = xml(f'<a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="{rid}"/><a:srcRect/>{mode}</a:blipFill>')
    spPr.insert_element_before(fill, 'a:ln', 'a:effectLst', 'a:effectDag', 'a:scene3d', 'a:sp3d', 'a:extLst')


def path_gradient(shape, path: str, stops: list[tuple[int, str]]):
    spPr = shape._element.spPr
    for tag in ('a:noFill', 'a:solidFill', 'a:gradFill', 'a:blipFill', 'a:pattFill', 'a:grpFill'):
        for el in spPr.findall(qn(tag)):
            spPr.remove(el)
    gs = ''.join(f'<a:gs pos="{pos}"><a:srgbClr val="{c}"/></a:gs>' for pos, c in stops)
    fill = xml(f'<a:gradFill flip="none" rotWithShape="1"><a:gsLst>{gs}</a:gsLst><a:path path="{path}"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path><a:tileRect/></a:gradFill>')
    spPr.insert_element_before(fill, 'a:ln', 'a:effectLst', 'a:effectDag', 'a:scene3d', 'a:sp3d', 'a:extLst')


def set_notes(slide, text: str):
    slide.notes_slide.notes_text_frame.text = text


# --------------------------------------------------------------------------- decks


def deck_text_formatting(out: Path):
    prs = new_presentation()
    set_core(prs, 'Text formatting')

    s = prs.slides.add_slide(prs.slide_layouts[0])
    s.shapes.title.text = 'Text formatting'
    s.placeholders[1].text = 'Runs, paragraphs, bullets, links and spacing'
    set_notes(s, 'Title slide notes.\nSecond notes paragraph with unicode: café, 日本語, emoji 🐙.')

    # Character formatting
    s = titled(prs, 'Character formatting')
    tb = text_box(s, Inches(0.5), Inches(1.4), Inches(12), Inches(5.5))
    tf = tb.text_frame
    specs = [
        ('Calibri 18 regular', dict(name='Calibri', size=18)),
        ('Arial 24 bold', dict(name='Arial', size=24, bold=True)),
        ('Times New Roman 20 italic', dict(name='Times New Roman', size=20, italic=True)),
        ('Georgia 20 underline single', dict(name='Georgia', size=20, underline=True)),
        ('Verdana 16 double underline', dict(name='Verdana', size=16, underline=MSO_UNDERLINE.DOUBLE_LINE)),
        ('Courier New 16 strike', dict(name='Courier New', size=16, strike='sngStrike')),
        ('Tahoma 16 double strike', dict(name='Tahoma', size=16, strike='dblStrike')),
        ('Red 28 bold italic', dict(size=28, bold=True, italic=True, color='C00000')),
        ('Theme accent 2', dict(size=18, theme=MSO_THEME_COLOR.ACCENT_2)),
        ('Superscript', dict(size=18, baseline='30000')),
        ('Subscript', dict(size=18, baseline='-25000')),
        ('Small caps and spacing', dict(size=18, cap='small', spc='300')),
        ('ALL CAPS ATTRIBUTE', dict(size=18, cap='all')),
        ('Highlighted', dict(size=18, highlight='FFFF00')),
    ]
    first = True
    for text, f in specs:
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        r = p.add_run()
        r.text = text
        font = r.font
        if 'name' in f:
            font.name = f['name']
        font.size = Pt(f['size'])
        if f.get('bold'):
            font.bold = True
        if f.get('italic'):
            font.italic = True
        if 'underline' in f:
            font.underline = f['underline']
        if 'color' in f:
            font.color.rgb = RGBColor.from_string(f['color'])
        if 'theme' in f:
            font.color.theme_color = f['theme']
        rPr = r._r.get_or_add_rPr()
        for attr in ('strike', 'baseline', 'cap', 'spc'):
            if attr in f:
                rPr.set(attr, f[attr])
        if 'highlight' in f:
            rPr.insert_element_before(xml(f'<a:highlight><a:srgbClr val="{f["highlight"]}"/></a:highlight>'), 'a:uLnTx', 'a:uLn', 'a:uFillTx', 'a:uFill', 'a:latin', 'a:ea', 'a:cs', 'a:sym', 'a:hlinkClick', 'a:hlinkMouseOver', 'a:rtl', 'a:extLst')
    # mixed runs in one paragraph
    p = tf.add_paragraph()
    for text, bold, italic, color in [('Mixed ', False, False, None), ('bold ', True, False, None), ('italic ', False, True, None), ('blue', False, False, '0070C0')]:
        r = p.add_run()
        r.text = text
        r.font.bold = bold
        r.font.italic = italic
        if color:
            r.font.color.rgb = RGBColor.from_string(color)
    set_notes(s, 'Each line exercises one run property.')

    # Paragraph formatting
    s = titled(prs, 'Paragraph alignment and spacing')
    tb = text_box(s, Inches(0.5), Inches(1.4), Inches(6), Inches(5.5))
    tf = tb.text_frame
    for i, (label, align) in enumerate([('Left aligned', PP_ALIGN.LEFT), ('Centered', PP_ALIGN.CENTER), ('Right aligned', PP_ALIGN.RIGHT), ('Justified text that is long enough to wrap onto a second line so justification is visible in renderers.', PP_ALIGN.JUSTIFY), ('Distributed', PP_ALIGN.DISTRIBUTE)]):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = label
        p.alignment = align
    tb = text_box(s, Inches(6.8), Inches(1.4), Inches(6), Inches(5.5))
    tf = tb.text_frame
    for i, (label, ls, before, after) in enumerate([('Line spacing 1.0', 1.0, 0, 0), ('Line spacing 1.5 with a long line that wraps to show the spacing between wrapped lines', 1.5, 6, 6), ('Line spacing exactly 30pt', Pt(30), 0, 12), ('Space before 24pt', None, 24, 0), ('Space after 24pt', None, 0, 24), ('Double spacing wrapped line that also wraps across the box width', 2.0, 0, 0)]):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = label
        if ls is not None:
            p.line_spacing = ls
        if before:
            p.space_before = Pt(before)
        if after:
            p.space_after = Pt(after)

    # Levels and bullets
    s = prs.slides.add_slide(prs.slide_layouts[1])
    s.shapes.title.text = 'Bullets, numbering and levels'
    tf = s.placeholders[1].text_frame
    items = [(0, 'Level 0 placeholder bullet'), (1, 'Level 1 inherited bullet'), (2, 'Level 2 inherited bullet'), (3, 'Level 3'), (4, 'Level 4'), (0, 'Back to level 0')]
    for i, (lvl, text) in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = text
        p.level = lvl
    tb = text_box(s, Inches(7), Inches(1.6), Inches(5.8), Inches(5))
    tf = tb.text_frame
    rows = [
        (0, 'Custom bullet char', dict(char='▪', font='Arial', color='C00000')),
        (0, 'Arrow bullet', dict(char='➢', font='Wingdings')),
        (0, 'Numbered arabicPeriod', dict(autonum='arabicPeriod')),
        (0, 'Numbered arabicPeriod', dict(autonum='arabicPeriod')),
        (1, 'Nested alphaLcParenR', dict(autonum='alphaLcParenR')),
        (1, 'Nested alphaLcParenR', dict(autonum='alphaLcParenR')),
        (0, 'romanUcPeriod starting at 4', dict(autonum='romanUcPeriod', start=4)),
        (0, 'No bullet (buNone)', dict()),
    ]
    for i, (lvl, text, b) in enumerate(rows):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = text
        p.level = lvl
        set_bullet(p, **b)

    # Hyperlinks
    s = titled(prs, 'Hyperlinks')
    tb = text_box(s, Inches(0.5), Inches(1.5), Inches(12), Inches(3))
    tf = tb.text_frame
    p = tf.paragraphs[0]
    r = p.add_run()
    r.text = 'External link to example.com'
    r.hyperlink.address = 'https://example.com/path?q=1&x=2'
    p = tf.add_paragraph()
    r = p.add_run()
    r.text = 'mailto link'
    r.hyperlink.address = 'mailto:someone@example.com'
    p = tf.add_paragraph()
    r = p.add_run()
    r.text = 'Jump to first slide (internal)'
    first_slide = prs.slides[0]
    rid = s.part.relate_to(first_slide.part, RT.SLIDE)
    r._r.get_or_add_rPr().append(xml(f'<a:hlinkClick r:id="{rid}" action="ppaction://hlinksldjump"/>'))
    shape = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.5), Inches(4.8), Inches(3), Inches(1))
    shape.text = 'Shape with click link'
    shape.click_action.hyperlink.address = 'https://example.org/'

    # Anchoring, margins, wrap, autofit, vertical text
    s = titled(prs, 'Text frame properties')
    boxes = [
        ('Top anchored', MSO_ANCHOR.TOP), ('Middle anchored', MSO_ANCHOR.MIDDLE), ('Bottom anchored', MSO_ANCHOR.BOTTOM),
    ]
    for i, (label, anchor) in enumerate(boxes):
        sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.4 + i * 2.5), Inches(1.4), Inches(2.3), Inches(2.2))
        sh.text = label
        sh.text_frame.vertical_anchor = anchor
    sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(7.9), Inches(1.4), Inches(2.3), Inches(2.2))
    sh.text = 'Wide margins, no wrap: this line does not wrap'
    tf = sh.text_frame
    tf.word_wrap = False
    tf.margin_left = tf.margin_right = Inches(0.4)
    tf.margin_top = tf.margin_bottom = Inches(0.3)
    sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(10.5), Inches(1.4), Inches(1.2), Inches(2.2))
    sh.text = 'vert270 text'
    sh.text_frame._txBody.bodyPr.set('vert', 'vert270')
    sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(11.8), Inches(1.4), Inches(1.2), Inches(2.2))
    sh.text = '縦書きテキスト eaVert'
    sh.text_frame._txBody.bodyPr.set('vert', 'eaVert')
    # normAutofit with fontScale
    sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.4), Inches(4.0), Inches(4), Inches(1.6))
    tf = sh.text_frame
    tf.text = 'Shrink on overflow: ' + 'this text is too long for the box and PowerPoint scaled it. ' * 3
    for r in tf.paragraphs[0].runs:
        r.font.size = Pt(28)
    tf.auto_size = MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE
    tf._txBody.bodyPr.find(qn('a:normAutofit')).set('fontScale', '55000')
    tf._txBody.bodyPr.find(qn('a:normAutofit')).set('lnSpcReduction', '20000')
    sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(4.6), Inches(4.0), Inches(4), Inches(0.6))
    sh.text = 'spAutoFit: shape grows to fit text'
    sh.text_frame.auto_size = MSO_AUTO_SIZE.SHAPE_TO_FIT_TEXT
    sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(8.8), Inches(4.0), Inches(4), Inches(2))
    tf = sh.text_frame
    tf.text = 'Two columns of text in one body. ' * 6
    tf._txBody.bodyPr.set('numCol', '2')
    tf._txBody.bodyPr.set('spcCol', '182880')
    sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.4), Inches(5.9), Inches(8), Inches(0.9))
    sh.text = 'Right-to-left: مرحبا بالعالم'
    sh.text_frame.paragraphs[0]._p.get_or_add_pPr().set('rtl', '1')
    sh.text_frame.paragraphs[0].alignment = PP_ALIGN.RIGHT
    set_notes(s, 'Autofit: normAutofit fontScale=55% lnSpcReduction=20%.')

    save(prs, out)


def deck_autoshapes(out: Path):
    prs = new_presentation()
    set_core(prs, 'Autoshapes, fills and lines')
    image = png_bytes(seed=1)

    shapes = [
        MSO_SHAPE.RECTANGLE, MSO_SHAPE.ROUNDED_RECTANGLE, MSO_SHAPE.OVAL, MSO_SHAPE.ISOSCELES_TRIANGLE, MSO_SHAPE.RIGHT_TRIANGLE,
        MSO_SHAPE.DIAMOND, MSO_SHAPE.PARALLELOGRAM, MSO_SHAPE.TRAPEZOID, MSO_SHAPE.REGULAR_PENTAGON, MSO_SHAPE.HEXAGON,
        MSO_SHAPE.OCTAGON, MSO_SHAPE.CROSS, MSO_SHAPE.CAN, MSO_SHAPE.CUBE, MSO_SHAPE.DONUT,
        MSO_SHAPE.NO_SYMBOL, MSO_SHAPE.BLOCK_ARC, MSO_SHAPE.FOLDED_CORNER, MSO_SHAPE.SMILEY_FACE, MSO_SHAPE.HEART,
        MSO_SHAPE.LIGHTNING_BOLT, MSO_SHAPE.SUN, MSO_SHAPE.MOON, MSO_SHAPE.CLOUD, MSO_SHAPE.ARC,
        MSO_SHAPE.DOUBLE_BRACKET, MSO_SHAPE.LEFT_BRACE, MSO_SHAPE.PLAQUE, MSO_SHAPE.FRAME, MSO_SHAPE.TEAR,
        MSO_SHAPE.CHORD, MSO_SHAPE.PIE, MSO_SHAPE.ROUND_2_SAME_RECTANGLE, MSO_SHAPE.SNIP_1_RECTANGLE, MSO_SHAPE.DECAGON,
    ]
    arrows_etc = [
        MSO_SHAPE.RIGHT_ARROW, MSO_SHAPE.LEFT_ARROW, MSO_SHAPE.UP_ARROW, MSO_SHAPE.DOWN_ARROW, MSO_SHAPE.LEFT_RIGHT_ARROW,
        MSO_SHAPE.QUAD_ARROW, MSO_SHAPE.CHEVRON, MSO_SHAPE.PENTAGON, MSO_SHAPE.CURVED_RIGHT_ARROW, MSO_SHAPE.U_TURN_ARROW,
        MSO_SHAPE.NOTCHED_RIGHT_ARROW, MSO_SHAPE.STRIPED_RIGHT_ARROW, MSO_SHAPE.CIRCULAR_ARROW, MSO_SHAPE.RIGHT_ARROW_CALLOUT,
        MSO_SHAPE.STAR_4_POINT, MSO_SHAPE.STAR_5_POINT, MSO_SHAPE.STAR_8_POINT, MSO_SHAPE.STAR_16_POINT, MSO_SHAPE.EXPLOSION1,
        MSO_SHAPE.WAVE, MSO_SHAPE.DOUBLE_WAVE, MSO_SHAPE.UP_RIBBON, MSO_SHAPE.VERTICAL_SCROLL, MSO_SHAPE.HORIZONTAL_SCROLL,
        MSO_SHAPE.RECTANGULAR_CALLOUT, MSO_SHAPE.ROUNDED_RECTANGULAR_CALLOUT, MSO_SHAPE.OVAL_CALLOUT, MSO_SHAPE.CLOUD_CALLOUT,
        MSO_SHAPE.LINE_CALLOUT_1, MSO_SHAPE.LINE_CALLOUT_2_ACCENT_BAR, MSO_SHAPE.FLOWCHART_PROCESS, MSO_SHAPE.FLOWCHART_DECISION,
        MSO_SHAPE.FLOWCHART_DATA, MSO_SHAPE.FLOWCHART_DOCUMENT, MSO_SHAPE.FLOWCHART_TERMINATOR, MSO_SHAPE.FLOWCHART_MAGNETIC_DISK,
        MSO_SHAPE.ACTION_BUTTON_HOME, MSO_SHAPE.MATH_PLUS, MSO_SHAPE.MATH_EQUAL, MSO_SHAPE.GEAR_6,
    ]
    palette = ['4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '264478', '9E480E', '636363', '997300']
    for title, group in [('Basic shapes', shapes), ('Arrows, stars, callouts, flowchart', arrows_etc)]:
        s = titled(prs, title)
        cols = 8
        for i, kind in enumerate(group):
            x = Inches(0.3 + (i % cols) * 1.6)
            y = Inches(1.35 + (i // cols) * 1.2)
            sh = s.shapes.add_shape(kind, x, y, Inches(1.3), Inches(1.0))
            sh.fill.solid()
            sh.fill.fore_color.rgb = RGBColor.from_string(palette[i % len(palette)])
            sh.line.color.rgb = RGBColor(0x20, 0x20, 0x20)
            sh.line.width = Pt(1)
            sh.name = f'{kind.name.lower()}'
    # Adjustments on a few shapes
    s = titled(prs, 'Adjustment handles')
    for i, (kind, adj) in enumerate([(MSO_SHAPE.ROUNDED_RECTANGLE, [0.45]), (MSO_SHAPE.RIGHT_ARROW, [0.3, 0.7]), (MSO_SHAPE.DONUT, [0.1]), (MSO_SHAPE.STAR_5_POINT, [0.1]), (MSO_SHAPE.BLOCK_ARC, [90.0, 0.0, 0.3]), (MSO_SHAPE.CHEVRON, [0.8])]):
        sh = s.shapes.add_shape(kind, Inches(0.4 + i * 2.1), Inches(2), Inches(1.8), Inches(1.6))
        for j, v in enumerate(adj):
            sh.adjustments[j] = v

    # Fills
    s = titled(prs, 'Fills')
    y0 = Inches(1.4)
    sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.3), y0, Inches(2), Inches(1.5))
    sh.fill.solid()
    sh.fill.fore_color.rgb = RGBColor(0x22, 0x88, 0x44)
    sh.text = 'solid'
    sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(2.5), y0, Inches(2), Inches(1.5))
    sh.fill.solid()
    sh.fill.fore_color.theme_color = MSO_THEME_COLOR.ACCENT_1
    sh.fill.fore_color.brightness = 0.4
    sh.text = 'theme+lumMod'
    sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(4.7), y0, Inches(2), Inches(1.5))
    sh.fill.solid()
    sh.fill.fore_color.rgb = RGBColor(0xC0, 0x00, 0x00)
    sh.fill._xPr.find(qn('a:solidFill'))[0].append(xml('<a:alpha val="40000"/>'))
    sh.text = 'alpha 40%'
    sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(6.9), y0, Inches(2), Inches(1.5))
    sh.fill.gradient()
    sh.fill.gradient_angle = 45
    sh.fill.gradient_stops[0].color.rgb = RGBColor(0xFF, 0xFF, 0x00)
    sh.fill.gradient_stops[1].color.rgb = RGBColor(0x00, 0x66, 0xCC)
    sh.text = 'linear 45°'
    sh = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(9.1), y0, Inches(2), Inches(1.5))
    path_gradient(sh, 'circle', [(0, 'FFFFFF'), (50000, 'FF9900'), (100000, '660000')])
    sh.text = 'radial'
    sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(11.2), y0, Inches(1.9), Inches(1.5))
    path_gradient(sh, 'rect', [(0, '00FF00'), (100000, '003300')])
    sh.text = 'rect path'
    sh = s.shapes.add_shape(MSO_SHAPE.STAR_5_POINT, Inches(0.3), Inches(3.2), Inches(2), Inches(1.5))
    path_gradient(sh, 'shape', [(0, 'FFFFFF'), (100000, '7030A0')])
    patterns = [MSO_PATTERN_TYPE.CROSS, MSO_PATTERN_TYPE.DIAGONAL_BRICK, MSO_PATTERN_TYPE.PERCENT_25, MSO_PATTERN_TYPE.WIDE_UPWARD_DIAGONAL, MSO_PATTERN_TYPE.SMALL_CHECKER_BOARD]
    for i, pat in enumerate(patterns):
        sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(2.5 + i * 2.15), Inches(3.2), Inches(1.95), Inches(1.5))
        sh.fill.patterned()
        sh.fill.pattern = pat
        sh.fill.fore_color.rgb = RGBColor(0x1F, 0x4E, 0x79)
        sh.fill.back_color.rgb = RGBColor(0xDD, 0xEB, 0xF7)
        sh.text = pat.name.lower()
    sh = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.3), Inches(5.0), Inches(3), Inches(1.8))
    picture_fill(s, sh, image)
    sh.text = 'picture fill (stretch)'
    sh = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(3.5), Inches(5.0), Inches(3), Inches(1.8))
    picture_fill(s, sh, image, tile=True)
    sh.text = 'picture fill (tile)'
    sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(6.7), Inches(5.0), Inches(2.5), Inches(1.8))
    sh.fill.background()
    sh.text = 'no fill'
    sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(9.4), Inches(5.0), Inches(3.5), Inches(1.8))
    sh.text = 'default style (theme)'

    # Lines
    s = titled(prs, 'Lines and connectors')
    dashes = [MSO_LINE_DASH_STYLE.SOLID, MSO_LINE_DASH_STYLE.DASH, MSO_LINE_DASH_STYLE.ROUND_DOT, MSO_LINE_DASH_STYLE.DASH_DOT, MSO_LINE_DASH_STYLE.LONG_DASH_DOT, MSO_LINE_DASH_STYLE.SQUARE_DOT]
    for i, dash in enumerate(dashes):
        sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.3 + i * 2.15), Inches(1.4), Inches(1.9), Inches(1.0))
        sh.fill.background()
        sh.line.color.rgb = RGBColor.from_string(palette[i])
        sh.line.width = Pt(1 + i * 1.5)
        sh.line.dash_style = dash
        sh.text = f'{dash.name.lower()} {1 + i * 1.5}pt'
        sh.text_frame.paragraphs[0].runs[0].font.color.rgb = RGBColor(0, 0, 0)
    sh = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(0.3), Inches(2.7), Inches(1.9), Inches(1.0))
    sh.line.fill.background()
    sh.text = 'no line'
    sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(2.45), Inches(2.7), Inches(1.9), Inches(1.0))
    sh.line.width = Pt(6)
    sh.line.color.rgb = RGBColor(0x70, 0x30, 0xA0)
    ln = sh.line._get_or_add_ln()
    ln.set('cap', 'rnd')
    ln.set('cmpd', 'dbl')
    ln.insert_element_before(xml('<a:round/>'), 'a:headEnd', 'a:tailEnd', 'a:extLst')
    sh.text = 'double 6pt'
    # Connectors with arrowheads, glued to shapes
    a = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(1), Inches(4.3), Inches(1.8), Inches(1))
    a.text = 'A'
    b = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(5.5), Inches(5.6), Inches(1.8), Inches(1))
    b.text = 'B'
    c = s.shapes.add_shape(MSO_SHAPE.DIAMOND, Inches(9.5), Inches(4.0), Inches(1.8), Inches(1.4))
    c.text = 'C'
    con = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, 0, 0, 0, 0)
    con.begin_connect(a, 3)
    con.end_connect(b, 1)
    con.line.width = Pt(2)
    add_arrowheads(con, head='oval', tail='triangle')
    con = s.shapes.add_connector(MSO_CONNECTOR.ELBOW, 0, 0, 0, 0)
    con.begin_connect(b, 3)
    con.end_connect(c, 2)
    con.line.color.rgb = RGBColor(0xC0, 0, 0)
    add_arrowheads(con, head='diamond', tail='stealth', w='lg', length='lg')
    con = s.shapes.add_connector(MSO_CONNECTOR.CURVE, 0, 0, 0, 0)
    con.begin_connect(a, 0)
    con.end_connect(c, 0)
    con.line.dash_style = MSO_LINE_DASH_STYLE.DASH
    add_arrowheads(con, head='arrow', tail='arrow', w='sm', length='sm')
    con = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(11.6), Inches(6.8), Inches(12.9), Inches(4.2))
    con.line.width = Pt(3)
    add_arrowheads(con, head=None, tail='triangle')
    con.name = 'Free connector flipped'

    # Rotation and flips
    s = titled(prs, 'Rotation and flips')
    for i, rot in enumerate([0, 15, 45, 90, 135, 180, 270, 330]):
        sh = s.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, Inches(0.3 + i * 1.6), Inches(1.6), Inches(1.4), Inches(0.8))
        sh.rotation = rot
        sh.text = f'{rot}°'
    for i, (h, v) in enumerate([(False, False), (True, False), (False, True), (True, True)]):
        sh = s.shapes.add_shape(MSO_SHAPE.RIGHT_TRIANGLE, Inches(0.3 + i * 2.4), Inches(3.2), Inches(2), Inches(1.4))
        set_flip(sh, h, v)
        sh.text = f'flipH={int(h)} flipV={int(v)}'
    sh = s.shapes.add_shape(MSO_SHAPE.RIGHT_TRIANGLE, Inches(10), Inches(3.2), Inches(2), Inches(1.4))
    set_flip(sh, True, False)
    sh.rotation = 30
    sh.text = 'flipH + 30°'
    tb = text_box(s, Inches(1), Inches(5.3), Inches(4), Inches(0.8), 'Rotated text box', 24)
    tb.rotation = -20
    pic = s.shapes.add_picture(io.BytesIO(image), Inches(7), Inches(5), Inches(2), Inches(1.5))
    pic.rotation = 60
    pic = s.shapes.add_picture(io.BytesIO(image), Inches(10), Inches(5), Inches(2), Inches(1.5))
    set_flip(pic, True, False)

    # Groups (nested, rotated, flipped)
    s = titled(prs, 'Groups')
    g = s.shapes.add_group_shape()
    g.name = 'Outer group'
    r1 = g.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.5), Inches(1.5), Inches(2), Inches(1))
    r1.text = 'in group'
    inner = g.shapes.add_group_shape()
    inner.name = 'Inner group'
    o1 = inner.shapes.add_shape(MSO_SHAPE.OVAL, Inches(2.8), Inches(2.6), Inches(1.5), Inches(1.5))
    o1.text = 'nested'
    o2 = inner.shapes.add_shape(MSO_SHAPE.STAR_5_POINT, Inches(4.4), Inches(1.5), Inches(1.5), Inches(1.5))
    o2.fill.solid()
    o2.fill.fore_color.rgb = RGBColor(0xFF, 0xC0, 0x00)
    g2 = s.shapes.add_group_shape()
    g2.name = 'Rotated group'
    t1 = g2.shapes.add_shape(MSO_SHAPE.ISOSCELES_TRIANGLE, Inches(7), Inches(1.5), Inches(2), Inches(2))
    t1.text = 'rot'
    t2 = g2.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(9.2), Inches(2.5), Inches(2), Inches(1))
    t2.text = 'grp 25°'
    g2.rotation = 25
    g3 = s.shapes.add_group_shape()
    g3.name = 'Flipped group with scaled child space'
    u1 = g3.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, Inches(1), Inches(4.5), Inches(2.5), Inches(1))
    u1.text = 'flipH group'
    g3.shapes.add_picture(io.BytesIO(image), Inches(3.7), Inches(4.4), Inches(1.6), Inches(1.2))
    set_flip(g3, True, False)
    # Scale the group: chExt stays, ext doubles in width
    xfrm = g3._element.grpSpPr.find(qn('a:xfrm'))
    ext = xfrm.find(qn('a:ext'))
    ext.set('cx', str(int(int(ext.get('cx')) * 1.5)))
    # Freeform / custom geometry
    ff = s.shapes.build_freeform(100, 0, scale=Inches(1) / 100)
    ff.add_line_segments([(150, 0), (200, 120), (90, 160), (40, 80), (100, 60)], close=True)
    poly = ff.convert_to_shape(Inches(6.5), Inches(4.4))
    poly.name = 'Freeform polygon'
    poly.fill.solid()
    poly.fill.fore_color.rgb = RGBColor(0x70, 0xAD, 0x47)
    ff = s.shapes.build_freeform(0, 40, scale=Inches(1) / 100)
    ff.add_line_segments([(60, -40), (120, 0), (180, -40), (240, 0)], close=False)
    open_path = ff.convert_to_shape(Inches(8.3), Inches(5.6))
    open_path.fill.background()
    open_path.name = 'Freeform open path'
    open_path.line.width = Pt(3)
    add_arrowheads(open_path, head='none', tail='triangle')
    # A custGeom with arcs and cubic beziers, written directly
    cust = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(10.9), Inches(5.6), Inches(2.2), Inches(1.4))
    cust.name = 'Custom geometry with curves'
    prst = cust._element.spPr.find(qn('a:prstGeom'))
    prst.addprevious(xml(
        '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst>'
        '<a:path w="200" h="100"><a:moveTo><a:pt x="0" y="100"/></a:moveTo>'
        '<a:cubicBezTo><a:pt x="40" y="0"/><a:pt x="80" y="0"/><a:pt x="100" y="50"/></a:cubicBezTo>'
        '<a:quadBezTo><a:pt x="150" y="100"/><a:pt x="200" y="0"/></a:quadBezTo>'
        '<a:lnTo><a:pt x="200" y="100"/></a:lnTo>'
        '<a:arcTo wR="50" hR="25" stAng="0" swAng="10800000"/><a:close/></a:path></a:pathLst></a:custGeom>'
    ))
    prst.getparent().remove(prst)

    # Effects
    s = titled(prs, 'Effects')
    for i, (label, fx) in enumerate([
        ('outer shadow', '<a:effectLst><a:outerShdw blurRad="76200" dist="76200" dir="2700000" algn="tl" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="50000"/></a:srgbClr></a:outerShdw></a:effectLst>'),
        ('glow', '<a:effectLst><a:glow rad="127000"><a:srgbClr val="FFC000"><a:alpha val="60000"/></a:srgbClr></a:glow></a:effectLst>'),
        ('soft edge', '<a:effectLst><a:softEdge rad="63500"/></a:effectLst>'),
        ('reflection', '<a:effectLst><a:reflection blurRad="6350" stA="50000" endA="300" endPos="55000" dir="5400000" sy="-100000" algn="bl" rotWithShape="0"/></a:effectLst>'),
    ]):
        sh = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.6 + i * 3.1), Inches(2), Inches(2.6), Inches(1.6))
        sh.text = label
        sh._element.spPr.append(xml(fx))

    save(prs, out)


def deck_tables(out: Path):
    prs = new_presentation()
    set_core(prs, 'Tables')
    s = titled(prs, 'Table with style, merges and fills')
    gf = s.shapes.add_table(5, 4, Inches(0.5), Inches(1.5), Inches(8), Inches(3))
    t = gf.table
    data = [['Region', 'Q1', 'Q2', 'Q3'], ['North', '10', '12', '15'], ['South', '8', '9', '11'], ['East', '14', '13', '17'], ['Total', '32', '34', '43']]
    for r, row in enumerate(data):
        for c, val in enumerate(row):
            t.cell(r, c).text = val
            if c > 0 and r > 0:
                t.cell(r, c).text_frame.paragraphs[0].alignment = PP_ALIGN.RIGHT
    t.columns[0].width = Inches(2.6)
    t.rows[0].height = Inches(0.6)
    t.last_row = True
    t.first_col = True
    tot = t.cell(4, 0)
    tot.fill.solid()
    tot.fill.fore_color.rgb = RGBColor(0xFF, 0xE6, 0x99)
    for r in tot.text_frame.paragraphs[0].runs:
        r.font.bold = True
    # Second table: merged cells, no style (table grid), vertical text, cell margins/anchor
    gf2 = s.shapes.add_table(4, 4, Inches(8.8), Inches(1.5), Inches(4.2), Inches(3))
    gf2.name = 'Merged table'
    t2 = gf2.table
    t2._tbl.tblPr.find(qn('a:tableStyleId')).text = '{5940675A-B579-460E-94D1-54222C63F5DA}'
    t2.cell(0, 0).merge(t2.cell(0, 3))
    t2.cell(0, 0).text = 'Merged across 4 columns'
    t2.cell(1, 0).merge(t2.cell(3, 0))
    t2.cell(1, 0).text = 'Rows 1-3'
    t2.cell(1, 0)._tc.get_or_add_tcPr().set('vert', 'vert270')
    t2.cell(1, 1).merge(t2.cell(2, 2))
    t2.cell(1, 1).text = '2x2 block'
    t2.cell(1, 1).vertical_anchor = MSO_ANCHOR.MIDDLE
    t2.cell(3, 3).text = 'margins'
    t2.cell(3, 3).margin_left = Inches(0.3)
    t2.cell(3, 3).margin_top = Inches(0.1)
    # Cell borders on table 2
    tcPr = t2.cell(3, 1)._tc.get_or_add_tcPr()
    for edge in ('a:lnL', 'a:lnR', 'a:lnT', 'a:lnB'):
        tcPr.insert(0, xml(f'<{edge} w="38100"><a:solidFill><a:srgbClr val="C00000"/></a:solidFill><a:prstDash val="dash"/></{edge}>'))
    # Reorder borders so lnL,lnR,lnT,lnB come first in schema order
    borders = [el for el in tcPr if el.tag in {qn('a:lnL'), qn('a:lnR'), qn('a:lnT'), qn('a:lnB')}]
    for el in borders:
        tcPr.remove(el)
    for i, el in enumerate(sorted(borders, key=lambda e: ['lnL', 'lnR', 'lnT', 'lnB'].index(etree.QName(e).localname))):
        tcPr.insert(i, el)
    t2.cell(3, 1).text = 'borders'
    # Third: other built-in styles, banding off
    s2 = titled(prs, 'Built-in table styles')
    styles = [('{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}', 'Medium Style 2'), ('{2D5ABB26-0587-4C30-8999-92F81FD0307C}', 'No Style, No Grid'), ('{9D7B26C5-4107-4FEC-AEDC-1716B250EE53}', 'Light Style 1 - Accent 6'), ('{D7AC3CCA-C797-4891-BE02-D94E43425B78}', 'Medium Style 4')]
    for i, (sid, name) in enumerate(styles):
        gf = s2.shapes.add_table(3, 3, Inches(0.5 + (i % 2) * 6.4), Inches(1.5 + (i // 2) * 2.7), Inches(6), Inches(2.2))
        gf.name = name
        tb = gf.table
        tb._tbl.tblPr.find(qn('a:tableStyleId')).text = sid
        tb.horz_banding = i % 2 == 0
        tb.vert_banding = i % 2 == 1
        for r in range(3):
            for c in range(3):
                tb.cell(r, c).text = name if (r, c) == (0, 0) else f'r{r}c{c}'
    set_notes(s2, 'Four tableStyleId GUIDs that refer to PowerPoint built-in table styles not present in tableStyles.xml.')
    save(prs, out)


def deck_charts(out: Path):
    prs = new_presentation()
    set_core(prs, 'Charts')
    cd = CategoryChartData()
    cd.categories = ['Q1', 'Q2', 'Q3', 'Q4']
    cd.add_series('2025', (19.2, 21.4, 16.7, 22.0))
    cd.add_series('2026', (22.3, 28.6, 15.2, 24.9))
    cd.add_series('Target', (20, 25, 20, 25))

    s = titled(prs, 'Clustered column')
    ch = s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(0.5), Inches(1.4), Inches(12), Inches(5.6), cd).chart
    ch.has_legend = True
    ch.legend.position = XL_LEGEND_POSITION.BOTTOM
    ch.legend.include_in_layout = False
    ch.has_title = True
    ch.chart_title.text_frame.text = 'Revenue by quarter'
    ch.value_axis.has_major_gridlines = True
    ch.plots[0].has_data_labels = True
    ch.plots[0].data_labels.number_format = '0.0'
    ch.plots[0].data_labels.number_format_is_linked = False
    ch.series[2].format.fill.solid()
    ch.series[2].format.fill.fore_color.rgb = RGBColor(0xA5, 0xA5, 0xA5)

    s = titled(prs, 'Line with markers')
    ch = s.shapes.add_chart(XL_CHART_TYPE.LINE_MARKERS, Inches(0.5), Inches(1.4), Inches(6), Inches(5.6), cd).chart
    ch.has_legend = True
    ch.series[0].smooth = True
    ch.value_axis.maximum_scale = 30
    ch.value_axis.minimum_scale = 10
    cd2 = CategoryChartData()
    cd2.categories = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
    cd2.add_series('Stacked A', (1, 2, 3, 4, 5))
    cd2.add_series('Stacked B', (5, 4, 3, 2, 1))
    ch = s.shapes.add_chart(XL_CHART_TYPE.BAR_STACKED, Inches(6.8), Inches(1.4), Inches(6), Inches(5.6), cd2).chart
    ch.has_legend = True

    s = titled(prs, 'Pie and doughnut')
    pd = CategoryChartData()
    pd.categories = ['Apples', 'Bananas', 'Cherries', 'Dates']
    pd.add_series('Fruit', (0.4, 0.3, 0.2, 0.1))
    ch = s.shapes.add_chart(XL_CHART_TYPE.PIE, Inches(0.5), Inches(1.4), Inches(6), Inches(5.6), pd).chart
    ch.has_legend = True
    ch.legend.position = XL_LEGEND_POSITION.RIGHT
    ch.plots[0].has_data_labels = True
    ch.plots[0].data_labels.number_format = '0%'
    ch.plots[0].data_labels.number_format_is_linked = False
    ch.plots[0].data_labels.position = XL_LABEL_POSITION.OUTSIDE_END
    pt = ch.series[0].points[2]
    pt.format.fill.solid()
    pt.format.fill.fore_color.rgb = RGBColor(0xC0, 0x00, 0x00)
    ch = s.shapes.add_chart(XL_CHART_TYPE.DOUGHNUT, Inches(6.8), Inches(1.4), Inches(6), Inches(5.6), pd).chart
    ch.has_legend = False

    s = titled(prs, 'Scatter and area')
    xy = XyChartData()
    sr = xy.add_series('Measurements')
    for x, y in [(0.7, 2.7), (1.8, 3.2), (2.6, 0.8), (3.1, 4.5), (4.4, 3.9)]:
        sr.add_data_point(x, y)
    s.shapes.add_chart(XL_CHART_TYPE.XY_SCATTER, Inches(0.5), Inches(1.4), Inches(6), Inches(5.6), xy)
    s.shapes.add_chart(XL_CHART_TYPE.AREA, Inches(6.8), Inches(1.4), Inches(6), Inches(5.6), cd)
    set_notes(s, 'Each chart part embeds an xlsx workbook generated by XlsxWriter.')
    save(prs, out)


def deck_pictures(out: Path):
    prs = new_presentation()
    set_core(prs, 'Pictures')
    img = png_bytes(seed=2)
    jpg = io.BytesIO()
    Image.open(io.BytesIO(png_bytes(200, 150, seed=3))).convert('RGB').save(jpg, 'JPEG', quality=70)
    s = titled(prs, 'Pictures and crops')
    p = s.shapes.add_picture(io.BytesIO(img), Inches(0.4), Inches(1.5), Inches(3), Inches(2.25))
    p.name = 'Uncropped PNG'
    p = s.shapes.add_picture(io.BytesIO(img), Inches(3.6), Inches(1.5), Inches(3), Inches(2.25))
    p.crop_left, p.crop_right, p.crop_top, p.crop_bottom = 0.1, 0.2, 0.15, 0.05
    p.name = 'Cropped PNG'
    p = s.shapes.add_picture(io.BytesIO(img), Inches(6.8), Inches(1.5), Inches(3), Inches(2.25))
    p.crop_left, p.crop_right = -0.2, -0.2
    p.name = 'Negative crop (padding)'
    p = s.shapes.add_picture(io.BytesIO(jpg.getvalue()), Inches(10), Inches(1.5), Inches(3), Inches(2.25))
    p.name = 'JPEG'
    p = s.shapes.add_picture(io.BytesIO(img), Inches(0.4), Inches(4.2), Inches(3), Inches(2.25))
    p.auto_shape_type = MSO_SHAPE.OVAL
    p.name = 'Picture with ellipse geometry'
    p = s.shapes.add_picture(io.BytesIO(img), Inches(3.6), Inches(4.2), Inches(3), Inches(2.25))
    p.line.color.rgb = RGBColor(0xC0, 0, 0)
    p.line.width = Pt(4)
    p.name = 'Picture with border'
    p = s.shapes.add_picture(io.BytesIO(img), Inches(6.8), Inches(4.2), Inches(3), Inches(2.25))
    blip = p._element.blipFill.find(qn('a:blip'))
    blip.append(xml('<a:alphaModFix amt="50000"/>'))
    blip.append(xml('<a:grayscl/>'))
    p.name = 'Picture 50% transparent grayscale'
    p = s.shapes.add_picture(io.BytesIO(img), Inches(10), Inches(4.2), Inches(3), Inches(2.25))
    p.name = 'Same image reused'
    p._element.nvPicPr.cNvPr.set('descr', 'Alt text: generated gradient with circle')
    # Slide with picture background
    s2 = prs.slides.add_slide(prs.slide_layouts[0])
    s2.shapes.title.text = 'Picture background'
    s2.placeholders[1].text = 'bg blipFill on the slide'
    _, rid = s2.part.get_or_add_image_part(io.BytesIO(png_bytes(64, 48, seed=4)))
    cSld = s2._element.cSld
    cSld.insert(0, xml(f'<p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="{rid}"><a:alphaModFix amt="40000"/></a:blip><a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>'))
    # Gradient background
    s3 = prs.slides.add_slide(prs.slide_layouts[6])
    s3.background.fill.gradient()
    s3.background.fill.gradient_angle = 90
    s3.background.fill.gradient_stops[0].color.rgb = RGBColor(0x0B, 0x1F, 0x3A)
    s3.background.fill.gradient_stops[1].color.rgb = RGBColor(0x3A, 0x7B, 0xD5)
    text_box(s3, Inches(1), Inches(3), Inches(10), Inches(1), 'Gradient background, picture placeholder layout follows', 28)
    s4 = prs.slides.add_slide(prs.slide_layouts[8])
    s4.shapes.title.text = 'Picture placeholder'
    ph = [p for p in s4.placeholders if p.placeholder_format.type is not None and p.placeholder_format.idx == 1][0]
    ph.insert_picture(io.BytesIO(img))
    s4.placeholders[2].text = 'Caption text in the body placeholder'
    save(prs, out)


def deck_layouts_notes(out: Path, content_type: str | None = None):
    prs = new_presentation(wide=False)  # 4:3
    set_core(prs, 'Layouts, notes, sections, comments')
    slides = []
    for i, layout in enumerate(prs.slide_layouts):
        s = prs.slides.add_slide(layout)
        slides.append(s)
        for ph in s.placeholders:
            pf = ph.placeholder_format
            if pf.type is None:
                continue
            tname = str(pf.type).split('.')[-1].split(' ')[0]
            if ph.has_text_frame:
                ph.text_frame.text = f'{layout.name}: {tname} (idx {pf.idx})'
        set_notes(s, f'Notes for slide {i + 1} using layout "{layout.name}".')
    # hidden slide
    slides[3]._element.set('show', '0')
    set_notes(slides[3], 'This slide is hidden (show="0").')
    # transitions and animations
    add_transition(slides[0], '<p:fade/>', 'med')
    add_transition(slides[1], '<p:push dir="u"/>', 'slow', advance_ms=3000)
    add_transition(slides[2], '<p:wipe dir="r"/>', 'fast')
    add_transition(slides[4], '<p:split orient="vert" dir="in"/>')
    ids = [sh.shape_id for sh in slides[1].shapes][:2]
    add_appear_animation(slides[1], ids)
    # comments
    add_legacy_comments(prs, slides[0], [(0, 'Please check the title wording.', 10, 10), (1, 'Looks good to me.', 200, 120)], [(0, 'Ada Reviewer', 'AR'), (1, 'Bo Author', 'BA')])
    # sections
    add_sections(prs, [('Introduction', slides[0:2]), ('Body', slides[2:8]), ('Vertical text', slides[8:])])
    save(prs, out, content_type)


def pulpo_theme(blob: bytes) -> bytes:
    """Rewrites an Office theme into the "Pulpo" color and font schemes."""
    root = etree.fromstring(blob)
    a = NS['a']
    cs = root.find(f'.//{{{a}}}clrScheme')
    cs.set('name', 'Pulpo')
    colors = {'dk2': '1B2A41', 'lt2': 'EEF1F5', 'accent1': '7C3AED', 'accent2': 'F97316', 'accent3': '10B981', 'accent4': 'EF4444', 'accent5': '0EA5E9', 'accent6': 'EAB308', 'hlink': 'DB2777', 'folHlink': '6B7280'}
    for key, val in colors.items():
        el = cs.find(f'{{{a}}}{key}')
        for child in list(el):
            el.remove(child)
        etree.SubElement(el, f'{{{a}}}srgbClr', val=val)
    fs = root.find(f'.//{{{a}}}fontScheme')
    fs.set('name', 'Pulpo')
    fs.find(f'{{{a}}}majorFont/{{{a}}}latin').set('typeface', 'Georgia')
    fs.find(f'{{{a}}}minorFont/{{{a}}}latin').set('typeface', 'Verdana')
    root.set('name', 'Pulpo Theme')
    return etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)


def accent_swatches(slide, title: str):
    slide.shapes.title.text = title
    for i, tc in enumerate([MSO_THEME_COLOR.ACCENT_1, MSO_THEME_COLOR.ACCENT_2, MSO_THEME_COLOR.ACCENT_3, MSO_THEME_COLOR.ACCENT_4, MSO_THEME_COLOR.ACCENT_5, MSO_THEME_COLOR.ACCENT_6]):
        sh = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.4 + i * 2.1), Inches(2), Inches(1.9), Inches(1.4))
        sh.fill.solid()
        sh.fill.fore_color.theme_color = tc
        sh.text = f'accent{i + 1}'
    tb = text_box(slide, Inches(0.4), Inches(4), Inches(12), Inches(1.5))
    tb.text_frame.text = 'Heading font (+mj-lt)'
    tb.text_frame.paragraphs[0].runs[0].font.name = '+mj-lt'
    tb.text_frame.paragraphs[0].runs[0].font.size = Pt(28)
    p = tb.text_frame.add_paragraph()
    p.text = 'Body font (+mn-lt) in dark 2'
    p.runs[0].font.color.theme_color = MSO_THEME_COLOR.TEXT_2


def deck_two_masters(out: Path):
    """Slides 1-2 use the Office master/theme, slides 3-4 a second master with the Pulpo theme."""
    prs = new_presentation()
    set_core(prs, 'Two masters')
    for title in (['Office master, slide 1', 'Office master, slide 2', 'Pulpo master, slide 3', 'Pulpo master, slide 4']):
        s = prs.slides.add_slide(prs.slide_layouts[5])
        accent_swatches(s, title)
    buf = io.BytesIO()
    prs.save(buf)
    src = zipfile.ZipFile(buf)
    parts = {n: src.read(n) for n in src.namelist()}
    layouts = sorted(int(m.group(1)) for n in parts if (m := re.fullmatch(r'ppt/slideLayouts/slideLayout(\d+)\.xml', n)))
    offset = max(layouts)
    themes = [int(m.group(1)) for n in parts if (m := re.fullmatch(r'ppt/theme/theme(\d+)\.xml', n))]
    new_theme = max(themes) + 1
    ct_extra = ''
    for n in layouts:
        parts[f'ppt/slideLayouts/slideLayout{n + offset}.xml'] = parts[f'ppt/slideLayouts/slideLayout{n}.xml']
        parts[f'ppt/slideLayouts/_rels/slideLayout{n + offset}.xml.rels'] = parts[f'ppt/slideLayouts/_rels/slideLayout{n}.xml.rels'].replace(b'slideMaster1.xml', b'slideMaster2.xml')
        ct_extra += f'<Override PartName="/ppt/slideLayouts/slideLayout{n + offset}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
    mrels = parts['ppt/slideMasters/_rels/slideMaster1.xml.rels'].decode()
    mrels = re.sub(r'slideLayout(\d+)\.xml', lambda m: f'slideLayout{int(m.group(1)) + offset}.xml', mrels)
    mrels = re.sub(r'theme\d+\.xml', f'theme{new_theme}.xml', mrels)
    parts['ppt/slideMasters/_rels/slideMaster2.xml.rels'] = mrels.encode()
    master = parts['ppt/slideMasters/slideMaster1.xml'].decode()
    master = re.sub(r'<p:sldLayoutId id="(\d+)"', lambda m: f'<p:sldLayoutId id="{int(m.group(1)) + 100}"', master)
    bg = '<p:bg><p:bgPr><a:solidFill><a:schemeClr val="accent1"><a:lumMod val="20000"/><a:lumOff val="80000"/></a:schemeClr></a:solidFill><a:effectLst/></p:bgPr></p:bg>'
    master = re.sub(r'<p:bg>.*?</p:bg>', bg, master, count=1, flags=re.S) if '<p:bg>' in master else master.replace('<p:cSld>', '<p:cSld>' + bg, 1)
    parts['ppt/slideMasters/slideMaster2.xml'] = master.encode()
    theme_name = f'ppt/theme/theme{new_theme}.xml'
    parts[theme_name] = pulpo_theme(parts['ppt/theme/theme1.xml'])
    ct_extra += '<Override PartName="/ppt/slideMasters/slideMaster2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
    ct_extra += f'<Override PartName="/{theme_name}" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
    parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace(b'</Types>', ct_extra.encode() + b'</Types>')
    parts['ppt/_rels/presentation.xml.rels'] = parts['ppt/_rels/presentation.xml.rels'].replace(
        b'</Relationships>', b'<Relationship Id="rIdMaster2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster2.xml"/></Relationships>')
    parts['ppt/presentation.xml'] = re.sub(rb'(<p:sldMasterId [^>]*/>)', rb'\1<p:sldMasterId id="2147483700" r:id="rIdMaster2"/>', parts['ppt/presentation.xml'], count=1)
    for k in (3, 4):
        name = f'ppt/slides/_rels/slide{k}.xml.rels'
        parts[name] = re.sub(rb'slideLayout(\d+)\.xml', lambda m: b'slideLayout%d.xml' % (int(m.group(1)) + offset), parts[name])
    out_buf = io.BytesIO()
    with zipfile.ZipFile(out_buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for n, b in parts.items():
            z.writestr(n, b)
    rewrite_zip(out_buf.getvalue(), out)


def deck_theme_custom(out: Path, content_type: str | None = None):
    prs = new_presentation()
    set_core(prs, 'Custom theme')
    s = prs.slides.add_slide(prs.slide_layouts[0])
    s.shapes.title.text = 'Custom theme: Pulpo'
    s.placeholders[1].text = 'Major font Georgia, minor font Verdana, custom accents'
    s = titled(prs, 'Theme colors and fonts')
    for i, tc in enumerate([MSO_THEME_COLOR.ACCENT_1, MSO_THEME_COLOR.ACCENT_2, MSO_THEME_COLOR.ACCENT_3, MSO_THEME_COLOR.ACCENT_4, MSO_THEME_COLOR.ACCENT_5, MSO_THEME_COLOR.ACCENT_6]):
        for j, bright in enumerate([0.0, 0.4, -0.25]):
            sh = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.4 + i * 2.1), Inches(1.5 + j * 1.3), Inches(1.9), Inches(1.1))
            sh.fill.solid()
            sh.fill.fore_color.theme_color = tc
            if bright:
                sh.fill.fore_color.brightness = bright
            sh.text = f'accent{i + 1} {bright:+.2f}'
    tb = text_box(s, Inches(0.4), Inches(5.6), Inches(12), Inches(1.2))
    tf = tb.text_frame
    tf.text = 'Major (+mj-lt) heading font'
    tf.paragraphs[0].runs[0].font.name = '+mj-lt'
    tf.paragraphs[0].runs[0].font.size = Pt(24)
    p = tf.add_paragraph()
    p.text = 'Minor (+mn-lt) body font with hyperlink color'
    p.runs[0].font.name = '+mn-lt'
    r = p.add_run()
    r.text = ' link'
    r.hyperlink.address = 'https://example.com'

    def patch(name: str, blob: bytes) -> bytes:
        return pulpo_theme(blob) if name == 'ppt/theme/theme1.xml' else blob

    buf = io.BytesIO()
    prs.save(buf)
    rewrite_zip(buf.getvalue(), out, content_type, patch)


def deck_big(out: Path, count: int):
    prs = new_presentation()
    set_core(prs, f'Big deck ({count} slides)')
    image = png_bytes(seed=5)
    cd = CategoryChartData()
    cd.categories = ['A', 'B', 'C']
    cd.add_series('S', (1, 2, 3))
    for i in range(count):
        layout = prs.slide_layouts[[0, 1, 5, 6, 3][i % 5]]
        s = prs.slides.add_slide(layout)
        if s.shapes.title is not None:
            s.shapes.title.text = f'Slide {i + 1}'
        for ph in s.placeholders:
            if ph.placeholder_format.idx != 0 and ph.has_text_frame:
                ph.text_frame.text = f'Body text for slide {i + 1}'
                for lvl in range(1, 3):
                    p = ph.text_frame.add_paragraph()
                    p.text = f'Level {lvl} bullet'
                    p.level = lvl
        for j in range(8):
            sh = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.3 + j * 1.6), Inches(6.3), Inches(1.4), Inches(0.8))
            sh.text = f'{i + 1}.{j + 1}'
            sh.rotation = (i * 7 + j * 11) % 360 if j % 3 == 0 else 0
        if i % 4 == 0:
            s.shapes.add_picture(io.BytesIO(image), Inches(10.5), Inches(0.3), Inches(2.4), Inches(1.8))
        if i % 10 == 5:
            t = s.shapes.add_table(6, 5, Inches(1), Inches(2), Inches(10), Inches(3)).table
            for r in range(6):
                for c in range(5):
                    t.cell(r, c).text = f'{r},{c}'
        if i % 25 == 10:
            s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(6), Inches(2), Inches(6), Inches(4), cd)
        set_notes(s, f'Speaker notes for slide {i + 1}. ' * 3)
    save(prs, out)


# --------------------------------------------------------------------------- LibreOffice


def soffice_convert(src: Path, outdir: Path, target: str = 'pptx') -> Path:
    """Runs headless LibreOffice with a private profile, retrying when the profile is locked."""
    soffice = os.environ.get('PULPO_SOFFICE', shutil.which('soffice') or '/opt/homebrew/bin/soffice')
    profile = os.environ.get('PULPO_LO_PROFILE', '/tmp/pulpo-pptx-lo-profile')
    outdir.mkdir(parents=True, exist_ok=True)
    expected = outdir / (src.stem + '.' + target.split(':')[0])
    for attempt in range(6):
        if expected.exists():
            expected.unlink()
        proc = subprocess.run(
            [soffice, f'-env:UserInstallation=file://{profile}', '--headless', '--norestore', '--nologo', '--convert-to', target, '--outdir', str(outdir), str(src)],
            capture_output=True, text=True, timeout=300,
        )
        if expected.exists() and expected.stat().st_size > 0:
            return expected
        import time
        time.sleep(2 + attempt * 2)
    raise RuntimeError(f'LibreOffice failed to convert {src}: {proc.stdout} {proc.stderr}')


def libreoffice_roundtrips():
    LIBREOFFICE.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='pulpo-lo-') as tmp:
        tmpd = Path(tmp)
        for name in ('text-formatting', 'autoshapes', 'tables'):
            src = tmpd / f'{name}.pptx'
            shutil.copy(GENERATED / f'{name}.pptx', src)
            converted = soffice_convert(src, tmpd / 'out')
            dest = LIBREOFFICE / f'lo-{name}.pptx'
            # Pin zip timestamps; LibreOffice's own core.xml dates remain
            rewrite_zip(converted.read_bytes(), dest)
            print('wrote', dest.relative_to(FIXTURES))


# --------------------------------------------------------------------------- main

TEMPLATE_CT = 'application/vnd.openxmlformats-officedocument.presentationml.template.main+xml'


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', type=Path, default=GENERATED, help='output directory (default: fixtures/presentation/generated)')
    ap.add_argument('--libreoffice', action='store_true', help='also re-save decks through LibreOffice into fixtures/presentation/libreoffice')
    ap.add_argument('--big', type=int, metavar='N', help='write only a performance deck with N slides')
    ap.add_argument('--big-out', type=Path, default=Path('/tmp/pulpo-big-deck.pptx'))
    args = ap.parse_args(argv)
    if args.big:
        deck_big(args.big_out, args.big)
        print('wrote', args.big_out, args.big_out.stat().st_size, 'bytes')
        return
    out = args.out
    out.mkdir(parents=True, exist_ok=True)
    deck_text_formatting(out / 'text-formatting.pptx')
    deck_autoshapes(out / 'autoshapes.pptx')
    deck_tables(out / 'tables.pptx')
    deck_charts(out / 'charts.pptx')
    deck_pictures(out / 'pictures.pptx')
    deck_layouts_notes(out / 'layouts-notes-sections.pptx')
    deck_theme_custom(out / 'theme-custom.pptx')
    deck_two_masters(out / 'two-masters.pptx')
    deck_theme_custom(out / 'theme-custom-template.potx', TEMPLATE_CT)
    for f in sorted(out.glob('*.p*x')):
        print('wrote', f, f.stat().st_size, 'bytes')
    if args.libreoffice:
        libreoffice_roundtrips()


if __name__ == '__main__':
    main()
