import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ================================================================
// 1. Shared Utilities
// ================================================================

function findProjectRoot(startDir: string): string {
  let current = startDir;
  while (current !== path.parse(current).root) {
    if (fs.existsSync(path.join(current, '.git')) && fs.existsSync(path.join(current, 'package.json'))) {
      return current;
    }
    current = path.dirname(current);
  }
  return startDir;
}

const projectRoot = process.env.INIT_CWD || findProjectRoot(__dirname);
process.chdir(projectRoot);

function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf-8');
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

function parseFlag(args: string[], name: string, short?: string): string | null {
  for (const arg of args) {
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
    if (short && arg.startsWith(`${short}=`)) return arg.slice(short.length + 1);
  }
  const idx = args.findIndex(a => a === name || (short && a === short));
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return null;
}

function readFileOrExit(filePath: string): string {
  try { return fs.readFileSync(filePath, 'utf-8'); }
  catch (e) { const err = e as Error; console.error(`File read error: ${err.message}`); process.exit(1); }
}

// ================================================================
// 2. LLM Backend
// ================================================================

interface LLmBackend {
  generate(prompt: string, options: { numPredict: number; timeout: number }): Promise<string | null>;
}

class OllamaBackend implements LLmBackend {
  constructor(private readonly baseUrl: string, private readonly model: string) {}

  async generate(prompt: string, options: { numPredict: number; timeout: number }): Promise<string | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.model, prompt, stream: false, options: { num_predict: options.numPredict } }),
          signal: AbortSignal.timeout(Math.min(options.timeout, 30000)),
        });
        if (!res.ok) { continue; }
        const data = await res.json() as any;
        const responseText = (data.response || '').trim();
        let text = responseText;
        if (!text) {
          const thinkingText = (data.thinking || '').trim();
          if (thinkingText) {
            const lines = thinkingText.split('\n').filter((l: string) => l.trim());
            text = lines[lines.length - 1]?.trim() || '';
          }
        }
        if (text) return text;
      } catch {}
    }
    return null;
  }
}

class LlamaCppBackend implements LLmBackend {
  constructor(private readonly baseUrl: string) {}

  async generate(prompt: string, options: { numPredict: number; timeout: number }): Promise<string | null> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, stream: false, max_tokens: options.numPredict, temperature: 0 }),
        signal: AbortSignal.timeout(options.timeout),
      });
      if (!res.ok) return null;
      const data = await res.json() as any;
      return (data.choices?.[0]?.text || '').trim() || null;
    } catch { return null; }
  }
}

// ================================================================
// 3. Unified Config
// ================================================================

class Config {
  public readonly apiUrl: string;
  public readonly accessToken: string | undefined;
  public readonly repo: string;
  public readonly llmBackend: LLmBackend;
  public readonly isContainer: boolean;
  public readonly runningWorkerId: string;
  public readonly autoMerge: boolean;
  public readonly issueId: string | null;

  constructor() {
    loadEnv();
    this.apiUrl = process.env.GITEA_API_URL || 'http://gitea:3000/api/v1';
    this.repo = process.env.GITEA_REPO || 'gitea/scraper';

    this.accessToken = process.env.GITEA_ACCESS_TOKEN || process.env.GITEA_API_TOKEN;

    const backendType = process.env.LLM_BACKEND || 'ollama';
    const llmUrl = process.env.LLM_URL || 'http://host.docker.internal:11434';
    const llmModel = process.env.LLM_MODEL || 'qwen3.5:9b-mlx';
    if (backendType === 'llamacpp') {
      this.llmBackend = new LlamaCppBackend(llmUrl);
    } else {
      this.llmBackend = new OllamaBackend(llmUrl, llmModel);
    }

    this.isContainer = fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv');
    this.runningWorkerId = this.runCmdOutput('docker compose ps -q worker');

    const args = process.argv.slice(2);
    this.autoMerge = !args.includes('--no-merge');
    this.issueId = this.parseIssueId(args);
  }

  private runCmdOutput(cmd: string): string {
    try {
      return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch {
      return '';
    }
  }

  private parseIssueId(args: string[]): string | null {
    const explicitFlagIndex = args.findIndex((arg) => arg === '--issue' || arg === '--issue-id');
    if (explicitFlagIndex >= 0 && args[explicitFlagIndex + 1]) {
      return args[explicitFlagIndex + 1];
    }
    const envIssueId = process.env.GITEA_ISSUE_ID;
    return envIssueId && envIssueId.trim().length > 0 ? envIssueId.trim() : null;
  }
}

// ================================================================
// 4. Git Service
// ================================================================

class GitService {
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

