/**
 * @module GrepErrors
 * @description Reads raw container logs from stdin, parses JSON logs, captures raw TS compile/startup errors, and formats them.
 * @constraints
 *   - Follows Strict OOP patterns and clean error handling.
 *   - Reads streaming input from process.stdin.
 * @dependencies readline
 * @lastUpdated 2026-06-11
 */

import * as readline from "readline";

export interface IErrorGrepper {
  grep(): Promise<void>;
}

export class ErrorGrepper implements IErrorGrepper {
  public async grep(): Promise<void> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    let errorCount = 0;
    const errorSummary: Record<string, number> = {};
    const serviceSummary: Record<string, number> = {};

    console.log("\n=== 🛑 SCRAPER & CONVERTER ERROR LOGS ===\n");

    rl.on("line", (line: string) => {
      const separatorIndex = line.indexOf("|");
      if (separatorIndex === -1) return;

      const service = line.substring(0, separatorIndex).trim();
      const rawContent = line.substring(separatorIndex + 1).trim();
      if (!rawContent) return;

      const isJsonError = line.includes('"level":"ERROR"');
      // Detect TypeScript compile errors, throw errors, or lines indicating a stack trace
      const isStartupError = /TSError|error TS|Error:|Exception|^\s*at /i.test(
        rawContent,
      );

      if (!isJsonError && !isStartupError) {
        return;
      }

      if (isJsonError) {
        try {
          const parsed = JSON.parse(rawContent);
          errorCount++;

          const timestamp = parsed.timestamp || parsed.time || "N/A";
          const message = parsed.message || parsed.msg || "No message";
          const errName = parsed.error_name || "";
          const errMsg = parsed.error_message || "";
          const stack = parsed.error_stack || "";

          // Increment counts for summaries
          serviceSummary[service] = (serviceSummary[service] || 0) + 1;
          const summaryKey = errName
            ? `${errName}: ${message.split("on attempt")[0].trim()}`
            : message;
          errorSummary[summaryKey] = (errorSummary[summaryKey] || 0) + 1;

          console.log(
            `[${timestamp}] \x1b[35m${service}\x1b[0m \x1b[31m[ERROR]\x1b[0m: ${message}`,
          );
          if (errName || errMsg) {
            console.log(`  └─ \x1b[33m${errName}: ${errMsg}\x1b[0m`);
          }
          if (stack) {
            const stackLines = stack
              .split("\n")
              .slice(0, 3)
              .map((l: string) => `     ${l.trim()}`)
              .join("\n");
            console.log(`  └─ Stack:\n${stackLines}`);
          }
          console.log();
        } catch {
          console.log(`[RAW ERROR] \x1b[35m${service}\x1b[0m: ${rawContent}\n`);
          errorCount++;
        }
      } else {
        // Formatting raw startup error line
        console.log(
          `\x1b[31m[STARTUP ERROR]\x1b[0m \x1b[35m${service}\x1b[0m: ${rawContent}`,
        );
        errorCount++;

        // Collect summary for startup errors
        serviceSummary[service] = (serviceSummary[service] || 0) + 1;
        const summaryKey = rawContent.startsWith("at ")
          ? "Stack Trace Line"
          : rawContent.substring(0, 100);
        errorSummary[summaryKey] = (errorSummary[summaryKey] || 0) + 1;
      }
    });

    rl.on("close", () => {
      console.log("==================================================");
      console.log(`📊 Total Error Logs Found: ${errorCount}`);

      if (errorCount > 0) {
        console.log("\n🏢 [Errors by Service]");
        for (const [srv, count] of Object.entries(serviceSummary)) {
          console.log(`  - \x1b[35m${srv}\x1b[0m: ${count} entries`);
        }

        console.log("\n📝 [Common Error Patterns / Stack Lines]");
        const sortedErrors = Object.entries(errorSummary).sort(
          (a, b) => b[1] - a[1],
        );
        for (const [pattern, count] of sortedErrors) {
          console.log(`  - [${count}x] \x1b[33m${pattern}\x1b[0m`);
        }
      }
      console.log("==================================================\n");
    });
  }
}

if (require.main === module) {
  new ErrorGrepper().grep().catch((err) => {
    console.error("Fatal Error:", err);
  });
}
