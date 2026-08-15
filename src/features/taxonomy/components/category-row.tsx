import { useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRenameCategory } from '@/features/taxonomy/api/categories'
import { NameForm } from '@/features/taxonomy/components/name-form'
import type { CategoryNode } from '@/features/taxonomy/schemas'

interface CategoryRowProps {
  node: CategoryNode
  subjectId: number
  expanded: boolean
  onToggle: () => void
  onAddChild: () => void
  onDelete: () => void
}

export function CategoryRow({
  node,
  subjectId,
  expanded,
  onToggle,
  onAddChild,
  onDelete,
}: CategoryRowProps) {
  const [editing, setEditing] = useState(false)
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const renameCategory = useRenameCategory()
  const childCount = node.children.length

  function stopEditing() {
    setEditing(false)
    requestAnimationFrame(() => editButtonRef.current?.focus())
  }

  if (editing) {
    return (
      <div className="border-b py-1.5 pr-2 pl-2">
        <NameForm
          defaultName={node.name}
          placeholder="Kateqoriyanın adı"
          isPending={renameCategory.isPending}
          onCancel={stopEditing}
          onSubmit={(name) =>
            renameCategory.mutate(
              { subjectId, id: node.id, name },
              { onSuccess: stopEditing },
            )
          }
        />
      </div>
    )
  }

  return (
    <div className="group flex items-center gap-2 border-b py-1.5 pr-2 pl-2 text-sm">
      {childCount > 0 ? (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onToggle}
          aria-label={expanded ? 'Yığ' : 'Aç'}
        >
          {expanded ? <ChevronDown /> : <ChevronRight />}
        </Button>
      ) : (
        <span className="w-6" />
      )}

      <span className="flex-1 font-medium">{node.name}</span>

      <span className="text-muted-foreground text-xs">
        {childCount > 0 ? `${childCount} sub` : 'sub yoxdur'}
      </span>

      <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Sub-kateqoriya əlavə et"
          onClick={onAddChild}
        >
          <Plus />
        </Button>
        <Button
          ref={editButtonRef}
          variant="ghost"
          size="icon-sm"
          aria-label={`${node.name} adını dəyiş`}
          onClick={() => setEditing(true)}
        >
          <Pencil />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
          aria-label={`${node.name} sil`}
          onClick={onDelete}
        >
          <Trash2 />
        </Button>
      </span>
    </div>
  )
}

interface SubCategoryRowProps {
  node: { id: number; name: string }
  subjectId: number
  onDelete: () => void
}

export function SubCategoryRow({
  node,
  subjectId,
  onDelete,
}: SubCategoryRowProps) {
  const [editing, setEditing] = useState(false)
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const renameCategory = useRenameCategory()

  function stopEditing() {
    setEditing(false)
    requestAnimationFrame(() => editButtonRef.current?.focus())
  }

  if (editing) {
    return (
      <div className="border-b py-1.5 pr-2 pl-9">
        <NameForm
          defaultName={node.name}
          placeholder="Sub-kateqoriyanın adı"
          isPending={renameCategory.isPending}
          onCancel={stopEditing}
          onSubmit={(name) =>
            renameCategory.mutate(
              { subjectId, id: node.id, name },
              { onSuccess: stopEditing },
            )
          }
        />
      </div>
    )
  }

  return (
    <div className="group text-muted-foreground flex items-center gap-2 border-b py-1.5 pr-2 pl-9 text-sm">
      <span className="flex-1">{node.name}</span>
      <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <Button
          ref={editButtonRef}
          variant="ghost"
          size="icon-sm"
          aria-label={`${node.name} adını dəyiş`}
          onClick={() => setEditing(true)}
        >
          <Pencil />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
          aria-label={`${node.name} sil`}
          onClick={onDelete}
        >
          <Trash2 />
        </Button>
      </span>
    </div>
  )
}
