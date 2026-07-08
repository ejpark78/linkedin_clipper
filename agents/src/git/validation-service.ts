/**
 * validation-service.ts — Static code review and validation pipeline.
 *
 * Design context: Pre-commit validation that runs lint, type-check,
 * and app-specific verification scripts. Supports both containerized
 * (Docker compose exec) and local execution modes.
 *
 * Dependencies: config (Config), git-service (GitService)
 */

import * as fs from 'fs';
import { execSync } from 'child_process';
import { Config } from './config';
import { GitService } from './git-service';

export class ValidationService {
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
    const isCrawler = targetFile.startsWith('projects/crawler/');
    const isViewer = targetFile.startsWith('projects/viewer/');
    if (!isCrawler && !isViewer) return '';

    const prefix = isCrawler ? 'projects/crawler' : 'projects/viewer';

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
      if (fs.existsSync('projects/crawler/node_modules')) {
        return this.git.runCmd('npm run type-check --prefix projects/crawler', true);
      }
    }
    return '';
  }

  runPackageVerification(stagedFiles: string[]): void {
    let runCrawler = false;
    let runViewer = false;
    let runEbook = false;

    for (const file of stagedFiles) {
      if (file.startsWith('projects/crawler/')) runCrawler = true;
      else if (file.startsWith('projects/viewer/')) runViewer = true;
      else if (file.startsWith('projects/ebook/')) runEbook = true;
    }

    if (runCrawler && fs.existsSync('projects/crawler/scripts/lint.sh')) {
      console.log('Executing projects/crawler/scripts/lint.sh...');
      this.runScript('./projects/crawler/scripts/lint.sh', 'Crawler');
    }

    if (runViewer && fs.existsSync('projects/viewer/scripts/lint.sh')) {
      console.log('Executing projects/viewer/scripts/lint.sh...');
      this.runScript('./projects/viewer/scripts/lint.sh', 'Viewer');
    }

    if (runEbook && fs.existsSync('projects/ebook/scripts/lint.sh')) {
      console.log('Executing projects/ebook/scripts/lint.sh...');
      this.runScript('./projects/ebook/scripts/lint.sh', 'Ebook');
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
