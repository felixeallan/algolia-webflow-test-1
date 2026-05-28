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
  if (instance.urlState) pushUrlState(instance)
}

// ─── URL state ────────────────────────────────────────────────────────────────

function pushUrlState(instance: AlgoliaInstance): void {
  const params = new URLSearchParams(window.location.search)

  // Clear all known params for this instance
  params.delete('q')
  params.delete('page')
  params.delete('sort')
  instance.filterAttributes.forEach((attr) => params.delete(attr))

  if (instance.query) params.set('q', instance.query)
  if (instance.page > 0) params.set('page', String(instance.page))
  if (instance.sortIndex) params.set('sort', instance.sortIndex)
  instance.filters.forEach((values, attr) => {
    if (values.size > 0) params.set(attr, [...values].join(','))
  })

  const qs = params.toString()
  history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
}

function readUrlState(instance: AlgoliaInstance, wrapper: HTMLElement): void {
  const params = new URLSearchParams(window.location.search)

  if (params.has('q')) {
    instance.query = params.get('q')!
    const searchInput = wrapper.querySelector<HTMLInputElement>('[data-algolia-search]')
    if (searchInput) searchInput.value = instance.query
  }

  if (params.has('page')) instance.page = Number(params.get('page')) || 0

  if (params.has('sort')) {
    instance.sortIndex = params.get('sort')!
    const sortSelect = wrapper.querySelector<HTMLSelectElement>('[data-algolia-sort]')
    if (sortSelect) sortSelect.value = instance.sortIndex
  }

  // Restore filters
  params.forEach((value, key) => {
    if (['q', 'page', 'sort'].includes(key)) return
    const values = value.split(',').filter(Boolean)
    if (!values.length) return
    instance.filters.set(key, new Set(values))

    values.forEach((val) => {
      const el = wrapper.querySelector<HTMLElement>(
        `[data-algolia-filter="${key}"][data-algolia-value="${val}"]`
      )
      if (el) forceFilterState(el, true)
    })

    const sel = wrapper.querySelector<HTMLSelectElement>(`[data-algolia-filter-select="${key}"]`)
    if (sel && values[0]) sel.value = values[0]
  })
}

// ─── Tags ─────────────────────────────────────────────────────────────────────

