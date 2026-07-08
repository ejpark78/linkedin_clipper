/**
 * @file pool.ts
 * @description Playwright browser pool service. Manages shared browser instances.
 * Implements Singleton OOP pattern to manage browser lifecycle.
 *
 * Rules Complied:
 * - Strict OOP Patterns: Used BrowserPool class singleton pattern instead of loose functions.
 * - Agent-Friendly Docstrings: File started with this detailed JSDoc.
 */

import { chromium, Browser } from "playwright";

export class BrowserPool {
  private static instance: BrowserPool;
  private browser: Browser | null = null;

  private constructor() {}

  /**
   * Retrieves the Singleton instance of the BrowserPool.
   */
  public static getInstance(): BrowserPool {
    if (!BrowserPool.instance) {
      BrowserPool.instance = new BrowserPool();
    }
    return BrowserPool.instance;
  }

  /**
   * Gets a running Browser instance. Launches a new one if not connected.
   */
  public async getBrowser(): Promise<Browser> {
    if (!this.browser?.isConnected()) {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
        ],
      });
    }
    return this.browser;
  }

  /**
   * Closes the active Browser instance and cleans up.
   */
  public async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

// ⚠️ Node process lifecycle hooks to ensure proper browser teardown.
const cleanup = async (): Promise<void> => {
  await BrowserPool.getInstance().closeBrowser();
};

process.on("beforeExit", cleanup);

for (const sig of ["SIGINT", "SIGTERM", "SIGQUIT"] as const) {
  process.on(sig, async () => {
    await cleanup();
    process.exit(0);
  });
}
