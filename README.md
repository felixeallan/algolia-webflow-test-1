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

## Step 9 — (Optional) Configure sorting

Sorting in Algolia works through **replica indexes** — pre-sorted copies of the main index. Each user-facing sort option = one replica. Algolia keeps replicas in sync automatically.

### 9.1 — Create one replica per sort option

In Algolia → your main index → **Configuration → Replicas → Create Replica**:

1. Choose **Virtual replica** (free, no extra storage)
2. Name it descriptively, matching the format `INDEX_FIELD_DIRECTION`:

| Sort option | Replica name |
|---|---|
| Name A → Z | `cars_name_asc` |
| Name Z → A | `cars_name_desc` |
| Price ↑ | `cars_price_asc` |
| Price ↓ | `cars_price_desc` |
| Year newest | `cars_year_desc` |
| Year oldest | `cars_year_asc` |

3. Click **Create**. Repeat for each sort option you want.

### 9.2 — Configure each replica's Sort-by rule

A replica is empty until you tell it how to sort. For **each** replica:

1. Click the replica name (e.g. `cars_name_asc`) to open it
2. Go to **Configuration → Relevant sort** (or "Ranking and Sorting")
3. Add **exactly one** Sort-by rule that matches the replica's name:
   - `cars_name_asc` → Sort-by `name` Ascending
   - `cars_name_desc` → Sort-by `name` Descending
   - `cars_price_asc` → Sort-by `price` Ascending
   - …etc.
4. Click **Review and Save settings**

> **Important:** Each replica must have **exactly one** Sort-by rule. Multiple rules turn additional ones into tiebreakers, which is rarely what you want for user-facing sorting. One replica = one dropdown option.

### 9.3 — Add the sort dropdown to your page

Use a native `<select>` element. In **Webflow Designer → Add panel → Forms → Select**, drag a Select field onto the page (not the navigation "Dropdown" component — that's a div-based menu and won't fire `change` events).

Then add `data-algolia-sort` and option values matching your replica names exactly:

```html
<select data-algolia-sort>
  <option value="">Default (relevance)</option>
  <option value="cars_name_asc">Name: A → Z</option>
  <option value="cars_name_desc">Name: Z → A</option>
  <option value="cars_price_asc">Price: Low → High</option>
  <option value="cars_price_desc">Price: High → Low</option>
  <option value="cars_year_desc">Year: Newest first</option>
  <option value="cars_year_asc">Year: Oldest first</option>
</select>
```

The empty option (`value=""`) keeps the default relevance ranking.

### 9.4 — Caveat: sorting numbers stored as strings

For sorting to behave numerically, the field must be a **number** in Algolia. If a field is stored as a string with commas (e.g. `"14,020"`), Algolia sorts it alphabetically — `"9,999"` would come after `"14,020"`. Use a Webflow **Number** field (not a Plain text field formatted to look like a number) for any field you plan to sort numerically.

## Step 10 — Add the library to your Webflow page

In Webflow → **Site Settings → Custom Code → Footer**:

```html
<script src="https://cdn.jsdelivr.net/gh/felixeallan/algolia-webflow-filter@v0.5.0/packages/library/dist/algolia-webflow.min.js"></script>
```

**Always pin to a version tag** (e.g. `@v0.5.0`). Do not use `@main` — jsDelivr aggressively caches branch URLs.

## Step 11 — Build the filter UI

See the **HTML structure** and **Data attribute reference** below.

---

# HTML structure (full example)

