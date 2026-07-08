/**
 * @module mcp
 * @description Model Context Protocol (MCP) Server Integration for LinkedIn Clipper.
 *              Exposes search tools and handles SSE connections.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 *   - Access configurations only through Centralized AppConfig.
 * @dependencies express, @modelcontextprotocol/sdk, MeiliSearchDatabase
 * @lastUpdated 2026-06-15
 */

import { Express, Request, Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { MeiliSearchDatabase } from '../database/meili';
import { MongoDatabase } from '../database/mongo';
import { AppConfig } from '../config/AppConfig';
import { getIndexName, getSiteKeyFromCollection } from '../core/SiteRegistry';
import Redis from 'ioredis';

const mongo = MongoDatabase.getInstance();
const redis = new Redis(AppConfig.REDIS_URL);
redis.on('error', (err) => console.error('[MCP Redis Error]', err));

function registerMcpHandlers(server: Server) {
  // MCP: List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'search_documents',
          description: 'Search documents (LinkedIn jobs, geeknews, gpters, pytorch_kr, aicasebook) stored in MongoDB',
          inputSchema: {
            type: 'object',
            properties: {
              collection: {
                type: 'string',
                description: 'The collection name to query (e.g. bronze/linkedin.jobs, bronze/geeknews.html, bronze/gpters.html, bronze/pytorch_kr.html)',
              },
              query: {
                type: 'string',
                description: 'Keyword search query',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of results to return (default 5)',
              },
            },
            required: ['collection', 'query'],
          },
        },
        {
          name: 'get_crawl_stats_in_range',
          description: 'Retrieve daily document crawl counts for all scraper sites over a specific date range',
          inputSchema: {
            type: 'object',
            properties: {
              startDate: {
                type: 'string',
                description: 'Start date in YYYY-MM-DD format (KST)',
              },
              endDate: {
                type: 'string',
                description: 'End date in YYYY-MM-DD format (KST)',
              },
            },
            required: ['startDate', 'endDate'],
          },
        },
        {
          name: 'run_mongo_query',
          description: 'Execute a read-only MongoDB query on a collection (e.g., db.collection.find().limit())',
          inputSchema: {
            type: 'object',
            properties: {
              dbName: {
                type: 'string',
                description: 'Database name (e.g., silver, bronze). Default is "silver"',
              },
              collection: {
                type: 'string',
                description: 'Collection name within the database',
              },
              query: {
                type: 'string',
                description: 'JSON query filter string, e.g. "{\\"status\\": \\"failed\\"}"',
              },
              projection: {
                type: 'string',
                description: 'JSON projection string, e.g. "{\\"rawHtml\\": 0}" to exclude large fields (Highly recommended to exclude rawHtml/content for token efficiency)',
              },
              limit: {
                type: 'number',
                description: 'Maximum document limit. Default is 10, max is 50',
              },
            },
            required: ['collection'],
          },
        },
        {
          name: 'run_meili_query',
          description: 'Search or retrieve index configurations from Meilisearch',
          inputSchema: {
            type: 'object',
            properties: {
              index: {
                type: 'string',
                description: 'Meilisearch index name',
              },
              query: {
                type: 'string',
                description: 'Query string for search. Pass empty string for matching all documents',
              },
              options: {
                type: 'string',
                description: 'Optional JSON string of search options, e.g., "{\\"filter\\": \\"publishedAt > 1700000000\\"}"',
              },
            },
            required: ['index', 'query'],
          },
        },
        {
          name: 'run_redis_query',
          description: 'Diagnose Redis server queues and keys (e.g., KEYS, GET, LLEN, LRANGE)',
          inputSchema: {
            type: 'object',
            properties: {
              command: {
                type: 'string',
                description: 'Redis command to run (KEYS, GET, LLEN, LRANGE, SMEMBERS, HGETALL)',
              },
              key: {
                type: 'string',
                description: 'Target Redis key pattern or exact key',
              },
              args: {
                type: 'array',
                items: { type: 'string' },
                description: 'Additional arguments for the command (e.g., start/end index for LRANGE)',
              },
            },
            required: ['command', 'key'],
          },
        },
      ],
    };
  });

  // MCP: Call tool
  server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    const { name, arguments: args } = request.params;

    try {
      if (name === 'search_documents') {
        const collectionName = args?.collection as string;
        const search = args?.query as string;
        const limit = Number(args?.limit || 5);

        const siteKey = getSiteKeyFromCollection(collectionName);
        const meili = MeiliSearchDatabase.getInstance();
        const indexName = getIndexName(siteKey);
        const searchResults = await meili.search(indexName, search, { limit });

        const formattedResults = searchResults.hits.map(doc => {
          const title = doc.title || 'Untitled';
          const company = doc.companyName || 'Unknown Company';
          const url = doc.url || 'No URL';
          const body = doc.content || '(No body content)';
          return `### Title: ${title}\nCompany: ${company}\nURL: ${url}\nID: ${doc.docId || doc.id}\n---\n${body.substring(0, 1000)}...\n\n`;
        }).join('\n');

        return {
          content: [
            {
              type: 'text',
              text: formattedResults || 'No documents matched the search query.',
            },
          ],
        };
      }

      if (name === 'get_crawl_stats_in_range') {
        const startDateStr = args?.startDate as string;
        const endDateStr = args?.endDate as string;

        if (!/^\d{4}-\d{2}-\d{2}$/.test(startDateStr) || !/^\d{4}-\d{2}-\d{2}$/.test(endDateStr)) {
          throw new Error('Dates must be in YYYY-MM-DD format');
        }

        const startUtc = new Date(`${startDateStr}T00:00:00+09:00`);
        const endUtc = new Date(`${endDateStr}T23:59:59.999+09:00`);

        await mongo.connect();
        const client = (mongo as any).client;
        if (!client) throw new Error('MongoDB client not initialized');

        const silverDb = client.db('silver');
        const collections = await silverDb.listCollections().toArray();
        const targetCollections = collections
          .map(c => c.name)
          .filter(name => name === 'linkedin.jobs' || name.endsWith('.contents') || name === 'linkedin.companies');

        const statsMap: Record<string, Record<string, number>> = {};
        
        // Initialize dates
        const tempDate = new Date(startUtc);
        while (tempDate <= endUtc) {
          const kstDateStr = new Date(tempDate.getTime() + (9 * 60 * 60 * 1000)).toISOString().slice(0, 10);
          statsMap[kstDateStr] = {};
          tempDate.setDate(tempDate.getDate() + 1);
        }

        for (const collName of targetCollections) {
          const coll = silverDb.collection(collName);
          const aggregationResult = await coll.aggregate([
            {
              $match: {
                updatedAt: { $gte: startUtc, $lte: endUtc }
              }
            },
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: "$updatedAt",
                    timezone: "Asia/Seoul"
                  }
                },
                count: { $sum: 1 }
              }
            }
          ]).toArray();

          for (const group of aggregationResult) {
            const dateKey = group._id;
            if (dateKey && statsMap[dateKey]) {
              statsMap[dateKey][collName] = group.count;
            }
          }
        }

        // Generate Markdown table output
        const sortedDates = Object.keys(statsMap).sort();
        let markdown = `# Crawl Stats Report (${startDateStr} ~ ${endDateStr})\n\n`;
        markdown += `| Date | ` + targetCollections.join(' | ') + ` | Total |\n`;
        markdown += `| :--- | ` + targetCollections.map(() => `:---:`).join(' | ') + ` | :---: |\n`;

        for (const date of sortedDates) {
          let rowTotal = 0;
          const cols = targetCollections.map(collName => {
            const val = statsMap[date][collName] || 0;
            rowTotal += val;
            return val > 0 ? `**${val}**` : `0`;
          });
          markdown += `| ${date} | ${cols.join(' | ')} | **${rowTotal}** |\n`;
        }

        return {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
        };
      }

      if (name === 'run_mongo_query') {
        const dbName = (args?.dbName || 'silver') as string;
        const collName = args?.collection as string;
        const queryStr = (args?.query || '{}') as string;
        const projStr = (args?.projection || '') as string;
        const limit = Math.min(Number(args?.limit || 10), 50);

        let queryObj = {};
        let projObj: any = undefined;

        try {
          queryObj = JSON.parse(queryStr);
        } catch (e: any) {
          throw new Error(`Invalid JSON in query: ${e.message}`, { cause: e });
        }

        if (projStr) {
          try {
            projObj = JSON.parse(projStr);
          } catch (e: any) {
            throw new Error(`Invalid JSON in projection: ${e.message}`, { cause: e });
          }
        }

        await mongo.connect();
        const client = (mongo as any).client;
        if (!client) throw new Error('MongoDB client not initialized');

        const db = client.db(dbName);
        const coll = db.collection(collName);
        
        let cursor = coll.find(queryObj);
        if (projObj) {
          cursor = cursor.project(projObj);
        }
        const docs = await cursor.limit(limit).toArray();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(docs, null, 2),
            },
          ],
        };
      }

      if (name === 'run_meili_query') {
        const indexName = args?.index as string;
        const query = args?.query as string;
        const optionsStr = (args?.options || '') as string;

        let optionsObj = {};
        if (optionsStr) {
          try {
            optionsObj = JSON.parse(optionsStr);
          } catch (e: any) {
            throw new Error(`Invalid JSON in options: ${e.message}`, { cause: e });
          }
        }

        const meili = MeiliSearchDatabase.getInstance();
        const results = await meili.search(indexName, query, optionsObj);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      }

      if (name === 'run_redis_query') {
        const command = (args?.command as string).toUpperCase();
        const key = args?.key as string;
        const cmdArgs = (args?.args || []) as string[];

        let result: any;
        if (command === 'KEYS') {
          result = await redis.keys(key);
        } else if (command === 'GET') {
          result = await redis.get(key);
        } else if (command === 'LLEN') {
          result = await redis.llen(key);
        } else if (command === 'LRANGE') {
          const start = cmdArgs[0] ? parseInt(cmdArgs[0], 10) : 0;
          const end = cmdArgs[1] ? parseInt(cmdArgs[1], 10) : -1;
          result = await redis.lrange(key, start, end);
        } else if (command === 'SMEMBERS') {
          result = await redis.smembers(key);
        } else if (command === 'HGETALL') {
          result = await redis.hgetall(key);
        } else {
          throw new Error(`Unsupported Redis command: ${command}`);
        }

        return {
          content: [
            {
              type: 'text',
              text: typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result),
            },
          ],
        };
      }

      throw new Error(`Tool not found: ${name}`);
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Error executing tool ${name}: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  });
}

