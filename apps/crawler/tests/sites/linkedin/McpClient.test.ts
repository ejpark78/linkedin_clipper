/**
 * @module McpClient.test
 * @description Core functionality or script runner for McpClient.test.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies assert, https, http
 * @lastUpdated 2026-06-11
 */

import * as assert from "assert";
import https from "https";
import http from "http";

const VIEWER_URL = "https://viewer.localhost";
const MCP_SSE_URL = "https://mcp.localhost/sse";

function fetch(url: string, timeout = 5000): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const agent = url.startsWith("https")
      ? new https.Agent({ rejectUnauthorized: false })
      : new http.Agent();
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { agent, timeout }, (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0 });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

interface McpToolCallPayload {
  jsonrpc: string;
  id: number;
  method: string;
  params: { name: string; arguments?: Record<string, unknown> };
}

interface McpServerResult {
  content: { type: string; text: string }[];
}

interface McpServerResponse {
  jsonrpc: string;
  id: number;
  result?: McpServerResult;
  error?: unknown;
}

class McpSseClient {
  private urlObj: URL;
  private agent: https.Agent;
  private req: http.ClientRequest | null = null;
  private pendingResolve: ((value: unknown) => void) | null = null;

  constructor(private sseUrl: string) {
    this.urlObj = new URL(sseUrl);
    this.agent = new https.Agent({ rejectUnauthorized: false });
  }

  connect(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.req = https.request(
        {
          hostname: this.urlObj.hostname,
          port: this.urlObj.port ? Number(this.urlObj.port) : 443,
          path: this.urlObj.pathname + this.urlObj.search,
          method: "GET",
          headers: { Accept: "text/event-stream" },
          agent: this.agent,
        },
        (res) => {
          if (res.statusCode !== 200) {
            reject(
              new Error(
                `Connection failed with status code: ${res.statusCode}`,
              ),
            );
            return;
          }
          let endpointPath = "";
          res.on("data", (chunk: Buffer) => {
            for (const line of chunk.toString().split("\n")) {
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6).trim();
              if (!endpointPath) {
                endpointPath = data;
                resolve(endpointPath);
              } else {
                this.handleSseMessage(data);
              }
            }
          });
        },
      );
      this.req.on("error", reject);
      this.req.end();
    });
  }

  callTool(
    endpointPath: string,
    toolName: string,
    args?: Record<string, unknown>,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve;
      const payload: McpToolCallPayload = {
        jsonrpc: "2.0",
        id: 42,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      };
      const body = JSON.stringify(payload);
      const postReq = https.request(
        {
          hostname: this.urlObj.hostname,
          port: this.urlObj.port ? Number(this.urlObj.port) : 443,
          path: endpointPath,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
          agent: this.agent,
        },
        (res) => {
          res.resume();
          if (res.statusCode !== 200 && res.statusCode !== 202) {
            reject(new Error(`POST failed: HTTP ${res.statusCode}`));
          }
        },
      );
      postReq.on("error", reject);
      postReq.write(body);
      postReq.end();
    });
  }

  private handleSseMessage(data: string): void {
    try {
      const parsed = JSON.parse(data) as McpServerResponse;
      if (parsed.id === 42 && this.pendingResolve) {
        this.pendingResolve(parsed.result);
      }
    } catch {
      /* heartbeat 등 무시 */
    }
  }

  close(): void {
    this.req?.destroy();
  }
}

async function main() {
  // viewer health check
  let viewerUp = false;
  try {
    const resp = await fetch(VIEWER_URL);
    viewerUp = resp.status === 200 || resp.status === 302;
  } catch {
    /* fall through */
  }

  if (!viewerUp) {
    console.log(
      `⚠️  Viewer not reachable at ${VIEWER_URL} — skipping MCP client test`,
    );
    process.exit(0);
  }

  console.log(`✅ Viewer is reachable — proceeding with MCP client test\n`);

  const client = new McpSseClient(MCP_SSE_URL);
  try {
    const endpointPath = await client.connect();
    assert.ok(endpointPath, "Should receive message endpoint path");
    assert.ok(
      endpointPath.startsWith("/"),
      "Endpoint path should start with /",
    );
    console.log(`✅ SSE connected, endpoint: ${endpointPath}`);

    const result = await client.callTool(endpointPath, "search_documents", {
      collection: "silver/linkedin.jobs",
      query: "MLOps",
      limit: 3,
    });

    assert.ok(result, "Should receive a result");
    assert.ok((result as any).content, "Result should have content array");
    assert.ok(
      (result as any).content.length > 0,
      "Content array should not be empty",
    );
    assert.ok(
      typeof (result as any).content[0].text === "string",
      "Content text should be a string",
    );
    console.log("✅ MCP tool call succeeded, content received");
  } finally {
    client.close();
  }

  console.log("\n🎉 [성공] MCP Client test passed!");
}

main().catch((err) => {
  console.error("❌ MCP Client test failed:", err.message);
  process.exit(1);
});
