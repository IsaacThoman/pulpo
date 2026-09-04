"""Generate the capability inventory from the installed environment."""
from importlib.metadata import distributions

print("# Bundled workspace packages\n")
print("Use python or python3 (also /opt/pulpo/python/bin/python) for the bundled environment.")
print("pip and pip3 target this environment. Install only additional dependencies when needed.")
print("System PDF tools: pdftotext, pdftoppm, pdfinfo (Poppler).\n")
print("## Installed Python distributions\n")
for name, version in sorted((d.metadata["Name"], d.version) for d in distributions()):
    print(f"- {name}=={version}")
