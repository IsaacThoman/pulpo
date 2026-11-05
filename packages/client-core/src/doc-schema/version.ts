/**
 * Bump whenever the editor's node or mark set changes. Servers refuse collaborative joins from
 * other versions, because y-prosemirror silently drops content an older schema cannot represent.
 *
 * Kept apart from the schema so that sync code can import it without loading TipTap.
 */
export const DOC_SCHEMA_VERSION = 2
/**
 * A Y.Map every document made since live formats carries, whatever its format. `generation` is
 * set once, when the document is made: a document made again under the same id (a file that was
 * a document, then a file, then a document) gets a new one, so a device's copy of the earlier
 * document is recognized and dropped instead of merged into it.
 */
export const DOC_META_MAP = 'pulpoDoc'
export const DOC_GENERATION_KEY = 'generation'

/** The Y.XmlFragment that holds a document; matches TipTap Collaboration's default field. */
export const DOC_FRAGMENT_NAME = 'default'
