// The worker loop.
//
//   npm run worker
//
// Two passes, deliberately not one. A batch is answered in minutes or in hours,
// and a loop that waited for its own submission would spend most of its life
// asleep holding rows. So every cycle collects whatever has finished, then
// submits more, then renews what is still out — and none of the three needs the
// others to have happened in the same process.
//
// That is what makes a restart cheap. The batch handle lives on the row, so a
// worker that comes back mid-flight adopts its own outstanding batches on the
// next poll rather than claiming the same questions and buying the same answers
// twice.
import { config } from './config.ts'
import { closeOcr } from './figure-ocr.ts'
import {
  announceStart,
  announceStop,
  beat,
  readAutoApprove,
  readDesiredState,
} from './control.ts'
import { db } from './db.ts'
import { forgetBookContexts } from './book-context.ts'
import { setActivity } from './activity.ts'
import { dryRun } from './dry-run.ts'
import { log } from './log.ts'
import { warnIfUnpriced } from './models.ts'
import { spendToday } from './ops.ts'
import { expressPass, expressWanted } from './pass-express.ts'
import { pollPass } from './pass-poll.ts'
import { submitPass } from './pass-submit.ts'
import { autoApprovePass, verifyPass } from './pass-verify.ts'
import { inFlight, nextQueuedBook } from './queue.ts'
import { fontsRender } from './render-question.ts'

const POLL_MS = 60_000

/**
 * Whether this process is the always-on daemon or a hand-run drain.
 *
 * The manual path stops when the queue empties, which is what makes it useful
 * during development. The daemon must not: the operator queues work in the UI
 * expecting it to be picked up, and a worker that exited quietly the last time
 * the queue ran dry is indistinguishable from one that crashed.
 */
const DAEMON =
  process.argv.includes('--daemon') || process.env.WORKER_DAEMON === '1'

let stopping = false
/**
 * Wakes the poll sleep early.
 *
 * Without it a stop waits out the full poll interval before the loop comes back
 * round to notice — a minute of a daemon ignoring SIGTERM, which launchd
 * answers with SIGKILL, and a killed process never records that it stopped on
 * purpose. The sleep is interruptible so shutdown is prompt and the heartbeat
 * gets its last word.
 */
let wake: (() => void) | null = null
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => {
      wake = null
      resolve()
    }, ms)
    wake = () => {
      clearTimeout(timer)
      wake = null
      resolve()
    }
  })

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(1)
    stopping = true
    wake?.()
    // Rows already submitted are NOT released: their batch is paid for and
    // still coming, and handing them back would let the next worker buy the
    // same answers again. They keep their handle and are adopted on restart.
    log(`${signal} — finishing the current pass, then stopping`)
  })
}

log(`worker ${config.WORKER_ID} starting`)
log(
  `models: text=${config.MODEL_TEXT} figure=${config.MODEL_FIGURE} ` +
    `verify=${config.MODEL_VERIFY}`,
)
// Every model this process will bill, checked ONCE, here, before any of them
// is called. The guard existed and nothing called it, so a mistyped model id
// was priced at the fallback rate in silence — which reads as a cheap model
// rather than an unknown one, on the number the daily budget is enforced from.
for (const model of [
  config.MODEL_TEXT,
  config.MODEL_FIGURE,
  config.MODEL_VERIFY,
  config.GEMINI_IMAGE_MODEL,
  config.OPENAI_IMAGE_MODEL,
]) {
  if (model) warnIfUnpriced(model)
}

// Checked here, before anything is claimed, because a host that cannot draw
// text does not fail — it produces a picture with every formula and not one
// word, which the verification wave then reads as a missing stem and pays to
// repair. Refusing to start is the proportionate answer: a worker that
// structures questions while systematically failing every one of them, at up
// to two paid repair rounds each, is worse than one that stops and says why.
if (!fontsRender()) {
  log(
    'FONTS MISSING — this host renders no text, so every verification would ' +
      'compare a wordless picture against the crop and report the stem as ' +
      'gone. Install a font (the image uses fonts-dejavu-core) and redeploy.',
  )
  process.exit(1)
}

if (process.argv.includes('--dry-run')) {
  await dryRun()
  process.exit(0)
}

log(
  `spent today: $${(await spendToday(db)).toFixed(4)} of $${config.DAILY_BUDGET_USD}`,
)

await announceStart(db)

