#!/usr/bin/env node
/**
 * PreToolUse hook (matcher: Bash)
 * Blocks `git commit` while typecheck or lint fail.
 * Exit 2 => the Bash call is blocked and stderr explains why to Claude.
 * Exit 0 => command is allowed to proceed.
 */
import { execSync } from "node:child_process";

const MAX_OUTPUT = 4000;

const input = JSON.parse((await readStdin()) || "{}");
if (input?.tool_name && input.tool_name !== "Bash") process.exit(0);

const command = input?.tool_input?.command ?? "";
if (!/\bgit\s+commit\b/.test(command)) process.exit(0);

const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const failures = [];

gate("npm run typecheck", "typecheck");
gate("npm run lint", "lint");

if (failures.length > 0) {
    process.stderr.write(
        "COMMIT BLOCKED — fix these first, then retry the commit:\n\n" +
        failures.join("\n\n")
    );
    process.exit(2);
}
process.exit(0);

function gate(cmd, label) {
    try {
        execSync(cmd, { cwd, stdio: "pipe" });
    } catch (e) {
        // Spawn failure (scripts not set up yet) -> don't block commits
        if (typeof e.status !== "number") return;
        const raw = [e.stdout?.toString(), e.stderr?.toString()]
            .filter(Boolean)
            .join("\n");
        // Script not defined yet (fresh repo) -> don't block commits
        if (/missing script/i.test(raw)) return;
        failures.push(`${label} failed:\n${truncate(raw)}`);
    }
}

function truncate(s) {
    s = (s || "").trim();
    return s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + "\n…(truncated)" : s;
}

async function readStdin() {
    let data = "";
    for await (const chunk of process.stdin) data += chunk;
    return data;
}