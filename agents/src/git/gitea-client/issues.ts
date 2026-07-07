/**
 * issues.ts — Gitea issue CRUD operations.
 *
 * Design context: Thin API wrappers for issue/comment CRUD.
 * LabelService integration is handled by the composite GiteaClient.
 *
 * Dependencies: base (BaseGiteaClient, IssueResponse, CommentResponse)
 */

import { BaseGiteaClient, IssueResponse, CommentResponse } from './base';

export class IssuesClient extends BaseGiteaClient {
  async getIssues(): Promise<IssueResponse[]> {
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

  async getIssue(issueId: string): Promise<IssueResponse> {
    return await this.request<IssueResponse>(`/repos/${this.config.repo}/issues/${issueId}`, 'GET');
  }

  async getComments(issueId: string): Promise<CommentResponse[]> {
    return await this.request<CommentResponse[]>(
      `/repos/${this.config.repo}/issues/${issueId}/comments`,
      'GET',
    );
  }

  async getTimeline(issueId: string): Promise<{ type: string; event: string; commit_id?: string }[]> {
    return await this.request<{ type: string; event: string; commit_id?: string }[]>(
      `/repos/${this.config.repo}/issues/${issueId}/timeline`,
      'GET',
    );
  }

  async updateIssue(issueId: string, title: string, body: string): Promise<void> {
    if (!body || !body.trim()) {
      console.warn(`Issue #${issueId}: body is empty, skipping PATCH`);
      const issue = await this.getIssue(issueId);
      body = issue.body || '';
    }
    await this.request<void>(
      `/repos/${this.config.repo}/issues/${issueId}`,
      'PATCH',
      { title, body },
    );
  }

  async createIssueRaw(title: string, body: string): Promise<IssueResponse> {
    return await this.request<IssueResponse>(
      `/repos/${this.config.repo}/issues`,
      'POST',
      { title, body },
    );
  }

  async addLabels(issueNumber: number, labelIds: number[]): Promise<void> {
    await this.request(
      `/repos/${this.config.repo}/issues/${issueNumber}/labels`,
      'PUT',
      { labels: labelIds },
    );
  }

  async getRepoLabels(): Promise<{ id: number; name: string }[]> {
    return await this.request<{ id: number; name: string }[]>(
      `/repos/${this.config.repo}/labels`,
      'GET',
    );
  }

  async createComment(issueId: string, body: string): Promise<void> {
    console.log(`Adding comment to issue #${issueId}...`);
    const data = await this.request<CommentResponse>(
      `/repos/${this.config.repo}/issues/${issueId}/comments`,
      'POST',
      { body },
    );
    console.log(`Comment added! [ID: ${data.id}]`);
  }

  async updateComment(commentId: string, body: string): Promise<void> {
    console.log(`Updating comment #${commentId}...`);
    await this.request<void>(
      `/repos/${this.config.repo}/issues/comments/${commentId}`,
      'PATCH',
      { body },
    );
    console.log(`Comment #${commentId} updated.`);
  }

  async closeIssue(issueId: string): Promise<void> {
    console.log(`Closing issue #${issueId}...`);
    const issue = await this.getIssue(issueId);
    await this.request<void>(
      `/repos/${this.config.repo}/issues/${issueId}`,
      'PATCH',
      { state: 'closed', body: issue.body || '' },
    );
    console.log(`Issue #${issueId} closed.`);
  }

  async reopenIssue(issueId: string): Promise<void> {
    console.log(`Reopening issue #${issueId}...`);
    const issue = await this.getIssue(issueId);
    await this.request<void>(
      `/repos/${this.config.repo}/issues/${issueId}`,
      'PATCH',
      { state: 'open', body: issue.body || '' },
    );
    console.log(`Issue #${issueId} reopened.`);
  }

  async printIssueBody(issueId: string): Promise<void> {
    const issue = await this.getIssue(issueId);
    console.log(`====== Issue #${issue.number} Body ======`);
    console.log(issue.body);
    console.log('========================================');
  }

  async printIssueJson(issueId: string): Promise<void> {
    const issue = await this.request<Record<string, unknown>>(
      `/repos/${this.config.repo}/issues/${issueId}`,
      'GET',
    );
    console.log(JSON.stringify(issue, null, 2));
  }

  async printIssuesJson(state: string, limit: number): Promise<void> {
    const issues = await this.getIssues();
    const filtered = state === 'all' ? issues : issues.filter(i => i.state === state);
    const sliced = filtered.slice(0, limit);
    console.log(JSON.stringify(sliced, null, 2));
  }

  async createIssueViaApi(title: string, body: string): Promise<{ number: number; html_url: string }> {
    const data = await this.request<IssueResponse>(
      `/repos/${this.config.repo}/issues`,
      'POST',
      { title, body },
    );
    return { number: data.number, html_url: data.html_url };
  }
}
