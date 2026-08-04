#!/usr/bin/env node
/**
 * PostToolUse hook (matcher: Edit|Write)
 * After Claude edits a .ts/.tsx file: run typecheck (tsc -b) + linter (oxlint, fallback eslint).
 * Exit 2 => stderr is fed back to Claude so it fixes errors immediately.
 * Exit 0 => silent pass.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

const MAX_OUTPUT = 4000; // keep feedback compact so it doesn't bloat context

const input = JSON.parse((await readStdin()) || "{}");
const filePath = input?.tool_input?.file_path ?? "";

// Only care about TypeScript source files that still exist
if (!/\.(ts|tsx)$/.test(filePath) || !existsSync(filePath)) process.exit(0);
// Skip generated files
if (/src[\\/]types[\\/]database\.ts$/.test(filePath)) process.exit(0);

const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const problems = [];

if (hasBin("tsc")) run("npx --no-install tsc -b --pretty false", "TypeScript errors");
if (hasBin("oxlint"))
    run(`npx --no-install oxlint ${JSON.stringify(filePath)}`, `oxlint (${filePath})`);
else if (hasBin("eslint"))
    run(`npx --no-install eslint ${JSON.stringify(filePath)}`, `ESLint (${filePath})`);

if (problems.length > 0) {
    process.stderr.write(
        "Checks failed after your edit. Fix these before continuing:\n\n" +
        problems.join("\n\n")
    );
    process.exit(2);
}
process.exit(0);

function hasBin(name) {
    // Skip checks gracefully in a fresh repo where deps aren't installed yet
    return existsSync(`${cwd}/node_modules/.bin/${name}`);
}

function run(cmd, label) {
    try {
        execSync(cmd, { cwd, stdio: "pipe" });
    } catch (e) {
        // Spawn failure (tool not installed yet, fresh repo) -> don't block
        if (typeof e.status !== "number") return;
        const out = truncate(
            [e.stdout?.toString(), e.stderr?.toString()].filter(Boolean).join("\n")
        );
        problems.push(`${label}:\n${out}`);
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