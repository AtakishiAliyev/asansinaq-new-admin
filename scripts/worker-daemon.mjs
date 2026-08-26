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
// The plist runs NODE BY ABSOLUTE PATH, not `npm`. A launchd agent inherits no
// login shell and gets a minimal PATH, and npm is a shell script whose shebang
// is `#!/usr/bin/env node` — so an agent that runs npm dies with
// "env: node: No such file or directory" before the worker starts at all. The
// argument list is still DERIVED from package.json's `worker` script rather
// than written out here, so the two cannot drift; only the leading `node` is
// swapped for the absolute path of the interpreter running this installer.
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

  // Derived from package.json so a change to how the worker is launched cannot
  // leave the agent running yesterday's command line.
  const pkg = JSON.parse(readFileSync(join(PROJECT, 'package.json'), 'utf8'))
  const script = String(pkg.scripts?.worker ?? '')
  const tokens = script.split(/\s+/).filter(Boolean)
  if (tokens[0] !== 'node') {
    console.error(
      `package.json's "worker" script does not start with node:\n  ${script}\n` +
        'The agent needs an absolute interpreter path, so this installer has to\n' +
        'know which token is the interpreter. Update worker-daemon.mjs to match.',
    )
    process.exit(1)
  }
  // The interpreter running this installer. Correct by construction, and the
  // one thing launchd cannot work out for itself.
  const nodePath = process.execPath
  const args = [nodePath, ...tokens.slice(1), '--daemon']

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
${args.map((a) => `      <string>${escapeXml(a)}</string>`).join('\n')}
    </array>
    <key>WorkingDirectory</key>
    <string>${escapeXml(PROJECT)}</string>
    <key>EnvironmentVariables</key>
    <dict>
      <!-- Belt and braces: the interpreter is absolute above, but anything the
           worker shells out to would hit the same empty PATH. -->
      <key>PATH</key>
      <string>${escapeXml(`${dirname(nodePath)}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`)}</string>
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
      `  node    ${nodePath}\n` +
      `  command ${args.join(' ')}\n` +
      `  log     ${LOG}\n\n` +
      'The node path above is baked into the plist, because a launchd agent has\n' +
      'no PATH to find it with. If node is ever upgraded or moved, that path\n' +
      'stops existing and the agent dies on launch — re-run worker:install then.\n' +
      '`npm run worker:status` names that failure if it happens.\n\n' +
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

/**
 * Known ways a launchd agent dies before the worker ever runs.
 *
 * Each one looks identical from the outside — an agent that is loaded and a log
 * that says nothing useful — so the point is to name the class rather than
 * print the log and leave the reading to whoever is unlucky. The PATH failure
 * is first because it is the one this installer itself shipped: launchd gives
 * an agent no PATH, npm's shebang is `#!/usr/bin/env node`, and the whole thing
 * dies with a message about `env` that never mentions the worker.
 */
const LOG_SIGNATURES = [
  {
    match: /env:\s*node:\s*No such file or directory/i,
    what: 'launchd could not find node',
    fix:
      'The plist is invoking node through PATH, and an agent has none. Re-run\n' +
      '  npm run worker:install\n' +
      'which bakes the absolute interpreter path in.',
  },
  {
    match: /^(.*\/node): No such file or directory/im,
    what: 'the node baked into the plist no longer exists',
    fix:
      'node was probably upgraded or moved since install. Re-run\n' +
      '  npm run worker:install\n' +
      'from this directory to point the agent at the current one.',
  },
  {
    match: /Cannot find module|ERR_MODULE_NOT_FOUND/i,
    what: 'node started but could not load the worker',
    fix:
      'Usually a missing install or a wrong working directory. Check that\n' +
      '  npm run worker -- --dry-run\n' +
      'works by hand in this directory first.',
  },
  {
    match: /Invalid worker environment/i,
    what: 'the worker started without its keys',
    fix:
      'The plist carries a copy of .env taken at install time. Re-run\n' +
      '  npm run worker:install\n' +
      'after any key change.',
  },
]

/** What launchctl knows: is it loaded, has it been dying, what did it exit with. */
function agentState() {
  let out = ''
  try {
    out = execFileSync('launchctl', ['print', `gui/${process.getuid()}/${LABEL}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return { loaded: false }
  }
  const num = (re) => {
    const m = re.exec(out)
    return m ? Number(m[1]) : undefined
  }
  return {
    loaded: true,
    pid: num(/\bpid = (\d+)/),
    runs: num(/\bruns = (\d+)/),
    lastExit: num(/last exit (?:code|status) = (\d+)/),
  }
}

function status() {
  const agent = agentState()
  console.log(`agent:   ${agent.loaded ? 'loaded' : 'not loaded'}  (${PLIST})`)
  if (agent.loaded) {
    console.log(
      `process: ${agent.pid ? `running, pid ${agent.pid}` : 'not currently running'}` +
        `${agent.runs !== undefined ? `  ·  ${agent.runs} run(s)` : ''}` +
        `${agent.lastExit !== undefined ? `  ·  last exit ${agent.lastExit}` : ''}`,
    )
  }

  const tail = existsSync(LOG) ? readFileSync(LOG, 'utf8').trimEnd() : ''
  const problems = LOG_SIGNATURES.filter((sig) => sig.match.test(tail))

  // A loaded agent with no process and several runs behind it is a crash loop,
  // whatever the log happens to say — launchd restarting it is the evidence.
  const respawning =
    agent.loaded && !agent.pid && (agent.runs ?? 0) > 2 && (agent.lastExit ?? 0) !== 0

  if (problems.length || respawning) {
    console.log('\nPROBLEM')
    for (const p of problems) console.log(`  ${p.what}\n${p.fix.replace(/^/gm, '    ')}`)
    if (respawning && !problems.length) {
      console.log(
        `  the agent has started ${agent.runs} times and keeps exiting ` +
          `(last exit ${agent.lastExit})\n` +
          '    Read the log below: the worker is failing at startup rather than\n' +
          '    running out of work.',
      )
    }
  } else if (agent.loaded && agent.pid) {
    console.log('\nno known startup failure in the log.')
  }

  if (tail) {
    console.log(`\nlog: ${LOG}\n`)
    for (const line of tail.split('\n').slice(-12)) console.log(`  ${line}`)
  } else {
    console.log('\nlog: not written yet — the agent has produced no output at all.')
    if (agent.loaded) {
      console.log(
        '  For a loaded agent that is usually a launch failure before any of the\n' +
          "  worker's own code ran. `launchctl print gui/$UID/" + LABEL + "` has more.",
      )
    }
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
