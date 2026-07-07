/**
 * util.ts — Shared utility functions for the git CLI tooling.
 *
 * Design context: Extracted from the monolithic git.ts to avoid
 * circular dependencies and enable individual testing.
 * These are pure stateless helpers; no class wrapper needed.
 *
 * Dependencies: fs, path (Node built-ins)
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export function findProjectRoot(startDir: string): string {
  let current = startDir;
  while (current !== path.parse(current).root) {
    if (fs.existsSync(path.join(current, '.git')) && fs.existsSync(path.join(current, 'package.json'))) {
      return current;
    }
    current = path.dirname(current);
  }
  return startDir;
}

export function loadEnv(envPath?: string): void {
  const resolvedPath = envPath || path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(resolvedPath)) return;

  const content = fs.readFileSync(resolvedPath, 'utf-8');
  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const parts = trimmed.split('=');
    const key = parts[0].trim();
    const value = parts.slice(1).join('=').trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value;
    }
  });
}

export function parseFlag(args: string[], name: string, short?: string): string | null {
  for (const arg of args) {
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
    if (short && arg.startsWith(`${short}=`)) return arg.slice(short.length + 1);
  }
  const idx = args.findIndex(a => a === name || (short && a === short));
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return null;
}

export function readFileOrExit(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    const err = e as Error;
    console.error(`File read error: ${err.message}`);
    process.exit(1);
  }
}
