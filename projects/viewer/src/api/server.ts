/**
 * @module server
 * @description Hybrid HTTP Express & Model Context Protocol (MCP) Server for LinkedIn Clipper.
 *              Serves the Vue frontend dashboard and lists collection, document details, and Redis queue status.
 * @constraints
 *   - Follows strict OOP patterns and clean error handling.
 *   - Access configurations only through Centralized AppConfig.
 *   - Strict typing (avoid any where possible).
 * @dependencies express, path, mongo, mongodb, AppConfig, ioredis, index.js
 * @lastUpdated 2026-06-13
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { MongoDatabase } from '../database/mongo';
import { ObjectId } from 'mongodb';
import { getAllSites, getIndexName, getSiteKeyFromCollection } from '../core/SiteRegistry';
import { MeiliSearchDatabase } from '../database/meili';
import { AppConfig } from '../config/AppConfig';
import Redis from 'ioredis';
import exporterRouter from './routes/exporter';

const app = express();
const PORT = AppConfig.PORT;
const redis = new Redis(AppConfig.REDIS_URL);
redis.on('error', (err) => console.error('[Redis Error]', err));

app.use(cors());
app.use(express.json());


// Serve downloaded images from site scrapers
const projectRoot = path.resolve(__dirname, '..', '..');
const sites = getAllSites();
for (const site of sites) {
  if (site.key) {
    app.use(`/${site.key}`, express.static(path.join(projectRoot, 'data', 'sites', site.key)));
  }
}

// Request logging middleware for debugging
app.use((req: Request, res: Response, next) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);
  next();
});

const mongo = MongoDatabase.getInstance();

app.use('/api/exporter', exporterRouter);

// 1. HTTP REST API
app.get('/api/collections', async (req: Request, res: Response) => {
  try {
    await mongo.connect();
    const client = (mongo as any).client; // Access private client via any
    if (!client) throw new Error('MongoDB client not initialized');

    const collections: any[] = [];
    
    // Special case for LinkedIn Jobs (Merged)
    const linkedinSite = sites.find(s => s.key === 'linkedin');
    collections.push({
      id: 'linkedin.jobs',
      name: 'LinkedIn Jobs',
      favicon: linkedinSite?.favicon || '',
    });

    // Dynamic fetch from Silver DB
    const silverDb = client.db('silver');
    const silverColls = await silverDb.listCollections({ name: /\.contents$/ }).toArray();
    
    for (const col of silverColls) {
      const name = col.name;
      if (name === 'linkedin.jobs') continue; // Handled by merged case
      
      // format: 'geeknews.contents' -> 'GeekNews'
      const siteName = name.split('.')[0];
      const displayName = siteName
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/_/g, ' ')
        .replace(/^\w/, (first: string) => first.toUpperCase());
      
      const site = sites.find(s => s.key === siteName);
      
      collections.push({
        id: `silver/${name}`,
        name: displayName,
        favicon: site?.favicon || '',
      });
    }
    
    // Add LinkedIn Companies if exists in silver
    const hasCompanies = (await silverDb.listCollections({ name: 'linkedin.companies' }).toArray()).length > 0;
    if (hasCompanies) {
      const companySite = sites.find(s => s.key === 'linkedin_company');
      collections.push({
        id: 'silver/linkedin.companies',
        name: 'LinkedIn Companies',
        favicon: companySite?.favicon || '',
      });
    }

    collections.sort((a, b) => a.name.localeCompare(b.name));

    res.json(collections);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/site-stats/search
app.get('/api/site-stats/search', async (req: Request, res: Response) => {
  try {
    const startDateStr = req.query.startDate as string;
    const endDateStr = req.query.endDate as string;
    const dateType = req.query.dateType === 'published' ? 'publishedAt' : 'updatedAt';

    if (!startDateStr || !endDateStr) {
      return res.status(400).json({ error: 'startDate and endDate parameters are required (YYYY-MM-DD)' });
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDateStr) || !dateRegex.test(endDateStr)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const startUtc = new Date(`${startDateStr}T00:00:00+09:00`);
    const endUtc = new Date(`${endDateStr}T23:59:59.999+09:00`);

    if (isNaN(startUtc.getTime()) || isNaN(endUtc.getTime())) {
      return res.status(400).json({ error: 'Invalid date values' });
    }

    await mongo.connect();
    const client = (mongo as any).client;
    if (!client) throw new Error('MongoDB client not initialized');

    const silverDb = client.db('silver');
    const collections = await silverDb.listCollections().toArray();
    
    // We target 'linkedin.jobs' and any collection ending with '.contents' or 'linkedin.companies'
    const targetCollections = collections
      .map(c => c.name)
      .filter(name => name === 'linkedin.jobs' || name.endsWith('.contents') || name === 'linkedin.companies');

    // Result structure: Record<string (date), Record<string (site), number>>
    const statsMap: Record<string, Record<string, number>> = {};

    // Initialize all dates in range to prevent missing dates in UI using millisecond step
    const startMs = startUtc.getTime();
    const endMs = endUtc.getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;

    for (let ms = startMs; ms <= endMs; ms += oneDayMs) {
      // Get the date string in KST timezone
      const kstDateStr = new Date(ms + (9 * 60 * 60 * 1000)).toISOString().slice(0, 10);
      statsMap[kstDateStr] = {};
    }

    for (const collName of targetCollections) {
      console.log(`[Server] Aggregating daily stats for collection: ${collName} using field ${dateType}`);
      try {
        const coll = silverDb.collection(collName);
        const pipeline: any[] = [];

        if (dateType === 'publishedAt') {
          // Direct index match pipeline since publishedAt is now stored as Date object
          pipeline.push(
            {
              $match: {
                publishedAt: {
                  $exists: true,
                  $ne: null,
                  $gte: startUtc,
                  $lte: endUtc
                }
              }
            },
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: "$publishedAt",
                    timezone: "Asia/Seoul"
                  }
                },
                count: { $sum: 1 }
              }
            }
          );
        } else {
          // High performance direct index match pipeline for updatedAt
          pipeline.push(
            {
              $match: {
                updatedAt: {
                  $exists: true,
                  $ne: null,
                  $gte: startUtc,
                  $lte: endUtc
                }
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
          );
        }

        const aggregationResult = await coll.aggregate(pipeline).toArray();

        console.log(`[Server] Aggregation finished for ${collName}. Got ${aggregationResult.length} groups.`);

        for (const group of aggregationResult) {
          const dateKey = group._id;
          if (dateKey) {
            if (!statsMap[dateKey]) {
              statsMap[dateKey] = {};
            }
            statsMap[dateKey][collName] = group.count;
          }
        }
      } catch (err: any) {
        console.error(`[Server] Error aggregating collection ${collName}:`, err.message);
      }
    }

    // Convert statsMap to sorted array
    const sortedStats = Object.keys(statsMap)
      .sort()
      .map(date => ({
        date,
        stats: statsMap[date]
      }));

    res.json(sortedStats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/documents', async (req: Request, res: Response) => {
  try {
    const collectionName = req.query.collection as string || 'linkedin.jobs';
    const search = req.query.search as string || '';
    const page = parseInt(req.query.page as string || '1', 10);
    const limit = parseInt(req.query.limit as string || '30', 10);
    const skip = (page - 1) * limit;

    const siteKey = getSiteKeyFromCollection(collectionName);
    const meili = MeiliSearchDatabase.getInstance();
    const indexName = getIndexName(siteKey);
    const filter: string[] = [];

    if (collectionName === 'linkedin.jobs') {
      const country = req.query.country as string || '';
      if (country) {
        filter.push(`geo = "${country}"`);
      }
    }

    const searchResults = await meili.search(indexName, search, {
      filter: filter.length > 0 ? filter : undefined,
      limit,
      offset: skip,
      sort: ['publishedAt:desc']
    });

    const mappedDocs = searchResults.hits.map(h => ({
      _id: h.docId,
      id: h.docId,
      jobId: h.site === 'linkedin' ? h.docId : undefined,
      title: h.title,
      companyName: h.companyName,
      site: h.site,
      url: h.url,
      geo: h.geo,
      location: h.location,
      publishedAt: h.publishedAt,
      collectedAt: h.publishedAt,
      updatedAt: h.updatedAt,
      hasSilver: true,
      hasBronze: true
    }));

    res.json({
      total: searchResults.estimatedTotalHits,
      page,
      limit,
      documents: mappedDocs
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/documents/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const collectionName = req.query.collection as string || 'linkedin.jobs';

    if (collectionName === 'linkedin.jobs') {
      const silverColl = await mongo.getCollection('silver/linkedin.jobs');
      const numId = parseInt(id, 10);
      const filter = isNaN(numId) ? { jobId: id } : { $or: [{ jobId: id }, { jobId: numId }] };
      const silverDoc = await silverColl.findOne(filter);

      if (!silverDoc) {
        return res.status(404).json({ error: 'Document not found' });
      }

      // Return a lightweight document without bronze's rawHtml
      return res.json({
        isMerged: true,
        bronze: { jobId: silverDoc.jobId, url: silverDoc.url },
        silver: silverDoc
      });
    }

    const collection = await mongo.getCollection(collectionName as `${'bronze' | 'silver'}/${string}`);

    let filter: any = {};
    if (ObjectId.isValid(id)) {
      filter = { $or: [{ _id: new ObjectId(id) }, { id: id }, { jobId: id }, { topicId: id }, { postId: id }] };
    } else {
      filter = { $or: [{ id: id }, { jobId: id }, { topicId: id }, { postId: id }, { _id: id }] };
    }

    const doc = await collection.findOne(filter);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Omit stitching rawHtml here to make it fast
    res.json(doc);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// New endpoint for lazy loading raw HTML / JSON
app.get('/api/documents/:id/raw', async (req: Request, res: Response) => {
  try {
    let id = req.params.id;
    const collectionName = req.query.collection as string || 'linkedin.jobs';

    // 1. If the id is a valid MongoDB ObjectId, it might be the silver document's _id.
    // We should first try to find the silver document to get its real business ID.
    if (ObjectId.isValid(id)) {
      try {
        const silverColl = await mongo.getCollection(collectionName as `${'bronze' | 'silver'}/${string}`);
        const silverDoc = await silverColl.findOne({ _id: new ObjectId(id) });
        if (silverDoc) {
          // Extract the business ID from the silver document
          id = silverDoc.id || silverDoc.jobId || silverDoc.topicId || silverDoc.postId || id;
        }
      } catch (err) {
        console.warn(`[Server] Failed to resolve business ID from silver ObjectId: ${id}`, err);
      }
    }

    if (collectionName === 'linkedin.jobs') {
      const bronzeColl = await mongo.getCollection('bronze/linkedin.jobs');
      const numId = parseInt(id, 10);
      const isNum = !isNaN(numId) && /^\d+$/.test(id);
      
      const filter = isNum 
        ? { $or: [{ jobId: id }, { jobId: numId }, { _id: ObjectId.isValid(id) ? new ObjectId(id) : undefined }] } 
        : { $or: [{ jobId: id }, { _id: ObjectId.isValid(id) ? new ObjectId(id) : undefined }] };
        
      const bronzeDoc = await bronzeColl.findOne(filter);
      
      if (!bronzeDoc) {
        return res.status(404).json({ error: 'Raw HTML not found' });
      }
      return res.json({ rawHtml: bronzeDoc.rawHtml, rawJson: bronzeDoc.rawJson });
    }

    // Other collections
    const site = sites.find(s => s.targetLoader?.collectionName === collectionName);
    if (site && site.scraper?.collectionName) {
      const bronzeColl = await mongo.getCollection(site.scraper.collectionName);
      const updateFilterKey = site.scraper.updateFilterKey || 'id';
      
      const numId = parseInt(id, 10);
      const isNum = !isNaN(numId) && /^\d+$/.test(id);
      
      const orConditions: any[] = [];
      
      // Query by updateFilterKey
      orConditions.push({ [updateFilterKey]: id });
      if (isNum) orConditions.push({ [updateFilterKey]: numId });
      
      // Query by id
      if (updateFilterKey !== 'id') {
        orConditions.push({ id: id });
        if (isNum) orConditions.push({ id: numId });
      }
      
      // Query by _id in case the original parameter id was the bronze _id
      if (ObjectId.isValid(id)) {
        orConditions.push({ _id: new ObjectId(id) });
      }
      
      const bronzeDoc = await bronzeColl.findOne({ $or: orConditions });
      if (bronzeDoc) {
        return res.json({ rawHtml: bronzeDoc.rawHtml, rawJson: bronzeDoc.rawJson });
      }
    }

    res.status(404).json({ error: 'Raw HTML not found' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Queue dashboard Type Interfaces
interface ScrapeTaskPayload {
  site: string;
  url: string;
  attempt: number;
  priority: string;
}

interface ConvertTaskPayload {
  site: string;
  id: string;
  bronze_db: string;
  bronze_collection: string;
  bronze_id: string;
  timestamp: string;
}

interface DeadLetterPayload {
  site: string;
  url: string;
  error: string;
  failedAt: string;
}

interface QueueInfo {
  name: string;
  type: 'list' | 'set';
  length: number;
  items: ScrapeTaskPayload[] | string[];
}

interface QueueStatusPayload {
  queues: QueueInfo[];
  convertQueue: {
    length: number;
    siteCounts: Record<string, number>;
    items: ConvertTaskPayload[];
  };
  indexQueue: {
    length: number;
    siteCounts: Record<string, number>;
    items: any[];
  };
  activeProcessing: {
    length: number;
    items: string[];
  };
  deadLetter: {
    length: number;
    siteCounts: Record<string, number>;
    items: DeadLetterPayload[];
  };
}

interface AddQueueRequest {
  site: string;
  url: string;
  priority?: string;
}

// Queue dashboard API endpoints
app.get('/api/queues', async (req: Request, res: Response) => {
  try {
    const scrapeQueueKeys = await redis.keys('scrape_queue*');
    const siteQueueKeys = await redis.keys('sites:*:scrape:*');
    const keys = Array.from(new Set([...scrapeQueueKeys, ...siteQueueKeys]));
    const queues: QueueInfo[] = [];
    
    keys.sort();
    
    for (const key of keys) {
      const type = await redis.type(key);
      if (type === 'list') {
        const length = await redis.llen(key);
        const rawItems = await redis.lrange(key, 0, 19);
        const items = rawItems.map((item): ScrapeTaskPayload => {
          try {
            return JSON.parse(item) as ScrapeTaskPayload;
          } catch {
            return { site: 'Unknown', url: item, attempt: 1, priority: 'medium' };
          }
        });
        queues.push({ name: key, type: 'list', length, items });
      } else if (type === 'set') {
        const length = await redis.scard(key);
        const rawItems = await redis.smembers(key);
        queues.push({ name: key, type: 'set', length, items: rawItems });
      }
    }
    
    const convertQueueLength = await redis.llen('convert_queue');
    const allConvertItems = await redis.lrange('convert_queue', 0, -1);
    const convertQueueSiteCounts: Record<string, number> = {};
    for (const item of allConvertItems) {
      try {
        const parsed = JSON.parse(item);
        const site = parsed.site || 'Unknown';
        convertQueueSiteCounts[site] = (convertQueueSiteCounts[site] || 0) + 1;
      } catch {
        convertQueueSiteCounts['Unknown'] = (convertQueueSiteCounts['Unknown'] || 0) + 1;
      }
    }
    const convertItems = allConvertItems.slice(0, 20).map((item): ConvertTaskPayload => {
      try {
        return JSON.parse(item) as ConvertTaskPayload;
      } catch {
        return {
          site: 'Unknown',
          id: item,
          bronze_db: 'bronze',
          bronze_collection: '',
          bronze_id: '',
          timestamp: new Date().toISOString()
        };
      }
    });
    
    const activeProcessingLength = await redis.scard('active_processing');
    const activeProcessingItems = await redis.smembers('active_processing');
    
    const deadLetterLength = await redis.llen('dead_letter_queue');
    const allDeadLetterItems = await redis.lrange('dead_letter_queue', 0, -1);
    const deadLetterSiteCounts: Record<string, number> = {};
    for (const item of allDeadLetterItems) {
      try {
        const parsed = JSON.parse(item);
        const site = parsed.site || 'Unknown';
        deadLetterSiteCounts[site] = (deadLetterSiteCounts[site] || 0) + 1;
      } catch {
        deadLetterSiteCounts['Unknown'] = (deadLetterSiteCounts['Unknown'] || 0) + 1;
      }
    }
    const deadLetterItems = allDeadLetterItems.slice(0, 50).map((item): DeadLetterPayload => {
      try {
        return JSON.parse(item) as DeadLetterPayload;
      } catch {
        return {
          site: 'Unknown',
          url: '',
          error: item,
          failedAt: new Date().toISOString()
        };
      }
    });
    
    const indexQueueLength = await redis.llen('index_queue');
    const allIndexItems = await redis.lrange('index_queue', 0, -1);
    const indexQueueSiteCounts: Record<string, number> = {};
    for (const item of allIndexItems) {
      try {
        const parsed = JSON.parse(item);
        const site = parsed.site || 'Unknown';
        indexQueueSiteCounts[site] = (indexQueueSiteCounts[site] || 0) + 1;
      } catch {
        indexQueueSiteCounts['Unknown'] = (indexQueueSiteCounts['Unknown'] || 0) + 1;
      }
    }
    const indexItems = allIndexItems.slice(0, 20).map((item): any => {
      try {
        return JSON.parse(item);
      } catch {
        return { site: 'Unknown', id: item };
      }
    });

    const responsePayload: QueueStatusPayload = {
      queues,
      convertQueue: {
        length: convertQueueLength,
        siteCounts: convertQueueSiteCounts,
        items: convertItems
      },
      indexQueue: {
        length: indexQueueLength,
        siteCounts: indexQueueSiteCounts,
        items: indexItems
      },
      activeProcessing: {
        length: activeProcessingLength,
        items: activeProcessingItems
      },
      deadLetter: {
        length: deadLetterLength,
        siteCounts: deadLetterSiteCounts,
        items: deadLetterItems
      }
    };
    
    res.json(responsePayload);
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/site-stats', async (req: Request, res: Response) => {
  try {
    const siteStats: Record<string, { name: string; silverCount: number; meiliCount: number; htmlCount: number; urlsCount: number }> = {};
    await mongo.connect();
    const client = (mongo as any).client;
    if (client) {
      const silverDb = client.db('silver');
      const bronzeDb = client.db('bronze');
      const meili = MeiliSearchDatabase.getInstance();

      for (const site of sites) {
        if (!site.key) continue;
        let silverCount = 0;
        let meiliCount = 0;
        let htmlCount = 0;
        let urlsCount = 0;

        // 1. Get Bronze DB counts (HTML and URLs)
        try {
          const htmlCollName = site.scraper?.collectionName?.replace(/^bronze\//, '');
          if (htmlCollName) {
            const collExists = (await bronzeDb.listCollections({ name: htmlCollName }).toArray()).length > 0;
            if (collExists) {
              htmlCount = await bronzeDb.collection(htmlCollName).countDocuments({});
            }
          }
        } catch (dbErr) {
          console.error(`[Stats] Error fetching bronze html count for ${site.key}:`, dbErr);
        }

        try {
          const urlsCollName = (
            site.scraper?.urlsCollectionName || 
            site.converter?.statusCollection || 
            site.listsCollectionName || 
            site.companyUrlsCollectionName
          )?.replace(/^bronze\//, '');

          if (urlsCollName) {
            const collExists = (await bronzeDb.listCollections({ name: urlsCollName }).toArray()).length > 0;
            if (collExists) {
              urlsCount = await bronzeDb.collection(urlsCollName).countDocuments({});
            }
          }
        } catch (dbErr) {
          console.error(`[Stats] Error fetching bronze urls count for ${site.key}:`, dbErr);
        }

        // 2. Get Silver DB counts
        try {
          const collName = site.key === 'linkedin' ? 'linkedin.jobs' : `${site.key}.contents`;
          // Check if collection exists
          const collExists = (await silverDb.listCollections({ name: collName }).toArray()).length > 0;
          if (collExists) {
            silverCount = await silverDb.collection(collName).countDocuments({});
          }
        } catch (dbErr) {
          console.error(`[Stats] Error fetching silver db count for ${site.key}:`, dbErr);
        }

        // 3. Get Meilisearch counts
        try {
          const indexName = getIndexName(site.key);
          const stats = await meili.getStats(indexName);
          meiliCount = stats.numberOfDocuments || 0;
        } catch (meiliErr) {
          // Index might not exist yet, treat as 0
        }

        siteStats[site.key] = { name: site.name, silverCount, meiliCount, htmlCount, urlsCount };
      }
    }
    res.json(siteStats);
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/queues/clear', async (req: Request, res: Response) => {
  try {
    const scrapeQueueKeys = await redis.keys('scrape_queue*');
    const siteQueueKeys = await redis.keys('sites:*:scrape:*');
    const keys = Array.from(new Set([...scrapeQueueKeys, ...siteQueueKeys]));
    const keysToClear = [...keys];
    
    const activeProcessingExists = await redis.exists('active_processing');
    if (activeProcessingExists) {
      keysToClear.push('active_processing');
    }
    
    const deadLetterExists = await redis.exists('dead_letter_queue');
    if (deadLetterExists) {
      keysToClear.push('dead_letter_queue');
    }
    
    const convertQueueExists = await redis.exists('convert_queue');
    if (convertQueueExists) {
      keysToClear.push('convert_queue');
    }

    const indexQueueExists = await redis.exists('index_queue');
    if (indexQueueExists) {
      keysToClear.push('index_queue');
    }

    if (keysToClear.length === 0) {
      return res.json({ success: true, message: 'No queues found to clear', deletedCount: 0 });
    }

    const deletedCount = await redis.del(...keysToClear);
    res.json({ success: true, message: 'Successfully cleared queues', deletedCount });
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/queues/add', async (req: Request, res: Response) => {
  try {
    const { site, url, priority = 'medium' } = req.body as AddQueueRequest;
    if (!site || !url) {
      return res.status(400).json({ error: 'Site and URL are required' });
    }
    
    const allSites = getAllSites();
    const siteDesc = allSites.find(s => s.key === site);
    if (!siteDesc || !siteDesc.scraper) {
      return res.status(400).json({ error: `Unsupported or non-scraped site: ${site}` });
    }
    
    const queueName = `sites:${site}:scrape:${priority}`;
    const payload = JSON.stringify({
      site,
      url,
      attempt: 1,
      priority
    });
    
    await redis.rpush(queueName, payload);
    
    if (siteDesc.scraper.urlsCollectionName) {
      const urlsColl = await mongo.getCollection(siteDesc.scraper.urlsCollectionName as `${'bronze' | 'silver'}/${string}`);
      const id = siteDesc.scraper.extractId(url);
      if (id) {
        await urlsColl.updateOne(
          { id },
          {
            $set: {
              id,
              url,
              status: 'new',
              pushedToRedis: true,
              updatedAt: new Date()
            }
          },
          { upsert: true }
        );
      }
    }
    
    res.json({ success: true, queue: queueName, url });
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    res.status(500).json({ error: err.message });
  }
});

// --- DOCKER SOCKET LOGS GREP ERRORS IMPLEMENTATION ---
interface DockerContainer {
  Id: string;
  Names: string[];
  Labels: Record<string, string>;
  State: string;
}

interface ParsedError {
  service: string;
  timestamp: string;
  level: string;
  message: string;
  site: string;
  url: string;
  stack?: string;
  index?: number;
}

function requestDockerSocket(path: string, method: string = 'GET'): Promise<any> {
  return new Promise((resolve, reject) => {
    const options = {
      socketPath: '/var/run/docker.sock',
      path,
      method,
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.headers['content-type']?.includes('application/json')) {
            resolve(JSON.parse(data));
          } else {
            resolve(data);
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function getDockerLogsBinary(containerId: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const options = {
      socketPath: '/var/run/docker.sock',
      path: `/containers/${containerId}/logs?stdout=true&stderr=true&tail=5000`,
      method: 'GET',
    };
    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => { chunks.push(chunk as Buffer); });
      res.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function demuxDockerLogs(buffer: Buffer): string {
  let offset = 0;
  let output = '';
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) break;
    const size = buffer.readUInt32BE(offset + 4);
    offset += 8;
    if (offset + size > buffer.length) break;
    output += buffer.toString('utf8', offset, offset + size);
    offset += size;
  }
  if (output.length === 0 && buffer.length > 0) {
    return buffer.toString('utf8');
  }
  return output;
}

function ansiToHtml(text: string): string {
  // HTML Escape (prevent XSS)
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Replace ANSI escape codes with CSS styled span tags
  html = html
    .replace(/\x1B\[1m/g, '<strong>')
    .replace(/\x1B\[2m/g, '<span style="opacity: 0.65;">')
    .replace(/\x1B\[3m/g, '<em>')
    .replace(/\x1B\[4m/g, '<span style="text-decoration: underline;">')
    .replace(/\x1B\[30m/g, '<span style="color: #4b5563;">') // Black/Gray
    .replace(/\x1B\[31m/g, '<span style="color: #f87171; font-weight: bold;">') // Red
    .replace(/\x1B\[32m/g, '<span style="color: #4ade80;">') // Green
    .replace(/\x1B\[33m/g, '<span style="color: #fbbf24;">') // Yellow
    .replace(/\x1B\[34m/g, '<span style="color: #60a5fa;">') // Blue
    .replace(/\x1B\[35m/g, '<span style="color: #c084fc;">') // Magenta
    .replace(/\x1B\[36m/g, '<span style="color: #22d3ee;">') // Cyan
    .replace(/\x1B\[37m/g, '<span style="color: #f3f4f6;">') // White
    .replace(/\x1B\[90m/g, '<span style="color: #6b7280; opacity: 0.8;">') // Bright Black / Gray
    .replace(/\x1B\[0m/g, '</span></strong></span></em>'); // Reset

  return html;
}

function parseErrorsFromLogText(service: string, logText: string): ParsedError[] {
  const lines = logText.split(/\r?\n/);
  const errors: ParsedError[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    const isJson = trimmed.startsWith('{') && trimmed.endsWith('}');
    
    if (isJson) {
      try {
        const parsed = JSON.parse(trimmed);
        const timestamp = parsed.timestamp || parsed.time || new Date().toISOString();
        const message = parsed.message || parsed.msg || 'No message';
        const rawLevel = parsed.level || 'INFO';
        const level = rawLevel.toUpperCase();
        
        // Only include INFO, WARN, ERROR
        if (level !== 'INFO' && level !== 'WARN' && level !== 'ERROR') {
          continue;
        }

        const site = parsed.site || 'Unknown';
        const url = parsed.url || '';
        const stack = parsed.error_stack || parsed.stack || '';
        
        errors.push({
          service,
          timestamp,
          level,
          message: ansiToHtml(parsed.error_name ? `${parsed.error_name}: ${message}` : message),
          site,
          url,
          stack: stack ? ansiToHtml(stack) : undefined,
          index: i
        });
      } catch {
        errors.push({
          service,
          timestamp: new Date().toISOString(),
          level: 'INFO',
          message: ansiToHtml(trimmed),
          site: 'Unknown',
          url: '',
          index: i
        });
      }
    } else {
      // Exclude stack trace lines starting with "at " or spaces followed by "at "
      if (/^\s*at /i.test(trimmed)) {
        continue;
      }

      let level = 'INFO';
      if (/\berror\b|stderr|exception|TSError/i.test(trimmed)) {
        level = 'ERROR';
      } else if (/\bwarn\b/i.test(trimmed)) {
        level = 'WARN';
      }
      
      // Try to parse site from message brackets [site]
      let site = 'Unknown';
      const match = trimmed.match(/\[([a-zA-Z0-9_-]+)\]/);
      if (match) {
        const val = match[1];
        const exclude = ['scraper', 'converter', 'error', 'warn', 'info', 'debug', 'recursive'];
        if (!exclude.includes(val.toLowerCase())) {
          site = val;
        }
      }
      
      errors.push({
        service,
        timestamp: new Date().toISOString(),
        level,
        message: ansiToHtml(trimmed),
        site,
        url: '',
        index: i
      });
    }
  }
  return errors;
}

app.get('/api/errors', async (req: Request, res: Response) => {
  try {
    const siteFilter = (req.query.site as string) || 'All';
    const levelFilter = (req.query.level as string) || 'All';
    const serviceFilter = (req.query.service as string) || 'All';
    const searchFilter = (req.query.search as string) || '';
    const page = parseInt(req.query.page as string) || 1;
    const limit = 30;
    
    const containers: DockerContainer[] = await requestDockerSocket('/containers/json?all=true');
    
    const targetContainers = containers.filter(c => {
      const service = c.Labels?.['com.docker.compose.service'] || '';
      return service !== '';
    });
    
    let allErrors: ParsedError[] = [];
    
    for (const container of targetContainers) {
      const serviceName = container.Labels?.['com.docker.compose.service'] || 'unknown';
      try {
        const logBuffer = await getDockerLogsBinary(container.Id);
        const logText = demuxDockerLogs(logBuffer);
        const parsed = parseErrorsFromLogText(serviceName, logText);
        allErrors = allErrors.concat(parsed);
      } catch (err) {
        console.error(`Failed to fetch logs for container ${container.Id}:`, err);
      }
    }
    
    // Sort by timestamp descending. Tie-breaker is index descending (latest line index first).
    allErrors.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime() || 0;
      const timeB = new Date(b.timestamp).getTime() || 0;
      if (timeA !== timeB) {
        return timeB - timeA;
      }
      return (b.index || 0) - (a.index || 0);
    });
    
    let filteredErrors = allErrors;
    if (levelFilter !== 'All') {
      filteredErrors = filteredErrors.filter(err => err.level === levelFilter);
    }

    if (searchFilter) {
      const searchLower = searchFilter.toLowerCase();
      filteredErrors = filteredErrors.filter(err => 
        err.message.toLowerCase().includes(searchLower) ||
        (err.site && err.site.toLowerCase().includes(searchLower)) ||
        (err.service && err.service.toLowerCase().includes(searchLower))
      );
    }

    const siteCounts: Record<string, number> = {};
    const serviceCounts: Record<string, number> = {};
    for (const err of filteredErrors) {
      const site = err.site || 'Unknown';
      siteCounts[site] = (siteCounts[site] || 0) + 1;
      
      const svc = err.service || 'unknown';
      serviceCounts[svc] = (serviceCounts[svc] || 0) + 1;
    }

    if (serviceFilter !== 'All') {
      filteredErrors = filteredErrors.filter(err => err.service === serviceFilter);
    }

    if (siteFilter !== 'All') {
      filteredErrors = filteredErrors.filter(err => err.site === siteFilter);
    }
    
    const totalCount = filteredErrors.length;
    const startIndex = (page - 1) * limit;
    const paginatedErrors = filteredErrors.slice(startIndex, startIndex + limit);
    
    res.json({
      errors: paginatedErrors,
      totalCount,
      siteCounts,
      serviceCounts,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit) || 1
    });
  } catch (error: any) {
    console.error('[API Error Logs Fetch Error]', error);
    res.status(500).json({ error: error.message || 'Failed to fetch error logs from docker' });
  }
});

// Connect to MongoDB and start the server
async function start() {
  try {
    await mongo.connect();
    await mongo.initIndexes();
    app.listen(PORT, () => {
      console.log(`🚀 [Server] Hybrid HTTP & MCP Server running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
