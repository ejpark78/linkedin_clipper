/**
 * @file usage.ts
 * @description Analyzes and prints local conversation session logs and token usage metrics.
 * 
 * Rules Complied:
 * - Strict OOP/Typing: Explicit typing, no loose utility variables.
 * - Agent-Friendly Docstrings: Started with this detailed JSDoc.
 * 
 * Dependencies: fs, path, os
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface SessionStats {
  id: string;
  mtime: Date;
  stepsCount: number;
  compressedSize: string;
  fullSize: string;
}

export class UsageReporter {
  private readonly brainDir: string;

  constructor() {
    this.brainDir = path.join(os.homedir(), '.gemini/antigravity-cli/brain');
  }

  /**
   * Format file size to human-readable string (KB, MB).
   */
  private formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  /**
   * Scan all sessions sorted by last modified time.
   */
  public getSessions(): { id: string; mtime: Date; fullPath: string }[] {
    if (!fs.existsSync(this.brainDir)) {
      throw new Error(`Brain directory not found: ${this.brainDir}`);
    }

    return fs.readdirSync(this.brainDir)
      .map(name => {
        const fullPath = path.join(this.brainDir, name);
        try {
          const stat = fs.statSync(fullPath);
          return {
            id: name,
            mtime: stat.mtime,
            isDirectory: stat.isDirectory(),
            fullPath,
          };
        } catch {
          return null;
        }
      })
      .filter((item): item is { id: string; mtime: Date; isDirectory: boolean; fullPath: string } => 
        item !== null && item.isDirectory && item.id !== 'scratch' && item.id !== '.system_generated'
      )
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  }

  /**
   * Get metrics for a specific session.
   */
  public getSessionStats(sessionId: string): SessionStats {
    const sessionPath = path.join(this.brainDir, sessionId);
    const logDir = path.join(sessionPath, '.system_generated/logs');
    const transcriptPath = path.join(logDir, 'transcript.jsonl');
    const transcriptFullPath = path.join(logDir, 'transcript_full.jsonl');

    let stepsCount = 0;
    let compressedSize = 'N/A';
    let fullSize = 'N/A';

    if (fs.existsSync(transcriptPath)) {
      const stats = fs.statSync(transcriptPath);
      compressedSize = this.formatSize(stats.size);
      
      const content = fs.readFileSync(transcriptPath, 'utf-8');
      stepsCount = content.split('\n').filter(Boolean).length;
    }

    if (fs.existsSync(transcriptFullPath)) {
      const stats = fs.statSync(transcriptFullPath);
      fullSize = this.formatSize(stats.size);
    }

    const sessionStat = fs.statSync(sessionPath);

    return {
      id: sessionId,
      mtime: sessionStat.mtime,
      stepsCount,
      compressedSize,
      fullSize,
    };
  }

  /**
   * Report usage details.
   */
  public report(targetSessionId?: string): void {
    const sessions = this.getSessions();
    if (sessions.length === 0) {
      console.log('❌ No active sessions found.');
      return;
    }

    const activeSessionId = targetSessionId || sessions[0].id;
    const stats = this.getSessionStats(activeSessionId);

    console.log('==================================================');
    console.log('📊 Agent Session Usage Reporter (TypeScript)');
    console.log('==================================================');
    console.log(`📂 Session ID:  ${stats.id}`);
    console.log(`📂 Path:        ${path.join(this.brainDir, stats.id)}`);
    console.log('──────────────────────────────────────────────────');
    console.log('📝 Compressed Steps (transcript.jsonl):');
    console.log(`   ├─ File Size:   ${stats.compressedSize}`);
    console.log(`   └─ Total Steps: ${stats.stepsCount} steps`);
    console.log('');
    console.log('📝 Full Log Details (transcript_full.jsonl):');
    console.log(`   └─ File Size:   ${stats.fullSize}`);
    console.log('──────────────────────────────────────────────────');
    console.log('🗂️ All Sessions Summary (Last 5 Sessions):');

    sessions.slice(0, 5).forEach(s => {
      try {
        const sStats = this.getSessionStats(s.id);
        const dateStr = s.mtime.toISOString().replace('T', ' ').substring(0, 19);
        console.log(`   ${s.id.padEnd(38)} | ${dateStr} | ${String(sStats.stepsCount).padStart(3)} steps`);
      } catch {
        // Skip failures
      }
    });
    console.log('==================================================');
  }
}

if (require.main === module) {
  const reporter = new UsageReporter();
  const argSession = process.argv[2];
  reporter.report(argSession);
}
