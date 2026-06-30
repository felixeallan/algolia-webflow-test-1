import { liteClient } from 'algoliasearch/lite'
import type { SearchResponse } from 'algoliasearch/lite'
import type { AlgoliaInstance, Hit, SearchResults } from './types'
import { initInspector } from './inspector'

// ─── Search ──────────────────────────────────────────────────────────────────

async function runSearch(instance: AlgoliaInstance, append = false): Promise<void> {
  // Empty search mode: a blank query shows nothing rather than all records.
  // Gated on searchMode so normal filter pages are unaffected.
  if (instance.searchMode === 'empty' && !instance.query.trim()) {
    clearResults(instance)
    if (instance.urlState) pushUrlState(instance)
    return
  }

  const client = liteClient(instance.appId, instance.apiKey)

  // Build facetFilters:
  //   AND mode (default): same attribute = OR, different attributes = AND
  //     → [["category:shoes","category:bags"], "brand:nike"]
  //   OR mode: every selected value joins one big OR group
  //     → [["category:shoes","category:bags","brand:nike"]]
  // Ranges always AND with facets (Algolia joins facetFilters & numericFilters with AND).
  const facetFilters: Array<string | string[]> = []
  if (instance.matchMode === 'or') {
    const all: string[] = []
    instance.filters.forEach((values, attribute) => {
      values.forEach((v) => all.push(`${attribute}:${v}`))
    })
    if (all.length) facetFilters.push(all)
  } else {
    instance.filters.forEach((values, attribute) => {
      if (values.size === 0) return
      const group = [...values].map((v) => `${attribute}:${v}`)
      facetFilters.push(group.length === 1 ? group[0] : group)
    })
  }

  // Build numericFilters: [["price>=1000","price<=50000"]]
  const numericFilters: string[] = []
  instance.ranges.forEach((range, attribute) => {
    if (range.min !== undefined) numericFilters.push(`${attribute}>=${range.min}`)
    if (range.max !== undefined) numericFilters.push(`${attribute}<=${range.max}`)
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
        numericFilters: numericFilters.length ? numericFilters : undefined,
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

  render(instance, results, append)
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

// ─── Numbered pagination ──────────────────────────────────────────────────────

function getResponsiveValue(spec: string | null, fallback: number): number {
  if (!spec) return fallback
  const parts = spec.split(',').map((s) => Number(s.trim()))
  const w = typeof window !== 'undefined' ? window.innerWidth : 1200
  let idx: number
  if (w > 991) idx = 0
  else if (w > 767) idx = 1
  else if (w > 477) idx = 2
  else idx = 3
  // Fall back to the last defined value if this breakpoint isn't specified
  for (let i = idx; i >= 0; i--) {
    if (!Number.isNaN(parts[i])) return parts[i]
  }
  return fallback
}

function getPageList(current: number, total: number, siblings: number, boundaries: number): Array<number | 'dots'> {
  const set = new Set<number>()
  for (let i = 1; i <= Math.min(boundaries, total); i++) set.add(i)
  for (let i = Math.max(1, total - boundaries + 1); i <= total; i++) set.add(i)
  for (let i = Math.max(1, current - siblings); i <= Math.min(total, current + siblings); i++) set.add(i)

  const sorted = [...set].sort((a, b) => a - b)
  const result: Array<number | 'dots'> = []
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push('dots')
    result.push(sorted[i])
  }
  return result
}

function renderPages(instance: AlgoliaInstance, currentPage: number, totalPages: number): void {
  const { wrapper } = instance
  const container = wrapper.querySelector<HTMLElement>('[data-algolia-pages]')
  if (!container) return

  const buttonTemplate = container.querySelector<HTMLElement>('[data-algolia-page-button-template]')
  if (!buttonTemplate) return
  const dotsTemplate = container.querySelector<HTMLElement>('[data-algolia-page-dots-template]')

  buttonTemplate.style.display = 'none'
  if (dotsTemplate) dotsTemplate.style.display = 'none'
  container.querySelectorAll('[data-algolia-page-item]').forEach((el) => el.remove())

  if (totalPages <= 0) return

  const siblings = getResponsiveValue(container.getAttribute('data-algolia-page-siblings'), 1)
  const boundaries = getResponsiveValue(container.getAttribute('data-algolia-page-boundaries'), 1)
  const items = getPageList(currentPage + 1, totalPages, siblings, boundaries)

  items.forEach((item) => {
    if (item === 'dots') {
      if (!dotsTemplate) return
      const dots = dotsTemplate.cloneNode(true) as HTMLElement
      dots.removeAttribute('data-algolia-page-dots-template')
      dots.setAttribute('data-algolia-page-item', '')
      dots.style.display = ''
      container.appendChild(dots)
      return
    }

    const btn = buttonTemplate.cloneNode(true) as HTMLElement
    btn.removeAttribute('data-algolia-page-button-template')
    btn.setAttribute('data-algolia-page-item', '')
    btn.style.display = ''
    btn.textContent = String(item)
    btn.toggleAttribute('data-active', item === currentPage + 1)

    btn.addEventListener('click', (e) => {
      e.preventDefault()
      instance.page = item - 1
      runSearch(instance)
    })

    container.appendChild(btn)
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

  // Range tags (price, etc.)
  instance.ranges.forEach((range, attribute) => {
    if (range.min === undefined && range.max === undefined) return

    const tag = tagTemplate.cloneNode(true) as HTMLElement
    tag.removeAttribute('data-algolia-tag-template')
    tag.setAttribute('data-algolia-tag-item', '')
    tag.style.display = ''

    const label = tag.querySelector<HTMLElement>('[data-algolia-tag-label]')
    if (label) {
      const minText = range.min !== undefined ? String(range.min) : 'Any'
      const maxText = range.max !== undefined ? String(range.max) : 'Any'
      // Optional custom label via data-algolia-range-label on either input
      const rangeInput = wrapper.querySelector<HTMLElement>(
        `[data-algolia-range-min="${attribute}"], [data-algolia-range-max="${attribute}"]`
      )
      const customLabel = rangeInput?.getAttribute('data-algolia-range-label')
      label.textContent = customLabel
        ? `${customLabel}: ${minText} – ${maxText}`
        : `${minText} – ${maxText}`
    }

    const removeBtn = tag.querySelector<HTMLElement>('[data-algolia-tag-remove]') ?? tag
    removeBtn.addEventListener('click', (e) => {
      e.preventDefault()
      instance.ranges.delete(attribute)
      wrapper.querySelectorAll<HTMLInputElement>(
        `[data-algolia-range-min="${attribute}"], [data-algolia-range-max="${attribute}"]`
      ).forEach((input) => {
        input.value = ''
        input.dispatchEvent(new CustomEvent('algolia-range-reset'))
      })
      instance.page = 0
      runSearch(instance)
    })

    container.appendChild(tag)
  })
}

// ─── Clear results (empty search-mode idle state) ─────────────────────────────
//
// Resets the results UI to a blank idle state WITHOUT querying Algolia. Used by
// empty search mode when there is no query text — on load, after clearing the
// input, and after Clear All. Deliberately does NOT show the empty-state message
// (that's reserved for a real search returning zero hits) and does NOT force the
// "filter all" visual, so the after-clear state matches the on-load state.
function clearResults(instance: AlgoliaInstance): void {
  const { wrapper } = instance
  const list = wrapper.querySelector<HTMLElement>('[data-algolia-list]')
  const templateEl = wrapper.querySelector('[data-algolia-template]')

  if (templateEl && !(templateEl instanceof HTMLTemplateElement)) {
    (templateEl as HTMLElement).style.display = 'none'
  }
  if (list) list.querySelectorAll('[data-algolia-item]').forEach((el) => el.remove())

  const emptyEl = wrapper.querySelector<HTMLElement>('[data-algolia-empty]')
  if (emptyEl) emptyEl.style.display = 'none'

  const countEl = wrapper.querySelector<HTMLElement>('[data-algolia-count]')
  if (countEl) countEl.textContent = '0'

  const pageInfo = wrapper.querySelector<HTMLElement>('[data-algolia-page-info]')
  if (pageInfo) pageInfo.textContent = ''

  wrapper.querySelectorAll<HTMLElement>('[data-algolia-query]').forEach((el) => {
    el.textContent = ''
  })

  const prevBtn = wrapper.querySelector<HTMLButtonElement>('[data-algolia-prev]')
  const nextBtn = wrapper.querySelector<HTMLButtonElement>('[data-algolia-next]')
  if (prevBtn) prevBtn.disabled = true
  if (nextBtn) nextBtn.disabled = true

  const loadMoreBtn = wrapper.querySelector<HTMLElement>('[data-algolia-load-more]')
  if (loadMoreBtn) loadMoreBtn.style.display = 'none'

  renderTags(instance)
  renderPages(instance, 0, 0)
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render(instance: AlgoliaInstance, results: SearchResults, append = false): void {
  const { wrapper } = instance
  const list = wrapper.querySelector<HTMLElement>('[data-algolia-list]')
  const templateEl = wrapper.querySelector('[data-algolia-template]')

  if (!list || !templateEl) return

  // Hide a div-based template so it doesn't show as an empty card
  if (!(templateEl instanceof HTMLTemplateElement)) {
    (templateEl as HTMLElement).style.display = 'none'
  }

  // Remove previous results, keep the template in place
  if (!append) {
    list.querySelectorAll('[data-algolia-item]').forEach((el) => el.remove())
  }

  const emptyEl = wrapper.querySelector<HTMLElement>('[data-algolia-empty]')
  const countEl = wrapper.querySelector<HTMLElement>('[data-algolia-count]')
  const prevBtn = wrapper.querySelector<HTMLButtonElement>('[data-algolia-prev]')
  const nextBtn = wrapper.querySelector<HTMLButtonElement>('[data-algolia-next]')
  const pageInfo = wrapper.querySelector<HTMLElement>('[data-algolia-page-info]')

  if (emptyEl) emptyEl.style.display = results.hits.length === 0 ? '' : 'none'
  if (countEl) countEl.textContent = String(results.nbHits)
  if (pageInfo) pageInfo.textContent = `Page ${results.page + 1} of ${results.nbPages}`

  wrapper.querySelectorAll<HTMLElement>('[data-algolia-query]').forEach((el) => {
    el.textContent = instance.query
  })
  if (prevBtn) prevBtn.disabled = results.page === 0
  if (nextBtn) nextBtn.disabled = results.page >= results.nbPages - 1

  renderTags(instance)
  renderPages(instance, results.page, results.nbPages)
  syncFilterAllStates(instance)

  const staggerMs = Number(wrapper.getAttribute('data-algolia-stagger') ?? 0)

  results.hits.forEach((hit, index) => {
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
      const format = el.getAttribute('data-algolia-bind-format')
      const attr = el.getAttribute('data-algolia-attr')
      const raw = field.split('.').reduce<unknown>(
        (obj, key) => (obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined),
        hit as unknown
      )

      let value: string
      if (format === 'date') {
        const isIso = typeof raw === 'string' && raw.includes('T')
        const date = isIso ? new Date(raw) : new Date((Number(raw) > 1e10 ? Number(raw) : Number(raw) * 1000))
        if (!raw || isNaN(date.getTime()) || (!isIso && !Number(raw))) {
          value = ''
        } else {
          value = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).format(date)
        }
      } else {
        value = String(raw ?? '')
      }

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

    if (staggerMs > 0) {
      itemRoot.style.opacity = '0'
      itemRoot.style.transition = 'opacity 0.4s ease, transform 0.4s ease'
      itemRoot.style.transform = 'translateY(10px)'
      setTimeout(() => {
        itemRoot.style.opacity = '1'
        itemRoot.style.transform = 'translateY(0)'
      }, index * staggerMs)
    }

    list.appendChild(itemRoot)
  })

  // Scroll to anchor on filter/search change (skip first render and load-more append)
  if (instance.hasRendered && !append) {
    const anchor =
      wrapper.querySelector<HTMLElement>('[data-algolia-scroll-anchor]') ??
      document.querySelector<HTMLElement>('[data-algolia-scroll-anchor]')
    anchor?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  instance.hasRendered = true

  // Show/hide the Load More button based on whether more pages exist
  const loadMoreBtn = wrapper.querySelector<HTMLElement>('[data-algolia-load-more]')
  if (loadMoreBtn) {
    const hasMore = results.page < results.nbPages - 1
    loadMoreBtn.style.display = hasMore ? '' : 'none'
  }
}

// ─── Range slider ─────────────────────────────────────────────────────────────

function formatNumber(value: number, locale: string | null): string {
  if (locale === null) return String(value)
  try {
    return new Intl.NumberFormat(locale || undefined, { maximumFractionDigits: 0 }).format(value)
  } catch {
    return String(value)
  }
}

async function initRangeSlider(slider: HTMLElement, instance: AlgoliaInstance): Promise<void> {
  const attribute = slider.getAttribute('data-algolia-range-slider')
  if (!attribute) return

  const step = Number(slider.getAttribute('data-algolia-range-slider-step')) || 1
  const autoBounds = slider.hasAttribute('data-algolia-range-slider-auto-bounds')
  // null = no formatting; '' = browser default; 'fr-FR' = forced locale
  const locale = slider.getAttribute('data-algolia-range-slider-format')

  const staticMinAttr = slider.getAttribute('data-algolia-range-slider-min')
  const staticMaxAttr = slider.getAttribute('data-algolia-range-slider-max')
  let boundsMin = staticMinAttr !== null ? Number(staticMinAttr) : NaN
  let boundsMax = staticMaxAttr !== null ? Number(staticMaxAttr) : NaN

  if (autoBounds && (Number.isNaN(boundsMin) || Number.isNaN(boundsMax))) {
    try {
      const client = liteClient(instance.appId, instance.apiKey)
      const res = await client.search({
        requests: [{ indexName: instance.indexName, query: '', hitsPerPage: 0, facets: [attribute] }],
      })
      // algoliasearch v5 may return facet stats under snake_case or camelCase depending on version
      const result = res.results[0] as { facets_stats?: Record<string, { min: number; max: number }>; facetsStats?: Record<string, { min: number; max: number }> }
      const stats = (result.facets_stats ?? result.facetsStats)?.[attribute]
      if (stats) {
        if (Number.isNaN(boundsMin)) boundsMin = stats.min
        if (Number.isNaN(boundsMax)) boundsMax = stats.max
      } else {
        console.warn(`[algolia-webflow] No facet stats for "${attribute}". Add it as a numeric facet in Algolia.`)
      }
    } catch (err) {
      console.warn('[algolia-webflow] auto-bounds query failed', err)
    }
  }

  if (!Number.isFinite(boundsMin) || !Number.isFinite(boundsMax) || boundsMin >= boundsMax) {
    console.warn(`[algolia-webflow] Range slider "${attribute}" has no valid bounds; falling back to 0–100`)
    boundsMin = 0
    boundsMax = 100
  }

  const track = slider.querySelector<HTMLElement>('[data-algolia-range-slider-track]')
  const fill = slider.querySelector<HTMLElement>('[data-algolia-range-slider-fill]')
  const minHandle = slider.querySelector<HTMLElement>('[data-algolia-range-slider-handle="min"]')
  const maxHandle = slider.querySelector<HTMLElement>('[data-algolia-range-slider-handle="max"]')
  const minDisplay = slider.querySelector<HTMLElement>('[data-algolia-range-slider-display="min"]')
  const maxDisplay = slider.querySelector<HTMLElement>('[data-algolia-range-slider-display="max"]')

  if (!track || !minHandle || !maxHandle) {
    console.warn(`[algolia-webflow] Range slider "${attribute}" missing track or handle elements`)
    return
  }

  const { wrapper } = instance
  const minInput = wrapper.querySelector<HTMLInputElement>(`[data-algolia-range-min="${attribute}"]`)
  const maxInput = wrapper.querySelector<HTMLInputElement>(`[data-algolia-range-max="${attribute}"]`)

  let currentMin = minInput && minInput.value !== '' ? Number(minInput.value) : boundsMin
  let currentMax = maxInput && maxInput.value !== '' ? Number(maxInput.value) : boundsMax
  currentMin = Math.max(boundsMin, Math.min(currentMin, boundsMax))
  currentMax = Math.max(boundsMin, Math.min(currentMax, boundsMax))
  if (currentMax < currentMin) currentMax = currentMin

  // Touch dragging should not scroll the page
  minHandle.style.touchAction = 'none'
  maxHandle.style.touchAction = 'none'

  const valueToPct = (v: number): number => ((v - boundsMin) / (boundsMax - boundsMin)) * 100

  const paint = (): void => {
    const minPct = valueToPct(currentMin)
    const maxPct = valueToPct(currentMax)
    minHandle.style.left = minPct + '%'
    maxHandle.style.left = maxPct + '%'
    if (fill) {
      fill.style.left = minPct + '%'
      fill.style.width = (maxPct - minPct) + '%'
    }
    if (minDisplay) minDisplay.textContent = formatNumber(currentMin, locale)
    if (maxDisplay) maxDisplay.textContent = formatNumber(currentMax, locale)
  }

  // Drive the underlying number inputs. Empty string when at the bound so the
  // existing range listener clears that side of the filter (no spurious tag).
  const commitToInputs = (): void => {
    if (minInput) {
      const newVal = currentMin === boundsMin ? '' : String(currentMin)
      if (minInput.value !== newVal) {
        minInput.value = newVal
        minInput.dispatchEvent(new Event('input', { bubbles: true }))
      }
    }
    if (maxInput) {
      const newVal = currentMax === boundsMax ? '' : String(currentMax)
      if (maxInput.value !== newVal) {
        maxInput.value = newVal
        maxInput.dispatchEvent(new Event('input', { bubbles: true }))
      }
    }
  }

  // Resync slider visuals when the underlying inputs change (typing or clear)
  const resync = (): void => {
    const newMin = minInput && minInput.value !== '' ? Number(minInput.value) : boundsMin
    const newMax = maxInput && maxInput.value !== '' ? Number(maxInput.value) : boundsMax
    if (Number.isNaN(newMin) || Number.isNaN(newMax)) return
    currentMin = Math.max(boundsMin, Math.min(newMin, boundsMax))
    currentMax = Math.max(boundsMin, Math.min(newMax, boundsMax))
    if (currentMax < currentMin) currentMax = currentMin
    paint()
  }
  minInput?.addEventListener('input', resync)
  maxInput?.addEventListener('input', resync)
  // Custom event dispatched by Clear buttons. We avoid 'input' there because
  // Clear also runs its own search() and we don't want the debounced one too.
  minInput?.addEventListener('algolia-range-reset', resync)
  maxInput?.addEventListener('algolia-range-reset', resync)

  const startDrag = (handle: HTMLElement, isMin: boolean) => (e: PointerEvent): void => {
    e.preventDefault()
    handle.setPointerCapture(e.pointerId)

    const move = (ev: PointerEvent): void => {
      const rect = track.getBoundingClientRect()
      let pct = (ev.clientX - rect.left) / rect.width
      pct = Math.max(0, Math.min(1, pct))
      let value = boundsMin + pct * (boundsMax - boundsMin)
      value = Math.round(value / step) * step
      value = Math.max(boundsMin, Math.min(boundsMax, value))

      if (isMin) currentMin = Math.min(value, currentMax)
      else currentMax = Math.max(value, currentMin)
      paint()
      commitToInputs()
    }

    const up = (ev: PointerEvent): void => {
      try { handle.releasePointerCapture(ev.pointerId) } catch { /* already released */ }
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
    }

    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  minHandle.addEventListener('pointerdown', startDrag(minHandle, true))
  maxHandle.addEventListener('pointerdown', startDrag(maxHandle, false))

  paint()
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

// Activate "filter all" elements when their group has no selections
function syncFilterAllStates(instance: AlgoliaInstance): void {
  const { wrapper } = instance
  wrapper.querySelectorAll<HTMLElement>('[data-algolia-filter-all]').forEach((el) => {
    const attr = el.getAttribute('data-algolia-filter-all')!
    const set = instance.filters.get(attr)
    const isEmpty = !set || set.size === 0
    forceFilterState(el, isEmpty)
  })
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

function initInstance(wrapper: HTMLElement): void {
  const appId = wrapper.getAttribute('data-algolia-app-id')
  const apiKey = wrapper.getAttribute('data-algolia-api-key')
  const indexName = wrapper.getAttribute('data-algolia-index')

  if (!appId || !apiKey || !indexName) {
    console.warn('[algolia-webflow] Missing data-algolia-app-id, data-algolia-api-key, or data-algolia-index on', wrapper)
    return
  }

  const instance: AlgoliaInstance = {
    appId,
    apiKey,
    indexName,
    hitsPerPage: Number(wrapper.getAttribute('data-algolia-hits-per-page') ?? 12),
    query: '',
    page: 0,
    filters: new Map(),
    ranges: new Map(),
    sortIndex: '',
    matchMode: wrapper.getAttribute('data-algolia-match-mode')?.toLowerCase() === 'or' ? 'or' : 'and',
    urlState: wrapper.hasAttribute('data-algolia-url-state'),
    hasRendered: false,
    searchMode: wrapper.getAttribute('data-algolia-search-mode') === 'empty' ? 'empty' : 'normal',
    filterAttributes: new Set([
      ...[...wrapper.querySelectorAll('[data-algolia-filter]')]
        .map((el) => el.getAttribute('data-algolia-filter')!),
      ...[...wrapper.querySelectorAll('[data-algolia-filter-select]')]
        .map((el) => el.getAttribute('data-algolia-filter-select')!),
    ]),
    wrapper,
  }

  const search = () => runSearch(instance)
  const debounceMs = Number(wrapper.getAttribute('data-algolia-debounce') ?? 300)
  const debouncedSearch = debounce(search, debounceMs)

  // Placeholder that autosuggest wiring replaces once it's set up below.
  // Allows the Enter and submit handlers (defined first) to close the dropdown.
  let closeSuggest = (): void => {}

  // Search input. A [data-algolia-submit] button switches the query to manual
  // mode: typing updates the stored query but doesn't search until the button is
  // clicked (or Enter is pressed). Filters/sort stay instant. Without the button,
  // search runs instantly on input as before.
  const searchInput = wrapper.querySelector<HTMLInputElement>('[data-algolia-search]')
  const submitBtn = wrapper.querySelector<HTMLElement>('[data-algolia-submit]')
  const manualSearch = !!submitBtn

  if (searchInput) {
    if (manualSearch) {
      // Manual mode: track the typed value without searching
      searchInput.addEventListener('input', () => {
        instance.query = searchInput.value
      })
    } else {
      // Instant mode: search as the user types
      searchInput.addEventListener('input', () => {
        instance.query = searchInput.value
        instance.page = 0
        debouncedSearch()
      })
    }

    // Enter runs an immediate search in BOTH modes and prevents the surrounding
    // Webflow form from submitting. preventDefault on keydown stops the form's
    // submit event from being dispatched at all — a submit-event listener alone
    // is not enough, because Webflow's own handler still fires and resets the
    // input (wiping the query and hiding the results).
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        instance.query = searchInput.value
        instance.page = 0
        closeSuggest()
        search()
      }
    })
  }

  // Always block the surrounding form's submit event — pressing Enter in the
  // search input or clicking a submit button would otherwise reload the page
  // (GET form) and wipe the query state.
  const form = wrapper.closest('form') ?? wrapper.querySelector('form')
  if (form) form.addEventListener('submit', (e) => e.preventDefault())

  // Submit button (manual search mode).
  if (submitBtn) {
    submitBtn.addEventListener('click', (e) => {
      e.preventDefault()
      if (searchInput) instance.query = searchInput.value
      instance.page = 0
      closeSuggest()
      search()
    })
  }

  // Autosuggest wired to the wrapper's own search input.
  // Looks for [data-algolia-autosuggest] inside the wrapper, then as a sibling.
  const suggestContainer =
    wrapper.querySelector<HTMLElement>('[data-algolia-autosuggest]') ??
    wrapper.parentElement?.querySelector<HTMLElement>('[data-algolia-autosuggest]')
  const suggestTemplate = suggestContainer?.querySelector<HTMLElement>('[data-algolia-autosuggest-template]')

  if (searchInput && suggestContainer && suggestTemplate) {
    const suggestClient = liteClient(instance.appId, instance.apiKey)
    const suggestIndex = instance.indexName

    suggestTemplate.style.display = 'none'
    suggestContainer.style.display = 'none'

    const clearSuggest = (): void => {
      suggestContainer.querySelectorAll('[data-algolia-autosuggest-item]').forEach((el) => el.remove())
      suggestContainer.style.display = 'none'
    }
    closeSuggest = clearSuggest

    const renderSuggest = (hits: Hit[]): void => {
      suggestContainer.querySelectorAll('[data-algolia-autosuggest-item]').forEach((el) => el.remove())
      if (!hits.length) { suggestContainer.style.display = 'none'; return }

      hits.forEach((hit) => {
        const item = suggestTemplate.cloneNode(true) as HTMLElement
        item.removeAttribute('data-algolia-autosuggest-template')
        item.setAttribute('data-algolia-autosuggest-item', '')
        item.style.display = ''

        item.querySelectorAll<HTMLElement>('[data-algolia-bind]').forEach((el) => {
          const field = el.getAttribute('data-algolia-bind')!
          const attr = el.getAttribute('data-algolia-attr')
          const raw = field.split('.').reduce<unknown>(
            (obj, key) => (obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined),
            hit as unknown
          )
          const value = String(raw ?? '')
          if (attr) el.setAttribute(attr, value)
          else el.textContent = value
        })

        item.addEventListener('mousedown', (e) => {
          e.preventDefault()
          const title = String(hit['title'] ?? '')
          if (title && searchInput) {
            searchInput.value = title
            instance.query = title
            instance.page = 0
            runSearch(instance)
          }
          clearSuggest()
        })

        suggestContainer.appendChild(item)
      })

      suggestContainer.style.display = ''
    }

    const querySuggest = debounce(async (q: string) => {
      if (!q.trim()) { clearSuggest(); return }
      try {
        const res = await suggestClient.search({ requests: [{ indexName: suggestIndex, query: q, hitsPerPage: 5 }] })
        renderSuggest((res.results[0] as SearchResponse<Hit>).hits)
      } catch { clearSuggest() }
    }, 200)

    searchInput.addEventListener('input', () => querySuggest(searchInput.value))
    searchInput.addEventListener('blur', () => setTimeout(clearSuggest, 150))
    searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { clearSuggest(); searchInput.blur() } })
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

  // "Filter all" elements — clear the group on click/check
  wrapper.querySelectorAll<HTMLElement>('[data-algolia-filter-all]').forEach((el) => {
    const attribute = el.getAttribute('data-algolia-filter-all')!
    const input = getInput(el)

    const applyAll = () => {
      instance.filters.get(attribute)?.clear()
      wrapper.querySelectorAll<HTMLElement>(`[data-algolia-filter="${attribute}"]`)
        .forEach((other) => forceFilterState(other, false))
      instance.page = 0
      search()
    }

    if (input) {
      input.addEventListener('change', () => {
        if (input.checked) {
          applyAll()
        } else {
          // Don't allow unchecking "All" — re-check it
          input.checked = true
          syncWebflowVisual(el, true)
        }
      })
    } else {
      el.addEventListener('click', (e) => {
        e.preventDefault()
        applyAll()
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

  // Range inputs (min/max number fields)
  const updateRange = (attribute: string, bound: 'min' | 'max', raw: string) => {
    if (!instance.ranges.has(attribute)) instance.ranges.set(attribute, {})
    const range = instance.ranges.get(attribute)!
    const parsed = raw === '' ? undefined : Number(raw)
    if (parsed === undefined || Number.isNaN(parsed)) {
      delete range[bound]
    } else {
      range[bound] = parsed
    }
    if (range.min === undefined && range.max === undefined) {
      instance.ranges.delete(attribute)
    }
    instance.page = 0
    debouncedSearch()
  }

  wrapper.querySelectorAll<HTMLInputElement>('[data-algolia-range-min]').forEach((input) => {
    const attribute = input.getAttribute('data-algolia-range-min')!
    input.addEventListener('input', () => updateRange(attribute, 'min', input.value))
  })

  wrapper.querySelectorAll<HTMLInputElement>('[data-algolia-range-max]').forEach((input) => {
    const attribute = input.getAttribute('data-algolia-range-max')!
    input.addEventListener('input', () => updateRange(attribute, 'max', input.value))
  })

  // Range sliders (UI layer on top of the number inputs above)
  wrapper.querySelectorAll<HTMLElement>('[data-algolia-range-slider]').forEach((slider) => {
    initRangeSlider(slider, instance).catch((err) =>
      console.warn('[algolia-webflow] range slider init failed', err)
    )
  })

  // Clear buttons
  wrapper.querySelectorAll<HTMLElement>('[data-algolia-clear]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      const attribute = btn.getAttribute('data-algolia-clear')

      if (attribute) {
        // Clear a specific filter group
        instance.filters.get(attribute)?.clear()
        instance.ranges.delete(attribute)
        wrapper.querySelectorAll<HTMLElement>(`[data-algolia-filter="${attribute}"]`)
          .forEach((el) => forceFilterState(el, false))
        wrapper.querySelectorAll<HTMLSelectElement>(`[data-algolia-filter-select="${attribute}"]`)
          .forEach((sel) => { sel.value = '' })
        wrapper.querySelectorAll<HTMLInputElement>(
          `[data-algolia-range-min="${attribute}"], [data-algolia-range-max="${attribute}"]`
        ).forEach((input) => {
          input.value = ''
          input.dispatchEvent(new CustomEvent('algolia-range-reset'))
        })
      } else {
        // Clear all filters, search and sort
        instance.filters.clear()
        instance.ranges.clear()
        instance.query = ''
        instance.sortIndex = ''
        wrapper.querySelectorAll<HTMLElement>('[data-algolia-filter]')
          .forEach((el) => forceFilterState(el, false))
        wrapper.querySelectorAll<HTMLSelectElement>('[data-algolia-filter-select]')
          .forEach((sel) => { sel.value = '' })
        wrapper.querySelectorAll<HTMLInputElement>('[data-algolia-range-min], [data-algolia-range-max]')
          .forEach((input) => {
            input.value = ''
            input.dispatchEvent(new CustomEvent('algolia-range-reset'))
          })
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

  // Load more — append next page instead of replacing
  const loadMoreBtn = wrapper.querySelector<HTMLElement>('[data-algolia-load-more]')
  loadMoreBtn?.addEventListener('click', (e) => {
    e.preventDefault()
    instance.page++
    runSearch(instance, true)
  })

  // Re-render numbered pagination on resize so responsive siblings/boundaries update
  if (wrapper.querySelector('[data-algolia-pages]')) {
    window.addEventListener('resize', debounce(() => search(), 200))
  }

  // Read default checked/selected state from HTML so users can pre-activate filters
  wrapper.querySelectorAll<HTMLElement>('[data-algolia-filter]').forEach((el) => {
    const input = getInput(el)
    if (input?.checked) {
      const attribute = el.getAttribute('data-algolia-filter')!
      const value = el.getAttribute('data-algolia-value')!
      if (!instance.filters.has(attribute)) instance.filters.set(attribute, new Set())
      instance.filters.get(attribute)!.add(value)
      el.setAttribute('data-active', '')
      syncWebflowVisual(el, true)
    }
  })
  wrapper.querySelectorAll<HTMLSelectElement>('[data-algolia-filter-select]').forEach((sel) => {
    if (sel.value) {
      const attribute = sel.getAttribute('data-algolia-filter-select')!
      if (!instance.filters.has(attribute)) instance.filters.set(attribute, new Set())
      instance.filters.get(attribute)!.add(sel.value)
    }
  })

  // URL state overrides HTML defaults (so a shared link wins)
  if (instance.urlState) readUrlState(instance, wrapper)

  // runSearch handles empty mode internally: with no query it clears to a blank
  // idle state (and hides the template) instead of querying. Safe to call always.
  search()
}

// ─── Standalone search box (navbar / global search) ──────────────────────────
//
// Usage: place a plain input with [data-algolia-search-box] anywhere on the page.
// Required attributes on the input:
//   data-algolia-app-id       Algolia app ID
//   data-algolia-api-key      Algolia search-only API key
//   data-algolia-index        Index to query (e.g. "search_all")
//   data-algolia-search-action  "redirect" | "dropdown" | "both"
//
// For redirect/both:
//   data-algolia-search-target  URL of the search results page (default "/search")
//   data-algolia-search-param   URL query param name (default "q")
//
// For dropdown/both: place a sibling container with [data-algolia-autosuggest]
// containing a template child with [data-algolia-autosuggest-template].
// Inside the template, use [data-algolia-bind="field"] as usual.
// Add [data-algolia-autosuggest-link] on an <a> inside the template to auto-set href from "url".

function initSearchBox(input: HTMLInputElement): void {
  const appId = input.getAttribute('data-algolia-app-id')
  const apiKey = input.getAttribute('data-algolia-api-key')
  const indexName = input.getAttribute('data-algolia-index')
  const action = (input.getAttribute('data-algolia-search-action') ?? 'redirect') as 'redirect' | 'dropdown' | 'both'
  const targetUrl = input.getAttribute('data-algolia-search-target') ?? '/search'
  const paramName = input.getAttribute('data-algolia-search-param') ?? 'q'

  if (!appId || !apiKey || !indexName) {
    console.warn('[algolia-webflow] data-algolia-search-box is missing app-id, api-key, or index', input)
    return
  }

  const showDropdown = action === 'dropdown' || action === 'both'
  const doRedirect = action === 'redirect' || action === 'both'

  // Find the autosuggest container — look for a sibling or descendant of the input's parent
  const suggestContainer = input.closest('[data-algolia-autosuggest]') ??
    input.parentElement?.querySelector<HTMLElement>('[data-algolia-autosuggest]') ??
    document.querySelector<HTMLElement>('[data-algolia-autosuggest]')

  const suggestTemplate = suggestContainer?.querySelector<HTMLElement>('[data-algolia-autosuggest-template]')

  if (showDropdown && (!suggestContainer || !suggestTemplate)) {
    console.warn('[algolia-webflow] data-algolia-search-action="dropdown" requires a [data-algolia-autosuggest] container with a [data-algolia-autosuggest-template] child')
  }

  const client = liteClient(appId, apiKey)

  const clearSuggestions = (): void => {
    if (!suggestContainer) return
    suggestContainer.querySelectorAll('[data-algolia-autosuggest-item]').forEach((el) => el.remove())
    suggestContainer.style.display = 'none'
  }

  const renderSuggestions = (hits: Hit[]): void => {
    if (!suggestContainer || !suggestTemplate) return
    suggestContainer.querySelectorAll('[data-algolia-autosuggest-item]').forEach((el) => el.remove())

    if (hits.length === 0) {
      suggestContainer.style.display = 'none'
      return
    }

    suggestTemplate.style.display = 'none'

    hits.forEach((hit) => {
      const item = suggestTemplate.cloneNode(true) as HTMLElement
      item.removeAttribute('data-algolia-autosuggest-template')
      item.setAttribute('data-algolia-autosuggest-item', '')
      item.style.display = ''

      // Bind fields using data-algolia-bind (same convention as the main library)
      item.querySelectorAll<HTMLElement>('[data-algolia-bind]').forEach((el) => {
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

      // Clicking a suggestion fills the input and closes the dropdown.
      // For the standalone box, also redirect to the search page if in redirect/both mode.
      item.addEventListener('mousedown', (e) => {
        e.preventDefault()
        const title = String(hit['title'] ?? '')
        if (title) input.value = title
        clearSuggestions()
        if (doRedirect) {
          window.location.href = `${targetUrl}?${paramName}=${encodeURIComponent(title)}`
        }
      })

      suggestContainer.appendChild(item)
    })

    suggestContainer.style.display = ''
  }

  const querySuggestions = debounce(async (q: string) => {
    if (!q.trim()) {
      clearSuggestions()
      return
    }
    try {
      const response = await client.search({
        requests: [{ indexName, query: q, hitsPerPage: 5 }],
      })
      const result = response.results[0] as SearchResponse<Hit>
      renderSuggestions(result.hits)
    } catch (err) {
      console.warn('[algolia-webflow] autosuggest query failed', err)
    }
  }, 200)

  input.addEventListener('input', () => {
    if (showDropdown) querySuggestions(input.value)
  })

  input.addEventListener('blur', () => {
    // Short delay so mousedown on a suggestion fires first
    setTimeout(clearSuggestions, 150)
  })

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && doRedirect) {
      e.preventDefault()
      clearSuggestions()
      const q = input.value.trim()
      if (q) {
        window.location.href = `${targetUrl}?${paramName}=${encodeURIComponent(q)}`
      }
    }
    if (e.key === 'Escape') {
      clearSuggestions()
      input.blur()
    }
  })

  // Hide dropdown on initial load
  if (suggestContainer) suggestContainer.style.display = 'none'

  // Prevent the surrounding Webflow form from submitting — block both the form
  // submit event and any [data-algolia-submit] button inside the same form.
  const form = input.closest('form')
  if (form) {
    form.addEventListener('submit', (e) => e.preventDefault())

    const submitBtn = form.querySelector<HTMLElement>('[data-algolia-submit]')
    if (submitBtn) {
      submitBtn.addEventListener('click', (e) => {
        e.preventDefault()
        clearSuggestions()
        const q = input.value.trim()
        if (q && doRedirect) {
          window.location.href = `${targetUrl}?${paramName}=${encodeURIComponent(q)}`
        }
      })
    }
  }
}

function init(): void {
  document.querySelectorAll<HTMLElement>('[data-algolia]').forEach(initInstance)
  document.querySelectorAll<HTMLInputElement>('input[data-algolia-search-box]').forEach(initSearchBox)
  initInspector()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
