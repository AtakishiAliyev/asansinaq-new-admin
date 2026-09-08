import { Info, ShieldCheck, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { Flag } from '@/core/questions/lint'

const FLAG_HINTS: Record<string, string> = {
  geo_degenerate_angle: 'bucaq eyni nöqtələrdən ibarətdir',
  geo_right_angle_with_arcs: 'bucaq həm düz, həm qövslə işarələnib',
  geo_coincident_points: 'iki nöqtə eyni yerdədir',
  figure_missing_referenced_angle:
    'sual bu bucaqdan danışır, fiqurda çəkilə bilmir',
  figure_angle_not_marked: 'soruşulan bucaq fiqurda işarələnməyib',
  figure_missing_referenced_segment: 'sual bu parçadan danışır, fiqurda yoxdur',
  geo_ticks_on_ray:
    'şüada bərabər uzunluq işarəsi — paralellik nəzərdə tutulub?',
  geo_empty: 'həndəsə fiqurunda çəkiləcək bir şey yoxdur',
  gen_rejected:
    '1:1 təkrar çəkiliş qoruyucudan keçmədi — orijinal kəsim saxlanıldı',
  gen_unverified:
    'təkrar çəkiliş göstərilir, quruluş yoxlamasından keçmədi — kəsimlə müqayisə edin',
  gen_dropped_colour:
    'təkrar çəkiliş boyalı bölgəni dəyişdirdi və düzəlişlər həll etmədi — atıldı, orijinalın kəsimi göstərilir',
  gen_failed: 'təkrar çəkiliş alınmadı — orijinal kəsim saxlanıldı',
  gen_skipped: 'təkrar çəkiliş edilmədi (büdcə) — orijinal kəsim saxlanıldı',
  figure_rerouted:
    'seçilmiş fiqur növü bu fiquru ifadə etmir — orijinaldan kəsildi',
  figure_box_unverified:
    'fiqurun yeri piksellərdən təsdiqlənmədi — kəsimi yoxlayın',
  raster_figure: 'fiqur orijinaldan kəsilib (DSL ifadə etmir) — gözlə təsdiqlə',
  raster_mismatch: 'yaradılan fiqur orijinala uyğun gəlmədi',
  figure_failed: 'fiqur yaradıla bilmədi',
  option_figure_failed: 'variant şəkli yaradıla bilmədi',
  option_figure_mismatch: 'variant şəkli orijinala uyğun gəlmədi',
  missing_figure: 'sual şəklə istinad edir, amma fiqur yoxdur',
  figure_lane_promoted:
    'fiqur piksellərdən görünmədi — model bildirdiyi üçün çəkildi',
  option_count: 'variant sayı 5 deyil',
  option_prose: 'variant dəyər deyil, izahat kimi görünür',
  option_boxes_failed: 'variantların yerini tapan addım uğursuz oldu',
  option_image_no_box: 'variant şəkil kimi işarələnib, amma yeri göstərilməyib',
  option_empty: 'variantın nə mətni, nə şəkli var',
  option_image_cropped:
    'variant şəkilləri mənbədən kəsilib — su nişanı daşıya bilər, DSL fiquru deyil',
  option_duplicate: 'iki variant eynidir — biri səhv oxunub',
  option_labels: 'variant hərfləri A–E deyil',
  option_latex: 'variant LaTeX-i render olunmur',
  stem_latex: 'sual mətnindəki LaTeX render olunmur',
  stem_echoes_option:
    'variantın məzmunu sual mətninə çəkilib — mənbə ilə tutuşdurun',
  stem_from_figure:
    'şərt şəkildən oxunur — çap olunmuş mətn crop-dan kənardadır',
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

const LEVEL_CLASS: Record<Flag['level'], string> = {
  error: 'border-destructive/30 bg-destructive/10 text-destructive',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  // Quiet on purpose. An `info` flag is something to READ if the row is open,
  // not something to be pulled to — it is the level for a check whose false
  // positives are known and whose objection a stricter check already
  // overruled. Wearing the amber of a real warning is what made a screenful of
  // correct questions look like a screenful of problems.
  info: 'border-muted-foreground/20 bg-muted text-muted-foreground',
}

/** Loudest first, so the badge a reviewer must act on is the one they read. */
const LEVEL_RANK: Record<Flag['level'], number> = {
  error: 0,
  warning: 1,
  info: 2,
}

export function FlagBadges({ flags }: { flags: Flag[] }) {
  if (!flags.length) return null
  const ordered = [...flags].sort(
    (a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level],
  )
  return (
    <div className="flex flex-wrap gap-1.5">
      {ordered.map((f, i) => (
        <Badge
          key={`${f.code}-${i}`}
          variant="outline"
          className={cn('text-[11px]', LEVEL_CLASS[f.level])}
          title={f.message}
        >
          {f.level === 'info' ? <Info /> : <TriangleAlert />}
          {FLAG_HINTS[f.code] ?? f.code}
        </Badge>
      ))}
    </div>
  )
}

// What the badge may claim is exactly what ran.
//
// It used to read "iki oxunuş üst-üstə düşür" — two readings agree — which
// described the layer that was REMOVED when extraction became one structured
// call. Nothing reads the question twice any more: the recreation is rendered
// and compared against the original crop, once. A reviewer who reads the old
// wording trusts a second opinion that was never sought.
export function VerifiedBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <Badge
      variant="outline"
      className="border-emerald-200 bg-emerald-50 text-emerald-700"
      title="Yenidən yaradılmış sual şəkil kimi çəkilib orijinal kəsimlə müqayisə olunub və uyğun gəlib. Bu, ikinci müstəqil oxunuş deyil."
    >
      <ShieldCheck />
      orijinalla müqayisə olunub — uyğundur
    </Badge>
  ) : (
    <Badge
      variant="outline"
      className="border-amber-200 bg-amber-50 text-amber-800"
      title="Sual ya hələ müqayisə olunmayıb, ya da müqayisə uyğunluğu təsdiqləyə bilməyib — gözlə yoxlayın."
    >
      <Info />
      orijinalla uyğunluğu təsdiqlənməyib
    </Badge>
  )
}
