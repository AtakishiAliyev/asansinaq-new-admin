// How express paces itself, with nothing behind it.
//
// Split out of `express.ts` for one reason: the eval harness must run free and
// offline, and importing the express pass drags in `worker/config.ts`, which
// refuses to load without a service key and an Anthropic key. Scheduling policy
// is exactly the part worth pinning in a suite, so it must not be the part that
// needs credentials to import.
//
// Nothing here touches the network, the database or the environment.

/**
 * Which lane a pass should use.
 *
 * Pure so it can be argued about in the suite rather than inferred from a live
 * run. The operator's toggle only ever turns express ON: a small set is fast
 * either way, and there is no reason to make someone wait on a batch queue to
 * process four questions — so the threshold is not something the flag can push
 * back the other way.
 */
export function shouldExpress(
  queued: number,
  options: { threshold: number; operatorWants: boolean },
): boolean {
  if (queued === 0) return false
  return options.operatorWants || queued <= options.threshold
}

/**
 * Run `work` over `items`, at most `limit` at a time, preserving order.
 *
 * Written here rather than pulled in as a dependency: it is fifteen lines, and
 * the shape that matters is the whole reason express beats the wave it
 * replaces. A pool that keeps every slot busy finishes in the time of the
 * slowest ITEM; one that processes fixed rounds of `limit` finishes in the sum
 * of the slowest item in each round, which is the same barrier the batch waves
 * have — just smaller. Exported so the suite can hold it to that.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      results[index] = await work(items[index]!)
    }
  })
  await Promise.all(runners)
  return results
}
