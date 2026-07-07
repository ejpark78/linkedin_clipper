/**
 * ==============================================================================
 * 🤖 Local Static Code Reviewer Script (review-changes.ts)
 * ==============================================================================
 * @description  수정되거나 스테이징된 파일들을 탐색하여 Docker 내부 혹은
 *               로컬 환경에서 오프라인 린트 및 타입 체크를 수행하는 정적 검증기입니다.
 * @constraints  네트워크 요청 없이 오프라인으로만 작동합니다.
 *               Strict Typing 및 OOP Patterns 아키텍처 규칙을 상시 준수합니다.
 * @dependencies git CLI, Docker Compose, Node.js child_process
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
 * 정적 검증 환경(Docker 컨테이너 여부 등)을 파싱하는 Config 클래스
 */
class ReviewConfig {
  public readonly isContainer: boolean;
  public readonly runningWorkerId: string;

  constructor() {
    this.isContainer = fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv');
    this.runningWorkerId = this.runCmdOutput('docker compose ps -q worker');
  }

  private runCmdOutput(cmd: string): string {
    try {
      return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch {
      return '';
    }
  }
}

/**
 * 변경된 파일 검사 및 린트/타입체크를 실질 수행하는 Verifier 클래스
 */
class CodeVerifier {
  private config: ReviewConfig;

  constructor(config: ReviewConfig) {
    this.config = config;
  }

  private runCmdOutput(cmd: string): string {
    try {
      return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch {
      return '';
    }
  }

  public getModifiedFiles(): string[] {
    const diff1 = this.runCmdOutput('git diff --name-only').split('\n').filter(Boolean);
    const diff2 = this.runCmdOutput('git diff --cached --name-only').split('\n').filter(Boolean);
    return Array.from(new Set([...diff1, ...diff2])).filter((file) => fs.existsSync(file));
  }

  public runLintCheck(targetFile: string): string {
    const isCrawler = targetFile.startsWith('apps/crawler/');
    const isViewer = targetFile.startsWith('apps/viewer/');
    if (!isCrawler && !isViewer) return '';

    const prefix = isCrawler ? 'apps/crawler' : 'apps/viewer';

    if (!this.config.isContainer && this.config.runningWorkerId) {
      // Proxying to docker container
      try {
        return execSync(`docker compose exec -T worker npm run lint --prefix ${prefix} -- --quiet`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      } catch (e) {
        const err = e as Error;
        return err.message;
      }
    } else {
      // Local fallback
      if (fs.existsSync(`${prefix}/node_modules`)) {
        try {
          return execSync(`npm run lint --prefix ${prefix} -- --quiet`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
        } catch (e) {
          const err = e as Error;
          return err.message;
        }
      }
    }
    return '';
  }

  public runTypeChecking(): string {
    if (!this.config.isContainer && this.config.runningWorkerId) {
      try {
        return execSync('docker compose exec -T worker npm run type-check', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      } catch (e) {
        const err = e as Error;
        return err.message;
      }
    } else {
      if (fs.existsSync('apps/crawler/node_modules')) {
        try {
          return execSync('npm run type-check --prefix apps/crawler', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
        } catch (e) {
          const err = e as Error;
          return err.message;
        }
      }
    }
    return '';
  }
}

/**
 * 전체 검증 흐름을 조율하는 Controller 클래스
 */
class ReviewController {
  public static execute(): void {
    console.log('🔍 Running offline local static code review on modified files...');

    const config = new ReviewConfig();
    const verifier = new CodeVerifier(config);

    const modifiedFiles = verifier.getModifiedFiles();

    if (modifiedFiles.length === 0) {
      console.log('✨ No local code changes detected (working tree clean).');
      process.exit(0);
    }

    console.log('📄 Modified Files List:');
    let hasTsChanges = false;

    for (const file of modifiedFiles) {
      console.log(`  - ${file}`);
      if (/\.tsx?$/.test(file) || /\.jsx?$/.test(file)) {
        hasTsChanges = true;
      }
    }
    console.log('');

    console.log('🏃 Running lint diagnostics...');
    let lintErrors = '';

    for (const file of modifiedFiles) {
      if (/\.tsx?$/.test(file) || /\.jsx?$/.test(file)) {
        const lintOut = verifier.runLintCheck(file);
        if (lintOut && (lintOut.includes('error') || lintOut.includes('warning'))) {
          lintErrors += `${lintOut}\n`;
        }
      }
    }

    let hasErrors = false;

    if (lintErrors) {
      console.warn('⚠️  Lint issues detected:\n');
      console.warn(lintErrors);
      hasErrors = true;
    } else {
      console.log('✅ Clean! No lint issues detected.');
    }

    // TypeScript Type Checking
    if (hasTsChanges) {
      console.log('\n🏃 Running TypeScript Type Checking...');
      const tscOut = verifier.runTypeChecking();

      if (tscOut) {
        console.log(tscOut);
        if (tscOut.includes('error')) {
          console.warn('⚠️  TypeScript compilation contains errors.');
          hasErrors = true;
        } else {
          console.log('✅ TypeScript Compilation Clean!');
        }
      } else {
        console.log('No compilation diagnostics run.');
      }
    }

    console.log('');
    if (hasErrors) {
      console.error('❌ Local static validation failed. Please fix the errors before committing.');
      process.exit(1);
    } else {
      console.log('🎯 Final Local Verdict: [Complete] Local static validation passed.');
      process.exit(0);
    }
  }
}

// Execution Entrypoint
ReviewController.execute();
