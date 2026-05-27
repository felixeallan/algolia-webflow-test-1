import { liteClient } from 'algoliasearch/lite'
import type { SearchResponse } from 'algoliasearch/lite'
import type { AlgoliaInstance, Hit, SearchResults } from './types'

// ─── Search ──────────────────────────────────────────────────────────────────

async function runSearch(instance: AlgoliaInstance): Promise<void> {
  const client = liteClient(instance.appId, instance.apiKey)

  // Build facetFilters: same attribute = OR, different attributes = AND
  // Algolia format: [["category:shoes","category:bags"], "brand:nike"]
  const facetFilters: Array<string | string[]> = []
  instance.filters.forEach((values, attribute) => {
    if (values.size === 0) return
    const group = [...values].map((v) => `${attribute}:${v}`)
    facetFilters.push(group.length === 1 ? group[0] : group)
  })

  const indexName = instance.sortIndex || instance.indexName

  const response = await client.search({
    requests: [
      {
        indexName,
        query: instance.query,
        page: instance.page,
        hitsPerPage: instance.hitsPerPage,
        facetFilters: facetFilters.length ? facetFilters : undefined,
      },
    ],
  })

  const result = response.results[0] as SearchResponse<Hit>

  const results: SearchResults = {
    hits: result.hits,
    nbHits: result.nbHits ?? 0,
    page: result.page ?? 0,
    nbPages: result.nbPages ?? 0,
  }

  render(instance, results)
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render(instance: AlgoliaInstance, results: SearchResults): void {
  const { wrapper } = instance
  const list = wrapper.querySelector<HTMLElement>('[data-algolia-list]')
  const template = wrapper.querySelector<HTMLTemplateElement>('[data-algolia-template]')

  if (!list || !template) return

  // Remove previous results, keep the template in place
  list.querySelectorAll('[data-algolia-item]').forEach((el) => el.remove())

  const emptyEl = wrapper.querySelector<HTMLElement>('[data-algolia-empty]')
  const countEl = wrapper.querySelector<HTMLElement>('[data-algolia-count]')
  const prevBtn = wrapper.querySelector<HTMLButtonElement>('[data-algolia-prev]')
  const nextBtn = wrapper.querySelector<HTMLButtonElement>('[data-algolia-next]')
  const pageInfo = wrapper.querySelector<HTMLElement>('[data-algolia-page-info]')

  if (emptyEl) emptyEl.style.display = results.hits.length === 0 ? '' : 'none'
  if (countEl) countEl.textContent = String(results.nbHits)
  if (pageInfo) pageInfo.textContent = `Page ${results.page + 1} of ${results.nbPages}`
  if (prevBtn) prevBtn.disabled = results.page === 0
  if (nextBtn) nextBtn.disabled = results.page >= results.nbPages - 1

  results.hits.forEach((hit) => {
    const clone = template.content.cloneNode(true) as DocumentFragment

    // Mark injected items so we can remove them on the next render
    const root = clone.firstElementChild
    if (root) root.setAttribute('data-algolia-item', '')

    clone.querySelectorAll<HTMLElement>('[data-algolia-bind]').forEach((el) => {
      const field = el.getAttribute('data-algolia-bind')!
      const attr = el.getAttribute('data-algolia-attr')
      const value = String(hit[field] ?? '')

      if (attr) {
        el.setAttribute(attr, value)
      } else {
        el.textContent = value
      }
    })

    list.appendChild(clone)
  })
}

// ─── Debounce ─────────────────────────────────────────────────────────────────

function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>
  return ((...args: unknown[]) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }) as T
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

function initInstance(wrapper: HTMLElement): void {
  const appId = wrapper.getAttribute('data-app-id')
  const apiKey = wrapper.getAttribute('data-api-key')
  const indexName = wrapper.getAttribute('data-index')

  if (!appId || !apiKey || !indexName) {
    console.warn('[algolia-webflow] Missing data-app-id, data-api-key, or data-index on', wrapper)
    return
  }

  const instance: AlgoliaInstance = {
    appId,
    apiKey,
    indexName,
    hitsPerPage: Number(wrapper.getAttribute('data-hits-per-page') ?? 12),
    query: '',
    page: 0,
    filters: new Map(),
    sortIndex: '',
    wrapper,
  }

  const search = () => runSearch(instance)
  const debouncedSearch = debounce(search, 300)

  // Search input
  const searchInput = wrapper.querySelector<HTMLInputElement>('[data-algolia-search]')
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      instance.query = searchInput.value
      instance.page = 0
      debouncedSearch()
    })
  }

  // Filter elements
  wrapper.querySelectorAll<HTMLElement>('[data-algolia-filter]').forEach((el) => {
    el.addEventListener('click', () => {
      const attribute = el.getAttribute('data-algolia-filter')!
      const value = el.getAttribute('data-algolia-value')!

      if (!instance.filters.has(attribute)) {
        instance.filters.set(attribute, new Set())
      }
      const set = instance.filters.get(attribute)!

      if (set.has(value)) {
        set.delete(value)
        el.removeAttribute('data-active')
      } else {
        set.add(value)
        el.setAttribute('data-active', '')
      }

      instance.page = 0
      search()
    })
  })

  // Sort
  const sortSelect = wrapper.querySelector<HTMLSelectElement>('[data-algolia-sort]')
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      instance.sortIndex = sortSelect.value
      instance.page = 0
      search()
    })
  }

  // Pagination
  const prevBtn = wrapper.querySelector<HTMLButtonElement>('[data-algolia-prev]')
  const nextBtn = wrapper.querySelector<HTMLButtonElement>('[data-algolia-next]')

  prevBtn?.addEventListener('click', () => {
    if (instance.page > 0) {
      instance.page--
      search()
    }
  })

  nextBtn?.addEventListener('click', () => {
    instance.page++
    search()
  })

  // Initial search
  search()
}

function init(): void {
  document.querySelectorAll<HTMLElement>('[data-algolia]').forEach(initInstance)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
