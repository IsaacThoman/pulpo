# Chart fixtures

Chart parts (`ppt/charts/chartN.xml`) used by `../chart.test.ts`.

## Generated with python-pptx

`clustered-column`, `stacked-bar`, `percent-stacked-column`, `line-markers`, `pie`, `doughnut`,
`stacked-area`, `scatter`, `bubble`, and `radar` come from python-pptx's chart API via
`generate-fixtures.py`. To regenerate them, use a virtual environment outside the repo:

```sh
python3 -m venv /tmp/pptx-chart-venv
/tmp/pptx-chart-venv/bin/pip install python-pptx
/tmp/pptx-chart-venv/bin/python generate-fixtures.py --deck /tmp/charts.pptx
```

`--deck` also saves the deck (one chart per slide, in the order above), so you can compare against
LibreOffice: `soffice --headless --convert-to pdf --outdir /tmp/charts /tmp/charts.pptx`.

## Hand-written

These copy what PowerPoint 2016+ writes, which python-pptx does not produce:

- `powerpoint-combo-multilevel.xml`: clustered columns plus a line on a secondary axis (`crosses
  max`), multi-level categories (`c:multiLvlStrCache`), explicit `c:spPr`/`c:txPr` in the Office
  2013 style, data labels with a custom number format and one deleted point label, a gap in the
  data, a title with `&` and `<`, `c14:style` inside `mc:AlternateContent`, and `c16`/`c16r3`
  extension lists.
- `powerpoint-pie-exploded.xml`: a pie with per-point fills, one exploded slice, `firstSliceAng`,
  category-and-percent labels split by a newline separator, a deleted legend entry, a manually
  laid out legend, and a deleted automatic title.
