/**
 * @module agent_adapter
 * @description Provides unified adapters to fetch and query session information from agy, codex, and opencode sessions.
 * @constraints
 *   - Strictly typed, avoiding 'any' except where library-specific types are undefined.
 *   - Dynamically resolves log paths and queries SQLite databases.
 * @dependencies Node fs/path/os/sqlite, IConverter
 * @lastUpdated 2026-06-11
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

export interface AgentSession {
  id: string;
  title: string;
  agent: string | null;
  model: string | null;
  timeCreated: number;
  timeUpdated: number;
  tokensInput: number;
  tokensOutput: number;
  tokensReasoning: number;
  cost: number;
}

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls: AgentToolCall[];
  stepIndex: number;
}

export interface AgentToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
}

export interface SessionDetail {
  session: AgentSession;
  messages: AgentMessage[];
  taskLogs?: { id: string; localPath: string }[];
  sessionDir?: string;
}

export interface AgentAdapter {
  getName(): string;
  getSessions(all: boolean): AgentSession[];
  getSessionDetail(sessionId: string): SessionDetail;
  baseBrainDir?: string;
}

interface LogToolCall {
  name?: string;
  tool?: string;
  args?: Record<string, unknown>;
  arguments?: Record<string, unknown>;
  input?: Record<string, unknown>;
  result?: string;
  output?: string;
}

interface LogStep {
  type: string;
  source?: string;
  content?: string;
  tool_calls?: LogToolCall[];
}

interface CodexLogRow {
  id: number;
  ts: number;
  ts_nanos: number;
  level: string;
  target: string;
  feedback_log_body: string | null;
  thread_id: string | null;
}

interface CodexSessionRow {
  id: string;
  first_ts: number;
  last_ts: number;
}

// ─── agy adapter ──────────────────────────────────────────

class AgyAdapter implements AgentAdapter {
  public readonly baseBrainDir: string;

  constructor() {
    this.baseBrainDir = path.join(os.homedir(), '.gemini/antigravity-cli/brain');
  }

  getName(): string { return 'agy'; }

  getSessions(all: boolean): AgentSession[] {
    const cliBrainDir = path.join(os.homedir(), '.gemini/antigravity-cli/brain');
    const ideBrainDir = path.join(os.homedir(), '.gemini/antigravity-ide/brain');
    const dirs: { name: string; fullPath: string; mtime: number }[] = [];

    [cliBrainDir, ideBrainDir].forEach(baseDir => {
      if (fs.existsSync(baseDir)) {
        try {
          fs.readdirSync(baseDir).forEach(name => {
            const fullPath = path.join(baseDir, name);
            try {
              if (fs.statSync(fullPath).isDirectory() && name !== 'scratch' && name !== '.system_generated') {
                dirs.push({
                  name,
                  fullPath,
                  mtime: fs.statSync(fullPath).mtimeMs,
                });
              }
            } catch { /* skip */ }
          });
        } catch { /* skip */ }
      }
    });

    if (dirs.length === 0) throw new Error('No agy sessions found in cli or ide brain directories.');

    dirs.sort((a, b) => b.mtime - a.mtime);

    const selected = all ? dirs : [dirs[0]];
    return selected.map(d => ({
      id: d.name,
      title: d.name,
      agent: 'agy',
      model: null,
      timeCreated: d.mtime,
      timeUpdated: d.mtime,
      tokensInput: 0,
      tokensOutput: 0,
      tokensReasoning: 0,
      cost: 0,
    }));
  }

  getSessionDetail(sessionId: string): SessionDetail {
    const cliBrainDir = path.join(os.homedir(), '.gemini/antigravity-cli/brain');
    const ideBrainDir = path.join(os.homedir(), '.gemini/antigravity-ide/brain');
    let logPath = '';
    let foundBaseDir = '';

    for (const baseDir of [cliBrainDir, ideBrainDir]) {
      for (const logName of ['transcript_full.jsonl', 'transcript.jsonl']) {
        const p = path.join(baseDir, sessionId, '.system_generated/logs', logName);
        if (fs.existsSync(p)) {
          logPath = p;
          foundBaseDir = baseDir;
          break;
        }
      }
      if (logPath) break;
    }

    if (!logPath) {
      throw new Error(`Transcript log not found for session ${sessionId} in cli or ide directories.`);
    }

    const lines = fs.readFileSync(logPath, 'utf-8').split('\n').filter(Boolean);
    const messages: AgentMessage[] = [];
    let stepIndex = 0;
    let lastAssistantMsg: AgentMessage | null = null;

    lines.forEach((line) => {
      try {
        const step = JSON.parse(line) as LogStep;
        if (step.type === 'USER_INPUT') {
          messages.push({ role: 'user', content: step.content || '', toolCalls: [], stepIndex: stepIndex++ });
          lastAssistantMsg = null;
        } else if (step.type === 'PLANNER_RESPONSE') {
          const toolCalls: AgentToolCall[] = (step.tool_calls || []).map((t: LogToolCall) => ({
            name: t.name || t.tool || 'unknown',
            arguments: t.args || t.arguments || t.input || {},
          }));
          const newMsg: AgentMessage = { role: 'assistant', content: step.content || '', toolCalls, stepIndex: stepIndex++ };
          messages.push(newMsg);
          lastAssistantMsg = newMsg;
        } else if (step.type === 'SYSTEM_MESSAGE' || step.source === 'SYSTEM') {
          const content = step.content || '';
          const taskMatch = content.match(/task-\d+/);
          if (taskMatch) {
            const taskId = taskMatch[0];
            const resultIdx = content.indexOf('finished with result:');
            if (resultIdx !== -1) {
              const logFile = path.join(foundBaseDir, sessionId, '.system_generated', 'tasks', `${taskId}.log`);
              let taskResult = '';
              if (fs.existsSync(logFile)) {
                taskResult = fs.readFileSync(logFile, 'utf-8');
              } else {
                taskResult = content.substring(resultIdx + 'finished with result:'.length).trim();
              }
              for (const msg of messages) {
                if (msg.role === 'assistant' && msg.toolCalls) {
                  const matchingTool = msg.toolCalls.find(tc => 
                    tc.name === 'run_command' && 
                    tc.result && 
                    tc.result.includes(taskId)
                  );
                  if (matchingTool) {
                    matchingTool.result = `[Background Task ${taskId} finished]\n${taskResult}`;
                  }
                }
              }
            }
          }
        } else {
          if (lastAssistantMsg && lastAssistantMsg.toolCalls.length > 0) {
            const pendingTool = lastAssistantMsg.toolCalls.find(tc => tc.result === undefined);
            if (pendingTool) {
              pendingTool.result = step.content || '';
            }
          }
        }
      } catch { /* skip malformed lines */ }
    });

    const session: AgentSession = {
      id: sessionId,
      title: sessionId,
      agent: 'agy',
      model: null,
      timeCreated: Date.now(),
      timeUpdated: Date.now(),
      tokensInput: 0,
      tokensOutput: 0,
      tokensReasoning: 0,
      cost: 0,
    };

    return { session, messages, sessionDir: path.join(foundBaseDir, sessionId) };
  }
}