let wasPaused = false
/**
 * Whether the LAST pass raised, so a recovery can clear the panel.
 *
 * `beat` only touches `last_error` when it is given one, and the only thing
 * that ever cleared it was `announceStart` — a restart. So one transient blip
 * left the control panel red for as long as the process lived: a Supabase
 * Gateway Timeout on a single read stayed on screen through the ninety-odd
 * healthy passes that followed it. A red light that does not go out is one the
 * operator learns to read as decoration.
 */
let passFailed = false
while (!stopping) {
  // Read the switch at the top of every pass. A pause therefore lands BETWEEN
  // passes, never inside one: a batch already submitted has already been paid
  // for, and abandoning it mid-flight would spend the money and keep nothing.
  const desired = await readDesiredState(db)
  if (desired === 'paused') {
    if (!wasPaused) log('paused by the operator — waiting for the switch')
    wasPaused = true
    await setActivity('operator tərəfindən dayandırılıb', 'paused')
    await sleep(POLL_MS)
    continue
  }
  if (wasPaused) log('resumed by the operator')
  wasPaused = false

  try {
    await setActivity('növbə yoxlanılır')
    // A pass reads each book once; the next pass reads it again. The lane
    // switch, the tree and the key are all things an operator changes while
    // the daemon is up, and a restart must not be the way they take effect.
    forgetBookContexts()
    // Read once per pass, beside the pause switch and for the same reason: a
    // setting the operator changes mid-run takes effect on the next pass, not
    // on the next row.
    const autoApprove = await readAutoApprove(db)
    // Rows verified before the switch was turned on: the verdict path can no
    // longer reach them, and the rule does not depend on when they were read.
    await autoApprovePass(autoApprove)
    // Always first, and in both modes: a batch submitted before the queue got
    // small enough for express is still out there, still paid for, and still
    // has to be collected.
    await pollPass(autoApprove)
    if (await expressWanted()) await expressPass(autoApprove)
    else {
      await submitPass()
      await verifyPass()
    }
    // Recovered. Written only on the pass that follows a failure, so the
    // common case stays one heartbeat rather than an extra write a minute.
    if (passFailed) {
      passFailed = false
      log('recovered — the previous pass had failed')
      await beat(db, {
        activity: 'növbə yoxlanılır',
        state: 'running',
        lastError: null,
      })
    }
  } catch (error) {
    passFailed = true
    log(`pass failed: ${String(error)}`)
    await beat(db, {
      activity: 'xəta — növbəti dövrədə yenidən cəhd',
      state: 'running',
      lastError: String(error).slice(0, 400),
    })
  }
  if (stopping) break
  const outstanding = (await inFlight(db).catch(() => [])).length
  const queued = await nextQueuedBook(db).catch(() => null)
  // Counted the way `verifyPass` selects, not just "unverified": a row that is
  // queued is waiting to be re-extracted, and the verify wave deliberately
  // leaves it alone. Counting it as work stopped the loop from ever finishing
  // while nothing could act on it — a row stranded at attempts=3 is claimable
  // by nobody and verifiable by nobody, and the worker span on it silently for
  // forty minutes before anyone noticed the log had gone quiet.
  const { count: verifiable } = await db
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'structured')
    .is('verified_at', null)
    .is('queued_at', null)
  if (!outstanding && queued === null && !verifiable) {
    // Anything left is neither in flight, nor claimable, nor verifiable. That
    // is a stranded row rather than an empty queue, and saying so is the
    // difference between a worker that finished and a worker that gave up.
    const { count: stranded } = await db
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'structured')
      .is('verified_at', null)
    if (stranded) {
      // Said out loud either way: a stranded row is not an empty queue, and a
      // daemon that idles over one would look like it had finished the work.
      log(
        `${stranded} row(s) are queued but unclaimable — nothing can act on them`,
      )
      await setActivity(
        `${stranded} sual ilişib — heç bir mərhələ onları götürə bilmir`,
      )
    } else {
      await setActivity('boşdur — yeni iş gözlənilir')
    }
    if (!DAEMON) {
      log(
        stranded
          ? 'stopping rather than spinning'
          : 'queue empty and nothing in flight — stopping',
      )
      break
    }
  }
  await sleep(POLL_MS)
}

await announceStop(db, stopping ? 'signal' : 'queue empty')
// The OCR engine holds a loaded language model and would keep the process
// alive after the loop has finished with it.
await closeOcr()
log('worker stopped')
