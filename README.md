# Algolia × Webflow Filter Library

A drop-in filtering solution for Webflow using Algolia. No 100-item CMS limit, full-text search, faceted filtering, pagination, URL state sync — all driven by HTML `data-*` attributes.

## How it works

```
Webflow CMS
    ↓  full sync (Next.js on Webflow Cloud)
Algolia Index
    ↓  search-only API (client library)
Webflow page (rendered with filters)
```

Three parts:
1. **Sync app** (`apps/sync`) — Next.js on Webflow Cloud. Reads all CMS items via the Webflow API, resolves references and option fields to human-readable values, and pushes everything to Algolia.
2. **Webhook worker** (`apps/webhook-worker`) — A Cloudflare Worker that listens for Webflow webhooks and keeps Algolia in sync incrementally (per-item changes) and triggers a full sync on site publish.
3. **Client library** (`packages/library`) — A vanilla JS bundle loaded via a single `<script>` tag in Webflow. Reads HTML attributes, queries Algolia, renders results, handles filters/search/pagination/tags.

---

## Prerequisites

- A Webflow site with a CMS collection you want to filter
- A free [Algolia](https://www.algolia.com) account
- A free [Cloudflare](https://dash.cloudflare.com) account (for the webhook worker)
- A [GitHub](https://github.com) account

---

# Setup

## Step 1 — Create your project from the template

1. Go to [github.com/felixeallan/algolia-webflow-filter](https://github.com/felixeallan/algolia-webflow-filter)
2. Click **"Use this template"** → **"Create a new repository"**
3. Name it (e.g. `my-site-algolia`) and make it **public** (required so jsDelivr can serve the script)
4. Done — you have your own copy.

## Step 2 — Create the Algolia index

1. Sign up at [algolia.com](https://www.algolia.com) and create an application
2. Decide a name for your index (e.g. `products`, `blog-posts`, `cars`) — Algolia will create it automatically when the first sync runs, you do not need to create it manually
3. Go to **Settings → API Keys** and copy these three values:
   - **Application ID** → `ALGOLIA_APP_ID`
   - **Search API Key** → used later in the script tag (safe to expose)
   - **Write API Key** → `ALGOLIA_ADMIN_API_KEY` (keep secret, only used server-side)

## Step 3 — Get the Webflow API credentials

### API token

1. Webflow → **Site Settings → Apps & Integrations → API Access → Generate API Token**
2. Permissions: **CMS: Read** (read-only is enough — the sync never writes back)
3. Copy the token → `WEBFLOW_API_TOKEN`

### Collection ID

In Webflow → CMS → click your collection → **Settings** → copy the Collection ID → `WEBFLOW_COLLECTION_ID`.

## Step 4 — Deploy the sync app to Webflow Cloud

1. In your Webflow site → **Site Settings → Webflow Cloud**
2. Click **"Install GitHub app"** if needed, then **"New app"**
3. Configure:
   - **Name**: anything (e.g. `algolia-sync`)
   - **Repository**: your project repo from Step 1
   - **Directory path**: `apps/sync`
   - **GitHub branch**: `main`
   - **Path**: `/api` (this becomes the URL prefix, e.g. `yoursite.com/api/sync`)
4. Once the environment is created, go to **Environment Variables** and add all 6:
   ```
   WEBFLOW_API_TOKEN        (Secret)
   WEBFLOW_COLLECTION_ID    (Text)
   ALGOLIA_APP_ID           (Text)
   ALGOLIA_ADMIN_API_KEY    (Secret — this is the Write API Key)
   ALGOLIA_INDEX_NAME       (Text — the name you chose, e.g. "products")
   SYNC_SECRET              (Secret — generate with: openssl rand -hex 32)
   ```
5. Click **"Deploy latest commit"**. Wait for the deployment to go live.

The endpoint health check should return `{"ok":true}`:
```bash
curl https://YOUR_SITE.webflow.io/api/sync
```

## Step 5 — Run the initial full sync

```bash
curl -X POST https://YOUR_SITE.webflow.io/api/sync \
  -H "Authorization: Bearer YOUR_SYNC_SECRET"
```

Expected response:
```json
{ "success": true, "synced": 1234 }
```

Check the Algolia dashboard → your index → **Browse** — all your CMS items should be there.

## Step 6 — Create the webhook worker (Cloudflare)

The sync app handles the initial bulk sync. The webhook worker keeps Algolia in sync as users publish/edit/delete individual CMS items. Webflow does not allow webhooks pointing to `*.webflow.io` domains, so we need an external worker.

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Create Worker** → **Hello World**
2. Name it (e.g. `algolia-webflow-webhook`) → **Deploy**
3. Click **"Edit code"**, delete everything, and paste the contents of [apps/webhook-worker/src/index.js](apps/webhook-worker/src/index.js) → **Deploy**
4. Go to **Settings → Variables and Secrets** and add:
   ```
   ALGOLIA_APP_ID            (Text)
   ALGOLIA_ADMIN_API_KEY     (Secret — the Write API Key)
   ALGOLIA_INDEX_NAME        (Text)
   WEBFLOW_COLLECTION_ID     (Text — so webhooks from other collections get ignored)
   SYNC_ENDPOINT             (Text — https://YOUR_SITE.webflow.io/api/sync)
   SYNC_SECRET               (Secret — same as Webflow Cloud)
   ```
5. Note your worker URL — looks like `https://algolia-webflow-webhook.YOUR-USERNAME.workers.dev`

## Step 7 — Set up the Webflow webhooks

Webflow → **Site Settings → Apps & Integrations → Webhooks → Add Webhook** for each event below. URL is the worker URL from Step 6:

| Event | Purpose |
|---|---|
| `collection_item_created` | New items appear instantly in Algolia |
| `collection_item_changed` | Edits sync instantly |
| `collection_item_deleted` | Deletes remove from Algolia |
| `collection_item_unpublished` | Unpublished items removed from Algolia |
| `site_publish` | Triggers a full re-sync (for schema changes, new fields, reference updates) |

You do not need a webhook secret. Leave that field blank.

## Step 8 — Configure Algolia (Facets + Searchable Attributes)

In Algolia → your index → **Configuration**:

**Facets** — fields you want to filter by:
- Add every attribute that will be used as a filter (e.g. `category`, `brand`, `color`, `year`)
- Reference fields show up as the referenced item's name automatically (e.g. `car-brand: "Quasar"`)

**Searchable Attributes** — fields used by the search input:
- Set to **Ordered** mode
- Top of the list = higher relevance
- Add fields like `name`, `title`, `description`

Click **"Review and Save settings"**.

## Step 9 — Add the library to your Webflow page

In Webflow → **Site Settings → Custom Code → Footer**:

```html
<script src="https://cdn.jsdelivr.net/gh/felixeallan/algolia-webflow-filter@v0.1.9/packages/library/dist/algolia-webflow.min.js"></script>
```

**Always pin to a version tag** (e.g. `@v0.1.9`). Do not use `@main` — jsDelivr aggressively caches branch URLs.

## Step 10 — Build the filter UI

See the **HTML structure** and **Data attribute reference** below.

---

# HTML structure (full example)

```html
<div
  data-algolia
  data-app-id="YOUR_APP_ID"
  data-api-key="YOUR_SEARCH_ONLY_KEY"
  data-index="cars"
  data-hits-per-page="12"
  data-algolia-url-state
>

  <!-- Search input -->
  <input data-algolia-search type="text" placeholder="Search...">

  <!-- Filters: checkbox = multi-select (OR within group, AND between groups) -->
  <label data-algolia-filter="car-brand" data-algolia-value="Quasar">
    <input type="checkbox"><span>Quasar</span>
  </label>

  <!-- Filters: radio = single-select within the group -->
  <label data-algolia-filter="color-theme" data-algolia-value="White">
    <input type="radio" name="color"><span>White</span>
  </label>

  <!-- Dropdown filter -->
  <select data-algolia-filter-select="year">
    <option value="">All years</option>
    <option value="2024">2024</option>
    <option value="2023">2023</option>
  </select>

  <!-- Sort dropdown (uses Algolia index replicas) -->
  <select data-algolia-sort>
    <option value="">Relevance</option>
    <option value="cars_price_asc">Price ↑</option>
    <option value="cars_price_desc">Price ↓</option>
  </select>

  <!-- Clear buttons -->
  <button data-algolia-clear>Clear all</button>
  <button data-algolia-clear="car-brand">Clear brands</button>

  <!-- Active filter tags -->
  <div data-algolia-tags>
    <div data-algolia-tag-template class="tag">
      <span data-algolia-tag-label></span>
      <span data-algolia-tag-remove>×</span>
    </div>
  </div>

  <!-- Result list with template -->
  <div data-algolia-list>
    <div data-algolia-template class="card">
      <img data-algolia-bind="image.url" data-algolia-attr="src">
      <h3 data-algolia-bind="name"></h3>
      <p data-algolia-bind="car-brand"></p>
      <img data-algolia-bind="car-brand__logo.url" data-algolia-attr="src">
      <p data-algolia-bind="price"></p>
      <p data-algolia-bind="year"></p>

      <!-- Repeat for array/multi-reference fields -->
      <div data-algolia-hide-empty="authors" data-algolia-repeat="authors">
        <span data-algolia-repeat-item class="author-tag"></span>
      </div>

      <a data-algolia-bind="slug" data-algolia-attr="href">View</a>
    </div>
  </div>

  <!-- Stats -->
  <p><span data-algolia-count></span> results</p>

  <!-- Empty state -->
  <div data-algolia-empty style="display:none">No results found.</div>

  <!-- Pagination -->
  <button data-algolia-prev>← Previous</button>
  <span data-algolia-page-info></span>
  <button data-algolia-next>Next →</button>

</div>
```

---

# Data attribute reference

## Wrapper (required)

| Attribute | Element | Description |
|---|---|---|
| `data-algolia` | any (wrapper div) | Marks the root. Everything else must be inside. |
| `data-app-id="..."` | wrapper | Algolia Application ID |
| `data-api-key="..."` | wrapper | Algolia **Search-Only** API key (safe to expose) |
| `data-index="..."` | wrapper | Algolia index name |
| `data-hits-per-page="12"` | wrapper | Number of results per page (default 12) |
| `data-algolia-url-state` | wrapper | (optional) Sync filters/search/page to URL params for shareable links |

## Search

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-search` | `<input>` | Text search input |

## Filters

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-filter="attr"` + `data-algolia-value="val"` | any (`<label>` recommended) | Click to filter. Auto-detects native `<input type="checkbox">` (multi-select) or `<input type="radio">` (single-select) inside. Same `attr` = OR; different attrs = AND. |
| `data-algolia-filter-select="attr"` | `<select>` | Dropdown filter. Empty option (`value=""`) clears the filter. |

## Sort

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-sort` | `<select>` | Each option's `value` should be the name of an Algolia index replica (e.g. `cars_price_asc`). |

## Clear buttons

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-clear` | any | Clears ALL filters, search query, and sort |
| `data-algolia-clear="attr"` | any | Clears only the specified filter group |

## Result list

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-list` | container | Where result items get injected |
| `data-algolia-template` | `<div>` or `<template>` | Cloned once per result (inside the list container). A regular `<div>` is fine — it's hidden automatically. |
| `data-algolia-bind="field"` | any (inside template) | Sets the element's text content from the Algolia hit. Supports dot notation: `image.url`, `car-brand__logo.url`. |
| `data-algolia-bind="field"` + `data-algolia-attr="name"` | any (inside template) | Sets an attribute (`src`, `href`, `alt`, etc.) instead of text content. |
| `data-algolia-hide-empty="field"` | any (inside template) | Hides this element when the bound field is empty, null, or an empty array. |

## Repeat (multi-value fields)

For arrays / multi-reference fields where each value should render as a separate element:

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-repeat="field"` | container | Renders one child per array value |
| `data-algolia-repeat-item` | child (inside repeat container) | Template element cloned per array value. Its text content gets set to each value. |

## Stats & empty state

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-count` | any | Displays total number of matches (e.g. `1,786`) |
| `data-algolia-empty` | any | Shown only when there are no results |

## Pagination

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-prev` | any | Click → previous page. Auto-disabled on first page. |
| `data-algolia-next` | any | Click → next page. Auto-disabled on last page. |
| `data-algolia-page-info` | any | Displays "Page X of Y" |

## Active filter tags

Renders one element per active filter, with an X button to remove individual filters.

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-tags` | container | Where tags get injected |
| `data-algolia-tag-template` | child of tags container | Cloned once per active filter |
| `data-algolia-tag-label` | any (inside tag template) | Gets the filter value as text (e.g. "Quasar", "White") |
| `data-algolia-tag-remove` | any (inside tag template) | Clicking removes that filter. If missing, the whole tag is clickable. |

## Active filter styling

When a filter is selected, the library adds `data-active=""` to the label element. Style it in Webflow's custom CSS:

```css
[data-algolia-filter][data-active] { /* active state */ }
```

For Webflow's native checkbox/radio components, the library also toggles their built-in `w--redirected-checked` class, so visual styling works out of the box.

---

# Common patterns

## How CMS fields appear in Algolia

The Webflow API returns field **slugs** (lowercase, hyphenated), not display names:

| Webflow Designer (display name) | API slug (Algolia field) |
|---|---|
| Product Name | `name` |
| Car Make | `car-make` |
| Featured? | `featured` |

Use these slugs in `data-algolia-bind`, `data-algolia-filter`, etc.

## Reference fields (link to another collection)

The sync resolves **single Reference fields** to the referenced item's name automatically:

| Field type | What's stored in Algolia |
|---|---|
| Single reference | `"Quasar"` (the name of the referenced item) |
| Multi-reference | `["Charles Miller", "Emily Davis"]` |

It also stores **all sub-fields** of the referenced item as `field__subfield`. For example:

```html
<!-- Display the brand logo from the referenced "Car Brand" collection -->
<img data-algolia-bind="car-brand__logo.url" data-algolia-attr="src">
```

## Option fields (single/multi-select dropdowns)

Stored as the option's name (e.g. `"White"`), not its internal ID. Use the name in your filter values.

## Image fields

```html
<img data-algolia-bind="image.url" data-algolia-attr="src">
```

## Hiding empty elements

```html
<div data-algolia-hide-empty="authors" data-algolia-repeat="authors">
  <span data-algolia-repeat-item></span>
</div>
```

The wrapping `.card_item` hides entirely if the field is empty.

---

# Operations

## Re-running the sync (after schema changes)

After adding new fields, new collections, or modifying references in Webflow, run a full sync:

```bash
curl -X POST https://YOUR_SITE.webflow.io/api/sync \
  -H "Authorization: Bearer YOUR_SYNC_SECRET"
```

Or **just publish the site** — the `site_publish` webhook triggers this automatically.

## Clearing the index

In Algolia → your index → **Manage index → Clear index** → type `CLEAR`. Then re-run the sync.

## Updating the library version

When a new version is released, update the version tag in the script URL:

```html
<script src="https://cdn.jsdelivr.net/gh/felixeallan/algolia-webflow-filter@v0.1.9/packages/library/dist/algolia-webflow.min.js"></script>
```

Then **hard refresh** (Cmd/Ctrl+Shift+R) to bypass the browser cache.

## Inspecting the synced data

```bash
curl -s "https://YOUR_APP_ID-dsn.algolia.net/1/indexes/YOUR_INDEX?hitsPerPage=1" \
  -H "X-Algolia-Application-Id: YOUR_APP_ID" \
  -H "X-Algolia-API-Key: YOUR_SEARCH_KEY"
```

## Inspecting the Webflow collection schema

```bash
curl -X PUT https://YOUR_SITE.webflow.io/api/sync \
  -H "Authorization: Bearer YOUR_SYNC_SECRET"
```

Returns the raw schema — useful for debugging field types and resolving issues.

---

# Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Page shows wrong filter values, only ~100 items | Old version of `@main` cached by jsDelivr | Always pin to a `@v0.x.x` tag, not `@main` |
| New library changes not appearing | Browser cache | Hard refresh (Cmd/Ctrl+Shift+R) |
| Webhook URL rejected: "Invalid hostname" | Webflow blocks `*.webflow.io` webhooks | Use the Cloudflare Worker URL instead |
| Items from other collections appear in Algolia | Webhook fires for all collections | Set `WEBFLOW_COLLECTION_ID` in the Cloudflare Worker |
| Reference field shows an ID instead of name | Old sync, or new reference field | Re-run sync (or publish the site) |
| Webflow Cloud deploy fails (`Cannot find package esbuild`) | Webflow Cloud installs with `--omit=dev` | All build-time deps must be regular dependencies (already configured in the template) |
| Webflow Cloud deploy succeeds but routes 500 | Next.js 16.2+ Turbopack output crashes on Workers | Already pinned to ~16.1 with `next build --webpack` |

---

# Project structure

```
algolia-webflow-filter/
├── apps/
│   ├── sync/                          # Next.js app for Webflow Cloud
│   │   └── src/app/
│   │       ├── sync/route.ts          # POST /api/sync — full paginated sync
│   │       │                          # GET  /api/sync — health check
│   │       │                          # PUT  /api/sync — schema dump (debug)
│   │       └── webhook/route.ts       # POST /api/webhook (unused — use Cloudflare Worker instead)
│   │
│   └── webhook-worker/                # Cloudflare Worker
│       └── src/index.js               # Per-item sync + full sync on site_publish
│
└── packages/
    └── library/                       # Client-side filter library
        ├── src/index.ts               # Source
        └── dist/algolia-webflow.min.js  # Built (served via jsDelivr)
```
