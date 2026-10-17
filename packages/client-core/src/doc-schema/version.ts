/**
 * Bump whenever the editor's node or mark set changes. Servers refuse collaborative joins from
 * other versions, because y-prosemirror silently drops content an older schema cannot represent.
 *
 * Kept apart from the schema so that sync code can import it without loading TipTap.
 */
export const DOC_SCHEMA_VERSION = 2
/** The Y.XmlFragment that holds a document; matches TipTap Collaboration's default field. */
export const DOC_FRAGMENT_NAME = 'default'
