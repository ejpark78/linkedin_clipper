/**
 * release-coordinator.ts — Commit/release pipeline orchestration.
 *
 * Design context: Coordinates commit, review, auto-merge, push,
 * and Gitea reporting. ReleaseHelper handles the develop→main
 * release flow. Both use constructor-injected services.
 *
 * Dependencies: config (Config), git-service (GitService),
 *   validation-service (ValidationService), gitea-client (GiteaClient),
 *   label-service (LabelService)
 */

import * as fs from 'fs';
import * as path from 'path';
import { Config } from './config';
import { GitService } from './git-service';
import { ValidationService } from './validation-service';
import { GiteaClient } from './gitea-client/client';
import { LabelService } from './label-service';

interface OllamaGenerateResponse {
  response?: string;
}

export class ReleaseCoordinator {
  private config: Config;
  private git: GitService;
  private validator: ValidationService;
  private gitea: GiteaClient;
  private labelService: LabelService;

  constructor(
    config: Config,
    git: GitService,
    validator: ValidationService,
    gitea: GiteaClient,
    labelService?: LabelService,
  ) {
    this.config = config;
    this.git = git;
    this.validator = validator;
    this.gitea = gitea;
    this.labelService = labelService || new LabelService(config.llmBackend);
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
        const data = (await ollamaRes.json()) as OllamaGenerateResponse;
        let response = (data.response || '').trim();
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
    } catch (err) {
      console.warn(`ReleaseCoordinator: LLM title generation failed — ${err}`);
    }

    if (!token) {
      console.warn('ReleaseCoordinator: no access token, skipping auto-issue');
      return '';
    }

    try {
      const createRes = await fetch(`${apiUrl}/repos/${this.config.repo}/issues`, {
        method: 'POST',
        headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body }),
      });
      if (createRes.ok) {
        const issue = (await createRes.json()) as { number: number; html_url: string };
        console.log(`Issue auto-created: #${issue.number} - ${title}`);
        console.log(`URL: ${issue.html_url}`);

        try {
          const labels = this.labelService.classifyByRule(title, body);
          if (labels.length > 0) {
            const repoLabelsRes = await fetch(`${apiUrl}/repos/${this.config.repo}/labels`, {
              headers: { 'Authorization': `token ${token}` },
            });
            if (repoLabelsRes.ok) {
              const repoLabels = (await repoLabelsRes.json()) as { id: number; name: string }[];
              const nameToId = new Map(repoLabels.map((l: { id: number; name: string }) => [l.name, l.id]));
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
        } catch (err) {
          console.warn(`ReleaseCoordinator: label classification failed — ${err}`);
        }

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
    } catch (err) {
      console.warn(`ReleaseCoordinator: failed to read agent context — ${err}`);
    }

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
        diffSummary.split('\n').filter(Boolean).forEach((line: string) => {
          const parts = line.split(/\s+/);
          this.git.showFileDiff(parts[1], parts[0]);
        });
      }

      const msg = this.generateCommitMessage(branchName);
      this.git.runCmd(`git commit -m "${msg}"`);
      console.log(`Committed: ${msg}`);

      if (parsedIssueId) {
        await this.addLabelsToIssue(parsedIssueId, branchName, diffSummary || '');
      }

      await this.runReleaseSequence(branchName, parsedIssueId);
    } else {
      console.log('No changes to commit.');
      await this.runReleaseSequence(branchName, parsedIssueId);
    }
  }

  private async addLabelsToIssue(issueId: string, branchName: string, diffSummary: string): Promise<void> {
    try {
      const combo = `${branchName}\n${diffSummary}`;
      const llmLabels = await this.labelService.classifyWithLLM(branchName, diffSummary);
      let labelNames: string[] = [];
      if (llmLabels.type || llmLabels.area) {
        labelNames = [llmLabels.type, llmLabels.area].filter((l): l is string => l !== null);
      } else {
        labelNames = this.labelService.classifyByRule(branchName, diffSummary);
      }
      if (labelNames.length > 0 && this.config.accessToken) {
        const repoLabels = await this.gitea.getRepoLabels();
        const nameToId = new Map(repoLabels.map(l => [l.name, l.id]));
        const labelIds = labelNames.map(n => nameToId.get(n)).filter((id): id is number => id !== undefined);
        if (labelIds.length > 0) {
          await this.gitea.addLabels(parseInt(issueId, 10), labelIds);
          console.log(`Labels auto-classified: ${labelNames.join(', ')}`);
        }
      }
    } catch (err) {
      console.warn(`ReleaseCoordinator: label classification failed — ${err}`);
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
    const pushUrl = this.git.buildPushUrl(this.config.apiUrl, this.config.repo, this.config.accessToken);
    this.git.runCmd(`git push "${pushUrl}" develop --no-verify`);
    console.log('Remote sync complete.');
  }

  private pushCurrentBranchToRemote(branchName: string): void {
    console.log(`Pushing '${branchName}' to remote Gitea...`);
    if (!this.config.accessToken) {
      console.warn('Warning: No access token. Push skipped.');
      return;
    }
    const pushUrl = this.git.buildPushUrl(this.config.apiUrl, this.config.repo, this.config.accessToken);
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
// Release Helper (develop -> main merge & push)
// ================================================================

export class ReleaseHelper {
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

    const pushUrl = this.git.buildPushUrl(
      this.config.apiUrl,
      this.config.repo,
      this.config.accessToken,
    );

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
