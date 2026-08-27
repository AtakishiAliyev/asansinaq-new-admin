// The writing check. The engine is not here — this is the part that decides
// what its words MEAN, which is the part that has to be argued about.
//
// Every threshold in it is shaped by one asymmetry: refusing a good
// reproduction keeps the cut, which is the source's own pixels and still
// correct, while accepting a bad one puts a figure in front of a student that
// looks cleaner than the original and says something else.
import { compareLabels, type OcrToken } from '@/core/figures/labels'
import { eq, ok, suite } from '../harness.ts'

const read = (...pairs: [string, number][]): OcrToken[] =>
  pairs.map(([text, confidence]) => ({ text, confidence }))

export const labelsSuite = suite('labels', {
  // The live defect: a faithful reproduction that simply left the y-axis
  // unnamed. Structure, shading and hue all agreed, because none of them can
  // see a letter.
  'a label the reproduction dropped is caught'() {
    const cut = read(['14.', 96], ['y', 89], ['f(x)', 89], ['3', 96])
    const gen = read(['14.', 95], ['f(x)', 97], ['3', 98])
    const diff = compareLabels(cut, gen)
    ok(!diff.passed, 'a missing axis name must fail')
    eq(diff.missing.join(','), 'y', 'and must name what went missing')
    ok(diff.checked, 'the check ran')
  },

  'a changed digit is caught'() {
    const diff = compareLabels(read(['3', 94]), read(['8', 95]))
    ok(!diff.passed, '3 redrawn as 8 must fail')
  },

  'a faithful reproduction passes'() {
    const cut = read(['15.', 92], ['g(x)', 90], ['-2', 91])
    const gen = read(['15.', 96], ['g(x)', 95], ['-2', 96], ['x', 40])
    ok(compareLabels(cut, gen).passed, 'same writing, no complaint')
  },

  // Tesseract invents words from curves and dashed guides. On the live pairs
  // that noise sat at 55-80 while real labels came back at 88-96, so the bar
  // sits above the noise instead of in the middle of it.
  'noise the engine invented from a curve is not a label'() {
    const cut = read(['AJ?', 55], ['NZ', 69], ['No', 80])
    const diff = compareLabels(cut, read(['x', 96]))
    ok(diff.passed, 'low-confidence junk must not reject a figure')
    ok(!diff.checked, 'and must not count as having checked anything')
  },

  // A drawing with no writing on it is not a figure that lost its writing.
  // The ink checks made this exact mistake before they learned to abstain.
  'a figure with no readable writing abstains rather than failing'() {
    const diff = compareLabels([], [])
    ok(diff.passed, 'nothing to lose, nothing lost')
    ok(!diff.checked, 'but the caller must be told no test ran')
  },

  // The two sides disagree about where a word ends: a crisp render returns
  // "f(x)" whole, a scan returns "f" and "(x)". Neither is wrong about the
  // figure, and neither may be reported as a loss.
  'a word split differently by the two reads still counts as present'() {
    const diff = compareLabels(read(['f(x)', 93]), read(['f', 90], ['(x)', 88]))
    ok(diff.passed, `a split word is still the same word: ${diff.missing.join(',')}`)
  },

  'a word the scan split and the render kept whole also counts'() {
    const diff = compareLabels(read(['g', 91], ['(x)', 90]), read(['g(x)', 96]))
    ok(diff.passed, `${diff.missing.join(',')} should have matched`)
  },

  // Case is kept deliberately. The two sides do disagree about it sometimes,
  // but a figure that distinguishes f from F is exactly the kind this exists
  // to protect.
  'a case change is treated as a change'() {
    const diff = compareLabels(read(['f', 95]), read(['F', 95]))
    ok(!diff.passed, 'f is not F')
  },

  'punctuation the engine adds at the edges is ignored'() {
    const diff = compareLabels(read(['|y|', 90]), read(['y', 95]))
    ok(diff.passed, `edge punctuation is not part of the label: ${diff.missing.join(',')}`)
  },

  'every missing label is reported, not just the first'() {
    const diff = compareLabels(read(['x', 95], ['y', 95], ['z', 95]), read(['x', 95]))
    eq(diff.missing.length, 2, 'both absences')
  },
})
