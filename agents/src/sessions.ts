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
// 5. Session Pruner
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
        console.log(`     📄 Also removed: data/agents/${sessionId}/`);
      }
      if (fs.existsSync(transcriptFile)) {
        fs.rmSync(transcriptFile, { force: true });
        console.log(`     📄 Also removed: data/agents/${sessionId}/session.md`);
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
  let outputBase = path.join(__dirname, '../../data/agents');
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
