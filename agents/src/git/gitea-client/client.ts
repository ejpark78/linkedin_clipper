/**
 * client.ts — GiteaClient composite (facade over sub-clients).
 *
 * Design context: Provides backward-compatible API surface for
 * consumers (ReleaseCoordinator, GitController) by delegating
 * to domain-specific sub-clients: IssuesClient, AdminClient,
 * WikiClient, DumpClient.
 *
 * Dependencies: config (Config), git-service (GitService), sub-clients
 */

import { Config } from '../config';
import { GitService } from '../git-service';
import { LabelService } from '../label-service';
import { IssuesClient } from './issues';
import { AdminClient } from './admin';
import { WikiClient } from './wiki';
import { DumpClient } from './dump';
import { IssueResponse } from './base';

export class GiteaClient {
  public readonly issues: IssuesClient;
  public readonly admin: AdminClient;
  public readonly wiki: WikiClient;
  public readonly dump: DumpClient;

  private config: Config;

  constructor(config: Config, git: GitService, labelService?: LabelService) {
    this.config = config;
    this.issues = new IssuesClient(config);
    this.admin = new AdminClient(config);
    this.wiki = new WikiClient(config);
    this.dump = new DumpClient(config, git);
  }

  // ---- Delegated Issue Operations ----

  async getIssues(): Promise<IssueResponse[]> {
    return this.issues.getIssues();
  }

  async getIssue(issueId: string): Promise<IssueResponse> {
    return this.issues.getIssue(issueId);
  }

  async getComments(issueId: string): Promise<{ id: number; body: string; created_at: string }[]> {
    return this.issues.getComments(issueId);
  }

  async getTimeline(issueId: string): Promise<{ type: string; event: string; commit_id?: string }[]> {
    return this.issues.getTimeline(issueId);
  }

  async updateIssue(issueId: string, title: string, body: string): Promise<void> {
    return this.issues.updateIssue(issueId, title, body);
  }

  async createIssue(title: string, body: string, skipLabel?: boolean, labelService?: LabelService): Promise<number> {
    console.log(`Creating Gitea issue... [${title}]`);
    const data = await this.issues.createIssueRaw(title, body);
    console.log(`Issue created! [#${data.number}]`);
    console.log(`URL: ${data.html_url}`);

    if (!skipLabel) {
      const labeler: LabelService = labelService || new LabelService(this.config.llmBackend);
      const llmLabels = await labeler.classifyWithLLM(title, body);
      let labelNames: string[] = [];
      if (llmLabels.type || llmLabels.area) {
        labelNames = [llmLabels.type, llmLabels.area].filter((l): l is string => l !== null);
      } else {
        labelNames = labeler.classifyByRule(title, body);
      }
      if (labelNames.length > 0) {
        const repoLabels = await this.issues.getRepoLabels();
        const nameToId = new Map(repoLabels.map(l => [l.name, l.id]));
        const labelIds = labelNames.map(n => nameToId.get(n)).filter((id): id is number => id !== undefined);
        if (labelIds.length > 0) {
          await this.issues.addLabels(data.number, labelIds);
          console.log(`Labels auto-classified: ${labelNames.join(', ')}`);
        }
      }
    }
    return data.number;
  }

  async createComment(issueId: string, body: string): Promise<void> {
    return this.issues.createComment(issueId, body);
  }

  async updateComment(commentId: string, body: string): Promise<void> {
    return this.issues.updateComment(commentId, body);
  }

  async closeIssue(issueId: string): Promise<void> {
    return this.issues.closeIssue(issueId);
  }

  async reopenIssue(issueId: string): Promise<void> {
    return this.issues.reopenIssue(issueId);
  }

  async printIssueBody(issueId: string): Promise<void> {
    return this.issues.printIssueBody(issueId);
  }

  async printIssueJson(issueId: string): Promise<void> {
    return this.issues.printIssueJson(issueId);
  }

  async printIssuesJson(state: string, limit: number): Promise<void> {
    return this.issues.printIssuesJson(state, limit);
  }

  // ---- Delegated Token Operations ----

  async generateTokenWithTea(): Promise<void> {
    return this.admin.generateTokenWithTea();
  }

  async generateToken(): Promise<void> {
    return this.admin.generateToken();
  }

  // ---- Delegated Init ----

  async initGitea(): Promise<void> {
    return this.admin.initGitea();
  }

  async seedDefaultLabels(): Promise<void> {
    return this.admin.seedDefaultLabels();
  }

  // ---- Delegated Wiki Operations ----

  async wikiInit(fromDir?: string): Promise<void> {
    return this.wiki.wikiInit(fromDir);
  }

  async dumpWiki(targetDir: string): Promise<void> {
    return this.wiki.dumpWiki(targetDir);
  }

  async restoreWiki(wikiDir: string): Promise<void> {
    return this.wiki.restoreWiki(wikiDir);
  }

  // ---- Delegated Dump/Restore Operations ----

  async repoDump(targetDir: string): Promise<void> {
    return this.dump.repoDump(targetDir);
  }

  async repoRestore(dumpDir: string): Promise<void> {
    return this.dump.repoRestore(dumpDir);
  }

  async dumpIssue(targetDir: string, issueId?: string): Promise<void> {
    return this.dump.dumpIssue(targetDir, issueId);
  }

  async restoreIssue(filePath: string): Promise<void> {
    return this.dump.restoreIssue(filePath);
  }

  async issueSave(): Promise<void> {
    return this.dump.issueSave();
  }
}
