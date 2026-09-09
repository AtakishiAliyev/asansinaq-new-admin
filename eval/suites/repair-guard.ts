// Which version survives a repair round.
//
// The regression this closes: a repair re-read a crop and came back with a
// geometry figure that had LOST its congruence marks, and because the write was
// unconditional the row ended up worse than before the repair — with the
// confidence score that proved it overwritten in the same update. Every case
// here is about not letting "last" mean "best".
import {
  decideRepair,
  parseStoredVersion,
  type StoredVersion,
} from '@/core/questions/repair-guard'
import { reproductionBlamed } from '@/core/questions/verdict-blame'
import { deepEq, eq, ok, suite } from '../harness.ts'

const version = (over: Partial<StoredVersion> = {}): StoredVersion => ({
  stem: 'əvvəlki',
  options: [],
  figures: null,
  verify_confidence: 0.9,
  verify_diff: null,
  verified: true,
  ...over,
})

export const repairGuardSuite = suite('repair-guard', {
  'among two matches the surer one wins'() {
    const worse = decideRepair(version({ verify_confidence: 0.9, verified: true }), {
      verify_confidence: 0.6,
      verified: true,
    })
    eq(worse.keepNew, false, 'a less sure match does not displace a surer one')
    ok(worse.reason.includes('0.60'), 'and the reason carries both scores')

    const better = decideRepair(version({ verify_confidence: 0.6, verified: true }), {
      verify_confidence: 0.95,
      verified: true,
    })
    eq(better.keepNew, true, 'a surer match stands')
  },

  // The direction bug, which shipped for one live run and fired on q464: both
  // versions had FAILED and the guard kept the one the verifier was most
  // certain was wrong. Among failures, confidence measures how clear the defect
  // is, so the less certain failure is the better version to keep.
  'among two failures the less certain one wins'() {
    const d = decideRepair(version({ verify_confidence: 0.97, verified: false }), {
      verify_confidence: 0.60,
      verified: false,
    })
    eq(d.keepNew, true, 'the repair is the less clear failure and survives')

    const back = decideRepair(version({ verify_confidence: 0.60, verified: false }), {
      verify_confidence: 0.97,
      verified: false,
    })
    eq(back.keepNew, false, 'a surer failure does not displace a vaguer one')
  },

  // A repair happens because the wave found a real difference. An equal score
  // means the second read is at least as good AND was produced in answer to
  // that difference, so it is the one to keep.
  'an equal score goes to the repair, either way round'() {
    eq(
      decideRepair(version({ verify_confidence: 0.8, verified: true }), {
        verify_confidence: 0.8,
        verified: true,
      }).keepNew,
      true,
      'ties among matches go to the newer read',
    )
    eq(
      decideRepair(version({ verify_confidence: 0.8, verified: false }), {
        verify_confidence: 0.8,
        verified: false,
      }).keepNew,
      true,
      'ties among failures go to the newer read too',
    )
  },

  // Confidence is how sure the COMPARISON is, not how good the question is, so
  // a confident "this differs" must never outrank a less sure "this matches".
  'a matching version outranks a confident mismatch'() {
    const d = decideRepair(version({ verify_confidence: 0.7, verified: true }), {
      verify_confidence: 0.99,
      verified: false,
    })
    eq(d.keepNew, false, 'the version that matched the original is kept')
  },

  'a repair that finally matches wins over a confident mismatch'() {
    const d = decideRepair(version({ verify_confidence: 0.99, verified: false }), {
      verify_confidence: 0.7,
      verified: true,
    })
    eq(d.keepNew, true, 'matching is what the repair was for')
  },

  // Never strand a row: with nothing to compare against there is no basis for
  // refusing the read that just arrived.
  'an unscored predecessor cannot block a repair'() {
    const d = decideRepair(version({ verify_confidence: null }), {
      verify_confidence: 0.5,
      verified: false,
    })
    eq(d.keepNew, true, 'the repair stands')
  },

  'nothing parked means the repair stands'() {
    eq(decideRepair(null, { verify_confidence: 0.1, verified: false }).keepNew, true, 'stands')
  },

  'a repair with no score of its own loses to a scored version'() {
    const d = decideRepair(version({ verify_confidence: 0.8 }), {
      verify_confidence: null,
      verified: false,
    })
    eq(d.keepNew, false, 'an unscored replacement does not displace a scored one')
  },

  'a parked version reads back defensively'() {
    eq(parseStoredVersion(null), null, 'null is nothing')
    eq(parseStoredVersion('x'), null, 'a string is nothing')
    eq(parseStoredVersion([]), null, 'an array is nothing')
    eq(parseStoredVersion({ stem: 'a' }), null, 'without the marker fields it is nothing')
    const parsed = parseStoredVersion({
      stem: 'a',
      options: [1],
      figures: null,
      verify_confidence: 0.5,
      verify_diff: null,
      verified: true,
    })
    ok(parsed !== null, 'a real parked version reads')
    eq(parsed?.verify_confidence, 0.5, 'with its score')
    eq(parsed?.verified, true, 'and its verdict')
  },

  // The lint travels WITH the content it describes. Without it a rollback
  // restored one version's figures under another version's flags — and `flags`
  // is what auto-approve reads, what the Diqqət lane is computed from, and what
  // decides whether a deterministic finding buys another read. Live, a row came
  // back with `n^2/n` in the divisor and an empty quotient while carrying the
  // clean lint of the repair that had just been discarded.
  'a parked version carries its own lint'() {
    const parsed = parseStoredVersion({
      stem: 'a',
      options: [],
      figures: null,
      verify_confidence: 0.4,
      verified: false,
      flags: [{ level: 'error', code: 'division_role_empty', message: 'x' }],
    })
    deepEq(parsed?.flags, [{ level: 'error', code: 'division_role_empty', message: 'x' }], 'bayraqlar oxunmur')
  },

  // A row parked before flags were parked has none, and inventing an empty
  // list there would CLEAR the lint on rollback rather than leave it alone.
  'a version parked without flags reports none rather than an empty list'() {
    const parsed = parseStoredVersion({
      stem: 'a',
      options: [],
      figures: null,
      verify_confidence: 0.4,
      verified: false,
    })
    eq(parsed?.flags, undefined, 'boş siyahı uydurulur')
    eq(
      parseStoredVersion({ stem: 'a', options: [], figures: null, verify_confidence: 1, verified: true, flags: 'x' })?.flags,
      undefined,
      'siyahı olmayan dəyər qəbul edilir',
    )
  },

  // `figures: null` is a legitimate value — a question with no figure — so
  // presence must not be judged on it.
  'a parked version with no figure is still a version'() {
    const parsed = parseStoredVersion({
      stem: 'a',
      options: [],
      figures: null,
      verify_confidence: 0.9,
      verified: false,
    })
    ok(parsed !== null, 'a figureless version parks like any other')
  },

  // p302/8: the read was right, the redraw had moved the shading, and the
  // pipeline re-read the crop twice to reach the same verdict. When every
  // critical difference is in the figure and the figure on show is a
  // reproduction, the reproduction is what has to go.
  'a verdict that only faults a reproduced figure blames the reproduction'() {
    const figures = { v: 1, items: [{ kind: 'image', src: 'c.png', genSrc: 'c.gen.jpg' }] }
    deepEq(
      reproductionBlamed(figures, [{ field: 'figure_marks', severity: 'critical' }]),
      [0],
      'the shown reproduction is named',
    )
  },

  'a verdict that also faults the text is not the reproduction\u2019s fault'() {
    const figures = { v: 1, items: [{ kind: 'image', src: 'c.png', genSrc: 'c.gen.jpg' }] }
    deepEq(
      reproductionBlamed(figures, [
        { field: 'figure', severity: 'critical' },
        { field: 'stem', severity: 'critical' },
      ]),
      [],
      'a stem difference needs a re-read',
    )
    deepEq(
      reproductionBlamed(figures, [{ field: 'figure', severity: 'minor' }]),
      [],
      'a minor difference triggers nothing',
    )
  },

  'with no reproduction on show there is nothing to blame'() {
    const cutOnly = { v: 1, items: [{ kind: 'image', src: 'c.png' }] }
    deepEq(reproductionBlamed(cutOnly, [{ field: 'figure', severity: 'critical' }]), [], 'a cut is the source')
    deepEq(reproductionBlamed(null, [{ field: 'figure', severity: 'critical' }]), [], 'no figures at all')
  },
})
