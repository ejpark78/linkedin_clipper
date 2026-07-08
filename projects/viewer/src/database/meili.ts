/**
 * @file meili.ts
 * @description Meilisearch database adapter implementing the Singleton pattern for projects/viewer.
 * Uses native fetch API to interface with the Meilisearch HTTP REST API.
 */

import { AppConfig } from '../config/AppConfig';

export interface MeiliIndexSettings {
    searchableAttributes?: string[];
    filterableAttributes?: string[];
    sortableAttributes?: string[];
    rankingRules?: string[];
}

export class MeiliSearchDatabase {
    private static instance: MeiliSearchDatabase;
    private readonly host: string;
    private readonly apiKey: string;

    private constructor() {
        this.host = AppConfig.MEILI_URL.replace(/\/$/, '');
        this.apiKey = AppConfig.MEILI_MASTER_KEY;
    }

    public static getInstance(): MeiliSearchDatabase {
        if (!MeiliSearchDatabase.instance) {
            MeiliSearchDatabase.instance = new MeiliSearchDatabase();
        }
        return MeiliSearchDatabase.instance;
    }

    /**
     * Send HTTP request to Meilisearch API
     */
    private async request<T = any>(path: string, method: string = 'GET', body?: any): Promise<T> {
        const url = `${this.host}${path}`;
        const headers: Record<string, string> = {
            'Authorization': `Bearer ${this.apiKey}`,
        };

        if (body) {
            headers['Content-Type'] = 'application/json';
        }

        try {
            const response = await fetch(url, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined,
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Meilisearch API error (${response.status}): ${text}`);
            }

            if (response.status === 204) {
                return {} as T;
            }

            return await response.json() as T;
        } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error(`❌ [Meilisearch] Request error (${method} ${path}): ${errMsg}`);
            throw err;
        }
    }

    /**
     * Check if Meilisearch is reachable and healthy
     */
    public async isHealthy(): Promise<boolean> {
        try {
            const res = await this.request<{ status: string }>('/health');
            return res.status === 'available' || res.status === 'ok';
        } catch {
            return false;
        }
    }

    /**
     * Ensure index exists, creating it with primaryKey: 'id' if missing.
     */
    public async ensureIndex(indexName: string): Promise<void> {
        try {
            await this.request(`/indexes/${indexName}`, 'GET');
        } catch (e) {
            await this.request('/indexes', 'POST', { uid: indexName, primaryKey: 'id' });
        }
    }

    /**
     * Add or replace documents in an index
     */
    public async addDocuments(indexName: string, documents: any[]): Promise<void> {
        if (documents.length === 0) return;
        const cleanedDocs = documents.map(doc => {
            const safeId = String(doc.id || doc._id || '').replace(/[^a-zA-Z0-9-_]/g, '_');
            return {
                ...doc,
                id: safeId,
            };
        });

        await this.ensureIndex(indexName);
        await this.request(`/indexes/${indexName}/documents`, 'POST', cleanedDocs);
    }

    /**
     * Delete a single document from an index
     */
    public async deleteDocument(indexName: string, documentId: string): Promise<void> {
        const safeId = documentId.replace(/[^a-zA-Z0-9-_]/g, '_');
        await this.request(`/indexes/${indexName}/documents/${safeId}`, 'DELETE');
    }

    /**
     * Search documents in an index
     */
    public async search<T = any>(indexName: string, query: string, options: any = {}): Promise<{
        hits: T[];
        offset: number;
        limit: number;
        estimatedTotalHits: number;
        processingTimeMs: number;
        query: string;
    }> {
        return this.request(`/indexes/${indexName}/search`, 'POST', {
            q: query,
            ...options,
        });
    }

    /**
     * Setup index settings (Searchable, Filterable, Sortable)
     */
    public async updateSettings(indexName: string, settings: MeiliIndexSettings): Promise<void> {
        await this.ensureIndex(indexName);
        await this.request(`/indexes/${indexName}/settings`, 'PATCH', settings);
    }

    /**
     * Get index stats (including number of documents)
     */
    public async getStats(indexName: string): Promise<{
        numberOfDocuments: number;
        isIndexing: boolean;
        fieldDistribution: Record<string, number>;
    }> {
        return this.request(`/indexes/${indexName}/stats`, 'GET');
    }
}
