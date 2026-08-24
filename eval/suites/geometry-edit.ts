// The editor's operations, checked without a browser.
//
// An editor is the one place in the pipeline where a human can destroy a figure
// silently. A delete that leaves a line pointing at a removed point renders as
// nothing and lints as an empty figure — the reviewer sees a picture that looks
// almost right and approves it. So the cascade, the marks, and the guards
// against self-contradicting specs are pinned here rather than checked by
// clicking around.
import {
  addAngle,
  addLine,
  addPoint,
  cycleMark,
  danglingRefs,
  movePoint,
  nextPointId,
  removeAngle,
  removeLine,
  removePoint,
  updateAngle,
  updateLine,
} from '@/core/figures/geometry-edit'
import type { GeometryFig } from '@/core/figures/figspec'
import { eq, ok, suite } from '../harness.ts'

const base = (): GeometryFig => ({
  kind: 'geometry',
  width: 320,
  height: 240,
  points: [
    { id: 'A', x: 40, y: 200, label: 'A', dot: true },
    { id: 'B', x: 280, y: 200, label: 'B', dot: true },
    { id: 'C', x: 160, y: 40, label: 'C', dot: true },
  ],
  lines: [
    { from: 'A', to: 'B' },
    { from: 'A', to: 'C', ticks: 2 },
    { from: 'B', to: 'C', ticks: 2 },
  ],
  angles: [{ at: ['A', 'C', 'B'], label: '40°', arcs: 1 }],
})

export const geometryEditSuite = suite('geometry-edit', {
  'nothing mutates the spec it was given'() {
    const fig = base()
    const snapshot = JSON.stringify(fig)
    movePoint(fig, 'A', 1, 2)
    removePoint(fig, 'B')
    addLine(fig, 'A', 'B')
    updateAngle(fig, 0, { right: true })
    eq(JSON.stringify(fig), snapshot, 'the original is untouched')
  },

  // The cascade. Without it the figure keeps edges pointing at a point that no
  // longer exists: the renderer skips them, so two edges vanish from a delete
  // of one point and the drawing is quietly wrong.
  'deleting a point takes its edges and angles with it'() {
    const fig = removePoint(base(), 'C')
    eq(fig.points.length, 2, 'the point is gone')
    eq(fig.lines.length, 1, 'both edges that used it are gone')
    eq(fig.angles?.length, 0, 'the angle that used it is gone')
    eq(danglingRefs(fig).length, 0, 'nothing refers to a point that is not there')
  },

  'a figure that has been edited never refers to a missing point'() {
    let fig = base()
    fig = removePoint(fig, 'A')
    fig = removePoint(fig, 'B')
    eq(danglingRefs(fig).length, 0, 'no dangling references remain')
  },

  'an edge is the same edge in either direction'() {
    const fig = addLine(base(), 'B', 'A')
    eq(fig.lines.length, 3, 'BA is not added beside AB')
  },

  'an edge needs two different points that exist'() {
    eq(addLine(base(), 'A', 'A').lines.length, 3, 'a point does not join itself')
    eq(addLine(base(), 'A', 'Z').lines.length, 3, 'an unknown point is refused')
  },

  'a new point gets a free id'() {
    const fig = addPoint(base(), 10, 20)
    eq(nextPointId(base()), 'D', 'A, B and C are taken')
    eq(fig.points.length, 4, 'the point is added')
    eq(fig.points[3]?.id, 'D', 'with the free id')
  },

  // Both of these are contradictions the lint reports. The editor must not be
  // able to produce them, or a reviewer fixing one flag creates another.
  'turning a segment into a ray drops its length marks'() {
    const fig = updateLine(base(), 1, { kind: 'ray' })
    eq(fig.lines[1]?.ticks, undefined, 'a ray has no length to mark')
    eq(fig.lines[1]?.kind, 'ray', 'and it is a ray')
  },

  'marking an angle square drops its arcs'() {
    const fig = updateAngle(base(), 0, { right: true })
    eq(fig.angles?.[0]?.arcs, undefined, 'a right angle is a square, not arcs')
    eq(fig.angles?.[0]?.right, true, 'and it is right')
  },

  'a mark cycles through the three groups and off'() {
    eq(cycleMark(undefined), 1, 'off then one')
    eq(cycleMark(1), 2, 'one then two')
    eq(cycleMark(2), 3, 'two then three')
    eq(cycleMark(3), undefined, 'three then off')
  },

  'an angle needs three distinct points and is not added twice'() {
    const fig = base()
    eq(addAngle(fig, ['A', 'A', 'B']).angles?.length, 1, 'a repeated point is refused')
    eq(addAngle(fig, ['A', 'C', 'Z']).angles?.length, 1, 'an unknown point is refused')
    eq(addAngle(fig, ['B', 'C', 'A']).angles?.length, 1, 'the same angle reversed is refused')
    eq(addAngle(fig, ['A', 'B', 'C']).angles?.length, 2, 'a genuinely new angle is added')
  },

  'removing by index removes the one asked for'() {
    const fig = removeLine(base(), 1)
    eq(fig.lines.length, 2, 'one fewer')
    ok(
      !fig.lines.some((l) => l.from === 'A' && l.to === 'C'),
      'and it is the one at that index',
    )
    eq(removeAngle(base(), 0).angles?.length, 0, 'the angle goes too')
  },

  // Marks are the premise of these questions, so an edit that clears one must
  // remove the field rather than leave a zero: a `ticks: 0` reads as a mark to
  // anything checking whether the field is present.
  'clearing a mark removes the field rather than zeroing it'() {
    const fig = updateLine(base(), 1, { ticks: undefined })
    ok(!('ticks' in (fig.lines[1] ?? {})), 'the field is gone, not set to zero')
  },
})
