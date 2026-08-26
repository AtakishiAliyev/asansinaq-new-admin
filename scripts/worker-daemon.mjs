// Install or remove the worker as an always-on background agent.
//
//   npm run worker:install     start on login, restart on crash
//   npm run worker:uninstall   remove it
//   npm run worker:status      is it loaded, is it alive, what does it say
//
// macOS only, by launchd. The worker itself is unchanged — this only arranges
// for it to be running — because its independence from any browser tab is the
// point of the batch lane, and a daemon is how that independence is kept while
// still not asking an operator to hold a terminal open.
//
// Three things are deliberate.
//
// The plist runs `npm run worker -- --daemon` from the project directory rather
// than embedding a node path: the worker already runs under Node's TypeScript
// stripping with the eval loader, and duplicating that invocation here would be
// a second copy to keep in step with package.json.
//
// The environment comes from the project's own `.env`, read at install time and
// baked into the plist. launchd agents do not inherit a login shell, so a plist
// that merely says "run npm" starts a worker with no keys and fails on its
// first claim. Baking them in means `worker:install` must be re-run after a key
// changes, which is stated in the output rather than left to be discovered.
//
// Logs go to `local/worker.log`, which is gitignored — the log carries book
// ids, batch ids and occasionally a model's own words about a page.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LABEL = 'com.asansinaq.worker'
const PLIST = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)
const LOG = join(PROJECT, 'local', 'worker.log')

const action = process.argv[2] ?? 'install'

if (platform() !== 'darwin') {
  console.error(
    `worker:${action} installs a launchd agent and only works on macOS.\n` +
      'On another platform run `npm run worker -- --daemon` under whatever\n' +
      'supervisor that machine uses (systemd, pm2, a container restart policy).',
  )
  process.exit(2)
}

/** The keys the worker needs, read from the project's .env. */
function readEnv() {
  const path = join(PROJECT, '.env')
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m) out[m[1]] = (m[2] ?? '').replace(/^["']|["']$/g, '')
  }
  return out
}

const escapeXml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function bootedOut() {
  // `bootout` fails when the agent is not loaded, which is the normal case on a
  // first install — not an error worth showing.
  try {
    execFileSync('launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`], {
      stdio: 'ignore',
    })
  } catch {
    /* not loaded */
  }
}

function install() {
  const env = readEnv()
  const required = [
    'VITE_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'ANTHROPIC_API_KEY',
    'WORKER_ID',
    'MODEL_TEXT',
    'MODEL_FIGURE',
    'MODEL_VERIFY',
    'DAILY_BUDGET_USD',
    'BATCH_SIZE',
  ]
  const missing = required.filter((k) => !env[k] && !(k === 'SUPABASE_URL' && env.VITE_SUPABASE_URL))
  if (missing.length) {
    console.error(
      `.env is missing ${missing.join(', ')}.\n` +
        'The agent gets no login shell, so every variable has to be present here.',
    )
    process.exit(1)
  }
  // The worker reads SUPABASE_URL; the app's .env names it with the VITE prefix.
  env.SUPABASE_URL = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
  env.WORKER_DAEMON = '1'

  mkdirSync(dirname(PLIST), { recursive: true })
  mkdirSync(join(PROJECT, 'local'), { recursive: true })

  const npm = execFileSync('which', ['npm']).toString().trim()
  const entries = Object.entries(env)
    .map(([k, v]) => `      <key>${escapeXml(k)}</key>\n      <string>${escapeXml(v)}</string>`)
    .join('\n')

  writeFileSync(
    PLIST,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${escapeXml(npm)}</string>
      <string>run</string>
      <string>worker</string>
      <string>--</string>
      <string>--daemon</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${escapeXml(PROJECT)}</string>
    <key>EnvironmentVariables</key>
    <dict>
${entries}
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
      <!-- Restart on a crash, but not on a clean exit: the manual path stops
           deliberately when the queue drains, and a supervisor that restarted
           that would spin. The daemon flag keeps this process alive anyway. -->
      <key>SuccessfulExit</key>
      <false/>
    </dict>
    <!-- Give a crash loop room to breathe rather than hammering the provider. -->
    <key>ThrottleInterval</key>
    <integer>30</integer>
    <key>StandardOutPath</key>
    <string>${escapeXml(LOG)}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(LOG)}</string>
  </dict>
</plist>
`,
  )

  bootedOut()
  execFileSync('launchctl', ['bootstrap', `gui/${process.getuid()}`, PLIST], { stdio: 'inherit' })
  console.log(
    `installed ${LABEL}\n` +
      `  plist   ${PLIST}\n` +
      `  workdir ${PROJECT}\n` +
      `  log     ${LOG}\n\n` +
      'It starts now, and again at every login. It restarts itself if it crashes.\n' +
      'The keys were copied from .env INTO the plist, so re-run worker:install\n' +
      'after changing any of them.\n\n' +
      'Start and pause are in the UI, on the Suallar page — this only decides\n' +
      'whether the process exists.',
  )
}

function uninstall() {
  bootedOut()
  if (existsSync(PLIST)) unlinkSync(PLIST)
  console.log(
    `removed ${LABEL}\n` +
      'The worker is stopped and will not start at login.\n' +
      `The log is left at ${LOG}; delete it by hand if you want it gone.\n` +
      'Anything the worker had claimed stays claimed until its lease expires,\n' +
      'then another worker — or the same one, reinstalled — picks it up.',
  )
}

function status() {
  let loaded = false
  try {
    execFileSync('launchctl', ['print', `gui/${process.getuid()}/${LABEL}`], { stdio: 'ignore' })
    loaded = true
  } catch {
    loaded = false
  }
  console.log(`agent: ${loaded ? 'loaded' : 'not loaded'}  (${PLIST})`)
  if (existsSync(LOG)) {
    const lines = readFileSync(LOG, 'utf8').trimEnd().split('\n')
    console.log(`log: ${LOG}\n`)
    for (const line of lines.slice(-12)) console.log(`  ${line}`)
  } else {
    console.log('log: not written yet')
  }
  console.log(
    '\nLiveness is the heartbeat, not this: the UI reads worker_heartbeat and\n' +
      'judges by its age, because a process that died cannot report that it did.',
  )
}

if (action === 'install') install()
else if (action === 'uninstall') uninstall()
else if (action === 'status') status()
else {
  console.error(`unknown action "${action}" — expected install, uninstall or status`)
  process.exit(2)
}
