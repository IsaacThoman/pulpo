#!/usr/bin/env python3
"""Generate small, deterministic Word fixtures; requires python-docx and lxml.

Run: /tmp/pulpo-docx-venv/bin/python -I packages/client-core/fixtures/docx/generate.py
Only the seven generated .docx files beside this script are overwritten.
"""
from copy import deepcopy
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
import struct
import zlib
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

from docx import Document
from docx.enum.section import WD_SECTION_START, WD_ORIENT
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_ROW_HEIGHT_RULE
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING, WD_TAB_ALIGNMENT, WD_TAB_LEADER, WD_UNDERLINE, WD_COLOR_INDEX
from docx.opc.packuri import PackURI
from docx.opc.part import Part
from docx.oxml.ns import nsmap
from docx.shared import Inches, Pt, RGBColor, Twips
from lxml import etree

ROOT = Path(__file__).resolve().parent
STAMP = '2024-01-01T00:00:00Z'
NS = dict(nsmap, **{
    'w14': 'http://schemas.microsoft.com/office/word/2010/wordml',
    'w15': 'http://schemas.microsoft.com/office/word/2012/wordml',
    'wps': 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
    'v': 'urn:schemas-microsoft-com:vml',
    'mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006',
})
REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.'


def q(name):
    prefix, local = name.split(':')
    return '{%s}%s' % (NS[prefix], local)


def x(name, attrs=None, text=None, children=()):
    el = etree.Element(q(name), nsmap=NS if name in ('w:footnotes', 'w:endnotes', 'w15:commentsEx') else None)
    for key, value in (attrs or {}).items():
        el.set(q(key) if ':' in key else key, str(value))
    if text is not None:
        el.text = text
    el.extend(children)
    return el


def add(parent, name, attrs=None, text=None, children=()):
    el = x(name, attrs, text, children)
    parent.append(el)
    return el


def text_run(text, props=None):
    r = x('w:r')
    if props is not None:
        r.append(props)
    add(r, 'w:t', {'xml:space': 'preserve'}, text)
    return r


def raw_paragraph(text):
    return x('w:p', children=[text_run(text)])


def field(paragraph, instruction, result):
    for name, attrs, text in (
        ('w:fldChar', {'w:fldCharType': 'begin'}, None),
        ('w:instrText', {'xml:space': 'preserve'}, ' ' + instruction + ' '),
        ('w:fldChar', {'w:fldCharType': 'separate'}, None),
        ('w:t', None, result),
        ('w:fldChar', {'w:fldCharType': 'end'}, None),
    ):
        paragraph._p.append(x('w:r', children=[x(name, attrs, text)]))


def part(doc, path, content_type, relationship, root):
    blob = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    p = Part(PackURI('/word/' + path), content_type, blob, doc.part.package)
    doc.part.relate_to(p, relationship)
    return p


def new(title):
    doc = Document()
    doc.core_properties.title = title
    doc.core_properties.author = 'Pulpo'
    doc.core_properties.last_modified_by = 'Pulpo'
    doc.core_properties.created = datetime(2024, 1, 1, tzinfo=timezone.utc)
    doc.core_properties.modified = datetime(2024, 1, 1, tzinfo=timezone.utc)
    doc.core_properties.revision = 1
    doc.add_heading(title, 0)
    return doc


