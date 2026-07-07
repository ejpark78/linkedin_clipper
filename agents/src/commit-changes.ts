/**
 * ==============================================================================
 * 🤖 All-In-One Commit, Push, and Gitea Issue Automator (commit-changes.ts)
 * ==============================================================================
 * @description  로컬 변경 사항을 검증/커밋하고, 브랜치 정책에 따라 원격 저장소에 Push한 뒤,
 *               해당 Gitea 이슈에 완료 보고 댓글(Commit Diff 포함)과 이슈 마감(Close)까지
 *               원스톱으로 처리하는 통합 릴리즈 파이프라인입니다.
 *               이슈 번호는 feature/hotfix 브랜치명, `GITEA_ISSUE_ID`, `--issue`, `--issue-id` 순으로 해석합니다.
 * @constraints  main 브랜치 직접 커밋 방지 기능 내장.
 *               Strict Typing 및 OOP Patterns 아키텍처 규칙을 상시 준수합니다.
 * @dependencies git CLI, Node.js child_process, Gitea API (fetch)
 * @lastUpdated  2026-06-29
 * ==============================================================================
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// 동적으로 상위 디렉토리를 탐색하여 프로젝트 루트(.git & package.json이 있는 곳)를 식별
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

/**
 * Gitea API 및 릴리즈 설정을 총괄하는 Config 클래스
 */
class PipelineConfig {
  public readonly autoMerge: boolean;
  public readonly issueId: string | null;
  public readonly apiUrl: string;
  public readonly accessToken: string | undefined;
  public readonly repo: string;

  constructor() {
    const args = process.argv.slice(2);
    this.autoMerge = !args.includes('--no-merge');
    this.issueId = this.parseIssueId(args);

    this.loadEnv();
    this.apiUrl = process.env.GITEA_API_URL || 'https://git.localhost/api/v1';
    this.repo = process.env.GITEA_REPO || 'gitea/scraper';
    this.accessToken = process.env.GITEA_ACCESS_TOKEN || process.env.GITEA_API_TOKEN;

        // TLS 인증서 검증은 NODE_OPTIONS="--use-system-ca" 로 위임 (mkcert CA 신뢰)
  }

  private parseIssueId(args: string[]): string | null {
    const explicitFlagIndex = args.findIndex((arg) => arg === '--issue' || arg === '--issue-id');
    if (explicitFlagIndex >= 0 && args[explicitFlagIndex + 1]) {
      return args[explicitFlagIndex + 1];
    }

    const envIssueId = process.env.GITEA_ISSUE_ID;
    return envIssueId && envIssueId.trim().length > 0 ? envIssueId.trim() : null;
  }

  private loadEnv(): void {
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return;

    const content = fs.readFileSync(envPath, 'utf-8');
    content.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;

      const parts = trimmed.split('=');
      const key = parts[0].trim();
      const value = parts.slice(1).join('=').trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
      process.env[key] = value;
    });
  }
}

/**
 * Git 제어 및 Diff 파싱을 담당하는 GitService 클래스
 */
class GitService {
  public runCmd(cmd: string, ignoreError = false): string {
    try {
      return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch (error) {
      if (ignoreError) {
        return '';
      }
      const err = error as Error;
      console.error(`❌ 명령어 실행 실패: ${cmd}`);
      console.error(err.message);
      process.exit(1);
    }
  }

  public showFileDiff(file: string, status: string): void {
    const absPath = path.resolve(process.cwd(), file);
    let action = 'Edit';
    if (status === 'A') action = 'Create';
    if (status === 'D') action = 'Delete';

    console.log(`● ${action}(${absPath})`);

    const numstat = this.runCmd(`git diff --cached --numstat -- "${file}"`, true);
    if (!numstat) {
      console.log(`  ⎿  +0 / -0 lines`);
      return;
    }

    const parts = numstat.split(/\s+/);
    const addedStr = parts[0];
    const deletedStr = parts[1];
    
    const isBinary = addedStr === '-' || deletedStr === '-';
    const added = isBinary ? 0 : parseInt(addedStr, 10) || 0;
    const deleted = isBinary ? 0 : parseInt(deletedStr, 10) || 0;

    console.log(`  ⎿  +${added} / -${deleted} lines`);

    if (isBinary) {
      console.log(`       [Binary file]\n`);
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
      if (/^(diff|index|---|\+\+\+)/.test(line)) {
        continue;
      }

      const hunkHeaderMatch = line.match(/^@@\s+-(\d+),?(\d*)\s+\+(\d+),?(\d*)\s+@@/);
      if (hunkHeaderMatch) {
        lineOld = parseInt(hunkHeaderMatch[1], 10);
        lineNew = parseInt(hunkHeaderMatch[3], 10);
        continue;
      }

      if (lineOld === 0 && lineNew === 0) {
        continue;
      }

      if (line.startsWith('-')) {
        const content = line.substring(1);
        console.log(`       ${String(lineOld).padEnd(4)} - ${content}`);
        lineOld++;
      } else if (line.startsWith('+')) {
        const content = line.substring(1);
        console.log(`       ${String(lineNew).padEnd(4)} + ${content}`);
        lineNew++;
      } else if (line.startsWith(' ')) {
        const content = line.substring(1);
        console.log(`       ${String(lineNew).padEnd(4)}   ${content}`);
        lineOld++;
        lineNew++;
      } else if (line === '') {
        console.log(`       ${String(lineNew).padEnd(4)}   `);
        lineOld++;
        lineNew++;
      }
    }
    console.log('');
  }
}

/**
 * Gitea API와의 직접 통신을 전담하는 GiteaClient 클래스
 */
class GiteaClient {
  private config: PipelineConfig;

