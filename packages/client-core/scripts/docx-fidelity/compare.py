#!/usr/bin/env python3
"""Compare python-docx's readable document model, not ZIP bytes or rendered pixels."""
import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from lxml import etree


MISSING = '<missing>'


def scalar(value):
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, int):
        return int(value)  # Length values remain exact EMUs, enum values become integers.
    if isinstance(value, float):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def runs(paragraph):
    result = []
    # iter_inner_content also exposes hyperlink runs, unlike paragraph.runs.
    for item in paragraph.iter_inner_content():
        for run in ([item] if hasattr(item, 'font') else item.runs):
            if not run.text:
                continue
            font = run.font
            fmt = {name: scalar(getattr(font, name)) for name in (
                'bold', 'italic', 'underline', 'strike', 'double_strike',
                'superscript', 'subscript', 'small_caps', 'all_caps', 'name', 'size',
                'highlight_color',
            )}
            fmt['color'] = {'rgb': str(font.color.rgb) if font.color.rgb is not None else None,
                            'theme': scalar(font.color.theme_color)}
            if result and result[-1]['format'] == fmt:
                result[-1]['text'] += run.text
            else:
                result.append({'text': run.text, 'format': fmt})
    return result


def alignment(p):
    try:
        return scalar(p.alignment)
    except ValueError:
        # Word permits start/end, which python-docx 1.2's enum does not yet map.
        pr = p._p.pPr
        jc = pr.find(qn('w:jc')) if pr is not None else None
        return jc.get(qn('w:val')) if jc is not None else None


def paragraph(p):
    fmt = p.paragraph_format
    return {
        'text': p.text,
        'style': p.style.name if p.style is not None else None,
        'alignment': alignment(p),
        'format': {name: scalar(getattr(fmt, name)) for name in (
            'left_indent', 'right_indent', 'first_line_indent', 'space_before',
            'space_after', 'line_spacing', 'line_spacing_rule',
        )},
        'runs': runs(p),
    }


def table(t):
    rows = []
    for row in t.rows:
        cells = []
        # Physical XML cells preserve merge continuations; row.cells aliases merged cells.
        for tc in row._tr.tc_lst:
            from docx.table import _Cell
            cell = _Cell(tc, t)
            pr = tc.tcPr
            span = pr.find(qn('w:gridSpan')) if pr is not None else None
            merge = pr.find(qn('w:vMerge')) if pr is not None else None
            cells.append({
                'text': cell.text,
                'gridSpan': int(span.get(qn('w:val'), '1')) if span is not None else 1,
                'vMerge': merge.get(qn('w:val'), 'continue') if merge is not None else None,
                'paragraphs': [paragraph(p) for p in cell.paragraphs],
                'tables': [table(nested) for nested in cell.tables],
            })
        rows.append({'gridBefore': row.grid_cols_before, 'gridAfter': row.grid_cols_after,
                     'cellTexts': [cell.text for cell in row.cells], 'cells': cells})
    return {'rows': len(t.rows), 'cols': len(t.columns), 'contents': rows}


def snapshot(path):
    d = Document(path)
    sections = []
    for section in d.sections:
        item = {name: scalar(getattr(section, name)) for name in (
            'page_width', 'page_height', 'orientation', 'top_margin', 'right_margin',
            'bottom_margin', 'left_margin', 'header_distance', 'footer_distance',
            'start_type', 'different_first_page_header_footer',
        )}
        for story in ('header', 'footer', 'first_page_header', 'first_page_footer',
                      'even_page_header', 'even_page_footer'):
            item[story] = [p.text for p in getattr(section, story).paragraphs]
        sections.append(item)
    notes = 0
    for relationship in d.part.rels.values():
        if relationship.reltype.endswith('/footnotes') and not relationship.is_external:
            # No network/entity resolution while inspecting third-party packages.
            root = etree.fromstring(relationship.target_part.blob,
                                    etree.XMLParser(resolve_entities=False, no_network=True))
            notes += sum(1 for el in root if el.tag == qn('w:footnote')
                         and el.get(qn('w:type'), 'normal') == 'normal'
                         and el.get(qn('w:id')) not in ('-1', '0'))
    comments = None
    if hasattr(d, 'comments'):
        comments = [{name: scalar(getattr(c, name)) for name in
                     ('author', 'initials', 'text', 'timestamp')} for c in d.comments]
    return {
        'paragraphs': [paragraph(p) for p in d.paragraphs],
        'tables': [table(t) for t in d.tables],
        'sections': sections,
        'inlineShapes': {'count': len(d.inline_shapes), 'sizes': [
            {'width': int(shape.width), 'height': int(shape.height)} for shape in d.inline_shapes]},
        'comments': comments,
        'footnoteCount': notes,
    }


def differences(a, b, path='$'):
    if isinstance(a, dict) and isinstance(b, dict):
        for key in sorted(a.keys() | b.keys()):
            if key not in a or key not in b:
                yield {'path': f'{path}.{key}', 'original': a.get(key, MISSING),
                       'exported': b.get(key, MISSING)}
            else:
                yield from differences(a[key], b[key], f'{path}.{key}')
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            yield {'path': path + '.length', 'original': len(a), 'exported': len(b)}
        for i in range(max(len(a), len(b))):
            if i >= len(a) or i >= len(b):
                yield {'path': f'{path}[{i}]', 'original': a[i] if i < len(a) else MISSING,
                       'exported': b[i] if i < len(b) else MISSING}
            else:
                yield from differences(a[i], b[i], f'{path}[{i}]')
    elif a != b:
        yield {'path': path, 'original': a, 'exported': b}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('original', type=Path)
    parser.add_argument('exported', type=Path)
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()
    try:
        diffs = list(differences(snapshot(args.original), snapshot(args.exported)))
    except Exception as exc:
        diffs = [{'path': '$', 'error': f'{type(exc).__name__}: {exc}'}]
    if args.json:
        print(json.dumps({'ok': not diffs, 'differences': diffs}, ensure_ascii=False, indent=2))
    elif not diffs:
        print('No differences.')
    else:
        print(f'{len(diffs)} difference(s):')
        for diff in diffs:
            if 'error' in diff:
                print(f"  {diff['path']}: {diff['error']}")
            else:
                print(f"  {diff['path']}: {json.dumps(diff['original'], ensure_ascii=False)} -> "
                      f"{json.dumps(diff['exported'], ensure_ascii=False)}")
    return 1 if diffs else 0


if __name__ == '__main__':
    sys.exit(main())
