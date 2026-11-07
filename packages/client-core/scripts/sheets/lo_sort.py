#!/usr/bin/env python3
"""Real Calc row sort via a private profile and our own Basic UNO macro.

No macros from the input are enabled. Usage: lo_sort.py input.xlsx output.xlsx A2:H4
Sorts ascending on the first column, with positional references
(UpdateReference=False) and positional CF/DV (BindFormatsToContent=False). Requires soffice, no Python UNO installation needed.
"""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from xml.sax.saxutils import escape

source, dest, area = sys.argv[1:]
soffice = os.environ.get('PULPO_SOFFICE', '/Applications/LibreOffice.app/Contents/MacOS/soffice')
def literal(value):
    return '"' + value.replace('"', '""') + '"'

macro = f'''Sub Main
Dim loadProps(1) As New com.sun.star.beans.PropertyValue
loadProps(0).Name = "Hidden"
loadProps(0).Value = True
loadProps(1).Name = "MacroExecutionMode"
loadProps(1).Value = 0
Dim doc As Object, sheet As Object, cellRange As Object
doc = StarDesktop.loadComponentFromURL({literal(Path(source).resolve().as_uri())}, "_blank", 0, loadProps())
sheet = doc.Sheets.getByIndex(0)
cellRange = sheet.getCellRangeByName({literal(area)})
Dim fields(0) As New com.sun.star.table.TableSortField
fields(0).Field = 0
fields(0).IsAscending = True
Dim props(5) As New com.sun.star.beans.PropertyValue
props(0).Name = "SortFields"
props(0).Value = fields()
props(1).Name = "ContainsHeader"
props(1).Value = False
props(2).Name = "IsSortColumns"
props(2).Value = False
props(3).Name = "BindFormatsToContent"
props(3).Value = False
props(4).Name = "UpdateReference"
props(4).Value = False
props(5).Name = "IncludeHiddenRows"
props(5).Value = True
cellRange.sort(props())
Dim saveProps(0) As New com.sun.star.beans.PropertyValue
saveProps(0).Name = "FilterName"
saveProps(0).Value = "Calc MS Excel 2007 XML"
doc.storeAsURL({literal(Path(dest).resolve().as_uri())}, saveProps())
doc.close(True)
StarDesktop.terminate()
End Sub'''
with tempfile.TemporaryDirectory(prefix='pulpo-lo-sort-') as tmp:
    profile = Path(tmp)
    subprocess.run([soffice, '-env:UserInstallation=' + profile.as_uri(), '--headless', '--convert-to', 'ods', '--outdir', tmp, str(Path(source).resolve())], check=True, timeout=30, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    (profile / 'user').mkdir(exist_ok=True)
    registry = profile / 'user/registrymodifications.xcu'
    registry.write_text(registry.read_text().replace('</oor:items>', '<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>'))
    basic = profile / 'user/basic'
    standard = basic / 'Standard'
    standard.mkdir(parents=True, exist_ok=True)
    (basic / 'script.xlc').write_text('''<?xml version="1.0"?><!DOCTYPE library:libraries PUBLIC "-//OpenOffice.org//DTD OfficeDocument 1.0//EN" "libraries.dtd"><library:libraries xmlns:library="http://openoffice.org/2000/library" xmlns:xlink="http://www.w3.org/1999/xlink"><library:library library:name="Standard" library:link="false"/></library:libraries>''')
    (standard / 'script.xlb').write_text('''<?xml version="1.0"?><!DOCTYPE library:library PUBLIC "-//OpenOffice.org//DTD OfficeDocument 1.0//EN" "library.dtd"><library:library xmlns:library="http://openoffice.org/2000/library" library:name="Standard" library:readonly="false" library:passwordprotected="false"><library:element library:name="Module1"/></library:library>''')
    (standard / 'Module1.xba').write_text('<?xml version="1.0"?><!DOCTYPE script:module PUBLIC "-//OpenOffice.org//DTD OfficeDocument 1.0//EN" "module.dtd"><script:module xmlns:script="http://openoffice.org/2000/script" script:name="Module1" script:language="StarBasic">' + escape(macro) + '</script:module>')
    subprocess.run([soffice, '-env:UserInstallation=' + profile.as_uri(), '--headless', '--norestore', '--nologo', 'macro:///Standard.Module1.Main()'], check=True, timeout=90, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
if not Path(dest).is_file():
    raise RuntimeError('LibreOffice sort produced no output')
