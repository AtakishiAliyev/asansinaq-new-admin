import { segmentItems } from '@/core/segment/segmenter'
import { DEFAULT_PROFILE } from '@/core/segment/types'
import { deepEq, eq, ok, suite } from '../harness.ts'
import { column, items, PAGE_H, PAGE_W, question } from './fixtures.ts'

const seg = (specs: Parameters<typeof items>[0]) =>
  segmentItems(items(specs), 1, PAGE_W, PAGE_H)

const numbers = (specs: Parameters<typeof items>[0]) =>
  seg(specs).bands.map((b) => b.number)

export const segmenterSuite = suite('segment', {
  // Two pages of a reviewed book draw their question numbers as vector art, so
  // the text layer offered none — and the anchor reader, which cannot tell a
  // question number from a digit inside a formula, chained content digits
  // instead. It answered 2,3,5,7,8 for a page holding 47 to 52, and one of its
  // bands was four points tall on an 842pt page.
  'anchors that produce a band too short to be a question route to the scan lane'() {
    const page = seg([
      ...question(1, 50, 60),
      // Two "anchors" a few points apart: whatever they are, they are not two
      // questions, and the band between them cannot hold one.
      ...question(2, 50, 100),
      ...question(3, 50, 700),
      // Enough body text that the page is not dismissed on item count alone.
      { str: 'Bir mətn sətri', x: 50, y: 200, w: 120 },
      { str: 'Daha bir sətir', x: 50, y: 240, w: 120 },
      { str: 'Üçüncü sətir', x: 50, y: 420, w: 120 },
      { str: 'Dördüncü sətir', x: 50, y: 470, w: 120 },
    ])
    eq(page.isScan, true, 'səhifə AI yoluna verilməlidir')
    eq(page.bands.length, 0, 'yarımçıq bandlar ötürülmür')
    ok(
      page.notes.some((n) => n.includes('sual nömrələri yoxdur')),
      `səbəb qeyd olunmalıdır: ${page.notes.join(' | ')}`,
    )
  },

  // Judged against the page's own median, so a page of many small questions is
  // not punished for being dense. Every honest page in the reviewed book had a
  // shortest band of 42-55% of its median.
  'a page of evenly sized questions is left alone'() {
    const page = seg(column(1, 6, 50, 60, 120))
    eq(page.isScan, false, 'mətn qatı ilə emal olunmalıdır')
    eq(page.bands.length, 6)
  },

  'single column keeps every question in order'() {
    const page = seg(column(1, 4, 50, 100))
    eq(page.isScan, false, 'isScan')
    deepEq(
      page.bands.map((b) => b.number),
      [1, 2, 3, 4],
      'band nömrələri',
    )
    ok(
      page.bands.every((b) => b.col === 0),
      'hamısı tək sütunda',
    )
  },

  'two columns read left to right, not top to bottom'() {
    const page = seg([...column(1, 4, 50, 100), ...column(5, 4, 320, 100)])
    deepEq(
      page.bands.map((b) => `${b.col}:${b.number}`),
      ['0:1', '0:2', '0:3', '0:4', '1:5', '1:6', '1:7', '1:8'],
      'sütun sırası',
    )
  },

  'a numbered list is not a question page'() {
    // Anchors one text line apart: an answer-key table or a contents page.
    // Emitting crops for these would bill a model call per list row.
    const page = seg(
      Array.from({ length: 10 }, (_, i) => ({
        str: `${i + 1}. Bölmə adı`,
        x: 50,
        y: 100 + i * 20,
        w: 180,
      })),
    )
    eq(page.isScan, false, 'mətn qatı var')
    deepEq(page.bands, [], 'bant yoxdur')
    ok(page.notes.length > 0, 'səbəb qeyd olunub')
  },

  'a page with no text layer routes to the scan path'() {
    const page = seg([{ str: 'səhifə 12', x: 50, y: 800 }])
    eq(page.isScan, true, 'isScan')
    deepEq(page.bands, [], 'bant yoxdur')
  },

  'a stray number above question 1 does not poison the chain'() {
    // "2." printed inside a figure at the left margin, above the real Q1.
    const page = numbers([
      { str: '2. şəkildəki kimi', x: 52, y: 80, w: 120 },
      ...column(1, 4, 50, 120),
    ])
    deepEq(page, [1, 2, 3, 4], 'artan zəncir saxlanılır')
  },

  'content above the first anchor joins question 1'() {
    // A shared instruction line: it belongs to the first question, never to
    // nothing — the crop the model reads must carry it.
    const page = seg([
      { str: 'Aşağıdakı məlumatlara görə 1–4 suallarını cavablandırın.', x: 50, y: 90, w: 300 },
      ...column(1, 4, 50, 130),
    ])
    const first = page.bands[0]!
    ok(first.bbox.y <= 90, `1-ci bant yuxarıdan başlayır (y=${first.bbox.y})`)
    ok(first.textLayer.includes('cavablandırın'), 'təlimat mətni bandın içindədir')
  },

  'a question number past the profile maximum is not an anchor'() {
    // Documents the known ceiling: with maxQuestionNumber at 99, a book that
    // numbers straight through merges Q100+ into Q99's band.
    const page = numbers([
      ...column(97, 3, 50, 100),
      ...question(100, 50, 550),
      ...question(101, 50, 650),
    ])
    deepEq(page, [97, 98, 99], 'yalnız 99-a qədər')
    eq(DEFAULT_PROFILE.maxQuestionNumber, 99, 'profil tavanı')
  },

  'the header test number is read from the page top'() {
    const page = seg([
      { str: 'TEST - 7', x: 250, y: 30, w: 60 },
      ...column(1, 4, 50, 120),
    ])
    eq(page.testNo, 7, 'testNo')
  },

  'a rotated watermark is not content'() {
    const page = seg([
      { str: 'SAVEHOCA', x: 200, y: 400, w: 200, angle: 0.6 },
      ...column(1, 4, 50, 100),
    ])
    deepEq(
      page.bands.map((b) => b.number),
      [1, 2, 3, 4],
      'watermark bantları pozmur',
    )
    ok(
      page.bands.every((b) => !b.textLayer.includes('SAVEHOCA')),
      'watermark mətn qatına düşmür',
    )
  },
})
