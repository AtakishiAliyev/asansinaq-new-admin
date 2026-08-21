import { Info, ShieldCheck, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { Flag } from '@/core/questions/lint'

const FLAG_HINTS: Record<string, string> = {
  nothing_to_read: 'nə mətn var, nə fiqur — sual saxlanıla bilməz',
  // No longer produced — the agent cannot keep a crop any more. Kept so
  // rows saved before that change still read as something in review.
  agent_cut_kept: 'şəkil orijinaldan kəsilib — watermark qala bilər',
  agent_gave_up: 'agent bacarmadı — səbəb sətrin xətasındadır',
  agent_transcribed: 'agent çıxarıb — gözlə yoxlayın',
  raw_svg_mismatch: 'çəkilən fiqur orijinaldan fərqli görünür — gözlə yoxlayın',
  raw_svg: 'sərbəst SVG fiquru — gözlə yoxlayın',
  raster_figure: 'fiqur şəkil kimi yaradılıb — gözlə təsdiqlə',
  raster_mismatch: 'yaradılan fiqur orijinala uyğun gəlmədi',
  figure_failed: 'fiqur yaradıla bilmədi',
  option_figure_failed: 'variant şəkli yaradıla bilmədi',
  option_figure_mismatch: 'variant şəkli orijinala uyğun gəlmədi',
  missing_figure: 'sual şəklə istinad edir, amma fiqur yoxdur',
  figure_lane_promoted: 'fiqur piksellərdən görünmədi — model bildirdiyi üçün çəkildi',
  option_count: 'variant sayı 5 deyil',
  option_prose: 'variant dəyər deyil, izahat kimi görünür',
  option_boxes_failed: 'variantların yerini tapan addım uğursuz oldu',
  option_image_no_box: 'variant şəkil kimi işarələnib, amma yeri göstərilməyib',
  option_empty: 'variantın nə mətni, nə şəkli var',
  option_duplicate: 'iki variant eynidir — biri səhv oxunub',
  option_labels: 'variant hərfləri A–E deyil',
  option_latex: 'variant LaTeX-i render olunmur',
  stem_latex: 'sual mətnindəki LaTeX render olunmur',
  stem_from_figure: 'şərt şəkildən oxunur — çap olunmuş mətn crop-dan kənardadır',
  empty_stem: 'sual mətni boşdur',
  illegible: 'model mətni oxuya bilmədi',
  clipped: 'crop kəsilmiş ola bilər',
  foreign: 'crop-da qonşu sualın parçası var',
  number_mismatch: 'oxunan nömrə gözlənilənlə uyğun deyil',
  low_confidence: 'model öz cavabına az əmindir',
  watermark_leak: 'mətnə watermark qarışıb',
  point_off_curve: 'işarələnmiş nöqtə əyrinin üstündə deyil',
  second_read_failed: 'ikinci oxunuş alınmadı — müstəqil təsdiq yoxdur',
  answer_missing: 'cavab yoxdur — açarı idxal edin və ya əl ilə seçin',
  answer_key_unread: 'cavab açarı oxunmadı (şəbəkə xətası) — yenidən çıxarın',
  answer_mismatch: 'cavab açarı ilə uyğunsuzluq — yoxlayın',
  curve_invalid: 'əyri ifadəsi hesablanmır',
  venn_unknown_set: 'Venn ifadəsində tanınmayan çoxluq var',
  venn_parse: 'Venn ifadəsi oxunmur',
  venn_empty: 'Venn fiquru boşdur',
}

export function FlagBadges({ flags }: { flags: Flag[] }) {
  if (!flags.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {flags.map((f, i) => (
        <Badge
          key={`${f.code}-${i}`}
          variant="outline"
          className={cn(
            'text-[11px]',
            f.level === 'error'
              ? 'border-destructive/30 bg-destructive/10 text-destructive'
              : 'border-amber-200 bg-amber-50 text-amber-800',
          )}
          title={f.message}
        >
          <TriangleAlert />
          {FLAG_HINTS[f.code] ?? f.code}
        </Badge>
      ))}
    </div>
  )
}

export function VerifiedBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <Badge
      variant="outline"
      className="border-emerald-200 bg-emerald-50 text-emerald-700"
    >
      <ShieldCheck />
      iki oxunuş üst-üstə düşür
    </Badge>
  ) : (
    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
      <Info />
      müstəqil təsdiq yoxdur
    </Badge>
  )
}
