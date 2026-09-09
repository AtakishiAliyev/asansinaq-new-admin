import { stripModelAside } from '@/core/questions/model-aside'
import { eq, suite } from '../harness.ts'

export const modelAsideSuite = suite('model-aside', {
  // Eighteen of one run's 150 questions ended with a line the book does not
  // print — the model restating what the question asks before answering it.
  // Measured against the book's own text layer: thirteen appear nowhere in it,
  // and the rest are the question sentence repeated with an arrow bolted on.
  'a trailing arrow line is dropped'() {
    eq(
      stripModelAside('AB ve BA iki basamaklı sayılardır.\nBA kaç katıdır?\n⇒ BA = ?'),
      'AB ve BA iki basamaklı sayılardır.\nBA kaç katıdır?',
      'ox sətri qalır',
    )
  },

  // A live row wrote it as maths rather than as a character, so a rule that
  // knows only about `⇒` would let that one through.
  'the arrow written as TeX is the same line'() {
    eq(stripModelAside('Şərt.\nSual?\n$\\Rightarrow$ A = ?'), 'Şərt.\nSual?', 'TeX oxu buraxılır')
    eq(stripModelAside('Şərt.\nSual?\n$⇒ \\text{Cevap} = ?$'), 'Şərt.\nSual?', 'düstur içindəki ox buraxılır')
  },

  // A book DOES print an implication inside a chain of working. Such a line is
  // followed by the sentence that asks the question, so it is never the last
  // one — and restricting the rule to the tail is what separates the model's
  // summary from the page's own algebra.
  'an implication in the middle of the working stays'() {
    const stem = 'Şərt.\n$a = 2 ⇒ b = 3$\nolduğuna göre b kaçtır?'
    eq(stripModelAside(stem), stem, 'kitabın öz nəticə zənciri silinib')
  },

  // An arrow is not grounds for emptying a stem: a one-line stem that happens
  // to start with one is all the wording there is.
  'the only line is never dropped'() {
    eq(stripModelAside('⇒ a + b = ?'), '⇒ a + b = ?', 'stem boşaldılıb')
    eq(stripModelAside('\n\n⇒ a + b = ?\n'), '\n\n⇒ a + b = ?\n', 'boş sətirlər tək sətri gizlədir')
  },

  'a stem the model added nothing to is unchanged'() {
    const stem = 'a ve b tam sayılardır.\n$a + b = 7$\nBuna göre a kaçtır?'
    eq(stripModelAside(stem), stem, 'təmiz stem dəyişib')
  },

  // The blank line the removed aside sat under goes with it, or the stem ends
  // in whitespace the renderer paints as an empty paragraph.
  'the gap the aside left is closed'() {
    eq(stripModelAside('Şərt.\nSual?\n\n⇒ Toplam = ?'), 'Şərt.\nSual?', 'boşluq qalıb')
  },
})