```html
<div
  data-algolia
  data-algolia-app-id="YOUR_APP_ID"
  data-algolia-api-key="YOUR_SEARCH_ONLY_KEY"
  data-algolia-index="cars"
  data-algolia-hits-per-page="12"
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
| `data-algolia-app-id="..."` | wrapper | Algolia Application ID |
| `data-algolia-api-key="..."` | wrapper | Algolia **Search-Only** API key (safe to expose) |
| `data-algolia-index="..."` | wrapper | Algolia index name |
| `data-algolia-hits-per-page="12"` | wrapper | Number of results per page (default 12) |
| `data-algolia-url-state` | wrapper | (optional) Sync filters/search/page to URL params for shareable links |
| `data-algolia-debounce="300"` | wrapper | (optional) Debounce delay in milliseconds before search/range inputs fire a search. Default `300`. Higher values reduce API calls for fast typers. |
| `data-algolia-stagger="50"` | wrapper | (optional) Delay in milliseconds between each result item's entrance animation (fade in + slide up). Default `0` (no animation). Suggested: `30–60` subtle, `80–120` more visible. |

## Search

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-search` | `<input>` | Text search input |

## Filters

> ⚠️ **Every attribute you filter by must be added as a Facet in Algolia.** Go to your index → **Configuration → Facets → Attributes for faceting** and add the field slug (e.g. `car-brand`, `featured`, `year`). Without this, the filter will silently return no results. After adding, click **Review and Save settings**.

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-filter="attr"` + `data-algolia-value="val"` | any (`<label>` recommended) | Click to filter. Auto-detects native `<input type="checkbox">` (multi-select) or `<input type="radio">` (single-select) inside. Same `attr` = OR; different attrs = AND. For boolean fields, use `"true"` or `"false"` as the value. |
| `data-algolia-filter-all="attr"` | `<label>` containing a radio | "All" option for a radio filter group. Clicking it clears all selections in that group. Auto-activates whenever no specific filter is selected, so it acts as the default state on page load. Only meaningful for radios (checkboxes already use "nothing checked" to mean "show all"). |
| `data-algolia-filter-select="attr"` | `<select>` | Dropdown filter. Empty option (`value=""`) clears the filter. |
| `data-algolia-range-min="attr"` | `<input type="number">` | Lower bound of a numeric range filter. Leave empty for open-ended. Field must be a **number** in Algolia. |
| `data-algolia-range-max="attr"` | `<input type="number">` | Upper bound of a numeric range filter. |
| `data-algolia-range-label="Price"` | range input | (optional) Custom prefix used in the active filter tag for this range. Default tag shows just the value (`Any – 2000`); with this set it shows `Price: Any – 2000`. Add to either min or max input. |

## Sort

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-sort` | `<select>` (Webflow Form Select field) | Each option's `value` should be the name of an Algolia index replica (e.g. `cars_price_asc`). See [Step 9](#step-9--optional-configure-sorting) for full setup. Must be a native `<select>` — Webflow's navigation "Dropdown" component will not work. |

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

Three independent options — pick whichever fits your layout:

| Option | Attributes | Behavior |
|---|---|---|
| **Load More** | `data-algolia-load-more` | Appends next page to existing results. Never replaces. |
| **Previous / Next** | `data-algolia-prev` `data-algolia-next` `data-algolia-page-info` | Replaces results. Standard back/forward navigation. |
| **Numbered pages** | `data-algolia-pages` + templates | Replaces results. Lets user jump to any page. Supports dots and responsive siblings/boundaries. |

You can combine **Previous / Next** with **Numbered pages** (common pattern). Avoid combining **Load More** with the others — it would create confusing UX since Load More appends while the others replace.

### Load More button

Appends the next page of results to the existing list without replacing it. Auto-hides when there are no more pages.

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-load-more` | any | Clicking appends the next page. Hides automatically on the last page. Changing filters/search/sort resets the list normally. |

```html
<button data-algolia-load-more>Load more</button>
```

> **Note:** Algolia caps pagination at 1,000 total results by default. If you need more, increase `paginationLimitedTo` in Algolia → your index → Configuration → Pagination. Also keep `data-hits-per-page` reasonable (12–24) to avoid accumulating too many DOM nodes.

### Previous / Next buttons

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-prev` | any | Click → previous page. Auto-disabled on first page. |
| `data-algolia-next` | any | Click → next page. Auto-disabled on last page. |
| `data-algolia-page-info` | any | Displays "Page X of Y" |

