/**
 * @module TargetLoader
 * @description Core functionality or script runner for TargetLoader.ts.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 * @dependencies mongo, SiteRegistry
 * @lastUpdated 2026-06-11
 */

import { MongoDatabase } from "../database/mongo";
import { getSite } from "../core/SiteRegistry";

export class TargetLoader {
  public static async load(site: string, id: string, meta: any): Promise<void> {
    const mongo = MongoDatabase.getInstance();
    const desc = getSite(site);

    if (!desc?.targetLoader) {
      throw new Error(`No target loader configuration for site: ${site}`);
    }

    const tl = desc.targetLoader;
    const collection = await mongo.getCollection(tl.collectionName);
    const doc = tl.buildDocument(id, meta);

    // 1. Update MongoDB Silver Database
    await collection.updateOne(
      { [tl.filterField]: id },
      { $set: doc },
      { upsert: true },
    );
  }
}
