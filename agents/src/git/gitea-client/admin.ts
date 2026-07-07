/**
 * admin.ts — Gitea admin operations (token, init, labels).
 *
 * Design context: One-time setup operations for Gitea instances.
 * Includes token generation (direct API + tea CLI), repo init,
 * and default label seeding. These are typically run during
 * initial environment provisioning.
 *
 * Dependencies: base (BaseGiteaClient, TokenResponse, RepoLabel)
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { BaseGiteaClient, TokenResponse, RepoLabel } from './base';

const DEFAULT_LABELS: RepoLabel[] = [
  { id: 0, name: 'bug',     color: '#d73a4a', description: 'Bug fix' },
  { id: 0, name: 'feature', color: '#a2eeef', description: 'New feature' },
  { id: 0, name: 'chore',   color: '#bfdadc', description: 'Refactor/chore/docs' },
  { id: 0, name: 'agent',   color: '#0075ca', description: 'agents app' },
  { id: 0, name: 'wiki',    color: '#0e8a16', description: 'wiki app (joplin/obsidian)' },
  { id: 0, name: 'crawler', color: '#e4e669', description: 'crawler app' },
  { id: 0, name: 'ebook',   color: '#f0ad4e', description: 'ebook app' },
  { id: 0, name: 'viewer',  color: '#5319e7', description: 'viewer app' },
  { id: 0, name: 'infra',   color: '#b60205', description: 'Docker/infra setup' },
];

export class AdminClient extends BaseGiteaClient {
  async generateTokenWithTea(): Promise<void> {
    console.log('Setting up tea login and checking token...');
    try {
      execSync('tea logins delete local-gitea >/dev/null 2>&1', { stdio: 'ignore' });
    } catch {
      console.warn('AdminClient: tea login delete failed (ignored)');
    }

    try {
      const teaUser = process.env.GITEA_ADMIN_USER || 'gitea-admin';
      const teaPass = process.env.GITEA_ADMIN_PASSWORD || 'admin12345';
      execSync(
        `tea logins add --name local-gitea --url https://${this.gitHost} --user ${teaUser} --password ${teaPass} --insecure`,
        { stdio: 'inherit' },
      );
    } catch (e) {
      const err = e as Error;
      console.error('tea login add failed:', err.message);
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
            console.log(`tea API token: ${token}`);
            return;
          }
          if (inLogin && trimmed.startsWith('-')) {
            inLogin = false;
          }
        }
      }
    }
    console.error('tea token not found.');
    process.exit(1);
  }

  async generateToken(): Promise<void> {
    console.log('Generating new API token...');
    const baseUrl = this.config.apiUrl;
    const username = process.env.GITEA_ADMIN_USER || 'gitea-admin';
    const password = process.env.GITEA_ADMIN_PASSWORD || 'admin12345';
    const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');

    try {
      const listResponse = await fetch(`${baseUrl}/users/${username}/tokens`, {
        method: 'GET',
        headers: { 'Authorization': `Basic ${basicAuth}` },
      });
      if (listResponse.ok) {
        const tokens = (await listResponse.json()) as TokenResponse[];
        for (const token of tokens) {
          await fetch(`${baseUrl}/users/${username}/tokens/${token.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Basic ${basicAuth}` },
          });
        }
        if (tokens.length > 0) {
          console.log(`Cleaned ${tokens.length} existing tokens.`);
        }
      }

      const tokenName = `antigravity-token-${Math.floor(Date.now() / 1000)}`;
      const createResponse = await fetch(`${baseUrl}/users/${username}/tokens`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${basicAuth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tokenName, scopes: ['all'] }),
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        throw new Error(`Token creation failed: ${createResponse.status} ${errorText}`);
      }

      const newToken = (await createResponse.json()) as TokenResponse;
      if (newToken.sha1) {
        console.log(`New token created: ${newToken.sha1}`);
        console.log(`Name: ${newToken.name}`);
        console.log(`\nAdd to .env:\n  GITEA_ACCESS_TOKEN=${newToken.sha1}\n`);
      }
    } catch (error) {
      const err = error as Error;
      console.error('Token generation error:', err.message);
      process.exit(1);
    }
  }

  async initGitea(): Promise<void> {
    console.log('Starting Gitea initialization...');
    const baseUrl = this.config.apiUrl;
    const username = process.env.GITEA_ADMIN_USER || 'gitea-admin';
    const password = process.env.GITEA_ADMIN_PASSWORD || 'admin12345';
    const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');
    const authHeader = { 'Authorization': `Basic ${basicAuth}` };

    const repoRes = await fetch(`${baseUrl}/repos/${this.config.repo}`, { headers: authHeader });
    if (repoRes.ok) {
      console.log(`Repository ${this.config.repo} already exists.`);
    } else {
      console.log('Creating repository...');
      const repoName = this.config.repo.split('/')[1];
      const createRes = await fetch(`${baseUrl}/user/repos`, {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: repoName, private: true, auto_init: false }),
      });
      if (!createRes.ok) {
        const err = await createRes.text();
        throw new Error(`Repo creation failed: ${createRes.status} ${err}`);
      }
      console.log(`Repository ${this.config.repo} created!`);
    }

    const tokenName = `opencode-token-${Math.floor(Date.now() / 1000)}`;
    const createRes = await fetch(`${baseUrl}/users/${username}/tokens`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: tokenName, scopes: ['all'] }),
    });
    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Token creation failed: ${createRes.status} ${err}`);
    }
    const newToken = (await createRes.json()) as TokenResponse;
    const token = newToken.sha1;

    if (!token) {
      throw new Error('Token creation returned no sha1');
    }

    console.log(`Token created: ${token}`);
    const envPath = path.resolve(process.cwd(), '.env');
    let envContent = fs.readFileSync(envPath, 'utf-8');
    envContent = envContent.replace(/^(GITEA_ACCESS_TOKEN=).*/m, `$1${token}`);
    envContent = envContent.replace(/^(GITEA_API_TOKEN=).*/m, `$1${token}`);
    fs.writeFileSync(envPath, envContent);
    console.log('.env file updated with token.');

    try {
      execSync('git remote remove gitea 2>/dev/null', { stdio: 'ignore' });
    } catch {
      console.warn('AdminClient: no existing gitea remote to remove');
    }
    execSync(`git remote add gitea https://gitea:${token}@${this.gitHost}/${this.config.repo}.git`, { stdio: 'inherit' });
    execSync('git push gitea main', { stdio: 'inherit' });
    await this.seedDefaultLabels();
    console.log('Gitea initialization complete!');
  }

  async seedDefaultLabels(): Promise<void> {
    console.log('Creating default labels...');
    for (const label of DEFAULT_LABELS) {
      try {
        await this.request(`/repos/${this.config.repo}/labels`, 'POST', label);
      } catch (err) {
        console.warn(`AdminClient: failed to create label '${label.name}' — ${err}`);
      }
    }
    console.log('Default labels created!');
  }
}
