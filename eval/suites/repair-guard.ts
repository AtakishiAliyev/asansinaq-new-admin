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
import { eq, ok, suite } from '../harness.ts'

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
  'a worse repair does not overwrite a better version'() {
    const d = decideRepair(version({ verify_confidence: 0.9 }), {
      verify_confidence: 0.6,
      verified: true,
    })
    eq(d.keepNew, false, 'the parked version is restored')
    ok(d.reason.includes('0.60'), 'and the reason carries both scores')
  },

  'a better repair wins'() {
    const d = decideRepair(version({ verify_confidence: 0.6 }), {
      verify_confidence: 0.95,
      verified: true,
    })
    eq(d.keepNew, true, 'the repair stands')
  },

  // A repair happens because the wave found a real difference. An equal score
  // means the second read is at least as good AND was produced in answer to
  // that difference, so it is the one to keep.
  'an equal score goes to the repair'() {
    const d = decideRepair(version({ verify_confidence: 0.8 }), {
      verify_confidence: 0.8,
      verified: true,
    })
    eq(d.keepNew, true, 'ties go to the newer read')
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
})
