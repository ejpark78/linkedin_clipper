/**
 * @module downloader
 * @description Core functionality or script runner for downloader.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies imapflow, mailparser, exporter, parser
 * @lastUpdated 2026-06-11
 */

import { ImapFlow } from "imapflow";
import { simpleParser, ParsedMail } from "mailparser";
import { WikiExporter } from "./exporter";
import { EmailParser } from "./parser";

export class GmailBulkDownloader {
  private client: ImapFlow;

  constructor() {
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASSWORD;
    if (!user || !pass)
      throw new Error("Required environment variables missing.");

    this.client = new ImapFlow({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      auth: { user, pass },
      logger: false,
    });
  }

  async connect() {
    await this.client.connect();
  }
  async disconnect() {
    await this.client.logout().catch(() => {});
  }

  static decodeModifiedUtf7(s: string): string {
    return s
      .replace(/&([A-Za-z0-9+,]+)-/g, (match, p1) => {
        let b64Str = p1.replace(/,/g, "/");
        if (b64Str.length % 4) b64Str += "=".repeat(4 - (b64Str.length % 4));
        try {
          return new TextDecoder("utf-16be").decode(
            Buffer.from(b64Str, "base64"),
          );
        } catch {
          return match;
        }
      })
      .replace(/&-/g, "&");
  }

  async getAllLabels(): Promise<Record<string, string>> {
    const list = await this.client.list();
    const labels: Record<string, string> = {};
    for (const folder of list) {
      labels[folder.path] = GmailBulkDownloader.decodeModifiedUtf7(folder.path)
        .replace(/^\[Gmail\]\//i, "")
        .replace(/ /g, "_")
        .toLowerCase();
    }
    return labels;
  }

  async *streamEmails(
    folderName: string,
    folderAlias: string,
    exporter: WikiExporter,
  ): AsyncGenerator<[string, ParsedMail, Buffer], void, unknown> {
    const lock = await this.client.getMailboxLock(folderName);
    try {
      const status = this.client.mailbox;
      if (!status) return console.log(`[Warning] '${folderAlias}' 접근 실패.`);

      const total = status.exists;
      console.log(`\n==================================================`);
      console.log(`📂 [메일함: ${folderAlias}] 총 ${total}개 동기화 시작`);
      console.log(`==================================================`);
      if (total === 0) return;

      // 1. 대기 현상을 유발하는 전체 fetch 대신, 메일 UID 배열만 쿼리로 즉시 확보
      const searchResult = await this.client.search({ all: true });
      const uids = Array.isArray(searchResult) ? searchResult : [];

      let idx = 0;
      let skipped = 0;

      // 2. 일반 for 문을 사용하여 단건 단위로 확실하게 네트워크 트래픽 제어
      for (const uid of uids) {
        idx++;
        const mailIdStr = uid.toString();

        try {
          // 3. 단건 메일의 기본 정보(internalDate, envelope)만 fetchOne으로 즉시 스캔
          const msgMeta = await this.client.fetchOne(mailIdStr, {
            envelope: true,
            internalDate: true,
          });

          if (!msgMeta) continue;

          const subject = msgMeta.envelope?.subject || "제목 없음";
          const rawDate = msgMeta.envelope?.date ?? msgMeta.internalDate;
          const dateObj: Date | undefined =
            typeof rawDate === "string" ? new Date(rawDate) : rawDate;

          const senderEmail = EmailParser.getSenderEmail(msgMeta.envelope);
          const uniqueId = EmailParser.generateUniqueId(dateObj, senderEmail);

          const [isoDateKst] = EmailParser.convertToKstIso(dateObj);
          const shortSubject =
            subject.length > 30 ? subject.substring(0, 30) + "..." : subject;

          // 4. 중복 파일이 이미 로컬 디렉토리에 있다면 본문 패치를 스킵하고 로그 출력
          if (exporter.existsByUid(folderAlias, uniqueId, dateObj)) {
            skipped++;
            console.log(
              `⏭️  [${idx}/${total}] [스킵] ID: ${uniqueId} | KST: ${isoDateKst} | 제목: ${shortSubject}`,
            );
            continue;
          }

          // 5. 로컬에 없는 완전한 새 메일일 때만 본문 데이터(source)를 1대1 요청
          const msgContent = await this.client.fetchOne(mailIdStr, {
            source: true,
          });
          if (msgContent && msgContent.source) {
            const parsed = await simpleParser(msgContent.source);
            console.log(
              `📥 [${idx}/${total}] [다운] ID: ${uniqueId} | KST: ${isoDateKst} | 제목: ${shortSubject}`,
            );
            yield [uniqueId, parsed, msgContent.source];
          }
        } catch (innerErr) {
          console.log(
            `❌ [${idx}/${total}] [단건 에러] ID: ${mailIdStr} 처리 실패: ${innerErr}`,
          );
        }
      }

      console.log(
        `\n📊 [${folderAlias}] 완료 요약: 총 ${total}개 (새로 다운: ${total - skipped}개, 중복 패스: ${skipped}개)`,
      );
    } finally {
      lock.release();
    }
  }
}
