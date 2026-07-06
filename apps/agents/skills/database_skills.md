# Skill: DB Index & Schema Diagnostics

This document defines the skills and CLI instructions for diagnosing MongoDB index mismatches and schema consistency across collections.

---

## 1. 🔄 MongoDB Index Synchronization & Verification

If the collection indexes in MongoDB mismatch the descriptors declared in `site.config.ts`, query performance drops and full-text search errors may occur.

### 1.1 Executing the Sync Script
Run the following command to synchronize indexes and output a status report:
```bash
docker compose -p scraper run --rm \
  -v $(pwd):/app -v /app/node_modules \
  worker npx ts-node src/scripts/sync-indexes.ts
```
*(References: [sync-indexes.ts](src/scripts/sync-indexes.ts) CLI runner)*

### 1.2 Key Audit Items
- Verify that a unique index (`{ id: 1 }`, unique) exists on `bronze.html`, `bronze.urls`, and `silver.contents` collections.
- Ensure that a full-text search `text` index (on `title`, `markdown` fields) is applied to the `silver.contents` collection.

---

## 2. 📊 Database Collection Field Schema Analysis

You can cross-verify whether fields are correctly mapped for different crawlers that retrieve data in various formats.

### 2.1 Printing the Schema Mapping Report
```bash
docker compose -p scraper run --rm \
  -v $(pwd):/app -v /app/node_modules \
  worker npx ts-node src/scripts/show_collection_columns.ts
```
*(References: [show_collection_columns.ts](src/scripts/show_collection_columns.ts) database schema mapper)*

- Upon completion, this script prints a Markdown matrix mapping all collection fields horizontally (by site) and vertically (by field name) for both `bronze` and `silver` databases.

---

## 3. 🖥️ Diagnostic mongosh Snippets

Use these one-line commands to quickly check database status from outside the containers without forwarding DB ports.

- **Check document counts for a site's html and urls collections**:
  ```bash
  docker compose -p scraper exec -T mongodb mongosh bronze --eval "print('html count:', db['uppity.html'].countDocuments(), 'urls count:', db['uppity.urls'].countDocuments())"
  ```
- **Inspect metadata for one failed record**:
  ```bash
  docker compose -p scraper exec -T mongodb mongosh bronze --eval "db['uppity.urls'].findOne({status: 'failed'}, {rawHtml: 0})"
  ```
- **Find a document by a specific MD5 ID**:
  ```bash
  docker compose -p scraper exec -T mongodb mongosh bronze --eval "db['uppity.urls'].findOne({id: '887e626b6b08089a95df068adbd103d5'})"
  ```
