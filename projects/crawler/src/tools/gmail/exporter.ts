/**
 * @module exporter
 * @description Core functionality or script runner for exporter.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies fs, path, mailparser, turndown, parser
 * @lastUpdated 2026-06-11
 */

import * as fs from "fs";
import * as path from "path";
import { ParsedMail } from "mailparser";
import TurndownService from "turndown";
import { EmailParser } from "./parser";

export class WikiExporter {
  private turndownService: TurndownService;
  private index: Record<string, string> = {};
  private indexFilePath: string;

  constructor(private baseDir: string = "data") {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    this.indexFilePath = path.join(this.baseDir, "gmail_index.json");
    this.turndownService = new TurndownService({
      headingStyle: "atx",
      hr: "---",
      bulletListMarker: "-",
    });

    this.turndownService.remove(["style", "script", "head", "meta"]);
    this.loadIndex();
  }

  private loadIndex(): void {
    if (fs.existsSync(this.indexFilePath)) {
      try {
        this.index = JSON.parse(fs.readFileSync(this.indexFilePath, "utf-8"));
        return;
      } catch (err) {
        console.log(
          `⚠️  [Warning] Failed to parse gmail_index.json, rebuilding index: ${err}`,
        );
      }
    }
    this.rebuildIndex();
  }

  private rebuildIndex(): void {
    this.index = {};
    console.log(
      `🔍 [인덱스 빌드] '${this.baseDir}' 에서 기존 메일 폴더를 스캔하여 인덱스를 재생성합니다...`,
    );
    if (!fs.existsSync(this.baseDir)) return;

    try {
      const labels = fs.readdirSync(this.baseDir);
      for (const label of labels) {
        const labelPath = path.join(this.baseDir, label);
        if (!fs.statSync(labelPath).isDirectory()) continue;

        const senders = fs.readdirSync(labelPath);
        for (const sender of senders) {
          const senderPath = path.join(labelPath, sender);
          if (!fs.statSync(senderPath).isDirectory()) continue;

          const mailDirs = fs.readdirSync(senderPath);
          for (const mailDir of mailDirs) {
            const mailPath = path.join(senderPath, mailDir);
            if (!fs.statSync(mailPath).isDirectory()) continue;

            // Extract uniqueId from folder suffix after the last underscore
            const parts = mailDir.split("_");
            const uniqueId = parts[parts.length - 1];
            if (uniqueId && uniqueId.length >= 8) {
              const relativePath = path.relative(this.baseDir, mailPath);
              this.index[uniqueId] = relativePath;
            }
          }
        }
      }
      this.saveIndex();
      console.log(
        `💾 [인덱스 빌드 완료] 총 ${Object.keys(this.index).length}개의 메일 색인 완료.`,
      );
    } catch (err) {
      console.log(`⚠️  [인덱스 빌드 에러]: ${err}`);
    }
  }

  private saveIndex(): void {
    try {
      fs.writeFileSync(
        this.indexFilePath,
        JSON.stringify(this.index, null, 2),
        "utf-8",
      );
    } catch (err) {
      console.log(`⚠️  [Warning] Failed to save gmail_index.json: ${err}`);
    }
  }

  private cleanMarkdownNoise(text: string): string {
    let cleaned = text;

    cleaned = cleaned.replace(/@media[^{]*\{[^}]*\}/gi, "");
    cleaned = cleaned.replace(/\.[a-zA-Z0-9_-]+\s*\{[^}]*\}/g, "");
    cleaned = cleaned.replace(/!\[\]\(.*?\)/g, "");
    cleaned = cleaned.replace(/\[\]\(.*?\)/g, "");
    cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
    cleaned = cleaned.replace(/&nbsp;/g, " ");

    // Remove common unsubscribe and social media footer patterns for LLM clean context
    cleaned = cleaned.replace(/\[?unsubscribe\]?\(.*?\)/gi, "");
    cleaned = cleaned.replace(/\[?수신거부\]?\(.*?\)/g, "");

    // Collapse newlines and extra spaces inside markdown links to keep them inline
    cleaned = cleaned.replace(
      /\[\s*([\s\S]*?)\s*\]\(([^)]+)\)/g,
      (match, linkText, url) => {
        const collapsedText = linkText
          .replace(/\r?\n/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (!collapsedText) return "";
        return `[${collapsedText}](${url.trim()})`;
      },
    );

