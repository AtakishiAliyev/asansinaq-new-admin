import { useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useCategories,
  useCreateCategory,
  useDeleteCategory,
} from '@/features/taxonomy/api/categories'
import { CategoryRow, SubCategoryRow } from '@/features/taxonomy/components/category-row'
import { DeleteCategoryDialog } from '@/features/taxonomy/components/delete-category-dialog'
import { NameForm } from '@/features/taxonomy/components/name-form'
import type { Category, CategoryNode } from '@/features/taxonomy/schemas'
import { QueryErrorAlert } from '@/components/query-error-alert'

function buildTree(categories: Category[]): CategoryNode[] {
  const roots = categories.filter((c) => c.parent_id === null)
  const childrenByParent = new Map<number, Category[]>()
  for (const category of categories) {
    if (category.parent_id === null) continue
    const bucket = childrenByParent.get(category.parent_id) ?? []
    bucket.push(category)
    childrenByParent.set(category.parent_id, bucket)
  }
  return roots.map((root) => ({
    ...root,
    children: childrenByParent.get(root.id) ?? [],
  }))
}

const ADD_LABEL = 'Kateqoriya əlavə et'

interface CategoryTreeProps {
  subjectId: number
  subjectName: string
}

export function CategoryTree({ subjectId, subjectName }: CategoryTreeProps) {
  const categories = useCategories(subjectId)
  const createCategory = useCreateCategory()
  const deleteCategory = useDeleteCategory()

  const [addingRoot, setAddingRoot] = useState(false)
  const [addingChildOf, setAddingChildOf] = useState<number | null>(null)
  // Restore keyboard focus to the button that opened an inline add form —
  // otherwise closing the form drops focus to <body>.
  const addRootButtonRef = useRef<HTMLButtonElement>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [pendingDelete, setPendingDelete] = useState<CategoryNode | null>(null)

  const tree = useMemo(() => buildTree(categories.data ?? []), [categories.data])

  function toggle(id: number) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function startAddChild(parentId: number) {
    setExpanded((current) => new Set(current).add(parentId))
    setAddingChildOf(parentId)
  }

  function stopAddingRoot() {
    setAddingRoot(false)
    requestAnimationFrame(() => addRootButtonRef.current?.focus())
  }

  const addChildButtonRefs = useRef(new Map<number, HTMLButtonElement>())

  function stopAddingChild(parentId: number) {
    setAddingChildOf(null)
    requestAnimationFrame(() => addChildButtonRefs.current.get(parentId)?.focus())
  }

  const header = (
    <div className="flex items-center justify-between">
      <p className="text-muted-foreground text-xs tracking-wide">
        {subjectName.toLocaleUpperCase('az')} — KATEQORİYALAR
      </p>
      {!addingRoot ? (
        <Button size="sm" ref={addRootButtonRef} onClick={() => setAddingRoot(true)}>
          <Plus data-icon="inline-start" />
          {ADD_LABEL}
        </Button>
      ) : null}
    </div>
  )

  if (categories.isPending) {
    return (
      <div className="flex flex-col gap-3">
        {header}
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (categories.isError) {
    return (
      <div className="flex flex-col gap-3">
        {header}
        <QueryErrorAlert
          error={categories.error}
          onRetry={() => categories.refetch()}
          isRetrying={categories.isFetching}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {header}

      {tree.length === 0 && !addingRoot ? (
        <Empty>
          <EmptyTitle>Hələ kateqoriya yoxdur</EmptyTitle>
          <EmptyDescription>
            Bu fənn üçün ilk kateqoriyanı əlavə edin.
          </EmptyDescription>
          <Button size="sm" onClick={() => setAddingRoot(true)}>
            <Plus data-icon="inline-start" />
            {ADD_LABEL}
          </Button>
        </Empty>
      ) : (
        <div className="flex flex-col">
          {tree.map((node) => (
            <div key={node.id}>
              <CategoryRow
                node={node}
                subjectId={subjectId}
                expanded={expanded.has(node.id)}
                onToggle={() => toggle(node.id)}
                onAddChild={() => startAddChild(node.id)}
                onDelete={() => setPendingDelete(node)}
                addChildButtonRef={(el) => {
                  if (el) addChildButtonRefs.current.set(node.id, el)
                  else addChildButtonRefs.current.delete(node.id)
                }}
              />
              {expanded.has(node.id)
                ? node.children.map((child) => (
                    <SubCategoryRow
                      key={child.id}
                      node={child}
                      subjectId={subjectId}
                      onDelete={() => setPendingDelete({ ...child, children: [] })}
                    />
                  ))
                : null}
              {addingChildOf === node.id ? (
                <div className="border-b py-1.5 pr-2 pl-9">
                  <NameForm
                    placeholder="Sub-kateqoriyanın adı"
                    isPending={createCategory.isPending}
                    onCancel={() => stopAddingChild(node.id)}
                    onSubmit={(name) =>
                      createCategory.mutate(
                        { subjectId, parentId: node.id, name },
                        { onSuccess: () => stopAddingChild(node.id) },
                      )
                    }
                  />
                </div>
              ) : null}
            </div>
          ))}

          {addingRoot ? (
            <div className="border-b py-1.5 pr-2 pl-2">
              <NameForm
                placeholder="Kateqoriyanın adı"
                isPending={createCategory.isPending}
                onCancel={stopAddingRoot}
                onSubmit={(name) =>
                  createCategory.mutate(
                    { subjectId, parentId: null, name },
                    { onSuccess: stopAddingRoot },
                  )
                }
              />
            </div>
          ) : null}
        </div>
      )}

      <DeleteCategoryDialog
        category={pendingDelete}
        isPending={deleteCategory.isPending}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        onConfirm={() => {
          if (!pendingDelete) return
          deleteCategory.mutate(
            { subjectId, id: pendingDelete.id },
            { onSuccess: () => setPendingDelete(null) },
          )
        }}
      />
    </div>
  )
}
