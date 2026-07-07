/**
 * wiki.ts — Gitea wiki operations.
 *
 * Design context: Git-based wiki management via Gitea API + git CLI.
 * Supports init (create + push), dump (clone), and restore (mirror push).
 *
 * Dependencies: base (BaseGiteaClient)
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { BaseGiteaClient } from './base';

export class WikiClient extends BaseGiteaClient {
  async wikiInit(fromDir?: string): Promise<void> {
    const baseUrl = this.config.apiUrl;
    const token = this.config.accessToken;

    if (!token) {
      console.error('GITEA_ACCESS_TOKEN required for wiki init');
      process.exit(1);
    }

    const repoRes = await fetch(`${baseUrl}/repos/${this.config.repo}`, {
      method: 'GET',
      headers: { 'Authorization': `token ${token}` },
    });
    const repoData = (await repoRes.json()) as { has_wiki?: boolean };
    if (!repoData.has_wiki) {
      console.log('Enabling wiki...');
      await fetch(`${baseUrl}/repos/${this.config.repo}`, {
        method: 'PATCH',
        headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ has_wiki: true }),
      });
    }

    const tmpDir = path.resolve(fromDir || 'data/dumps/gitea/wiki-init');
    fs.mkdirSync(tmpDir, { recursive: true });

    if (!fromDir) {
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
    } catch {
      console.warn('WikiClient: remote add failed (ignored)');
    }
    execSync(`cd ${tmpDir} && git push -u origin main --force`, { stdio: 'inherit' });
    console.log('Wiki initialized!');
  }

  async dumpWiki(targetDir: string): Promise<void> {
    const dir = path.resolve(targetDir);
    const wikiDir = path.join(dir, 'wiki');
    fs.mkdirSync(wikiDir, { recursive: true });
    const token = this.config.accessToken;

    if (!token) {
      console.error('GITEA_ACCESS_TOKEN required for wiki dump');
      process.exit(1);
    }

    const wikiUrl = `https://gitea:${token}@${this.gitHost}/${this.config.repo}.wiki.git`;
    console.log(`Cloning wiki... ${wikiUrl}`);
    execSync(`cd ${dir} && git clone ${wikiUrl} wiki 2>/dev/null || echo "Wiki empty or not available"`, { stdio: 'inherit' });
    console.log(`Wiki dumped to ${wikiDir}`);
  }

  async restoreWiki(wikiDir: string): Promise<void> {
    if (!fs.existsSync(wikiDir) || !fs.existsSync(path.join(wikiDir, '.git'))) {
      console.error(`Wiki git repo not found: ${wikiDir}`);
      return;
    }
    const token = this.config.accessToken;

    if (!token) {
      console.error('GITEA_ACCESS_TOKEN required for wiki restore');
      process.exit(1);
    }

    const wikiUrl = `https://gitea:${token}@${this.gitHost}/${this.config.repo}.wiki.git`;
    console.log('Pushing wiki...');
    execSync(`cd ${wikiDir} && git push --mirror ${wikiUrl}`, { stdio: 'inherit' });
    console.log('Wiki restored!');
  }
}
