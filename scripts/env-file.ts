// `.env` for the operator-run scripts.
//
// The worker gets its environment from the shell (`set -a; . ./.env`), but the
// smokes and sample generators are run by hand and forgetting that step reads
// as a missing key rather than a missing `set -a`. So they read the file too,
// with process.env winning where both have a value.
import { readFileSync } from 'node:fs'

export function readEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return out
  }
  for (const line of raw.split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m?.[1]) out[m[1]] = (m[2] ?? '').replace(/^["']|["']$/g, '')
  }
  return out
}
