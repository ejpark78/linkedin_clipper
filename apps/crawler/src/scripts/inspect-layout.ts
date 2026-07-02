import { chromium } from "playwright";
import * as readline from "readline";

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans);
    }),
  );
}

async function run() {
  console.log("📡 Launching browser on host (headless: false)...");
  const browser = await chromium.launch({
    headless: false,
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  console.log("🌐 Navigating to https://viewer.localhost...");
  await page.goto("https://viewer.localhost", {
    waitUntil: "domcontentloaded",
  });

  console.log("\n💬 [대기 모드] 브라우저 창이 열렸습니다.");
  console.log(
    "👉 가로 넘침(버그)이 발생하는 페이지/문서로 직접 브라우저를 이동해 주세요.",
  );

  await askQuestion(
    "\n⌨️  원하는 문서 화면이 띄워졌다면 엔터(Enter)를 입력하세요. DOM 구조와 스타일을 분석합니다...\n",
  );

  console.log("\n🔍 --- DOM Hierarchy Inspection ---");
  const layoutInfo = await page.evaluate(() => {
    const mainEl = document.querySelector(".main-content");
    const detailEl = document.querySelector(".detail-content");
    const containerEl = document.querySelector(".app-container");

    // Check what element inside .main-content is causing overflow
    let overflowingChildInfo = "None";
    if (mainEl) {
      const children = mainEl.querySelectorAll("*");
      for (const child of Array.from(children)) {
        if (child.scrollWidth > child.clientWidth) {
          overflowingChildInfo = `${child.tagName.toLowerCase()}.${child.className} (scrollWidth: ${child.scrollWidth}, clientWidth: ${child.clientWidth})`;
          break;
        }
      }
    }

    const getStyles = (el: Element | null) => {
      if (!el) return null;
      const cs = window.getComputedStyle(el);
      return {
        tagName: el.tagName.toLowerCase(),
        className: el.className,
        width: cs.width,
        minWidth: cs.minWidth,
        maxWidth: cs.maxWidth,
        overflow: cs.overflow,
        overflowX: cs.overflowX,
        display: cs.display,
      };
    };

    return {
      container: getStyles(containerEl),
      main: getStyles(mainEl),
      detail: getStyles(detailEl),
      overflowingChild: overflowingChildInfo,
      mainOuterHtmlHead: mainEl
        ? mainEl.outerHTML.substring(0, 350)
        : "Not found",
    };
  });

  console.log("Container (.app-container):", layoutInfo.container);
  console.log("Main Content (.main-content):", layoutInfo.main);
  console.log("Detail Content (.detail-content):", layoutInfo.detail);
  console.log(
    "First Overflowing Child Inside Main:",
    layoutInfo.overflowingChild,
  );
  console.log("Main Content HTML Head:", layoutInfo.mainOuterHtmlHead);

  await askQuestion(
    "\n⌨️  분석이 끝났습니다. 브라우저를 닫으려면 엔터(Enter)를 입력하세요...\n",
  );

  await browser.close();
  console.log("🏁 Finished.");
}

run().catch(console.error);
