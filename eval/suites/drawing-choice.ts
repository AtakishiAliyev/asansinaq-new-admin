// Which drawing survives an edit round.
//
// The suite exists because the untested answer was "always the new one", and
// one live run showed what that costs: five of ten questions earned a
// corrective edit and all five came back worse than the drawing they replaced,
// while the five nobody edited were fine.
import { decideDrawing } from '@/core/figures/drawing-choice'
import { verificationBlocked } from '@/core/questions/verification-block'
import type { StructuralDiff } from '@/core/figures/structural-diff'
import { notOk, ok, suite } from '../harness.ts'

const diff = (over: Partial<StructuralDiff> = {}): StructuralDiff =>
  ({
    inkIoU: 0.9,
    colourIoU: 0.9,
    inkAreaRatio: 1,
    colourAreaRatio: 1,
    hueAgreement: 1,
    inkMeasurable: true,
    elements: { inCut: 5, matched: 5 },
    labelsChecked: false,
    passed: true,
    colourPassed: true,
    reasons: [],
    ...over,
  }) as StructuralDiff

export const drawingChoiceSuite = suite('drawing-choice', {
  // The one that cost five figures: an edit is a second roll of the dice on a
  // picture that was already acceptable, so it has to earn the swap.
  'an edit that measures no better is discarded'() {
    const choice = decideDrawing(diff({ colourIoU: 0.9 }), diff({ colourIoU: 0.9 }))
    notOk(choice.keepNew, 'a tie keeps the incumbent')
    ok(/yaxşılaşma vermədi/.test(choice.reason), choice.reason)
  },

  'a barely-better edit is still discarded'() {
    notOk(
      decideDrawing(diff({ colourIoU: 0.9 }), diff({ colourIoU: 0.91 })).keepNew,
      'inside the noise the guard itself has between two renderings',
    )
  },

  'an edit that measurably improves the shading is taken'() {
    const choice = decideDrawing(diff({ colourIoU: 0.6 }), diff({ colourIoU: 0.85 }))
    ok(choice.keepNew, choice.reason)
    ok(/boyanı yaxşılaşdırdı/.test(choice.reason), choice.reason)
  },

  // Fixing the shading by dropping a line is not a fix.
  'an edit that gains colour but loses ink is discarded'() {
    const choice = decideDrawing(
      diff({ colourIoU: 0.6, inkIoU: 0.9 }),
      diff({ colourIoU: 0.95, inkIoU: 0.5 }),
    )
    notOk(choice.keepNew, choice.reason)
    ok(/xətləri itirdi/.test(choice.reason), choice.reason)
  },

  'the guard’s overall verdict outranks any single number'() {
    ok(
      decideDrawing(diff({ passed: false, colourIoU: 0.95 }), diff({ passed: true, colourIoU: 0.5 }))
        .keepNew,
      'a drawing that passes beats one that does not, whatever the overlap says',
    )
    notOk(
      decideDrawing(diff({ passed: true, colourIoU: 0.5 }), diff({ passed: false, colourIoU: 0.95 }))
        .keepNew,
      'and the other way round',
    )
  },

  'an unmeasurable edit is never taken, an unmeasured incumbent is never kept'() {
    notOk(decideDrawing(diff(), null).keepNew, 'nothing to judge the edit by')
    ok(decideDrawing(null, diff()).keepNew, 'nothing to compare the edit against')
  },

  // The wave called all ten rows of a live run a match with an empty diff while
  // five carried a standing colour objection from the deterministic guard.
  'a standing colour objection keeps a row out of the verified lane'() {
    ok(verificationBlocked([{ code: 'gen_colour_unresolved', level: 'warning', message: '' }]))
    notOk(verificationBlocked([{ code: 'gen_unverified', level: 'warning', message: '' }]), 'ink drift is a signal, not a block')
    notOk(verificationBlocked([]), 'a clean row is not blocked')
    notOk(verificationBlocked(null), 'and neither is a row with no flags at all')
  },
})
