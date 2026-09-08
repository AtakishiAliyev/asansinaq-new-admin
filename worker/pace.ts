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
 * run. The rule is the operator's switch and nothing else: on means every
 * question goes synchronously, whether there are four of them or a thousand;
 * off means every question goes to the batch queue, however few.
 *
 * It used to escalate to express on its own for any set at or under a
 * threshold, on the reasoning that nobody should wait on a batch queue for
 * four questions. What that produced was a switch the operator could not
 * predict: a run split across the two lanes by nothing but which pass happened
 * to see how much work, so half a set came back in a minute and half sat in
 * the provider's queue. A lane is a price/latency trade, and the person paying
 * makes it — the panel says which lane the next set will use, and it is now
 * simply the switch.
 *
 * `pending` counts everything a pass could act on, structuring AND
 * verification. Counting only the structuring queue is what let a verdict fall
 * to the batch lane with express turned on, because a row waiting to be
 * verified is not queued for anything.
 */
export function shouldExpress(
  pending: number,
  options: { operatorWants: boolean },
): boolean {
  if (pending === 0) return false
  return options.operatorWants
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
