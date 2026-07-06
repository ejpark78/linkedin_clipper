---
trigger: always_on
---

# 🚨 DB Diagnostic & Safety Rules

This document defines the rules for the agent to safely and effectively diagnose databases (MongoDB, Redis, etc.) in both local and container environments.

---

## 1. 🔌 DB Connection & Shell Execution Constraints

1. **No Direct Host Port Access**:
   - Infrastructure service ports (MongoDB, Redis, Meilisearch, etc.) must not be directly exposed to the host machine.
   - All database access and CLI queries must be executed within the Docker network context.
   * **Allowed Example**: `docker compose -p scraper exec -T mongodb mongosh ...`
   * **Prohibited Example**: Attempting to connect directly from the host terminal using `mongosh mongodb://localhost:27017`

2. **Connection Leak Prevention**:
   - When establishing DB connections in Node.js scripts or external modules, always close the connection (e.g., `MongoDatabase.close()` in [mongo.ts](src/database/mongo.ts), `redis.quit()`) inside a `finally` block to prevent the session from hanging.

---

## 2. 📊 MongoDB Query & Output Constraints (LLM Context Protection)

1. **Exclude Large Fields in Projections**:
   - When querying documents from `bronze.*.html` collections, fields containing large amounts of text (e.g., `rawHtml`, `htmlContent`) waste terminal output space and LLM context window tokens.
   - When verifying metadata or identifier (ID) consistency, **always exclude large fields** from the query projection.
   * **Recommended Query**:
     ```bash
     docker compose -p scraper exec -T mongodb mongosh bronze --eval "db['uppity.html'].findOne({}, {rawHtml: 0})"
     ```

2. **No Large Record Dumps**:
   - Do not dump entire collections or large arrays of documents for debugging purposes.
   - To verify document storage status or distribution of states, use `countDocuments` or `aggregate` to output statistical summaries only.
   * **Recommended Query**:
     ```bash
     docker compose -p scraper exec -T mongodb mongosh bronze --eval "db['uppity.urls'].countDocuments({status: 'failed'})"
     ```