// ─── codex adapter ─────────────────────────────────────────
// ─── Primary: rollout JSONL (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl)
// ─── Fallback: SQLite logs_2.sqlite (for sessions without JSONL files)

class CodexAdapter implements AgentAdapter {
  public readonly baseBrainDir: string;
  private readonly dbPath: string;
  private readonly sessionsDir: string;

  constructor() {
    this.baseBrainDir = path.join(os.homedir(), '.codex');
    this.dbPath = path.join(this.baseBrainDir, 'logs_2.sqlite');
    this.sessionsDir = path.join(this.baseBrainDir, 'sessions');
  }

  getName(): string { return 'codex'; }

  private isDir(p: string): boolean {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
  }

  private getFileMtime(p: string): number {
    try { return fs.statSync(p).mtimeMs; } catch { return Date.now(); }
  }

  // ── Session metadata from rollout JSONL first line ──

  private parseSessionMetaFromRollout(filePath: string): {
    session_id: string; title: string; model: string; cwd: string;
    timeCreated: number; timeUpdated: number;
  } | null {
    const firstLine = fs.readFileSync(filePath, 'utf-8').split('\n')[0];
    if (!firstLine) return null;
    const obj = JSON.parse(firstLine);
    if (obj.type !== 'session_meta') return null;
    const p = obj.payload;
    if (typeof p !== 'object' || p === null) return null;
    const sid = p.session_id || null;
    if (!sid) return null;
    const model = p.model || '';
    const cwd = p.cwd || '';
    const ts = p.timestamp || '';
    const timeCreated = ts ? new Date(ts).getTime() : this.getFileMtime(filePath);
    const timeUpdated = this.getFileMtime(filePath);
    const title = `Codex: ${path.basename(filePath).replace(/^rollout-/, '').replace(/\.jsonl$/, '')}`;
    return { session_id: sid, title, model, cwd, timeCreated, timeUpdated };
  }

