/**
 * ==============================================================================
 * 🤖 Gitea API Helper Script (gitea.ts)
 * ==============================================================================
 * @description  Gitea API를 호출하여 이슈 생성, 조회, 수정, 댓글 등록/수정/조회, 이슈 마감을 제어하는 헬퍼 유틸리티입니다.
 *               기존의 gitea-mcp 및 tea CLI의 대화형(interactive) 실행 장애를 대체합니다.
 * @constraints  .env 파일의 자격 증명(GITEA_ACCESS_TOKEN)을 사용합니다.
 *               Strict Typing 및 OOP Patterns 아키텍처 규칙을 상시 준수합니다.
 * @dependencies Node.js runtime, fetch API (v18+), git CLI
 * @lastUpdated  2026-06-29
 * ==============================================================================
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 프로젝트 전역 설정을 파싱하고 검증하는 Config 클래스
 */
class Config {
  public readonly apiUrl: string;
  public readonly accessToken: string;
  public readonly repo: string;

  constructor() {
    this.loadEnv();
    this.apiUrl = process.env.GITEA_API_URL || 'https://gitea.localhost/api/v1';
    this.repo = process.env.GITEA_REPO || 'gitea-admin/scraper';
    
    const token = process.env.GITEA_ACCESS_TOKEN || process.env.GITEA_API_TOKEN;
    if (!token) {
      console.error('❌ GITEA_ACCESS_TOKEN 이 설정되지 않았습니다. .env 파일을 확인해 주십시오.');
      process.exit(1);
    }
    this.accessToken = token;

    // TLS 인증서 검증은 NODE_OPTIONS="--use-system-ca" 로 위임 (mkcert CA 신뢰)
  }

  private loadEnv() {
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

}

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

/**
 * Gitea API 통신을 담당하는 Client 클래스 (SRP 준수)
 */
class GiteaClient {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  private async request<T>(endpoint: string, method: string, body?: object): Promise<T> {
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
      console.error(`❌ API 호출 중 오류 발생 [${method} ${url}]:`, err.message);
      process.exit(1);
    }
  }

  private formatText(text: string): string {
    // [br] 기호만 실제 줄바꿈 문자로 변환합니다.
    return text.replace(/\[br\]/g, '\n');
  }

  /** Gitea Web UI의 host (예: git.localhost) */
  private get gitHost(): string {
    return new URL(this.config.apiUrl).host;
  }

  /** Gitea Web UI의 origin (예: https://git.localhost) */
  private get gitOrigin(): string {
    return `${new URL(this.config.apiUrl).protocol}//${this.gitHost}`;
  }

