// Whose decision the category is.
//
// It used to be the model's: the book's tree went into every extraction and
// the model picked an id from it, which a reviewer then confirmed or replaced.
// The operator now names the topic when the crops are sent, before anything is
// read, and a topic a person has already chosen is not a question to put to a
// model — the tree is withheld, so the model cannot answer it, and its
// suggestion column stays empty because nothing was suggested.
//
// One function, in core, because three callers have to agree or the cache key
// disagrees with the request: the worker's request builder, the worker's cache
// key, and the review screen's single re-run.

/** The tree to send for this row: the book's, or nothing. */
export function treeFor<T>(
  row: { category_id: number | null },
  tree: T[],
): T[] {
  return row.category_id === null ? tree : []
}
