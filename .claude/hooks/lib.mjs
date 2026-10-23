// Shared helpers for project hooks. No dependencies: runs on plain Node 24.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const ROOT = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

export async function readInput() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

export function rel(p) {
  return path.relative(ROOT, path.resolve(ROOT, p)).split(path.sep).join('/');
}

export function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

export function preToolDecision(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

export function addContext(eventName, text) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext: text } }),
  );
  process.exit(0);
}