  private runGitCmd(cmd: string): string {
    try {
      return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch {
      return '';
    }
  }

  /**
   * 본문 내 commit diff 링크의 domain/owner/repo를 현재 설정 기준으로 치환합니다.
   * https://OLD_DOMAIN/OLD_OWNER/OLD_REPO/commit/HASH
   *   → https://CURRENT_DOMAIN/CURRENT_OWNER/CURRENT_REPO/commit/HASH
   */
  private normalizeCommitLinks(text: string): string {
    const domain = this.config.apiUrl.replace(/\/api\/v1\/?$/, '');
    const [owner, repo] = this.config.repo.split('/');
    return text.replace(
      /https:\/\/[^\/]+\/[^\/]+\/[^\/]+\/commit\//g,
      `${domain}/${owner}/${repo}/commit/`
    );
  }

  public async getIssues(): Promise<IssueResponse[]> {
    let allIssues: IssueResponse[] = [];
    let page = 1;
    const limit = 50;

    while (true) {
      const data = await this.request<IssueResponse[]>(`/repos/${this.config.repo}/issues?state=all&type=all&limit=${limit}&page=${page}`, 'GET');
      if (!data || data.length === 0) {
        break;
      }
      allIssues = allIssues.concat(data);
      if (data.length < limit) {
        break;
      }
      page++;
    }
    return allIssues;
  }

  public async getIssue(issueId: string): Promise<IssueResponse> {
    return await this.request<IssueResponse>(`/repos/${this.config.repo}/issues/${issueId}`, 'GET');
  }

  public async getComments(issueId: string): Promise<CommentResponse[]> {
    return await this.request<CommentResponse[]>(`/repos/${this.config.repo}/issues/${issueId}/comments`, 'GET');
  }

  public async getTimeline(issueId: string): Promise<TimelineEvent[]> {
    return await this.request<TimelineEvent[]>(`/repos/${this.config.repo}/issues/${issueId}/timeline`, 'GET');
  }

  public async updateIssue(issueId: string, title: string, body: string): Promise<void> {
    const formattedTitle = this.formatText(title);
    const formattedBody = this.formatText(body);
    await this.request<void>(`/repos/${this.config.repo}/issues/${issueId}`, 'PATCH', { title: formattedTitle, body: formattedBody });
  }

  public async createIssue(title: string, body: string, skipLabel?: boolean): Promise<number> {
    console.log(`🚀 Gitea 이슈 생성 중... [${title}]`);
    const formattedTitle = this.formatText(title);
    const formattedBody = this.formatText(body);
    const data = await this.request<IssueResponse>(`/repos/${this.config.repo}/issues`, 'POST', { title: formattedTitle, body: formattedBody });
    console.log(`✅ 이슈가 성공적으로 생성되었습니다! [Issue #${data.number}]`);
    console.log(`🔗 URL: ${data.html_url}`);

    if (!skipLabel) {
      const labels = await this.classifyIssueLabels(title, body);
      if (labels && (labels.type || labels.area)) {
        const repoLabels = await this.request<any[]>(`/repos/${this.config.repo}/labels`, 'GET');
        const nameToId = new Map(repoLabels.map((l: any) => [l.name, l.id]));
        const labelIds: number[] = [];
        if (labels.type && nameToId.has(labels.type)) labelIds.push(nameToId.get(labels.type)!);
        if (labels.area && nameToId.has(labels.area)) labelIds.push(nameToId.get(labels.area)!);
        if (labelIds.length > 0) {
          await this.request(`/repos/${this.config.repo}/issues/${data.number}/labels`, 'PUT', { labels: labelIds });
          console.log(`🏷️  라벨 자동 분류: ${labels.type}${labels.area ? ', ' + labels.area : ''}`);
        }
      }
    }
    return data.number;
  }

  public async createComment(issueId: string, body: string): Promise<void> {
    console.log(`💬 이슈 #${issueId} 에 댓글 등록 중...`);
    const formattedBody = this.formatText(body);
    const data = await this.request<CommentResponse>(`/repos/${this.config.repo}/issues/${issueId}/comments`, 'POST', { body: formattedBody });
    console.log(`✅ 댓글이 등록되었습니다! [ID: ${data.id}]`);
  }

  public async updateComment(commentId: string, body: string): Promise<void> {
    console.log(`💬 댓글 ID #${commentId} 수정 중...`);
    const formattedBody = this.formatText(body);
    await this.request<void>(`/repos/${this.config.repo}/issues/comments/${commentId}`, 'PATCH', { body: formattedBody });
    console.log(`✅ 댓글 ID #${commentId} 수정이 정상 완료되었습니다.`);
  }

  public async closeIssue(issueId: string): Promise<void> {
    console.log(`🔒 이슈 #${issueId} 마감 중...`);
    await this.request<void>(`/repos/${this.config.repo}/issues/${issueId}`, 'PATCH', { state: 'closed' });
    console.log(`✅ 이슈 #${issueId} 가 마감(Closed)되었습니다.`);
  }

  public async reopenIssue(issueId: string): Promise<void> {
    console.log(`🔓 이슈 #${issueId} 재오픈 중...`);
    await this.request<void>(`/repos/${this.config.repo}/issues/${issueId}`, 'PATCH', { state: 'open' });
    console.log(`✅ 이슈 #${issueId} 가 다시 오픈(Open)되었습니다.`);
  }

  public async updateIssueTitle(issueId: string, title: string): Promise<void> {
    console.log(`⚙️ Gitea 이슈 #${issueId} 제목 수정 중... [${title}]`);
    const formattedTitle = this.formatText(title);
    // 제목만 수정하기 위해 body 생략
    await this.request<void>(`/repos/${this.config.repo}/issues/${issueId}`, 'PATCH', { title: formattedTitle });
    console.log(`✅ 이슈 #${issueId} 제목이 정상 수정되었습니다.`);
  }

  public async printIssueBody(issueId: string): Promise<void> {
    const issue = await this.getIssue(issueId);
    console.log(`====== Issue #${issue.number} Body ======`);
    console.log(issue.body);
    console.log(`==========================================`);
  }

  public async printTitleErrorIssues(): Promise<void> {
    console.log('🔍 제목이 --title로 시작하는 오염된 이슈를 검색 중...');
    const issues = await this.getIssues();
    const targets = issues.filter(i => i.title.startsWith('--title') || i.title === '--title');
    
    if (targets.length === 0) {
      console.log('✅ --title 제목 오류를 가진 이슈가 존재하지 않습니다.');
      return;
    }

    console.log(`⚠️ 총 ${targets.length}개의 오염된 이슈를 발견했습니다:`);
    targets.forEach(t => {
      console.log(`   - [#${t.number}] 제목: "${t.title}" (URL: ${t.html_url})`);
    });
  }

  public async fixLegacyIssues(issueIds: string[]): Promise<void> {
    console.log(`⚙️ 기존 깨진 이슈 본문 복구 프로세스 시작... 대상 이슈: [${issueIds.join(', ')}]`);
    for (const id of issueIds) {
      try {
        const issue = await this.getIssue(id);
        const originalBody = issue.body;
        const fixedBody = originalBody.replace(/\\n/g, '\n');

        if (originalBody !== fixedBody) {
          await this.updateIssue(id, issue.title, fixedBody);
          console.log(`   ✅ 이슈 #${id} 본문 복구 완료!`);
        } else {
          console.log(`   ℹ️ 이슈 #${id} 는 이미 정상 포맷이거나 치환할 문자열이 없습니다.`);
        }
      } catch (e) {
        const err = e as Error;
        console.error(`   ❌ 이슈 #${id} 복구 실패:`, err.message);
      }
    }
    console.log('🎉 일괄 복구 프로세스가 성공적으로 완료되었습니다.');
  }

  public async generateTokenWithTea(): Promise<void> {
    console.log('🍵 tea CLI 로그인 설정을 추가하고 토큰을 확인합니다...');
    try {
      execSync('tea logins delete local-gitea >/dev/null 2>&1', { stdio: 'ignore' });
    } catch {
      // 삭제할 로그인이 없어도 무시
    }
    try {
      const teaUser = process.env.GITEA_ADMIN_USER || 'gitea-admin';
      const teaPass = process.env.GITEA_ADMIN_PASSWORD || 'admin12345';
      execSync(`tea logins add --name local-gitea --url https://gitea.localhost --user ${teaUser} --password ${teaPass} --insecure`, { stdio: 'inherit' });
    } catch (e) {
      const err = e as Error;
      console.error('❌ tea 로그인 추가 실패:', err.message);
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
            console.log(`🔑 생성된 tea API 토큰: ${token}`);
            return;
          }
          if (inLogin && trimmed.startsWith('-')) {
            inLogin = false;
          }
        }
      }
    }
    console.error('❌ tea 토큰을 확인할 수 없습니다.');
    process.exit(1);
  }

  public async generateToken(): Promise<void> {
    console.log('🔑 Gitea API를 통해 신규 토큰을 발급합니다...');
    const baseUrl = this.config.apiUrl;
    const username = process.env.GITEA_ADMIN_USER || 'gitea-admin';
    const password = process.env.GITEA_ADMIN_PASSWORD || 'admin12345';
    const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');

    try {
      // 1. 기존 토큰 목록 조회 및 삭제 (cleanup)
      const listResponse = await fetch(`${baseUrl}/users/${username}/tokens`, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
        },
      });
      if (listResponse.ok) {
        const tokens = await listResponse.json() as unknown as TokenResponse[];
        for (const token of tokens) {
          await fetch(`${baseUrl}/users/${username}/tokens/${token.id}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Basic ${basicAuth}`,
            },
          });
        }
        if (tokens.length > 0) {
          console.log(`   🧹 ${tokens.length}개의 기존 토큰을 정리했습니다.`);
        }
      }

      // 2. 새 토큰 생성
      const tokenName = `antigravity-token-${Math.floor(Date.now() / 1000)}`;
      const createResponse = await fetch(`${baseUrl}/users/${username}/tokens`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: tokenName, scopes: ['all'] }),
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        throw new Error(`토큰 생성 실패: ${createResponse.status} ${errorText}`);
      }

      const newToken = await createResponse.json() as unknown as TokenResponse;
      if (newToken.sha1) {
        console.log(`✅ 새 토큰이 생성되었습니다!`);
        console.log(`   토큰: ${newToken.sha1}`);
        console.log(`   이름: ${newToken.name}`);
        console.log(`\n.env 파일에 다음을 등록하세요:\n  GITEA_ACCESS_TOKEN=${newToken.sha1}\n`);
      } else {
        console.log('⚠️ 토큰이 생성되었으나 SHA1 값을 확인할 수 없습니다.');
      }
    } catch (error) {
      const err = error as Error;
      console.error('❌ 토큰 생성 중 오류 발생:', err.message);
      process.exit(1);
    }
  }

  public async initGitea(): Promise<void> {
    console.log('Gitea 초기 설정을 시작합니다...');
    const baseUrl = this.config.apiUrl;
    const username = process.env.GITEA_ADMIN_USER || 'gitea-admin';
    const password = process.env.GITEA_ADMIN_PASSWORD || 'admin12345';
    const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');
    const authHeader = { 'Authorization': `Basic ${basicAuth}` };

    // 1. repo 존재 확인 or 생성
    const repoRes = await fetch(`${baseUrl}/repos/${this.config.repo}`, { headers: authHeader });
    if (repoRes.ok) {
      console.log(`리포지토리 ${this.config.repo} 가 이미 존재합니다.`);
    } else {
      console.log('리포지토리 생성 중...');
      const repoName = this.config.repo.split('/')[1];
      const createRes = await fetch(`${baseUrl}/user/repos`, {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: repoName, private: true, auto_init: false }),
      });
      if (!createRes.ok) {
        const err = await createRes.text();
        throw new Error(`repo 생성 실패: ${createRes.status} ${err}`);
      }
      console.log(`리포지토리 ${this.config.repo} 생성 완료!`);
    }

    // 2. 토큰 생성
    const tokenName = `opencode-token-${Math.floor(Date.now() / 1000)}`;
    const createRes = await fetch(`${baseUrl}/users/${username}/tokens`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: tokenName, scopes: ['all'] }),
    });
    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`토큰 생성 실패: ${createRes.status} ${err}`);
    }
    const newToken = await createRes.json() as any;
    const token = newToken.sha1;

    console.log(`\n토큰이 생성되었습니다: ${token}`);
    const envPath = path.resolve(process.cwd(), '.env');
    let envContent = fs.readFileSync(envPath, 'utf-8');
    envContent = envContent.replace(/^(GITEA_ACCESS_TOKEN=).*/m, `$1${token}`);
    envContent = envContent.replace(/^(GITEA_API_TOKEN=).*/m, `$1${token}`);
    fs.writeFileSync(envPath, envContent);
    console.log(`✅ .env 파일에 토큰이 자동 등록되었습니다.`);

    // 3. git remote 설정 & push
    const gitDomain = new URL(this.config.apiUrl).host;
    try {
      execSync('git remote remove gitea 2>/dev/null', { stdio: 'ignore' });
    } catch {}
    execSync(`git remote add gitea https://gitea:${token}@${this.gitHost}/${this.config.repo}.git`, { stdio: 'inherit' });
    execSync('git push gitea develop', { stdio: 'inherit' });
    await this.seedDefaultLabels();
    console.log('\nGitea 초기 설정이 완료되었습니다!');
  }

  /** repo에 기본 라벨(Type 3 + Area 6)을 생성합니다. */
  public async seedDefaultLabels(): Promise<void> {
    const labels = [
      { name: 'bug',     color: '#d73a4a', description: '버그 수정' },
      { name: 'feature', color: '#a2eeef', description: '새 기능' },
      { name: 'chore',   color: '#bfdadc', description: '리팩터링/잡일/문서' },
      { name: 'agent',   color: '#0075ca', description: 'agents 앱' },
      { name: 'wiki',    color: '#0e8a16', description: 'wiki 앱 (joplin/obsidian)' },
      { name: 'crawler', color: '#e4e669', description: 'crawler 앱' },
      { name: 'ebook',   color: '#f0ad4e', description: 'ebook 앱' },
      { name: 'viewer',  color: '#5319e7', description: 'viewer 앱' },
      { name: 'infra',   color: '#b60205', description: 'Docker/인프라 설정' },
    ];
    console.log('🏷️  기본 라벨 생성 중...');
    for (const label of labels) {
      try {
        await this.request(`/repos/${this.config.repo}/labels`, 'POST', label);
      } catch {
        // 이미 존재하면 무시
      }
    }
    console.log('✅ 기본 라벨 생성 완료!');
  }

  public async repoDump(targetDir: string): Promise<void> {
    const dir = path.resolve(targetDir);
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📦 Gitea repo dump 시작... 대상: ${dir}`);

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
    console.log(`✅ Repo dump 완료: ${dir}`);
  }

  public async repoRestore(dumpDir: string): Promise<void> {
    await this.restoreIssue(path.join(dumpDir, 'issues.jsonl'));
    await this.restoreWiki(path.join(dumpDir, 'wiki'));
  }

  public async dumpIssue(targetDir: string, issueId?: string): Promise<void> {
    const dir = path.resolve(targetDir);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'issues.jsonl');
    await this.dumpIssueToFile(filePath, issueId);
    console.log(`✅ Issues dumped to ${filePath}`);
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

  public async restoreIssue(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) {
      console.error(`❌ 파일 없음: ${filePath}`);
      return;
    }
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    const dumpData: DumpIssue[] = raw.split('\n').filter(Boolean).map(line => JSON.parse(line));
    console.log(`📥 ${dumpData.length}개 이슈 복원 시작...`);
    dumpData.sort((a, b) => a.original_number - b.original_number);
    const mapping: { original: number; new: number }[] = [];

    // repo의 현재 label 목록 캐싱 (name → id)
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
      console.log(`   ✅ Issue #${item.original_number} → #${data.number}`);
      mapping.push({ original: item.original_number, new: data.number });

      if (item.state === 'closed') {
        await this.request(`/repos/${this.config.repo}/issues/${data.number}`, 'PATCH', {
          state: 'closed',
        });
      }

      for (const comment of item.comments) {
        const normalizedComment = this.normalizeCommitLinks(comment.body);
        await this.createComment(String(data.number), normalizedComment);
      }
    }

    console.log(`\n📊 매핑 테이블:`);
    mapping.forEach(m => console.log(`   Original #${m.original} → New #${m.new}`));
  }

  public async wikiInit(fromDir?: string): Promise<void> {
    const baseUrl = this.config.apiUrl;
    const token = this.config.accessToken;

    // Enable wiki if not already
    const repoRes = await fetch(`${baseUrl}/repos/${this.config.repo}`, {
      method: 'GET',
      headers: { 'Authorization': `token ${token}` },
    });
    const repoData = await repoRes.json() as any;
    if (!repoData.has_wiki) {
      console.log('🔧 Wiki 활성화 중...');
      await fetch(`${baseUrl}/repos/${this.config.repo}`, {
        method: 'PATCH',
        headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ has_wiki: true }),
      });
    }

    const tmpDir = path.resolve(fromDir || 'data/dumps/gitea/wiki-init');
    fs.mkdirSync(tmpDir, { recursive: true });

    if (!fromDir) {
      // No source dir: create placeholder Home.md
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
    console.log('✅ Wiki 초기화 완료!');
  }

  public async dumpWiki(targetDir: string): Promise<void> {
    const dir = path.resolve(targetDir);
    const wikiDir = path.join(dir, 'wiki');
    fs.mkdirSync(wikiDir, { recursive: true });
    const token = this.config.accessToken;
    const wikiUrl = `https://gitea:${token}@${this.gitHost}/${this.config.repo}.wiki.git`;
    console.log(`📥 Wiki clone 중... ${wikiUrl}`);
    execSync(`cd ${dir} && git clone ${wikiUrl} wiki 2>/dev/null || echo "Wiki empty or not available"`, { stdio: 'inherit' });
    console.log(`✅ Wiki dumped to ${wikiDir}`);
  }

  public async restoreWiki(wikiDir: string): Promise<void> {
    if (!fs.existsSync(wikiDir) || !fs.existsSync(path.join(wikiDir, '.git'))) {
      console.error(`❌ Wiki git 저장소 없음: ${wikiDir}`);
      return;
    }
    const token = this.config.accessToken;
    const wikiUrl = `https://gitea:${token}@${this.gitHost}/${this.config.repo}.wiki.git`;
    console.log(`📤 Wiki push 중...`);
    execSync(`cd ${wikiDir} && git push --mirror ${wikiUrl}`, { stdio: 'inherit' });
    console.log('✅ Wiki 복원 완료!');
  }

  public async issueSave(): Promise<void> {
    const date = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString().replace('T', ' ').slice(0, 16);

    // 1. Git 데이터 수집
    const branch = this.runGitCmd('git rev-parse --abbrev-ref HEAD');
    const commits = this.runGitCmd(`git log --since="${date}T00:00:00" --oneline --format="%h %s"`);
    const commitCount = commits ? commits.split('\n').length : 0;
    const firstCommitTime = this.runGitCmd(`git log --since="${date}T00:00:00" --format="%ai" --reverse | head -1`);
    const lastCommitTime = this.runGitCmd(`git log --since="${date}T00:00:00" --format="%ai" -1`);

    // 2. Diff 통계
    const firstHash = this.runGitCmd(`git log --since="${date}T00:00:00" --format="%H" --reverse | head -1`);
    let statLines = '';
    let additions = 0, deletions = 0;
    if (firstHash) {
      const statOutput = this.runGitCmd(`git diff --stat ${firstHash}^..HEAD -- ':!package-lock.json' ':!uv.lock'`);
      statLines = statOutput.split('\n').slice(0, -1).join('\n');
      // 파싱: N file changed, M insertions(+), K deletions(-)
      const summary = statOutput.split('\n').pop() || '';
      const addMatch = summary.match(/(\d+) insertion/);
      const delMatch = summary.match(/(\d+) deletion/);
      additions = addMatch ? parseInt(addMatch[1]) : 0;
      deletions = delMatch ? parseInt(delMatch[1]) : 0;
    }

    // 3. 관련 이슈 추출
    const issues = [...new Set(commits.match(/#\d+/g) || [])].join(', ');

    // 4. Ollama 요약 시도 (선택)
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

      const ollamaRes = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gemma4:e4b-mlx', prompt, stream: false, options: { num_predict: 500 } }),
        signal: AbortSignal.timeout(15000),
      });
      if (ollamaRes.ok) {
        const data = await ollamaRes.json() as any;
        decisions = data.response || '';
      }
    } catch {
      decisions = 'Ollama unavailable — add decisions manually.';
    }

    // 5. 템플릿 채우기
    const body = `# Agent Context Memory: ${date}

## 📊 Session Stats
- **Session Time**: ${firstCommitTime || 'N/A'} ~ ${lastCommitTime || now}
- **Branch**: ${branch}
- **Commits**: ${commitCount}개
- **Changed Files**: ${statLines}
- **Related Issues**: ${issues || '(none)'}

## 📋 Commits
\`\`\`
${commits || '(no commits today)'}
\`\`\`

## 🧠 Decisions
${decisions || '(none inferred)'}

## 📁 Key Files
${statLines.split('\n').map(l => `- ${l}`).join('\n') || '(none)'}
`;

    // 6. 이슈 생성
    const title = `Agent Context Memory: ${date}`;
    const createRes = await fetch(`${this.config.apiUrl}/repos/${this.config.repo}/issues`, {
      method: 'POST',
      headers: { 'Authorization': `token ${this.config.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body }),
    });
    if (createRes.ok) {
      const data = await createRes.json() as any;
      console.log(`✅ Session context saved as Issue #${data.number}`);
      console.log(`🔗 ${data.html_url}`);
    } else {
      const err = await createRes.text();
      console.error('❌ 이슈 생성 실패:', err);
    }
  }

  public async retroactiveCommitLinks(): Promise<void> {
    console.log('🔍 전체 이슈 대상 Commit Diff 링크 소급 매핑 프로세스 기동 (v3)...');
    try {
      const issues = await this.getIssues();
      console.log(`📄 조회된 Gitea 이슈 개수: ${issues.length}`);

      for (const issue of issues) {
        const issueId = issue.number;
        const comments = await this.getComments(String(issueId));

        // 엄밀한 검사: 본문(body)이나 댓글(comments) 타임라인 통틀어 Commit Diff 링크(/commit/)가 존재하는지 확인
        const hasDiffLink = issue.body.includes('Gitea Commit Diff') ||
                            issue.body.includes('/commit/') ||
                            comments.some((c) => c.body.includes('Gitea Commit Diff') || c.body.includes('/commit/'));

        if (hasDiffLink) {
          console.log(`   ℹ️ 이슈 #${issueId}: 이미 Commit Diff 링크가 매핑되어 있습니다. 건너뜁니다.`);
          continue;
        }

        let commitHash: string | undefined = undefined;

        // 1단계: Git 커밋 메시지에서 번호 매칭 시도
        const paddedIssueId = String(issueId).padStart(3, '0'); // 예: 92 -> 092
        let gitLogCmd = `git log --grep="(${issueId})" --grep="(${paddedIssueId})" --oneline -n 1`;
        if (issueId === 92) {
          gitLogCmd = `git log --grep="(115)" --oneline -n 1`;
        }
        
        const logOutput = this.runGitCmd(gitLogCmd);
        if (logOutput) {
          commitHash = logOutput.split(/\s+/)[0];
        }

        // 2단계: Gitea 이슈 타임라인 API를 역추적하여 커밋 참조 해시 추출 (Fallback)
        if (!commitHash) {
          try {
            const timeline = await this.getTimeline(String(issueId));
            // event === 'reference' 혹은 commit_id가 있는 객체 추적
            const commitRef = timeline.find((e) => e.commit_id && e.commit_id.length > 0);
            if (commitRef) {
              commitHash = commitRef.commit_id;
              console.log(`   🎯 이슈 #${issueId} ➡ Gitea 타임라인 참조 역추적 성공! [${commitHash}]`);
            }
          } catch (e) {
            // timeline 조회 실패 시 로깅 생략
          }
        }

        if (!commitHash) {
          console.log(`   ℹ️ 이슈 #${issueId}: 매칭되는 Git 커밋 및 Gitea 타임라인 참조를 찾지 못했습니다. 건너뜁니다.`);
          continue;
        }

        console.log(`   🎯 이슈 #${issueId} ➡ 매칭 커밋 해시: [${commitHash}]`);

        const reportComment = comments.find((c) => c.body.includes('🏁 작업 완료 보고'));

        if (reportComment) {
          // 1. 완료 보고 댓글이 존재할 시, 해당 댓글 하단에 덧붙임
          const retroactiveLink = `[br][br]### 🔗 Gitea Commit Diff 링크 (소급 매핑)[br]- [Commit Diff #${commitHash.substring(0, 8)}](https://gitea.localhost/${this.config.repo}/commit/${commitHash})`;
          const updatedBody = reportComment.body + retroactiveLink;
          await this.updateComment(String(reportComment.id), updatedBody);
          console.log(`      ✅ 댓글 ID #${reportComment.id} 에 Commit Diff 링크 소급 주입 완료!`);
        } else {
          // 2. 완료 보고 댓글이 존재하지 않는 과거 이슈 (#1~#91 등) ➡ 이슈 본문(body) 가장 하단에 직접 주입
          const retroactiveLink = `[br][br]### 🔗 Gitea Commit Diff 링크 (소급 매핑)[br]- [Commit Diff #${commitHash.substring(0, 8)}](https://gitea.localhost/${this.config.repo}/commit/${commitHash})`;
          const updatedIssueBody = issue.body + retroactiveLink;
          const formattedBody = this.formatText(updatedIssueBody);
          await this.updateIssue(String(issueId), issue.title, formattedBody);
          console.log(`      ✅ 이슈 #${issueId} 본문(body)에 직접 Commit Diff 링크 소급 주입 완료!`);
        }
      }
      console.log('🎉 전체 이슈 대상 Commit Diff 링크 소급 매핑이 완료되었습니다!');
    } catch (error) {
      const err = error as Error;
      console.error('❌ 소급 매핑 실패:', err.message);
    }
  }

  public async formatIssueWithOllama(title: string, body: string): Promise<string | null> {
    const truncatedBody = body.length > 4000 ? body.substring(0, 4000) + '\n\n...(truncated)' : body;

    const prompt = `<start_of_turn>user
Reformat this Gitea issue into these 4 sections:

# {TITLE}

## 🎯 Goal
## 🧠 Context Memory
## ✅ Solution
## 🔗 References

Rules:
1. Copy ALL existing text into the appropriate section.
2. Infer goal from the title and content.
3. Keep section descriptions as subheadings when present.
4. Do not add new text.
5. Return ONLY the reformatted markdown.

Title: ${title}
---BODY---
${truncatedBody}
---END---
<end_of_turn>
<start_of_turn>model
`;

    try {
      const res = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gemma4:e4b-mlx', prompt, stream: false, options: { num_predict: 4096 } }),
        signal: AbortSignal.timeout(120000),
      });
      if (!res.ok) return null;
      const data = await res.json() as any;
      const response = (data.response || '').trim();
      if (response.length > 20) return response;
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Ollama로 이슈 제목+본문을 분석하여 Type(feature|bug|chore)과 Area(agent|wiki|crawler|ebook|viewer|infra|null) 추정.
   * Ollama 실패 시 rule-based 결과를 반환합니다.
   */
  public async classifyIssueLabels(title: string, body: string): Promise<{ type: string | null; area: string | null }> {
    const truncated = (title + '\n' + body).substring(0, 2000);
    const prompt = `<start_of_turn>user
Classify this issue into Type (feature|bug|chore) and Area (agent|wiki|crawler|ebook|viewer|infra|null).
Return ONLY a JSON object with keys "type" and "area". No other text.

Title: ${title}
Body: ${truncated}
<end_of_turn>
<start_of_turn>model
`;

    try {
      const res = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gemma4:e4b-mlx', prompt, stream: false, options: { num_predict: 512 } }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const data = await res.json() as any;
        const raw = (data.response || '').trim();
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return { type: parsed.type || null, area: parsed.area || null };
        }
      }
    } catch {
      // Ollama 실패 → fallback
    }

    // Rule-based fallback
    const result: { type: string | null; area: string | null } = { type: null, area: null };
    const combo = title + '\n' + body;
    if (/^feat\b/i.test(title)) result.type = 'feature';
    else if (/^fix\b/i.test(title)) result.type = 'bug';
    else if (/^(refactor|chore|docs|test|style)\b/i.test(title)) result.type = 'chore';
    if (/apps\/agents(?:\/|$)/.test(combo)) result.area = 'agent';
    else if (/apps\/wiki(?:\/|$)/.test(combo)) result.area = 'wiki';
    else if (/apps\/crawler(?:\/|$)/.test(combo)) result.area = 'crawler';
    else if (/apps\/ebook(?:\/|$)/.test(combo)) result.area = 'ebook';
    else if (/apps\/viewer(?:\/|$)/.test(combo)) result.area = 'viewer';
    else if (/infra\//.test(combo)) result.area = 'infra';
    return result;
  }

  public async formatAllIssues(): Promise<void> {
    console.log('🔄 전체 이슈 포맷 마이그레이션 시작 (Issue #156)...');

    // 1. 삭제 대상 이슈 close 처리
    const deleteIds = ['97', '130', '131', '111', '112'];
    const allIssues = await this.getIssues();
    const existingIds = new Set(allIssues.map(i => String(i.number)));

    for (const id of deleteIds) {
      if (existingIds.has(id)) {
        try {
          await this.createComment(id, '🧹 테스트/빈 본문 이슈로 확인되어 이슈 포맷 마이그레이션(#156) 과정에서 정리하였습니다.');
          await this.closeIssue(id);
          console.log(`   ✅ #${id} close 완료`);
        } catch (e) {
          console.error(`   ❌ #${id} close 실패:`, (e as Error).message);
        }
      } else {
        console.log(`   ℹ️ #${id} 는 이미 존재하지 않음`);
      }
    }

    // 2. 변환 대상 필터링
    const issues = existingIds.size > 0
      ? allIssues
      : await this.getIssues();

    const toConvert = issues.filter(i => {
      if (deleteIds.includes(String(i.number))) return false;
      if (!i.body || i.body.trim().length === 0) return true;
      const hasAllSections = i.body.includes('## 🎯 Goal') &&
                             i.body.includes('## 🧠 Context Memory') &&
                             i.body.includes('## ✅ Solution') &&
                             i.body.includes('## 🔗 References');
      return !hasAllSections;
    });

    console.log(`   📄 전체 ${issues.length}개, 변환 대상 ${toConvert.length}개`);

    // 3. 변환 실행
    let success = 0, fallback = 0, skipped = 0;

    for (const issue of toConvert) {
      const id = String(issue.number);
      const title = issue.title || '';
      const body = issue.body || '';

      // 이미 변환된 경우 스킵
      if (body.includes('## 🎯 Goal') && body.includes('## 🧠 Context Memory') &&
          body.includes('## ✅ Solution') && body.includes('## 🔗 References')) {
        skipped++;
        continue;
      }

      process.stdout.write(`   ⏳ #${id} 변환 중... (${body.length}자)`);

      const converted = await this.formatIssueWithOllama(title, body);

      if (converted && converted.length > 20) {
        await this.updateIssue(id, title, converted);
        console.log(` ✅`);
        success++;
      } else {
        const fallbackBody = this.buildFallbackBody(title, body);
        await this.updateIssue(id, title, fallbackBody);
        console.log(` ⚠️ fallback`);
        fallback++;
      }

      await new Promise(r => setTimeout(r, 800));
    }

    console.log(`\n📊 변환 완료: 성공 ${success}, fallback ${fallback}, skip ${skipped}`);
  }

  private buildFallbackBody(title: string, body: string): string {
    const sections = body.split('\n## ').filter(s => s.trim());
    let goal = body;
    let context = 'N/A';
    let solution = 'N/A';
    let refs = 'N/A';

    if (sections.length > 1) {
      goal = sections[0].replace(/^#+\s*/, '').trim();
      const remaining = sections.slice(1);
      context = remaining.slice(0, Math.ceil(remaining.length / 2)).join('\n\n## ').trim();
      solution = remaining.slice(Math.ceil(remaining.length / 2)).join('\n\n## ').trim();
    }

    return `# ${title}\n\n## 🎯 Goal\n${goal}\n\n## 🧠 Context Memory\n${context}\n\n## ✅ Solution\n${solution}\n\n## 🔗 References\n${refs}`;
  }

  /**
   * 기존 전체 이슈에 제목 prefix + 변경 파일 경로 기반으로 라벨을 소급 적용합니다.
   * (rule-based, no AI 필요)
   */
  public async retroactiveLabelIssues(): Promise<void> {
    console.log('🏷️  전체 이슈 rule-based 라벨링 시작...');

    let repoLabels = await this.request<any[]>(`/repos/${this.config.repo}/labels`, 'GET');
    if (repoLabels.length === 0) {
      console.log('📭 라벨이 없습니다. seedDefaultLabels()로 기본 라벨을 생성합니다...');
      await this.seedDefaultLabels();
      repoLabels = await this.request<any[]>(`/repos/${this.config.repo}/labels`, 'GET');
    }

    const issues = await this.getIssues();
    const nameToId = new Map<string, number>();
    for (const rl of repoLabels) {
      nameToId.set(rl.name, rl.id);
    }

    const total = issues.length;
    let updated = 0;
    for (let idx = 0; idx < total; idx++) {
      const issue = issues[idx];
      const title = issue.title || '';
      const body = (issue.body || '') + title;
      const currentLabels: { id: number; name: string }[] = (issue as any).labels || [];

      if (currentLabels.length > 0) continue;

      process.stdout.write(`\r⏳ [${idx + 1}/${total}] classifying #${issue.number}...`);

      const ollamaResult = await this.classifyIssueLabels(title, body);
      const labels: string[] = [];
      if (ollamaResult.type) labels.push(ollamaResult.type);
      if (ollamaResult.area) labels.push(ollamaResult.area);

      if (labels.length === 0) continue;

      const labelIds = labels.map(n => nameToId.get(n)).filter((id): id is number => id !== undefined);
      if (labelIds.length === 0) continue;

      await this.request(`/repos/${this.config.repo}/issues/${issue.number}/labels`, 'PUT', {
        labels: labelIds,
      });
      updated++;
    }
    process.stdout.write('\n');
    console.log(`✅ ${updated}/${total}개 이슈에 라벨이 소급 적용되었습니다.`);
  }
}

/**
 * 스크립트 실행의 진입점을 제어하는 Controller
 */
class GiteaController {
  public static async execute(): Promise<void> {
    const args = process.argv.slice(2);
    const action = args[0];

    const config = new Config();
    const client = new GiteaClient(config);

    switch (action) {
      case 'create-issue': {
        let title = '';
        let body = '';
        const bodyFileEnv = process.env.GITEA_BODY_FILE;
        const stdinFlag = args.includes('--stdin');

        if (bodyFileEnv) {
          try {
            body = fs.readFileSync(bodyFileEnv, 'utf-8');
          } catch (e) {
            console.error(`❌ GITEA_BODY_FILE 파일을 읽을 수 없습니다: ${bodyFileEnv}`);
            process.exit(1);
          }
          title = args[1] || '';
        } else if (stdinFlag) {
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) {
            chunks.push(Buffer.from(chunk));
          }
          body = Buffer.concat(chunks).toString('utf-8');
          title = args[1] || '';
        } else {
          title = args[1] || '';
          body = args.slice(2).join(' ');
        }
        if (!title || !body) {
          console.error('Usage: npm run gitea create-issue <title> <body>');
          console.error('  Long body: GITEA_BODY_FILE=<path> npm run gitea create-issue <title>');
          console.error('  Stdin: echo "body" | npm run gitea create-issue <title> --stdin');
          console.error('  Options: --no-label  (라벨 자동 분류 비활성화)');
          process.exit(1);
        }
        const skipLabel = args.includes('--no-label');
        await client.createIssue(title, body, skipLabel);
        break;
      }

      case 'comment':
        if (args.length < 3) {
          console.error('Usage: npm run gitea comment <issueId> <body>');
          console.error('  Long body: GITEA_BODY_FILE=<path> npm run gitea comment <issueId>');
          process.exit(1);
        }
        {
          const bodyFileEnv = process.env.GITEA_BODY_FILE;
          let body = '';
          if (bodyFileEnv) {
            try {
              body = fs.readFileSync(bodyFileEnv, 'utf-8');
            } catch (e) {
              console.error(`❌ GITEA_BODY_FILE 파일을 읽을 수 없습니다: ${bodyFileEnv}`);
              process.exit(1);
            }
          } else {
            body = args.slice(2).join(' ');
          }
          await client.createComment(args[1], body);
        }
        break;

      case 'update-issue':
        if (args.length < 4) {
          console.error('Usage: npm run gitea update-issue <issueId> <title> <body>');
          console.error('  Long body: GITEA_BODY_FILE=<path> npm run gitea update-issue <issueId> <title>');
          process.exit(1);
        }
        {
          const bodyFileEnv = process.env.GITEA_BODY_FILE;
          let body = '';
          if (bodyFileEnv) {
            try {
              body = fs.readFileSync(bodyFileEnv, 'utf-8');
            } catch (e) {
              console.error(`❌ GITEA_BODY_FILE 파일을 읽을 수 없습니다: ${bodyFileEnv}`);
              process.exit(1);
            }
          } else {
            body = args.slice(3).join(' ');
          }
          await client.updateIssue(args[1], args[2], body);
        }
        break;

      case 'update-comment':
        if (args.length < 3) {
          console.error('Usage: npm run gitea update-comment <commentId> <body>');
          process.exit(1);
        }
        await client.updateComment(args[1], args[2]);
        break;

      case 'close-issue':
        if (args.length < 2) {
          console.error('Usage: npm run gitea close-issue <issueId>');
          process.exit(1);
        }
        await client.closeIssue(args[1]);
        break;

      case 'reopen-issue':
        if (args.length < 2) {
          console.error('Usage: npm run gitea reopen-issue <issueId>');
          process.exit(1);
        }
        await client.reopenIssue(args[1]);
        break;

      case 'fix-legacy-issues':
        if (args.length < 2) {
          console.error('Usage: npm run gitea fix-legacy-issues <issueId1> <issueId2> ...');
          process.exit(1);
        }
        const ids = args.slice(1);
        await client.fixLegacyIssues(ids);
        break;

      case 'retroactive-commit-links':
        await client.retroactiveCommitLinks();
        break;

      case 'retroactive-labels':
        await client.retroactiveLabelIssues();
        break;

      case 'seed-labels':
        await client.seedDefaultLabels();
        break;

      case 'update-title':
        if (args.length < 3) {
          console.error('Usage: npm run gitea update-title <issueId> <newTitle>');
          process.exit(1);
        }
        await client.updateIssueTitle(args[1], args[2]);
        break;

      case 'find-title-errors':
        await client.printTitleErrorIssues();
        break;

      case 'show-issue':
        if (args.length < 2) {
          console.error('Usage: npm run gitea show-issue <issueId>');
          process.exit(1);
        }
        await client.printIssueBody(args[1]);
        break;

      case 'generate-token':
        await client.generateToken();
        break;

      case 'generate-token-tea':
        await client.generateTokenWithTea();
        break;

      case 'init':
        await client.initGitea();
        break;

      case 'repo:dump':
        await client.repoDump(args[1] || 'data/dumps/gitea');
        break;

      case 'repo:restore':
        if (!args[1]) { console.error('Usage: npm run gitea repo:restore <dumpDir>'); process.exit(1); }
        await client.repoRestore(args[1]);
        break;

      case 'issue:dump':
        await client.dumpIssue(args[1] || 'data/dumps/gitea', args[2]);
        break;

      case 'issue:restore':
        if (!args[1]) { console.error('Usage: npm run gitea issue:restore <file>'); process.exit(1); }
        await client.restoreIssue(args[1]);
        break;

      case 'wiki:init':
        await client.wikiInit(args[1]);
        break;

      case 'wiki:dump':
        await client.dumpWiki(args[1] || 'data/dumps/gitea');
        break;

      case 'wiki:restore':
        if (!args[1]) { console.error('Usage: npm run gitea wiki:restore <wikiDir>'); process.exit(1); }
        await client.restoreWiki(args[1]);
        break;

      case 'issue:save':
        await client.issueSave();
        break;

      case 'list-issues': {
        const allIssues = await client.getIssues();
        const state = args[1] || 'open';
        const limit = parseInt(args[2], 10) || 20;
        const filtered = state === 'all' ? allIssues : allIssues.filter(i => i.state === state);
        const sliced = filtered.slice(0, limit);
        if (sliced.length === 0) {
          console.log('📭 표시할 이슈가 없습니다.');
          break;
        }
        console.log(`📋 최근 이슈 ${sliced.length}개 (전체 ${filtered.length}개, state=${state}):\n`);
        sliced.forEach(i => {
          const label = i.state === 'closed' ? '✅' : '🟢';
          const date = (i.created_at || '').slice(0, 10);
          const title = i.title.length > 50 ? i.title.slice(0, 47) + '...' : i.title;
          console.log(`  ${label} #${String(i.number).padStart(3)}  ${date}  ${title}`);
        });
        console.log(`\n💡 상세: task git:issue:show ISSUE_ID="번호"`);
        break;
      }

      case 'format-issues':
        await client.formatAllIssues();
        break;

      default:
        console.error('❌ 알 수 없는 작업명입니다. 지원하는 명령어: create-issue, update-issue, comment, update-comment, close-issue, reopen-issue, update-title, show-issue, list-issues, find-title-errors, fix-legacy-issues, retroactive-commit-links, retroactive-labels, seed-labels, generate-token, generate-token-tea, init, repo:dump, repo:restore, issue:dump, issue:restore, wiki:init, wiki:dump, wiki:restore, issue:save, format-issues');
        process.exit(1);
    }
  }
}

GiteaController.execute();
