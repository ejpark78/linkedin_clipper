/**
# 🤖 sessions.ts
# Description: Unified utility script to manage agent sessions (dumping transcripts, context, brain, sysinfo, and pruning empty sessions).
# Constraints:
#   - Relies on arguments to choose actions: --sysinfo, --transcript, --context, --brain, --prune, --all-targets.
# Dependencies: fs, path, os, child_process, ./agent_adapter
# ==============================================================================
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import {
  createAdapter,
  parseAgentsFromArg,
  assignSessionNumbers,
  AgentToolCall,
  AgentAdapter,
  AgentMessage,
  AgentSession
} from './agent_adapter';

// ==============================================================================
// 1. SysInfo Dumper
// ==============================================================================
interface DockerServiceInfo {
  Service: string;
  State: string;
}

class SysInfoDumper {
  private readonly outputBase: string;

  constructor(outputBase: string) {
    this.outputBase = outputBase;
  }

  public run(): void {
    try {
      const info = {
        timestamp: new Date().toISOString(),
        git: this.getGitStatus(),
        docker: this.getDockerStatus(),
        mongo: this.getMongoConnectivity(),
        redis: this.getRedisConnectivity()
      };

      const transcriptsAgyDir = path.join(this.outputBase, 'agy');
      fs.mkdirSync(transcriptsAgyDir, { recursive: true });
      const destPath = path.join(transcriptsAgyDir, 'sysinfo_cache.json');
      fs.writeFileSync(destPath, JSON.stringify(info, null, 2), 'utf-8');
      console.log(`✨ System status cached at ${transcriptsAgyDir}: ${destPath}`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('❌ Error dumping sysinfo:', errMsg);
    }
  }

  private getGitStatus(): string {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
      const status = execSync('git status -s', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
      return `Branch: ${branch}${status ? ' | Changes: ' + status.replace(/\n/g, ', ') : ' | Clean'}`;
    } catch {
      return 'Not a git repo or command failed';
    }
  }

  private getDockerStatus(): string {
    try {
      const output = execSync('docker compose -p scraper ps --format json', { stdio: ['pipe', 'pipe', 'ignore'] }).toString();
      const services = JSON.parse(`[${output.trim().split('\n').join(',')}]`) as DockerServiceInfo[];
      return services.map((s: DockerServiceInfo) => `${s.Service}:${s.State}`).join(', ');
    } catch {
      return 'Docker down or command failed';
    }
  }

  private getMongoConnectivity(): string {
    try {
      const output = execSync('docker compose -p scraper exec -T mongodb mongosh --eval "db.adminCommand({ping: 1})" --quiet', { stdio: ['pipe', 'pipe', 'ignore'] }).toString();
      return output.includes('ok: 1') ? 'Connected (Active)' : 'Disconnected';
    } catch {
      return 'Disconnected/Unavailable';
    }
  }

  private getRedisConnectivity(): string {
    try {
      const output = execSync('docker compose -p scraper exec -T redis redis-cli ping', { stdio: ['pipe', 'pipe', 'ignore'] }).toString();
      return output.trim() === 'PONG' ? 'Connected (Active)' : 'Disconnected';
    } catch {
      return 'Disconnected/Unavailable';
    }
  }
}

// ==============================================================================
// 2. Transcript Dumper
// ==============================================================================
class TranscriptDumper {
  private readonly outputBase: string;
  private readonly workspaceRoot: string = path.resolve(__dirname, '../..');
  private readonly adapter: AgentAdapter;
  private readonly allMode: boolean;
  private readonly agentName: string;

  constructor(agentName: string, outputBase: string, allMode = false) {
    this.agentName = agentName;
    this.outputBase = outputBase;
    this.adapter = createAdapter(agentName);
    this.allMode = allMode;
  }

  private sanitizeAbsolutePaths(text: string): string {
    const escapedRoot = this.workspaceRoot.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(escapedRoot + '/?', 'g');
    return text.replace(regex, './');
  }

  private truncateOutput(text: string, maxLines = 150, keepHead = 50, keepTail = 100): string {
    const lines = text.split('\n');
    if (lines.length <= maxLines) {
      return text;
    }
    const head = lines.slice(0, keepHead);
    const tail = lines.slice(lines.length - keepTail);
    const truncatedCount = lines.length - keepHead - keepTail;
    return [
      ...head,
      `\n... [Truncated ${truncatedCount} lines of output. Full log copied to tasks/ directory] ...\n`,
      ...tail
    ].join('\n');
  }

  private buildTranscript(
    sessionId: string,
    rawTitle: string,
    model: string | null,
    messages: { role: string; content: string; toolCalls: AgentToolCall[]; stepIndex: number }[],
    taskLogs?: { id: string; localPath: string }[]
  ): string {
    const title = rawTitle !== sessionId ? rawTitle : `Session ${sessionId}`;
    const summarize = (text: string, maxLen = 180): string => {
      const compact = text.replace(/\s+/g, ' ').trim();
      return compact.length > maxLen ? `${compact.slice(0, maxLen - 1)}…` : compact;
    };
    let md = `---\n`;
    md += `title: ${title}\n`;
    md += `session_id: ${sessionId}\n`;
    md += `agent: ${this.agentName}\n`;
    if (model) {
      md += `model: ${model}\n`;
    }
    md += `---\n\n`;
    md += `# 📝 Transcript: ${title}\n- **Session ID**: ${sessionId}\n`;
    md += `- **Related Reports**: [Brain Dump](./brain_dump.md) | [Context Snapshot](./context_memory.md) | [Raw Logs](./logs/)\n`;
    if (taskLogs && taskLogs.length > 0) {
      md += `- **Tasks Execution Logs**:\n`;
      taskLogs.forEach(t => {
        md += `  - [Task: ${t.id}](./tasks/${t.id}.log)\n`;
      });
    }
    md += `\n---\n`;

    messages.forEach(msg => {
      const roleIcon = msg.role === 'user' ? '🗣️ User' : '🤖 Agent';
      md += `\n### [Step ${msg.stepIndex}] ${roleIcon}\n`;
      
      if (msg.content) {
        const content = this.sanitizeAbsolutePaths(msg.content);
        md += `\n${content}\n`;
      }

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        msg.toolCalls.forEach(call => {
          md += `\n> **🛠️ Tool Call**: \`${call.name}\`\n`;
          md += `> \`${summarize(JSON.stringify(call.arguments), 240)}\`\n`;
          if (call.result) {
            md += `> **Result**: \`${summarize(this.sanitizeAbsolutePaths(call.result), 320)}\`\n`;
          }
        });
      }
    });

    return md;
  }

  public dumpAll(): void {
    const sessions = this.adapter.getSessions(this.allMode);
    const pathMap = assignSessionNumbers(sessions);

    sessions.forEach(s => {
      const info = pathMap.get(s.id);
      if (!info) return;
      console.log(`  -> ${info.tag} (${s.title})`);

      try {
        const detail = this.adapter.getSessionDetail(s.id);
        const taskLogs: { id: string; localPath: string }[] = [];
        
        if (this.adapter.baseBrainDir) {
          const srcTasksDir = path.join(this.adapter.baseBrainDir, s.id, '.system_generated', 'tasks');
          if (fs.existsSync(srcTasksDir)) {
            const files = fs.readdirSync(srcTasksDir);
            for (const file of files) {
              if (file.endsWith('.log')) {
                const taskId = file.replace('.log', '');
                taskLogs.push({ id: taskId, localPath: path.join(srcTasksDir, file) });
              }
            }
          }
        }

        const md = this.buildTranscript(s.id, s.title || s.id, detail.session.model, detail.messages, taskLogs);

        const outDir = path.join(this.outputBase, this.agentName, info.dateDir);
        const destSessionDir = path.join(outDir, info.tag);
        fs.mkdirSync(destSessionDir, { recursive: true });

        const outPath = path.join(destSessionDir, `transcript.md`);
        fs.writeFileSync(outPath, md, 'utf-8');
        console.log(`  ✨ Saved transcript: ${outPath}`);

        this.writeWikiLog(destSessionDir, s.id, detail.messages);

        const srcSessionDir = detail.sessionDir || (this.adapter.baseBrainDir ? path.join(this.adapter.baseBrainDir, s.id) : '');
        if (srcSessionDir && fs.existsSync(srcSessionDir)) {
            fs.cpSync(srcSessionDir, destSessionDir, {
              recursive: true,
              filter: (src) => {
                const relative = path.relative(srcSessionDir, src);
                return !relative.startsWith('.system_generated');
              }
            });

            const srcTasksDir = path.join(srcSessionDir, '.system_generated', 'tasks');
            const destTasksDir = path.join(destSessionDir, 'tasks');
            if (fs.existsSync(srcTasksDir)) {
              fs.mkdirSync(destTasksDir, { recursive: true });
              fs.cpSync(srcTasksDir, destTasksDir, { recursive: true });
            }

            const srcLogsDir = path.join(srcSessionDir, '.system_generated', 'logs');
            const destLogsDir = path.join(destSessionDir, 'logs');
            if (fs.existsSync(srcLogsDir)) {
              fs.mkdirSync(destLogsDir, { recursive: true });
              fs.cpSync(srcLogsDir, destLogsDir, { recursive: true });
            }

            console.log(`  ✨ Copied all raw session assets and logs to: ${destSessionDir}`);
          }
      } catch (detailErr: any) {
        console.warn(`  ⚠️ Skipping session ${s.id} due to error: ${detailErr.message}`);
      }
    });
  }

  private writeWikiLog(sessionDir: string, sessionId: string, messages: AgentMessage[]): void {
    const summarize = (text: string, maxLen = 90): string => {
      const oneLine = text.replace(/\s+/g, ' ').trim();
      if (!oneLine) return 'Untitled';
      return oneLine.length > maxLen ? `${oneLine.slice(0, maxLen - 1)}…` : oneLine;
    };

    const stripBlockPrefix = (text: string): string => {
      const lines = text.split('\n');
      if (lines.length <= 1) return text.trim();
      return lines.slice(1).join('\n').trim();
    };

    const turns: { user: AgentMessage; assistant: AgentMessage | null }[] = [];
    let currentTurn: { user: AgentMessage; assistant: AgentMessage | null } | null = null;

    messages.forEach(msg => {
      if (msg.role === 'user') {
        if (currentTurn) {
          turns.push(currentTurn);
        }
        currentTurn = { user: msg, assistant: null };
      } else if (msg.role === 'assistant') {
        if (!currentTurn) {
          currentTurn = { user: { role: 'user', content: 'N/A', toolCalls: [], stepIndex: msg.stepIndex - 1 }, assistant: msg };
        } else {
          currentTurn.assistant = msg;
        }
      }
    });
    if (currentTurn) {
      turns.push(currentTurn);
    }

    let wikiContent = '';

    turns.forEach((turn, idx) => {
      const userReq = turn.user.content.trim();
      const assistantAns = turn.assistant ? stripBlockPrefix(turn.assistant.content.trim()) : 'N/A';
      const stepIdx = turn.user.stepIndex;

      let category = 'General';
      let summary = summarize(userReq, 60);
      if (summary === 'Untitled') summary = `Turn ${idx + 1}`;
      let tags = '#general';
      const touchedFiles: string[] = [];

      const commands: string[] = [];
      const toolCalls = turn.assistant ? turn.assistant.toolCalls : [];
      toolCalls.forEach(call => {
        if (call.name === 'run_command') {
          const cmd = String(call.arguments.CommandLine || '');
          commands.push(cmd);
          if (cmd.includes('commit')) {
            category = 'Git/Commit';
          }
        } else {
          commands.push(`${call.name}(${JSON.stringify(call.arguments)})`);
        }

        const fileArg = String(call.arguments.TargetFile || call.arguments.AbsolutePath || '');
        if (fileArg) {
          const relPath = path.relative(this.workspaceRoot, fileArg);
          if (!relPath.startsWith('..') && !path.isAbsolute(relPath)) {
            touchedFiles.push(relPath);
          }
        }
      });

      if (category === 'General' && touchedFiles.length > 0) {
        if (touchedFiles.some(f => f.includes('agents/') || f.includes('AGENTS.md'))) {
          category = 'Doc/Rules';
          tags = '#doc #rules';
        } else if (touchedFiles.some(f => f.includes('src/crawler/sites/'))) {
          category = 'Crawler/Dev';
          tags = '#crawler #dev';
        } else if (touchedFiles.some(f => f.includes('src/viewer/frontend/'))) {
          category = 'Frontend/Dev';
          tags = '#frontend #dev';
        } else if (touchedFiles.some(f => f.includes('src/database/'))) {
          category = 'DB/Migration';
          tags = '#db #migration';
        } else if (touchedFiles.some(f => f.endsWith('.ts') || f.endsWith('.js'))) {
          category = 'Refactor';
          tags = '#refactor';
        }
      }

      const filesList = touchedFiles.length > 0 
        ? touchedFiles.map(f => `* [${path.basename(f)}](${f})`).join('\n')
        : 'None';

      const datetime = new Date().toISOString().replace('T', ' ').substring(0, 19);

      let learnings = 'N/A';
      const learningHeaderMatch = assistantAns.match(/(?:##?\s*(?:Troubleshooting|Learnings|💡\s*Troubleshooting|배운\s*점|학습\s*내용)[\s\S]*)/i);
      if (learningHeaderMatch) {
        learnings = learningHeaderMatch[0].trim();
      }

      let implementation = 'Performed requested updates.';
      if (touchedFiles.length > 0) {
        implementation = `Modified files: ${touchedFiles.map(f => `\`${f}\``).join(', ')}.`;
      }

      if (idx > 0) {
        wikiContent += `\n---\n\n`;
      }

      wikiContent += `# Turn ${idx + 1}: [${category}] ${summary}\n`;
      wikiContent += `- **Tags**: ${tags}\n`;
      wikiContent += `- **Related Files**:\n${filesList.split('\n').map(l => '  ' + l).join('\n')}\n`;
      wikiContent += `- **Date**: ${datetime}\n\n`;
      wikiContent += `## 🗣️ User Request\n> ${userReq.replace(/\n/g, '\n> ')}\n\n`;
      wikiContent += `## 🗣️ Agent Answer\n> ${assistantAns.replace(/\n/g, '\n> ')}\n\n`;
      wikiContent += `## 🛠️ Action Taken & Implementation Details\n- ${implementation}\n\n`;
      wikiContent += `### 💻 Executed CLI Commands\n`;
      if (commands.length > 0) {
        wikiContent += commands.map(c => `- \`${summarize(c, 140)}\``).join('\n') + '\n';
      } else {
        wikiContent += `- None\n`;
      }
      wikiContent += `\n## 💡 Troubleshooting / Learnings (LLM Knowledge Base)\n- ${learnings.replace(/\n/g, '\n  ')}\n`;
      wikiContent += `\n## 🧾 Turn Evidence\n`;
      wikiContent += `- **Step Index**: ${stepIdx}\n`;
      wikiContent += `- **Assistant Present**: ${turn.assistant ? 'Yes' : 'No'}\n`;
    });

    const destPath = path.join(sessionDir, 'session.md');
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, wikiContent, 'utf-8');
    console.log(`  ✨ Saved session transcript: ${destPath}`);
  }
}

// ==============================================================================
// 3. Context Dumper
// ==============================================================================
class ContextDumper {
  private readonly agentName: string;
  private readonly outputBase: string;
  private readonly allMode: boolean;

  constructor(agentName: string, outputBase: string, allMode = false) {
    this.agentName = agentName;
    this.outputBase = outputBase;
    this.allMode = allMode;
  }

  private getSystemMetadata(): { mongoStatus: string; redisStatus: string; scale: string; gitBranch: string; gitDirty: string } {
    let mongoStatus = 'Disconnected/Unavailable';
    let redisStatus = 'Disconnected/Unavailable';
    let scale = '1';
    let gitBranch = 'N/A';
    let gitDirty = 'Clean';

    try {
      const out = execSync('docker compose -p scraper ps mongodb --format json 2>/dev/null', { stdio: ['pipe', 'pipe', 'ignore'] }).toString();
      if (out.includes('"running"')) mongoStatus = 'Connected (Active)';
    } catch {
      // Ignore
    }

    try {
      const out = execSync('docker compose -p scraper ps redis --format json 2>/dev/null', { stdio: ['pipe', 'pipe', 'ignore'] }).toString();
      if (out.includes('"running"')) redisStatus = 'Connected (Active)';
    } catch {
      // Ignore
    }

    try {
      const mk = path.join(__dirname, '../../scripts/utils/pipeline.mk');
      if (fs.existsSync(mk)) {
        const m = fs.readFileSync(mk, 'utf-8').match(/SCALE\s*\?=\s*(\d+)/);
        if (m) scale = m[1];
      }
    } catch {
      // Ignore
    }

    try {
      gitBranch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', { cwd: path.join(__dirname, '../..'), stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
      const statusOut = execSync('git status --porcelain 2>/dev/null', { cwd: path.join(__dirname, '../..'), stdio: ['pipe', 'pipe', 'ignore'] }).toString();
      if (statusOut) gitDirty = `(+${statusOut.split('\n').filter(Boolean).length}개 변경)`;
    } catch {
      // Ignore
    }

    return { mongoStatus, redisStatus, scale, gitBranch, gitDirty };
  }

  private formatDate(ts: number): string {
    if (!ts) return '알 수 없음';
    try {
      return new Date(ts).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) + ' KST';
    } catch {
      return new Date(ts).toISOString();
    }
  }

  private buildContextMemory(session: AgentSession, messages: AgentMessage[]): string {
    const meta = this.getSystemMetadata();

    let md = `# 🧠 Context Memory Snapshot\n`;
    md += `- **Session ID**: ${session.id}\n`;
    md += `- **Created**:    ${this.formatDate(session.timeCreated)}\n`;
    md += `- **Updated**:    ${this.formatDate(session.timeUpdated)}\n`;
    md += `- **LLM Model**:  ${session.model || 'Unknown'}\n`;
    md += `\n## 🛠️ Environment Status\n`;
    md += `- **Docker services**:\n`;
    md += `  - MongoDB: ${meta.mongoStatus}\n`;
    md += `  - Redis:   ${meta.redisStatus}\n`;
    md += `- **Crawler Scale**: ${meta.scale} concurrency\n`;
    md += `- **Git Workspace**:\n`;
    md += `  - Branch:  \`${meta.gitBranch}\` (${meta.gitDirty})\n`;
    
    md += `\n## 📋 Active Tasks Stack\n`;
    
    const tasksMap = new Map<string, { cmd: string; started: string; status: string; log: string }>();
    messages.forEach(msg => {
      msg.toolCalls.forEach(call => {
        if (call.name === 'run_command' && call.result) {
          const m = call.result.match(/Task id "([^"]+)" finished with result/);
          if (m) {
            const taskId = m[1];
            const t = tasksMap.get(taskId);
            if (t) t.status = 'Completed';
          }

          const launchMatch = call.result.match(/task id: ([^\n]+)/);
          const descMatch = call.result.match(/Task Description: ([^\n]+)/);
          const logMatch = call.result.match(/Task logs are available at: ([^\n]+)/);

          if (launchMatch) {
            const taskId = launchMatch[1].trim();
            const cmd = descMatch ? descMatch[1].trim() : 'Unknown';
            const log = logMatch ? logMatch[1].trim() : 'N/A';
            tasksMap.set(taskId, {
              cmd,
              started: this.formatDate(msg.stepIndex * 1000 + session.timeCreated),
              status: 'Running',
              log
            });
          }
        }
      });
    });

    if (tasksMap.size === 0) {
      md += `* 비동기 백그라운드 태스크 기록 없음.\n`;
    } else {
      md += `| Task ID | Command | Started At | Status | Log File |\n`;
      md += `| :--- | :--- | :--- | :--- | :--- |\n`;
      tasksMap.forEach((t, id) => {
        md += `| \`${id}\` | \`${t.cmd}\` | ${t.started} | **${t.status}** | [Link](${t.log}) |\n`;
      });
    }

    md += `\n## 👤 User Requests Log\n`;
    let reqCount = 0;
    messages.forEach(msg => {
      if (msg.role === 'user') {
        reqCount++;
        md += `### Request #${reqCount} (${this.formatDate(session.timeCreated + msg.stepIndex * 1000)})\n`;
        md += `${msg.content.trim()}\n\n`;
      }
    });

    return md;
  }

  public dump(): void {
    console.log(`🧠 Dumping context for ${this.agentName}...`);

    try {
      const adapter = createAdapter(this.agentName);
      const sessions = adapter.getSessions(this.allMode);
      const pathMap = assignSessionNumbers(sessions);

      sessions.forEach(s => {
        const info = pathMap.get(s.id);
        if (!info) return;
        console.log(`  -> ${info.tag} (${s.title})`);

        const brainDumpPath = path.join(this.outputBase, this.agentName, info.dateDir, info.tag, 'brain_dump.md');
        if (!fs.existsSync(brainDumpPath)) {
          console.log(`  ⏭️  Skip (no brain_dump.md): ${info.tag}`);
          return;
        }

        try {
          const detail = adapter.getSessionDetail(s.id);
          const md = this.buildContextMemory(detail.session, detail.messages);
          const outDir = path.join(this.outputBase, this.agentName, info.dateDir, info.tag);
          fs.mkdirSync(outDir, { recursive: true });
          fs.writeFileSync(path.join(outDir, 'context_memory.md'), md, 'utf-8');
          console.log(`  ✨ Saved: ${outDir}/context_memory.md`);
        } catch (detailErr: unknown) {
          const errMsg = detailErr instanceof Error ? detailErr.message : String(detailErr);
          console.warn(`  ⚠️ Skipping context dump for session ${s.id} due to error: ${errMsg}`);
        }
      });

    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`  ❌ Error for ${this.agentName}: ${errMsg}`);
    }
  }
}

// ==============================================================================
// 4. Brain Dumper
// ==============================================================================
class BrainDumper {
  private readonly agentName: string;
  private readonly outputBase: string;
  private readonly allMode: boolean;

  constructor(agentName: string, outputBase: string, allMode = false) {
    this.agentName = agentName;
    this.outputBase = outputBase;
    this.allMode = allMode;
  }

  private buildBrainDump(session: AgentSession, messages: AgentMessage[]): string {
    let md = `# 🧠 Agent Brain Dump: ${session.title}\n`;
    md += `- **Session ID**: \`${session.id}\`\n`;
    md += `- **Model**:      ${session.model || 'Unknown'}\n`;
    md += `- **Tokens**:     Input: ${session.tokensInput} \| Output: ${session.tokensOutput} (${session.tokensReasoning} reasoning)\n`;
    md += `- **Est Cost**:   $${session.cost.toFixed(4)}\n\n`;
    
    md += `## 🚀 Execution Steps\n`;

    messages.forEach(msg => {
      const roleTitle = msg.role === 'user' ? '🗣️ User' : '🤖 Agent';
      md += `### Step ${msg.stepIndex}: ${roleTitle}\n`;
      md += `${msg.content.trim()}\n\n`;

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        md += `#### 🛠️ Tool Executions\n`;
        msg.toolCalls.forEach(call => {
          md += `- **Tool**: \`${call.name}\`\n`;
          md += `  - **Args**: \`${JSON.stringify(call.arguments)}\`\n`;
          if (call.result) {
            const lines = call.result.split('\n');
            const summary = lines.slice(0, 3).join('\n') + (lines.length > 3 ? `\n... (Total ${lines.length} lines)` : '');
            md += `  - **Result**: \n\`\`\`\n${summary.trim()}\n\`\`\`\n`;
          }
        });
        md += `\n`;
      }
    });

    return md;
  }

  public dump(): void {
    console.log(`🧠 Dumping brain for ${this.agentName}...`);

    try {
      const adapter = createAdapter(this.agentName);
      const sessions = adapter.getSessions(this.allMode);
      const pathMap = assignSessionNumbers(sessions);

      sessions.forEach(s => {
        const info = pathMap.get(s.id);
        if (!info) return;
        console.log(`  -> ${info.tag} (${s.title})`);

        try {
          const detail = adapter.getSessionDetail(s.id);
          const md = this.buildBrainDump(detail.session, detail.messages);

          const outDir = path.join(this.outputBase, this.agentName, info.dateDir, info.tag);
          fs.mkdirSync(outDir, { recursive: true });
          const outPath = path.join(outDir, 'brain_dump.md');
          fs.writeFileSync(outPath, md, 'utf-8');
          console.log(`  ✨ Saved: ${outPath}`);
        } catch (detailErr: unknown) {
          const errMsg = detailErr instanceof Error ? detailErr.message : String(detailErr);
          console.warn(`  ⚠️ Skipping brain dump for session ${s.id} due to error: ${errMsg}`);
        }
      });

    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`  ❌ Error for ${this.agentName}: ${errMsg}`);
    }
  }
}

// ==============================================================================
// 5. SessionSyncer (양방향 동기화 호스트 ↔ 샌드박스)
// ==============================================================================

interface SyncDirStats {
  label: string;
  sessionsAdded: number;
  sessionsUpdated: number;
  filesCopied: number;
  errors: number;
}

class SessionSyncer {
  private readonly PROJECT_ROOT: string;
  private readonly HOST_DB: string;
  private readonly SANDBOX_VOLUME_BASE: string;
  private readonly SANDBOX_DB: string;

  private dryRun = false;
  private force = false;
  private direction: 'host-to-sandbox' | 'sandbox-to-host' | 'both' = 'both';
  private noSnapshot = false;
  private noToolOutput = false;

  private stats: SyncDirStats = { label: '', sessionsAdded: 0, sessionsUpdated: 0, filesCopied: 0, errors: 0 };

  constructor() {
    this.PROJECT_ROOT = path.resolve(__dirname, '../..');
    this.HOST_DB = path.join(os.homedir(), '.local/share/opencode/opencode.db');
    this.SANDBOX_VOLUME_BASE = path.join(this.PROJECT_ROOT, 'agents/.volumes/sandbox/local');
    this.SANDBOX_DB = path.join(this.SANDBOX_VOLUME_BASE, 'share/opencode/opencode.db');
  }

  public run(): void {
    const args = process.argv.slice(2);
    const dirArg = args.find(a => a.startsWith('--direction='));
    if (dirArg) this.direction = dirArg.split('=')[1] as typeof this.direction;
    this.dryRun = args.includes('--dry-run');
    this.force = args.includes('--force');
    this.noSnapshot = args.includes('--no-snapshot');
    this.noToolOutput = args.includes('--no-tool-output');

    console.log('🔄 OpenCode 세션 동기화\n');

    this.checkSqlite3();
    this.checkDbFiles();
    this.checkSandboxContainer();
    this.checkOpencodeRunning();
    if (!this.force) this.checkSchemaVersion();

    if (this.direction === 'host-to-sandbox' || this.direction === 'both') {
      this.syncDB(this.HOST_DB, this.SANDBOX_DB, 'Host → Sandbox');
    }
    if (this.direction === 'sandbox-to-host' || this.direction === 'both') {
      this.syncDB(this.SANDBOX_DB, this.HOST_DB, 'Sandbox → Host');
    }

    if (!this.noSnapshot) this.syncDir('snapshot',
      path.join(os.homedir(), '.local/share/opencode/snapshot'),
      path.join(this.SANDBOX_VOLUME_BASE, 'share/opencode/snapshot'));
    if (!this.noToolOutput) this.syncDir('tool-output',
      path.join(os.homedir(), '.local/share/opencode/tool-output'),
      path.join(this.SANDBOX_VOLUME_BASE, 'share/opencode/tool-output'));

    this.postSyncChecks();
    this.printSummary();
  }

  // ── Prereq checks ──

  private checkSqlite3(): void {
    try {
      execSync('sqlite3 --version', { stdio: 'pipe' });
    } catch {
      console.error('❌ sqlite3 CLI를 찾을 수 없습니다. 설치 후 다시 실행하세요.');
      process.exit(1);
    }
  }

  private checkDbFiles(): void {
    for (const [p, label] of [[this.HOST_DB, 'Host DB'], [this.SANDBOX_DB, 'Sandbox DB']] as const) {
      if (!fs.existsSync(p)) {
        if (label === 'Sandbox DB') {
          console.warn(`  ⚠️ Sandbox DB 없음: ${p}`);
          console.warn('     샌드박스를 한 번 이상 실행해야 DB가 생성됩니다.');
          if (!this.force) process.exit(1);
        } else {
          console.error(`❌ ${label} 없음: ${p}`);
          process.exit(1);
        }
      } else {
        console.log(`  ✅ ${label}: ${p}`);
      }
    }
  }

  private checkSandboxContainer(): void {
    if (this.direction === 'host-to-sandbox' || this.direction === 'both') {
      try {
        execSync('docker compose -p scraper ps -q sandbox 2>/dev/null', { stdio: 'pipe' });
      } catch {
        console.warn('  ⚠️ 샌드박스 컨테이너가 실행 중이지 않습니다.');
        console.warn('     DB 파일이 없거나 오래된 상태일 수 있습니다.');
        if (!this.force) {
          console.error('     (task agents:sandbox:up 실행 후 다시 시도하거나 --force로 무시)');
          process.exit(1);
        }
      }
    }
  }

  private checkOpencodeRunning(): void {
    const check = (cmd: string, label: string): boolean => {
      try {
        const out = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        return out.length > 0;
      } catch { return false; }
    };

    const hostRunning = check('pgrep -x opencode 2>/dev/null || true', 'Host');
    let sandboxRunning = false;
    try {
      const out = execSync(
        'docker compose -p scraper exec -T sandbox bash -c "pgrep -x opencode 2>/dev/null || true" 2>/dev/null || true',
        { encoding: 'utf-8' }
      ).trim();
      sandboxRunning = out.length > 0;
    } catch { /* sandbox not running */ }

    if (hostRunning) {
      console.warn('  ⚠️ 호스트에서 opencode가 실행 중입니다. DB가 잠겨 동기화에 실패할 수 있습니다.');
      if (!this.force) {
        console.error('  ❌ opencode를 종료한 후 다시 실행하세요. (--force로 무시 가능)');
        process.exit(1);
      }
    }
    if (sandboxRunning) {
      console.warn('  ⚠️ 샌드박스에서 opencode가 실행 중입니다. DB가 잠겨 동기화에 실패할 수 있습니다.');
      if (!this.force) {
        console.error('  ❌ 샌드박스에서 opencode를 종료한 후 다시 실행하세요. (--force로 무시 가능)');
        process.exit(1);
      }
    }
    if (!hostRunning && !sandboxRunning) {
      console.log('  ✅ opencode 미실행 확인');
    }
  }

  private queryJson(db: string, sql: string): any[] {
    const out = execSync(`sqlite3 -json "${db}" "${sql}" 2>&1`, { encoding: 'utf-8', maxBuffer: 20 * 1024 * 1024 }).trim();
    if (!out) return [];
    return JSON.parse(out);
  }

  private checkSchemaVersion(): void {
    const host = this.queryJson(this.HOST_DB, 'SELECT name FROM data_migration ORDER BY name');
    const sandbox = this.queryJson(this.SANDBOX_DB, 'SELECT name FROM data_migration ORDER BY name');
    const hNames = host.map((r: any) => r.name);
    const sNames = sandbox.map((r: any) => r.name);
    if (JSON.stringify(hNames) !== JSON.stringify(sNames)) {
      console.error('  ❌ DB 스키마 버전 불일치');
      console.error(`     Host:     ${hNames.join(', ')}`);
      console.error(`     Sandbox:  ${sNames.join(', ')}`);
      console.error('     opencode 버전이 다른 경우 발생합니다.');
      if (!this.force) {
        console.error('     버전을 일치시키거나 --force로 무시하세요.');
        process.exit(1);
      }
    } else {
      console.log('  ✅ DB 스키마 버전 일치');
    }
  }

  private walCheckpointOne(path: string, label: string): void {
    try {
      execSync(`sqlite3 "${path}" "PRAGMA wal_checkpoint(TRUNCATE);"`, { encoding: 'utf-8' });
    } catch {
      try {
        execSync(`sqlite3 "${path}" "PRAGMA wal_checkpoint;"`, { encoding: 'utf-8' });
      } catch { /* ignore */ }
    }
  }

  private walCheckpointAll(): void {
    console.log('\n📋 WAL 체크포인트...');
    this.walCheckpointOne(this.HOST_DB, 'Host');
    this.walCheckpointOne(this.SANDBOX_DB, 'Sandbox');
    console.log('  ✅ WAL flush 완료');
  }

  // ── DB sync ──

  private syncDB(sourcePath: string, targetPath: string, label: string): void {
    console.log(`\n📦 DB 동기화: ${label}`);

    const srcCount = this.queryJson(sourcePath, 'SELECT COUNT(*) as c FROM session')[0]?.c ?? 0;
    const tgtCount = this.queryJson(targetPath, 'SELECT COUNT(*) as c FROM session')[0]?.c ?? 0;
    console.log(`  Source: ${srcCount} 세션, Target: ${tgtCount} 세션`);

    if (this.dryRun) {
      // Compare sessions
      const srcSessions = this.queryJson(sourcePath, 'SELECT id, title, time_updated FROM session ORDER BY time_updated DESC');
      const tgtSessions = new Set(this.queryJson(targetPath, 'SELECT id FROM session').map((r: any) => r.id));
      const newSessions = srcSessions.filter((s: any) => !tgtSessions.has(s.id));
      const updateCandidates = srcSessions.filter((s: any) => {
        if (!tgtSessions.has(s.id)) return false;
        const tgt = this.queryJson(targetPath, `SELECT time_updated FROM session WHERE id = '${s.id}'`);
        return tgt.length > 0 && s.time_updated > tgt[0].time_updated;
      });
      console.log(`  [Dry-run] 추가될 세션: ${newSessions.length}개`);
      console.log(`  [Dry-run] 갱신될 세션: ${updateCandidates.length}개`);
      return;
    }

    const safeSrc = sourcePath.replace(/'/g, "''");
    const sql = `
ATTACH DATABASE '${safeSrc}' AS src;
BEGIN IMMEDIATE;

INSERT OR IGNORE INTO project(id, worktree, vcs, name, icon_url, icon_url_override, icon_color, time_created, time_updated, time_initialized, sandboxes, commands)
SELECT id, worktree, vcs, name, icon_url, icon_url_override, icon_color, time_created, time_updated, time_initialized, sandboxes, commands FROM src.project;

INSERT OR IGNORE INTO project_directory(project_id, directory, type, strategy, time_created)
SELECT project_id, directory, type, strategy, time_created FROM src.project_directory WHERE project_id IN (SELECT id FROM project);

INSERT OR IGNORE INTO workspace(id, type, name, branch, directory, extra, project_id, time_used)
SELECT w.id, w.type, w.name, w.branch, w.directory, w.extra,
  COALESCE((SELECT tp.id FROM project tp WHERE tp.worktree = (SELECT sp.worktree FROM src.project sp WHERE sp.id = w.project_id)), w.project_id),
  w.time_used
FROM src.workspace w;

CREATE TEMP TABLE _stats (k TEXT PRIMARY KEY, v INTEGER DEFAULT 0);

CREATE TEMP TABLE _up AS
SELECT s.id FROM src.session s WHERE s.id IN (SELECT id FROM session) AND s.time_updated > (SELECT time_updated FROM session WHERE id = s.id);
INSERT OR REPLACE INTO _stats VALUES ('updated', (SELECT COUNT(*) FROM _up));

DELETE FROM todo WHERE session_id IN (SELECT id FROM _up);
DELETE FROM session_share WHERE session_id IN (SELECT id FROM _up);
DELETE FROM session_context_epoch WHERE session_id IN (SELECT id FROM _up);
DELETE FROM session_input WHERE session_id IN (SELECT id FROM _up);
DELETE FROM part WHERE session_id IN (SELECT id FROM _up);
DELETE FROM message WHERE session_id IN (SELECT id FROM _up);
DELETE FROM session_message WHERE session_id IN (SELECT id FROM _up);
DELETE FROM session WHERE id IN (SELECT id FROM _up);
DROP TABLE _up;

INSERT OR IGNORE INTO session(id, project_id, workspace_id, parent_id, slug, directory, path, title, version, share_url, summary_additions, summary_deletions, summary_files, summary_diffs, metadata, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, revert, permission, agent, model, time_created, time_updated, time_compacting, time_archived)
SELECT s.id,
  COALESCE((SELECT tp.id FROM project tp WHERE tp.worktree = (SELECT sp.worktree FROM src.project sp WHERE sp.id = s.project_id)), s.project_id),
  NULLIF(s.workspace_id, ''), s.parent_id, s.slug, s.directory, s.path, s.title, s.version, s.share_url,
  s.summary_additions, s.summary_deletions, s.summary_files, s.summary_diffs,
  s.metadata, s.cost, s.tokens_input, s.tokens_output, s.tokens_reasoning,
  s.tokens_cache_read, s.tokens_cache_write, s.revert, s.permission, s.agent, s.model,
  s.time_created, s.time_updated, s.time_compacting, s.time_archived
FROM src.session s WHERE s.id NOT IN (SELECT id FROM session);
INSERT OR REPLACE INTO _stats VALUES ('added', changes());

INSERT OR IGNORE INTO session_message(id, session_id, type, seq, time_created, time_updated, data)
SELECT id, session_id, type, seq, time_created, time_updated, data FROM src.session_message WHERE session_id IN (SELECT id FROM session);
INSERT OR IGNORE INTO message(id, session_id, time_created, time_updated, data)
SELECT id, session_id, time_created, time_updated, data FROM src.message WHERE session_id IN (SELECT id FROM session);
INSERT OR IGNORE INTO part(id, message_id, session_id, time_created, time_updated, data)
SELECT id, message_id, session_id, time_created, time_updated, data FROM src.part WHERE session_id IN (SELECT id FROM session);
INSERT OR IGNORE INTO session_input(id, session_id, prompt, delivery, admitted_seq, promoted_seq, time_created)
SELECT id, session_id, prompt, delivery, admitted_seq, promoted_seq, time_created FROM src.session_input WHERE session_id IN (SELECT id FROM session);
INSERT OR IGNORE INTO session_context_epoch(session_id, baseline, snapshot, baseline_seq)
SELECT session_id, baseline, snapshot, baseline_seq FROM src.session_context_epoch WHERE session_id IN (SELECT id FROM session);
INSERT OR IGNORE INTO todo(session_id, content, status, priority, position, time_created, time_updated)
SELECT session_id, content, status, priority, position, time_created, time_updated FROM src.todo WHERE session_id IN (SELECT id FROM session);
INSERT OR IGNORE INTO session_share(session_id, id, secret, url, time_created, time_updated)
SELECT session_id, id, secret, url, time_created, time_updated FROM src.session_share WHERE session_id IN (SELECT id FROM session);

INSERT OR IGNORE INTO data_migration(name, time_completed)
SELECT name, time_completed FROM src.data_migration WHERE name NOT IN (SELECT name FROM data_migration);

SELECT 'UPDATED:' || COALESCE((SELECT v FROM _stats WHERE k = 'updated'), 0);
SELECT 'ADDED:' || COALESCE((SELECT v FROM _stats WHERE k = 'added'), 0);
DROP TABLE IF EXISTS _stats;

COMMIT;
DETACH src;
`;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-sync-'));
    const sqlFile = path.join(tmpDir, 'sync.sql');
    fs.writeFileSync(sqlFile, sql);
    try {
      const out = execSync(`sqlite3 "${targetPath}" < "${sqlFile}" 2>&1`, { encoding: 'utf-8', maxBuffer: 200 * 1024 * 1024 });
      const errLines = out.split('\n').filter((l: string) => l.startsWith('Runtime error') || l.startsWith('Error:'));
      if (errLines.length > 0) {
        console.error(`  ❌ SQL 오류 (${label}):`, errLines[0]);
        this.stats.errors++;
      } else {
        let added = 0, updated = 0;
        for (const line of out.split('\n')) {
          const am = line.match(/^ADDED:(\d+)$/);
          if (am) added = parseInt(am[1], 10);
          const um = line.match(/^UPDATED:(\d+)$/);
          if (um) updated = parseInt(um[1], 10);
        }
        this.stats.sessionsAdded += added;
        this.stats.sessionsUpdated += updated;
        const after = this.queryJson(targetPath, 'SELECT COUNT(*) as c FROM session')[0]?.c ?? 0;
        console.log(`  ✅ 완료 (${label}): +${added} 추가, ${updated} 갱신, 총 ${after} 세션`);
      }
    } catch (err: any) {
      console.error(`  ❌ 동기화 실패 (${label}):`, err.message);
      // Show actual SQLite error output
      try {
        const stderr = (err as any).stdout || (err as any).stderr || '';
        if (stderr) console.error(`     ${stderr.split('\n')[0]}`);
      } catch { /* ignore */ }
      this.stats.errors++;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // ── File sync ──

  private syncDir(name: string, src: string, dest: string): void {
    console.log(`\n📁 파일 동기화: ${name}/`);

    if (!fs.existsSync(src)) {
      console.log(`  ⏭️  ${src} 없음, 건너뜁니다.`);
      return;
    }

    if (this.dryRun) {
      try {
        const count = execSync(`find "${src}" -type f 2>/dev/null | wc -l | tr -d ' '`, { encoding: 'utf-8' }).trim();
        console.log(`  [Dry-run] ${count}개 파일 → ${dest}`);
      } catch {
        console.log(`  [Dry-run] 파일 동기화 예정: ${src} → ${dest}`);
      }
      return;
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      const out = execSync(`rsync -a --ignore-existing "${src}/" "${dest}/" 2>&1`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
      const added = out.split('\n').filter(l => l.length > 0 && !l.endsWith('/') && l !== '.').length;
      this.stats.filesCopied += added;
      console.log(`  ✅ ${added}개 파일 동기화 완료`);
    } catch (err: any) {
      console.error(`  ❌ 파일 동기화 실패: ${err.message}`);
      this.stats.errors++;
    }
  }

  // ── Post-sync checks ──

  private postSyncChecks(): void {
    console.log('\n🔍 사후 검증...');
    this.walCheckpointOne(this.HOST_DB, 'Host');
    this.walCheckpointOne(this.SANDBOX_DB, 'Sandbox');

    for (const [p, label] of [[this.HOST_DB, 'Host'], [this.SANDBOX_DB, 'Sandbox']] as const) {
      try {
        const out = execSync(`sqlite3 "${p}" "PRAGMA integrity_check;" 2>&1`, { encoding: 'utf-8' }).trim();
        if (out === 'ok') {
          console.log(`  ✅ DB 무결성 검증: ${label}`);
        } else {
          console.error(`  ❌ DB 무결성 오류 (${label}): ${out.slice(0, 200)}`);
          this.stats.errors++;
        }
      } catch (err: any) {
        console.error(`  ❌ DB 검증 실패 (${label}): ${err.message}`);
        this.stats.errors++;
      }
    }
  }

  private printSummary(): void {
    console.log('\n' + '='.repeat('='.length + 24));
    console.log('📊 동기화 결과 요약');
    console.log('='.repeat(36));
    console.log(`  추가된 세션:    ${this.stats.sessionsAdded}`);
    console.log(`  갱신된 세션:    ${this.stats.sessionsUpdated}`);
    console.log(`  복사된 파일:    ${this.stats.filesCopied}`);
    console.log(`  오류:           ${this.stats.errors}`);
    console.log('='.repeat(36));
    if (this.dryRun) console.log('\n💡 --dry-run 모드입니다. 실제 변경은 없었습니다.');
    if (this.stats.errors > 0) process.exit(1);
    console.log('✅ 동기화 완료');
  }
}

// ==============================================================================
// 6. CodexSyncer (양방향 동기화 호스트 ↔ 샌드박스 - Codex CLI)
// ==============================================================================

interface CodexSyncStats {
  direction: string;
  dbs: number;
  files: number;
  errors: number;
}

class CodexSyncer {
  private readonly HOST_DIR: string;
  private readonly SANDBOX_DIR: string;
  private readonly PROJECT_ROOT: string;

  private dryRun = false;
  private force = false;
  private direction: 'host-to-sandbox' | 'sandbox-to-host' | 'both' = 'both';

  private stats: CodexSyncStats = { direction: '', dbs: 0, files: 0, errors: 0 };

  constructor() {
    this.PROJECT_ROOT = path.resolve(__dirname, '../..');
    this.HOST_DIR = path.join(os.homedir(), '.codex');
    this.SANDBOX_DIR = path.join(this.PROJECT_ROOT, 'agents/.volumes/sandbox/codex');
  }

  public run(): void {
    const args = process.argv.slice(2);
    const dirArg = args.find(a => a.startsWith('--direction='));
    if (dirArg) this.direction = dirArg.split('=')[1] as typeof this.direction;
    this.dryRun = args.includes('--dry-run');
    this.force = args.includes('--force');

    console.log('🔄 Codex CLI 세션 동기화\n');

    this.checkDirs();
    this.checkOpencodeRunning();

    if (this.direction === 'host-to-sandbox' || this.direction === 'both') {
      this.syncAll('host-to-sandbox');
    }
    if (this.direction === 'sandbox-to-host' || this.direction === 'both') {
      this.syncAll('sandbox-to-host');
    }

    this.printSummary();
  }

  private checkDirs(): void {
    for (const [d, label] of [[this.HOST_DIR, 'Host codex'], [this.SANDBOX_DIR, 'Sandbox codex']] as const) {
      if (fs.existsSync(d)) {
        console.log(`  ✅ ${label}: ${d}`);
      } else {
        console.warn(`  ⚠️ ${label} 없음: ${d}`);
      }
    }
  }

  private checkOpencodeRunning(): void {
    const check = (cmd: string, label: string): boolean => {
      try {
        const out = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        return out.length > 0;
      } catch { return false; }
    };
    const hostRunning = check('pgrep -x codex 2>/dev/null || true', 'Host');
    let sandboxRunning = false;
    try {
      const out = execSync(
        'docker compose -p scraper exec -T sandbox bash -c "pgrep -x codex 2>/dev/null || true" 2>/dev/null || true',
        { encoding: 'utf-8' }
      ).trim();
      sandboxRunning = out.length > 0;
    } catch { /* ignore */ }
    if (hostRunning) {
      console.warn('  ⚠️ 호스트에서 codex가 실행 중입니다.');
      if (!this.force) {
        console.error('  ❌ codex를 종료한 후 다시 실행하세요. (--force로 무시 가능)');
        process.exit(1);
      }
    }
    if (sandboxRunning) {
      console.warn('  ⚠️ 샌드박스에서 codex가 실행 중입니다.');
      if (!this.force) {
        console.error('  ❌ 샌드박스에서 codex를 종료한 후 다시 실행하세요. (--force로 무시 가능)');
        process.exit(1);
      }
    }
    if (!hostRunning && !sandboxRunning) console.log('  ✅ codex 미실행 확인');
  }

  private queryJson(db: string, sql: string): any[] {
    try {
      const out = execSync(`sqlite3 -json "${db}" "${sql}" 2>&1`, { encoding: 'utf-8', maxBuffer: 20 * 1024 * 1024 }).trim();
      return out ? JSON.parse(out) : [];
    } catch { return []; }
  }

  private syncAll(label: string): void {
    const isH2S = label === 'host-to-sandbox';
    const srcDir = isH2S ? this.HOST_DIR : this.SANDBOX_DIR;
    const tgtDir = isH2S ? this.SANDBOX_DIR : this.HOST_DIR;

    if (!fs.existsSync(srcDir) || !fs.existsSync(tgtDir)) {
      console.log(`\n📦 Codex 동기화: ${isH2S ? 'Host → Sandbox' : 'Sandbox → Host'}: 디렉토리 없음, 건너뜁니다.`);
      return;
    }

    console.log(`\n📦 Codex 동기화: ${isH2S ? 'Host → Sandbox' : 'Sandbox → Host'}`);

    // 1. SQLite DBs
    const dbFiles = ['logs_2.sqlite', 'state_5.sqlite', 'goals_1.sqlite', 'memories_1.sqlite'];
    for (const db of dbFiles) {
      this.syncSqliteDb(path.join(srcDir, db), path.join(tgtDir, db));
    }

    // 2. Rollout sessions + history + cache
    for (const rel of ['sessions', 'history.jsonl', '.codex-global-state.json', 'models_cache.json']) {
      this.syncFile(path.join(srcDir, rel), path.join(tgtDir, rel));
    }
  }

  private syncSqliteDb(src: string, tgt: string): void {
    const name = path.basename(src);
    if (!fs.existsSync(src)) {
      console.log(`  ⏭️  ${name}: source 없음`);
      return;
    }
    if (!fs.existsSync(tgt)) {
      if (this.dryRun) {
        console.log(`  [Dry-run] ${name}: 새로 복사`);
        return;
      }
      fs.mkdirSync(path.dirname(tgt), { recursive: true });
      fs.copyFileSync(src, tgt);
      console.log(`  ✅ ${name}: 새로 복사됨`);
      this.stats.dbs++;
      return;
    }

    if (this.dryRun) {
      const srcCount = this.queryJson(src, "SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name NOT LIKE '_sqlx_%'")[0]?.c ?? 0;
      console.log(`  [Dry-run] ${name}: ${srcCount}개 테이블 merge 예정`);
      return;
    }

    // ATTACH-based merge
    const safeSrc = src.replace(/'/g, "''");
    const tables = this.queryJson(src, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_sqlx_%'");
    if (tables.length === 0) { console.log(`  ⏭️  ${name}: sync 대상 테이블 없음`); return; }

    const tableNames = tables.map((r: any) => r.name);
    let sql = `ATTACH DATABASE '${safeSrc}' AS src;\nBEGIN IMMEDIATE;\n`;
    for (const tbl of tableNames) {
      sql += `INSERT OR IGNORE INTO ${tbl} SELECT * FROM src.${tbl};\n`;
    }
      sql += `INSERT OR IGNORE INTO _sqlx_migrations SELECT * FROM src._sqlx_migrations WHERE version NOT IN (SELECT version FROM _sqlx_migrations);\n`;
    sql += `COMMIT;\nDETACH src;\n`;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-codex-'));
    const sqlFile = path.join(tmpDir, 'sync.sql');
    fs.writeFileSync(sqlFile, sql);
    try {
      execSync(`sqlite3 "${tgt}" < "${sqlFile}" 2>&1`, { encoding: 'utf-8', maxBuffer: 200 * 1024 * 1024 });
      console.log(`  ✅ ${name}: ${tableNames.length}개 테이블 merge 완료`);
      this.stats.dbs++;
    } catch (err: any) {
      const msg = err?.stdout || err?.stderr || err.message || 'unknown error';
      console.error(`  ❌ ${name}: ${msg.split('\n')[0]}`);
      this.stats.errors++;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  private syncFile(src: string, tgt: string): void {
    const name = path.basename(src);
    if (!fs.existsSync(src)) {
      return;
    }

    if (this.dryRun) {
      console.log(`  [Dry-run] ${name}: 복사 예정`);
      return;
    }

    fs.mkdirSync(path.dirname(tgt), { recursive: true });
    if (fs.lstatSync(src).isDirectory()) {
      try {
        const out = execSync(`rsync -a --ignore-existing "${src}/" "${tgt}/" 2>&1`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
        const count = out.split('\n').filter(l => l && !l.endsWith('/') && l !== '.').length;
        console.log(`  ✅ ${name}/: ${count}개 파일 동기화 완료`);
        this.stats.files += count;
      } catch (err: any) {
        console.error(`  ❌ ${name}/: ${err.message}`);
        this.stats.errors++;
      }
    } else {
      if (fs.existsSync(tgt)) return; // skip existing files
      try {
        fs.copyFileSync(src, tgt);
        console.log(`  ✅ ${name}: 복사됨`);
        this.stats.files++;
      } catch (err: any) {
        console.error(`  ❌ ${name}: ${err.message}`);
        this.stats.errors++;
      }
    }
  }

  private printSummary(): void {
    console.log('\n' + '='.repeat(36));
    console.log('📊 Codex 동기화 결과');
    console.log('='.repeat(36));
    console.log(`  merge된 DB:   ${this.stats.dbs}`);
    console.log(`  복사된 파일:  ${this.stats.files}`);
    console.log(`  오류:         ${this.stats.errors}`);
    console.log('='.repeat(36));
    if (this.dryRun) console.log('\n💡 --dry-run 모드입니다.');
    if (this.stats.errors > 0) process.exit(1);
    console.log('✅ Codex 동기화 완료');
  }
}

// ==============================================================================
// 7. Session Pruner
// ==============================================================================
class SessionPruner {
  private readonly baseBrainDir: string;
  private readonly transcriptsDir: string;

  constructor(outputBase: string) {
    this.baseBrainDir = path.join(os.homedir(), '.gemini/antigravity-cli/brain');
    this.transcriptsDir = outputBase;
  }

  public run(): void {
    console.log('🧹 Pruning empty brain sessions...');
    let removed = 0;

    if (!fs.existsSync(this.baseBrainDir)) {
      console.log('ℹ️  No brain directory found.');
      return;
    }

    const brainSessions = fs.readdirSync(this.baseBrainDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== 'scratch' && d.name !== '.system_generated')
      .map(d => d.name);

    for (const sessionId of brainSessions) {
      const brainDir = path.join(this.baseBrainDir, sessionId);
      const logsDir = path.join(brainDir, '.system_generated/logs');
      const transcriptPath = path.join(logsDir, 'transcript_full.jsonl');

      if (fs.existsSync(transcriptPath)) {
        console.log(`  ✅ Keep (has data): ${sessionId}`);
        continue;
      }

      this.removeDir(brainDir, `🧠 Empty session removed: ${sessionId}`);
      removed++;

      const transcriptDir = path.join(this.transcriptsDir, sessionId);
      const transcriptFile = path.join(this.transcriptsDir, sessionId, 'session.md');
      if (fs.existsSync(transcriptDir)) {
        fs.rmSync(transcriptDir, { recursive: true, force: true });
        console.log(`     📄 Also removed: agents/data/sessions/${sessionId}/`);
      }
      if (fs.existsSync(transcriptFile)) {
        fs.rmSync(transcriptFile, { force: true });
        console.log(`     📄 Also removed: agents/data/sessions/${sessionId}/session.md`);
      }
    }

    if (removed === 0) {
      console.log('✅ Nothing to prune.');
    } else {
      console.log(`✨ Pruned ${removed} empty session(s) from brain.`);
    }
  }

  private removeDir(dirPath: string, label: string): void {
    if (!fs.existsSync(dirPath)) return;
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      console.log(`  🗑️  ${label}`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`  ❌ Failed to remove ${dirPath}: ${errMsg}`);
    }
  }
}

// ==============================================================================
// CLI Main Entrypoint
// ==============================================================================
if (require.main === module) {
    const args = process.argv.slice(2);
  const allMode = args.includes('--all') || args.includes('-a');

  const hasSync = args.includes('--sync') || args.includes('-y');
  
  // Sync mode is exclusive
  if (hasSync) {
    const runOpenCode = !args.includes('--codex') || args.includes('--opencode');
    const runCodex = args.includes('--codex');
    const dryRun = args.includes('--dry-run') || args.includes('--noop');
    if (runOpenCode) {
      const syncer = new SessionSyncer();
      if (dryRun) process.argv.push('--dry-run');
      syncer.run();
    }
    if (runCodex) {
      const syncer = new CodexSyncer();
      if (dryRun) process.argv.push('--dry-run');
      syncer.run();
    }
    process.exit(0);
  }
  
  const hasTranscript = args.includes('--transcript') || args.includes('-t');
  const hasContext = args.includes('--context') || args.includes('-c');
  const hasBrain = args.includes('--brain') || args.includes('-b');
  const hasSysinfo = args.includes('--sysinfo') || args.includes('-s');
  const hasPrune = args.includes('--prune') || args.includes('-p');
  
  // Default to running everything (all dumps) if no specific target option is provided (and --prune is not requested explicitly)
  const runAllDumps = args.includes('--all-targets') || (!hasTranscript && !hasContext && !hasBrain && !hasSysinfo && !hasPrune);

  const agentFlag = args.find(a => a.startsWith('--agent='));
  const agents = agentFlag ? parseAgentsFromArg(agentFlag.split('=')[1]) : ['agy'];

  // Parse output directory option
  let outputBase = path.join(__dirname, '../data/sessions');
  const outputFlag = args.find(a => a.startsWith('--output='));
  if (outputFlag) {
    outputBase = outputFlag.split('=')[1];
  } else {
    const outputIdx = args.indexOf('--output');
    if (outputIdx !== -1 && outputIdx + 1 < args.length) {
      outputBase = args[outputIdx + 1];
    }
  }

  if (runAllDumps || hasSysinfo) {
    console.log('🤖 Running Sysinfo Dumper...');
    new SysInfoDumper(outputBase).run();
  }

  for (const agentName of agents) {
    try {
      if (runAllDumps || hasTranscript) {
        console.log(`📝 Running Transcript Dumper for ${agentName}...`);
        new TranscriptDumper(agentName, outputBase, allMode).dumpAll();
      }
      
      if (runAllDumps || hasBrain) {
        console.log(`🧠 Running Brain Dumper for ${agentName}...`);
        new BrainDumper(agentName, outputBase, allMode).dump();
      }

      if (runAllDumps || hasContext) {
        console.log(`🧠 Running Context Dumper for ${agentName}...`);
        new ContextDumper(agentName, outputBase, allMode).dump();
      }
    } catch (err: any) {
      console.error(`❌ Error during dump execution for ${agentName}:`, err.message);
      if (process.exitCode === undefined) process.exitCode = 1;
    }
  }

  if (hasPrune) {
    new SessionPruner(outputBase).run();
  }

  if (process.exitCode !== 1) {
    console.log('✅ Done.');
  }
}
