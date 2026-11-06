#!/usr/bin/env python3
"""Prints a JSON snapshot of everything python-pptx can read from a presentation.

    python pptx_inspect.py deck.pptx [--out snapshot.json] [--no-notes] [--compact]

The snapshot is meant for diffing (see pptx_compare.py): lengths are EMU integers,
colors are hex strings or theme names, and anything python-pptx cannot read is
recorded as {"error": "..."} on the object that failed instead of aborting.
Opening a file python-pptx rejects entirely yields {"file": ..., "open_error": ...}
and exit code 2.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path

from lxml import etree
from pptx import Presentation
from pptx.enum.dml import MSO_COLOR_TYPE, MSO_FILL_TYPE
from pptx.enum.shapes import MSO_SHAPE_TYPE, PP_PLACEHOLDER
from pptx.oxml.ns import qn

MAIN_CONTENT_TYPES = (
    'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
    'application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml',
    'application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml',
    'application/vnd.ms-powerpoint.slideshow.macroEnabled.main+xml',
    'application/vnd.openxmlformats-officedocument.presentationml.template.main+xml',
    'application/vnd.ms-powerpoint.template.macroEnabled.main+xml',
)


def err(e: BaseException) -> dict:
    return {'error': f'{type(e).__name__}: {e}'[:300]}


_ERR = object()


def safe(fn, default=_ERR):
    """Runs fn; on failure returns `default`, or an {"error": ...} record when no default is given."""
    try:
        return fn()
    except Exception as e:  # noqa: BLE001 - snapshots record every failure
        return err(e) if default is _ERR else default


XNS = {
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
    'c': 'http://schemas.openxmlformats.org/drawingml/2006/chart',
    'mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006',
    'p14': 'http://schemas.microsoft.com/office/powerpoint/2010/main',
}


def xp(el, expr: str) -> list:
    """XPath with a fixed prefix map (python-pptx's own xpath() takes no namespaces)."""
    return etree._Element.xpath(el, expr, namespaces=XNS)


def enum_name(v):
    if v is None:
        return None
    name = getattr(v, 'name', None)
    return name if name else str(v)


def color(c) -> dict | str | None:
    try:
        t = c.type
    except Exception as e:  # noqa: BLE001
        return err(e)
    if t is None:
        return None
    out: dict = {}
    if t == MSO_COLOR_TYPE.RGB:
        out['rgb'] = str(c.rgb)
    elif t == MSO_COLOR_TYPE.SCHEME:
        out['theme'] = enum_name(c.theme_color)
    else:
        out['type'] = enum_name(t)
        rgb = safe(lambda: str(c.rgb), default='')
        if rgb:
            out['rgb'] = rgb
    b = safe(lambda: c.brightness, default=0)
    if b:
        out['brightness'] = round(b, 4)
    return out


def fill(f) -> dict | None:
    try:
        t = f.type
    except Exception as e:  # noqa: BLE001
        return err(e)
    if t is None:
        return None
    out: dict = {'type': enum_name(t)}
    if t == MSO_FILL_TYPE.SOLID:
        out['color'] = color(f.fore_color)
    elif t == MSO_FILL_TYPE.GRADIENT:
        out['angle'] = safe(lambda: f.gradient_angle, default=None)
        out['stops'] = safe(lambda: [{'pos': round(s.position, 4), 'color': color(s.color)} for s in f.gradient_stops])
        path = f._xPr.find('.//' + qn('a:path')) if hasattr(f, '_xPr') else None
        if path is not None:
            out['path'] = path.get('path')
    elif t == MSO_FILL_TYPE.PATTERNED:
        out['pattern'] = safe(lambda: enum_name(f.pattern))
        out['fore'] = safe(lambda: color(f.fore_color))
        out['back'] = safe(lambda: color(f.back_color))
    return out


def line(ln) -> dict | None:
    out = {
        'width': safe(lambda: int(ln.width)),
        'dash': safe(lambda: enum_name(ln.dash_style)),
        'fill': safe(lambda: fill(ln.fill)),
    }
    try:
        if ln.fill.type == MSO_FILL_TYPE.SOLID:
            out['color'] = color(ln.color)
    except Exception as e:  # noqa: BLE001
        out['color'] = err(e)
    x = ln._ln if hasattr(ln, '_ln') else None
    if x is not None:
        for tag in ('headEnd', 'tailEnd'):
            el = x.find(qn('a:' + tag))
            if el is not None:
                out[tag] = {k: el.get(k) for k in ('type', 'w', 'len') if el.get(k)}
    return {k: v for k, v in out.items() if v is not None}


def font(f) -> dict:
    out = {
        'name': safe(lambda: f.name),
        'size': safe(lambda: f.size.pt if f.size is not None else None),
        'bold': safe(lambda: f.bold),
        'italic': safe(lambda: f.italic),
        'underline': safe(lambda: f.underline if isinstance(f.underline, (bool, type(None))) else enum_name(f.underline)),
        'color': safe(lambda: color(f.color)),
    }
    return {k: v for k, v in out.items() if v is not None}


def text_frame(tf) -> dict:
    out: dict = {}
    body = tf._txBody.bodyPr if hasattr(tf, '_txBody') else None
    if body is not None:
        for attr in ('vert', 'wrap', 'anchor', 'numCol', 'rot', 'lIns', 'tIns', 'rIns', 'bIns'):
            if body.get(attr) is not None:
                out[attr] = body.get(attr)
        na = body.find(qn('a:normAutofit'))
        if na is not None:
            out['autofit'] = {'type': 'normAutofit', **{k: na.get(k) for k in ('fontScale', 'lnSpcReduction') if na.get(k)}}
        elif body.find(qn('a:spAutoFit')) is not None:
            out['autofit'] = {'type': 'spAutoFit'}
        elif body.find(qn('a:noAutofit')) is not None:
            out['autofit'] = {'type': 'noAutofit'}
    paras = []
    for p in tf.paragraphs:
        try:
            pd: dict = {
                'text': p.text if hasattr(p, 'text') else None,
                'level': p.level,
                'alignment': safe(lambda: enum_name(p.alignment)),
                'line_spacing': safe(lambda: p.line_spacing if not hasattr(p.line_spacing, 'pt') else {'pt': p.line_spacing.pt}),
                'space_before': safe(lambda: p.space_before.pt if p.space_before is not None else None),
                'space_after': safe(lambda: p.space_after.pt if p.space_after is not None else None),
            }
            pPr = p._p.pPr
            if pPr is not None:
                for tag in ('buChar', 'buAutoNum', 'buNone', 'buBlip'):
                    el = pPr.find(qn('a:' + tag))
                    if el is not None:
                        pd['bullet'] = {'kind': tag, **dict(el.attrib)}
                if pPr.get('rtl'):
                    pd['rtl'] = pPr.get('rtl')
            runs = []
            for r in p.runs:
                try:
                    rd: dict = {'text': r.text, 'font': font(r.font)}
                    rPr = r._r.rPr
                    if rPr is not None:
                        for attr in ('strike', 'baseline', 'cap', 'spc', 'lang'):
                            if rPr.get(attr) is not None and attr != 'lang':
                                rd[attr] = rPr.get(attr)
                    link = safe(lambda: r.hyperlink.address, default=None)
                    if link:
                        rd['hyperlink'] = link
                    elif rPr is not None and rPr.find(qn('a:hlinkClick')) is not None:
                        rd['hyperlink_action'] = rPr.find(qn('a:hlinkClick')).get('action')
                    runs.append(rd)
                except Exception as e:  # noqa: BLE001
                    runs.append(err(e))
            pd['runs'] = runs
            fields = p._p.findall(qn('a:fld'))
            if fields:
                pd['fields'] = [{'type': f.get('type'), 'text': ''.join(f.itertext())} for f in fields]
            paras.append({k: v for k, v in pd.items() if v is not None})
        except Exception as e:  # noqa: BLE001
            paras.append(err(e))
    out['paragraphs'] = paras
    return out


def table(tbl) -> dict:
    out: dict = {
        'rows': len(tbl.rows),
        'cols': len(tbl.columns),
        'col_widths': [int(c.width) for c in tbl.columns],
        'row_heights': [int(r.height) for r in tbl.rows],
        'first_row': tbl.first_row,
        'first_col': tbl.first_col,
        'last_row': tbl.last_row,
        'last_col': tbl.last_col,
        'horz_banding': tbl.horz_banding,
        'vert_banding': tbl.vert_banding,
    }
    sid = tbl._tbl.tblPr.find(qn('a:tableStyleId')) if tbl._tbl.tblPr is not None else None
    out['style_id'] = sid.text if sid is not None else None
    cells = []
    for r in range(len(tbl.rows)):
        row = []
        for c in range(len(tbl.columns)):
            try:
                cell = tbl.cell(r, c)
                cd: dict = {'text': cell.text}
                if cell.is_merge_origin:
                    cd['span'] = [cell.span_height, cell.span_width]
                if cell.is_spanned:
                    cd['spanned'] = True
                f = safe(lambda: fill(cell.fill))
                if f:
                    cd['fill'] = f
                row.append(cd)
            except Exception as e:  # noqa: BLE001
                row.append(err(e))
        cells.append(row)
    out['cells'] = cells
    return out


def _is_number(s: str) -> bool:
    try:
        float(s)
        return True
    except ValueError:
        return False


def chart(ch) -> dict:
    out: dict = {
        'type': safe(lambda: enum_name(ch.chart_type)),
        'has_title': safe(lambda: ch.has_title),
        'has_legend': safe(lambda: ch.has_legend),
    }
    if out['has_title'] is True:
        out['title'] = safe(lambda: ch.chart_title.text_frame.text if ch.chart_title.has_text_frame else None)
    plots = []
    for plot in safe(lambda: list(ch.plots), default=[]):
        pd: dict = {'categories': safe(lambda: [str(c) for c in plot.categories])}
        series = []
        for s in safe(lambda: list(plot.series), default=[]):
            sd: dict = {'name': safe(lambda: s.name), 'values': safe(lambda: [v for v in s.values])}
            xs = xp(s._element, './c:xVal//c:pt/c:v/text()') if hasattr(s, '_element') else []
            if xs:
                sd['x'] = [float(x) if _is_number(x) else x for x in xs]
            series.append(sd)
        pd['series'] = series
        plots.append(pd)
    out['plots'] = plots
    return out


def picture(pic) -> dict:
    out: dict = {}
    img = safe(lambda: pic.image, default=None)
    if isinstance(img, dict) or img is None:
        out['image'] = img if isinstance(img, dict) else None
        if img is None:
            out['image'] = {'error': 'no image'}
    else:
        out['image'] = {
            'sha256': hashlib.sha256(img.blob).hexdigest(),
            'content_type': img.content_type,
            'bytes': len(img.blob),
            'size_px': safe(lambda: list(img.size)),
        }
    out['crop'] = {k: round(safe(lambda k=k: getattr(pic, 'crop_' + k), default=0) or 0, 5) for k in ('left', 'top', 'right', 'bottom')}
    descr = xp(pic._element, './p:nvPicPr/p:cNvPr/@descr')
    if descr:
        out['descr'] = descr[0]
    return out


def xfrm_flags(shape) -> dict:
    out = {}
    try:
        x = xp(shape._element, './p:spPr/a:xfrm | ./p:grpSpPr/a:xfrm | ./p:xfrm')
        if x:
            for k in ('flipH', 'flipV'):
                if x[0].get(k) in ('1', 'true'):
                    out[k.lower()] = True
    except Exception:  # noqa: BLE001
        pass
    return out


def shape_info(shape, depth=0) -> dict:
    d: dict = {}
    try:
        d['id'] = safe(lambda: shape.shape_id)
        d['name'] = safe(lambda: shape.name)
        d['type'] = safe(lambda: enum_name(shape.shape_type))
        for k in ('left', 'top', 'width', 'height'):
            v = safe(lambda k=k: getattr(shape, k), default=None)
            d[k] = int(v) if v is not None and not isinstance(v, dict) else v
        rot = safe(lambda: shape.rotation, default=0)
        if rot:
            d['rotation'] = round(rot, 4)
        d.update(xfrm_flags(shape))
        if safe(lambda: shape.is_placeholder, default=False):
            pf = shape.placeholder_format
            d['placeholder'] = {'type': safe(lambda: enum_name(pf.type)), 'idx': safe(lambda: pf.idx)}
        st = shape.shape_type if not isinstance(d.get('type'), dict) else None
        if shape._element.tag == qn('p:sp'):
            d['auto_shape_type'] = safe(lambda: enum_name(shape.auto_shape_type), default=None)
        if xp(shape._element, './p:spPr/a:custGeom'):
            d['geometry'] = 'custom'
        if hasattr(shape, 'adjustments') and not d.get('placeholder'):
            adj = safe(lambda: [round(a, 5) for a in shape.adjustments], default=[])
            if adj:
                d['adjustments'] = adj
        if hasattr(shape, 'fill') and st not in (MSO_SHAPE_TYPE.GROUP,):
            f = safe(lambda: fill(shape.fill))
            if f:
                d['fill'] = f
        if hasattr(shape, 'line') and st not in (MSO_SHAPE_TYPE.GROUP,):
            ln = safe(lambda: line(shape.line))
            if ln:
                d['line'] = ln
        if safe(lambda: shape.has_text_frame, default=False) is True:
            d['text_frame'] = safe(lambda: text_frame(shape.text_frame))
        if safe(lambda: shape.has_table, default=False) is True:
            d['table'] = safe(lambda: table(shape.table))
        if safe(lambda: shape.has_chart, default=False) is True:
            d['chart'] = safe(lambda: chart(shape.chart))
        if st == MSO_SHAPE_TYPE.PICTURE or (st == MSO_SHAPE_TYPE.PLACEHOLDER and hasattr(shape, 'image')):
            d['picture'] = safe(lambda: picture(shape))
        if st == MSO_SHAPE_TYPE.MEDIA:
            d['media'] = safe(lambda: {'type': enum_name(shape.media_type)})
        if st in (MSO_SHAPE_TYPE.GROUP,):
            if depth > 64:
                d['children'] = {'error': 'group nesting deeper than 64'}
            else:
                d['children'] = [shape_info(s, depth + 1) for s in shape.shapes]
        link = safe(lambda: shape.click_action.hyperlink.address, default=None) if st != MSO_SHAPE_TYPE.GROUP else None
        if link:
            d['click_hyperlink'] = link
        if shape._element.tag == qn('p:graphicFrame'):
            uri = xp(shape._element, './a:graphic/a:graphicData/@uri')
            if uri:
                d['graphic_uri'] = uri[0]
        if st == MSO_SHAPE_TYPE.LINE or shape._element.tag == qn('p:cxnSp'):
            st_c = xp(shape._element, './p:nvCxnSpPr/p:cNvCxnSpPr/a:stCxn')
            en_c = xp(shape._element, './p:nvCxnSpPr/p:cNvCxnSpPr/a:endCxn')
            if st_c:
                d['begin_connect'] = {'id': st_c[0].get('id'), 'idx': st_c[0].get('idx')}
            if en_c:
                d['end_connect'] = {'id': en_c[0].get('id'), 'idx': en_c[0].get('idx')}
    except Exception as e:  # noqa: BLE001
        d.update(err(e))
    return {k: v for k, v in d.items() if v is not None}


def slide_extras(slide) -> dict:
    out: dict = {}
    sld = slide._element
    tr = sld.find(qn('p:transition'))
    if tr is None:
        alt = xp(sld, './mc:AlternateContent//p:transition')
        tr = alt[-1] if alt else None
    if tr is not None:
        kinds = [c.tag.split('}')[1] for c in tr if isinstance(c.tag, str)]
        out['transition'] = {**{k: tr.get(k) for k in ('spd', 'advTm', 'advClick', 'dur') if tr.get(k)}, 'kind': kinds[0] if kinds else None}
    timing = sld.find(qn('p:timing'))
    if timing is not None:
        out['animation_targets'] = sorted({int(x) for x in xp(timing, './/p:spTgt/@spid') if x.isdigit()})
    bg = sld.find(qn('p:cSld') + '/' + qn('p:bg'))
    if bg is not None:
        out['background'] = safe(lambda: fill(slide.background.fill)) if bg.find(qn('p:bgPr')) is not None else {'ref': True}
    comments = [r for r in slide.part.rels.values() if r.reltype.endswith('/comments') or r.reltype.endswith('/comments')]
    modern = [r for r in slide.part.rels.values() if r.reltype.endswith('/modernComment') or 'modernComment' in r.reltype]
    if comments or modern:
        cms = []
        for r in comments + modern:
            try:
                from lxml import etree
                root = etree.fromstring(r.target_part.blob)
                for cm in root.iter('{*}cm'):
                    t = cm.find('{*}text')
                    if t is None:
                        t = cm.find('.//{*}txBody')
                    cms.append({'author': cm.get('authorId'), 'text': ''.join(t.itertext()).strip() if t is not None else None})
            except Exception as e:  # noqa: BLE001
                cms.append(err(e))
        out['comments'] = cms
    return out


def sections(prs) -> list | None:
    pres = prs.part._element
    secs = xp(pres, './p:extLst/p:ext/p14:sectionLst/p14:section')
    if not secs:
        return None
    return [{'name': s.get('name'), 'slide_ids': [int(x) for x in xp(s, './*[local-name()="sldIdLst"]/*/@id')]} for s in secs]


def package_info(path: Path) -> dict:
    out: dict = {}
    try:
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            ct = z.read('[Content_Types].xml').decode('utf-8', 'replace')
            for c in MAIN_CONTENT_TYPES:
                if c in ct:
                    out['main_content_type'] = c
                    break
            out['part_count'] = len(names)
            out['has_vba'] = any(n.lower().endswith('vbaproject.bin') for n in names)
            out['media'] = sorted(n for n in names if n.startswith('ppt/media/'))
            out['smartart_parts'] = sorted(n for n in names if n.startswith('ppt/diagrams/'))
    except Exception as e:  # noqa: BLE001
        out.update(err(e))
    return out


def _with_presentation_content_type(path: Path):
    """python-pptx rejects templates (.potx/.potm); re-label the main part so it can still be read."""
    try:
        src = zipfile.ZipFile(path)
        ct = src.read('[Content_Types].xml')
        main = MAIN_CONTENT_TYPES[0].encode()
        new_ct = ct
        for c in MAIN_CONTENT_TYPES[1:]:
            new_ct = new_ct.replace(c.encode(), main)
        if new_ct == ct:
            return None
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as out:
            for info in src.infolist():
                out.writestr(info.filename, new_ct if info.filename == '[Content_Types].xml' else src.read(info.filename))
        buf.seek(0)
        return buf
    except Exception:  # noqa: BLE001
        return None


def inspect(path: Path, include_notes: bool = True) -> dict:
    snap: dict = {'file': path.name, 'package': package_info(path)}
    try:
        prs = Presentation(str(path))
    except Exception as e:  # noqa: BLE001
        prs = None
        first_error = f'{type(e).__name__}: {e}'[:300]
        patched = _with_presentation_content_type(path)
        if patched is not None:
            try:
                prs = Presentation(patched)
                snap['opened_with_patched_content_type'] = True
            except Exception:  # noqa: BLE001
                prs = None
        if prs is None:
            snap['open_error'] = first_error
            return snap
    snap['slide_size'] = safe(lambda: [int(prs.slide_width), int(prs.slide_height)] if prs.slide_width is not None else None)
    cp = prs.core_properties
    snap['core'] = {
        k: safe(lambda k=k: (lambda v: v.isoformat() if hasattr(v, 'isoformat') else v)(getattr(cp, k)))
        for k in ('title', 'subject', 'author', 'keywords', 'category', 'comments', 'last_modified_by', 'revision', 'created', 'modified')
    }
    snap['masters'] = safe(lambda: [{'name': safe(lambda m=m: m.name), 'layouts': [l.name for l in m.slide_layouts]} for m in prs.slide_masters])
    snap['sections'] = safe(lambda: sections(prs))
    slides = []
    try:
        slide_list = list(prs.slides)
    except Exception as e:  # noqa: BLE001
        snap['slides'] = err(e)
        return snap
    for i, slide in enumerate(slide_list):
        sd: dict = {'index': i}
        try:
            sd['slide_id'] = safe(lambda: slide.slide_id)
            sd['partname'] = safe(lambda: str(slide.part.partname))
            sd['layout'] = safe(lambda: slide.slide_layout.name)
            sd['hidden'] = slide._element.get('show') in ('0', 'false')
            sd['shapes'] = [shape_info(s) for s in safe(lambda: list(slide.shapes), default=[])]
            sd.update(slide_extras(slide))
            if include_notes and safe(lambda: slide.has_notes_slide, default=False) is True:
                sd['notes'] = safe(lambda: slide.notes_slide.notes_text_frame.text if slide.notes_slide.notes_text_frame is not None else None)
        except Exception as e:  # noqa: BLE001
            sd.update(err(e))
        slides.append({k: v for k, v in sd.items() if v is not None})
    snap['slides'] = slides
    return snap


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('file', type=Path)
    ap.add_argument('--out', type=Path, help='write JSON here instead of stdout')
    ap.add_argument('--no-notes', action='store_true')
    ap.add_argument('--compact', action='store_true', help='single-line JSON')
    args = ap.parse_args(argv)
    sys.setrecursionlimit(10000)
    snap = inspect(args.file, include_notes=not args.no_notes)
    text = json.dumps(snap, ensure_ascii=False, indent=None if args.compact else 2, default=str)
    if args.out:
        args.out.write_text(text + '\n', encoding='utf-8')
    else:
        sys.stdout.write(text + '\n')
    return 2 if 'open_error' in snap else 0


if __name__ == '__main__':
    sys.exit(main())
