/**
 * @module gmail
 * @description Core functionality or script runner for gmail.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies downloader, exporter, dotenv
 * @lastUpdated 2026-06-11
 */

import { GmailBulkDownloader } from "./downloader";
import { WikiExporter } from "./exporter";
import * as dotenv from "dotenv";

dotenv.config({ override: true });

(async () => {
  if ((process.env.EMAIL_PASSWORD || "").replace(/\s+/g, "").length !== 16) {
    console.log(
      "[오류] EMAIL_PASSWORD가 16자리가 아닙니다. .env를 확인하세요.",
    );
    process.exit(1);
  }

  const exporter = new WikiExporter("/data");
  const downloader = new GmailBulkDownloader();
  let isConnected = false;

  try {
    await downloader.connect();
    isConnected = true;

    const targetFolders = await downloader.getAllLabels();
    const cleanedFolders = Object.entries(targetFolders).reduce(
      (acc, [folder, alias]) => {
        if (!["all_mail", "all_mails", "gmail"].includes(alias))
          acc[folder] = alias;
        return acc;
      },
      {} as Record<string, string>,
    );

    console.log(`최종 동기화 대상 라벨 목록:`, Object.values(cleanedFolders));

    for (const [imapFolder, alias] of Object.entries(cleanedFolders)) {
      try {
        for await (const [
          mailId,
          parsedMail,
          rawBuffer,
        ] of downloader.streamEmails(imapFolder, alias, exporter)) {
          await exporter
            .save(alias, mailId, parsedMail, rawBuffer)
            .catch((err) =>
              console.log(`Error skipped at ID ${mailId} in ${alias}: ${err}`),
            );
        }
      } catch (folderErr) {
        console.log(`[Warning] 메일함 동기화 건너뜀 (${alias}): ${folderErr}`);
      }
    }
    console.log("\n[성공] 자동 라벨 동기화 백업이 완료되었습니다.");
  } catch (error) {
    console.log(`\n[실행 실패] 시스템 에러: ${error}`);
  } finally {
    if (isConnected) await downloader.disconnect().catch(() => {});
  }
})();
