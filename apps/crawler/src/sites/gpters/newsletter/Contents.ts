/**
 * @module Contents
 * @description Core functionality or script runner for Contents.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies fs, path, BasePipeline, Converter, crypto
 * @lastUpdated 2026-06-11
 */

import * as fs from "fs";
import * as path from "path";
import { BasePipeline } from "../../../core/BasePipeline";
import { GptersConverter } from "../Converter";
import { descriptor, GptersMeta } from "./site.config";

const COLLECTION_PREFIX = descriptor.key;
const SITE_DIR = descriptor.key;

export class GptersNewsletterContents extends BasePipeline<GptersMeta> {
  private readonly converter: GptersConverter;

  constructor() {
    super();
    this.converter = new GptersConverter();
  }

  protected extractId(url: string): string {
    const parts = url.split("-");
    const id = parts[parts.length - 1];
    if (id) return id;
    const crypto = require("crypto");
    return crypto.createHash("md5").update(url).digest("hex").substring(0, 10);
  }

  protected getDomainName(): string {
    return "GPTers 뉴스레터";
  }

  protected async executeScrape(
    url: string,
    tempHtmlPath: string,
  ): Promise<void> {
    const id = this.extractId(url);

    console.log(`🌐 [GPTERS Newsletter] Fetching guest access token...`);
    const tokenRes = await fetch(`https://www.${descriptor.domain}/news`);
    const tokenHtml = await tokenRes.text();
    const tokenMatch = tokenHtml.match(/accessToken":"([^"]+)"/);
    if (!tokenMatch)
      throw new Error("Failed to extract GPTERS guest access token");
    const token = tokenMatch[1];

    console.log(`🔑 [GPTERS Newsletter GraphQL] Fetching post ID: ${id} ...`);
    const query = `
        query getPost($id: ID!) {
          post(id: $id) {
            id
            title
            slug
            createdAt
            publishedAt
            createdBy { member { name } }
            reactionsCount
            repliesCount
            shortContent
            fields { key value }
            space { id name slug }
          }
        }
        `;

    const response = await fetch("https://api.bettermode.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({
        query,
        variables: { id },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Failed to fetch GPTERS newsletter via GraphQL. Status: ${response.status}: ${body.slice(0, 200)}`,
      );
    }

    const resJson = await response.json();
    const post = resJson.data?.post;
    if (!post) {
      throw new Error(
        `GPTERS newsletter post ID ${id} not found in GraphQL response`,
      );
    }

    fs.writeFileSync(tempHtmlPath, JSON.stringify(post), "utf-8");
  }

  protected async processMetadata(
    htmlContent: string,
    id: string,
    url: string,
  ): Promise<GptersMeta> {
    return this.converter.convertHtmlToMarkdown(htmlContent, id, url);
  }

  private getDatePathParts(publishedAt: Date | string | null): {
    year: string;
    month: string;
  } {
    if (publishedAt) {
      const d = new Date(publishedAt);
      if (!isNaN(d.getTime())) {
        return {
          year: d.getFullYear().toString(),
          month: String(d.getMonth() + 1).padStart(2, "0"),
        };
      }
    }
    return { year: "unknown", month: "unknown" };
  }

  protected async saveResults(
    meta: GptersMeta,
    id: string,
    tempHtmlPath: string,
    _redisInstance?: any,
  ): Promise<{ targetDirName: string }> {
    const { year, month } = this.getDatePathParts(meta.publishedAt);
    const rawJsonContent = fs.readFileSync(tempHtmlPath, "utf-8");
    let parsedJson: any = {};
    try {
      parsedJson = JSON.parse(rawJsonContent);
    } catch {
      /* ignore */
    }

    const updatedMarkdown = meta.rawContent;
    try {
      const fieldsMap: Record<string, string> = {};
      if (Array.isArray(parsedJson.fields)) {
        for (const f of parsedJson.fields) {
          fieldsMap[f.key] = f.value;
        }
      }
      const htmlContent = (
        fieldsMap.content ||
        parsedJson.shortContent ||
        ""
      ).replace(
        /\\(["nrt\\])/g,
        (_: string, c: string) =>
          (
            ({ '"': '"', n: "\n", r: "\r", t: "\t", "\\": "\\" }) as Record<
              string,
              string
            >
          )[c] || _,
      );

      const { downloadImages } = await import("../../../utils/imageDownloader");
      const { updatedMarkdown: newMarkdown } = await downloadImages({
        htmlContent,
        markdown: meta.rawContent,
        publishedAt: meta.publishedAt
          ? meta.publishedAt instanceof Date
            ? meta.publishedAt.toISOString()
            : String(meta.publishedAt)
          : undefined,
        docId: id,
        siteDir: descriptor.key,
        siteDomain: descriptor.domain || "gpters.org",
        refererUrl: meta.url,
        removeFavicons: true,
      });
      meta.rawContent = newMarkdown;
    } catch (imgErr: any) {
      console.warn(
        `⚠️ [GPTers Newsletter Image Processing] Error: ${imgErr.message}`,
      );
    }

    try {
      const { MongoDatabase } = require("../../../database/mongo");
      const dbInstance = MongoDatabase.getInstance();

      const bronzeColl = await dbInstance.getCollection(
        `bronze/${COLLECTION_PREFIX}.html`,
      );
      await bronzeColl.updateOne(
        { id },
        {
          $set: {
            id,
            url: meta.url,
            rawJson: parsedJson,
            collectedAt: new Date(),
          },
        },
        { upsert: true },
      );

      const silverColl = await dbInstance.getCollection(
        `silver/${COLLECTION_PREFIX}.contents`,
      );
      await silverColl.updateOne(
        { id },
        {
          $set: {
            id,
            title: meta.title,
            url: meta.url,
            author: meta.author,
            shortContent: meta.shortContent,
            publishedAt: meta.publishedAt,
            reactionsCount: meta.reactionsCount,
            repliesCount: meta.repliesCount,
            markdown: meta.rawContent,
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );

      const urlsColl = await dbInstance.getCollection(
        `bronze/${COLLECTION_PREFIX}.urls`,
      );
      await urlsColl.updateOne(
        { id },
        { $set: { status: "completed", updatedAt: new Date() } },
      );

      console.log(
        `📡 [MongoDB Write] Successfully saved GPTERS Newsletter ID ${id}.`,
      );

      const projectRoot = path.resolve(__dirname, "..", "..", "..", "..");
      const baseDir = path.join(
        projectRoot,
        "data",
        "sites",
        SITE_DIR,
        year,
        month,
      );
      const jsonPath = path.join(baseDir, "json", `${id}.json`);
      const mdPath = path.join(baseDir, "markdown", `${id}.md`);

      fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
      fs.mkdirSync(path.dirname(mdPath), { recursive: true });

      await this.converter.prettifyJsonAndSave(rawJsonContent, jsonPath);
      await this.converter.prettifyAndSave(meta.rawContent, mdPath);
      console.log(`💾 [Local Write] Saved GPTERS Newsletter ID ${id} locally.`);
    } catch (dbErr: any) {
      console.error(
        `❌ [GPTERS Newsletter Save Error] Failed to save ${id}: ${dbErr.message}`,
      );
      throw dbErr;
    } finally {
      if (fs.existsSync(tempHtmlPath)) {
        fs.unlinkSync(tempHtmlPath);
      }
    }

    return {
      targetDirName: SITE_DIR,
    };
  }
}

if (require.main === module) {
  const urlsFile = process.argv[2];
  const contents = new GptersNewsletterContents();
  contents.run(urlsFile).catch((err) => {
    console.error("Fatal GPTERS newsletter crash:", err);
    process.exit(1);
  });
}
