// Are the four cells of a division scheme in the right places?
//
// The scheme has exactly four roles — dividend, divisor, quotient, remainder —
// and the model fills them from a picture where they are distinguished only by
// POSITION. When the cells are plain numbers it usually gets them right. When
// they are expressions the roles scramble: one live row came back with
// dividend "A", divisor "n^2/n" and an EMPTY quotient, which is two roles
// crammed into one cell. (The blank quotient on its own is not the defect —
// the remainder-only form prints none — the slash in the divisor is.)
//
// None of that renders as an error. It draws a perfectly tidy scheme that says
// something the page does not, so the checks here are deterministic and cheap:
// a role that is empty, a role that still contains a division operator, and —
// when every cell is a number — the arithmetic itself.
import type { DivisionScheme } from '@/core/figures/figspec'

export interface RoleProblem {
  code:
    | 'division_role_empty'
    | 'division_role_crammed'
    | 'division_role_misplaced'
    | 'division_arithmetic'
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

/**
 * The degree of a polynomial in x, or null when the cell is not one.
 *
 * Function notation is the case that has to be null rather than wrong:
 * `B(x)`, `K(x)`, `P(x+1)` all contain an `x`, and read as degree one they
 * would make every quotient named as a function look misplaced. A bare
 * symbol (`K`, `a`) is null too — it could be anything.
 */
export function polyDegree(tex: string | undefined): number | null {
  const s = (tex ?? '').replace(/\s|\\left|\\right/g, '').replace(/[−–]/g, '-')
  if (!s) return null
  if (/[A-Za-z]\(/.test(s)) return null // f(x), P(x+1): a name applied, not a polynomial
  if (!/x/.test(s)) return /^[-+]?\(?\d+(\.\d+)?\)?$/.test(s) ? 0 : null
  if (/[A-Zb-wyz]/.test(s)) return null // other symbols in play: degree is not knowable
  const powers = [...s.matchAll(/x(?:\^\{?(\d+)\}?)?/g)].map((m) => (m[1] ? Number(m[1]) : 1))
  return powers.length ? Math.max(...powers) : null
}

/** A lone minus sign: the subtraction operator, which is not a cell. */
const LONE_MINUS = /^[-−–]$/

/**
 * A cell that is a NAME rather than an expression — `K`, `K(x)`, `B(x)`,
 * `P^2(x)` — and the letter it goes by.
 */
function namedUnknown(tex: string | undefined): string | null {
  const m = (tex ?? '').replace(/\s/g, '').match(/^([A-Z])(?:\^\{?\d\}?)?(?:\([a-z](?:[+-]\d+)?\))?$/)
  return m ? m[1]! : null
}

/** Does the stem ask for this name — `K = ?`, `K(x) = ?`, `⇒ B(x)=?` */
function stemAsksFor(stem: string, name: string): boolean {
  return new RegExp(`(^|[^A-Za-z\\\\])${name}(\\^\\{?\\d\\}?)?(\\([^)]*\\))?\\s*=\\s*\\?`).test(stem)
}

/**
 * The question around the scheme, for the one check that needs it: which
 * role a NAMED unknown plays cannot be read off the name, but the options
 * the question offers for it carry its degree.
 */
export interface SchemeContext {
  stem: string
  /** every option's TeX; an option with none is an empty string */
  optionTexs: string[]
}

export function divisionRoleProblems(fig: DivisionScheme, context?: SchemeContext): RoleProblem[] {
  const problems: RoleProblem[] = []
  const cells: [string, string | undefined][] = [
    ['bölünən', fig.dividendTex],
    ['bölən', fig.divisorTex],
    ['bölüm', fig.quotientTex],
  ]
  const filled = (v: string | undefined) => (v ?? '').trim().length > 0

  // The two cells every scheme prints. The quotient is NOT one of them: the
  // polynomial-remainder form these books lean on — `P(x) │ x²+1`, a minus,
  // the rule, `7x+7` beneath — prints no quotient at all, because the
  // question is about the remainder. Fifty-six live schemes of exactly that
  // shape were flagged for an empty quotient, and not one was a misread. The
  // misread that motivated this check (dividend `A`, divisor `n^2/n`,
  // quotient blank) is still caught: its divisor carries the slash.
  for (const [name, value] of cells.slice(0, 2)) {
    if (!filled(value)) {
      problems.push({
        code: 'division_role_empty',
        message: `Bölmə sxemində "${name}" xanası boşdur — bölünən və bölən hər sxemdə çap olunur`,
      })
    }
  }
  // A scheme with neither a quotient nor a remainder says nothing: two
  // numbers and a bar. One of the two lower cells has to be there.
  if (!filled(fig.quotientTex) && !filled(fig.remainderTex)) {
    problems.push({
      code: 'division_role_empty',
      message: 'Bölmə sxemində nə bölüm, nə qalıq var — aşağı xanalardan ən azı biri şəkildən oxunmalıdır',
    })
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

  // The remainder-only form, read with the remainder in the wrong cell. The
  // book prints the remainder under the DIVIDEND, below a minus and a rule;
  // the model kept putting that expression under the divisor instead, as the
  // quotient, and leaving the remainder blank. Nine live schemes, three of
  // them approved, because the verifier compares pictures and did not see
  // which side of the bar the expression was on. Degree settles it: the
  // remainder of a division by a degree-d polynomial has degree below d, and
  // in these books a quotient never does.
  //
  // Three readings settle it, each on its own. The remainder cell holding a
  // lone minus is the surest: the model read the subtraction sign as a cell,
  // so whatever it put under the divisor is what sits under that sign. Then
  // degree. Then, for a NAMED unknown — `K`, `K(x)` — which degree cannot
  // judge, the options the question offers for it: a divisor of degree three
  // and five answers of degree at most two make `K(x)` the remainder, and the
  // one quotient-only scheme in the book (`B(x)` under `x²+x−1`, answers of
  // degree two) is left alone by the same measure.
  const dq = polyDegree(fig.quotientTex)
  const dd = polyDegree(fig.divisorTex)
  const misplaced = (why: string) =>
    problems.push({
      code: 'division_role_misplaced',
      message:
        `Bölmə sxemində "${fig.quotientTex}" bölüm xanasına yazılıb, amma ${why} — ` +
        'bu QALIQDIR: kitabda bölünənin altında, çıxma xəttinin altındadır. remainder_tex-ə yaz, quotient_tex boş qalsın',
    })
  if (LONE_MINUS.test((fig.remainderTex ?? '').trim())) {
    if (filled(fig.quotientTex)) misplaced('qalıq xanasındakı "-" çıxma işarəsidir, xana deyil')
    else
      problems.push({
        code: 'division_role_misplaced',
        message: 'Qalıq xanasında tək "-" var: bu çıxma işarəsidir, xana deyil. Xəttin altındakı ifadəni remainder_tex-ə yaz',
      })
  } else if (filled(fig.quotientTex) && !filled(fig.remainderTex) && dd !== null && dd > 0) {
    if (dq !== null && dq < dd) {
      misplaced(`dərəcəsi (${dq}) bölənin dərəcəsindən (${dd}) kiçikdir`)
    } else if (dq === null && context) {
      const name = namedUnknown(fig.quotientTex)
      const degrees = context.optionTexs.map(polyDegree)
      if (
        name !== null &&
        stemAsksFor(context.stem, name) &&
        degrees.length >= 2 &&
        degrees.every((d) => d !== null && d < dd)
      )
        misplaced(`sual "${name}"-nı soruşur və bütün variantlar bölənin dərəcəsindən (${dd}) kiçikdir`)
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
