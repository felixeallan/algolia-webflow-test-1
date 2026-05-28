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
  const templateEl = wrapper.querySelector('[data-algolia-template]')

  if (!list || !templateEl) return

  // Hide a div-based template so it doesn't show as an empty card
  if (!(templateEl instanceof HTMLTemplateElement)) {
    (templateEl as HTMLElement).style.display = 'none'
  }

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
    let itemRoot: HTMLElement

    if (templateEl instanceof HTMLTemplateElement) {
      const clone = templateEl.content.cloneNode(true) as DocumentFragment
      itemRoot = clone.firstElementChild as HTMLElement
    } else {
      itemRoot = templateEl.cloneNode(true) as HTMLElement
      itemRoot.removeAttribute('data-algolia-template')
      itemRoot.style.display = ''
    }

    itemRoot.setAttribute('data-algolia-item', '')

    itemRoot.querySelectorAll<HTMLElement>('[data-algolia-bind]').forEach((el) => {
      const field = el.getAttribute('data-algolia-bind')!
      const attr = el.getAttribute('data-algolia-attr')
      const raw = field.split('.').reduce<unknown>(
        (obj, key) => (obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined),
        hit as unknown
      )
      const value = String(raw ?? '')
      if (attr) {
        el.setAttribute(attr, value)
      } else {
        el.textContent = value
      }
    })

    // Repeat containers — render one child per array value
    itemRoot.querySelectorAll<HTMLElement>('[data-algolia-repeat]').forEach((container) => {
      const field = container.getAttribute('data-algolia-repeat')!
      const itemTemplate = container.querySelector<HTMLElement>('[data-algolia-repeat-item]')
      if (!itemTemplate) return

      itemTemplate.style.display = 'none'
      container.querySelectorAll('[data-algolia-repeat-rendered]').forEach((el) => el.remove())

      const values = hit[field]
      if (!Array.isArray(values)) return

      values.forEach((val) => {
        const clone = itemTemplate.cloneNode(true) as HTMLElement
        clone.removeAttribute('data-algolia-repeat-item')
        clone.setAttribute('data-algolia-repeat-rendered', '')
        clone.style.display = ''
        clone.textContent = String(val ?? '')
        container.appendChild(clone)
      })
    })

    // Hide elements when their bound field is empty
    itemRoot.querySelectorAll<HTMLElement>('[data-algolia-hide-empty]').forEach((el) => {
      const field = el.getAttribute('data-algolia-hide-empty')!
      const val = hit[field]
      const isEmpty = val === null || val === undefined || val === '' || (Array.isArray(val) && val.length === 0)
      el.style.setProperty('display', isEmpty ? 'none' : '', isEmpty ? 'important' : '')
    })

    list.appendChild(itemRoot)
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setNativeInput(el: HTMLElement, checked: boolean): void {
  const input = el.querySelector<HTMLInputElement>('input[type="checkbox"], input[type="radio"]')
  if (input) input.checked = checked
  // Target the Webflow custom input divs directly so toggle works for both add and remove
  el.querySelectorAll<HTMLElement>('.w-checkbox-input, .w-radio-input')
    .forEach((div) => div.classList.toggle('w--redirected-checked', checked))
}

function deactivateFilter(el: HTMLElement): void {
  el.removeAttribute('data-active')
  setNativeInput(el, false)
}

function activateFilter(el: HTMLElement): void {
  el.setAttribute('data-active', '')
  setNativeInput(el, true)
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
      const isRadio = !!el.querySelector('input[type="radio"]')

      if (!instance.filters.has(attribute)) {
        instance.filters.set(attribute, new Set())
      }
      const set = instance.filters.get(attribute)!

      if (isRadio) {
        // Check wasActive BEFORE deactivating so we know the intended state
        const wasActive = el.hasAttribute('data-active')
        wrapper.querySelectorAll<HTMLElement>(`[data-algolia-filter="${attribute}"]`)
          .forEach((other) => deactivateFilter(other))
        set.clear()
        if (!wasActive) {
          set.add(value)
          activateFilter(el)
        }
      } else {
        // Multi-select: toggle
        if (set.has(value)) {
          set.delete(value)
          deactivateFilter(el)
        } else {
          set.add(value)
          activateFilter(el)
        }
      }

      instance.page = 0
      search()
    })
  })

  // Filter selects (e.g. year dropdown)
  wrapper.querySelectorAll<HTMLSelectElement>('[data-algolia-filter-select]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const attribute = sel.getAttribute('data-algolia-filter-select')!
      if (!instance.filters.has(attribute)) {
        instance.filters.set(attribute, new Set())
      }
      const set = instance.filters.get(attribute)!
      set.clear()
      if (sel.value) set.add(sel.value)
      instance.page = 0
      search()
    })
  })

  // Clear buttons
  wrapper.querySelectorAll<HTMLElement>('[data-algolia-clear]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      const attribute = btn.getAttribute('data-algolia-clear')

      if (attribute) {
        // Clear a specific filter group
        instance.filters.get(attribute)?.clear()
        wrapper.querySelectorAll<HTMLElement>(`[data-algolia-filter="${attribute}"]`)
          .forEach((el) => deactivateFilter(el))
        wrapper.querySelectorAll<HTMLSelectElement>(`[data-algolia-filter-select="${attribute}"]`)
          .forEach((sel) => { sel.value = '' })
      } else {
        // Clear all filters, search and sort
        instance.filters.clear()
        instance.query = ''
        instance.sortIndex = ''
        wrapper.querySelectorAll<HTMLElement>('[data-algolia-filter]')
          .forEach((el) => deactivateFilter(el))
        wrapper.querySelectorAll<HTMLSelectElement>('[data-algolia-filter-select]')
          .forEach((sel) => { sel.value = '' })
        const searchInput = wrapper.querySelector<HTMLInputElement>('[data-algolia-search]')
        if (searchInput) searchInput.value = ''
        if (sortSelect) sortSelect.value = sortSelect.options[0]?.value ?? ''
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
