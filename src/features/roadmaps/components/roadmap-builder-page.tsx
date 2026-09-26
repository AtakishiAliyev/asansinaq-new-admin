import { useEffect, useMemo, useRef, useState } from 'react'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Eye,
  GripVertical,
  Lock,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { QueryErrorAlert } from '@/components/query-error-alert'
import { NotFoundPage } from '@/app/not-found-page'
import { usePageTitle } from '@/hooks/use-page-title'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { normalizeError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import {
  fetchCategories,
  useSubjects,
  type Category,
} from '@/features/taxonomy'
import { useQuery } from '@tanstack/react-query'
import { examKeys } from '@/features/exams/api/keys'
import { useBankCounts, useFacets } from '@/features/exams/api/search'
import type { BuilderQuestion, SearchFilters } from '@/features/exams/schemas'
import {
  EMPTY_FILTERS,
  type PanelFilters,
} from '@/features/exams/lib/panel-filters'
import { FilterPanel } from '@/features/exams/components/builder/filter-panel'
import { ResultsList } from '@/features/exams/components/builder/results-list'
import { QuestionDialog } from '@/features/exams/components/builder/preview-dialogs'
import { DifficultyDot } from '@/features/exams/components/builder/difficulty-badge'
import { StemText } from '@/components/question/tex'
import {
  useAddNode,
  useAddStage,
  useArchiveRoadmap,
  useDeleteNode,
  useDeleteStage,
  useMoveNode,
  useNodeItems,
  usePublishProblems,
  usePublishRoadmap,
  useRenameStage,
  useReorderStages,
  useRoadmap,
  useSetNodeItems,
  useUpdateNode,
  useUpdateRoadmap,
} from '@/features/roadmaps/api/roadmaps'
import {
  NODE_KIND_LABEL,
  NODE_KINDS,
  STATUS_LABEL,
  type NodeKind,
  type RoadmapDetail,
  type RoadmapNodeRow,
} from '@/features/roadmaps/schemas'

// The roadmap builder: the path on the left (stages and their nodes, in
// order), the bank in the middle, the chosen node's questions on the
// right. It borrows the deneme builder's filter panel and results list,
// because picking a question from the bank is the same act; what differs
// is where it lands — a node, not a section — and that a node has no fixed
// size.
export function RoadmapBuilderPage() {
  const { roadmapId } = useParams()
  const id = Number(roadmapId)
  const roadmap = useRoadmap(Number.isInteger(id) ? id : 0)
  usePageTitle(roadmap.data ? roadmap.data.title : 'Yol xəritəsi')

  if (!Number.isInteger(id) || id <= 0) return <NotFoundPage />
  if (roadmap.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-12" />
        <Skeleton className="h-96" />
      </div>
    )
  }
  if (roadmap.isError) {
    return (
      <QueryErrorAlert
        error={roadmap.error}
        onRetry={() => void roadmap.refetch()}
        isRetrying={roadmap.isFetching}
      />
    )
  }
  return <Builder roadmap={roadmap.data} />
}

function Builder({ roadmap: r }: { roadmap: RoadmapDetail }) {
  const nodes = useMemo(() => r.stages.flatMap((s) => s.nodes), [r.stages])
  const [selectedId, setSelectedId] = useState<number | null>(
    nodes[0]?.id ?? null,
  )
  const selected = nodes.find((n) => n.id === selectedId) ?? nodes[0] ?? null
  const [preview, setPreview] = useState(false)

  return (
    <div className="-m-4 flex h-[calc(100dvh-3rem)] min-h-0 flex-col md:-m-6">
      <Header roadmap={r} onPreview={() => setPreview(true)} />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[300px_minmax(0,1fr)_360px]">
        <PathColumn
          roadmap={r}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
        />
        {selected ? (
          <>
            <BankColumn roadmap={r} node={selected} />
            <NodeColumn roadmap={r} node={selected} />
          </>
        ) : (
          <div className="text-muted-foreground flex items-center justify-center p-8 text-sm lg:col-span-2">
            Soldan bir addım əlavə edin — sualları burada yığacaqsınız.
          </div>
        )}
      </div>
      <PreviewDialog roadmap={r} open={preview} onOpenChange={setPreview} />
    </div>
  )
}