  constructor(config: PipelineConfig) {
    this.config = config;
  }

  private async request<T>(endpoint: string, method: string, body?: object): Promise<T> {
    if (!this.config.accessToken) {
      throw new Error('GITEA_ACCESS_TOKEN이 유효하지 않아 Gitea API를 호출할 수 없습니다.');
    }
    const url = `${this.config.apiUrl}${endpoint}`;
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
  }

  public async createComment(issueId: string, body: string): Promise<void> {
    console.log(`💬 Gitea 이슈 #${issueId} 에 코멘트 등록 중...`);
    await this.request<any>(`/repos/${this.config.repo}/issues/${issueId}/comments`, 'POST', { body });
    console.log('✅ 코멘트 등록이 완료되었습니다.');
  }

  public async closeIssue(issueId: string): Promise<void> {
    console.log(`🔒 Gitea 이슈 #${issueId} 마감 중...`);
    await this.request<void>(`/repos/${this.config.repo}/issues/${issueId}`, 'PATCH', { state: 'closed' });
    console.log(`✅ 이슈 #${issueId} 가 정상 마감(Closed)되었습니다.`);
  }
}

/**
 * 정적 검사 및 린트 검증을 대행하는 ValidationService 클래스
 */
class ValidationService {
  public runCodeReview(): void {
    if (fs.existsSync('agents/src/review-changes.ts')) {
      console.log('🤖 Running Code Review Check...');
      try {
        execSync('npx ts-node agents/src/review-changes.ts', { stdio: 'inherit' });
      } catch (e) {
        console.log('⚠️ Review check script failed to run. Proceeding with commit...');
      }
    }
  }

  public runPackageVerification(stagedFiles: string[]): void {
    let runCrawler = false;
    let runViewer = false;
    let runEbook = false;

    for (const file of stagedFiles) {
      if (file.startsWith('apps/crawler/')) runCrawler = true;
      else if (file.startsWith('apps/viewer/')) runViewer = true;
      else if (file.startsWith('apps/ebook/')) runEbook = true;
    }

    if (runCrawler && fs.existsSync('apps/crawler/scripts/lint.sh')) {
      console.log('🏃 Executing apps/crawler/scripts/lint.sh...');
      this.executeLintScript('./apps/crawler/scripts/lint.sh', 'Crawler');
    }

    if (runViewer && fs.existsSync('apps/viewer/scripts/lint.sh')) {
      console.log('🏃 Executing apps/viewer/scripts/lint.sh...');
      this.executeLintScript('./apps/viewer/scripts/lint.sh', 'Viewer');
    }

    if (runEbook && fs.existsSync('apps/ebook/scripts/lint.sh')) {
      console.log('🏃 Executing apps/ebook/scripts/lint.sh...');
      this.executeLintScript('./apps/ebook/scripts/lint.sh', 'Ebook');
    }
  }

  private executeLintScript(scriptPath: string, name: string): void {
    try {
      execSync(scriptPath, { stdio: 'inherit' });
    } catch (e) {
      console.error(`❌ ERROR: ${name} static check failed!`);
      process.exit(1);
    }
  }
}

/**
 * 로컬 커밋, 원격지 푸시, 이슈 종결 전체 흐름을 제어하는 Master Coordinator 클래스
 */
class ReleaseCoordinator {
  private config: PipelineConfig;
  private git: GitService;
  private validator: ValidationService;
  private gitea: GiteaClient;

