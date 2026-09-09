import { REPAIRABLE_CODES, structuralObjections } from '@/core/questions/structural-objections'
import { verificationBlocked } from '@/core/questions/verification-block'
import { repairNotesFrom } from '@/core/extract/repair-notes'
import { eq, notOk, ok, suite } from '../harness.ts'

const flag = (code: string, level = 'error', message = 'nə səhvdir') => ({ code, level, message })

export const structuralObjectionsSuite = suite('structural-objections', {
  // The three questions that prompted this were all flagged in red and all left
  // alone: the repair round was driven by the WAVE's critical differences and
  // nothing else, and the wave had called every one of them a match.
  'a structural error becomes a critical difference'() {
    const out = structuralObjections([flag('stack_indent_flat', 'error', 'Hissə-hasillər sola sürüşmür')])
    eq(out.length, 1, 'obyeksiya yaranmır')
    eq(out[0]!.severity, 'critical', 'kritik deyil — təmiri işə salmaz')
    ok(out[0]!.note.includes('sürüşmür'), 'mesaj itib — növbəti oxunuşa deyəcək söz qalmır')
  },

  // Shaped like the wave's own output, so the notes the next read is given
  // carry it without a second code path.
  'an objection reaches the next read as a repair note'() {
    const notes = repairNotesFrom(structuralObjections([flag('stack_result_unruled', 'error', 'Nəticənin üstündə xətt yoxdur')]))
    ok(notes?.includes('Nəticənin üstündə xətt yoxdur'), `qeyd çatmır: ${notes}`)
  },

  // A warning is a reviewer's signal. Paying for a read over one is how a lane
  // spends its budget on opinions.
  'a warning is not worth a read'() {
    eq(structuralObjections([flag('stack_indent_flat', 'warning')]).length, 0, 'xəbərdarlıq təmir tələb edir')
  },

  // Only findings a re-read can act on. `raster_figure` is deterministic and
  // about content and there is nothing for a reader to do about it.
  'a finding a re-read cannot act on is left alone'() {
    eq(structuralObjections([flag('raster_figure'), flag('low_confidence')]).length, 0, 'siyahı geniş qaçıb')
  },

  'the same code twice is one objection'() {
    eq(structuralObjections([flag('stack_indent_flat'), flag('stack_indent_flat')]).length, 1, 'təkrar qeyd')
  },

  'a row with no flags objects to nothing'() {
    eq(structuralObjections(null).length, 0, 'null')
    eq(structuralObjections([]).length, 0, 'boş')
  },

  // While one stands, the row is showing a layout our own measurements say is
  // wrong. Marking it verified on a model's say-so is the exact trade the
  // block list exists to refuse.
  'a standing objection keeps the row out of the verified lane'() {
    for (const code of Object.keys(REPAIRABLE_CODES)) {
      ok(verificationBlocked([flag(code)]), `${code} verified qarşısını almır`)
    }
    notOk(verificationBlocked([flag('raster_figure')]), 'bloklama siyahısı geniş qaçıb')
  },
})