// ── header ──────────────────────────────────────────────────────────────────
function Header({
  roadmap: r,
  onPreview,
}: {
  roadmap: RoadmapDetail
  onPreview: () => void
}) {
  const update = useUpdateRoadmap(r.id)
  const publish = usePublishRoadmap(r.id)
  const archive = useArchiveRoadmap(r.id)
  const problems = usePublishProblems(r.id)
  const [title, setTitle] = useState(r.title)
  const [description, setDescription] = useState(r.description)
  const [progress, setProgress] = useState<[number, number] | null>(null)
  const stale =
    r.current && new Date(r.draft_updated_at) > new Date(r.current.published_at)
  const issues = problems.data ?? []

  const commit = () => {
    const patch: { title?: string; description?: string } = {}
    if (title.trim() && title.trim() !== r.title) patch.title = title.trim()
    if (description.trim() !== r.description)
      patch.description = description.trim()
    if (!Object.keys(patch).length) return
    update.mutate(patch, {
      onError: (e) => toast.error(normalizeError(e).message),
    })
  }

  return (
    <header className="flex flex-wrap items-start gap-x-4 gap-y-2 border-b px-4 py-3">
      <Button
        variant="ghost"
        size="icon"
        asChild
        aria-label="Yol xəritələrinə qayıt"
      >
        <Link to="/roadmaps">
          <ArrowLeft />
        </Link>
      </Button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          aria-label="Yol xəritəsinin adı"
          className="h-8 max-w-md border-transparent px-1.5 text-lg font-semibold shadow-none hover:border-input focus-visible:border-input"
        />
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={commit}
          rows={1}
          placeholder="Bir cümlə ilə: bu yol nəyi öyrədir (tələbə kartda görür)"
          aria-label="Açıqlama"
          className="max-w-xl min-h-8 resize-none border-transparent px-1.5 py-1 text-sm shadow-none hover:border-input focus-visible:border-input"
        />
        <div className="text-muted-foreground flex flex-wrap items-center gap-2 px-1.5 text-xs">
          <Badge
            variant="outline"
            className={
              r.status === 'published'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : undefined
            }
          >
            {STATUS_LABEL[r.status]}
            {r.current ? ` · v${r.current.version_no}` : ''}
          </Badge>
          {stale ? (
            <Badge
              variant="outline"
              className="border-amber-200 bg-amber-50 text-amber-800"
            >
              dərc olunmamış dəyişiklik
            </Badge>
          ) : null}
          <span>
            {r.stages.length} mərhələ ·{' '}
            {r.stages.reduce((s, x) => s + x.nodes.length, 0)} addım ·{' '}
            {r.stages.reduce(
              (s, x) =>
                s + x.nodes.reduce((t, n) => t + (n.items[0]?.count ?? 0), 0),
              0,
            )}{' '}
            sual
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onPreview}>
          <Eye data-icon="inline-start" /> Tələbə görünüşü
        </Button>
        {r.status === 'archived' ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => archive.mutate(false)}
          >
            Arxivdən çıxar
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => archive.mutate(true)}
          >
            Arxivlə
          </Button>
        )}
        <Button
          size="sm"
          disabled={
            publish.isPending || problems.isPending || issues.length > 0
          }
          title={issues.length ? issues.join('\n') : undefined}
          onClick={() =>
            publish.mutate((done, total) => setProgress([done, total]), {
              onSuccess: (v) => {
                setProgress(null)
                toast.success(`Dərc olundu — v${v.version_no}`)
              },
              onError: (e) => {
                setProgress(null)
                toast.error(normalizeError(e).message)
              },
            })
          }
        >
          {publish.isPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <Upload data-icon="inline-start" />
          )}
          {progress
            ? `Şəkillər ${progress[0]}/${progress[1]}`
            : r.current
              ? 'Yenidən dərc et'
              : 'Dərc et'}
        </Button>
      </div>
      {issues.length ? (
        <ul className="text-muted-foreground w-full list-disc pl-9 text-xs">
          {issues.map((p) => (
            <li key={p} className="text-amber-800">
              {p}
            </li>
          ))}
        </ul>
      ) : null}
    </header>
  )
}

