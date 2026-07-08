/**
 * @file App.vue
 * @description Root Vue layout containing the Sidebar and router viewport.
 * @constraints
 *   - Serves as the main layout shell.
 *   - Sidebar options route dynamically using vue-router.
 */

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';

interface Collection {
  id: string;
  name: string;
  favicon?: string;
}

const router = useRouter();
const route = useRoute();

const collections = ref<Collection[]>([]);
const sidebarCollapsed = ref<boolean>(false);

onMounted(() => {
  fetchCollections();
});

async function fetchCollections() {
  try {
    const response = await fetch('/api/collections');
    collections.value = await response.json();
  } catch (error) {
    console.error('Error loading collections:', error);
  }
}

function selectCollection(id: string) {
  router.push({ name: 'Collection', params: { id } });
}

function selectDashboard() {
  router.push({ name: 'Dashboard' });
}


</script>

<template>
  <div class="app-container" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
    <!-- Left Sidebar: Operations & Collections -->
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-icon">🛸</span>
        <h2>Antigravity</h2>
        <button @click="sidebarCollapsed = true" class="sidebar-toggle" title="Collapse Sidebar">◀</button>
      </div>

      <div class="section-title" style="margin-top:10px;">Operations</div>
      <ul class="collection-list" style="flex:none;">
        <li 
          class="collection-item"
          :class="{ active: route.name === 'Dashboard' }"
          @click="selectDashboard"
        >
          <span style="vertical-align:middle;margin-right:8px;font-size:16px;">📊</span>
          <span style="vertical-align:middle;">Dashboard</span>
        </li>

      </ul>

      <div class="section-title" style="margin-top:20px;">Collections</div>
      <ul class="collection-list">
        <li v-if="collections.length === 0" class="loading-text">Loading collections...</li>
        <li 
          v-for="col in collections" 
          :key="col.id" 
          class="collection-item"
          :class="{ active: route.params.id === col.id }"
          @click="selectCollection(col.id)"
        >
          <img v-if="col.favicon" :src="col.favicon" class="collection-favicon" alt="" style="width:16px;height:16px;margin-right:8px;vertical-align:middle;border-radius:3px;display:inline-block;" />
          <span style="vertical-align:middle;">{{ col.name }}</span>
        </li>
      </ul>

      <div class="sidebar-footer">
        <span class="mcp-status">
          <span class="status-dot green"></span>
          MCP Server Ready
        </span>
      </div>
    </aside>

    <!-- Main Router Dynamic View Area -->
    <main class="main-content-viewport" style="flex: 1; display: flex; overflow: hidden; background: #0c0f16;">
      <router-view 
        :sidebarCollapsed="sidebarCollapsed" 
        @toggle-sidebar="sidebarCollapsed = !sidebarCollapsed" 
      />
    </main>
  </div>
</template>

<style>
/* Global CSS variables & UI styles mapped directly from original App.vue */
:root {
  --background-dark: #0c0f16;
  --panel-dark: #121824;
  --border-color: #1f293d;
  --accent-color: #6366f1;
  --accent-hover: #4f46e5;
  --text-primary: #e2e8f0;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
}

body {
  margin: 0;
  background-color: var(--background-dark);
  color: var(--text-primary);
  font-family: 'Outfit', 'Inter', system-ui, sans-serif;
  overflow: hidden;
}

.app-container {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background-color: var(--background-dark);
}

.sidebar {
  width: 260px;
  background-color: var(--panel-dark);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  padding: 16px;
  box-sizing: border-box;
  flex-shrink: 0;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.sidebar-collapsed .sidebar {
  width: 0;
  padding: 0;
  overflow: hidden;
  border-right: none;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}

.brand h2 {
  font-size: 18px;
  font-weight: 800;
  background: linear-gradient(135deg, #a78bfa, #6366f1);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin: 0;
}

.sidebar-toggle {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}

.sidebar-toggle:hover {
  background: rgba(255,255,255,0.05);
  color: #fff;
}

.section-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--text-muted);
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}

.collection-list {
  list-style: none;
  padding: 0;
  margin: 0 0 20px 0;
  overflow-y: auto;
  flex: 1;
}

.collection-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 4px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  transition: all 0.2s ease;
}

.collection-item:hover {
  background: rgba(99, 102, 241, 0.08);
  color: #fff;
}

.collection-item.active {
  background: var(--accent-color);
  color: #fff;
  font-weight: 600;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.25);
}

.sidebar-footer {
  margin-top: auto;
  border-top: 1px solid var(--border-color);
  padding-top: 12px;
  font-size: 12px;
}

