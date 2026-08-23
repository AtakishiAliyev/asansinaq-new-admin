// The Anthropic Message Batches API, narrowed to what the worker needs.
//
// Batch is not an optimisation here, it is the point: half price, and a request
// that is allowed to take an hour instead of having to fit inside an Edge
// Function's wall clock. The cost is that submission and collection are
// separate events, which is why nothing in this file holds state between them.
import Anthropic from '@anthropic-ai/sdk'
import { config } from './config.ts'

export const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })

export interface BatchItem {
  customId: string
  model: string
  params: Omit<Anthropic.MessageCreateParamsNonStreaming, 'model'>
}

export async function submitBatch(items: BatchItem[]): Promise<string> {
  const batch = await anthropic.messages.batches.create({
    requests: items.map((item) => ({
      custom_id: item.customId,
      params: { model: item.model, ...item.params },
    })),
  })
  return batch.id
}

export type BatchState = 'in_progress' | 'ended' | 'canceling'

export async function batchState(batchId: string): Promise<BatchState> {
  const batch = await anthropic.messages.batches.retrieve(batchId)
  return batch.processing_status
}

export interface BatchOutcome {
  customId: string
  /** The tool input, when the model answered. */
  wire: Record<string, unknown> | null
  usage: Anthropic.Usage | null
  /** Set when this request failed, expired or was cancelled. */
  error: string | null
}

/**
 * Results in whatever order the provider produced them.
 *
 * They are keyed by custom_id and MUST be matched by it. Position is not
 * stable, and pairing by index would attach one question's reading to another
 * question's row — a corruption that looks like a plausible answer and would
 * pass every check downstream.
 */
export async function* batchResults(
  batchId: string,
  toolName: string,
): AsyncGenerator<BatchOutcome> {
  for await (const entry of await anthropic.messages.batches.results(batchId)) {
    const result = entry.result
    if (result.type !== 'succeeded') {
      yield {
        customId: entry.custom_id,
        wire: null,
        usage: null,
        error:
          result.type === 'errored'
            ? `provider error: ${result.error.type}`
            : `batch request ${result.type}`,
      }
      continue
    }

    const block = result.message.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === 'tool_use' && b.name === toolName,
    )
    yield {
      customId: entry.custom_id,
      wire: (block?.input as Record<string, unknown> | undefined) ?? null,
      usage: result.message.usage,
      // The tool was forced, so its absence is not a shrug — it means the model
      // stopped for another reason and there is no reading to write.
      error: block
        ? null
        : `no ${toolName} call in the answer (stop_reason: ${result.message.stop_reason})`,
    }
  }
}
