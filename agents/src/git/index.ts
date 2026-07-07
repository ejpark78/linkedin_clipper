/**
 * index.ts — Unified CLI entry point for git/Gitea tooling.
 *
 * Design context: Replaces the monolithic git.ts (1830 lines).
 * Routes CLI actions to the appropriate service classes.
 * All services are instantiated via factory pattern for DI.
 *
 * Dependencies: All git/ sub-modules
 *
 * Usage: npx ts-node agents/src/git/index.ts <command> [options]
 *   or:  npm run git <command>
 */

import { Config } from './config';
import { GitService } from './git-service';
import { GiteaClient } from './gitea-client/client';
import { ValidationService } from './validation-service';
import { ReleaseCoordinator } from './release-coordinator';
import { LabelService } from './label-service';
import { parseFlag, readFileOrExit } from './util';

class GitController {
  static async execute(): Promise<void> {
    const args = process.argv.slice(2);
    const action = args[0];

    const config = new Config();
    const git = new GitService();
    const gitea = new GiteaClient(config, git);
    const validator = new ValidationService(config, git);

    switch (action) {
      // ---- Gitea Issue Operations ----
      case 'create-issue': {
        const titleFile = parseFlag(args, '--title-file', '-tf');
        const bodyFile = parseFlag(args, '--body-file', '-bf');
        if (!titleFile || !bodyFile) {
          console.error('Usage: npm run git create-issue --title-file=<path> --body-file=<path>');
          console.error('  Options: --no-label');
          process.exit(1);
        }
        const skipLabel = args.includes('--no-label');
        await gitea.createIssue(readFileOrExit(titleFile), readFileOrExit(bodyFile), skipLabel);
        break;
      }

      case 'comment': {
        const issueId = parseFlag(args, '--issue', '-i');
        const bodyFile = parseFlag(args, '--body-file', '-bf');
        if (!issueId || !bodyFile) {
          console.error('Usage: npm run git comment --issue=<id> --body-file=<path>');
          process.exit(1);
        }
        await gitea.createComment(issueId, readFileOrExit(bodyFile));
        break;
      }

      case 'update-issue': {
        const issueId = parseFlag(args, '--issue', '-i');
        const titleFile = parseFlag(args, '--title-file', '-tf');
        const bodyFile = parseFlag(args, '--body-file', '-bf');
        if (!issueId || (!titleFile && !bodyFile)) {
          console.error('Usage: npm run git update-issue --issue=<id> [--title-file=<path>] [--body-file=<path>]');
          process.exit(1);
        }
        if (git.hasUncommitted()) {
          console.warn('Warning: You have uncommitted changes. Use `npm run git commit` before closing this issue.');
        }
        if (bodyFile) {
          await gitea.updateIssue(issueId, titleFile ? readFileOrExit(titleFile) : '', readFileOrExit(bodyFile));
        } else {
          console.error('--body-file is required for update-issue');
          process.exit(1);
        }
        break;
      }

      case 'update-comment': {
        const commentId = parseFlag(args, '--comment-id', '-c');
        const bodyFile = parseFlag(args, '--body-file', '-bf');
        if (!commentId || !bodyFile) {
          console.error('Usage: npm run git update-comment --comment-id=<id> --body-file=<path>');
          process.exit(1);
        }
        await gitea.updateComment(commentId, readFileOrExit(bodyFile));
        break;
      }

      case 'close-issue': {
        const issueId = parseFlag(args, '--issue', '-i');
        if (!issueId) { console.error('Usage: npm run git close-issue --issue=<id>'); process.exit(1); }
        if (git.hasUncommitted()) {
          console.error('ERROR: Uncommitted changes detected. Use `npm run git commit` to commit and close together.');
          console.error('  To force close without committing, stash your changes first: git stash');
          process.exit(1);
        }
        await gitea.closeIssue(issueId);
        break;
      }

      case 'reopen-issue': {
        const issueId = parseFlag(args, '--issue', '-i');
        if (!issueId) { console.error('Usage: npm run git reopen-issue --issue=<id>'); process.exit(1); }
        await gitea.reopenIssue(issueId);
        break;
      }

      case 'show-issue': {
        const issueId = parseFlag(args, '--issue', '-i');
        if (!issueId) { console.error('Usage: npm run git show-issue --issue=<id>'); process.exit(1); }
        if (args.includes('--json')) {
          await gitea.printIssueJson(issueId);
        } else {
          await gitea.printIssueBody(issueId);
        }
        break;
      }

      case 'list-issues': {
        const allIssues = await gitea.getIssues();
        let state = 'open';
        let limit = 20;

        if (args.includes('--all')) state = 'all';
        const stateStr = parseFlag(args, '--state', '-s');
        if (stateStr) state = stateStr;
        const limitStr = parseFlag(args, '--limit', '-l');
        if (limitStr) { const l = parseInt(limitStr, 10); if (!isNaN(l)) limit = l; }

        if (args.includes('--json')) {
          await gitea.printIssuesJson(state, limit);
          break;
        }

        const filtered = state === 'all' ? allIssues : allIssues.filter(i => i.state === state);
        const sliced = filtered.slice(0, limit);
        if (sliced.length === 0) { console.log('No issues to display.'); break; }
        console.log(`Recent ${sliced.length} issues (total ${filtered.length}, state=${state}):\n`);
        sliced.forEach(i => {
          const label = i.state === 'closed' ? '[x]' : '[ ]';
          const date = (i.created_at || '').slice(0, 10);
          const t = i.title.length > 50 ? i.title.slice(0, 47) + '...' : i.title;
          console.log(`  ${label} #${String(i.number).padStart(3)}  ${date}  ${t}`);
        });
        console.log('\nDetails: npm run git show-issue --issue=<number>');
        break;
      }

      // ---- Token Operations ----
      case 'generate-token':
        await gitea.generateToken();
        break;

      case 'generate-token-tea':
        await gitea.generateTokenWithTea();
        break;

      // ---- Init ----
      case 'init':
        await gitea.initGitea();
        break;

      // ---- Session Context ----
      case 'issue:save':
        await gitea.issueSave();
        break;

      // ---- Repo Dump/Restore ----
      case 'repo:dump': {
        await gitea.repoDump(parseFlag(args, '--dir') || 'data/dumps/gitea');
        break;
      }

      case 'repo:restore': {
        const dir = parseFlag(args, '--dir');
        if (!dir) { console.error('Usage: npm run git repo:restore --dir=<dumpDir>'); process.exit(1); }
        await gitea.repoRestore(dir);
        break;
      }

      case 'issue:dump': {
        await gitea.dumpIssue(parseFlag(args, '--dir') || 'data/dumps/gitea', parseFlag(args, '--issue', '-i') || '');
        break;
      }

      case 'issue:restore': {
        const file = parseFlag(args, '--file', '-f');
        if (!file) { console.error('Usage: npm run git issue:restore --file=<path>'); process.exit(1); }
        await gitea.restoreIssue(file);
        break;
      }

      // ---- Wiki Operations ----
      case 'wiki:init': {
        const dir = parseFlag(args, '--dir');
        if (!dir) { console.error('Usage: npm run git wiki:init --dir=<wikiDir>'); process.exit(1); }
        await gitea.wikiInit(dir);
        break;
      }

      case 'wiki:dump': {
        await gitea.dumpWiki(parseFlag(args, '--dir') || 'data/dumps/gitea');
        break;
      }

      case 'wiki:restore': {
        const dir = parseFlag(args, '--dir');
        if (!dir) { console.error('Usage: npm run git wiki:restore --dir=<wikiDir>'); process.exit(1); }
        await gitea.restoreWiki(dir);
        break;
      }

      // ---- Commit (from commit-changes.ts) ----
      case 'commit': {
        const coordinator = new ReleaseCoordinator(config, git, validator, gitea);
        await coordinator.execute();
        break;
      }

      // ---- Review (from review-changes.ts) ----
      case 'review': {
        validator.runFullReview();
        break;
      }

      // ---- Push (push current branch to remote) ----
      case 'push': {
        const pushUrl = git.buildPushUrl(config.apiUrl, config.repo, config.accessToken || '');
        const branch = git.currentBranch();
        console.log(`Pushing '${branch}' to remote...`);
        git.runCmd(`git push "${pushUrl}" "${branch}" --no-verify`, true);
        console.log('Remote sync complete.');
        break;
      }

      // ---- Git Flow Operations ----
      case 'start': {
        const issue = parseFlag(args, '--issue', '-i');
        const desc = parseFlag(args, '--desc', '-d');
        if (!issue || !desc) {
          console.error('Usage: npm run git start --issue=<number> --desc=<kebab-description>');
          process.exit(1);
        }
        const branchName = `feature/${issue}-${desc}`;
        const stashed = git.hasUncommitted();
        if (stashed) {
          git.stash();
        }
        git.checkout('main');
        git.pull();
        git.checkoutNew(branchName);
        if (stashed) {
          git.stashPop();
        }
        console.log(`Switched to new branch: ${branchName}`);
        break;
      }

      case 'branch': {
        console.log(`Current branch: ${git.currentBranch()}`);
        const status = git.shortStatus();
        if (status) {
          console.log('Uncommitted changes:');
          console.log(status);
        } else {
          console.log('Working tree clean.');
        }
        break;
      }

      case 'log': {
        const countStr = parseFlag(args, '--count', '-c');
        const count = countStr ? parseInt(countStr, 10) || 10 : 10;
        console.log(git.log(count));
        break;
      }

      case 'status': {
        const status = git.shortStatus();
        if (status) {
          console.log(status);
        } else {
          console.log('Working tree clean.');
        }
        break;
      }

      default:
        console.error(`Unknown command: '${action}'`);
        console.error('Available commands:');
        console.error('  Issue:    create-issue, comment, update-issue, update-comment, close-issue, reopen-issue, show-issue, list-issues');
        console.error('  Token:    generate-token, generate-token-tea');
        console.error('  Init:     init');
        console.error('  Session:  issue:save');
        console.error('  Repo:     repo:dump, repo:restore, issue:dump, issue:restore');
        console.error('  Wiki:     wiki:init, wiki:dump, wiki:restore');
        console.error('  Pipeline: commit, review, push');
        console.error('  Git:      start, branch, log, status');
        process.exit(1);
    }
  }
}

GitController.execute();
