import { useMemo } from 'react'
import { Minus, Plus, RotateCcw, Trash2, Undo2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import type { FigureDoc } from '@/core/figures/figspec'
import { cycleMark, danglingRefs } from '@/core/figures/geometry-edit'
import { lintQuestion, type Flag } from '@/core/questions/lint'
import type { ExtractedQuestion } from '@/core/questions/extraction'
import { GeometryCanvas } from '@/features/questions/components/figure-editor/geometry-canvas'
import { useFigureEditor } from '@/features/questions/hooks/use-figure-editor'
import type { RowOption } from '@/features/questions/lib/row'
import { cn } from '@/lib/utils'

// Editing the figure's DATA, not regenerating it.
//
// A re-run is a dice-roll: it costs money, it may come back worse, and it
// cannot be aimed at the one thing that is wrong. Almost every residual figure
// defect is a single field — an angle that was never declared, a tick that
// landed on the wrong edge, a label reading 30 where the book says 50 — and a
// person who can see the crop can fix that in a few seconds if the fields are
// reachable.
//
// Everything here operates on the spec through the pure functions in
// `core/figures/geometry-edit.ts`, so the guards against self-contradicting
// figures hold whatever the UI does, and the preview is the real renderer's
// output rather than a second drawing made for editing.

const MARK_LABEL = ['—', '1', '2', '3']

function MarkButton({
  value,
  onCycle,
  title,
  children,
}: {
  value: number | undefined
  onCycle: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant={value ? 'secondary' : 'outline'}
      size="sm"
      title={title}
      className="h-7 gap-1 px-2 font-mono text-[11px]"
      onClick={onCycle}
    >
      {children}
      <span className="tabular-nums">{MARK_LABEL[value ?? 0]}</span>
    </Button>
  )
}

export function FigureEditorDialog({
  open,
  onOpenChange,
  doc,
  itemIndex,
  question,
  qNo,
  isPending,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  doc: FigureDoc | null
  itemIndex: number
  question: { stem: string | null; options: RowOption[] }
  qNo: number | null
  isPending: boolean
  onSave: (next: FigureDoc) => void
}) {
  const editor = useFigureEditor(doc, itemIndex)
  const { fig } = editor

  // The same lint the worker runs, live. A reviewer fixing a flag should see it
  // clear as they fix it; running a different check here would mean the row
  // still lands flagged after an edit that looked like it worked.
  const flags = useMemo<Flag[]>(() => {
    if (!fig) return []
    const draft: ExtractedQuestion = {
      numberSeen: qNo ?? 0,
      stem: question.stem ?? '',
      options: question.options as unknown as ExtractedQuestion['options'],
      figures: { v: 1, items: [fig] },
      illegible: false,
      clipped: false,
      foreign: false,
      confidence: 1,
      warnings: [],
    }
    // Only the figure's own findings: the option and stem rules belong to the
    // other editor, and showing them here is noise a reviewer cannot act on.
    return lintQuestion(draft, qNo ?? undefined).filter((f) => f.code.startsWith('geo') || f.code.startsWith('figure'))
  }, [fig, qNo, question])

  const dangling = fig ? danglingRefs(fig) : []

  if (!fig) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Fiqur redaktoru</DialogTitle>
            <DialogDescription>
              Bu fiqur həndəsi deyil, ona görə burada redaktə oluna bilmir.
              Nöqtə, xətt və bucaqlarla ifadə olunan fiqurlar redaktə edilir.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Bağla
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  const selected = editor.selection

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92vh] max-w-[92vw] flex-col gap-3 sm:max-w-[92vw]">
        <DialogHeader className="space-y-1">
          <DialogTitle className="font-mono text-sm tracking-[0.14em] uppercase">
            Fiqur redaktoru
          </DialogTitle>
          <DialogDescription>
            Nöqtəni sürüşdürün, işarələri dəyişin, bucaq elan edin. Sağdakı
            görüntü sonda saxlanılacaq fiqurun özüdür.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-h-0 flex-col gap-2 overflow-auto">
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant={editor.mode === 'add' ? 'secondary' : 'outline'}
                onClick={() => editor.startMode(editor.mode === 'add' ? 'select' : 'add')}
              >
                <Plus /> Nöqtə
              </Button>
              <Button
                type="button"
                size="sm"
                variant={editor.mode === 'line' ? 'secondary' : 'outline'}
                onClick={() => editor.startMode(editor.mode === 'line' ? 'select' : 'line')}
              >
                Parça
              </Button>
              <Button
                type="button"
                size="sm"
                variant={editor.mode === 'angle' ? 'secondary' : 'outline'}
                onClick={() => editor.startMode(editor.mode === 'angle' ? 'select' : 'angle')}
              >
                Bucaq
              </Button>
              <div className="ml-auto flex gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={!editor.canUndo}
                  onClick={editor.undo}
                >
                  <Undo2 /> Geri
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={!editor.isDirty}
                  onClick={editor.reset}
                >
                  <RotateCcw /> Sıfırla
                </Button>
              </div>
            </div>

            {editor.mode === 'line' || editor.mode === 'angle' ? (
              <p className="text-muted-foreground text-xs">
                {editor.mode === 'line'
                  ? 'İki nöqtə seçin.'
                  : 'Üç nöqtə seçin — ORTADAKI təpə nöqtəsidir.'}{' '}
                Seçilən: {editor.pending.join(' → ') || '—'}
              </p>
            ) : null}

            <div onPointerUp={editor.endDrag}>
              <GeometryCanvas
                fig={fig}
                selection={editor.selection}
                onSelect={editor.setSelection}
                onMovePoint={editor.handleMovePoint}
                pending={editor.pending}
                onPickPoint={editor.pickPoint}
                mode={editor.mode}
                onAddPoint={editor.addPointAt}
              />
            </div>

            {dangling.length ? (
              <p className="text-destructive text-xs">
                Mövcud olmayan nöqtələrə istinad var: {dangling.join(', ')}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-1.5">
              {flags.length ? (
                flags.map((flag, i) => (
                  <Badge
                    key={i}
                    variant="outline"
                    className={cn(
                      'font-normal',
                      flag.level === 'error'
                        ? 'border-destructive/30 bg-destructive/10 text-destructive'
                        : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
                    )}
                    title={flag.code}
                  >
                    {flag.message}
                  </Badge>
                ))
              ) : (
                <Badge variant="outline" className="font-normal">
                  Fiqur yoxlamadan keçir
                </Badge>
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
            <Section title={`Nöqtələr (${fig.points.length})`}>
              {fig.points.map((point) => (
                <Row
                  key={point.id}
                  active={selected?.kind === 'point' && selected.ref === point.id}
                  onSelect={() => editor.setSelection({ kind: 'point', ref: point.id })}
                >
                  <span className="w-6 font-mono text-xs">{point.id}</span>
                  <Input
                    value={point.label ?? ''}
                    placeholder="etiket"
                    className="h-7 flex-1 text-xs"
                    onChange={(e) => editor.updatePoint(point.id, { label: e.target.value })}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant={point.dot ? 'secondary' : 'outline'}
                    className="h-7 px-2 text-[11px]"
                    title="Nöqtə işarəsi"
                    onClick={() => editor.updatePoint(point.id, { dot: !point.dot })}
                  >
                    •
                  </Button>
                  <IconAction
                    label={`${point.id} nöqtəsini sil`}
                    onClick={() => editor.removePoint(point.id)}
                  />
                </Row>
              ))}
            </Section>

            <Section title={`Xətlər (${fig.lines.length})`}>
              {fig.lines.map((line, index) => (
                <Row
                  key={`${line.from}${line.to}${index}`}
                  active={selected?.kind === 'line' && selected.ref === index}
                  onSelect={() => editor.setSelection({ kind: 'line', ref: index })}
                >
                  <span className="w-10 font-mono text-xs">
                    {line.from}
                    {line.to}
                  </span>
                  <div className="flex gap-1">
                    {(['segment', 'ray', 'line'] as const).map((kind) => (
                      <Button
                        key={kind}
                        type="button"
                        size="sm"
                        variant={(line.kind ?? 'segment') === kind ? 'secondary' : 'outline'}
                        className="h-7 px-2 text-[11px]"
                        onClick={() => editor.updateLine(index, { kind })}
                      >
                        {kind === 'segment' ? 'parça' : kind === 'ray' ? 'şüa' : 'xətt'}
                      </Button>
                    ))}
                  </div>
                  <MarkButton
                    value={line.ticks}
                    title="Bərabər uzunluq işarəsi — yalnız parçada"
                    onCycle={() => editor.updateLine(index, { ticks: cycleMark(line.ticks) })}
                  >
                    <Minus className="size-3" />
                  </MarkButton>
                  <MarkButton
                    value={line.parallel}
                    title="Paralellik oxu"
                    onCycle={() => editor.updateLine(index, { parallel: cycleMark(line.parallel) })}
                  >
                    ∥
                  </MarkButton>
                  <IconAction
                    label={`${line.from}${line.to} xəttini sil`}
                    onClick={() => editor.removeLine(index)}
                  />
                </Row>
              ))}
            </Section>

            <Section title={`Bucaqlar (${fig.angles?.length ?? 0})`}>
              {(fig.angles ?? []).map((angle, index) => (
                <Row
                  key={`${angle.at.join('')}${index}`}
                  active={selected?.kind === 'angle' && selected.ref === index}
                  onSelect={() => editor.setSelection({ kind: 'angle', ref: index })}
                >
                  <span className="w-14 font-mono text-xs" title="təpə ortadadır">
                    ∠{angle.at.join('')}
                  </span>
                  <Input
                    value={angle.label ?? ''}
                    placeholder="30°, α"
                    className="h-7 w-20 text-xs"
                    onChange={(e) => editor.updateAngle(index, { label: e.target.value })}
                  />
                  <MarkButton
                    value={angle.arcs}
                    title="Bərabər bucaq qövsü"
                    onCycle={() => editor.updateAngle(index, { arcs: cycleMark(angle.arcs) })}
                  >
                    ⌒
                  </MarkButton>
                  <Button
                    type="button"
                    size="sm"
                    variant={angle.right ? 'secondary' : 'outline'}
                    className="h-7 px-2 font-mono text-[11px]"
                    title="Düz bucaq — kvadrat kimi çəkilir"
                    onClick={() => editor.updateAngle(index, { right: !angle.right })}
                  >
                    ⦜
                  </Button>
                  <IconAction
                    label={`∠${angle.at.join('')} bucağını sil`}
                    onClick={() => editor.removeAngle(index)}
                  />
                </Row>
              ))}
            </Section>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <p className="text-muted-foreground text-xs">
            Saxlanılan fiqur maşın təsdiqini ləğv edir — sual yenidən yoxlanma
            növbəsinə düşür.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              Ləğv et
            </Button>
            <Button
              disabled={!editor.isDirty || isPending || dangling.length > 0}
              onClick={() => {
                const next = editor.toDoc()
                if (next) onSave(next)
              }}
            >
              {isPending ? <Spinner /> : null}
              Saxla
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
        {title}
      </p>
      <Separator />
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function Row({
  active,
  onSelect,
  children,
}: {
  active: boolean
  onSelect: () => void
  children: React.ReactNode
}) {
  return (
    <div
      onFocusCapture={onSelect}
      onMouseEnter={onSelect}
      className={cn(
        'flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5 transition',
        active ? 'border-primary/40 bg-primary/5' : 'border-transparent',
      )}
    >
      {children}
    </div>
  )
}

function IconAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      aria-label={label}
      title={label}
      className="text-muted-foreground hover:text-destructive ml-auto"
      onClick={onClick}
    >
      <Trash2 />
    </Button>
  )
}
