import sys, datetime, io
import openpyxl
from openpyxl.styles import Font, PatternFill, Border, Side, Alignment
from openpyxl.formatting.rule import ColorScaleRule, DataBarRule, CellIsRule, IconSetRule
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.comments import Comment
from openpyxl.chart import BarChart, LineChart, PieChart, Reference
from openpyxl.drawing.image import Image as XLImage
from PIL import Image, ImageDraw

wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Budget"
ws["A1"] = "Quarterly budget"
ws["A1"].font = Font(size=18, bold=True, color="1F4E79")
ws.merge_cells("A1:G1")
ws["A2"] = "Prepared"
ws["B2"] = datetime.date(2026, 11, 4)
ws["B2"].number_format = "mmm d, yyyy"
headers = ["Category", "Owner", "Q1", "Q2", "Q3", "Q4", "Total", "Change", "Status"]
for col, header in enumerate(headers, 1):
    cell = ws.cell(row=4, column=col, value=header)
    cell.font = Font(bold=True, color="FFFFFF")
    cell.fill = PatternFill("solid", fgColor="2F5597")
    cell.alignment = Alignment(horizontal="center")
rows = [
    ("Salaries", "Ana", 120000, 122000, 125000, 128000),
    ("Rent", "Ben", 24000, 24000, 24000, 25200),
    ("Software", "Chen", 8400, 9100, 9900, 10400),
    ("Travel", "Dana", 5200, 7800, 3100, 6400),
    ("Marketing", "Eli", 15000, 18500, 21000, 26000),
    ("Equipment", "Fay", 9000, 1200, 4300, 2100),
    ("Training", "Gus", 3000, 3500, 2800, 4100),
    ("Contingency", "Hana", 5000, 5000, 5000, 5000),
]
thin = Side(style="thin", color="BFBFBF")
for index, (name, owner, *quarters) in enumerate(rows):
    r = 5 + index
    ws.cell(row=r, column=1, value=name)
    ws.cell(row=r, column=2, value=owner)
    for q, value in enumerate(quarters):
        c = ws.cell(row=r, column=3 + q, value=value)
        c.number_format = '"$"#,##0'
    ws.cell(row=r, column=7, value=f"=SUM(C{r}:F{r})").number_format = '"$"#,##0'
    ws.cell(row=r, column=8, value=f"=(F{r}-C{r})/C{r}").number_format = "0.0%"
    ws.cell(row=r, column=9, value=["On track", "Over", "Under"][index % 3])
    for col in range(1, 10):
        ws.cell(row=r, column=col).border = Border(bottom=thin)
total = 5 + len(rows)
ws.cell(row=total, column=1, value="Total").font = Font(bold=True)
for col in "CDEFG":
    c = ws[f"{col}{total}"]
    c.value = f"=SUM({col}5:{col}{total-1})"
    c.number_format = '"$"#,##0'
    c.font = Font(bold=True)
    c.border = Border(top=Side(style="thin"), bottom=Side(style="double"))
ws.column_dimensions["A"].width = 16
ws.column_dimensions["B"].width = 10
for col in "CDEFG":
    ws.column_dimensions[col].width = 12
ws.column_dimensions["I"].width = 11
ws.freeze_panes = "A5"
ws.conditional_formatting.add(f"G5:G{total-1}", DataBarRule(start_type="min", end_type="max", color="5B9BD5"))
ws.conditional_formatting.add(f"H5:H{total-1}", ColorScaleRule(start_type="min", start_color="F8696B", mid_type="num", mid_value=0, mid_color="FFFFFF", end_type="max", end_color="63BE7B"))
ws.conditional_formatting.add(f"F5:F{total-1}", IconSetRule("3Arrows", "percent", [0, 33, 67]))
dv = DataValidation(type="list", formula1='"On track,Over,Under"', allow_blank=True)
ws.add_data_validation(dv)
dv.add(f"I5:I{total-1}")
ws["A6"].comment = Comment("Includes the new office lease from Q4.", "Ana")
ws["K4"] = "Docs"
ws["K5"] = "Budget policy"
ws["K5"].hyperlink = "https://example.com/policy"
ws["K5"].font = Font(color="0563C1", underline="single")

chart = BarChart()
chart.type = "col"
chart.title = "Spending by quarter"
chart.y_axis.title = "USD"
data = Reference(ws, min_col=3, max_col=6, min_row=4, max_row=8)
cats = Reference(ws, min_col=1, min_row=5, max_row=8)
chart.add_data(data, titles_from_data=True)
chart.set_categories(cats)
chart.height = 7.5
chart.width = 15
ws.add_chart(chart, "B16")

trend = wb.create_sheet("Trend")
trend.append(["Month", "Revenue", "Cost"])
for month in range(1, 13):
    trend.append([datetime.date(2026, month, 1), 40000 + month * 3200 + (month % 3) * 1500, 30000 + month * 1800])
for r in range(2, 14):
    trend[f"A{r}"].number_format = "mmm yyyy"
    trend[f"B{r}"].number_format = '"$"#,##0'
    trend[f"C{r}"].number_format = '"$"#,##0'
trend.column_dimensions["A"].width = 12
trend.column_dimensions["B"].width = 12
trend.column_dimensions["C"].width = 12
line = LineChart()
line.title = "Revenue and cost"
line.add_data(Reference(trend, min_col=2, max_col=3, min_row=1, max_row=13), titles_from_data=True)
line.set_categories(Reference(trend, min_col=1, min_row=2, max_row=13))
line.height = 7.5
line.width = 15
trend.add_chart(line, "E2")
pie = PieChart()
pie.title = "Q4 split"
pie.add_data(Reference(ws, min_col=6, min_row=5, max_row=12))
pie.set_categories(Reference(ws, min_col=1, min_row=5, max_row=12))
pie.height = 7.5
pie.width = 10
trend.add_chart(pie, "E18")
trend.sheet_properties.tabColor = "70AD47"

notes = wb.create_sheet("Notes")
notes["A1"] = "Wrapped text keeps long notes readable inside a single cell, like this one."
notes["A1"].alignment = Alignment(wrap_text=True, vertical="top")
notes.column_dimensions["A"].width = 30
notes.row_dimensions[1].height = 48
notes["A3"] = "Rotated"
notes["A3"].alignment = Alignment(text_rotation=45)
notes["B3"] = "Center"
notes["B3"].alignment = Alignment(horizontal="center", vertical="center")
notes["A5"] = "Logo"
img = Image.new("RGB", (120, 60), "#1F4E79")
ImageDraw.Draw(img).ellipse((10, 10, 50, 50), fill="#FFC000")
buffer = io.BytesIO(); img.save(buffer, format="PNG"); buffer.seek(0)
xl_image = XLImage(buffer)
notes.add_image(xl_image, "B5")
wb.save(sys.argv[1])
