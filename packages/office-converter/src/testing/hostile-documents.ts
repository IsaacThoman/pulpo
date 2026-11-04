import { strToU8, zipSync } from 'fflate'

/**
 * OpenDocument text files that try to escape a conversion: a macro run when the document loads,
 * an image fetched from a URL, and a section filled from another file. Tests convert them with
 * the locked profile and check nothing happened.
 */

const NAMESPACES = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"',
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
  'xmlns:xlink="http://www.w3.org/1999/xlink"',
  'xmlns:script="urn:oasis:names:tc:opendocument:xmlns:script:1.0"',
].join(' ')

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function odt(body: string, options: { scripts?: string; extra?: Record<string, string> } = {}): Uint8Array {
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${NAMESPACES} office:version="1.3">
${options.scripts ?? ''}
<office:body><office:text>${body}</office:text></office:body>
</office:document-content>`
  const extra = options.extra ?? {}
  const entries = ['content.xml', ...Object.keys(extra)].map((path) => `<manifest:file-entry manifest:full-path="${path}" manifest:media-type="text/xml"/>`)
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
${entries.join('\n')}
</manifest:manifest>`
  return zipSync({
    mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }],
    'META-INF/manifest.xml': strToU8(manifest),
    'content.xml': strToU8(content),
    ...Object.fromEntries(Object.entries(extra).map(([path, value]) => [path, strToU8(value)])),
  })
}

/** A Basic macro bound to the document's load event that writes `markerPath`. */
export function macroDocument(markerPath: string): Uint8Array {
  const module = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE script:module PUBLIC "-//OpenOffice.org//DTD OfficeDocument 1.0//EN" "module.dtd">
<script:module xmlns:script="http://openoffice.org/2000/script" script:name="Module1" script:language="StarBasic">Sub Main
  Dim n As Integer
  n = FreeFile
  Open "${escapeXml(markerPath)}" For Output As #n
  Print #n, "macro ran"
  Close #n
End Sub
</script:module>`
  const library = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE library:library PUBLIC "-//OpenOffice.org//DTD OfficeDocument 1.0//EN" "library.dtd">
<library:library xmlns:library="http://openoffice.org/2000/library" library:name="Standard" library:readonly="false" library:passwordprotected="false">
 <library:element library:name="Module1"/>
</library:library>`
  const container = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE library:libraries PUBLIC "-//OpenOffice.org//DTD OfficeDocument 1.0//EN" "libraries.dtd">
<library:libraries xmlns:library="http://openoffice.org/2000/library" xmlns:xlink="http://www.w3.org/1999/xlink">
 <library:library library:name="Standard" library:link="false"/>
</library:libraries>`
  const scripts = `<office:scripts><office:event-listeners>
<script:event-listener script:language="ooo:script" script:event-name="dom:load" xlink:href="vnd.sun.star.script:Standard.Module1.Main?language=Basic&amp;location=document" xlink:type="simple"/>
</office:event-listeners></office:scripts>`
  return odt('<text:p>Macro document</text:p>', {
    scripts,
    extra: { 'Basic/Standard/Module1.xml': module, 'Basic/Standard/script-lb.xml': library, 'Basic/script-lc.xml': container },
  })
}

/** An image linked (not embedded) from `imageUrl`. */
export function linkedImageDocument(imageUrl: string): Uint8Array {
  return odt(`<text:p>Linked image</text:p><text:p><draw:frame draw:name="Image1" text:anchor-type="as-char" svg:width="2cm" svg:height="2cm"><draw:image xlink:href="${escapeXml(imageUrl)}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame></text:p>`)
}

/** A section whose content is linked from `fileUrl`, holding `cached` until the link is updated. */
export function linkedSectionDocument(fileUrl: string, cached: string): Uint8Array {
  return odt(`<text:p>Linked section</text:p><text:section text:name="Linked"><text:section-source xlink:href="${escapeXml(fileUrl)}" xlink:type="simple" text:filter-name="Text"/><text:p>${escapeXml(cached)}</text:p></text:section>`)
}
