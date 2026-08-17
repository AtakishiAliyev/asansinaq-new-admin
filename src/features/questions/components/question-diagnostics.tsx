import { Info, ShieldCheck, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { Flag } from '@/core/questions/lint'

const FLAG_HINTS: Record<string, string> = {
  raster_figure: 'fiqur şəkil kimi yaradılıb — gözlə təsdiqlə',
  raster_mismatch: 'yaradılan fiqur orijinala uyğun gəlmədi',
  figure_failed: 'fiqur yaradıla bilmədi',
  option_figure_failed: 'variant şəkli yaradıla bilmədi',
  option_figure_mismatch: 'variant şəkli orijinala uyğun gəlmədi',
  missing_figure: 'sual şəklə istinad edir, amma fiqur yoxdur',
  option_count: 'variant sayı 5 deyil',
  option_empty: 'variantın nə mətni, nə şəkli var',
  option_duplicate: 'iki variant eynidir — biri səhv oxunub',
  option_labels: 'variant hərfləri A–E deyil',
  option_latex: 'variant LaTeX-i render olunmur',
  stem_latex: 'sual mətnindəki LaTeX render olunmur',
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
