import { supabase } from '@/lib/supabase'
import { fetchCategories } from '@/features/taxonomy'

/** The subject's category tree, sent so the model picks an EXISTING id. */
export interface CategoryOption {
  id: number
  name: string
  parentId: number | null
}

/**
 * The tree a book's questions may be filed under — always the book's OWN
 * subject. A batch can span books (the queue falls back to claiming from
 * anywhere, and the bank can be restructured with the book filter on "all"),
 * so the tree is resolved per book rather than passed in once: a tree from the
 * wrong subject makes the model pick an id that exists but is wrong, and
 * auto-approve would stamp exactly that as the final category.
 */
export async function fetchBookCategories(
  bookId: number,
): Promise<CategoryOption[]> {
  const { data: book, error } = await supabase
    .from('books')
    .select('subject_id')
    .eq('id', bookId)
    .maybeSingle()
  if (error) throw error
  const subjectId = book?.subject_id ?? null
  if (!subjectId) return []
  const categories = await fetchCategories(subjectId)
  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    parentId: c.parent_id,
  }))
}
