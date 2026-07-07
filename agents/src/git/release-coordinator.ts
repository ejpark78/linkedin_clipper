import { Config } from './config';
import { GitService } from './git-service';
import { ValidationService } from './validation-service';

export class ReleaseCoordinator {
  private config: Config;
  private git: GitService;
  private validator: ValidationService;

  constructor(config: Config, git: GitService, validator: ValidationService) {
    this.config = config;
    this.git = git;
    this.validator = validator;
  }

  private generateCommitMessage(branchName: string): string {
    const featureMatch = branchName.match(/^feature\/(.+)$/);
    if (featureMatch) {
      const desc = featureMatch[1].replace(/-/g, ' ');
      return `feat: ${desc}`;
    }

    const allStaged = this.git.runCmd('git diff --cached --name-only', true);
    if (allStaged.includes('AGENTS.md') || allStaged.includes('agents/')) {
      return 'docs: update agent rules';
    }

    return 'chore: commit changes';
  }

  async execute(): Promise<void> {
    const statusPorcelain = this.git.runCmd('git status --porcelain', true);
    const branchName = this.git.runCmd('git rev-parse --abbrev-ref HEAD', true);

    if (branchName === 'main') {
      console.error('ERROR: Direct commit to main branch is prohibited.');
      process.exit(1);
    }

    if (statusPorcelain) {
      this.validator.runFullReview();

      console.log('Running static verification tests...');
      const stagedFiles = this.git.getStagedFiles();
      this.validator.runPackageVerification(stagedFiles);

      console.log('Staging all changes...');
      this.git.runCmd('git add .');

      const diffSummary = this.git.runCmd('git diff --cached --name-status', true);
      if (diffSummary) {
        diffSummary.split('\n').filter(Boolean).forEach((line: string) => {
          const parts = line.split(/\s+/);
          this.git.showFileDiff(parts[1], parts[0]);
        });
      }

      const msg = this.generateCommitMessage(branchName);
      this.git.runCmd(`git commit -m "${msg}"`);
      console.log(`Committed: ${msg}`);
    } else {
      console.log('No changes to commit.');
    }

    this.pushToRemote(branchName);
  }

  private pushToRemote(branchName: string): void {
    console.log(`Pushing '${branchName}' to remote...`);
    if (!this.config.accessToken) {
      console.warn('Warning: No access token. Push skipped.');
      return;
    }
    const pushUrl = this.git.buildPushUrl(this.config.apiUrl, this.config.repo, this.config.accessToken);
    this.git.runCmd(`git push "${pushUrl}" "${branchName}" --no-verify`);
    console.log('Remote sync complete.');
  }
}
