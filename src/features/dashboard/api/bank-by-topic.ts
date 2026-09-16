import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { dashboardKeys } from '@/features/dashboard/api/keys'

// The bank as the overview draws it: how many questions sit under each topic
// of a subject, from how many books, and how many of them are approved.
//
// Counted server-side (`bank_by_topic`) because the bank passed a thousand
// rows: counted here the picture would stop at PostgREST's page and the
// chart would show a subject filling up and then, silently, stop.

const cellSchema = z.object({
  subject_id: z.number(),
  category_id: z.number(),
  book_id: z.number(),
  status: z.string(),
  n: z.number(),
})

export type BankCell = z.infer<typeof cellSchema>

export interface TopicTotals {
  categoryId: number
  total: number
  approved: number
  /** Distinct books contributing questions to this topic. */
  books: number
}

export interface SubjectTotals {
  subjectId: number
  total: number
  approved: number
  /** Distinct books with at least one question filed under this subject. */
  books: number
  /** Topics that hold at least one question. */
  topicsWithQuestions: number
}

async function fetchBankByTopic(): Promise<BankCell[]> {
  const { data, error } = await supabase.rpc('bank_by_topic')
  if (error) throw error
  return z.array(cellSchema).parse(
    (data ?? []).map((r) => ({ ...r, n: Number(r.n) })),
  )
}

/** One call for the whole bank; the subject chips and the chosen subject's
 *  topics are both cuts of it, so a subject switch costs no request. */
export function useBankByTopic() {
  return useQuery({
    queryKey: dashboardKeys.bankByTopic(),
    queryFn: fetchBankByTopic,
  })
}

export function subjectTotals(cells: readonly BankCell[]): Map<number, SubjectTotals> {
  const out = new Map<number, SubjectTotals & { bookIds: Set<number>; topicIds: Set<number> }>()
  for (const c of cells) {
    const e =
      out.get(c.subject_id) ??
      { subjectId: c.subject_id, total: 0, approved: 0, books: 0, topicsWithQuestions: 0, bookIds: new Set<number>(), topicIds: new Set<number>() }
    e.total += c.n
    if (c.status === 'approved') e.approved += c.n
    e.bookIds.add(c.book_id)
    e.topicIds.add(c.category_id)
    out.set(c.subject_id, e)
  }
  return new Map(
    [...out.entries()].map(([id, e]) => [
      id,
      { subjectId: id, total: e.total, approved: e.approved, books: e.bookIds.size, topicsWithQuestions: e.topicIds.size },
    ]),
  )
}

export function topicTotals(cells: readonly BankCell[], subjectId: number): Map<number, TopicTotals> {
  const out = new Map<number, TopicTotals & { bookIds: Set<number> }>()
  for (const c of cells) {
    if (c.subject_id !== subjectId) continue
    const e = out.get(c.category_id) ?? { categoryId: c.category_id, total: 0, approved: 0, books: 0, bookIds: new Set<number>() }
    e.total += c.n
    if (c.status === 'approved') e.approved += c.n
    e.bookIds.add(c.book_id)
    out.set(c.category_id, e)
  }
  return new Map(
    [...out.entries()].map(([id, e]) => [id, { categoryId: id, total: e.total, approved: e.approved, books: e.bookIds.size }]),
  )
}

const subjectSchema = z.object({
  id: z.number(),
  program_id: z.number(),
  name: z.string(),
  sort_order: z.number(),
})

export type SubjectLite = z.infer<typeof subjectSchema>

// Every subject across every programme. The taxonomy feature's own hook is
// per programme, which is right for its editing screen and wrong for a chip
// row that has to show the whole bank at once.
export function useAllSubjects() {
  return useQuery({
    queryKey: dashboardKeys.subjects(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subjects')
        .select('id, program_id, name, sort_order')
        .order('program_id')
        .order('sort_order')
        .order('name')
      if (error) throw error
      return z.array(subjectSchema).parse(data)
    },
  })
}
