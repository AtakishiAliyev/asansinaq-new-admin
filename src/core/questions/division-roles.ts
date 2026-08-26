// Are the four cells of a division scheme in the right places?
//
// The scheme has exactly four roles — dividend, divisor, quotient, remainder —
// and the model fills them from a picture where they are distinguished only by
// POSITION. When the cells are plain numbers it usually gets them right. When
// they are expressions the roles scramble: one live row came back with
// dividend "A", divisor "n^2/n" and an EMPTY quotient, which is two roles
// crammed into one cell and a third left blank.
//
// None of that renders as an error. It draws a perfectly tidy scheme that says
// something the page does not, so the checks here are deterministic and cheap:
// a role that is empty, a role that still contains a division operator, and —
// when every cell is a number — the arithmetic itself.
import type { DivisionScheme } from '@/core/figures/figspec'

export interface RoleProblem {
  code: 'division_role_empty' | 'division_role_crammed' | 'division_arithmetic'
  message: string
}

/** A cell that is a plain integer, or null when it is symbolic. */
function asInteger(tex: string | undefined): number | null {
  const trimmed = (tex ?? '').trim()
  if (!/^-?\d+$/.test(trimmed)) return null
  return Number(trimmed)
}

/**
 * A division operator surviving inside a cell.
 *
 * `n^2/n` in the divisor is not a divisor — it is the divisor and the quotient
 * written as one fraction, which is the thing this notation exists to avoid.
 * `\frac` counts for the same reason.
 */
const CRAMMED = /[/÷]|\\frac|\\dfrac/

export function divisionRoleProblems(fig: DivisionScheme): RoleProblem[] {
  const problems: RoleProblem[] = []
  const cells: [string, string | undefined][] = [
    ['bölünən', fig.dividendTex],
    ['bölən', fig.divisorTex],
    ['bölüm', fig.quotientTex],
  ]

  for (const [name, value] of cells) {
    if (!(value ?? '').trim()) {
      problems.push({
        code: 'division_role_empty',
        message: `Bölmə sxemində "${name}" xanası boşdur — dörd rolun hamısı şəkildən oxunmalıdır`,
      })
    }
  }

  for (const [name, value] of [...cells, ['qalıq', fig.remainderTex] as [string, string | undefined]]) {
    if (value && CRAMMED.test(value)) {
      problems.push({
        code: 'division_role_crammed',
        message:
          `Bölmə sxemində "${name}" xanasında bölmə işarəsi var ("${value}") — ` +
          'iki rol bir xanaya yığılıb; hər rol öz xanasına yazılmalıdır',
      })
    }
  }

  // When every cell is a number the scheme is checkable outright, and a scheme
  // that does not satisfy its own arithmetic is not a reading of the page.
  const dividend = asInteger(fig.dividendTex)
  const divisor = asInteger(fig.divisorTex)
  const quotient = asInteger(fig.quotientTex)
  const remainder = fig.remainderTex === undefined ? 0 : asInteger(fig.remainderTex)
  if (dividend !== null && divisor !== null && quotient !== null && remainder !== null) {
    if (divisor === 0) {
      problems.push({ code: 'division_arithmetic', message: 'Bölən sıfırdır' })
    } else {
      const expected = divisor * quotient + remainder
      if (expected !== dividend) {
        problems.push({
          code: 'division_arithmetic',
          message:
            `Sxem öz hesabını ödəmir: ${divisor}×${quotient}+${remainder} = ${expected}, ` +
            `bölünən isə ${dividend} — rollar yerini dəyişib ola bilər`,
        })
      }
      // A remainder at or beyond the divisor means the division was not carried
      // to the end, which on a printed page means a cell was misread.
      if (Math.abs(remainder) >= Math.abs(divisor)) {
        problems.push({
          code: 'division_arithmetic',
          message: `Qalıq (${remainder}) böləndən (${divisor}) kiçik olmalıdır`,
        })
      }
    }
  }
  return problems
}
