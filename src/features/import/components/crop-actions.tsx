import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** The sticky bar under the crop grid: select, clear, send. */
export function CropActions({
  eligible,
  selected,
  sendable,
  onSelectAll,
  onClear,
  onSend,
}: {
  eligible: number
  selected: number
  sendable: number
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
      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" disabled={sendable === 0} onClick={onSend}>
          <Send data-icon="inline-start" />
          Çıxarılmaya göndər ({sendable})
        </Button>
      </div>
    </div>
  )
}