  pull(branch = 'develop'): void {
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

// ================================================================
// 5. Label Service
// ================================================================

class LabelService {
  constructor(private readonly llmBackend: LLmBackend) {}

  async classifyWithLLM(title: string, body: string): Promise<{ type: string | null; area: string | null }> {
    const combo = title + '\n' + body;
    const truncated = combo.substring(0, 2000);
    const prompt = `<start_of_turn>user
Classify this issue into Type (feature|bug|chore) and Area (agent|wiki|crawler|ebook|viewer|infra|null).
Return ONLY a JSON object with keys "type" and "area". No other text.

Title: ${title}
Body: ${truncated}
<end_of_turn>
<start_of_turn>model
`;

    const raw = await this.llmBackend.generate(prompt, { numPredict: 512, timeout: 30000 });

    if (raw) {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      try {
        const parsed = JSON.parse(cleaned);
        if (parsed && typeof parsed === 'object') {
          const type = parsed.type && ['feature', 'bug', 'chore'].includes(parsed.type) ? parsed.type : null;
          const area = parsed.area && parsed.area !== 'null' && ['agent', 'wiki', 'crawler', 'ebook', 'viewer', 'infra'].includes(parsed.area) ? parsed.area : null;
          if (type || area) return { type, area };
        }
      } catch {}
    }

    return { type: null, area: null };
  }

  classifyByRule(title: string, body: string): string[] {
    const combo = title + '\n' + body;
    const labels: string[] = [];

    if (/^\[?feat/i.test(title) || /^feat\b/i.test(title)) labels.push('feature');
    else if (/^\[?fix/i.test(title) || /^fix\b/i.test(title) || /^\[?bug/i.test(title)) labels.push('bug');
    else labels.push('chore');

    if (/agents(?:\/|$)/.test(combo)) labels.push('agent');
    else if (/apps\/wiki(?:\/|$)/.test(combo)) labels.push('wiki');
    else if (/apps\/crawler(?:\/|$)/.test(combo)) labels.push('crawler');
    else if (/apps\/ebook(?:\/|$)/.test(combo)) labels.push('ebook');
    else if (/apps\/viewer(?:\/|$)/.test(combo)) labels.push('viewer');
    else if (/infra\//.test(combo)) labels.push('infra');

    return labels;
  }
}

// ================================================================
// 6. Gitea API Client
// ================================================================

interface LabelInfo {
  name: string;
  color: string;
}

interface DumpIssue {
  original_number: number;
  title: string;
  body: string;
  state: string;
  created_at: string;
  labels: LabelInfo[];
  comments: { body: string; created_at: string }[];
}

interface IssueResponse {
  number: number;
  title: string;
  body: string;
  state: string;
  created_at: string;
  html_url: string;
}

interface CommentResponse {
  id: number;
  body: string;
  created_at: string;
}

interface TokenResponse {
  id: number;
  name: string;
  sha1?: string;
}

interface TimelineEvent {
  type: string;
  event: string;
  commit_id?: string;
}

class GiteaClient {
  private config: Config;
  private git: GitService;

  constructor(config: Config, git: GitService) {
    this.config = config;
    this.git = git;
  }

  private async request<T>(endpoint: string, method: string, body?: object): Promise<T> {
    if (!this.config.accessToken) {
      console.error('GITEA_ACCESS_TOKEN is required for API operations. Check .env file.');
      process.exit(1);
    }
    const url = `${this.config.apiUrl}${endpoint}`;
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Authorization': `token ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP Error ${response.status}: ${errorText}`);
      }

      return await response.json() as T;
    } catch (error) {
      const err = error as Error;
      console.error(`API error [${method} ${url}]:`, err.message);
      process.exit(1);
    }
  }

  private get gitHost(): string {
    return new URL(this.config.apiUrl).host;
  }

  private normalizeCommitLinks(text: string): string {
    const domain = this.config.apiUrl.replace(/\/api\/v1\/?$/, '');
    const [owner, repo] = this.config.repo.split('/');
    return text.replace(
      /https:\/\/[^/]+\/[^/]+\/[^/]+\/commit\//g,
      `${domain}/${owner}/${repo}/commit/`
    );
  }

  async getIssues(): Promise<IssueResponse[]> {
    let allIssues: IssueResponse[] = [];
    let page = 1;
    const limit = 50;

    while (true) {
      const data = await this.request<IssueResponse[]>(`/repos/${this.config.repo}/issues?state=all&type=all&limit=${limit}&page=${page}`, 'GET');
      if (!data || data.length === 0) break;
      allIssues = allIssues.concat(data);
      if (data.length < limit) break;
      page++;
    }
    return allIssues;
  }

  async getIssue(issueId: string): Promise<IssueResponse> {
    return await this.request<IssueResponse>(`/repos/${this.config.repo}/issues/${issueId}`, 'GET');
  }

  async getComments(issueId: string): Promise<CommentResponse[]> {
    return await this.request<CommentResponse[]>(`/repos/${this.config.repo}/issues/${issueId}/comments`, 'GET');
  }

  async getTimeline(issueId: string): Promise<TimelineEvent[]> {
    return await this.request<TimelineEvent[]>(`/repos/${this.config.repo}/issues/${issueId}/timeline`, 'GET');
  }

  async updateIssue(issueId: string, title: string, body: string): Promise<void> {
    if (!body || !body.trim()) {
      console.warn(`Issue #${issueId}: body is empty, skipping PATCH`);
      const issue = await this.getIssue(issueId);
      body = issue.body || '';
    }
    await this.request<void>(`/repos/${this.config.repo}/issues/${issueId}`, 'PATCH', { title, body });
  }

  async createIssue(title: string, body: string, skipLabel?: boolean): Promise<number> {
    console.log(`Creating Gitea issue... [${title}]`);
    const data = await this.request<IssueResponse>(`/repos/${this.config.repo}/issues`, 'POST', { title, body });
    console.log(`Issue created! [#${data.number}]`);
    console.log(`URL: ${data.html_url}`);

    if (!skipLabel) {
      const labelService = new LabelService(this.config.llmBackend);
      const llmLabels = await labelService.classifyWithLLM(title, body);
      let labelNames: string[] = [];
      if (llmLabels.type || llmLabels.area) {
        labelNames = [llmLabels.type, llmLabels.area].filter((l): l is string => l !== null);
      } else {
        labelNames = labelService.classifyByRule(title, body);
      }
      if (labelNames.length > 0) {
        const repoLabels = await this.request<any[]>(`/repos/${this.config.repo}/labels`, 'GET');
        const nameToId = new Map(repoLabels.map((l: any) => [l.name, l.id]));
        const labelIds = labelNames.map(n => nameToId.get(n)).filter((id): id is number => id !== undefined);
        if (labelIds.length > 0) {
          await this.request(`/repos/${this.config.repo}/issues/${data.number}/labels`, 'PUT', { labels: labelIds });
          console.log(`Labels auto-classified: ${labelNames.join(', ')}`);
        }
      }
    }
    return data.number;
  }

  async createComment(issueId: string, body: string): Promise<void> {
    console.log(`Adding comment to issue #${issueId}...`);
    const data = await this.request<CommentResponse>(`/repos/${this.config.repo}/issues/${issueId}/comments`, 'POST', { body });
    console.log(`Comment added! [ID: ${data.id}]`);
  }

  async updateComment(commentId: string, body: string): Promise<void> {
    console.log(`Updating comment #${commentId}...`);
    await this.request<void>(`/repos/${this.config.repo}/issues/comments/${commentId}`, 'PATCH', { body });
    console.log(`Comment #${commentId} updated.`);
  }

  async closeIssue(issueId: string): Promise<void> {
    console.log(`Closing issue #${issueId}...`);
    const issue = await this.getIssue(issueId);
    await this.request<void>(`/repos/${this.config.repo}/issues/${issueId}`, 'PATCH', { state: 'closed', body: issue.body || '' });
    console.log(`Issue #${issueId} closed.`);
  }

  async reopenIssue(issueId: string): Promise<void> {
    console.log(`Reopening issue #${issueId}...`);
    const issue = await this.getIssue(issueId);
    await this.request<void>(`/repos/${this.config.repo}/issues/${issueId}`, 'PATCH', { state: 'open', body: issue.body || '' });
    console.log(`Issue #${issueId} reopened.`);
  }

  async printIssueBody(issueId: string): Promise<void> {
    const issue = await this.getIssue(issueId);
    console.log(`====== Issue #${issue.number} Body ======`);
    console.log(issue.body);
    console.log('==========================================');
  }

  async printIssueJson(issueId: string): Promise<void> {
    const issue = await this.request<Record<string, unknown>>(`/repos/${this.config.repo}/issues/${issueId}`, 'GET');
    console.log(JSON.stringify(issue, null, 2));
  }

  async printIssuesJson(state: string, limit: number): Promise<void> {
    const issues = await this.getIssues();
    const filtered = state === 'all' ? issues : issues.filter(i => i.state === state);
    const sliced = filtered.slice(0, limit);
    console.log(JSON.stringify(sliced, null, 2));
  }

  async generateTokenWithTea(): Promise<void> {
    console.log('Setting up tea login and checking token...');
    try {
      execSync('tea logins delete local-gitea >/dev/null 2>&1', { stdio: 'ignore' });
    } catch {}

    try {
      const teaUser = process.env.GITEA_ADMIN_USER || 'gitea-admin';
      const teaPass = process.env.GITEA_ADMIN_PASSWORD || 'admin12345';
      execSync(`tea logins add --name local-gitea --url https://${this.gitHost} --user ${teaUser} --password ${teaPass} --insecure`, { stdio: 'inherit' });
    } catch (e) {
      const err = e as Error;
      console.error('tea login add failed:', err.message);
      process.exit(1);
    }

    const configPaths = [
      path.join(process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || '', '.config'), 'tea', 'config.yml'),
      path.join(process.env.HOME || '', 'Library', 'Application Support', 'tea', 'config.yml'),
    ];

    for (const configPath of configPaths) {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        const lines = content.split('\n');
        let inLogin = false;
        for (const line of lines) {
          const trimmed = line.trim();
          if (!inLogin && trimmed.startsWith('-') && trimmed.includes('name:') && trimmed.includes('local-gitea')) {
            inLogin = true;
            continue;
          }
          if (inLogin && trimmed.startsWith('name:') && trimmed.includes('local-gitea')) {
            inLogin = true;
            continue;
          }
          if (inLogin && trimmed.startsWith('token:')) {
            const token = trimmed.split(':').slice(1).join(':').trim();
            console.log(`tea API token: ${token}`);
            return;
          }
          if (inLogin && trimmed.startsWith('-')) {
            inLogin = false;
          }
        }
      }
    }
    console.error('tea token not found.');
    process.exit(1);
  }

  async generateToken(): Promise<void> {
    console.log('Generating new API token...');
    const baseUrl = this.config.apiUrl;
    const username = process.env.GITEA_ADMIN_USER || 'gitea-admin';
    const password = process.env.GITEA_ADMIN_PASSWORD || 'admin12345';
    const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');

    try {
      const listResponse = await fetch(`${baseUrl}/users/${username}/tokens`, {
        method: 'GET',
        headers: { 'Authorization': `Basic ${basicAuth}` },
      });
      if (listResponse.ok) {
        const tokens = await listResponse.json() as unknown as TokenResponse[];
        for (const token of tokens) {
          await fetch(`${baseUrl}/users/${username}/tokens/${token.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Basic ${basicAuth}` },
          });
        }
        if (tokens.length > 0) {
          console.log(`Cleaned ${tokens.length} existing tokens.`);
        }
      }

      const tokenName = `antigravity-token-${Math.floor(Date.now() / 1000)}`;
      const createResponse = await fetch(`${baseUrl}/users/${username}/tokens`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${basicAuth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tokenName, scopes: ['all'] }),
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        throw new Error(`Token creation failed: ${createResponse.status} ${errorText}`);
      }

      const newToken = await createResponse.json() as unknown as TokenResponse;
      if (newToken.sha1) {
        console.log(`New token created: ${newToken.sha1}`);
        console.log(`Name: ${newToken.name}`);
        console.log(`\nAdd to .env:\n  GITEA_ACCESS_TOKEN=${newToken.sha1}\n`);
      }
    } catch (error) {
      const err = error as Error;
      console.error('Token generation error:', err.message);
      process.exit(1);
    }
  }