### Numbered page buttons (with siblings, boundaries, and dots)

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-pages` | container | Where numbered page buttons get injected |
| `data-algolia-page-button-template` | child of pages container | Cloned for each visible page number. Active page gets `data-active=""` for styling. |
| `data-algolia-page-dots-template` | child of pages container | (Optional) Cloned to render the "..." separator when pages are skipped due to siblings/boundaries logic. |
| `data-algolia-page-siblings="2,1,1,0"` | pages container | Number of pages shown on each side of the current page. Comma-separated for Webflow breakpoints (Desktop, Tablet, Landscape, Portrait). Default `1`. Single value (`"1"`) applies everywhere. |
| `data-algolia-page-boundaries="1,1,1,0"` | pages container | Number of pages always shown at the start and end of the pagination. Same comma-separated breakpoint syntax. Default `1`. |

Example:

```html
<div
  data-algolia-pages
  data-algolia-page-siblings="2,1,1,0"
  data-algolia-page-boundaries="1,1,1,0"
>
  <button data-algolia-page-button-template class="page-btn">1</button>
  <span data-algolia-page-dots-template class="page-dots">…</span>
</div>
```

Style the active page in Webflow's custom CSS:

```css
[data-algolia-page-item][data-active] { background: #6c2bd9; color: white; }
```

The page list re-renders automatically on window resize so the responsive siblings/boundaries kick in correctly.

## Active filter tags

Renders one element per active filter, with an X button to remove individual filters.

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-tags` | container | Where tags get injected |
| `data-algolia-tag-template` | child of tags container | Cloned once per active filter |
| `data-algolia-tag-label` | any (inside tag template) | Gets the filter value as text (e.g. "Quasar", "White") |
| `data-algolia-tag-remove` | any (inside tag template) | Clicking removes that filter. If missing, the whole tag is clickable. |

## Scroll anchor

Scrolls the page to a specific element on every filter, search, sort, or pagination change. Useful for long pages or sticky headers where filter results would otherwise be scrolled off-screen.

| Attribute | Element | Description |
|---|---|---|
| `data-algolia-scroll-anchor` | any | Scrolls smoothly to this element on every filter change. Can be **inside or outside** the `[data-algolia]` wrapper. Skipped on initial page load to avoid an unexpected jump. |

```html
<!-- Place above the results section -->
<div data-algolia-scroll-anchor></div>
```

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

## Boolean fields (Switch / toggle)

Webflow "Switch" fields are stored as real booleans in Algolia (`true` / `false`). Use the string `"true"` or `"false"` as the filter value:

```html
<!-- Toggle ON = show only featured items -->
<label data-algolia-filter="featured" data-algolia-value="true" class="filter_toggle">
  <input type="checkbox">
  <span>Featured only</span>
</label>
```

Toggle off = no filter = shows everything.

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

## Setting a default active filter

On page load, the library reads the initial `checked` / `selected` state of inputs and applies it as the starting filter state.

**Default to "All"** — just add `data-algolia-filter-all="attr"` to the All option. It auto-activates whenever no specific filter is selected, including the initial page load. No `checked` attribute needed.

```html
<label data-algolia-filter-all="car-brand">
  <input type="radio" name="brand">
  <span>All brands</span>
</label>
```

**Default to a specific filter** — add `checked` to the input. Either in HTML or by toggling **Default state: Checked** in Webflow Designer's element settings.

```html
<label data-algolia-filter="car-brand" data-algolia-value="Quasar">
  <input type="radio" name="brand" checked>
  <span>Quasar</span>
</label>
```

Same works for `<option selected>` inside a `data-algolia-filter-select` dropdown.

**Priority:** URL state (if `data-algolia-url-state` is on the wrapper and the URL contains filter params) > HTML defaults > nothing.

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
<script src="https://cdn.jsdelivr.net/gh/felixeallan/algolia-webflow-filter@v0.5.0/packages/library/dist/algolia-webflow.min.js"></script>
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
