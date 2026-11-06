"""Builds the generated notebook fixtures with nbformat and nbclient, as Jupyter writes them.

Run with a virtual environment that has nbformat, nbclient, ipykernel, matplotlib, pandas and
ipywidgets:

    python -I generate.py <output directory>

The outputs are committed; rerun only to refresh them.
"""

import base64
import struct
import sys
import zlib
from pathlib import Path

import nbformat
from nbclient import NotebookClient
from nbformat.v4 import new_code_cell, new_markdown_cell, new_notebook, new_raw_cell


def tiny_png(width: int, height: int) -> bytes:
    """A small gradient PNG, so attachments hold a real image without a drawing library."""
    rows = b"".join(
        b"\x00" + b"".join(bytes((x * 255 // max(1, width - 1), y * 255 // max(1, height - 1), 128)) for x in range(width))
        for y in range(height)
    )

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")


def executed(notebook, path: Path) -> None:
    NotebookClient(notebook, timeout=120, kernel_name="python3", resources={"metadata": {"path": str(path.parent)}}).execute()
    nbformat.validate(notebook)
    nbformat.write(notebook, path)


def analysis(directory: Path) -> None:
    notebook = new_notebook()
    notebook.cells = [
        new_markdown_cell("# Sales analysis\n\nA notebook with **tables**, plots, and math: $e^{i\\pi} + 1 = 0$."),
        new_code_cell("%matplotlib inline\nimport matplotlib.pyplot as plt\nimport pandas as pd\nimport numpy as np"),
        new_code_cell("df = pd.DataFrame({'month': ['Jan', 'Feb', 'Mar', 'Apr'], 'sales': [120, 135.5, 98, 160]})\ndf"),
        new_code_cell("fig, ax = plt.subplots(figsize=(3, 2), dpi=60)\nax.plot(df['sales'], marker='o')\nax.set_title('Sales')\nplt.show()"),
        new_code_cell("for i in range(3):\n    print(f'step {i}', flush=True)\nimport sys\nprint('warning: low stock', file=sys.stderr)"),
        new_code_cell("ratio = df['sales'].mean() / 1e5\nratio"),
        new_code_cell("from IPython.display import Markdown, HTML, JSON\ndisplay(Markdown('**Total:** 513.5'))\nHTML('<b>bold</b> <script>console.log(1)</script>')"),
        new_code_cell("1 / 0"),
        new_raw_cell("Raw text, passed through as is."),
    ]
    notebook.metadata["kernelspec"] = {"display_name": "Python 3 (ipykernel)", "language": "python", "name": "python3"}
    client = NotebookClient(notebook, timeout=120, kernel_name="python3", allow_errors=True)
    client.execute()
    nbformat.validate(notebook)
    nbformat.write(notebook, directory / "generated-analysis.ipynb")


def attachments(directory: Path) -> None:
    image = base64.b64encode(tiny_png(24, 16)).decode("ascii")
    cell = new_markdown_cell("An attached image:\n\n![gradient](attachment:gradient.png)\n\nUnicode: café, 日本語, emoji 😀")
    cell.attachments = {"gradient.png": {"image/png": image}}
    notebook = new_notebook(cells=[cell, new_code_cell("x = 'naïve'\nprint(x)")])
    notebook.metadata["kernelspec"] = {"display_name": "Python 3", "language": "python", "name": "python3"}
    notebook.metadata["language_info"] = {"name": "python", "version": "3.12.0"}
    notebook.metadata["custom"] = {"10": "integer-like keys", "2": "keep their order", "nested": {"b": 1, "a": [1.0, 1e-07, -0.5]}}
    nbformat.validate(notebook)
    nbformat.write(notebook, directory / "generated-attachments.ipynb")


def widgets(directory: Path) -> None:
    notebook = new_notebook(cells=[
        new_code_cell("import ipywidgets as widgets\nslider = widgets.IntSlider(value=3, min=0, max=10, description='n')\nslider"),
        new_code_cell("slider.value * 2"),
    ])
    notebook.metadata["kernelspec"] = {"display_name": "Python 3", "language": "python", "name": "python3"}
    client = NotebookClient(notebook, timeout=120, kernel_name="python3", store_widget_state=True)
    client.execute()
    nbformat.validate(notebook)
    nbformat.write(notebook, directory / "generated-widgets.ipynb")


if __name__ == "__main__":
    target = Path(sys.argv[1])
    target.mkdir(parents=True, exist_ok=True)
    analysis(target)
    attachments(target)
    widgets(target)