def save(doc, name):
    # ZIP timestamps also need fixing: core properties alone are not byte-deterministic.
    buffer = BytesIO()
    doc.save(buffer)
    with ZipFile(buffer) as source, ZipFile(ROOT / name, 'w', compression=ZIP_DEFLATED) as target:
        for entry in sorted(source.namelist()):
            info = ZipInfo(entry, (2024, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            target.writestr(info, source.read(entry))
    size = (ROOT / name).stat().st_size
    if size >= 200_000:
        raise ValueError(f'{name} is too large: {size}')
    print(f'{name}: {size} bytes')


def basic():
    d = new('Basic formatting')
    for level in (1, 2, 3):
        d.add_heading(f'Heading level {level}', level)
    d.add_paragraph('A normal paragraph with plain text and typographic samples below.')
    p = d.add_paragraph()
    for attr in ('bold', 'italic', 'strike', 'double_strike', 'superscript', 'subscript', 'small_caps', 'all_caps'):
        r = p.add_run(attr.replace('_', ' ') + '; ')
        setattr(r.font, attr, True)
    p = d.add_paragraph()
    for label, underline in [('single', WD_UNDERLINE.SINGLE), ('double', WD_UNDERLINE.DOUBLE), ('wavy', WD_UNDERLINE.WAVY), ('colored', WD_UNDERLINE.SINGLE)]:
        r = p.add_run(label + ' underline; ')
        r.underline = underline
        if label == 'colored':
            r._r.rPr.find(q('w:u')).set(q('w:color'), 'CC2233')
    p = d.add_paragraph()
    r = p.add_run('Yellow highlight; ')
    r.font.highlight_color = WD_COLOR_INDEX.YELLOW
    r = p.add_run('RGB red; ')
    r.font.color.rgb = RGBColor.from_string('CC2233')
    r = p.add_run('Theme accent1; ')
    add(r._r.get_or_add_rPr(), 'w:color', {'w:val': '4472C4', 'w:themeColor': 'accent1'})
    for font in ('Arial', 'Times New Roman', 'Courier New'):
        r = p.add_run(font + '; ')
        r.font.name, r.font.size = font, Pt(14)
    r = d.add_paragraph().add_run('Expanded character spacing (2pt)')
    add(r._r.get_or_add_rPr(), 'w:spacing', {'w:val': 40})
    for name, alignment in [('left', WD_ALIGN_PARAGRAPH.LEFT), ('center', WD_ALIGN_PARAGRAPH.CENTER), ('right', WD_ALIGN_PARAGRAPH.RIGHT), ('justify', WD_ALIGN_PARAGRAPH.JUSTIFY)]:
        p = d.add_paragraph(f'{name.title()} alignment. ' * 5)
        p.alignment = alignment
    p = d.add_paragraph('Left/right indents, a first-line indent, and before/after spacing.')
    f = p.paragraph_format
    f.left_indent, f.right_indent, f.first_line_indent = Inches(.5), Inches(.25), Inches(.3)
    f.space_before, f.space_after = Pt(8), Pt(12)
    p = d.add_paragraph('Hanging indent. ' * 12)
    p.paragraph_format.left_indent, p.paragraph_format.first_line_indent = Inches(.5), Inches(-.25)
    for label, value, rule in [('single', 1, WD_LINE_SPACING.SINGLE), ('1.5', 1.5, WD_LINE_SPACING.ONE_POINT_FIVE), ('double', 2, WD_LINE_SPACING.DOUBLE), ('exact 18pt', Pt(18), WD_LINE_SPACING.EXACTLY), ('at least 24pt', Pt(24), WD_LINE_SPACING.AT_LEAST)]:
        p = d.add_paragraph('Line spacing ' + label + '\nSecond line')
        p.paragraph_format.line_spacing = value
        p.paragraph_format.line_spacing_rule = rule
    p = d.add_paragraph('Keep this paragraph with the following paragraph.')
    p.paragraph_format.keep_with_next = True
    d.add_paragraph('Kept companion.')
    p = d.add_paragraph('Borders and shading around this paragraph.')
    pr = p._p.get_or_add_pPr()
    borders = add(pr, 'w:pBdr')
    for side in ('top', 'left', 'bottom', 'right'):
        add(borders, 'w:' + side, {'w:val': 'single', 'w:sz': 8, 'w:space': 4, 'w:color': '336699'})
    add(pr, 'w:shd', {'w:val': 'clear', 'w:color': 'auto', 'w:fill': 'E6EEF8'})
    p = d.add_paragraph('Tabs:\tLeft\tCenter\tRight\t123.45')
    stops = p.paragraph_format.tab_stops
    for inches, alignment, leader in [(1, WD_TAB_ALIGNMENT.LEFT, WD_TAB_LEADER.SPACES), (2.5, WD_TAB_ALIGNMENT.CENTER, WD_TAB_LEADER.SPACES), (4, WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.DOTS), (5.5, WD_TAB_ALIGNMENT.DECIMAL, WD_TAB_LEADER.DOTS)]:
        stops.add_tab_stop(Inches(inches), alignment, leader)
    p = d.add_paragraph('Explicit line break:')
    p.add_run().add_break(WD_BREAK.LINE)
    p.add_run('After the line break.')
    p = d.add_paragraph('Page break before this paragraph.')
    p.paragraph_format.page_break_before = True
    p = d.add_paragraph('Explicit page break follows.')
    p.add_run().add_break(WD_BREAK.PAGE)
    d.add_paragraph('After the page break; a two-column section follows.')
    section = d.add_section(WD_SECTION_START.CONTINUOUS)
    section._sectPr.find(q('w:cols')).set(q('w:num'), '2')
    p = d.add_paragraph('First column.')
    p.add_run().add_break(WD_BREAK.COLUMN)
    p.add_run('After the column break.')
    save(d, 'basic-formatting.docx')


def numbering_level(level, fmt, text, font=None, legal=False, style=None):
    el = x('w:lvl', {'w:ilvl': level})
    add(el, 'w:start', {'w:val': 1})
    add(el, 'w:numFmt', {'w:val': fmt})
    if style:
        add(el, 'w:pStyle', {'w:val': style})
    if legal:
        add(el, 'w:isLgl')
    add(el, 'w:lvlText', {'w:val': text})
    add(el, 'w:lvlJc', {'w:val': 'left'})
    pr = add(el, 'w:pPr')
    tabs = add(pr, 'w:tabs')
    add(tabs, 'w:tab', {'w:val': 'num', 'w:pos': (level + 1) * 360})
    add(pr, 'w:ind', {'w:left': (level + 1) * 360, 'w:hanging': 240})
    if font:
        add(add(el, 'w:rPr'), 'w:rFonts', {'w:ascii': font, 'w:hAnsi': font})
    return el


def num_pr(parent, num, level):
    pr = add(parent, 'w:numPr')
    add(pr, 'w:ilvl', {'w:val': level})
    add(pr, 'w:numId', {'w:val': num})


def lists():
    d = new('Lists and numbering')
    for style in ('List Bullet', 'List Number'):
        for i in range(1, 4):
            d.add_paragraph(f'{style} item {i}', style)
    root = d.part.numbering_part.element
    # Abstract definitions must precede concrete w:num instances.
    def abstract(ident, levels):
        el = x('w:abstractNum', {'w:abstractNumId': ident})
        add(el, 'w:multiLevelType', {'w:val': 'multilevel'})
        el.extend(levels)
        first_num = root.find(q('w:num'))
        root.insert(root.index(first_num) if first_num is not None else len(root), el)
    abstract(40, [numbering_level(0, 'decimal', '%1.'), numbering_level(1, 'lowerLetter', '%2)'), numbering_level(2, 'lowerRoman', '%3.'), numbering_level(3, 'decimal', '%1.%2.%3.', legal=True), numbering_level(4, 'decimal', '%1.%2.%3.%4.%5.', legal=True), numbering_level(5, 'bullet', '\uf0b7', font='Symbol'), numbering_level(6, 'bullet', '\uf0a7', font='Wingdings')])
    for ident, start in [(40, None), (41, 5), (42, None)]:
        num = add(root, 'w:num', {'w:numId': ident})
        add(num, 'w:abstractNumId', {'w:val': 40})
        if start:
            add(add(num, 'w:lvlOverride', {'w:ilvl': 0}), 'w:startOverride', {'w:val': start})
    for num, levels in [(40, [0, 1, 2, 3, 4, 5, 6, 0]), (41, [0, 1, 0]), (42, [0, 1, 0])]:
        for level in levels:
            p = d.add_paragraph(f'Numbering instance {num}, level {level}' + (' (restart)' if num == 42 else ''))
            num_pr(p._p.get_or_add_pPr(), num, level)
    abstract(43, [numbering_level(0, 'decimal', '%1.', style='Heading1'), numbering_level(1, 'decimal', '%1.%2.', style='Heading2')])
    add(add(root, 'w:num', {'w:numId': 43}), 'w:abstractNumId', {'w:val': 43})
    for level in (1, 2):
        num_pr(d.styles[f'Heading {level}'].element.get_or_add_pPr(), 43, level - 1)
    d.add_heading('Numbered outline', 1)
    d.add_heading('Numbered outline child', 2)
    save(d, 'lists.docx')


def tables():
    d = new('Tables')
    t = d.add_table(rows=4, cols=4)
    t.style = 'Table Grid'
    t.autofit = False
    for col in t.columns:
        col.width = Inches(1.4)
    for i, row in enumerate(t.rows):
        for j, cell in enumerate(row.cells):
            cell.text = f'Grid {i+1},{j+1}'
            cell.width = Inches(1.4)
    t.cell(0, 0).merge(t.cell(0, 1)).text = 'Horizontal span 2'
    t.cell(1, 0).merge(t.cell(1, 2)).text = 'Horizontal span 3'
    t.cell(1, 3).merge(t.cell(3, 3)).text = 'Vertical span 3'
    cell = t.cell(2, 0)
    pr = cell._tc.get_or_add_tcPr()
    borders = add(pr, 'w:tcBorders')
    for side in ('top', 'left', 'bottom', 'right'):
        add(borders, 'w:' + side, {'w:val': 'double', 'w:sz': 12, 'w:color': '884422'})
    add(pr, 'w:shd', {'w:val': 'clear', 'w:fill': 'FFF2CC'})
    margins = add(pr, 'w:tcMar')
    for side in ('top', 'left', 'bottom', 'right'):
        add(margins, 'w:' + side, {'w:w': 120, 'w:type': 'dxa'})
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    t.cell(2, 1).vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.BOTTOM
    t.rows[0].height, t.rows[0].height_rule = Pt(30), WD_ROW_HEIGHT_RULE.EXACTLY
    t.rows[2].height, t.rows[2].height_rule = Pt(36), WD_ROW_HEIGHT_RULE.AT_LEAST
    width = t._tbl.tblPr.find(q('w:tblW'))
    width.set(q('w:type'), 'dxa')
    width.set(q('w:w'), '8064')
    d.add_paragraph('Banded table, percentage width, repeating header, and a nested table.')
    t = d.add_table(rows=4, cols=3)
    t.style = 'Light Shading Accent 1'
    look = t._tbl.tblPr.find(q('w:tblLook'))
    for key, value in {'val': '04A0', 'firstRow': 1, 'lastRow': 0, 'firstColumn': 0, 'lastColumn': 0, 'noHBand': 0, 'noVBand': 1}.items():
        look.set(q('w:' + key), str(value))
    width = t._tbl.tblPr.find(q('w:tblW'))
    width.set(q('w:type'), 'pct')
    width.set(q('w:w'), '5000')
    add(t.rows[0]._tr.get_or_add_trPr(), 'w:tblHeader')
    for i, row in enumerate(t.rows):
        for j, cell in enumerate(row.cells):
            cell.text = f'Banded {i+1},{j+1}'
    nested = t.cell(1, 1).add_table(rows=2, cols=2)
    nested.style = 'Table Grid'
    for i, row in enumerate(nested.rows):
        for j, cell in enumerate(row.cells):
            cell.text = f'Inner {i+1},{j+1}'
    # Omitted leading/trailing grid positions are not empty cells.
    row = t.rows[3]
    row._tr.remove(row._tr.tc_lst[-1])
    row._tr.remove(row._tr.tc_lst[0])
    pr = row._tr.get_or_add_trPr()
    add(pr, 'w:gridBefore', {'w:val': 1})
    add(pr, 'w:gridAfter', {'w:val': 1})
    d.add_paragraph('Forty-row table crossing page boundaries.')
    t = d.add_table(rows=40, cols=3)
    t.style = 'Table Grid'
    add(t.rows[0]._tr.get_or_add_trPr(), 'w:tblHeader')
    for i, row in enumerate(t.rows):
        row.height, row.height_rule = Pt(27), WD_ROW_HEIGHT_RULE.AT_LEAST
        for j, cell in enumerate(row.cells):
            cell.text = f'Long table row {i+1}, column {j+1}'
    save(d, 'tables.docx')


def sections():
    d = new('Sections, headers, and footers')
    d.settings.odd_and_even_pages_header_footer = True
    s = d.sections[0]
    s.page_width, s.page_height = Inches(8.5), Inches(11)
    s.top_margin = s.bottom_margin = s.left_margin = s.right_margin = Inches(1)
    s.different_first_page_header_footer = True
    s.header.paragraphs[0].text = 'Default header — page '
    field(s.header.paragraphs[0], 'PAGE', '1')
    s.header.paragraphs[0].add_run(' of ')
    field(s.header.paragraphs[0], 'NUMPAGES', '3')
    p = s.footer.paragraphs[0]
    p.text = 'Page '
    field(p, 'PAGE', '1')
    p.add_run(' of ')
    field(p, 'NUMPAGES', '3')
    s.first_page_header.paragraphs[0].text = 'First-page header'
    s.first_page_footer.paragraphs[0].text = 'First-page footer'
    s.even_page_header.paragraphs[0].text = 'Even-page header'
    s.even_page_footer.paragraphs[0].text = 'Even-page footer'
    d.add_paragraph('Portrait Letter section with different first-page and even-page stories.')
    s = d.add_section(WD_SECTION_START.NEW_PAGE)
    s.orientation = WD_ORIENT.LANDSCAPE
    s.page_width, s.page_height = Inches(11), Inches(8.5)
    s.different_first_page_header_footer = False
    s._sectPr.insert_element_before(x('w:pgNumType', {'w:start': 1, 'w:fmt': 'lowerRoman'}), 'w:cols', 'w:docGrid')
    d.add_heading('Landscape Letter', 1)
    d.add_paragraph('Page numbering restarts at i. Headers and footers inherit from section one.')
    s = d.add_section(WD_SECTION_START.CONTINUOUS)
    s.orientation = WD_ORIENT.PORTRAIT
    s.page_width, s.page_height = Twips(11906), Twips(16838)
    s.top_margin, s.bottom_margin = Inches(.6), Inches(.7)
    s.left_margin, s.right_margin = Inches(.65), Inches(.75)
    pg = s._sectPr.find(q('w:pgNumType'))
    if pg is not None:
        s._sectPr.remove(pg)
    s._sectPr.find(q('w:cols')).set(q('w:num'), '2')
    d.add_heading('A4, two columns', 1)
    d.add_paragraph('Continuous section with different margins and two columns. ' * 12)
    p = d.add_paragraph('Column one ends here.')
    p.add_run().add_break(WD_BREAK.COLUMN)
    p.add_run('Column two starts here.')
    save(d, 'sections-headers.docx')


def notes():
    d = new('Notes, bookmarks, and fields')
    for name, kind in [('FootnoteText', WD_STYLE_TYPE.PARAGRAPH), ('FootnoteReference', WD_STYLE_TYPE.CHARACTER), ('EndnoteText', WD_STYLE_TYPE.PARAGRAPH), ('EndnoteReference', WD_STYLE_TYPE.CHARACTER)]:
        if name not in d.styles:
            style = d.styles.add_style(name, kind)
            style.font.size = Pt(10) if kind == WD_STYLE_TYPE.PARAGRAPH else Pt(8)
            if kind == WD_STYLE_TYPE.CHARACTER:
                style.font.superscript = True
    for kind in ('footnote', 'endnote'):
        p = d.add_paragraph('Text with a ' + kind + '.')
        r = p.add_run()
        r.style = kind.title() + 'Reference'
        add(r._r, 'w:' + kind + 'Reference', {'w:id': 1})
        root = x('w:' + kind + 's')
        for ident, note_type, marker in [(-1, 'separator', 'separator'), (0, 'continuationSeparator', 'continuationSeparator')]:
            add(root, 'w:' + kind, {'w:type': note_type, 'w:id': ident}, children=[x('w:p', children=[x('w:r', children=[x('w:' + marker)])])])
        note = add(root, 'w:' + kind, {'w:id': 1})
        p_xml = add(note, 'w:p')
        add(add(p_xml, 'w:pPr'), 'w:pStyle', {'w:val': kind.title() + 'Text'})
        r_xml = add(p_xml, 'w:r')
        add(add(r_xml, 'w:rPr'), 'w:rStyle', {'w:val': kind.title() + 'Reference'})
        add(r_xml, 'w:' + kind + 'Ref')
        p_xml.append(text_run(' A generated ' + kind + ' with a note reference.'))
        part(d, kind + 's.xml', CT + kind + 's+xml', REL + kind + 's', root)
    # A complex TOC spans paragraphs, with cached hyperlink results between separate/end.
    p = d.add_paragraph()
    add(add(p._p, 'w:r'), 'w:fldChar', {'w:fldCharType': 'begin'})
    add(add(p._p, 'w:r'), 'w:instrText', {'xml:space': 'preserve'}, ' TOC \\o "1-3" \\h \\z \\u ')
    add(add(p._p, 'w:r'), 'w:fldChar', {'w:fldCharType': 'separate'})
    for level in (1, 2, 3):
        p = d.add_paragraph()
        add(p._p, 'w:hyperlink', {'w:anchor': f'_Toc00000{level}', 'w:history': 1}, children=[text_run(f'Topic {level}\t1')])
    add(add(d.add_paragraph()._p, 'w:r'), 'w:fldChar', {'w:fldCharType': 'end'})
    for level in (1, 2, 3):
        p = d.add_heading(f'Topic {level}', level)
        p._p.insert(1, x('w:bookmarkStart', {'w:id': level, 'w:name': f'_Toc00000{level}'}))
        add(p._p, 'w:bookmarkEnd', {'w:id': level})
    p = d.add_paragraph('Internal link: ')
    add(p._p, 'w:hyperlink', {'w:anchor': '_Toc000001'}, children=[text_run('Go to Topic 1')])
    p = d.add_paragraph('External link: ')
    rid = d.part.relate_to('https://example.com/', REL + 'hyperlink', is_external=True)
    add(p._p, 'w:hyperlink', {'r:id': rid}, children=[text_run('Example website')])
    field(d.add_paragraph('Reference: '), 'REF _Toc000001 \\h', 'Topic 1')
    field(d.add_paragraph('Date: '), 'DATE \\@ "yyyy-MM-dd"', '2024-01-01')
    add(d.add_paragraph('Simple page field: ')._p, 'w:fldSimple', {'w:instr': ' PAGE '}, children=[text_run('1')])
    save(d, 'notes-fields.docx')


def review():
    d = new('Comments and tracked changes')
    p = d.add_paragraph('A comment range: ')
    r = p.add_run('review this phrase')
    c = d.add_comment(r, text='Parent comment: clarify this phrase.', author='Reviewer', initials='RV')
    c._element.set(q('w:date'), STAMP)
    c.paragraphs[0]._p.set(q('w14:paraId'), '10000001')
    p = d.add_paragraph('A resolved comment range: ')
    c2 = d.add_comment(p.add_run('resolved phrase'), text='Resolved after discussion.', author='Editor', initials='ED')
    c2._element.set(q('w:date'), STAMP)
    c2.paragraphs[0]._p.set(q('w14:paraId'), '10000002')
    # Replies live in comments.xml; commentsExtended links their paragraph IDs.
    reply = deepcopy(c._element)
    reply.set(q('w:id'), '2')
    reply.set(q('w:author'), 'Editor')
    reply.set(q('w:initials'), 'ED')
    reply.set(q('w:date'), STAMP)
    reply_p = reply.find(q('w:p'))
    reply_p.set(q('w14:paraId'), '10000003')
    for child in list(reply_p):
        if child.tag != q('w:pPr'):
            reply_p.remove(child)
    reply_p.append(text_run('Reply: suggested wording accepted.'))
    c._element.getparent().append(reply)
    ext = x('w15:commentsEx')
    add(ext, 'w15:commentEx', {'w15:paraId': '10000001', 'w15:done': 0})
    add(ext, 'w15:commentEx', {'w15:paraId': '10000002', 'w15:done': 1})
    add(ext, 'w15:commentEx', {'w15:paraId': '10000003', 'w15:paraIdParent': '10000001', 'w15:done': 0})
    part(d, 'commentsExtended.xml', 'application/vnd.ms-word.commentsExtended+xml', 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended', ext)
    def change(name, ident, children=()):
        return x('w:' + name, {'w:id': ident, 'w:author': 'Editor', 'w:date': STAMP}, children=children)
    p = d.add_paragraph('Tracked text: ')
    p._p.append(change('ins', 10, [text_run('inserted words ')]))
    p._p.append(change('del', 11, [x('w:r', children=[x('w:delText', text='deleted words')])]))
    p = d.add_paragraph()
    r = p.add_run('Formatting changed to bold.')
    r.bold = True
    r._r.get_or_add_rPr().append(change('rPrChange', 12, [x('w:rPr', children=[x('w:b', {'w:val': 0})])]))
    p = d.add_paragraph('Paragraph alignment changed from left to center.')
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p._p.get_or_add_pPr().append(change('pPrChange', 13, [x('w:pPr', children=[x('w:jc', {'w:val': 'left'})])]))
    p = d.add_paragraph('The paragraph mark was inserted.')
    add(p._p.get_or_add_pPr(), 'w:rPr').append(change('ins', 14))
    p = d.add_paragraph('Move source: ')
    add(p._p, 'w:moveFromRangeStart', {'w:id': 20, 'w:name': 'move1', 'w:author': 'Editor', 'w:date': STAMP})
    p._p.append(change('moveFrom', 21, [x('w:r', children=[x('w:delText', text='moved words')])]))
    add(p._p, 'w:moveFromRangeEnd', {'w:id': 20})
    p = d.add_paragraph('Move destination: ')
    add(p._p, 'w:moveToRangeStart', {'w:id': 22, 'w:name': 'move1', 'w:author': 'Editor', 'w:date': STAMP})
    p._p.append(change('moveTo', 23, [text_run('moved words')]))
    add(p._p, 'w:moveToRangeEnd', {'w:id': 22})
    save(d, 'review.docx')


def png():
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    pixels = b''.join(b'\0' + bytes(v for col in range(64) for v in (col * 4, row * 5, 128)) for row in range(48))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 64, 48, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels, 9)) + chunk(b'IEND', b'')


def objects():
    d = new('Pictures, controls, math, and shapes')
    image = png()
    d.add_paragraph('Inline gradient picture:')
    d.add_picture(BytesIO(image), width=Inches(1.25))
    d.add_paragraph('Cropped picture (10% left/right, 15% top/bottom):')
    shape = d.add_picture(BytesIO(image), width=Inches(1.25))
    fill = shape._inline.find('.//' + q('pic:blipFill'))
    fill.insert(1, x('a:srcRect', {'l': 10000, 't': 15000, 'r': 10000, 'b': 15000}))
    p = d.add_paragraph('Floating picture with square wrapping: ')
    inline = p.add_run().add_picture(BytesIO(image), width=Inches(1))._inline
    anchor = x('wp:anchor', {'distT': 0, 'distB': 0, 'distL': 114300, 'distR': 114300, 'simplePos': 0, 'relativeHeight': 0, 'behindDoc': 0, 'locked': 0, 'layoutInCell': 1, 'allowOverlap': 1})
    add(anchor, 'wp:simplePos', {'x': 0, 'y': 0})
    add(add(anchor, 'wp:positionH', {'relativeFrom': 'column'}), 'wp:posOffset', text='2400000')
    add(add(anchor, 'wp:positionV', {'relativeFrom': 'paragraph'}), 'wp:posOffset', text='0')
    anchor.append(deepcopy(inline.find(q('wp:extent'))))
    add(anchor, 'wp:effectExtent', {'l': 0, 't': 0, 'r': 0, 'b': 0})
    add(anchor, 'wp:wrapSquare', {'wrapText': 'bothSides'})
    for name in ('wp:docPr', 'wp:cNvGraphicFramePr', 'a:graphic'):
        anchor.append(deepcopy(inline.find(q(name))))
    inline.getparent().replace(inline, anchor)
    # Block structured document tag, positioned before final sectPr.
    sdt = x('w:sdt')
    pr = add(sdt, 'w:sdtPr')
    add(pr, 'w:alias', {'w:val': 'Address block'})
    add(pr, 'w:tag', {'w:val': 'pulpo.address'})
    add(pr, 'w:id', {'w:val': 100})
    add(sdt, 'w:sdtContent', children=[raw_paragraph('Block control paragraph one.'), raw_paragraph('Block control paragraph two.')])
    d._element.body.insert(len(d._element.body) - 1, sdt)
    p = d.add_paragraph('Inline control: ')
    sdt = add(p._p, 'w:sdt')
    pr = add(sdt, 'w:sdtPr')
    add(pr, 'w:alias', {'w:val': 'Plain text'})
    add(pr, 'w:tag', {'w:val': 'pulpo.plain'})
    add(pr, 'w:id', {'w:val': 101})
    add(pr, 'w:text')
    add(sdt, 'w:sdtContent', children=[text_run('editable plain text')])
    p = d.add_paragraph('Checkbox: ')
    sdt = add(p._p, 'w:sdt')
    pr = add(sdt, 'w:sdtPr')
    add(pr, 'w:id', {'w:val': 102})
    cb = add(pr, 'w14:checkbox')
    add(cb, 'w14:checked', {'w14:val': 1})
    add(cb, 'w14:checkedState', {'w14:val': '2612', 'w14:font': 'MS Gothic'})
    add(cb, 'w14:uncheckedState', {'w14:val': '2610', 'w14:font': 'MS Gothic'})
    add(sdt, 'w:sdtContent', children=[text_run('☒')])
    def mr(text):
        return x('m:r', children=[x('m:t', text=text)])
    math = add(d.add_paragraph()._p, 'm:oMathPara')
    omath = add(math, 'm:oMath')
    add(omath, 'm:f', children=[x('m:num', children=[mr('1')]), x('m:den', children=[mr('2')])])
    omath.append(mr(' + '))
    add(omath, 'm:sSup', children=[x('m:e', children=[mr('x')]), x('m:sup', children=[mr('2')])])
    omath.append(mr(' + '))
    add(omath, 'm:rad', children=[x('m:radPr', children=[x('m:degHide', {'m:val': 1})]), x('m:deg'), x('m:e', children=[mr('y')])])
    omath.append(mr(' + '))
    add(omath, 'm:nary', children=[x('m:naryPr', children=[x('m:chr', {'m:val': '∑'}), x('m:limLoc', {'m:val': 'undOvr'})]), x('m:sub', children=[mr('i=1')]), x('m:sup', children=[mr('n')]), x('m:e', children=[mr('i')])])
    add(d.add_paragraph('Wingdings symbol: ').add_run()._r, 'w:sym', {'w:font': 'Wingdings', 'w:char': 'F04A'})
    p = d.add_paragraph('Text box: ')
    alt = add(p.add_run()._r, 'mc:AlternateContent')
    choice = add(alt, 'mc:Choice', {'Requires': 'wps'}, children=[])
    # Requires is a prefix token and must have its binding in scope.
    drawing = add(choice, 'w:drawing')
    inline = add(drawing, 'wp:inline', {'distT': 0, 'distB': 0, 'distL': 0, 'distR': 0})
    add(inline, 'wp:extent', {'cx': 2743200, 'cy': 685800})
    add(inline, 'wp:docPr', {'id': 4, 'name': 'Text box'})
    graphic = add(inline, 'a:graphic')
    data = add(graphic, 'a:graphicData', {'uri': NS['wps']})
    wsp = add(data, 'wps:wsp')
    add(wsp, 'wps:cNvSpPr', {'txBox': 1})
    sppr = add(wsp, 'wps:spPr')
    transform = add(sppr, 'a:xfrm')
    add(transform, 'a:off', {'x': 0, 'y': 0})
    add(transform, 'a:ext', {'cx': 2743200, 'cy': 685800})
    add(add(sppr, 'a:prstGeom', {'prst': 'rect'}), 'a:avLst')
    add(sppr, 'a:solidFill', children=[x('a:srgbClr', {'val': 'E6EEF8'})])
    add(add(wsp, 'wps:txbx'), 'w:txbxContent', children=[raw_paragraph('DrawingML text box content.')])
    add(wsp, 'wps:bodyPr', {'wrap': 'square'}, children=[x('a:spAutoFit')])
    fallback = add(alt, 'mc:Fallback')
    pict = add(fallback, 'w:pict')
    shape = add(pict, 'v:shape', {'id': 'TextBoxFallback', 'style': 'width:216pt;height:54pt', 'coordsize': '21600,21600', 'path': 'm0,0l21600,0,21600,21600,0,21600xe', 'fillcolor': '#E6EEF8'})
    add(add(shape, 'v:textbox'), 'w:txbxContent', children=[raw_paragraph('VML text box fallback content.')])
    # Rebind extension namespaces at the root for mc:Ignorable/Choice prefix tokens.
    root = etree.Element(d._element.tag, nsmap={**d._element.nsmap, 'wps': NS['wps'], 'v': NS['v']})
    root.attrib.update(d._element.attrib)
    root.set(q('mc:Ignorable'), 'w14 wps')
    root.extend(list(d._element))
    # Preserve python-docx's CT_Document class by parsing through its parser.
    from docx.oxml import parse_xml
    d.part._element = parse_xml(etree.tostring(root))
    save(d, 'objects.docx')


if __name__ == '__main__':
    for generate in (basic, lists, tables, sections, notes, review, objects):
        generate()
