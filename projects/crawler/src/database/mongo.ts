/**
 * @file mongo.ts
 * @description MongoDB database adapter implementing the Singleton pattern.
 * Provides client connection caching, collection creation, and index initialization.
 *
 * Rules Complied:
 * - Centralized Config: Uses AppConfig instead of direct process.env access.
 * - Robust Error Handling: Empty catch blocks replaced with diagnostic warning logs.
 * - Strict Typing: Removed loose 'any' type parameters.
 * - Agent-Friendly Docstrings: File started with this detailed JSDoc.
 */

import { MongoClient, Db, Collection, Document } from "mongodb";
import { AppConfig } from "../config/AppConfig";

export interface MongoDatabaseConfig {
  mongoUrl: string;
  dbName: string;
}

export class MongoDatabase {
  private static instance: MongoDatabase;
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private readonly mongoUrl: string;
  private readonly dbName: string;

  private constructor(
    config: MongoDatabaseConfig = {
      mongoUrl: AppConfig.MONGO_URL,
      dbName: AppConfig.MONGO_INITDB_DATABASE,
    },
  ) {
    this.mongoUrl = config.mongoUrl;
    this.dbName = config.dbName;
  }

  public static getInstance(): MongoDatabase {
    if (!MongoDatabase.instance) {
      MongoDatabase.instance = new MongoDatabase();
    }
    return MongoDatabase.instance;
  }

  public async connect(): Promise<Db> {
    if (this.db) return this.db;

    try {
      console.log(`🔌 [MongoDB] Connecting to ${this.mongoUrl}...`);
      this.client = new MongoClient(this.mongoUrl, {
        maxPoolSize: 10,
        minPoolSize: 2,
      });
      await this.client.connect();
      this.db = this.client.db(this.dbName);
      console.log(
        `✅ [MongoDB] Successfully connected to database: ${this.dbName}`,
      );

      return this.db;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`❌ [MongoDB] Connection error: ${errMsg}`);
      throw err;
    }
  }

  public async getCollection<T extends Document = Document>(
    name: `${"bronze" | "silver"}/${string}`,
  ): Promise<Collection<T>> {
    await this.connect();

    const [, collectionName] = name.split("/");
    if (!this.client) {
      throw new Error("[MongoDB] Client is not connected");
    }
    const targetDb = this.client.db(name.split("/")[0]);
    const collection = targetDb.collection<T>(collectionName);

    return collection;
  }

  public async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      console.log(`🔌 [MongoDB] Connection closed.`);
    }
  }

  /**
   * 빠른 조회를 위한 컬렉션 인덱스 초기화
   */
  public async initIndexes(): Promise<void> {
    if (!this.db) {
      await this.connect();
    }
    if (!this.client) return;

    try {
      const createIdx = async (
        dbName: string,
        col: string,
        spec: Document,
        opts?: object,
      ) => {
        try {
          if (!this.client) return;
          await this.client.db(dbName).collection(col).createIndex(spec, opts);
        } catch (e: unknown) {
          const errMsg = e instanceof Error ? e.message : String(e);
          console.warn(
            `⚠️ [MongoDB] Failed to create index on ${dbName}.${col}: ${errMsg}`,
          );
        }
      };

      const { getAllSites } = require("../core/SiteRegistry");
      const sites = getAllSites();

      for (const site of sites) {
        if (site.indexes) {
          for (const idx of site.indexes) {
            const [dbName, colName] = idx.collection.split("/");
            if (dbName && colName) {
              await createIdx(dbName, colName, idx.fields, idx.options);
            }
          }
        }
      }

      console.log(
        "📌 [MongoDB] All collection indexes successfully initialized.",
      );
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.warn(`⚠️ [MongoDB] Index initialization failed: ${errorMsg}`);
    }
  }
}
