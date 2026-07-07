/**
 * dump.ts — Gitea repo/issue dump and restore operations.
 *
 * Design context: Backup and migration utilities for Gitea issues
 * and wiki data. Supports JSONL export/import with cross-repo
 * commit link normalization and session context saving.
 *
 * Dependencies: base (BaseGiteaClient, DumpIssue, LabelInfo, IssueResponse)
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { BaseGiteaClient, DumpIssue, LabelInfo, IssueResponse } from './base';
import { Config } from '../config';
import { GitService } from '../git-service';

interface SessionInfo {
  repo: string;
  exported_at: string;
  issue_count: number;
  wiki_page_count: number;
}

interface OllamaGenerateResponse {
  response?: string;
}

export class DumpClient extends BaseGiteaClient {
  private git: GitService;

  constructor(config: Config, git: GitService) {
    super(config);
    this.git = git;
  }

  async repoDump(targetDir: string): Promise<void> {
    const dir = path.resolve(targetDir);
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Repo dump started... Target: ${dir}`);

    const issuesFile = path.join(dir, 'issues.jsonl');
    const wikiDir = path.join(dir, 'wiki');

    await this.dumpIssueToFile(issuesFile);
    await this.dumpWikiInternal(wikiDir);

    const lineCount = fs.readFileSync(issuesFile, 'utf-8').trim().split('\n').filter(Boolean).length;
    const info: SessionInfo = {
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
    await this.restoreWikiInternal(path.join(dumpDir, 'wiki'));
  }

  async dumpIssue(targetDir: string, issueId?: string): Promise<void> {
    const dir = path.resolve(targetDir);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'issues.jsonl');
    await this.dumpIssueToFile(filePath, issueId);
    console.log(`Issues dumped to ${filePath}`);
  }

  private async dumpIssueToFile(filePath: string, issueId?: string): Promise<void> {
    const issues = issueId
      ? [await this.getIssueForDump(issueId)]
      : await this.getAllIssuesForDump();
    const lines: string[] = [];
    for (const issue of issues) {
      const comments = await this.getCommentsForDump(String(issue.number));
      const issueLabels: LabelInfo[] = (issue.labels || []).map((l: LabelInfo) => ({
        name: l.name || '',
        color: l.color || '',
      }));
      lines.push(JSON.stringify({
        original_number: issue.number,
        title: issue.title,
        body: issue.body,
        state: issue.state || 'open',
        created_at: issue.created_at || '',
        labels: issueLabels,
        comments: comments.map(c => ({
          body: c.body,
          created_at: c.created_at || '',
        })),
      }));
    }
    fs.writeFileSync(filePath, lines.join('\n'));
  }

  private async getIssueForDump(issueId: string): Promise<IssueResponse> {
    return await this.request<IssueResponse>(
      `/repos/${this.config.repo}/issues/${issueId}`,
      'GET',
    );
  }

  private async getAllIssuesForDump(): Promise<IssueResponse[]> {
    let allIssues: IssueResponse[] = [];
    let page = 1;
    const limit = 50;

    while (true) {
      const data = await this.request<IssueResponse[]>(
        `/repos/${this.config.repo}/issues?state=all&type=all&limit=${limit}&page=${page}`,
        'GET',
      );
      if (!data || data.length === 0) break;
      allIssues = allIssues.concat(data);
      if (data.length < limit) break;
      page++;
    }
    return allIssues;
  }

  private async getCommentsForDump(issueId: string): Promise<{ body: string; created_at: string }[]> {
    return await this.request<{ body: string; created_at: string }[]>(
      `/repos/${this.config.repo}/issues/${issueId}/comments`,
      'GET',
    );
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

    const repoLabels: { id: number; name: string }[] = await this.request(
      `/repos/${this.config.repo}/labels`,
      'GET',
    );
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
      const data = await this.request<IssueResponse>(
        `/repos/${this.config.repo}/issues`,
        'POST',
        {
          title: item.title,
          body: bodyWithRef,
          labels: labelIds.length > 0 ? labelIds : undefined,
        },
      );
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
        await this.createCommentForDump(String(data.number), normalizedComment);
      }
    }

    console.log('\nMapping:');
    mapping.forEach(m => console.log(`  Original #${m.original} -> New #${m.new}`));
  }

  private async createCommentForDump(issueId: string, body: string): Promise<void> {
    await this.request(`/repos/${this.config.repo}/issues/${issueId}/comments`, 'POST', { body });
  }

  private async dumpWikiInternal(targetDir: string): Promise<void> {
    const dir = path.resolve(targetDir);
    const wikiDir = path.join(dir, 'wiki');
    fs.mkdirSync(wikiDir, { recursive: true });

    if (!this.config.accessToken) return;

    const wikiUrl = `https://gitea:${this.config.accessToken}@${this.gitHost}/${this.config.repo}.wiki.git`;
    execSync(`cd ${dir} && git clone ${wikiUrl} wiki 2>/dev/null || echo "Wiki empty or not available"`, { stdio: 'inherit' });
  }

  private async restoreWikiInternal(wikiDir: string): Promise<void> {
    if (!fs.existsSync(wikiDir) || !fs.existsSync(path.join(wikiDir, '.git'))) {
      console.error(`Wiki git repo not found: ${wikiDir}`);
      return;
    }

    if (!this.config.accessToken) return;

    const wikiUrl = `https://gitea:${this.config.accessToken}@${this.gitHost}/${this.config.repo}.wiki.git`;
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
        body: JSON.stringify({
          model: process.env.LLM_MODEL || 'qwen3.5:9b-mlx',
          prompt,
          stream: false,
          options: { num_predict: 500 },
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (ollamaRes.ok) {
        const data = (await ollamaRes.json()) as OllamaGenerateResponse;
        decisions = data.response || '';
      }
    } catch (err) {
      console.warn(`DumpClient: Ollama unavailable for decision inference — ${err}`);
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

    if (!this.config.accessToken) {
      console.error('GITEA_ACCESS_TOKEN required for issue:save');
      return;
    }

    const createRes = await fetch(`${this.config.apiUrl}/repos/${this.config.repo}/issues`, {
      method: 'POST',
      headers: { 'Authorization': `token ${this.config.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body }),
    });
    if (createRes.ok) {
      const data = (await createRes.json()) as { number: number; html_url: string };
      console.log(`Session context saved as Issue #${data.number}`);
      console.log(`URL: ${data.html_url}`);
    } else {
      const err = await createRes.text();
      console.error('Issue creation failed:', err);
    }
  }
}