.mcp-status {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-dot.green {
  background: #10b981;
  box-shadow: 0 0 8px #10b981;
}

.sidebar-expand {
  background: var(--panel-dark);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sidebar-expand:hover {
  background: var(--border-color);
}

/* Original structural CSS elements that styling relies on */
.list-panel {
  width: 320px;
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  background-color: #0d121c;
  flex-shrink: 0;
}

.search-header {
  padding: 16px;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  gap: 12px;
}

.search-box {
  position: relative;
  flex: 1;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  font-size: 14px;
}

.search-box input {
  width: 100%;
  background: #121824;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 10px 12px 10px 38px;
  box-sizing: border-box;
  color: #fff;
  font-size: 13px;
}

.search-box input:focus {
  border-color: var(--accent-color);
  outline: none;
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.15);
}

.list-container {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.document-list {
  flex: 1;
  overflow-y: auto;
}

.doc-card {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-color);
  cursor: pointer;
  transition: all 0.2s ease;
}

.doc-card:hover {
  background: rgba(255,255,255,0.02);
}

.doc-card.active {
  background: rgba(99, 102, 241, 0.05);
  border-left: 3px solid var(--accent-color);
}

.doc-card h4 {
  margin: 0 0 6px 0;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  color: #e2e8f0;
}

.doc-card-meta {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-muted);
}

.doc-tag {
  background: #1e293b;
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--text-secondary);
}

.pagination {
  padding: 12px;
  border-top: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #0d121c;
}

.page-btn {
  background: #121824;
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}

.page-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.detail-panel {
  display: flex;
  flex-direction: column;
  background-color: var(--background-dark);
}

.detail-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}

.empty-art {
  font-size: 48px;
  margin-bottom: 16px;
}

.detail-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.detail-header {
  padding: 24px;
  border-bottom: 1px solid var(--border-color);
}

.detail-header h2 {
  margin: 0 0 8px 0;
  font-size: 20px;
  font-weight: 700;
}

.doc-meta-info {
  display: flex;
  gap: 12px;
}

.meta-tag {
  font-size: 11px;
  color: var(--text-secondary);
  background: rgba(255,255,255,0.05);
  padding: 4px 8px;
  border-radius: 4px;
}

.tabs-nav {
  display: flex;
  border-bottom: 1px solid var(--border-color);
  background: #0f131a;
  padding: 0 16px;
}

.tab-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  padding: 14px 16px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  position: relative;
}

.tab-btn.active {
  color: #fff;
}

.tab-btn.active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background-color: var(--accent-color);
}

.tab-panes {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.tab-pane {
  display: none;
}

.tab-pane.active {
  display: block;
}

.html-preview {
  width: 100%;
  height: 600px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: white;
}

.dashboard-container {
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100%;
  overflow-y: auto;
  background: #0a0d14;
}

.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-color);
  background: var(--panel-dark);
}

.dashboard-title-area {
  display: flex;
  align-items: center;
  gap: 12px;
}

.dashboard-content {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  flex: 1;
  overflow-y: auto;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 20px;
}

.metric-card {
  background: var(--panel-dark);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.metric-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.metric-value {
  font-size: 24px;
  font-weight: 700;
  color: #fff;
}

.metric-sub {
  font-size: 11px;
  color: var(--text-muted);
}

.queue-section-card {
  background: var(--panel-dark);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  overflow: hidden;
  flex-shrink: 0; /* Prevent visual squeezing in flex containers */
}

.card-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: #fff;
}

.card-body {
  padding: 20px;
}

.dashboard-table {
  width: 100%;
  border-collapse: collapse;
}

.dashboard-table th,
.dashboard-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color);
}

.dashboard-table th {
  text-align: left;
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 700;
}

.dashboard-table tr:last-child td {
  border-bottom: none;
}

.btn-secondary {
  background: #1e293b;
  border: 1px solid var(--border-color);
  color: #fff;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  height: 36px;
  transition: all 0.2s;
}

.btn-secondary:hover {
  background: #334155;
}

.btn-danger {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #ef4444;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  height: 36px;
  transition: all 0.2s;
}

.btn-danger:hover {
  background: rgba(239, 68, 68, 0.2);
}

.btn-primary {
  background: var(--accent-color);
  border: none;
  color: #fff;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  height: 36px;
  transition: all 0.2s;
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.form-select,
.form-input-text {
  background: #181c25;
  border: 1px solid var(--border-color);
  color: #fff;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  height: 38px;
  box-sizing: border-box;
}

.form-select:focus,
.form-input-text:focus {
  border-color: var(--accent-color);
  outline: none;
}

.add-url-panel {
  background: var(--panel-dark);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.add-url-form {
  display: flex;
  gap: 12px;
}

.add-url-form .form-input-text {
  flex: 1;
}

/* Spinner and Loadings */
.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(99, 102, 241, 0.1);
  border-top: 2px solid var(--accent-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  display: inline-block;
  margin-right: 8px;
  vertical-align: middle;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.loading-container {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  padding: 40px;
  color: var(--text-secondary);
}

.empty-state {
  text-align: center;
  padding: 40px;
  color: var(--text-muted);
}

.badge-priority {
  border-radius: 4px;
  font-weight: 600;
  display: inline-block;
}

.badge-priority.high {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.badge-priority.medium {
  background: rgba(245, 158, 11, 0.15);
  color: #fbbf24;
  border: 1px solid rgba(245, 158, 11, 0.2);
}

.badge-priority.low {
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.country-filters {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
  overflow-x: auto;
  white-space: nowrap;
}

.country-badge {
  background: #121824;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
}

.country-badge:hover {
  background: rgba(255,255,255,0.05);
  color: #fff;
}

.country-badge.active {
  background: var(--accent-color);
  color: #fff;
  border-color: var(--accent-color);
}
</style>
