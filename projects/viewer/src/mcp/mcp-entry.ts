/**
 * @module mcp-entry
 * @description Dedicated entry point for the Model Context Protocol (MCP) server of LinkedIn Clipper.
 *              Listens on port 3001 and handles SSE & Tool call requests from AI clients.
 * @dependencies express, MongoDatabase, setupMcpServer, AppConfig
 * @lastUpdated 2026-06-16
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { MongoDatabase } from '../database/mongo';
import { setupMcpServer } from './mcp';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

app.use(cors());
app.use(express.json());

// Request logging middleware for debugging
app.use((req: Request, res: Response, next) => {
  console.log(`[MCP-HTTP] ${req.method} ${req.url}`);
  next();
});

setupMcpServer(app);

const mongo = MongoDatabase.getInstance();

async function start() {
  try {
    await mongo.connect();
    await mongo.initIndexes();
    app.listen(PORT, () => {
      console.log(`🚀 [MCP Server] Running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  }
}

start();