// ── the path ────────────────────────────────────────────────────────────────
function PathColumn({
  roadmap: r,
  selectedId,
  onSelect,
}: {
  roadmap: RoadmapDetail
  selectedId: number | null
  onSelect: (id: number) => void
}) {
  const addStage = useAddStage(r.id)
  const rename = useRenameStage(r.id)
  const reorder = useReorderStages(r.id)
  const deleteStage = useDeleteStage(r.id)
  const addNode = useAddNode(r.id)
  const move = useMoveNode(r.id)
  const deleteNode = useDeleteNode(r.id)
  const [newStage, setNewStage] = useState('')
  const [newNode, setNewNode] = useState<{
    stageId: number
    title: string
    kind: NodeKind
  } | null>(null)
  const [editing, setEditing] = useState<{
    stageId: number
    title: string
  } | null>(null)
  const fail = (e: unknown) => toast.error(normalizeError(e).message)

  const moveStage = (i: number, d: -1 | 1) => {
    const ids = r.stages.map((s) => s.id)
    const j = i + d
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
    reorder.mutate(ids, { onError: fail })
  }

  return (
    <aside className="flex min-h-0 flex-col border-r">
      <div className="text-muted-foreground border-b px-4 py-2 font-mono text-[11px] tracking-[0.14em] uppercase">
        Yol
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto p-3">
        {r.stages.map((s, si) => (
          <li key={s.id} className="mb-3">
            <div className="group flex items-center gap-1">
              {editing?.stageId === s.id ? (
                <Input
                  autoFocus
                  value={editing.title}
                  onChange={(e) =>
                    setEditing({ stageId: s.id, title: e.target.value })
                  }
                  onBlur={() => {
                    if (
                      editing.title.trim() &&
                      editing.title.trim() !== s.title
                    )
                      rename.mutate(
                        { stageId: s.id, title: editing.title.trim() },
                        { onError: fail },
                      )
                    setEditing(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setEditing(null)
                  }}
                  className="h-7 text-sm"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditing({ stageId: s.id, title: s.title })}
                  className="min-w-0 flex-1 truncate text-left text-sm font-semibold hover:underline"
                  title="Adı dəyişmək üçün bas"
                >
                  <span className="text-muted-foreground mr-1.5 tabular-nums">
                    {si + 1}.
                  </span>
                  {s.title}
                </button>
              )}
              <div className="flex shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Mərhələni yuxarı"
                  disabled={si === 0}
                  onClick={() => moveStage(si, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Mərhələni aşağı"
                  disabled={si === r.stages.length - 1}
                  onClick={() => moveStage(si, 1)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Mərhələni sil"
                  onClick={() => {
                    if (
                      s.nodes.length &&
                      !window.confirm(
                        `"${s.title}" və içindəki ${s.nodes.length} addım silinsin?`,
                      )
                    )
                      return
                    deleteStage.mutate(s.id, { onError: fail })
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>

            <ol className="mt-1 ml-3 flex flex-col gap-1 border-l pl-3">
              {s.nodes.map((n, ni) => {
                const count = n.items[0]?.count ?? 0
                const active = n.id === selectedId
                return (
                  <li key={n.id} className="group/node flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onSelect(n.id)}
                      className={cn(
                        'flex min-w-0 flex-1 flex-col rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                        active
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-muted',
                      )}
                    >
                      <span className="truncate font-medium">{n.title}</span>
                      <span
                        className={cn(
                          'text-[11px]',
                          active
                            ? 'text-primary-foreground/80'
                            : 'text-muted-foreground',
                        )}
                      >
                        {NODE_KIND_LABEL[n.kind]} · {count} sual
                        {count === 0 ? ' — boş' : ''}
                      </span>
                    </button>
                    <div className="flex shrink-0 flex-col opacity-0 group-hover/node:opacity-100 focus-within:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="size-6"
                        aria-label="Yuxarı"
                        disabled={ni === 0}
                        onClick={() =>
                          move.mutate(
                            {
                              nodeId: n.id,
                              stageId: s.id,
                              position: n.position - 1,
                            },
                            { onError: fail },
                          )
                        }
                      >
                        <ArrowUp className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="size-6"
                        aria-label="Aşağı"
                        disabled={ni === s.nodes.length - 1}
                        onClick={() =>
                          move.mutate(
                            {
                              nodeId: n.id,
                              stageId: s.id,
                              position: n.position + 1,
                            },
                            { onError: fail },
                          )
                        }
                      >
                        <ArrowDown className="size-3" />
                      </Button>
                    </div>
                  </li>
                )
              })}
              {newNode?.stageId === s.id ? (
                <li className="flex flex-col gap-1.5 rounded-md border p-2">
                  <Input
                    autoFocus
                    value={newNode.title}
                    onChange={(e) =>
                      setNewNode({ ...newNode, title: e.target.value })
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setNewNode(null)
                      if (e.key === 'Enter' && newNode.title.trim()) {
                        addNode.mutate(
                          {
                            stageId: s.id,
                            title: newNode.title.trim(),
                            kind: newNode.kind,
                          },
                          {
                            onSuccess: ({ id }) => {
                              setNewNode(null)
                              onSelect(id)
                            },
                            onError: fail,
                          },
                        )
                      }
                    }}
                    placeholder="Addımın adı"
                    className="h-7 text-sm"
                  />
                  <div className="flex items-center gap-1">
                    <Select
                      value={newNode.kind}
                      onValueChange={(v) =>
                        setNewNode({ ...newNode, kind: v as NodeKind })
                      }
                    >
                      <SelectTrigger
                        className="h-7 flex-1 text-xs"
                        aria-label="Növ"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {NODE_KINDS.map((k) => (
                            <SelectItem key={k.key} value={k.key}>
                              {k.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <Button
                      size="icon-sm"
                      aria-label="Əlavə et"
                      disabled={!newNode.title.trim() || addNode.isPending}
                      onClick={() =>
                        addNode.mutate(
                          {
                            stageId: s.id,
                            title: newNode.title.trim(),
                            kind: newNode.kind,
                          },
                          {
                            onSuccess: ({ id }) => {
                              setNewNode(null)
                              onSelect(id)
                            },
                            onError: fail,
                          },
                        )
                      }
                    >
                      <Check />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Ləğv et"
                      onClick={() => setNewNode(null)}
                    >
                      <X />
                    </Button>
                  </div>
                </li>
              ) : (
                <li>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground h-7 px-2 text-xs"
                    onClick={() =>
                      setNewNode({
                        stageId: s.id,
                        title: '',
                        kind: 'topic_test',
                      })
                    }
                  >
                    <Plus data-icon="inline-start" /> Addım
                  </Button>
                </li>
              )}
            </ol>
          </li>
        ))}
        <li className="flex items-center gap-1">
          <Input
            value={newStage}
            onChange={(e) => setNewStage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newStage.trim()) {
                addStage.mutate(newStage.trim(), {
                  onSuccess: () => setNewStage(''),
                  onError: fail,
                })
              }
            }}
            placeholder="Yeni mərhələ"
            aria-label="Yeni mərhələnin adı"
            className="h-8 text-sm"
          />
          <Button
            size="icon-sm"
            aria-label="Mərhələ əlavə et"
            disabled={!newStage.trim() || addStage.isPending}
            onClick={() =>
              addStage.mutate(newStage.trim(), {
                onSuccess: () => setNewStage(''),
                onError: fail,
              })
            }
          >
            <Plus />
          </Button>
        </li>
      </ol>
      {selectedId !== null ? (
        <NodeActions
          roadmap={r}
          nodeId={selectedId}
          onDeleted={() =>
            onSelect(
              r.stages.flatMap((s) => s.nodes).find((n) => n.id !== selectedId)
                ?.id ?? 0,
            )
          }
          onDelete={(id) => deleteNode.mutate(id, { onError: fail })}
          onMoveTo={(nodeId, stageId) =>
            move.mutate({ nodeId, stageId, position: 999 }, { onError: fail })
          }
        />
      ) : null}
    </aside>
  )
}

function NodeActions({
  roadmap: r,
  nodeId,
  onDelete,
  onDeleted,
  onMoveTo,
}: {
  roadmap: RoadmapDetail
  nodeId: number
  onDelete: (id: number) => void
  onDeleted: () => void
  onMoveTo: (nodeId: number, stageId: number) => void
}) {
  const node = r.stages.flatMap((s) => s.nodes).find((n) => n.id === nodeId)
  if (!node) return null
  return (
    <div className="flex items-center gap-1 border-t p-2">
      <Select
        value={String(node.stage_id)}
        onValueChange={(v) => onMoveTo(node.id, Number(v))}
      >
        <SelectTrigger
          className="h-8 flex-1 text-xs"
          aria-label="Addımı mərhələyə köçür"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {r.stages.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>
                {s.title}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Addımı sil"
        onClick={() => {
          if (!window.confirm(`"${node.title}" silinsin?`)) return
          onDelete(node.id)
          onDeleted()
        }}
      >
        <Trash2 />
      </Button>
    </div>
  )
}

// ── the bank ────────────────────────────────────────────────────────────────
function BankColumn({
  roadmap: r,
  node,
}: {
  roadmap: RoadmapDetail
  node: RoadmapNodeRow
}) {
  const subjects = useSubjects(r.program_id)
  const [subjectId, setSubjectId] = useState<number | null>(null)
  // Until the admin picks one, the first subject that HAS questions: a bank
  // opened on an empty subject reads as a broken bank.
  const counts = useBankCounts((subjects.data ?? []).map((s) => s.id))
  const sid =
    subjectId ??
    (subjects.data ?? []).find((s) => (counts.get(s.id) ?? 0) > 0)?.id ??
    subjects.data?.[0]?.id ??
    null
  const categories = useQuery({
    queryKey: examKeys.categories(sid ?? 0),
    queryFn: () => fetchCategories(sid!),
    enabled: sid !== null,
  })
  const [panel, setPanel] = useState<PanelFilters>(EMPTY_FILTERS)
  const search = useDebouncedValue(panel.search, 300)
  const filters: SearchFilters | null = useMemo(
    () =>
      sid === null
        ? null
        : {
            subjectId: sid,
            categoryIds: panel.categoryIds,
            difficulties: panel.difficulties,
            figures: panel.figures,
            search,
            unusedOnly: false,
            examId: 0,
          },
    [sid, panel.categoryIds, panel.difficulties, panel.figures, search],
  )
  const facets = useFacets(filters)
  const items = useNodeItems(node.id)
  const setItems = useSetNodeItems(r.id)
  const searchRef = useRef<HTMLInputElement>(null)
  const ids = useMemo(
    () => new Set((items.data ?? []).map((q) => q.id)),
    [items.data],
  )
  const topicName = (cid: number | null) =>
    (categories.data ?? []).find((c: Category) => c.id === cid)?.name ?? '—'

  // Topics belong to a subject; a subject change empties the topic filter.
  useEffect(() => {
    setPanel((p) => (p.categoryIds.length ? { ...p, categoryIds: [] } : p))
  }, [sid])

  if (!filters)
    return (
      <div className="p-4">
        <Skeleton className="h-40" />
      </div>
    )

  return (
    <div className="flex min-h-0 flex-col border-r">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <span className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
          Bank
        </span>
        <Select
          value={sid === null ? undefined : String(sid)}
          onValueChange={(v) => setSubjectId(Number(v))}
        >
          <SelectTrigger className="ml-auto h-8 w-44 text-xs" aria-label="Fənn">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {(subjects.data ?? []).map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)]">
        <div className="min-h-0 overflow-y-auto border-r p-3">
          <FilterPanel
            filters={panel}
            onChange={setPanel}
            categories={categories.data ?? []}
            facets={facets.data ?? []}
            searchRef={searchRef}
          />
        </div>
        <div className="min-h-0">
          <ResultsList
            filters={filters}
            total={
              facets.data ? facets.data.reduce((s, f) => s + f.n, 0) : null
            }
            subjectEmpty={null}
            idsInExam={ids}
            canAdd
            topicName={topicName}
            onAdd={(q) => {
              if (ids.has(q.id)) return false
              const next = [...(items.data ?? []), q]
              setItems.mutate(
                { nodeId: node.id, questions: next },
                { onError: (e) => toast.error(normalizeError(e).message) },
              )
              return true
            }}
          />
        </div>
      </div>
    </div>
  )
}

// ── the node ────────────────────────────────────────────────────────────────
function NodeColumn({
  roadmap: r,
  node,
}: {
  roadmap: RoadmapDetail
  node: RoadmapNodeRow
}) {
  const items = useNodeItems(node.id)
  const setItems = useSetNodeItems(r.id)
  const updateNode = useUpdateNode(r.id)
  const [title, setTitle] = useState(node.title)
  const [lastNode, setLastNode] = useState(node.id)
  const [previewQ, setPreviewQ] = useState<BuilderQuestion | null>(null)
  if (lastNode !== node.id) {
    setLastNode(node.id)
    setTitle(node.title)
  }
  const fail = (e: unknown) => toast.error(normalizeError(e).message)
  const write = (list: BuilderQuestion[]) =>
    setItems.mutate({ nodeId: node.id, questions: list }, { onError: fail })
  const list = items.data ?? []
  // Drag to reorder, as in the deneme builder; the keyboard sensor makes
  // the same move with Space and the arrows.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = list.findIndex((q) => q.id === active.id)
    const to = list.findIndex((q) => q.id === over.id)
    if (from >= 0 && to >= 0) write(arrayMove(list, from, to))
  }

  return (
    <aside className="flex min-h-0 flex-col">
      <div className="flex flex-col gap-2 border-b px-4 py-3">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            const t = title.trim()
            if (t && t !== node.title)
              updateNode.mutate(
                { nodeId: node.id, title: t },
                { onError: fail },
              )
            else setTitle(node.title)
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          aria-label="Addımın adı"
          className="h-8 border-transparent px-1.5 font-semibold shadow-none hover:border-input focus-visible:border-input"
        />
        <div className="flex items-center gap-2">
          <Select
            value={node.kind}
            onValueChange={(v) =>
              updateNode.mutate(
                { nodeId: node.id, kind: v as NodeKind },
                { onError: fail },
              )
            }
          >
            <SelectTrigger
              className="h-7 w-36 text-xs"
              aria-label="Addımın növü"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {NODE_KINDS.map((k) => (
                  <SelectItem key={k.key} value={k.key}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <span className="text-muted-foreground ml-auto text-xs tabular-nums">
            {list.length} sual
          </span>
        </div>
      </div>
      {items.isPending ? (
        <div className="p-4">
          <Skeleton className="h-32" />
        </div>
      ) : items.isError ? (
        <div className="p-4">
          <QueryErrorAlert
            error={items.error}
            onRetry={() => void items.refetch()}
            isRetrying={items.isFetching}
          />
        </div>
      ) : list.length === 0 ? (
        <p className="text-muted-foreground p-4 text-sm">
          Bu addımda hələ sual yoxdur. Ortadakı siyahıdan seçin — Enter və ya A
          ilə də əlavə olunur.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={list.map((q) => q.id)}
            strategy={verticalListSortingStrategy}
          >
            <ol className="min-h-0 flex-1 overflow-y-auto p-3">
              {list.map((q, i) => (
                <NodeItemRow
                  key={q.id}
                  question={q}
                  number={i + 1}
                  onPreview={() => setPreviewQ(q)}
                  onRemove={() => write(list.filter((x) => x.id !== q.id))}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      <QuestionDialog
        question={previewQ}
        topicName=""
        onOpenChange={(o) => !o && setPreviewQ(null)}
      />
    </aside>
  )
}

function NodeItemRow({
  question: q,
  number,
  onPreview,
  onRemove,
}: {
  question: BuilderQuestion
  number: number
  onPreview: () => void
  onRemove: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: q.id })
  // A question picked from the bank arrives without its status (the search
  // row has none); only a KNOWN non-approved status is a problem.
  const blocked = q.status !== undefined && q.status !== 'approved'
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
        transition,
      }}
      className={cn(
        'bg-background group mb-1.5 flex items-start gap-2 rounded-md border px-2 py-2 text-sm',
        isDragging && 'relative z-10 shadow-lg',
        (blocked || !q.answer) && 'border-destructive/50',
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={`${number}-ci sualı sürüşdür`}
        className="text-muted-foreground hover:text-foreground mt-0.5 cursor-grab touch-none rounded p-0.5 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <span className="text-muted-foreground mt-0.5 w-5 shrink-0 text-right text-xs tabular-nums">
        {number}
      </span>
      <button
        type="button"
        onClick={onPreview}
        className="flex min-w-0 flex-1 flex-col gap-1 text-left"
      >
        <span className="line-clamp-2 text-[13px] leading-snug [&_.katex]:text-[1em]">
          {q.stem.trim() ? (
            <StemText text={q.stem} />
          ) : (
            <span className="text-muted-foreground italic">şəkilli sual</span>
          )}
        </span>
        <span className="text-muted-foreground flex items-center gap-2 text-[11px]">
          <DifficultyDot value={q.difficulty} />
          <span>#{q.id}</span>
          {blocked ? (
            <span className="text-destructive">təsdiqlənməyib</span>
          ) : null}
          {!q.answer ? (
            <span className="text-destructive">cavabsız</span>
          ) : null}
        </span>
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-6 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        aria-label="Çıxar"
        onClick={onRemove}
      >
        <X className="size-3" />
      </Button>
    </li>
  )
}

// ── preview: the path as the student will read it ───────────────────────────
function PreviewDialog({
  roadmap: r,
  open,
  onOpenChange,
}: {
  roadmap: RoadmapDetail
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  let counter = 0
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{r.title}</DialogTitle>
          <DialogDescription>
            {r.description || 'Tələbənin görəcəyi yol — qaralamadan.'}
          </DialogDescription>
        </DialogHeader>
        <ol className="flex flex-col gap-5">
          {r.stages.map((s) => (
            <li key={s.id} className="flex flex-col gap-2">
              <p className="text-xs font-semibold tracking-[0.08em] text-violet-700 uppercase">
                {s.position}-ci mərhələ ·{' '}
                <span className="text-foreground normal-case">{s.title}</span>
              </p>
              <ol className="relative ml-2 flex flex-col gap-2 border-l pl-6">
                {s.nodes.map((n) => {
                  counter += 1
                  const first = counter === 1
                  return (
                    <li key={n.id} className="relative">
                      <span
                        className={cn(
                          'absolute top-1/2 -left-[31px] grid size-6 -translate-y-1/2 place-items-center rounded-full border-2 text-[11px] font-bold',
                          first
                            ? 'border-violet-600 bg-violet-600 text-white'
                            : 'border-zinc-300 bg-zinc-50 text-zinc-400',
                        )}
                      >
                        {first ? counter : <Lock className="size-3" />}
                      </span>
                      <div
                        className={cn(
                          'rounded-xl border p-3',
                          first
                            ? 'border-violet-300 bg-violet-50'
                            : 'text-zinc-400',
                        )}
                      >
                        <p className="text-[11px] font-semibold tracking-[0.06em] uppercase">
                          {NODE_KIND_LABEL[n.kind]} · {n.items[0]?.count ?? 0}{' '}
                          sual
                        </p>
                        <p className="text-sm font-semibold">{n.title}</p>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  )
}
