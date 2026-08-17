import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z } from 'zod'
import { useAuth } from '@/hooks/use-auth'
import { normalizeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { bookKeys } from '@/features/books/api/keys'
import {
  bookSchema,
  type Book,
  type BookFormValues,
} from '@/features/books/schemas'

const SELECT = '*, programs(name), subjects(name), profiles(full_name)'

// The whole shelf in one query, filtered client-side: even at several hundred
// books the payload is tiny, and it keeps search/filter interactions instant.
async function fetchBooks(): Promise<Book[]> {
  const { data, error } = await supabase
    .from('books')
    .select(SELECT)
    .order('created_at', { ascending: false })
    .limit(1000)
  if (error) throw error
  return z.array(bookSchema).parse(data)
}

export function useBooks() {
  return useQuery({ queryKey: bookKeys.list(), queryFn: fetchBooks })
}

export async function findBookByHash(hash: string): Promise<Book | null> {
  const { data, error } = await supabase
    .from('books')
    .select(SELECT)
    .eq('content_hash', hash)
    .maybeSingle()
  if (error) throw error
  return data ? bookSchema.parse(data) : null
}

export const MAX_UPLOAD_BYTES = 52_428_800

function storagePath(name: string): string {
  const safe = name
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(-80)
  return `${Date.now()}_${safe}`
}

export interface CreateBookInput {
  form: BookFormValues
  file: File
  contentHash: string
  pageCount: number | null
}

export interface CreateBookResult {
  book: Book
  archive: 'uploaded' | 'skipped-size'
}

// Upload (when the size allows) + metadata row, as one action. If the row
// insert fails after a successful upload, the orphan object is removed so the
// bucket and the table cannot drift apart.
export function useCreateBook() {
  const queryClient = useQueryClient()
  const { session } = useAuth()

  return useMutation({
    mutationFn: async (input: CreateBookInput): Promise<CreateBookResult> => {
      const oversize = input.file.size > MAX_UPLOAD_BYTES
      let path: string | null = null
      if (!oversize) {
        path = storagePath(input.file.name)
        const { error } = await supabase.storage
          .from('pdfs')
          .upload(path, input.file, { contentType: 'application/pdf' })
        if (error) throw error
      }
      const { data, error } = await supabase
        .from('books')
        .insert({
          title: input.form.title,
          program_id: input.form.program_id,
          subject_id: input.form.subject_id,
          tags: input.form.tags,
          note: input.form.note || null,
          storage_path: path,
          original_name: input.file.name,
          file_size: input.file.size,
          page_count: input.pageCount,
          content_hash: input.contentHash,
          created_by: session?.user.id ?? null,
        })
        .select(SELECT)
        .single()
      if (error) {
        if (path) {
          const { error: removeError } = await supabase.storage
            .from('pdfs')
            .remove([path])
          if (removeError) {
            toast.warning('Kitab yaradılmadı; arxiv faylı bucket-də qaldı')
          }
        }
        throw error
      }
      return {
        book: bookSchema.parse(data),
        archive: oversize ? 'skipped-size' : 'uploaded',
      }
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: bookKeys.list() }),
    onError: (error) => {
      const normalized = normalizeError(error)
      toast.error(
        normalized.code === '23505'
          ? 'Bu PDF artıq arxivdədir — eyni fayl təkrar yüklənə bilməz.'
          : normalized.message,
      )
    },
  })
}

// Fire-and-forget: fills page_count in when the dialog was submitted before
// the PDF parse finished. No toast — the admin never asked for this.
export function useBackfillPageCount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      pageCount,
    }: {
      id: number
      pageCount: number
    }) => {
      const { error } = await supabase
        .from('books')
        .update({ page_count: pageCount })
        .eq('id', id)
      if (error) throw error
    },
    retry: 2,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: bookKeys.list() }),
    onError: () => toast.warning('Səhifə sayı yazılmadı'),
  })
}

// Fire-and-forget processing trail; merged atomically server-side.
// Quiet on success, loud on failure — a silently stale trail would corrupt
// the resume hints and the Emal column.
export function useMarkPagesWorked() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      bookId,
      pages,
    }: {
      bookId: number
      pages: number[]
    }) => {
      const { error } = await supabase.rpc('mark_pages_worked', {
        p_book_id: bookId,
        p_pages: pages,
      })
      if (error) throw error
    },
    retry: 2,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: bookKeys.list() }),
    onError: () =>
      toast.warning('Emal qeydi yazılmadı — səhifə tarixçəsi natamam ola bilər'),
  })
}

// Saves the archived original back to the admin's machine.
export function useSaveBookPdf() {
  return useMutation({
    mutationFn: async (book: Book) => {
      if (!book.storage_path) throw new Error('Arxiv faylı yoxdur')
      const { data, error } = await supabase.storage
        .from('pdfs')
        .download(book.storage_path)
      if (error) throw error
      const url = URL.createObjectURL(data)
      const a = document.createElement('a')
      a.href = url
      a.download = `${book.title}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    },
    onError: (error) => toast.error(normalizeError(error).message),
  })
}

export function useUpdateBook() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, form }: { id: number; form: BookFormValues }) => {
      const { error } = await supabase
        .from('books')
        .update({
          title: form.title,
          program_id: form.program_id,
          subject_id: form.subject_id,
          tags: form.tags,
          note: form.note || null,
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Kitab yeniləndi')
      void queryClient.invalidateQueries({ queryKey: bookKeys.list() })
    },
    onError: (error) => toast.error(normalizeError(error).message),
  })
}

export function useDeleteBook() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (book: Book): Promise<{ storageRemoved: boolean }> => {
      // Row first: once it is gone the book disappears from every list even if
      // the storage removal below fails (an orphan object is invisible but
      // harmless; a row pointing at a deleted object would look broken).
      const { error } = await supabase.from('books').delete().eq('id', book.id)
      if (error) throw error
      if (!book.storage_path) return { storageRemoved: true }
      const { error: storageError } = await supabase.storage
        .from('pdfs')
        .remove([book.storage_path])
      return { storageRemoved: !storageError }
    },
    // Exactly one toast, chosen by the outcome — a success toast must not bury
    // the orphaned-file warning.
    onSuccess: ({ storageRemoved }) => {
      if (storageRemoved) toast.success('Kitab silindi')
      else toast.warning('Kitab silindi, amma arxiv faylı silinə bilmədi')
      void queryClient.invalidateQueries({ queryKey: bookKeys.list() })
    },
    onError: (error) => toast.error(normalizeError(error).message),
  })
}
