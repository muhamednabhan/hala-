import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const DOCS_DIR = resolve(here, '..', 'docs')
/** The DSO services handbook (knowledge base v1.0, cleaned) lives with the catalogue it feeds. */
const HANDBOOK = resolve(here, '..', '..', '02-catalogue', 'docs', 'dso-knowledge-base-v1.0.md')

export interface KbDoc { key: string; name: string; text: string; hash: string }

const hash = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 8)

/**
 * Every knowledge-base document, with a name that carries a content hash. The name is how sync knows whether a document
 * changed: same name means same text, so nothing is re-uploaded or re-indexed.
 */
export function loadDocs(): KbDoc[] {
  const files = readdirSync(DOCS_DIR).filter((f) => f.endsWith('.md')).sort()
  const docs = [{ key: '01-dso-services-handbook', text: readFileSync(HANDBOOK, 'utf8') },
    ...files.map((f) => ({ key: f.replace(/\.md$/, ''), text: readFileSync(join(DOCS_DIR, f), 'utf8') }))]
  return docs.map((d) => {
    const h = hash(d.text)
    return { key: d.key, text: d.text, hash: h, name: `HALA ${d.key} #${h}` }
  })
}
