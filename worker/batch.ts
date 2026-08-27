// The Anthropic Message Batches API, narrowed to what the worker needs.
//
// Batch is not an optimisation here, it is the point: half price, and a request
// that is allowed to take an hour instead of having to fit inside an Edge
// Function's wall clock. The cost is that submission and collection are
// separate events, which is why nothing in this file holds state between them.
import Anthropic from '@anthropic-ai/sdk'
import { config } from './config.ts'
import { samplingFor } from '@/core/models'

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
      // Sampling is applied here, where the model id is known. The request
      // builder cannot decide it: it resolves a lane, and whether a lane's
      // model accepts `temperature` is a property of the id in config.
      params: { model: item.model, ...samplingFor(item.model), ...item.params },
    })),
  })
  return batch.id
}

export type BatchState = 'in_progress' | 'ended' | 'canceling'

export async function batchState(batchId: string): Promise<BatchState> {
  const batch = await anthropic.messages.batches.retrieve(batchId)
  return batch.processing_status
}

/**
 * The useful half of a batch error is nested one level deeper than it looks.
 *
 * `result.error` is an envelope whose own `type` is always the string "error";
 * the reason lives in `result.error.error.message`. Reporting the envelope
 * writes "provider error: error" onto every failed row, which is what happened
 * on the first live run: twelve rows failed for two DIFFERENT reasons and every
 * one of them said the same uninformative thing. The messages were sitting in
 * the batch the whole time — results are retained for 29 days — but nothing in
 * the database pointed at them.
 */
function describeError(
  envelope: Anthropic.Messages.MessageBatchErroredResult['error'],
): string {
  const inner = (envelope as { error?: { type?: string; message?: string } }).error
  if (inner?.message) return `${inner.type ?? 'error'}: ${inner.message}`
  return `provider error: ${envelope.type}`
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
            ? describeError(result.error)
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

/**
 * The same request, sent synchronously.
 *
 * Express mode's half of the file. Batch is the right default because it is
 * half price and the queue is overnight work, but its cost is LATENCY THAT DOES
 * NOT SCALE DOWN: a measured run of eight questions spent 935 of its 1099
 * seconds waiting in the provider's queue across two waves, and a batch of one
 * waits just as long as a batch of fifty. For a set small enough that an
 * operator is sitting watching it, paying full price to skip the queue is the
 * better trade.
 *
 * Deliberately shares `describeError` and the tool-block rules with
 * `batchResults`: the two paths must agree about what an answer IS, or a
 * question read one way in express and another way in batch would produce two
 * different rows from one crop.
 */
export async function runSync(item: BatchItem, toolName: string): Promise<BatchOutcome> {
  try {
    const message = await anthropic.messages.create({
      model: item.model,
      ...samplingFor(item.model),
      ...item.params,
    })
    const block = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === toolName,
    )
    return {
      customId: item.customId,
      wire: (block?.input as Record<string, unknown> | undefined) ?? null,
      usage: message.usage,
      error: block
        ? null
        : `no ${toolName} call in the answer (stop_reason: ${message.stop_reason})`,
    }
  } catch (error) {
    // Returned, not thrown: one question that the provider refused must not
    // take down the other three running beside it.
    return {
      customId: item.customId,
      wire: null,
      usage: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
