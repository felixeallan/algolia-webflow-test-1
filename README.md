# Algolia × Webflow Filter Library

A drop-in filtering solution for Webflow using Algolia. No 100-item limit, full-text search, faceted filtering, and pagination — all driven by `data-*` attributes.

## How it works

```
Webflow CMS → (sync app) → Algolia Index → (client library) → Webflow page
```

1. **Sync app** — a Next.js app deployed to Webflow Cloud. Syncs your Webflow CMS to Algolia via webhook on every publish.
2. **Client library** — a `<script>` tag added to your Webflow project. Reads Algolia credentials from HTML attributes, queries Algolia, and renders results.

---

## Setup

### 1. Deploy the sync app to Webflow Cloud

1. Fork this repository
2. In your Webflow site settings → Webflow Cloud, connect your forked repo
3. Set the following environment variables in Webflow Cloud:

```bash
WEBFLOW_API_TOKEN=        # Webflow API token (keep secret)
WEBFLOW_COLLECTION_ID=    # The CMS collection ID to sync
ALGOLIA_APP_ID=           # Algolia Application ID
ALGOLIA_ADMIN_API_KEY=    # Algolia Admin API key (keep secret)
ALGOLIA_INDEX_NAME=       # Name of the Algolia index (e.g. "products")
SYNC_SECRET=              # A secret string to protect the /api/sync endpoint
```

4. In Webflow site settings → Integrations → Webhooks, add a webhook pointing to:
   `https://yoursite.com/api/webhook`
   for the events: **Collection item published**, **Collection item unpublished**, **Collection item deleted**

5. Run the initial full sync by calling:
   ```
   POST https://yoursite.com/api/sync
   Authorization: Bearer YOUR_SYNC_SECRET
   ```

### 2. Add the client library to Webflow

Add this script tag to your Webflow project (Site Settings → Custom Code → Footer):

```html
<script src="https://cdn.jsdelivr.net/gh/YOUR_USERNAME/algolia-webflow@latest/packages/library/dist/algolia-webflow.min.js"></script>
```

### 3. Configure your Webflow page with data attributes

```html
<div
  data-algolia
  data-app-id="YOUR_ALGOLIA_APP_ID"
  data-api-key="YOUR_SEARCH_ONLY_API_KEY"
  data-index="products"
  data-hits-per-page="12"
>

  <!-- Search input -->
  <input data-algolia-search type="text" placeholder="Search...">

  <!-- Filters (clicking toggles them on/off) -->
  <div data-algolia-filter="category" data-algolia-value="shoes">Shoes</div>
  <div data-algolia-filter="category" data-algolia-value="bags">Bags</div>
  <div data-algolia-filter="brand" data-algolia-value="nike">Nike</div>

  <!-- Sort -->
  <select data-algolia-sort>
    <option value="products">Relevance</option>
    <option value="products_price_asc">Price: Low to High</option>
    <option value="products_price_desc">Price: High to Low</option>
  </select>

  <!-- Results list — starts empty, filled by the script -->
  <div data-algolia-list>
    <!-- Define how one result looks -->
    <template data-algolia-template>
      <div class="product-card">
        <img data-algolia-bind="image" data-algolia-attr="src" alt="">
        <h3 data-algolia-bind="name"></h3>
        <p data-algolia-bind="price"></p>
        <a data-algolia-bind="slug" data-algolia-attr="href">View</a>
      </div>
    </template>
  </div>

  <!-- Result count -->
  <p>Showing <span data-algolia-count></span> results</p>

  <!-- Empty state -->
  <div data-algolia-empty style="display:none">No results found.</div>

  <!-- Pagination -->
  <div data-algolia-pagination>
    <button data-algolia-prev>← Previous</button>
    <span data-algolia-page-info></span>
    <button data-algolia-next>Next →</button>
  </div>

</div>
```

---

## Data attribute reference

| Attribute | Element | Description |
|---|---|---|
| `data-algolia` | wrapper div | Marks the root. Also holds `data-app-id`, `data-api-key`, `data-index`, `data-hits-per-page` |
| `data-algolia-search` | `<input>` | Text search input |
| `data-algolia-filter="attr"` + `data-algolia-value="val"` | any | Clickable filter. Same attribute = OR logic. Different attributes = AND logic |
| `data-algolia-sort` | `<select>` | Sort by index replica |
| `data-algolia-list` | container | Where results are injected |
| `data-algolia-template` | `<template>` | Blueprint for one result item (inside `data-algolia-list`) |
| `data-algolia-bind="field"` | any (inside template) | Sets element text content from the hit field |
| `data-algolia-bind="field"` + `data-algolia-attr="src"` | `<img>`, `<a>` | Sets an attribute instead of text content |
| `data-algolia-count` | any | Displays total number of results |
| `data-algolia-empty` | any | Shown when there are no results |
| `data-algolia-prev` | `<button>` | Go to previous page |
| `data-algolia-next` | `<button>` | Go to next page |
| `data-algolia-page-info` | any | Displays "Page X of Y" |

---

## Project structure

```
algolia-webflow/
├── apps/
│   └── sync/          # Next.js app → deploy to Webflow Cloud
│       ├── src/app/api/sync/route.ts      # Full sync endpoint
│       └── src/app/api/webhook/route.ts   # Incremental sync via webhook
└── packages/
    └── library/       # Client-side filter library
        ├── src/index.ts
        └── dist/algolia-webflow.min.js    # Built output (CDN-ready)
```
