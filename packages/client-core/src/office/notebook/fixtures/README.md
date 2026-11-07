# Notebook fixtures

- `nbformat-test4.ipynb` and `nbformat-test3.ipynb` are the reference notebooks from the
  [nbformat](https://github.com/jupyter/nbformat/tree/main/tests) test suite (nbformat 4.0 and 3.0),
  copyright the IPython and Jupyter Development Teams, used under the BSD 3-Clause License. They
  carry stream, HTML, JavaScript, and PNG outputs, and nbformat 3's heading cells and short output keys.
- `jupyter-*.ipynb` are example notebooks from the Jupyter Notebook documentation
  ([jupyter/notebook](https://github.com/jupyter/notebook/tree/main/docs/source/examples/Notebook):
  Running Code, Working With Markdown Cells, Notebook Basics, Importing Notebooks), copyright the
  Jupyter Development Team, BSD 3-Clause License. Written by Jupyter, with images in Markdown and outputs.
- `ipywidgets-widget-basics.ipynb` is "Widget Basics" from the
  [ipywidgets](https://github.com/jupyter-widgets/ipywidgets/tree/main/docs/source/examples) documentation,
  copyright the Jupyter Development Team, BSD 3-Clause License. It was edited by hand after Jupyter
  wrote it (a list on one line), so it only round-trips through the kept original.
- `generated-*.ipynb` are written by `generate.py` with nbformat and executed with nbclient: a
  matplotlib plot, a pandas table, stdout and stderr, Markdown and HTML display outputs, a traceback,
  a raw cell, attachments with Unicode and integer-like metadata keys, and widget state.

Other cases (tracebacks with ANSI colors, progress bars, hostile input, other JSON layouts) are
built inline in the tests.