  // ── Scan ~/.codex/sessions/ for rollout JSONL files ──

  private gatherRolloutSessions(): Map<string, AgentSession> {
    const result = new Map<string, AgentSession>();
    if (!fs.existsSync(this.sessionsDir)) return result;
    for (const year of fs.readdirSync(this.sessionsDir)) {
      const yd = path.join(this.sessionsDir, year);
      if (!this.isDir(yd)) continue;
      for (const month of fs.readdirSync(yd)) {
        const md = path.join(yd, month);
        if (!this.isDir(md)) continue;
        for (const day of fs.readdirSync(md)) {
          const dd = path.join(md, day);
          if (!this.isDir(dd)) continue;
          for (const f of fs.readdirSync(dd).filter(x => x.startsWith('rollout-') && x.endsWith('.jsonl'))) {
            const fp = path.join(dd, f);
            try {
              const meta = this.parseSessionMetaFromRollout(fp);
              if (meta && !result.has(meta.session_id)) {
                result.set(meta.session_id, {
                  id: meta.session_id,
                  title: meta.title,
                  agent: 'codex',
                  model: meta.model || null,
                  timeCreated: meta.timeCreated,
                  timeUpdated: meta.timeUpdated,
                  tokensInput: 0, tokensOutput: 0, tokensReasoning: 0, cost: 0,
                });
              }
            } catch { /* skip corrupt */ }
          }
        }
      }
    }
    return result;
  }

  // ── SQLite session gathering (fallback) ──

  private getDb(): string {
    if (!fs.existsSync(this.dbPath)) throw new Error(`Codex log DB not found: ${this.dbPath}`);
    return this.dbPath;
  }

