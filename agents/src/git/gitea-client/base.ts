/**
 * base.ts — Base HTTP client for Gitea API.
 *
 * Design context: Shared request logic, URL normalization, and
 * type definitions for all Gitea API clients. Subclasses
 * extend this to provide domain-specific operations.
 *
 * Dependencies: config (Config)
 */

import { Config } from '../config';

export interface LabelInfo {
  name: string;
  color: string;
}

export interface IssueResponse {
  number: number;
  title: string;
  body: string;
  state: string;
  created_at: string;
  html_url: string;
  labels?: LabelInfo[];
}

export interface CommentResponse {
  id: number;
  body: string;
  created_at: string;
}

export interface TokenResponse {
  id: number;
  name: string;
  sha1?: string;
}

export interface TimelineEvent {
  type: string;
  event: string;
  commit_id?: string;
}

export interface DumpIssue {
  original_number: number;
  title: string;
  body: string;
  state: string;
  created_at: string;
  labels: LabelInfo[];
  comments: { body: string; created_at: string }[];
}

export interface RepoLabel {
  id: number;
  name: string;
  color: string;
  description?: string;
}

export abstract class BaseGiteaClient {
  protected readonly config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  protected async request<T>(endpoint: string, method: string, body?: object): Promise<T> {
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

      const text = await response.text();
      if (!text) return undefined as unknown as T;
      return JSON.parse(text) as T;
    } catch (error) {
      const err = error as Error;
      throw new Error(`API error [${method} ${url}]: ${err.message}`);
    }
  }

  protected get gitHost(): string {
    return new URL(this.config.apiUrl).host;
  }

  protected normalizeCommitLinks(text: string): string {
    const domain = this.config.apiUrl.replace(/\/api\/v1\/?$/, '');
    const [owner, repo] = this.config.repo.split('/');
    return text.replace(
      /https:\/\/[^/]+\/[^/]+\/[^/]+\/commit\//g,
      `${domain}/${owner}/${repo}/commit/`
    );
  }
}
