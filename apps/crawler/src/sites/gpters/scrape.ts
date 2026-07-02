/**
 * @module scrape
 * @description Core functionality or script runner for scrape.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies fs
 * @lastUpdated 2026-06-11
 */

import * as fs from "fs";
import { descriptor } from "./news/site.config";

function extractIdFromGptersUrl(url: string): string {
  const parts = url.split("-");
  return parts[parts.length - 1] || "";
}

let cachedToken: string | null = null;
let tokenExpiry = 0;

async function fetchGptersGuestToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry) {
    return cachedToken;
  }

  const res = await fetch(`https://www.${descriptor.domain}/news`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch GPTERS homepage: HTTP status ${res.status}`,
    );
  }
  const html = await res.text();
  const match = html.match(/accessToken":"([^"]+)"/);
  if (!match) {
    throw new Error(
      "Failed to extract GPTERS guest access token from homepage",
    );
  }

  cachedToken = match[1];
  try {
    const payloadPart = cachedToken.split(".")[1];
    if (payloadPart) {
      const decoded = JSON.parse(
        Buffer.from(payloadPart, "base64").toString("utf-8"),
      );
      if (decoded && decoded.exp) {
        tokenExpiry = decoded.exp * 1000 - 300000; // 5 min margin
      } else {
        tokenExpiry = now + 3600000;
      }
    } else {
      tokenExpiry = now + 3600000;
    }
  } catch {
    tokenExpiry = now + 3600000;
  }

  return cachedToken;
}

export async function scrapeGptersGraphQL(
  url: string,
  tempPath: string,
): Promise<void> {
  const id = extractIdFromGptersUrl(url);
  const token = await fetchGptersGuestToken();
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
}`;
  const response = await fetch("https://api.bettermode.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({ query, variables: { id } }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `GPTERS GraphQL HTTP status ${response.status} for ID ${id}: ${body.slice(0, 200)}`,
    );
  }
  const resJson = (await response.json()) as any;
  const post = resJson.data?.post;
  if (!post) {
    throw new Error(`GPTERS post ID ${id} not found in GraphQL response`);
  }
  fs.writeFileSync(tempPath, JSON.stringify(post), "utf-8");
}
