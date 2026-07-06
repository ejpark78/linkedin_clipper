/**
 * ==============================================================================
 * 🤖 Develop to Main Sync & Push Helper Script (push-changes.ts)
 * ==============================================================================
 * @description  develop 브랜치의 변경 이력을 main 브랜치에 안전하게 병합하고,
 *               두 브랜치를 모두 origin 원격 저장소에 Push하는 배포 자동화 스크립트입니다.
 * @constraints  작업 중 미커밋 변경 파일 존재 시 실행 차단(fail fast).
 *               Strict Typing 및 OOP Patterns 아키텍처 규칙을 상시 준수합니다.
 * @dependencies git CLI, Node.js child_process
 * @lastUpdated  2026-06-29
 * ==============================================================================
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// 스크립트 실행 디렉토리에 관계없이 프로젝트 루트 디렉토리를 CWD로 고정
const projectRoot = path.resolve(__dirname, '..', '..');
process.chdir(projectRoot);

/**
 * 릴리즈 환경변수를 래핑하는 ReleaseConfig 클래스
 */
class ReleaseConfig {
  public readonly accessToken: string | undefined;
  public readonly repo: string;

  constructor() {
    this.loadEnv();
    this.repo = process.env.GITEA_REPO || 'gitea/scraper';
    this.accessToken = process.env.GITEA_ACCESS_TOKEN || process.env.GITEA_API_TOKEN;
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
 * Git 릴리즈 커맨드 수행을 위한 GitReleaseService 클래스
 */
class GitReleaseService {
  public runCmd(cmd: string): void {
    try {
      execSync(cmd, { encoding: 'utf-8', stdio: 'inherit' });
    } catch (error) {
      const err = error as Error;
      console.error(`❌ 명령어 실행 실패: ${cmd}`);
      console.error(err.message);
      process.exit(1);
    }
  }

  public runCmdOutput(cmd: string): string {
    try {
      return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch (error) {
      const err = error as Error;
      console.error(`❌ 명령어 실행 실패 (출력 획득 실패): ${cmd}`);
      console.error(err.message);
      process.exit(1);
    }
  }
}

/**
 * 릴리즈 자동화 흐름을 관리하는 ReleaseHelper 클래스
 */
class ReleaseHelper {
  private git: GitReleaseService;
  private config: ReleaseConfig;

  constructor(git: GitReleaseService, config: ReleaseConfig) {
    this.git = git;
    this.config = config;
  }

  public execute(): void {
    console.log('🚀 push-changes release sequence 시작...');

    if (!this.config.accessToken) {
      console.error('❌ ERROR: GITEA_ACCESS_TOKEN이 설정되어 있지 않아 원격지 Push를 수행할 수 없습니다.');
      process.exit(1);
    }

    // 로컬 Traefik 도메인 및 SSL 인증 에러 우회를 위한 로컬 바이패스 주입
    this.git.runCmd('git config http.sslVerify false');

    const currentBranch = this.git.runCmdOutput('git rev-parse --abbrev-ref HEAD');

    if (currentBranch !== 'develop') {
      console.log(`⚠️  WARNING: 현재 브랜치가 '${currentBranch}' 입니다 ('develop'이어야 함).`);
      console.log("   자동으로 'develop' 브랜치로 전환을 시도합니다...");

      const statusPorcelain = this.git.runCmdOutput('git status --porcelain');
      if (statusPorcelain) {
        console.error('❌ ERROR: 커밋되지 않은 변경 사항이 작업 디렉토리에 있습니다. 먼저 커밋하거나 Stash 하십시오.');
        process.exit(1);
      }

      this.git.runCmd('git checkout develop');
    }

    const pushUser = process.env.GITEA_ADMIN_USER || 'gitea-admin';
    const gitHost = new URL(process.env.GITEA_API_URL || 'https://git.localhost/api/v1').host;
    const pushUrl = `https://${pushUser}:${this.config.accessToken}@${gitHost}/${this.config.repo}.git`;

    console.log("🚀 로컬 'develop' 브랜치를 origin에 push 중...");
    this.git.runCmd(`git push "${pushUrl}" develop`);

    console.log("🔀 'develop' 변경 사항을 'main' 브랜치에 merge 중...");
    this.git.runCmd('git checkout main');

    try {
      this.git.runCmd('git merge develop');
    } catch (error) {
      console.error('❌ ERROR: 머지 충돌이 감지되었습니다! 원래의 develop 브랜치로 원복합니다.');
      this.git.runCmd('git merge --abort');
      this.git.runCmd('git checkout develop');
      process.exit(1);
    }

    console.log("🚀 로컬 'main' 브랜치를 origin에 push 중...");
    this.git.runCmd(`git push "${pushUrl}" main`);

    console.log("🔙 'develop' 브랜치로 복귀 중...");
    this.git.runCmd('git checkout develop');

    console.log('🎉 main 및 develop 브랜치의 병합 및 원격지 push가 정상 완료되었습니다.');
  }
}

// Global Execution Entrypoint
const releaseConfig = new ReleaseConfig();
const gitService = new GitReleaseService();
const releaseHelper = new ReleaseHelper(gitService, releaseConfig);
releaseHelper.execute();