  private query<T>(sql: string): T[] {
    const d = this.getDb();
    const s = sql.replace(/"/g, '\\"');
    const out = execSync(`sqlite3 -json "${d}" "${s}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 20 * 1024 * 1024 }).trim();
    if (!out) return [];
    return JSON.parse(out) as T[];
  }

  private gatherSqliteSessions(): AgentSession[] {
    if (!fs.existsSync(this.dbPath)) return [];
    try {
      const rows = this.query<CodexSessionRow>(`
        SELECT thread_id as id, MIN(ts) as first_ts, MAX(ts) as last_ts, COUNT(*) as log_count
        FROM logs WHERE thread_id IS NOT NULL AND trim(thread_id) != ''
        GROUP BY thread_id ORDER BY last_ts DESC
      `);
      return rows.map(r => ({
        id: r.id,
        title: `Codex Session ${r.id}`,
        agent: 'codex',
        model: this.resolveModelFromConfig(),
        timeCreated: Number(r.first_ts || 0) * 1000,
        timeUpdated: Number(r.last_ts || 0) * 1000,
        tokensInput: 0, tokensOutput: 0, tokensReasoning: 0, cost: 0,
      }));
    } catch { return []; }
  }

  // ── Find rollout JSONL for a specific session ID ──

  private findRolloutFile(sessionId: string): string | null {
    if (!fs.existsSync(this.sessionsDir)) return null;
    for (const year of fs.readdirSync(this.sessionsDir)) {
      const yd = path.join(this.sessionsDir, year);
      if (!this.isDir(yd)) continue;
      for (const month of fs.readdirSync(yd)) {
        const md = path.join(yd, month);
        if (!this.isDir(md)) continue;
        for (const day of fs.readdirSync(md)) {
          const dd = path.join(md, day);
          if (!this.isDir(dd)) continue;
          for (const f of fs.readdirSync(dd)) {
            if (f.includes(sessionId) && f.endsWith('.jsonl')) {
              return path.join(dd, f);
            }
          }
        }
      }
    }
    return null;
  }

  // ── Extract text from response_item content array ──

  private extractTextFromContent(content: unknown): string {
    if (!Array.isArray(content) || content.length === 0) return '';
    const parts: string[] = [];
    for (const item of content) {
      if (item && typeof item.text === 'string') {
        parts.push(item.text);
      }
    }
    return parts.join('\n');
  }

  // ── Parse rollout JSONL into AgentMessage[] ──

  private parseRolloutSession(sessionId: string, filePath: string): SessionDetail {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
    const messages: AgentMessage[] = [];
    let stepIndex = 0;
    let sessionModel = '';

    const pendingToolCalls = new Map<string, AgentToolCall>();

    interface TurnState {
      userTexts: string[];
      assistantTexts: string[];
      toolCalls: AgentToolCall[];
    }

    let currentTurn: TurnState | null = null;
    const ensureTurn = (): TurnState => {
      if (!currentTurn) currentTurn = { userTexts: [], assistantTexts: [], toolCalls: [] };
      return currentTurn;
    };

    const emitTurn = (): void => {
      if (!currentTurn) return;
      const turn = currentTurn;
      for (const ut of turn.userTexts) {
        if (ut.trim()) messages.push({ role: 'user', content: ut.trim(), toolCalls: [], stepIndex: stepIndex++ });
      }
      const combined = turn.assistantTexts.join('\n\n').trim();
      if (combined || turn.toolCalls.length > 0) {
        messages.push({ role: 'assistant', content: combined, toolCalls: turn.toolCalls, stepIndex: stepIndex++ });
      }
      currentTurn = null;
    };

    for (const line of lines) {
      let obj: Record<string, unknown>;
      try { obj = JSON.parse(line) as Record<string, unknown>; } catch { continue; }

      const type = obj.type as string | undefined;
      const p = obj.payload;

      if (typeof p !== 'object' || p === null) continue;

      const payload = p as Record<string, unknown>;

      if (type === 'session_meta') {
        sessionModel = (payload.model as string) || sessionModel;
        continue;
      }

      if (type === 'turn_context') {
        emitTurn();
        ensureTurn();
        continue;
      }

      if (type !== 'response_item') continue;

      const innerType = payload.type as string | undefined;
      const role = payload.role as string | undefined;

      if (innerType === 'message' && role === 'user') {
        ensureTurn();
        const text = this.extractTextFromContent(payload.content);
        if (text) currentTurn!.userTexts.push(text);
        continue;
      }

      if (innerType === 'message' && role === 'assistant') {
        ensureTurn();
        const text = this.extractTextFromContent(payload.content);
        if (text) currentTurn!.assistantTexts.push(text);
        continue;
      }

      if (innerType === 'reasoning') continue;

      const name = payload.name as string | undefined;
      const callId = payload.call_id as string | undefined;

      if (innerType === 'tool_use' && name && callId) {
        ensureTurn();
        const args: Record<string, unknown> = { callId };
        if (payload.input !== undefined) args.input = payload.input;
        if (payload.arguments !== undefined) args.arguments = payload.arguments;
        const tc: AgentToolCall = { name, arguments: args };
        currentTurn!.toolCalls.push(tc);
        pendingToolCalls.set(callId, tc);
        continue;
      }

      if (callId && pendingToolCalls.has(callId)) {
        const tc = pendingToolCalls.get(callId)!;
        const output = (payload.output !== undefined ? String(payload.output) : '') ||
                       (payload.status !== undefined ? `Status: ${payload.status}` : '');
        if (output) tc.result = output;
        pendingToolCalls.delete(callId);
        continue;
      }
    }

    emitTurn();

    const firstUserMsg = messages.find(m => m.role === 'user');
    const title = firstUserMsg
      ? `Codex: ${firstUserMsg.content.slice(0, 60)}`
      : `Codex: ${sessionId.slice(0, 12)}`;

    const session: AgentSession = {
      id: sessionId, title, agent: 'codex',
      model: sessionModel || this.resolveModelFromConfig(),
      timeCreated: Date.now(), timeUpdated: Date.now(),
      tokensInput: 0, tokensOutput: 0, tokensReasoning: 0, cost: 0,
    };

    return { session, messages };
  }

  // ── Fallback: simplified SQLite parsing ──

  private parseSqliteSession(sessionId: string): SessionDetail {
    const rows = this.query<CodexLogRow>(`
      SELECT id, ts, ts_nanos, level, target, feedback_log_body, thread_id
      FROM logs WHERE thread_id = '${sessionId.replace(/'/g, "''")}'
      ORDER BY ts ASC, ts_nanos ASC, id ASC
    `);
    if (rows.length === 0) throw new Error(`Codex session not found: ${sessionId}`);

    const messages: AgentMessage[] = [];
    let stepIndex = 0;
    let firstUserText = '';

    const userTextFrom = (body: string): string => {
      const m = body.match(/UserInput \{ items: \[Text \{ text: "([\s\S]*?)", text_elements: \[\] \}\]/);
      return m ? m[1] : body;
    };
    const extractQT = (body: string): string => {
      const m = body.match(/OutputText \{ text: "([\s\S]*?)" \}/);
      return m ? m[1] : '';
    };

    for (const row of rows) {
      const body = (row.feedback_log_body || '').trim();
      if (!body) continue;
      if (body.includes('op: UserInput')) {
        if (!firstUserText) firstUserText = userTextFrom(body);
        messages.push({ role: 'user', content: userTextFrom(body), toolCalls: [], stepIndex: stepIndex++ });
        continue;
      }
      if (body.includes('role: "assistant"') && body.includes('OutputText { text: "')) {
        messages.push({ role: 'assistant', content: extractQT(body), toolCalls: [], stepIndex: stepIndex++ });
        continue;
      }
    }

    const session: AgentSession = {
      id: sessionId,
      title: firstUserText ? `Codex: ${firstUserText.slice(0, 60)}` : `Codex Session ${sessionId}`,
      agent: 'codex',
      model: this.resolveModelFromConfig(),
      timeCreated: Number(rows[0].ts || 0) * 1000,
      timeUpdated: Number(rows[rows.length - 1].ts || 0) * 1000,
      tokensInput: 0, tokensOutput: 0, tokensReasoning: 0, cost: 0,
    };
    return { session, messages };
  }

  private resolveModelFromConfig(): string {
    const cp = path.join(this.baseBrainDir, 'config.toml');
    if (!fs.existsSync(cp)) return 'gpt-5.4-mini';
    const c = fs.readFileSync(cp, 'utf-8');
    const m = c.match(/^\s*model\s*=\s*"([^"]+)"/m);
    return m ? m[1] : 'gpt-5.4-mini';
  }

  // ── Public API ──

  getSessions(all: boolean): AgentSession[] {
    const rollout = this.gatherRolloutSessions();
    const sqlite = this.gatherSqliteSessions();
    const merged = new Map<string, AgentSession>();
    for (const [id, s] of rollout) merged.set(id, s);
    for (const s of sqlite) { if (!merged.has(s.id)) merged.set(s.id, s); }
    const sorted = [...merged.values()].sort((a, b) => b.timeCreated - a.timeCreated);
    if (sorted.length === 0) throw new Error('No codex sessions found.');
    return all ? sorted : [sorted[0]];
  }

  getSessionDetail(sessionId: string): SessionDetail {
    const rf = this.findRolloutFile(sessionId);
    if (rf) return this.parseRolloutSession(sessionId, rf);
    return this.parseSqliteSession(sessionId);
  }
}

// ─── opencode adapter ──────────────────────────────────────

interface SQLiteSessionRow {
  id: string;
  title: string | null;
  time_created: number;
  time_updated: number;
  agent: string | null;
  model: string | null;
  tokens_input: number | null;
  tokens_output: number | null;
  tokens_reasoning: number | null;
  cost: number | null;
}

interface SQLiteMessageRow {
  id: string;
  data: string;
  time_created: number;
}

interface SQLitePartRow {
  data: string;
}

interface SQLiteDatabase {
  prepare(sql: string): {
    all(...args: unknown[]): unknown[];
    get(...args: unknown[]): unknown;
  };
  close(): void;
}

class OpencodeAdapter implements AgentAdapter {
  private dbPath: string;

  constructor() {
    this.dbPath = path.join(os.homedir(), '.local/share/opencode/opencode.db');
  }

  getName(): string { return 'opencode'; }

  private getDb(): SQLiteDatabase {
    // DatabaseSync is imported dynamically because it is only available in node standard library in specific runtimes.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sqlite = require('node:sqlite');
    return new sqlite.DatabaseSync(this.dbPath) as SQLiteDatabase;
  }

  getSessions(all: boolean): AgentSession[] {
    if (!fs.existsSync(this.dbPath)) {
      throw new Error(`opencode DB not found: ${this.dbPath}`);
    }

    const db = this.getDb();
    const rows = db.prepare(
      `SELECT id, title, time_created, time_updated, agent, model,
              tokens_input, tokens_output, tokens_reasoning, cost
       FROM session
       ORDER BY time_updated DESC`
    ).all() as SQLiteSessionRow[];

    db.close();

    const sessions: AgentSession[] = rows.map((r) => ({
      id: r.id,
      title: r.title || r.id,
      agent: r.agent,
      model: r.model ? (() => { try { return JSON.parse(r.model).id; } catch { return r.model; } })() : null,
      timeCreated: r.time_created,
      timeUpdated: r.time_updated,
      tokensInput: r.tokens_input || 0,
      tokensOutput: r.tokens_output || 0,
      tokensReasoning: r.tokens_reasoning || 0,
      cost: r.cost || 0,
    }));

    return all ? sessions : sessions.slice(0, 1);
  }

  getSessionDetail(sessionId: string): SessionDetail {
    const db = this.getDb();

    // Session info
    const sessionRow = db.prepare(
      `SELECT id, title, time_created, time_updated, agent, model,
              tokens_input, tokens_output, tokens_reasoning, cost
       FROM session WHERE id = ?`
    ).get(sessionId) as SQLiteSessionRow | undefined;

    if (!sessionRow) {
      db.close();
      throw new Error(`Session not found: ${sessionId}`);
    }

    const modelStr = sessionRow.model;
    const session: AgentSession = {
      id: sessionRow.id,
      title: sessionRow.title || sessionRow.id,
      agent: sessionRow.agent,
      model: modelStr ? (() => { try { return JSON.parse(modelStr).id; } catch { return modelStr; } })() : null,
      timeCreated: sessionRow.time_created,
      timeUpdated: sessionRow.time_updated,
      tokensInput: sessionRow.tokens_input || 0,
      tokensOutput: sessionRow.tokens_output || 0,
      tokensReasoning: sessionRow.tokens_reasoning || 0,
      cost: sessionRow.cost || 0,
    };

    // Messages
    const msgRows = db.prepare(
      `SELECT id, data, time_created FROM message WHERE session_id = ? ORDER BY time_created ASC`
    ).all(sessionId) as SQLiteMessageRow[];

    const messages: AgentMessage[] = [];
    let stepIndex = 0;

    msgRows.forEach((msgRow) => {
      interface MessageData {
        role?: string;
        content?: string;
      }
      const msgData = JSON.parse(msgRow.data || '{}') as MessageData;
      const role = msgData.role;

      if (role === 'user') {
        const parts = db.prepare(
          `SELECT data FROM part WHERE session_id = ? AND message_id = ? ORDER BY time_created ASC`
        ).all(sessionId, msgRow.id) as SQLitePartRow[];

        const texts = parts.map((p) => {
          try {
            interface PartData {
              text?: string;
            }
            const pd = JSON.parse(p.data) as PartData;
            return pd.text || '';
          } catch { return ''; }
        }).filter(Boolean);
        messages.push({ role: 'user', content: texts.join('\n') || msgData.content || '', toolCalls: [], stepIndex: stepIndex++ });
      }

      if (role === 'assistant') {
        const parts = db.prepare(
          `SELECT data FROM part WHERE session_id = ? AND message_id = ? ORDER BY time_created ASC`
        ).all(sessionId, msgRow.id) as SQLitePartRow[];

        const toolCalls: AgentToolCall[] = [];
        const contentParts: string[] = [];

        parts.forEach((p) => {
          try {
            interface PartData {
              type?: string;
              text?: string;
              tool?: string;
              state?: {
                input?: Record<string, unknown>;
                output?: string;
              };
            }
            const pd = JSON.parse(p.data) as PartData;
            if (pd.type === 'reasoning' || pd.type === 'text') {
              if (pd.text) contentParts.push(pd.text);
            }
            if (pd.type === 'tool') {
              const toolName = pd.tool || 'unknown';
              const input = pd.state?.input || {};
              const output = pd.state?.output || '';
              toolCalls.push({ name: toolName, arguments: input, result: output });
            }
          } catch { /* skip */ }
        });

        messages.push({ role: 'assistant', content: contentParts.join('\n'), toolCalls, stepIndex: stepIndex++ });
      }
    });

    db.close();
    return { session, messages };
  }
}

// ─── Factory ────────────────────────────────────────────────

export function createAdapter(agentName: string): AgentAdapter {
  switch (agentName) {
    case 'agy':
      return new AgyAdapter();
    case 'codex':
      return new CodexAdapter();
    case 'opencode':
      return new OpencodeAdapter();
    default:
      throw new Error(`Unknown agent: ${agentName}. Supported: agy, codex, opencode`);
  }
}

export function parseAgentsFromArg(raw: string): string[] {
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

// ─── Output path helpers ────────────────────────────────────

export function formatDateDir(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatTimeTag(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function assignSessionNumbers(sessions: AgentSession[]): Map<string, { dateDir: string; seqNum: string; tag: string }> {
  const result = new Map<string, { dateDir: string; seqNum: string; tag: string }>();

  sessions.forEach((s) => {
    const dateDir = formatDateDir(s.timeCreated);
    const timeTag = formatTimeTag(s.timeCreated);
    result.set(s.id, { dateDir, seqNum: '', tag: `${timeTag}_${s.id}` });
  });

  return result;
}