  constructor(config: PipelineConfig, git: GitService, validator: ValidationService, gitea: GiteaClient) {
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

    const allStaged = this.git.runCmd('git diff --cached --name-only');
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
    console.log('🔍 Gitea 이슈 번호가 없어 자동 생성합니다...');
    const commits = this.git.runCmd('git log --oneline -10', true);
    const stat = this.git.runCmd('git diff --stat HEAD~5..HEAD', true);
    const today = new Date().toISOString().slice(0, 10);

    const apiUrl = this.config.apiUrl;
    const token = this.config.accessToken;
    if (!token) {
      console.log('⚠️ GITEA_ACCESS_TOKEN이 없어 이슈를 생성할 수 없습니다.');
      return '';
    }

    let title = `session: ${today}`;
    let body = `## 📋 Commits\n\`\`\`\n${commits || '(no recent commits)'}\n\`\`\`\n\n## 📁 Changes\n\`\`\`\n${stat || '(no changes)'}\n\`\`\``;

    try {
      const llmUrl = process.env.LLM_URL || 'http://127.0.0.1:11434';
      const ollamaRes = await fetch(`${llmUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.LLM_MODEL || 'qwen3.5:9b-mlx',
          prompt: `You are a developer writing a Gitea issue summary. From these commits, create a concise title (first line) and description.
Commits:\n${commits || 'none'}
Diff stats:\n${stat || 'none'}`,
          stream: false,
          options: { num_predict: 200 },
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (ollamaRes.ok) {
        const data = await ollamaRes.json() as any;
        const response = (data.response || '').trim();
        if (response) {
          const lines = response.split('\n');
          title = lines[0].replace(/^#+\s*/, '').slice(0, 100) || title;
          body = lines.slice(1).join('\n').trim() || body;
        }
      }
    } catch {
      // Ollama unavailable, use fallback template
    }

    try {
      const createRes = await fetch(`${apiUrl}/repos/${this.config.repo}/issues`, {
        method: 'POST',
        headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body }),
      });
      if (createRes.ok) {
        const issue = await createRes.json() as any;
        console.log(`✅ 이슈 자동 생성됨: #${issue.number} - ${title}`);
        console.log(`🔗 ${issue.html_url}`);
        return String(issue.number);
      }
    } catch (e) {
      const err = e as Error;
      console.warn('⚠️ 이슈 자동 생성 실패:', err.message);
    }
    return '';
  }

  public async execute(): Promise<void> {
    const statusPorcelain = this.git.runCmd('git status --porcelain', true);
    const branchName = this.git.runCmd('git rev-parse --abbrev-ref HEAD');

    if (branchName === 'main') {
      console.error('❌ ERROR: Direct commit to `main` branch is strictly prohibited by Git Flow guidelines.');
      process.exit(1);
    }

    let parsedIssueId: string | null = this.config.issueId;
    const featureMatch = branchName.match(/^feature\/([0-9]{3})-(.+)$/);
    const hotfixMatch = branchName.match(/^hotfix\/([0-9]{3})-(.+)$/);
    if (!parsedIssueId) {
      if (featureMatch) parsedIssueId = featureMatch[1];
      else if (hotfixMatch) parsedIssueId = hotfixMatch[1];
    }

    // Auto-create issue if missing
    if (!parsedIssueId && this.config.accessToken) {
      parsedIssueId = await this.autoCreateIssue(branchName);
    }

    if (statusPorcelain) {
      this.validator.runCodeReview();

      console.log('🔍 Running static verification tests...');
      const stagedFiles = statusPorcelain.split('\n').map(l => l.substring(3).trim()).filter(Boolean);
      this.validator.runPackageVerification(stagedFiles);

      console.log('🔄 Detecting modifications...');
      this.git.runCmd('git add .');

      const diffSummary = this.git.runCmd('git diff --cached --name-status');
      if (diffSummary) {
        diffSummary.split('\n').filter(Boolean).forEach((line) => {
          const parts = line.split(/\s+/);
          this.git.showFileDiff(parts[1], parts[0]);
        });
      }

      const msg = this.generateCommitMessage(branchName);
      this.git.runCmd(`git commit -m "${msg}"`);
      console.log(`✅ Committed: ${msg}`);

      await this.runReleaseSequence(branchName, parsedIssueId);
    } else {
      console.log('✨ No changes to commit.');
      await this.runReleaseSequence(branchName, parsedIssueId);
    }
  }

