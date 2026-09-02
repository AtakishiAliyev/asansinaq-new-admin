// What a read writes onto a row, beyond the question itself.
//
// Two runtimes build this payload — the worker after a batch, the review
// screen after a single re-run — and the fields that are NOT the question are
// the ones that went wrong quietly: a verdict that belonged to the previous
// content survived a re-read and kept the verify wave away from the row for
// good.
import { buildRowPayload, type RowContext } from '@/core/questions/row-payload'
import { figureImagePath, optionImagePath } from '@/core/questions/image-paths'
import type { ExtractedQuestion } from '@/core/questions/extraction'
import { eq, ok, suite } from '../harness.ts'

const question = (over: Partial<ExtractedQuestion> = {}): ExtractedQuestion => ({
  numberSeen: 3,
  stem: '$x + 1 = 3$',
  options: (['A', 'B', 'C', 'D', 'E'] as const).map((label, i) => ({
    label,
    tex: String(i),
  })),
  figures: null,
  illegible: false,
  clipped: false,
  foreign: false,
  confidence: 0.95,
  warnings: [],
  ...over,
})

const context = (over: Partial<RowContext> = {}): RowContext => ({
  qNo: 3,
  currentStatus: 'structured',
  answerSource: null,
  keyAnswer: 'B',
  answerKeysRead: true,
  categoryIds: [],
  model: 'test-model',
  promptVersion: 1,
  ...over,
})

export const rowPayloadSuite = suite('row-payload', {
  // The one that stranded rows. A row verified under an earlier read, then
  // re-queued from the UI and read again, must come back in front of the
  // verify wave — which selects on `verified_at is null`.
  'a re-read clears the previous verdict'() {
    const { update } = buildRowPayload(question(), {}, context())
    eq(update.verified, false, 'unread content is unverified')
    ok('verified_at' in update, 'verified_at is written, not left alone')
    eq(update.verified_at, null, 'verified_at is cleared')
    eq(update.verify_confidence, null, 'the old confidence goes with it')
    eq(update.verify_diff, null, 'and the old diff')
  },

  'an empty read clears it too'() {
    const { status, update } = buildRowPayload(
      question({ stem: '', options: [], figures: null }),
      {},
      context(),
    )
    eq(status, 'failed', 'nothing read is a failure')
    eq(update.verified_at, null, 'a failed read carries no verdict either')
  },

  // A person's verdict outranks anything the pipeline produces, and that has
  // to hold on the status even while the verdict fields are being cleared.
  'a reviewer’s status survives a re-read'() {
    const { update } = buildRowPayload(question(), {}, context({ currentStatus: 'approved' }))
    eq(update.status, 'approved', 'approved stays approved')
  },

  'a reviewer’s answer is never replaced by the key'() {
    const { update } = buildRowPayload(
      question(),
      {},
      context({ answerSource: 'reviewer', keyAnswer: 'C' }),
    )
    ok(!('answer' in update), 'the key does not overwrite a person')
  },

  'a category outside the tree that was sent is discarded'() {
    const { update } = buildRowPayload(
      question(),
      { category_id: 99, category_confidence: 0.9 },
      context({ categoryIds: [1, 2] }),
    )
    eq(update.ai_category_id, null, 'an invented id is not filed')
  },

  // Both writers store to this path and the renderers read from it; a second
  // copy of the pattern was one character from a broken picture.
  'cut pictures are stored under one convention'() {
    const row = { book_id: 22, page_number: 5, col: 1, q_no: 12 }
    eq(optionImagePath(row, 'C'), '22/p5_c1_q12_optC.png')
    eq(figureImagePath(row, 0), '22/p5_c1_q12_fig0.png')
  },
})
