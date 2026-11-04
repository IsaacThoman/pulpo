"""Generates the python-pptx chart fixtures in this folder.

Usage (from any directory, with python-pptx installed in a venv outside the repo):
    python3 -m venv /tmp/pptx-chart-venv && /tmp/pptx-chart-venv/bin/pip install python-pptx
    /tmp/pptx-chart-venv/bin/python generate-fixtures.py [--deck /tmp/charts.pptx]

Writes one `<name>.xml` chart part per chart next to this script, and optionally the whole deck
(one chart per slide, in the same order) so it can be compared against LibreOffice's rendering.
"""

import argparse
import pathlib

from pptx import Presentation
from pptx.chart.data import BubbleChartData, CategoryChartData, XyChartData
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION, XL_MARKER_STYLE, XL_LABEL_POSITION
from pptx.util import Inches

HERE = pathlib.Path(__file__).resolve().parent


def category_data(categories, series, number_format="General"):
    data = CategoryChartData(number_format=number_format)
    data.categories = categories
    for name, values in series:
        data.add_series(name, values)
    return data


QUARTERS = ["Q1", "Q2", "Q3", "Q4"]
SALES = [("East", (19.2, 21.4, 16.7, 25.0)), ("West", (22.3, 28.6, 15.2, 18.9)), ("North", (12.0, 14.5, 18.1, 21.3))]


def clustered_column(slide):
    chart = add(slide, XL_CHART_TYPE.COLUMN_CLUSTERED, category_data(QUARTERS, SALES))
    chart.has_legend = True
    chart.legend.position = XL_LEGEND_POSITION.BOTTOM
    chart.legend.include_in_layout = False
    chart.has_title = True
    chart.chart_title.text_frame.text = "Regional sales"
    return chart


def stacked_bar(slide):
    chart = add(slide, XL_CHART_TYPE.BAR_STACKED, category_data(QUARTERS, SALES))
    chart.has_legend = True
    chart.legend.position = XL_LEGEND_POSITION.RIGHT
    return chart


def percent_stacked_column(slide):
    chart = add(slide, XL_CHART_TYPE.COLUMN_STACKED_100, category_data(QUARTERS, SALES))
    chart.has_legend = True
    chart.legend.position = XL_LEGEND_POSITION.TOP
    return chart


def line_markers(slide):
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    data = category_data(months, [
        ("2025", (4.1, 5.0, 6.2, 5.8, 7.4, 8.8, 9.9, 9.1, 7.7, 6.0, 4.9, 4.2)),
        ("2026", (3.8, 4.4, 5.9, 6.6, 8.1, 9.6, 10.8, None, 8.3, 6.9, 5.1, 4.6)),
    ], number_format="0.0")
    chart = add(slide, XL_CHART_TYPE.LINE_MARKERS, data)
    chart.has_legend = True
    chart.legend.position = XL_LEGEND_POSITION.BOTTOM
    chart.legend.include_in_layout = False
    chart.plots[0].series[1].marker.style = XL_MARKER_STYLE.SQUARE
    chart.plots[0].series[1].smooth = True
    return chart


def pie(slide):
    data = category_data(["Rent", "Food", "Transport", "Savings", "Other"], [("Budget", (0.35, 0.25, 0.15, 0.15, 0.10))], number_format="0%")
    chart = add(slide, XL_CHART_TYPE.PIE, data)
    chart.has_legend = True
    chart.legend.position = XL_LEGEND_POSITION.RIGHT
    plot = chart.plots[0]
    plot.has_data_labels = True
    plot.data_labels.number_format = "0%"
    plot.data_labels.number_format_is_linked = False
    plot.data_labels.position = XL_LABEL_POSITION.OUTSIDE_END
    plot.series[0].points[3].format.fill.solid()
    return chart


def doughnut(slide):
    data = category_data(["Done", "In progress", "Blocked"], [("Tasks", (42, 17, 6))])
    chart = add(slide, XL_CHART_TYPE.DOUGHNUT, data)
    chart.has_legend = True
    chart.legend.position = XL_LEGEND_POSITION.BOTTOM
    chart.plots[0].has_data_labels = True
    chart.plots[0].data_labels.show_value = True
    return chart


def area(slide):
    data = category_data(["2019", "2020", "2021", "2022", "2023", "2024"], [
        ("Mobile", (120, 180, 260, 310, 420, 510)),
        ("Desktop", (300, 290, 270, 250, 240, 220)),
    ], number_format="#,##0")
    chart = add(slide, XL_CHART_TYPE.AREA_STACKED, data)
    chart.has_legend = True
    chart.legend.position = XL_LEGEND_POSITION.BOTTOM
    return chart


def scatter(slide):
    data = XyChartData()
    first = data.add_series("Trial A")
    for x, y in [(0.5, 1.2), (1.1, 2.3), (1.9, 2.9), (2.7, 4.4), (3.6, 4.9), (4.2, 6.1)]:
        first.add_data_point(x, y)
    second = data.add_series("Trial B")
    for x, y in [(0.3, 0.4), (1.4, 1.1), (2.2, 1.9), (3.1, 2.2), (4.4, 3.5), (5.0, -0.8)]:
        second.add_data_point(x, y)
    chart = add(slide, XL_CHART_TYPE.XY_SCATTER, data)
    chart.has_legend = True
    chart.legend.position = XL_LEGEND_POSITION.BOTTOM
    return chart


def bubble(slide):
    data = BubbleChartData()
    series = data.add_series("Markets")
    for x, y, size in [(1, 4, 10), (2.5, 6, 25), (4, 3, 15), (5.5, 8, 40)]:
        series.add_data_point(x, y, size)
    return add(slide, XL_CHART_TYPE.BUBBLE, data)


def radar(slide):
    data = category_data(["Speed", "Power", "Range", "Comfort", "Price"], [
        ("Model X", (4, 3, 5, 2, 3)),
        ("Model Y", (2, 5, 3, 4, 4)),
    ])
    chart = add(slide, XL_CHART_TYPE.RADAR_MARKERS, data)
    chart.has_legend = True
    chart.legend.position = XL_LEGEND_POSITION.BOTTOM
    return chart


def add(slide, chart_type, data):
    frame = slide.shapes.add_chart(chart_type, Inches(0.5), Inches(0.5), Inches(9), Inches(6.5), data)
    return frame.chart


FIXTURES = [
    ("clustered-column", clustered_column),
    ("stacked-bar", stacked_bar),
    ("percent-stacked-column", percent_stacked_column),
    ("line-markers", line_markers),
    ("pie", pie),
    ("doughnut", doughnut),
    ("stacked-area", area),
    ("scatter", scatter),
    ("bubble", bubble),
    ("radar", radar),
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--deck", help="also save the deck here")
    args = parser.parse_args()
    deck = Presentation()
    deck.slide_width = Inches(10)
    deck.slide_height = Inches(7.5)
    for name, build in FIXTURES:
        slide = deck.slides.add_slide(deck.slide_layouts[6])
        chart = build(slide)
        (HERE / f"{name}.xml").write_bytes(chart.part.blob)
    if args.deck:
        deck.save(args.deck)


if __name__ == "__main__":
    main()