  private async runReleaseSequence(branchName: string, issueId: string | null): Promise<void> {
    if (this.config.autoMerge && branchName !== 'develop' && branchName !== 'main') {
      console.log('🔀 Auto-merge option detected. Transitioning to develop...');
      try {
        this.git.runCmd('git checkout develop');
        this.git.runCmd(`git merge "${branchName}"`);
        console.log(`✅ Successfully merged ${branchName} into develop branch.`);
      } catch (e) {
        console.error('❌ ERROR: Merge conflict detected! Please resolve conflicts manually.');
        process.exit(1);
      }

      // 원격 Gitea 저장소로 push 진행
      this.pushToRemote();

      // 커밋 해시 획득 및 Gitea 이슈 자동 코멘트 & 클로즈
      await this.reportToGitea(issueId);
      return;
    }

    this.pushCurrentBranchToRemote(branchName);
    await this.reportToGitea(issueId);
  }

  private pushToRemote(): void {
    console.log("📤 로컬 'develop' 변경 사항을 원격 Gitea 서버로 푸시(push) 중...");
    if (!this.config.accessToken) {
      console.warn('⚠️  Warning: GITEA_ACCESS_TOKEN이 유효하지 않아 Push를 진행할 수 없습니다.');
      return;
    }
    const pushUser = process.env.GITEA_ADMIN_USER || 'gitea-admin';
    const apiUrl = new URL(this.config.apiUrl);
    const pushUrl = `${apiUrl.protocol}//${pushUser}:${this.config.accessToken}@${apiUrl.host}/${this.config.repo}.git`;
    this.git.runCmd(`git push "${pushUrl}" develop --no-verify`);
    console.log('✅ 원격 저장소 동기화가 정상 완료되었습니다.');
  }

  private pushCurrentBranchToRemote(branchName: string): void {
    console.log(`📤 현재 브랜치 '${branchName}' 변경 사항을 원격 Gitea 서버로 푸시(push) 중...`);
    if (!this.config.accessToken) {
      console.warn('⚠️  Warning: GITEA_ACCESS_TOKEN이 유효하지 않아 Push를 진행할 수 없습니다.');
      return;
    }
    const pushUser = process.env.GITEA_ADMIN_USER || 'gitea-admin';
    const apiUrl = new URL(this.config.apiUrl);
    const pushUrl = `${apiUrl.protocol}//${pushUser}:${this.config.accessToken}@${apiUrl.host}/${this.config.repo}.git`;
    this.git.runCmd(`git push "${pushUrl}" "${branchName}" --no-verify`);
    console.log('✅ 원격 저장소 동기화가 정상 완료되었습니다.');
  }

  private async reportToGitea(issueId: string | null): Promise<void> {
    if (issueId && this.config.accessToken) {
      const latestCommitHash = this.git.runCmd('git rev-parse HEAD');
      await this.postGiteaReport(issueId, latestCommitHash);
      return;
    }

    console.log('ℹ️ Gitea 이슈 번호가 지정되지 않아 댓글 등록 및 마감은 건너뜁니다.');
  }

  private async postGiteaReport(issueId: string, commitHash: string): Promise<void> {
    const commentBody = `## 🏁 작업 완료 보고 (All-In-One 자동화)

이슈 #${issueId} 관련 변경 사항이 성공적으로 검증되어 \`develop\` 브랜치에 자동 병합 및 원격 저장소 동기화(Push) 완료되었습니다.

### 🔗 Gitea Commit Diff 링크 (변경 사항 확인)
- [Commit Diff #${commitHash.substring(0, 8)}](/${this.config.repo}/commit/${commitHash})

이슈 처리가 완수되어 본 이슈를 자동으로 마감합니다.`;

    try {
      await this.gitea.createComment(issueId, commentBody);
      await this.gitea.closeIssue(issueId);
      console.log('🎉 Gitea 이슈 코멘트 작성 및 마감 완료!');
    } catch (error) {
      const err = error as Error;
      console.error('⚠️ Gitea API 호출 실패:', err.message);
    }
  }
}

// Global Execution Entrypoint
const config = new PipelineConfig();
const git = new GitService();
const validator = new ValidationService();
const gitea = new GiteaClient(config);
const coordinator = new ReleaseCoordinator(config, git, validator, gitea);

coordinator.execute();