    return cleaned.trim();
  }

  getTargetPath(
    folderAlias: string,
    mailId: string,
    subject: string,
    dateObj: Date | undefined,
    senderEmail: string,
  ): string {
    const [, , yearMonthTime] = EmailParser.convertToKstIso(dateObj);
    return path.join(
      this.baseDir,
      EmailParser.cleanFilename(folderAlias),
      EmailParser.cleanFilename(senderEmail),
      `${yearMonthTime}_${EmailParser.cleanFilename(subject)}_${mailId}`,
    );
  }

  exists(
    folderAlias: string,
    mailId: string,
    subject: string,
    dateObj: Date | undefined,
    senderEmail: string,
  ): boolean {
    return fs.existsSync(
      path.join(
        this.getTargetPath(folderAlias, mailId, subject, dateObj, senderEmail),
        "message.md",
      ),
    );
  }

  existsByUid(
    folderAlias: string,
    mailId: string,
    dateObj: Date | undefined,
  ): boolean {
    return !!this.index[mailId];
  }

  async save(
    folderAlias: string,
    mailId: string,
    parsedMail: ParsedMail,
    rawBuffer: Buffer,
  ): Promise<void> {
    const subject = parsedMail.subject || "No Subject";
    const sender = parsedMail.from?.text || "Unknown";
    const senderEmail =
      parsedMail.from &&
      parsedMail.from.value &&
      parsedMail.from.value.length > 0
        ? parsedMail.from.value[0].address || "unknown"
        : "unknown";

    const [isoDateKst, , yearMonthTime] = EmailParser.convertToKstIso(
      parsedMail.date,
    );

    const bodyHtml =
      parsedMail.html ||
      (parsedMail.text ? parsedMail.text.replace(/\n/g, "<br>") : "");

    const rawMarkdown = this.turndownService.turndown(bodyHtml);
    const cleanBody = this.cleanMarkdownNoise(rawMarkdown);

    const mailFolder = this.getTargetPath(
      folderAlias,
      mailId,
      subject,
      parsedMail.date,
      senderEmail,
    );

    if (!fs.existsSync(mailFolder))
      fs.mkdirSync(mailFolder, { recursive: true });

    // 1. raw_message.eml에서 message.eml로 파일명 변경 저장
    fs.writeFileSync(path.join(mailFolder, "message.eml"), rawBuffer);

    const attachmentsList: Array<{
      filename: string;
      contentType: string;
      size: number;
    }> = [];
    const attachmentLinks = (parsedMail.attachments || []).map((att) => {
      const safeName = EmailParser.cleanFilename(att.filename);
      fs.writeFileSync(path.join(mailFolder, safeName), att.content);
      attachmentsList.push({
        filename: safeName,
        contentType: att.contentType || "application/octet-stream",
        size: att.size || (att.content ? att.content.length : 0),
      });
      return `- [[${safeName}]]`;
    });

    // Parse references and message IDs
    const messageId = parsedMail.messageId || "";
    const inReplyTo = parsedMail.inReplyTo || "";
    const references = Array.isArray(parsedMail.references)
      ? parsedMail.references
      : parsedMail.references
        ? [parsedMail.references]
        : [];

    const characterCount = cleanBody.length;

    // Clean text for embeddings (remove markdown links and formatting)
    const plainText = cleanBody
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1") // remove markdown links, keep text
      .replace(/[*_`#\-]/g, "") // remove markdown symbols
      .replace(/\s+/g, " ")
      .trim();

    // 2. YAML Frontmatter with LLM friendly structure
    const wikiTemplate = `---
id: "${mailId}"
title: "${subject.replace(/"/g, '\\"')}"
author: "${sender.replace(/"/g, '\\"')}"
date: "${isoDateKst}"
folder: "${folderAlias}"
tags: [email_backup, ${EmailParser.extractDomainTag(sender)}]
characterCount: ${characterCount}
messageId: "${messageId}"
inReplyTo: "${inReplyTo}"
references: ${JSON.stringify(references)}
---
# ${subject}
## Metadata
- **From:** ${sender}
- **Date:** ${isoDateKst}
- **Mailing ID:** ${mailId}
- **Folder:** ${folderAlias}
- **Raw EML:** [[message.eml]]

## 📎 Attachments
${attachmentLinks.length ? attachmentLinks.join("\n") : "None"}

---
## Content
${cleanBody}`;

    fs.writeFileSync(
      path.join(mailFolder, "message.md"),
      wikiTemplate,
      "utf-8",
    );

    // Write meta.json
    const metaObj = {
      id: mailId,
      title: subject,
      author: sender,
      date: isoDateKst,
      folder: folderAlias,
      tags: ["email_backup", EmailParser.extractDomainTag(sender)],
      characterCount,
      threadInfo: {
        messageId,
        inReplyTo,
        references,
      },
      attachments: attachmentsList,
      plainText,
    };
    fs.writeFileSync(
      path.join(mailFolder, "meta.json"),
      JSON.stringify(metaObj, null, 2),
      "utf-8",
    );

    // Update global index
    const relativePath = path.relative(this.baseDir, mailFolder);
    this.index[mailId] = relativePath;
    this.saveIndex();
  }
}
