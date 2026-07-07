/**
 * git-service.ts — Git CLI command wrapper.
 *
 * Design context: Thin wrapper around execSync for common git operations.
 * All methods return stdout as trimmed strings. Supports ignore-error
 * mode for non-critical queries (e.g., diff on clean tree).
 *
 * Dependencies: child_process, fs, path (Node built-ins)
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export class GitService {
  runCmd(cmd: string, ignoreError = false): string {
    try {
      return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch (error) {
      if (ignoreError) return '';
      const err = error as Error;
      console.error(`Command failed: ${cmd}`);
      console.error(err.message);
      process.exit(1);
    }
  }

  runCmdInherit(cmd: string): void {
    try {
      execSync(cmd, { encoding: 'utf-8', stdio: 'inherit' });
    } catch (error) {
      const err = error as Error;
      console.error(`Command failed: ${cmd}`);
      console.error(err.message);
      process.exit(1);
    }
  }

  getModifiedFiles(): string[] {
    const diff1 = this.runCmd('git diff --name-only', true).split('\n').filter(Boolean);
    const diff2 = this.runCmd('git diff --cached --name-only', true).split('\n').filter(Boolean);
    return Array.from(new Set([...diff1, ...diff2])).filter((file) => fs.existsSync(file));
  }

  getStagedFiles(): string[] {
    const status = this.runCmd('git status --porcelain', true);
    return status.split('\n').map(l => l.substring(3).trim()).filter(Boolean);
  }

  showFileDiff(file: string, status: string): void {
    const absPath = path.resolve(process.cwd(), file);
    let action = 'Edit';
    if (status === 'A') action = 'Create';
    if (status === 'D') action = 'Delete';

    console.log(`  ${action}(${absPath})`);

    const numstat = this.runCmd(`git diff --cached --numstat -- "${file}"`, true);
    if (!numstat) {
      console.log('    +0 / -0 lines');
      return;
    }

    const parts = numstat.split(/\s+/);
    const addedStr = parts[0];
    const deletedStr = parts[1];

    const isBinary = addedStr === '-' || deletedStr === '-';
    const added = isBinary ? 0 : parseInt(addedStr, 10) || 0;
    const deleted = isBinary ? 0 : parseInt(deletedStr, 10) || 0;

    console.log(`    +${added} / -${deleted} lines`);

    if (isBinary) {
      console.log('      [Binary file]\n');
      return;
    }

    const diffOutput = this.runCmd(`git diff --cached -U3 -- "${file}"`, true);
    if (!diffOutput) {
      console.log('');
      return;
    }

    let lineOld = 0;
    let lineNew = 0;

    const lines = diffOutput.split('\n');
    for (const line of lines) {
      if (/^(diff|index|---|\+\+\+)/.test(line)) continue;

      const hunkHeaderMatch = line.match(/^@@\s+-(\d+),?(\d*)\s+\+(\d+),?(\d*)\s+@@/);
      if (hunkHeaderMatch) {
        lineOld = parseInt(hunkHeaderMatch[1], 10);
        lineNew = parseInt(hunkHeaderMatch[3], 10);
        continue;
      }

      if (lineOld === 0 && lineNew === 0) continue;

      if (line.startsWith('-')) {
        console.log(`      ${String(lineOld).padEnd(4)} - ${line.substring(1)}`);
        lineOld++;
      } else if (line.startsWith('+')) {
        console.log(`      ${String(lineNew).padEnd(4)} + ${line.substring(1)}`);
        lineNew++;
      } else if (line.startsWith(' ')) {
        console.log(`      ${String(lineNew).padEnd(4)}   ${line.substring(1)}`);
        lineOld++;
        lineNew++;
      } else if (line === '') {
        console.log(`      ${String(lineNew).padEnd(4)}   `);
        lineOld++;
        lineNew++;
      }
    }
    console.log('');
  }

  buildPushUrl(apiUrl: string, repo: string, token: string): string {
    const pushUser = process.env.GITEA_ADMIN_USER || 'gitea-admin';
    const url = new URL(apiUrl);
    return `${url.protocol}//${pushUser}:${token}@${url.host}/${repo}.git`;
  }

  currentBranch(): string {
    return this.runCmd('git rev-parse --abbrev-ref HEAD', true);
  }

  shortStatus(): string {
    return this.runCmd('git status --short', true);
  }

  hasUncommitted(): boolean {
    return !!this.shortStatus();
  }

  stash(): void {
    this.runCmdInherit('git stash');
  }

  stashPop(): void {
    this.runCmdInherit('git stash pop');
  }

  checkout(branch: string): void {
    this.runCmd(`git checkout ${branch}`);
  }

  checkoutNew(branch: string): void {
    this.runCmd(`git checkout -b ${branch}`);
  }

  pull(branch = 'main'): void {
    const remotes = this.runCmd('git remote', true).split('\n').filter(Boolean);
    const remote = remotes[0] || 'origin';
    this.runCmd(`git pull ${remote} ${branch}`);
  }

  merge(branch: string): void {
    this.runCmd(`git merge ${branch}`);
  }

  log(count = 5): string {
    return this.runCmd(`git log --oneline -${count}`, true);
  }
}