function renderTags(instance: AlgoliaInstance): void {
  const { wrapper } = instance
  const container = wrapper.querySelector<HTMLElement>('[data-algolia-tags]')
  if (!container) return

  const tagTemplate = container.querySelector<HTMLElement>('[data-algolia-tag-template]')
  if (!tagTemplate) return

  tagTemplate.style.display = 'none'
  container.querySelectorAll('[data-algolia-tag-item]').forEach((el) => el.remove())

  instance.filters.forEach((values, attribute) => {
    values.forEach((value) => {
      const tag = tagTemplate.cloneNode(true) as HTMLElement
      tag.removeAttribute('data-algolia-tag-template')
      tag.setAttribute('data-algolia-tag-item', '')
      tag.style.display = ''

      const label = tag.querySelector<HTMLElement>('[data-algolia-tag-label]')
      if (label) label.textContent = value

      const removeBtn = tag.querySelector<HTMLElement>('[data-algolia-tag-remove]') ?? tag
      removeBtn.addEventListener('click', (e) => {
        e.preventDefault()
        const set = instance.filters.get(attribute)
        if (!set) return
        set.delete(value)

        // Sync UI: deactivate matching filter element, reset dropdown if applicable
        const filterEl = wrapper.querySelector<HTMLElement>(
          `[data-algolia-filter="${attribute}"][data-algolia-value="${value}"]`
        )
        if (filterEl) forceFilterState(filterEl, false)

        const filterSelect = wrapper.querySelector<HTMLSelectElement>(
          `[data-algolia-filter-select="${attribute}"]`
        )
        if (filterSelect && filterSelect.value === value) filterSelect.value = ''

        instance.page = 0
        runSearch(instance)
      })

      container.appendChild(tag)
    })
  })
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

  renderTags(instance)

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

function getInput(el: HTMLElement): HTMLInputElement | null {
  return el.querySelector<HTMLInputElement>('input[type="checkbox"], input[type="radio"]')
}

function syncWebflowVisual(el: HTMLElement, checked: boolean): void {
  el.querySelectorAll<HTMLElement>('.w-checkbox-input, .w-radio-input')
    .forEach((div) => div.classList.toggle('w--redirected-checked', checked))
}

// Programmatically force a filter element to (un)checked state — used by Clear buttons.
// For user interactions, we listen to native change events instead.
function forceFilterState(el: HTMLElement, checked: boolean): void {
  el.toggleAttribute('data-active', checked)
  const input = getInput(el)
  if (input) input.checked = checked
  syncWebflowVisual(el, checked)
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
    urlState: wrapper.hasAttribute('data-algolia-url-state'),
    filterAttributes: new Set([
      ...[...wrapper.querySelectorAll('[data-algolia-filter]')]
        .map((el) => el.getAttribute('data-algolia-filter')!),
      ...[...wrapper.querySelectorAll('[data-algolia-filter-select]')]
        .map((el) => el.getAttribute('data-algolia-filter-select')!),
    ]),
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

  // Filter elements — listen on the input's change event when present so we
  // don't race with the browser/Webflow's own click handling. For plain divs
  // (no input inside), fall back to a click toggle.
  wrapper.querySelectorAll<HTMLElement>('[data-algolia-filter]').forEach((el) => {
    const attribute = el.getAttribute('data-algolia-filter')!
    const value = el.getAttribute('data-algolia-value')!
    const input = getInput(el)

    if (input) {
      // Allow clicking an already-selected radio to deselect it.
      // Runs before the browser's default label→input redirect.
      if (input.type === 'radio') {
        el.addEventListener('click', (e) => {
          // The browser dispatches a synthetic click on the input as the
          // label's default action; that click bubbles back here. Skip it,
          // otherwise we'd undo the selection the user just made.
          if (e.target === input) return
          if (input.checked) {
            e.preventDefault()
            input.checked = false
            input.dispatchEvent(new Event('change', { bubbles: true }))
            // Webflow listens on change of the checked radio, not the deselected one,
            // so manually clear the visual class here
            syncWebflowVisual(el, false)
          }
        })
      }

      input.addEventListener('change', () => {
        if (!instance.filters.has(attribute)) instance.filters.set(attribute, new Set())
        const set = instance.filters.get(attribute)!

        if (input.type === 'radio') {
          // Native: other radios in the same name group auto-uncheck
          set.clear()
          if (input.checked) set.add(value)
          // Sync data-active across the entire group from the actual input state
          wrapper.querySelectorAll<HTMLElement>(`[data-algolia-filter="${attribute}"]`)
            .forEach((other) => {
              const otherInput = getInput(other)
              other.toggleAttribute('data-active', !!otherInput?.checked)
            })
        } else {
          if (input.checked) {
            set.add(value)
            el.setAttribute('data-active', '')
          } else {
            set.delete(value)
            el.removeAttribute('data-active')
          }
        }

        instance.page = 0
        search()
      })
    } else {
      el.addEventListener('click', () => {
        if (!instance.filters.has(attribute)) instance.filters.set(attribute, new Set())
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
    }
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
          .forEach((el) => forceFilterState(el, false))
        wrapper.querySelectorAll<HTMLSelectElement>(`[data-algolia-filter-select="${attribute}"]`)
          .forEach((sel) => { sel.value = '' })
      } else {
        // Clear all filters, search and sort
        instance.filters.clear()
        instance.query = ''
        instance.sortIndex = ''
        wrapper.querySelectorAll<HTMLElement>('[data-algolia-filter]')
          .forEach((el) => forceFilterState(el, false))
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

  // Initial search — restore URL state first if enabled
  if (instance.urlState) readUrlState(instance, wrapper)
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