const activeSessions = new Map<string, { server: Server; transport: SSEServerTransport }>();

export function setupMcpServer(app: Express) {
  app.get('/sse', async (req: Request, res: Response) => {
    console.log('🔌 [MCP] SSE Connection initiated');
    
    const transportInstance = new SSEServerTransport('/messages', res);
    const sessionServer = new Server(
      {
        name: 'linkedin-clipper-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    registerMcpHandlers(sessionServer);

    try {
      await sessionServer.connect(transportInstance);
      const sessionId = transportInstance.sessionId;
      activeSessions.set(sessionId, { server: sessionServer, transport: transportInstance });
      console.log(`✅ [MCP] SSE Session established: ${sessionId}. Total sessions: ${activeSessions.size}`);

      res.on('close', async () => {
        console.log(`🔌 [MCP] SSE Session closed: ${sessionId}`);
        try {
          await sessionServer.close();
        } catch (e) {
          // Ignore close error
        }
        activeSessions.delete(sessionId);
      });
    } catch (err: any) {
      console.error(`⚠️ [MCP] SSE connect error: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).end();
      }
    }
  });

  app.post('/messages', async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    const session = activeSessions.get(sessionId);
    if (session) {
      await session.transport.handlePostMessage(req, res, req.body);
    } else {
      res.status(404).end();
    }
  });
}
