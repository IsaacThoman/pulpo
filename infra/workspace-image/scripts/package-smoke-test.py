"""Exercise bundled packages without downloads, using real artifact round trips."""
import tempfile
from pathlib import Path
import sys
import subprocess

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import nbformat
from nbclient import NotebookClient
from jupyter_client.kernelspec import KernelSpecManager
from openpyxl import Workbook
from PIL import Image
from docx import Document
from pptx import Presentation
from pypdf import PdfReader
import pdfplumber
from reportlab.pdfgen import canvas

assert sys.prefix == "/opt/pulpo/python", sys.prefix
assert KernelSpecManager().get_kernel_spec("python3").argv[0] == "/opt/pulpo/python/bin/python"
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    frame = pd.DataFrame({"value": np.array([1, 2, 3])})
    frame.to_excel(root / "data.xlsx", index=False)
    assert pd.read_excel(root / "data.xlsx")["value"].sum() == 6
    plt.plot(frame["value"])
    plt.savefig(root / "plot.png")
    plt.close()
    with Image.open(root / "plot.png") as image:
        assert image.width > 0
    doc = Document()
    doc.add_paragraph("Pulpo document")
    doc.save(root / "document.docx")
    assert Document(root / "document.docx").paragraphs[0].text == "Pulpo document"
    deck = Presentation()
    slide = deck.slides.add_slide(deck.slide_layouts[0])
    slide.shapes.title.text = "Pulpo presentation"
    deck.save(root / "slides.pptx")
    assert len(Presentation(root / "slides.pptx").slides) == 1
    pdf = canvas.Canvas(str(root / "report.pdf"))
    pdf.drawString(72, 720, "Pulpo PDF")
    pdf.save()
    assert "Pulpo PDF" in PdfReader(root / "report.pdf").pages[0].extract_text()
    with pdfplumber.open(root / "report.pdf") as document:
        assert "Pulpo PDF" in document.pages[0].extract_text()
    subprocess.run(["pdftoppm", "-singlefile", "-scale-to", "100", "-png", str(root / "report.pdf"), str(root / "page")], check=True)
    with Image.open(root / "page.png") as image:
        assert max(image.size) == 100

    # Isolate LibreOffice's profile and outputs from other conversions and sessions.
    def convert_office(path, output_format, output_directory=root):
        subprocess.run([
            "soffice", "--headless", "--norestore",
            "-env:UserInstallation=file://" + str(root / "lo-profile"),
            "--convert-to", output_format, "--outdir", str(output_directory), str(path),
        ], check=True, timeout=180)
        output_path = output_directory / (path.stem + "." + output_format)
        assert output_path.is_file(), output_path
        return output_path

    workbook = Workbook()
    workbook.active["A1"] = "Pulpo spreadsheet"
    workbook.save(root / "workbook.xlsx")
    for filename, text in (
        ("document.docx", "Pulpo document"),
        ("slides.pptx", "Pulpo presentation"),
        ("workbook.xlsx", "Pulpo spreadsheet"),
    ):
        converted_pdf = convert_office(root / filename, "pdf")
        assert text in "\n".join(page.extract_text() for page in PdfReader(converted_pdf).pages)
        with pdfplumber.open(converted_pdf) as document:
            assert text in "\n".join(page.extract_text() for page in document.pages)
    subprocess.run([
        "pdftoppm", "-f", "1", "-singlefile", "-scale-to", "100", "-png",
        str(root / "document.pdf"), str(root / "office-page"),
    ], check=True, timeout=180)
    with Image.open(root / "office-page.png") as image:
        assert max(image.size) == 100
        assert min(image.size) > 0
    odt = convert_office(root / "document.docx", "odt")
    round_trip_directory = root / "round-trip"
    round_trip_directory.mkdir()
    round_trip_docx = convert_office(odt, "docx", round_trip_directory)
    assert "Pulpo document" in "\n".join(paragraph.text for paragraph in Document(round_trip_docx).paragraphs)

    notebook = nbformat.v4.new_notebook(cells=[
        nbformat.v4.new_code_cell("print(sum(range(10)))"),
        nbformat.v4.new_code_cell(
            "import io\n"
            "import matplotlib\n"
            "matplotlib.use('Agg')\n"
            "import matplotlib.pyplot as plt\n"
            "from IPython.display import Image, display\n"
            "plt.plot([1, 2, 3])\n"
            "buffer = io.BytesIO()\n"
            "plt.savefig(buffer, format='png')\n"
            "plt.close()\n"
            "display(Image(data=buffer.getvalue()))"
        ),
    ], metadata={"kernelspec": {"name": "python3", "display_name": "Python 3", "language": "python"}})
    notebook_path = root / "analysis.ipynb"
    nbformat.write(notebook, notebook_path)
    NotebookClient(notebook, timeout=120, kernel_name="python3",
                   resources={"metadata": {"path": str(root)}}).execute()
    assert any("45" in output.get("text", "") for output in notebook.cells[0].outputs)
    assert any("image/png" in output.get("data", {}) for output in notebook.cells[1].outputs)
    executed_path = root / "analysis-executed.ipynb"
    subprocess.run([
        "jupyter", "nbconvert", "--to", "notebook", "--execute",
        "--output", executed_path.name, "--output-dir", str(root), str(notebook_path),
    ], check=True, timeout=180)
    assert executed_path.is_file()
    assert "45" in executed_path.read_text()
    subprocess.run([
        "jupyter", "nbconvert", "--to", "html", "--output", "analysis",
        "--output-dir", str(root), str(executed_path),
    ], check=True, timeout=180)
    html_path = root / "analysis.html"
    assert html_path.is_file()
    assert "45" in html_path.read_text()
print("Bundled package artifact tests passed.")
