/**
 * config.ts — Centralized configuration for git/Gitea tooling.
 *
 * Design context: Single source of truth for env vars, CLI args,
 * and LLM backend selection. All other classes receive Config
 * via constructor injection — never access process.env directly.
 *
 * Dependencies: util (loadEnv, findProjectRoot), llm-backend (LLmBackend, OllamaBackend, LlamaCppBackend)
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { loadEnv, findProjectRoot } from './util';
import { LLmBackend, OllamaBackend, LlamaCppBackend } from './llm-backend';

const DEFAULT_LLM_URL = 'http://host.docker.internal:11434';
const DEFAULT_LLM_MODEL = 'qwen3.5:9b-mlx';
const DEFAULT_GITEA_API_URL = 'http://gitea:3000/api/v1';
const DEFAULT_GITEA_REPO = 'gitea/scraper';

export class Config {
  public readonly apiUrl: string;
  public readonly accessToken: string | undefined;
  public readonly repo: string;
  public readonly llmBackend: LLmBackend;
  public readonly isContainer: boolean;
  public readonly runningWorkerId: string;
  public readonly autoMerge: boolean;
  public readonly issueId: string | null;

  constructor() {
    const projectRoot = findProjectRoot(process.env.INIT_CWD || __dirname);
    process.chdir(projectRoot);
    loadEnv();

    this.apiUrl = process.env.GITEA_API_URL || DEFAULT_GITEA_API_URL;
    this.repo = process.env.GITEA_REPO || DEFAULT_GITEA_REPO;
    this.accessToken = process.env.GITEA_ACCESS_TOKEN || process.env.GITEA_API_TOKEN;
    this.llmBackend = this.createLlmBackend();

    this.isContainer = fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv');
    this.runningWorkerId = this.runCmdOutput('docker compose ps -q worker');

    const args = process.argv.slice(2);
    this.autoMerge = !args.includes('--no-merge');
    this.issueId = this.parseIssueId(args);
  }

  private createLlmBackend(): LLmBackend {
    const backendType = process.env.LLM_BACKEND || 'ollama';
    const llmUrl = process.env.LLM_URL || DEFAULT_LLM_URL;
    const llmModel = process.env.LLM_MODEL || DEFAULT_LLM_MODEL;
    if (backendType === 'llamacpp') {
      return new LlamaCppBackend(llmUrl);
    }
    return new OllamaBackend(llmUrl, llmModel);
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
