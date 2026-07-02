/**
 * @module imageDownloader
 * @description Core functionality or script runner for imageDownloader.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies fs, path
 * @lastUpdated 2026-06-11
 */

import * as fs from "fs";
import * as path from "path";

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");

export interface DownloadImagesParams {
  htmlContent: string;
  markdown: string;
  publishedAt?: string;
  docId: string;
  siteDir: string;
  siteDomain: string;
  refererUrl: string;
  removeFavicons?: boolean;
}

export interface DownloadImagesResult {
  updatedMarkdown: string;
  downloadedCount: number;
  processedUrls?: Record<string, string>;
}

export async function downloadImages(
  params: DownloadImagesParams,
): Promise<DownloadImagesResult> {
  const {
    htmlContent,
    markdown,
    publishedAt,
    docId,
    siteDir,
    siteDomain,
    refererUrl,
    removeFavicons,
  } = params;

  let year = "unknown",
    month = "unknown";
  if (publishedAt) {
    const d = new Date(publishedAt);
    if (!isNaN(d.getTime())) {
      year = d.getFullYear().toString();
      month = String(d.getMonth() + 1).padStart(2, "0");
    }
  }

  const imageBaseDir = path.join(
    PROJECT_ROOT,
    "data",
    "sites",
    siteDir,
    year,
    month,
    "images",
    docId,
  );
  fs.mkdirSync(imageBaseDir, { recursive: true });

  const urlsToDownload = new Set<string>();

  // Extract from HTML
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = imgRegex.exec(htmlContent)) !== null) {
    urlsToDownload.add(match[1]);
  }

  // Extract from Markdown
  const mdImgRegex = /!\[.*?\]\((https?:\/\/[^)]+)\)/gi;
  while ((match = mdImgRegex.exec(markdown)) !== null) {
    urlsToDownload.add(match[1]);
  }

  const processedUrls = new Map<string, string>();
  const skippedFavicons = new Set<string>();

  for (const originalSrc of urlsToDownload) {
    if (processedUrls.has(originalSrc)) continue;
    if (originalSrc.startsWith("data:")) {
      processedUrls.set(originalSrc, originalSrc);
      continue;
    }

    const lowerSrc = originalSrc.toLowerCase();
    if (lowerSrc.includes("favicon") || lowerSrc.endsWith(".ico")) {
      if (removeFavicons) skippedFavicons.add(originalSrc);
      continue;
    }
    if (lowerSrc.includes("_next/image")) {
      processedUrls.set(originalSrc, originalSrc);
      continue;
    }

    let absoluteUrl = originalSrc;
    if (originalSrc.startsWith("//")) {
      absoluteUrl = "https:" + originalSrc;
    } else if (originalSrc.startsWith("/")) {
      absoluteUrl = "https://" + siteDomain + originalSrc;
    } else if (!/^https?:\/\//i.test(originalSrc)) {
      absoluteUrl = "https://" + siteDomain + "/" + originalSrc;
    }

    try {
      const response = await fetch(absoluteUrl, {
        headers: {
          Referer: refererUrl,
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "image/webp,image/avif,image/*,*/*;q=0.8",
        },
      });
      if (!response.ok) continue;
      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") || "";
      const ext = contentType.includes("png")
        ? ".png"
        : contentType.includes("gif")
          ? ".gif"
          : contentType.includes("webp")
            ? ".webp"
            : contentType.includes("svg")
              ? ".svg"
              : ".jpg";
      const filename = `img_${processedUrls.size}${ext}`;
      fs.writeFileSync(path.join(imageBaseDir, filename), buffer);
      processedUrls.set(
        originalSrc,
        `/${siteDir}/${year}/${month}/images/${docId}/${filename}`,
      );
    } catch {}
  }

  if (processedUrls.size === 0 && skippedFavicons.size === 0) {
    return { updatedMarkdown: markdown, downloadedCount: 0, processedUrls: {} };
  }

  let updatedMarkdown = markdown;
  for (const [originalSrc, localUrl] of processedUrls) {
    if (originalSrc === localUrl) continue;
    const escaped = originalSrc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    updatedMarkdown = updatedMarkdown.replace(
      new RegExp(escaped, "g"),
      localUrl,
    );
  }
  if (removeFavicons && skippedFavicons.size > 0) {
    for (const faviconUrl of skippedFavicons) {
      const escaped = faviconUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      updatedMarkdown = updatedMarkdown.replace(
        new RegExp(`!\\[.*?\\]\\(${escaped}\\)`, "g"),
        "",
      );
    }
  }

  return {
    updatedMarkdown,
    downloadedCount: processedUrls.size,
    processedUrls: Object.fromEntries(processedUrls),
  };
}