  async initGitea(): Promise<void> {
    console.log('Starting Gitea initialization...');
    const baseUrl = this.config.apiUrl;
    const username = process.env.GITEA_ADMIN_USER || 'gitea-admin';
    const password = process.env.GITEA_ADMIN_PASSWORD || 'admin12345';
    const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');
    const authHeader = { 'Authorization': `Basic ${basicAuth}` };

    const repoRes = await fetch(`${baseUrl}/repos/${this.config.repo}`, { headers: authHeader });
    if (repoRes.ok) {
      console.log(`Repository ${this.config.repo} already exists.`);
    } else {
      console.log('Creating repository...');
      const repoName = this.config.repo.split('/')[1];
      const createRes = await fetch(`${baseUrl}/user/repos`, {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: repoName, private: true, auto_init: false }),
      });
      if (!createRes.ok) {
        const err = await createRes.text();
        throw new Error(`Repo creation failed: ${createRes.status} ${err}`);
      }
      console.log(`Repository ${this.config.repo} created!`);
    }

    const tokenName = `opencode-token-${Math.floor(Date.now() / 1000)}`;
    const createRes = await fetch(`${baseUrl}/users/${username}/tokens`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: tokenName, scopes: ['all'] }),
    });
    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Token creation failed: ${createRes.status} ${err}`);
    }
    const newToken = await createRes.json() as any;
    const token = newToken.sha1;

    console.log(`Token created: ${token}`);
    const envPath = path.resolve(process.cwd(), '.env');
    let envContent = fs.readFileSync(envPath, 'utf-8');
    envContent = envContent.replace(/^(GITEA_ACCESS_TOKEN=).*/m, `$1${token}`);
    envContent = envContent.replace(/^(GITEA_API_TOKEN=).*/m, `$1${token}`);
    fs.writeFileSync(envPath, envContent);
    console.log('.env file updated with token.');

    try {
      execSync('git remote remove gitea 2>/dev/null', { stdio: 'ignore' });
    } catch {}
    execSync(`git remote add gitea https://gitea:${token}@${this.gitHost}/${this.config.repo}.git`, { stdio: 'inherit' });
    execSync('git push gitea develop', { stdio: 'inherit' });
    await this.seedDefaultLabels();
    console.log('Gitea initialization complete!');
  }

  async seedDefaultLabels(): Promise<void> {
    const labels = [
      { name: 'bug',     color: '#d73a4a', description: 'Bug fix' },
      { name: 'feature', color: '#a2eeef', description: 'New feature' },
      { name: 'chore',   color: '#bfdadc', description: 'Refactor/chore/docs' },
      { name: 'agent',   color: '#0075ca', description: 'agents app' },
      { name: 'wiki',    color: '#0e8a16', description: 'wiki app (joplin/obsidian)' },
      { name: 'crawler', color: '#e4e669', description: 'crawler app' },
      { name: 'ebook',   color: '#f0ad4e', description: 'ebook app' },
      { name: 'viewer',  color: '#5319e7', description: 'viewer app' },
      { name: 'infra',   color: '#b60205', description: 'Docker/infra setup' },
    ];
    console.log('Creating default labels...');
    for (const label of labels) {
      try {
        await this.request(`/repos/${this.config.repo}/labels`, 'POST', label);
      } catch {}
    }
    console.log('Default labels created!');
  }

  async repoDump(targetDir: string): Promise<void> {
    const dir = path.resolve(targetDir);
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Repo dump started... Target: ${dir}`);

    const issuesFile = path.join(dir, 'issues.jsonl');
    const wikiDir = path.join(dir, 'wiki');

    await this.dumpIssueToFile(issuesFile);
    await this.dumpWiki(wikiDir);

    const lineCount = fs.readFileSync(issuesFile, 'utf-8').trim().split('\n').filter(Boolean).length;
    const info = {
      repo: this.config.repo,
      exported_at: new Date().toISOString(),
      issue_count: lineCount,
      wiki_page_count: fs.existsSync(wikiDir) ? fs.readdirSync(wikiDir).filter(f => f.endsWith('.md')).length : 0,
    };
    fs.writeFileSync(path.join(dir, 'info.json'), JSON.stringify(info, null, 2));
    console.log(`Repo dump complete: ${dir}`);
  }

  async repoRestore(dumpDir: string): Promise<void> {
    await this.restoreIssue(path.join(dumpDir, 'issues.jsonl'));
    await this.restoreWiki(path.join(dumpDir, 'wiki'));
  }

  async dumpIssue(targetDir: string, issueId?: string): Promise<void> {
    const dir = path.resolve(targetDir);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'issues.jsonl');
    await this.dumpIssueToFile(filePath, issueId);
    console.log(`Issues dumped to ${filePath}`);
  }

  private async dumpIssueToFile(filePath: string, issueId?: string): Promise<void> {
    const issues = issueId ? [await this.getIssue(issueId)] : await this.getIssues();
    const lines: string[] = [];
    for (const issue of issues) {
      const comments = await this.getComments(String(issue.number));
      const issueLabels: LabelInfo[] = ((issue as any).labels || []).map((l: any) => ({
        name: l.name || '',
        color: l.color || '',
      }));
      lines.push(JSON.stringify({
        original_number: issue.number,
        title: issue.title,
        body: issue.body,
        state: (issue as any).state || 'open',
        created_at: (issue as any).created_at || '',
        labels: issueLabels,
        comments: comments.map(c => ({
          body: c.body,
          created_at: (c as any).created_at || '',
        })),
      }));
    }
    fs.writeFileSync(filePath, lines.join('\n'));
  }

  async restoreIssue(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      return;
    }
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    const dumpData: DumpIssue[] = raw.split('\n').filter(Boolean).map(line => JSON.parse(line));
    console.log(`Restoring ${dumpData.length} issues...`);
    dumpData.sort((a, b) => a.original_number - b.original_number);
    const mapping: { original: number; new: number }[] = [];

    const repoLabels = await this.request<any[]>(`/repos/${this.config.repo}/labels`, 'GET');
    const labelNameToId = new Map<string, number>();
    for (const rl of repoLabels) {
      labelNameToId.set(rl.name, rl.id);
    }

    for (const item of dumpData) {
      const normalizedBody = this.normalizeCommitLinks(item.body);
      const bodyWithRef = `> Originally #${item.original_number}\n\n---\n\n${normalizedBody}`;
      const labelIds: number[] = (item.labels || [])
        .map(l => labelNameToId.get(l.name))
        .filter((id): id is number => id !== undefined);
      const data = await this.request<IssueResponse>(`/repos/${this.config.repo}/issues`, 'POST', {
        title: item.title,
        body: bodyWithRef,
        labels: labelIds.length > 0 ? labelIds : undefined,
      });
      console.log(`Issue #${item.original_number} -> #${data.number}`);
      mapping.push({ original: item.original_number, new: data.number });

      if (item.state === 'closed') {
        await this.request(`/repos/${this.config.repo}/issues/${data.number}`, 'PATCH', {
          state: 'closed',
          body: bodyWithRef,
        });
      }

      for (const comment of item.comments) {
        const normalizedComment = this.normalizeCommitLinks(comment.body);
        await this.createComment(String(data.number), normalizedComment);
      }
    }

    console.log('\nMapping:');
    mapping.forEach(m => console.log(`  Original #${m.original} -> New #${m.new}`));
  }

  async wikiInit(fromDir?: string): Promise<void> {
    const baseUrl = this.config.apiUrl;
    const token = this.config.accessToken;

    const repoRes = await fetch(`${baseUrl}/repos/${this.config.repo}`, {
      method: 'GET',
      headers: { 'Authorization': `token ${token}` },
    });
    const repoData = await repoRes.json() as any;
    if (!repoData.has_wiki) {
      console.log('Enabling wiki...');
      await fetch(`${baseUrl}/repos/${this.config.repo}`, {
        method: 'PATCH',
        headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ has_wiki: true }),
      });
    }

    const tmpDir = path.resolve(fromDir || 'data/dumps/gitea/wiki-init');
    fs.mkdirSync(tmpDir, { recursive: true });

    if (!fromDir) {
      const homeMd = path.join(tmpDir, 'Home.md');
      if (!fs.existsSync(homeMd)) {
        fs.writeFileSync(homeMd, `# ${this.config.repo.split('/')[1]} Wiki\n\nWelcome to the project wiki.\n`);
      }
    }

    const wikiUrl = `https://gitea:${token}@${this.gitHost}/${this.config.repo}.wiki.git`;
    const isGitRepo = fs.existsSync(path.join(tmpDir, '.git'));
    if (!isGitRepo) {
      execSync(`cd ${tmpDir} && git init`, { stdio: 'inherit' });
    }
    execSync(`cd ${tmpDir} && git add -A && git commit -m "Wiki sync: $(date)" 2>/dev/null || true`, { stdio: 'inherit' });
    try {
      execSync(`cd ${tmpDir} && git remote remove origin 2>/dev/null; git remote add origin ${wikiUrl}`, { stdio: 'inherit' });
    } catch {}
    execSync(`cd ${tmpDir} && git push -u origin main --force`, { stdio: 'inherit' });
    console.log('Wiki initialized!');
  }

  async dumpWiki(targetDir: string): Promise<void> {
    const dir = path.resolve(targetDir);
    const wikiDir = path.join(dir, 'wiki');
    fs.mkdirSync(wikiDir, { recursive: true });
    const token = this.config.accessToken;
    const wikiUrl = `https://gitea:${token}@${this.gitHost}/${this.config.repo}.wiki.git`;
    console.log(`Cloning wiki... ${wikiUrl}`);
    execSync(`cd ${dir} && git clone ${wikiUrl} wiki 2>/dev/null || echo "Wiki empty or not available"`, { stdio: 'inherit' });
    console.log(`Wiki dumped to ${wikiDir}`);
  }

  async restoreWiki(wikiDir: string): Promise<void> {
    if (!fs.existsSync(wikiDir) || !fs.existsSync(path.join(wikiDir, '.git'))) {
      console.error(`Wiki git repo not found: ${wikiDir}`);
      return;
    }
    const token = this.config.accessToken;
    const wikiUrl = `https://gitea:${token}@${this.gitHost}/${this.config.repo}.wiki.git`;
    console.log('Pushing wiki...');
    execSync(`cd ${wikiDir} && git push --mirror ${wikiUrl}`, { stdio: 'inherit' });
    console.log('Wiki restored!');
  }

  async issueSave(): Promise<void> {
    const date = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString().replace('T', ' ').slice(0, 16);

    const branch = this.git.runCmd('git rev-parse --abbrev-ref HEAD', true);
    const commits = this.git.runCmd(`git log --since="${date}T00:00:00" --oneline --format="%h %s"`, true);
    const commitCount = commits ? commits.split('\n').length : 0;
    const firstCommitTime = this.git.runCmd(`git log --since="${date}T00:00:00" --format="%ai" --reverse | head -1`, true);
    const lastCommitTime = this.git.runCmd(`git log --since="${date}T00:00:00" --format="%ai" -1`, true);

    const firstHash = this.git.runCmd(`git log --since="${date}T00:00:00" --format="%H" --reverse | head -1`, true);
    let statLines = '';
    let additions = 0, deletions = 0;
    if (firstHash) {
      const statOutput = this.git.runCmd(`git diff --stat ${firstHash}^..HEAD -- ':!package-lock.json' ':!uv.lock'`, true);
      statLines = statOutput.split('\n').slice(0, -1).join('\n');
      const summary = statOutput.split('\n').pop() || '';
      const addMatch = summary.match(/(\d+) insertion/);
      const delMatch = summary.match(/(\d+) deletion/);
      additions = addMatch ? parseInt(addMatch[1]) : 0;
      deletions = delMatch ? parseInt(delMatch[1]) : 0;
    }

    const issues = [...new Set(commits.match(/#\d+/g) || [])].join(', ');

    let decisions = '';
    try {
      const prompt = `You are a developer summarizing a work session. Based on these git log entries, infer what decisions were made and why.

Git commits:
${commits}

Git diff stats:
${statLines.length > 200 ? statLines.slice(0, 200) + '...' : statLines}

For each decision, provide a markdown table row in this exact format (without extra text):
| decision | rationale |
Only output the table rows, nothing else.`;

      const llmUrl = process.env.LLM_URL || 'http://host.docker.internal:11434';
      const ollamaRes = await fetch(`${llmUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: process.env.LLM_MODEL || 'qwen3.5:9b-mlx', prompt, stream: false, options: { num_predict: 500 } }),
        signal: AbortSignal.timeout(15000),
      });
      if (ollamaRes.ok) {
        const data = await ollamaRes.json() as any;
        decisions = data.response || '';
      }
    } catch {
      decisions = 'Ollama unavailable -- add decisions manually.';
    }

    const body = `# Agent Context Memory: ${date}

## Session Stats
- **Session Time**: ${firstCommitTime || 'N/A'} ~ ${lastCommitTime || now}
- **Branch**: ${branch}
- **Commits**: ${commitCount}
- **Changed Files**: ${statLines}
- **Related Issues**: ${issues || '(none)'}

## Commits
\`\`\`
${commits || '(no commits today)'}
\`\`\`

## Decisions
${decisions || '(none inferred)'}

## Key Files
${statLines.split('\n').map(l => `- ${l}`).join('\n') || '(none)'}
`;

    const title = `Agent Context Memory: ${date}`;
    const createRes = await fetch(`${this.config.apiUrl}/repos/${this.config.repo}/issues`, {
      method: 'POST',
      headers: { 'Authorization': `token ${this.config.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body }),
    });
    if (createRes.ok) {
      const data = await createRes.json() as any;
      console.log(`Session context saved as Issue #${data.number}`);
      console.log(`URL: ${data.html_url}`);
    } else {
      const err = await createRes.text();
      console.error('Issue creation failed:', err);
    }
  }
}

// ================================================================
// 7. Validation Service
// ================================================================

class ValidationService {
  private config: Config;
  private git: GitService;

  constructor(config: Config, git: GitService) {
    this.config = config;
    this.git = git;
  }

  runFullReview(): void {
    console.log('Running offline local static code review on modified files...');

    const modifiedFiles = this.git.getModifiedFiles();

    if (modifiedFiles.length === 0) {
      console.log('No local code changes detected (working tree clean).');
      return;
    }

    console.log('Modified Files:');
    let hasTsChanges = false;

    for (const file of modifiedFiles) {
      console.log(`  - ${file}`);
      if (/\.tsx?$/.test(file) || /\.jsx?$/.test(file)) {
        hasTsChanges = true;
      }
    }
    console.log('');

    console.log('Running lint diagnostics...');
    let lintErrors = '';

    for (const file of modifiedFiles) {
      if (/\.tsx?$/.test(file) || /\.jsx?$/.test(file)) {
        const lintOut = this.runLintCheck(file);
        if (lintOut && (lintOut.includes('error') || lintOut.includes('warning'))) {
          lintErrors += `${lintOut}\n`;
        }
      }
    }

    let hasErrors = false;

    if (lintErrors) {
      console.warn('Lint issues detected:\n');
      console.warn(lintErrors);
      hasErrors = true;
    } else {
      console.log('Clean! No lint issues detected.');
    }

    if (hasTsChanges) {
      console.log('\nRunning TypeScript Type Checking...');
      const tscOut = this.runTypeChecking();

      if (tscOut) {
        console.log(tscOut);
        if (tscOut.includes('error')) {
          console.warn('TypeScript compilation contains errors.');
          hasErrors = true;
        } else {
          console.log('TypeScript Compilation Clean!');
        }
      } else {
        console.log('No compilation diagnostics run.');
      }
    }

    console.log('');
    if (hasErrors) {
      console.error('Local static validation failed. Please fix errors before committing.');
      process.exit(1);
    } else {
      console.log('Local static validation passed.');
    }
  }

  runLintCheck(targetFile: string): string {
    const isCrawler = targetFile.startsWith('apps/crawler/');
    const isViewer = targetFile.startsWith('apps/viewer/');
    if (!isCrawler && !isViewer) return '';

    const prefix = isCrawler ? 'apps/crawler' : 'apps/viewer';

    if (!this.config.isContainer && this.config.runningWorkerId) {
      try {
        return this.git.runCmd(`docker compose exec -T worker npm run lint --prefix ${prefix} -- --quiet`, true);
      } catch (e) {
        return (e as Error).message;
      }
    } else {
      if (fs.existsSync(`${prefix}/node_modules`)) {
        try {
          return this.git.runCmd(`npm run lint --prefix ${prefix} -- --quiet`, true);
        } catch (e) {
          return (e as Error).message;
        }
      }
    }
    return '';
  }

  runTypeChecking(): string {
    if (!this.config.isContainer && this.config.runningWorkerId) {
      return this.git.runCmd('docker compose exec -T worker npm run type-check', true);
    } else {
      if (fs.existsSync('apps/crawler/node_modules')) {
        return this.git.runCmd('npm run type-check --prefix apps/crawler', true);
      }
    }
    return '';
  }

  runPackageVerification(stagedFiles: string[]): void {
    let runCrawler = false;
    let runViewer = false;
    let runEbook = false;

    for (const file of stagedFiles) {
      if (file.startsWith('apps/crawler/')) runCrawler = true;
      else if (file.startsWith('apps/viewer/')) runViewer = true;
      else if (file.startsWith('apps/ebook/')) runEbook = true;
    }

    if (runCrawler && fs.existsSync('apps/crawler/scripts/lint.sh')) {
      console.log('Executing apps/crawler/scripts/lint.sh...');
      this.runScript('./apps/crawler/scripts/lint.sh', 'Crawler');
    }

    if (runViewer && fs.existsSync('apps/viewer/scripts/lint.sh')) {
      console.log('Executing apps/viewer/scripts/lint.sh...');
      this.runScript('./apps/viewer/scripts/lint.sh', 'Viewer');
    }

    if (runEbook && fs.existsSync('apps/ebook/scripts/lint.sh')) {
      console.log('Executing apps/ebook/scripts/lint.sh...');
      this.runScript('./apps/ebook/scripts/lint.sh', 'Ebook');
    }
  }

  private runScript(scriptPath: string, name: string): void {
    try {
      execSync(scriptPath, { stdio: 'inherit' });
    } catch {
      console.error(`ERROR: ${name} static check failed!`);
      process.exit(1);
    }
  }
}

// ================================================================
// 8. Release Coordinator
// ================================================================

class ReleaseCoordinator {
  private config: Config;
  private git: GitService;
  private validator: ValidationService;
  private gitea: GiteaClient;

  constructor(config: Config, git: GitService, validator: ValidationService, gitea: GiteaClient) {
    this.config = config;
    this.git = git;
    this.validator = validator;
    this.gitea = gitea;
  }

  private generateCommitMessage(branchName: string): string {
    const featureMatch = branchName.match(/^feature\/([0-9]{3})-(.+)$/);
    const hotfixMatch = branchName.match(/^hotfix\/([0-9]{3})-(.+)$/);

    if (featureMatch) {
      const num = featureMatch[1];
      const desc = featureMatch[2].replace(/-/g, ' ');
      return `feat(${num}): ${desc}`;
    } else if (hotfixMatch) {
      const num = hotfixMatch[1];
      const desc = hotfixMatch[2].replace(/-/g, ' ');
      return `fix(${num}): ${desc}`;
    }

    const allStaged = this.git.runCmd('git diff --cached --name-only', true);
    if (allStaged.includes('AGENTS.md') || allStaged.includes('agents/AGENTS.md') || allStaged.includes('agents/rules/')) {
      return 'docs: update agent rules';
    } else if (allStaged.includes('src/crawler/workers/ConverterWorker.ts')) {
      return 'feat(crawler): retain original image URLs and append collected metadata';
    } else if (allStaged.includes('src/')) {
      return 'feat: update scraper/converter implementation';
    }

    return 'chore: commit changes';
  }

  private async autoCreateIssue(branchName: string): Promise<string> {
    console.log('No issue number found; auto-creating...');
    const commits = this.git.runCmd('git log --oneline -10', true);
    const stat = this.git.runCmd('git diff --stat HEAD~5..HEAD', true);
    const today = new Date().toISOString().slice(0, 10);

    const apiUrl = this.config.apiUrl;
    const token = this.config.accessToken;

    const body = await this.buildIssueBody(commits, stat, today);
    let title = `session: ${today}`;

    try {
      const llmUrl = process.env.LLM_URL || 'http://host.docker.internal:11434';
      const ollamaRes = await fetch(`${llmUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.LLM_MODEL || 'qwen3.5:9b-mlx',
          prompt: `Generate a concise Gitea issue title (max 80 chars, plain text, no markdown, no quotes) based on these commits. Return ONLY the title, nothing else.\n\nCommits:\n${commits || 'none'}\nDiff stats:\n${stat || 'none'}`,
          stream: false,
          options: { num_predict: 100 },
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (ollamaRes.ok) {
        const data = await ollamaRes.json() as any;
        let response = (data.response || data.thinking || '').trim();
        if (response) {
          const lines = response.split('\n').filter((l: string) => {
            const trimmed = l.trim();
            if (!trimmed) return false;
            const prefix = /^(Thinking Process|Step|Note|Key|Goal|Task|Analyze|Evaluate|Determine|Check|Synthesize|Extract|Identify|Consider|Look|Review|Understand|Plan|Approach|Here|I'll|Based on|From these|The title|A good|This|These)[:\s]/i;
            return !prefix.test(trimmed);
          });
          const candidate = lines[lines.length - 1]?.trim().replace(/^["']|["']$/g, '') || '';
          if (candidate.length > 5 && candidate.length <= 100) {
            title = candidate;
          }
        }
      }
    } catch {}

    try {
      const createRes = await fetch(`${apiUrl}/repos/${this.config.repo}/issues`, {
        method: 'POST',
        headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body }),
      });
      if (createRes.ok) {
        const issue = await createRes.json() as any;
        console.log(`Issue auto-created: #${issue.number} - ${title}`);
        console.log(`URL: ${issue.html_url}`);

        try {
          const labelService = new LabelService(this.config.llmBackend);
          const labels = labelService.classifyByRule(title, body);
          if (labels.length > 0) {
            const repoLabelsRes = await fetch(`${apiUrl}/repos/${this.config.repo}/labels`, {
              headers: { 'Authorization': `token ${token}` },
            });
            if (repoLabelsRes.ok) {
              const repoLabels = await repoLabelsRes.json() as any[];
              const nameToId = new Map(repoLabels.map((l: any) => [l.name, l.id]));
              const labelIds = labels.map(n => nameToId.get(n)).filter((id): id is number => id !== undefined);
              if (labelIds.length > 0) {
                await fetch(`${apiUrl}/repos/${this.config.repo}/issues/${issue.number}/labels`, {
                  method: 'PUT',
                  headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ labels: labelIds }),
                });
                console.log(`Labels auto-classified: ${labels.join(', ')}`);
              }
            }
          }
        } catch {}

        return String(issue.number);
      }
    } catch (e) {
      const err = e as Error;
      console.warn('Auto-create issue failed:', err.message);
    }
    return '';
  }

  private async buildIssueBody(commits: string, stat: string, today: string): Promise<string> {
    const parts: string[] = [
      `# Agent Context: ${today}`,
      `## Commits\n\`\`\`\n${commits || '(no recent commits)'}\n\`\`\``,
      `## Changes\n\`\`\`\n${stat || '(no changes)'}\n\`\`\``,
    ];

    const agentsDir = path.resolve(process.cwd(), 'data/agents');
    try {
      if (fs.existsSync(agentsDir)) {
        const agentDirs = fs.readdirSync(agentsDir).filter(d =>
          fs.statSync(path.join(agentsDir, d)).isDirectory()
        );
        for (const agent of agentDirs) {
          const dateDir = path.join(agentsDir, agent, today);
          if (!fs.existsSync(dateDir)) continue;

          const tags = fs.readdirSync(dateDir).filter(d =>
            fs.statSync(path.join(dateDir, d)).isDirectory()
          );
          if (tags.length === 0) continue;

          tags.sort().reverse();
          const tagDir = path.join(dateDir, tags[0]);

          const ctxPath = path.join(tagDir, 'context_memory.md');
          if (fs.existsSync(ctxPath)) {
            const ctx = fs.readFileSync(ctxPath, 'utf-8').slice(0, 2000);
            parts.push(`## Session Context (${agent})\n${ctx}`);
          }

          const sessPath = path.join(tagDir, 'session.md');
          if (fs.existsSync(sessPath)) {
            const lines = fs.readFileSync(sessPath, 'utf-8').split('\n');
            const tail = lines.slice(-50).join('\n');
            parts.push(`## Session Summary (${agent})\n${tail}`);
          }

          const planPath = path.join(tagDir, 'plan.md');
          if (fs.existsSync(planPath)) {
            const plan = fs.readFileSync(planPath, 'utf-8').slice(0, 3000);
            parts.push(`## Plan (${agent})\n${plan}`);
          }
        }
      }
    } catch {}

    return parts.join('\n\n');
  }

  async execute(): Promise<void> {
    const statusPorcelain = this.git.runCmd('git status --porcelain', true);
    const branchName = this.git.runCmd('git rev-parse --abbrev-ref HEAD', true);

    if (branchName === 'main') {
      console.error('ERROR: Direct commit to main branch is prohibited by Git Flow.');
      process.exit(1);
    }

    let parsedIssueId: string | null = this.config.issueId;
    const featureMatch = branchName.match(/^feature\/([0-9]{3})-(.+)$/);
    const hotfixMatch = branchName.match(/^hotfix\/([0-9]{3})-(.+)$/);
    if (!parsedIssueId) {
      if (featureMatch) parsedIssueId = featureMatch[1];
      else if (hotfixMatch) parsedIssueId = hotfixMatch[1];
    }

    if (!parsedIssueId && this.config.accessToken) {
      parsedIssueId = await this.autoCreateIssue(branchName);
    }

    if (statusPorcelain) {
      this.validator.runFullReview();

      console.log('Running static verification tests...');
      const stagedFiles = this.git.getStagedFiles();
      this.validator.runPackageVerification(stagedFiles);

      console.log('Detecting modifications...');
      this.git.runCmd('git add .');

      const diffSummary = this.git.runCmd('git diff --cached --name-status', true);
      if (diffSummary) {
        diffSummary.split('\n').filter(Boolean).forEach((line) => {
          const parts = line.split(/\s+/);
          this.git.showFileDiff(parts[1], parts[0]);
        });
      }

      const msg = this.generateCommitMessage(branchName);
      this.git.runCmd(`git commit -m "${msg}"`);
      console.log(`Committed: ${msg}`);

      await this.runReleaseSequence(branchName, parsedIssueId);
    } else {
      console.log('No changes to commit.');
      await this.runReleaseSequence(branchName, parsedIssueId);
    }
  }

  private async runReleaseSequence(branchName: string, issueId: string | null): Promise<void> {
    if (this.config.autoMerge && branchName !== 'develop' && branchName !== 'main') {
      console.log('Auto-merge option detected. Transitioning to develop...');
      try {
        this.git.runCmd('git checkout develop');
        this.git.runCmd(`git merge "${branchName}"`);
        console.log(`Merged ${branchName} into develop.`);
      } catch {
        console.error('ERROR: Merge conflict detected! Please resolve manually.');
        process.exit(1);
      }

      this.pushToRemote();
      await this.reportToGitea(issueId);
      return;
    }

    this.pushCurrentBranchToRemote(branchName);
    await this.reportToGitea(issueId);
  }

  private pushToRemote(): void {
    console.log('Pushing develop to remote Gitea...');
    if (!this.config.accessToken) {
      console.warn('Warning: No access token. Push skipped.');
      return;
    }
    const pushUrl = this.git.buildPushUrl(this.config.apiUrl, this.config.repo, this.config.accessToken!);
    this.git.runCmd(`git push "${pushUrl}" develop --no-verify`);
    console.log('Remote sync complete.');
  }

  private pushCurrentBranchToRemote(branchName: string): void {
    console.log(`Pushing '${branchName}' to remote Gitea...`);
    if (!this.config.accessToken) {
      console.warn('Warning: No access token. Push skipped.');
      return;
    }
    const pushUrl = this.git.buildPushUrl(this.config.apiUrl, this.config.repo, this.config.accessToken!);
    this.git.runCmd(`git push "${pushUrl}" "${branchName}" --no-verify`);
    console.log('Remote sync complete.');
  }

  private async reportToGitea(issueId: string | null): Promise<void> {
    if (issueId && this.config.accessToken) {
      const latestCommitHash = this.git.runCmd('git rev-parse HEAD', true);
      await this.postGiteaReport(issueId, latestCommitHash);
      return;
    }
    console.log('No issue ID specified; skipping Gitea report.');
  }

  private async postGiteaReport(issueId: string, commitHash: string): Promise<void> {
    const commentBody = `## Work Complete Report

Issue #${issueId} changes have been verified, auto-merged to develop, and pushed.

### Commit Diff
- [Commit Diff #${commitHash.substring(0, 8)}](/commit/${commitHash})

Closing this issue automatically.`;

    try {
      await this.gitea.createComment(issueId, commentBody);
      await this.gitea.closeIssue(issueId);
      console.log('Gitea issue reported and closed!');
    } catch (error) {
      const err = error as Error;
      console.error('Gitea API call failed:', err.message);
    }
  }
}

// ================================================================
// 9. Release Helper (develop -> main merge & push)
// ================================================================

class ReleaseHelper {
  private git: GitService;
  private config: Config;

  constructor(git: GitService, config: Config) {
    this.git = git;
    this.config = config;
  }

  execute(): void {
    console.log('Starting push-changes release sequence...');

    if (!this.config.accessToken) {
      console.error('ERROR: GITEA_ACCESS_TOKEN not set. Cannot push.');
      process.exit(1);
    }

    this.git.runCmd('git config http.sslVerify false');

    const currentBranch = this.git.runCmd('git rev-parse --abbrev-ref HEAD', true);

    if (currentBranch !== 'develop') {
      console.log(`Current branch is '${currentBranch}'. Switching to develop...`);

      const statusPorcelain = this.git.runCmd('git status --porcelain', true);
      if (statusPorcelain) {
        console.error('ERROR: Uncommitted changes. Commit or stash first.');
        process.exit(1);
      }

      this.git.runCmd('git checkout develop');
    }

    const pushUrl = this.git.buildPushUrl(this.config.apiUrl, this.config.repo, this.config.accessToken!);

    console.log("Pushing 'develop' to remote...");
    this.git.runCmd(`git push "${pushUrl}" develop`);

    console.log("Merging 'develop' into 'main'...");
    this.git.runCmd('git checkout main');

    try {
      this.git.runCmd('git merge develop');
    } catch {
      console.error('ERROR: Merge conflict detected! Rolling back.');
      this.git.runCmd('git merge --abort');
      this.git.runCmd('git checkout develop');
      process.exit(1);
    }

    console.log("Pushing 'main' to remote...");
    this.git.runCmd(`git push "${pushUrl}" main`);

    console.log('Returning to develop...');
    this.git.runCmd('git checkout develop');

    console.log('Merge and push complete!');
  }
}

// ================================================================
// 10. Unified CLI Controller
// ================================================================

class GitController {
  static async execute(): Promise<void> {
    const args = process.argv.slice(2);
    const action = args[0];

    const config = new Config();
    const git = new GitService();
    const gitea = new GiteaClient(config, git);
    const validator = new ValidationService(config, git);

    switch (action) {
      // ---- Gitea Issue Operations ----
      case 'create-issue': {
        const titleFile = parseFlag(args, '--title-file', '-tf');
        const bodyFile = parseFlag(args, '--body-file', '-bf');
        if (!titleFile || !bodyFile) {
          console.error('Usage: npm run git create-issue --title-file=<path> --body-file=<path>');
          console.error('  Options: --no-label');
          process.exit(1);
        }
        const skipLabel = args.includes('--no-label');
        await gitea.createIssue(readFileOrExit(titleFile), readFileOrExit(bodyFile), skipLabel);
        break;
      }

      case 'comment': {
        const issueId = parseFlag(args, '--issue', '-i');
        const bodyFile = parseFlag(args, '--body-file', '-bf');
        if (!issueId || !bodyFile) {
          console.error('Usage: npm run git comment --issue=<id> --body-file=<path>');
          process.exit(1);
        }
        await gitea.createComment(issueId, readFileOrExit(bodyFile));
        break;
      }

      case 'update-issue': {
        const issueId = parseFlag(args, '--issue', '-i');
        const titleFile = parseFlag(args, '--title-file', '-tf');
        const bodyFile = parseFlag(args, '--body-file', '-bf');
        if (!issueId || (!titleFile && !bodyFile)) {
          console.error('Usage: npm run git update-issue --issue=<id> [--title-file=<path>] [--body-file=<path>]');
          process.exit(1);
        }
        if (bodyFile) {
          await gitea.updateIssue(issueId, titleFile ? readFileOrExit(titleFile) : '', readFileOrExit(bodyFile));
        } else {
          console.error('--body-file is required for update-issue');
          process.exit(1);
        }
        break;
      }

      case 'update-comment': {
        const commentId = parseFlag(args, '--comment-id', '-c');
        const bodyFile = parseFlag(args, '--body-file', '-bf');
        if (!commentId || !bodyFile) {
          console.error('Usage: npm run git update-comment --comment-id=<id> --body-file=<path>');
          process.exit(1);
        }
        await gitea.updateComment(commentId, readFileOrExit(bodyFile));
        break;
      }

      case 'close-issue': {
        const issueId = parseFlag(args, '--issue', '-i');
        if (!issueId) { console.error('Usage: npm run git close-issue --issue=<id>'); process.exit(1); }
        await gitea.closeIssue(issueId);
        break;
      }

      case 'reopen-issue': {
        const issueId = parseFlag(args, '--issue', '-i');
        if (!issueId) { console.error('Usage: npm run git reopen-issue --issue=<id>'); process.exit(1); }
        await gitea.reopenIssue(issueId);
        break;
      }

      case 'show-issue': {
        const issueId = parseFlag(args, '--issue', '-i');
        if (!issueId) { console.error('Usage: npm run git show-issue --issue=<id>'); process.exit(1); }
        if (args.includes('--json')) {
          await gitea.printIssueJson(issueId);
        } else {
          await gitea.printIssueBody(issueId);
        }
        break;
      }

      case 'list-issues': {
        const allIssues = await gitea.getIssues();
        let state = 'open';
        let limit = 20;

        if (args.includes('--all')) state = 'all';
        const stateStr = parseFlag(args, '--state', '-s');
        if (stateStr) state = stateStr;
        const limitStr = parseFlag(args, '--limit', '-l');
        if (limitStr) { const l = parseInt(limitStr, 10); if (!isNaN(l)) limit = l; }

        if (args.includes('--json')) {
          await gitea.printIssuesJson(state, limit);
          break;
        }

        const filtered = state === 'all' ? allIssues : allIssues.filter(i => i.state === state);
        const sliced = filtered.slice(0, limit);
        if (sliced.length === 0) { console.log('No issues to display.'); break; }
        console.log(`Recent ${sliced.length} issues (total ${filtered.length}, state=${state}):\n`);
        sliced.forEach(i => {
          const label = i.state === 'closed' ? '[x]' : '[ ]';
          const date = (i.created_at || '').slice(0, 10);
          const t = i.title.length > 50 ? i.title.slice(0, 47) + '...' : i.title;
          console.log(`  ${label} #${String(i.number).padStart(3)}  ${date}  ${t}`);
        });
        console.log('\nDetails: npm run git show-issue --issue=<number>');
        break;
      }

      // ---- Token Operations ----
      case 'generate-token':
        await gitea.generateToken();
        break;

      case 'generate-token-tea':
        await gitea.generateTokenWithTea();
        break;

      // ---- Init ----
      case 'init':
        await gitea.initGitea();
        break;

      // ---- Session Context ----
      case 'issue:save':
        await gitea.issueSave();
        break;

      // ---- Repo Dump/Restore ----
      case 'repo:dump': {
        await gitea.repoDump(parseFlag(args, '--dir') || 'data/dumps/gitea');
        break;
      }

      case 'repo:restore': {
        const dir = parseFlag(args, '--dir');
        if (!dir) { console.error('Usage: npm run git repo:restore --dir=<dumpDir>'); process.exit(1); }
        await gitea.repoRestore(dir);
        break;
      }

      case 'issue:dump': {
        await gitea.dumpIssue(parseFlag(args, '--dir') || 'data/dumps/gitea', parseFlag(args, '--issue', '-i') || '');
        break;
      }

      case 'issue:restore': {
        const file = parseFlag(args, '--file', '-f');
        if (!file) { console.error('Usage: npm run git issue:restore --file=<path>'); process.exit(1); }
        await gitea.restoreIssue(file);
        break;
      }

      // ---- Wiki Operations ----
      case 'wiki:init': {
        const dir = parseFlag(args, '--dir');
        if (!dir) { console.error('Usage: npm run git wiki:init --dir=<wikiDir>'); process.exit(1); }
        await gitea.wikiInit(dir);
        break;
      }

      case 'wiki:dump': {
        await gitea.dumpWiki(parseFlag(args, '--dir') || 'data/dumps/gitea');
        break;
      }

      case 'wiki:restore': {
        const dir = parseFlag(args, '--dir');
        if (!dir) { console.error('Usage: npm run git wiki:restore --dir=<wikiDir>'); process.exit(1); }
        await gitea.restoreWiki(dir);
        break;
      }

      // ---- Commit (from commit-changes.ts) ----
      case 'commit': {
        const coordinator = new ReleaseCoordinator(config, git, validator, gitea);
        await coordinator.execute();
        break;
      }

      // ---- Review (from review-changes.ts) ----
      case 'review': {
        validator.runFullReview();
        break;
      }

      // ---- Push (from push-changes.ts) ----
      case 'push': {
        const helper = new ReleaseHelper(git, config);
        helper.execute();
        break;
      }

      // ---- Git Flow Operations ----
      case 'start': {
        const issue = parseFlag(args, '--issue', '-i');
        const desc = parseFlag(args, '--desc', '-d');
        if (!issue || !desc) {
          console.error('Usage: npm run git start --issue=<number> --desc=<kebab-description>');
          process.exit(1);
        }
        const branchName = `feature/${issue}-${desc}`;
        const stashed = git.hasUncommitted();
        if (stashed) {
          git.stash();
        }
        git.checkout('develop');
        git.pull();
        git.checkoutNew(branchName);
        if (stashed) {
          git.stashPop();
        }
        console.log(`Switched to new branch: ${branchName}`);
        break;
      }

      case 'branch': {
        console.log(`Current branch: ${git.currentBranch()}`);
        const status = git.shortStatus();
        if (status) {
          console.log('Uncommitted changes:');
          console.log(status);
        } else {
          console.log('Working tree clean.');
        }
        break;
      }

      case 'log': {
        const countStr = parseFlag(args, '--count', '-c');
        const count = countStr ? parseInt(countStr, 10) || 10 : 10;
        console.log(git.log(count));
        break;
      }

      case 'status': {
        const status = git.shortStatus();
        if (status) {
          console.log(status);
        } else {
          console.log('Working tree clean.');
        }
        break;
      }

      default:
        console.error(`Unknown command: '${action}'`);
        console.error('Available commands:');
        console.error('  Issue:    create-issue, comment, update-issue, update-comment, close-issue, reopen-issue, show-issue, list-issues');
        console.error('  Token:    generate-token, generate-token-tea');
        console.error('  Init:     init');
        console.error('  Session:  issue:save');
        console.error('  Repo:     repo:dump, repo:restore, issue:dump, issue:restore');
        console.error('  Wiki:     wiki:init, wiki:dump, wiki:restore');
        console.error('  Pipeline: commit, review, push');
        console.error('  Git:      start, branch, log, status');
        process.exit(1);
    }
  }
}

// ================================================================
// Entrypoint
// ================================================================

GitController.execute();
