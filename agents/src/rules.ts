/**
# 🤖 rules.ts
# Description: Unified utility script to compress LLM system rules and lint generated transcript links.
# Constraints:
#   - Relies on arguments to choose the action: --compress, --lint.
#   - Decouples file system audits and compression.
# Dependencies: fs, path, os
# ==============================================================================
 */

import * as fs from 'fs';
import * as path from 'path';

// ==============================================================================
// 1. Rule Compressor
// ==============================================================================
class RuleCompressor {
  private readonly rulesDir = path.join(__dirname, '../rules');

  public run(): void {
    try {
      console.log('🤖 Compressing rules to save LLM tokens...');
      if (!fs.existsSync(this.rulesDir)) {
        throw new Error(`Directory not found: ${this.rulesDir}`);
      }

      const files = fs.readdirSync(this.rulesDir).filter(f => f.endsWith('.md'));
      let compressedText = '=== COMPACT RULES ===\n';

      files.forEach(file => {
        const filePath = path.join(this.rulesDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const compressed = this.compress(content);
        compressedText += `\n[File: ${file}]\n${compressed}\n`;
      });

      // Write to agents/data/sessions/agy/
      const transcriptsAgyDir = path.join(__dirname, '../data/sessions/agy');
      fs.mkdirSync(transcriptsAgyDir, { recursive: true });
      const destPath = path.join(transcriptsAgyDir, 'rules_compact.txt');
      fs.writeFileSync(destPath, compressedText.trim(), 'utf-8');
      console.log(`✅ Compressed rules written to agents/data/sessions/agy: ${destPath}`);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('❌ Error compressing rules:', errMsg);
      process.exitCode = 1;
    }
  }

  private compress(text: string): string {
    return text
      .split('\n')
      .map(line => line.trim())
      .filter(line => {
        // Remove empty lines and markdown/block comments
        if (!line) return false;
        if (line.startsWith('<!--') || line.endsWith('-->')) return false;
        return true;
      })
      .join('\n');
  }
}

// ==============================================================================
// 2. Rules Linter (Audits Relative Links)
// ==============================================================================
interface BadLinkItem {
  file: string;
  line: number;
  text: string;
}

class RulesLinter {
  private readonly transcriptsDir = path.join(__dirname, '../data/sessions');

  public run(): void {
    try {
      console.log('🔍 Auditing relative paths in generated markdown transcripts...');
      if (!fs.existsSync(this.transcriptsDir)) {
        console.log('No transcripts directory found. Skipping check.');
        return;
      }

      const badLinks: BadLinkItem[] = [];
      this.checkDirectory(this.transcriptsDir, badLinks);

      if (badLinks.length > 0) {
        console.warn('⚠️ Absolute paths or invalid schemas found in transcripts:');
        badLinks.forEach(item => {
          console.warn(`  - [${item.file}:${item.line}]: "${item.text}"`);
        });
      } else {
        console.log('✅ Paths validation: ALL OK (All links use clean relative paths).');
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('❌ Error during relative link validation:', errMsg);
      process.exitCode = 1;
    }
  }

  private checkDirectory(dir: string, badLinks: BadLinkItem[]): void {
    const items = fs.readdirSync(dir);
    items.forEach(name => {
      const fullPath = path.join(dir, name);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        this.checkDirectory(fullPath, badLinks);
      } else if (stat.isFile() && name.endsWith('.md')) {
        this.checkFile(fullPath, badLinks);
      }
    });
  }

  private checkFile(filePath: string, badLinks: BadLinkItem[]): void {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    // Pattern to look for markdown links like [Text](file:///...) or [Text](C:\...) or [Text](http://...)
    // AGENTS.md Rule 5 constraint: must use relative paths. No absolute file://.
    const absoluteLinkPattern = /\[.*?\]\((file:\/\/|http:\/\/|https:\/\/|www\.)/gi;

    lines.forEach((line, index) => {
      let match;
      while ((match = absoluteLinkPattern.exec(line)) !== null) {
        badLinks.push({
          file: path.relative(path.join(__dirname, '../..'), filePath),
          line: index + 1,
          text: match[0]
        });
      }
    });
  }
}

// ==============================================================================
// CLI Main Entrypoint
// ==============================================================================
if (require.main === module) {
  const args = process.argv.slice(2);
  const runCompress = args.includes('--compress') || args.includes('-c');
  const runLint = args.includes('--lint') || args.includes('-l');

  if (runCompress) {
    new RuleCompressor().run();
  }
  if (runLint) {
    new RulesLinter().run();
  }

  if (!runCompress && !runLint) {
    console.log('🤖 Running both rule compression and rules audit by default...');
    new RuleCompressor().run();
    new RulesLinter().run();
  }
}
