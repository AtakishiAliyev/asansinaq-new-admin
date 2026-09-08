import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CategoryPicker } from '@/features/questions'
import type { Category } from '@/features/taxonomy'

/**
 * The sticky bar under the crop grid: select, clear, file under a topic, send.
 *
 * The topic is required and sits beside the send button because it is part of
 * the send: one send is one topic, and the crops it carries are filed before
 * anything reads them.
 */
export function CropActions({
  eligible,
  selected,
  sendable,
  categories,
  categoryId,
  onCategory,
  onSelectAll,
  onClear,
  onSend,
}: {
  eligible: number
  selected: number
  sendable: number
  categories: Category[]
  categoryId: number | null
  onCategory: (id: number) => void
  onSelectAll: () => void
  onClear: () => void
  onSend: () => void
}) {
  return (
    <div className="bg-background sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border p-2 shadow-xs">
      <Button variant="ghost" size="sm" onClick={onSelectAll}>
        Hamısını seç ({eligible})
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={selected === 0}
        onClick={onClear}
      >
        Təmizlə
      </Button>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <CategoryPicker
          categories={categories}
          value={categoryId}
          onChange={onCategory}
          placeholder={
            categories.length ? 'Mövzu seç' : 'Fənnin mövzusu yoxdur'
          }
        />
        <Button
          size="sm"
          disabled={sendable === 0 || categoryId === null}
          title={categoryId === null ? 'Əvvəlcə mövzu seçin' : undefined}
          onClick={onSend}
        >
          <Send data-icon="inline-start" />
          Çıxarılmaya göndər ({sendable})
        </Button>
      </div>
    </div>
  )
}
