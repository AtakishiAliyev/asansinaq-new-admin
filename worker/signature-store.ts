// Where a drawing's thought signature lives.
//
// Its own file to keep `figure-edit.ts` and `option-images.ts` from importing
// each other: the cutter starts an edit, and the editor needs the signature the
// cutter stored. A cycle between them resolves today only because every export
// is a hoisted declaration, which is a property of the current code rather than
// a decision anyone made.
//
// The signature is kept in the bucket beside the drawing, not on the row. It is
// an opaque blob the model hands back and the row is read by people; and it
// belongs to ONE drawing, so it has to be replaced whenever that drawing is,
// which a path derived from the drawing's own does for free.
import type { Db } from './db.ts'

export const signaturePath = (imagePath: string): string => `${imagePath}.sig`

/**
 * Keep a drawing's signature.
 *
 * Best-effort: without it a corrective edit falls back to handing the model two
 * anonymous pictures, which still works and is what the lane did before.
 */
export async function storeSignature(
  db: Db,
  imagePath: string,
  signature: string | undefined,
): Promise<void> {
  if (!signature) return
  const { error } = await db.storage
    .from('question-crops')
    .upload(signaturePath(imagePath), Buffer.from(signature, 'utf8'), {
      upsert: true,
      contentType: 'text/plain',
    })
  if (error) console.warn(`[figure] signature not stored for ${imagePath}: ${error.message}`)
}

/** A drawing's signature, or undefined when it was never kept. */
export async function loadSignature(db: Db, imagePath: string): Promise<string | undefined> {
  const { data, error } = await db.storage
    .from('question-crops')
    .download(signaturePath(imagePath))
  if (error || !data) return undefined
  const text = (await data.text()).trim()
  return text || undefined
}
