// What a read writes onto a row, beyond the question itself.
//
// Two runtimes build this payload — the worker after a batch, the review
// screen after a single re-run — and the fields that are NOT the question are
// the ones that went wrong quietly: a verdict that belonged to the previous
// content survived a re-read and kept the verify wave away from the row for
// good.
import { buildRowPayload, type RowContext } from '@/core/questions/row-payload'
import {
  figureImagePath,
  optionImagePath,
  storedPathsOf,
} from '@/core/questions/image-paths'
import { treeFor } from '@/core/questions/category-tree'
import { autoApprovable } from '@/core/questions/auto-approve'
import type { ExtractedQuestion } from '@/core/questions/extraction'
import { deepEq, eq, ok, suite } from '../harness.ts'

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
  // A cleanup that read only the current figures would delete the drawing a
  // rejected repair was about to roll back to. Measured on the first pruning
  // run: superseded drawings were the largest class of orphan, and the parked
  // version is the one place a "superseded" drawing is still live.
  'the pictures a parked version names are still live'() {
    const paths = storedPathsOf({
      crop_path: '9/p1_c0_q1.png',
      options: [{ label: 'A', image: '9/p1_c0_q1_optA.png' }, { label: 'B', tex: '2' }],
      figures: {
        items: [{ kind: 'image', src: '9/p1_c0_q1_fig0.png', genSrc: '9/p1_c0_q1_fig0.gen2.jpg' }],
      },
      prev_version: {
        verified: false,
        verify_confidence: 0.4,
        figures: {
          items: [{ kind: 'image', src: '9/p1_c0_q1_fig0.png', genSrc: '9/p1_c0_q1_fig0.gen1.jpg' }],
        },
      },
    })
    deepEq(
      [...paths].sort(),
      [
        '9/p1_c0_q1.png',
        '9/p1_c0_q1_fig0.gen1.jpg',
        '9/p1_c0_q1_fig0.gen2.jpg',
        '9/p1_c0_q1_fig0.png',
        '9/p1_c0_q1_optA.png',
      ],
      'the parked drawing counts alongside the current one',
    )
  },

  'an inline picture is not a stored object'() {
    const paths = storedPathsOf({
      crop_path: '9/p1_c0_q1.png',
      figures: { items: [{ kind: 'image', src: 'data:image/png;base64,AAAA' }] },
    })
    deepEq(paths, ['9/p1_c0_q1.png'], 'nothing to delete for a data: URI')
  },

  // The category is the operator's. A topic a person has already chosen is not
  // a question to put to a model: the tree is withheld so the model cannot
  // answer it, and three callers — the request, the cache key, the re-run —
  // have to agree or the key disagrees with the request.
  'a row the operator filed sends the model no tree'() {
    const tree = [{ id: 7, name: 'Çoxluqlar', parentId: null }]
    deepEq(treeFor({ category_id: 7 }, tree), [], 'filed: nothing to ask')
    deepEq(treeFor({ category_id: null }, tree), tree, 'unfiled: the book\'s tree')
  },

  'an operator category survives a read that sent no tree'() {
    const payload = buildRowPayload(question(), { category_id: 7, category_confidence: 0.9 }, context({ categoryIds: [] }))
    ok(!('category_id' in payload), 'the read never writes the final category')
    ok(!('ai_category_id' in payload), 'and suggests nothing when nothing was asked')
  },

  // The one lever that removes work rather than moving it, and the one that can
  // put a wrong question in front of a student with nobody having seen it.
  'auto-approve passes a row that cleared every automatic check'() {
    const row = {
      status: 'structured',
      verified: true,
      answer: 'A',
      category_id: 7,
      flags: [],
      reviewed_at: null,
    }
    ok(autoApprovable(row, { enabled: true, needsAnswer: true }), 'clean row passes')
    ok(!autoApprovable(row, { enabled: false, needsAnswer: true }), 'off means off')
  },

  // A warning is a reviewer's signal. `raster_figure` sits on essentially every
  // figure question on a `gen` book — every drawn figure is cut from the
  // original — so blocking on it would mean auto-approve never fired on a
  // figure at all.
  'a warning does not hold a row back, an error does'() {
    const base = {
      status: 'structured',
      verified: true,
      answer: 'A',
      category_id: 7,
      reviewed_at: null,
    }
    const on = { enabled: true, needsAnswer: true }
    ok(
      autoApprovable({ ...base, flags: [{ level: 'warning', code: 'raster_figure' }] }, on),
      'a cut figure still passes when the wave called it a match',
    )
    ok(
      !autoApprovable({ ...base, flags: [{ level: 'error', code: 'venn_empty' }] }, on),
      'a lint error does not',
    )
  },

  // The measurement that caught five figures a model had called a match.
  'a standing guard objection blocks whatever the wave said'() {
    ok(
      !autoApprovable(
        {
          status: 'structured',
          verified: true,
          answer: 'A',
          category_id: 7,
          flags: [{ level: 'warning', code: 'gen_colour_unresolved' }],
          reviewed_at: null,
        },
        { enabled: true, needsAnswer: true },
      ),
      'blocked',
    )
  },

  'auto-approve needs what a usable question needs'() {
    const on = { enabled: true, needsAnswer: true }
    const base = {
      status: 'structured',
      verified: true,
      answer: 'A',
      category_id: 7,
      flags: [],
      reviewed_at: null,
    }
    ok(!autoApprovable({ ...base, verified: false }, on), 'unverified')
    ok(!autoApprovable({ ...base, category_id: null }, on), 'unfiled')
    ok(!autoApprovable({ ...base, answer: null }, on), 'no answer, while one is required')
    ok(
      autoApprovable({ ...base, answer: null }, { enabled: true, needsAnswer: false }),
      'unless the operator said otherwise',
    )
    ok(!autoApprovable({ ...base, status: 'approved' }, on), 'already ruled on')
    ok(!autoApprovable({ ...base, status: 'rejected' }, on), 'a rejection is a decision')
    // The ready screen can send an approved question back. Every other
    // condition still holds on the returned row, so without this the sweep
    // re-approves it on its next pass and the panel undoes the operator.
    ok(
      !autoApprovable({ ...base, reviewed_at: '2026-09-08T10:00:00Z' }, on),
      'a person pulled this back out of the approved lane',
    )
  },

  'cut pictures are stored under one convention'() {
    const row = { book_id: 22, page_number: 5, col: 1, q_no: 12 }
    eq(optionImagePath(row, 'C'), '22/p5_c1_q12_optC.png')
    eq(figureImagePath(row, 0), '22/p5_c1_q12_fig0.png')
  },
})
