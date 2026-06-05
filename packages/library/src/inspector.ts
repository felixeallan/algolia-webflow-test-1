// Staging-only diagnostic overlay. Loads when ?algolia-debug is in the URL
// and the host is *.webflow.io / localhost. Never runs in production.

interface Issue {
  level: 'error' | 'warning' | 'info'
  category: string
  message: string
  element?: HTMLElement | null
}

const CYAN = '#00d4ff'
const STAGING_SUFFIXES = ['.webflow.io']
const STAGING_EXACT = ['localhost', '127.0.0.1']

function isStagingHost(): boolean {
  const host = window.location.hostname
  return STAGING_EXACT.includes(host) || STAGING_SUFFIXES.some((s) => host.endsWith(s))
}

function shouldLoadInspector(): boolean {
  if (!isStagingHost()) return false
  return new URLSearchParams(window.location.search).has('algolia-debug')
}

// ─── Audit ────────────────────────────────────────────────────────────────────

function audit(): Issue[] {
  const issues: Issue[] = []
  const wrappers = document.querySelectorAll<HTMLElement>('[data-algolia]')

  if (wrappers.length === 0) {
    issues.push({
      level: 'error',
      category: 'Wrapper',
      message: 'No [data-algolia] wrapper found on the page. Add data-algolia to the container that holds your filters and results.',
    })
    return issues
  }

  wrappers.forEach((wrapper) => {
    // Required wrapper attributes
    ;(['data-algolia-app-id', 'data-algolia-api-key', 'data-algolia-index'] as const).forEach((attr) => {
      if (!wrapper.getAttribute(attr)) {
        issues.push({ level: 'error', category: 'Wrapper', message: `Missing required ${attr} on the wrapper.`, element: wrapper })
      }
    })

    // Templates
    if (!wrapper.querySelector('[data-algolia-list]')) {
      issues.push({ level: 'error', category: 'Templates', message: 'No [data-algolia-list] container found. Add this to the element that should hold rendered results.', element: wrapper })
    }
    if (!wrapper.querySelector('[data-algolia-template]')) {
      issues.push({ level: 'error', category: 'Templates', message: 'No [data-algolia-template] element found. Add this to the element that should be cloned for each result.', element: wrapper })
    }

    // Filters
    wrapper.querySelectorAll<HTMLElement>('[data-algolia-filter]').forEach((el) => {
      if (!el.hasAttribute('data-algolia-value')) {
        const attr = el.getAttribute('data-algolia-filter')
        issues.push({ level: 'error', category: 'Filters', message: `Filter element for "${attr}" is missing data-algolia-value.`, element: el })
      }
    })

    // Radio groups should share a name attribute
    const radioNames = new Map<string, Set<string>>()
    wrapper.querySelectorAll<HTMLElement>('[data-algolia-filter]').forEach((el) => {
      const input = el.querySelector<HTMLInputElement>('input[type="radio"]')
      if (!input) return
      const attr = el.getAttribute('data-algolia-filter')!
      if (!radioNames.has(attr)) radioNames.set(attr, new Set())
      radioNames.get(attr)!.add(input.getAttribute('name') ?? '')
    })
    radioNames.forEach((names, attr) => {
      if (names.size > 1 || names.has('')) {
        issues.push({ level: 'warning', category: 'Filters', message: `Radio buttons for filter "${attr}" don't all share the same name attribute. Browser native mutual-exclusion needs a matching name.` })
      }
    })

    // Range pairs
    const ranges = new Map<string, { min?: HTMLElement; max?: HTMLElement }>()
    wrapper.querySelectorAll<HTMLElement>('[data-algolia-range-min]').forEach((el) => {
      const a = el.getAttribute('data-algolia-range-min')!
      if (!ranges.has(a)) ranges.set(a, {})
      ranges.get(a)!.min = el
    })
    wrapper.querySelectorAll<HTMLElement>('[data-algolia-range-max]').forEach((el) => {
      const a = el.getAttribute('data-algolia-range-max')!
      if (!ranges.has(a)) ranges.set(a, {})
      ranges.get(a)!.max = el
    })
    ranges.forEach((pair, attr) => {
      if (!pair.min) issues.push({ level: 'warning', category: 'Range', message: `Range "${attr}" has a max input but no matching min input.`, element: pair.max })
      if (!pair.max) issues.push({ level: 'warning', category: 'Range', message: `Range "${attr}" has a min input but no matching max input.`, element: pair.min })
    })

    // Range slider
    wrapper.querySelectorAll<HTMLElement>('[data-algolia-range-slider]').forEach((slider) => {
      const attr = slider.getAttribute('data-algolia-range-slider')!
      const hasStaticBounds = slider.hasAttribute('data-algolia-range-slider-min') && slider.hasAttribute('data-algolia-range-slider-max')
      const hasAuto = slider.hasAttribute('data-algolia-range-slider-auto-bounds')
      if (!hasStaticBounds && !hasAuto) {
        issues.push({ level: 'error', category: 'Range Slider', message: `Slider "${attr}" needs both static min/max attributes, OR data-algolia-range-slider-auto-bounds.`, element: slider })
      }
      if (!slider.querySelector('[data-algolia-range-slider-track]')) {
        issues.push({ level: 'error', category: 'Range Slider', message: `Slider "${attr}" missing [data-algolia-range-slider-track] child.`, element: slider })
      }
      if (!slider.querySelector('[data-algolia-range-slider-handle="min"]')) {
        issues.push({ level: 'error', category: 'Range Slider', message: `Slider "${attr}" missing [data-algolia-range-slider-handle="min"] child.`, element: slider })
      }
      if (!slider.querySelector('[data-algolia-range-slider-handle="max"]')) {
        issues.push({ level: 'error', category: 'Range Slider', message: `Slider "${attr}" missing [data-algolia-range-slider-handle="max"] child.`, element: slider })
      }
      if (!wrapper.querySelector(`[data-algolia-range-min="${attr}"]`) || !wrapper.querySelector(`[data-algolia-range-max="${attr}"]`)) {
        issues.push({ level: 'error', category: 'Range Slider', message: `Slider "${attr}" requires matching [data-algolia-range-min="${attr}"] and [data-algolia-range-max="${attr}"] number inputs in the same wrapper.`, element: slider })
      }
    })

    // Pagination
    const hasLoadMore = wrapper.querySelector('[data-algolia-load-more]')
    const pagesEl = wrapper.querySelector<HTMLElement>('[data-algolia-pages]')
    if (hasLoadMore && pagesEl) {
      issues.push({ level: 'warning', category: 'Pagination', message: 'Load More and numbered Pages are both present. Load More appends while Pages replaces — pick one.' })
    }
    if (pagesEl && !pagesEl.querySelector('[data-algolia-page-button-template]')) {
      issues.push({ level: 'error', category: 'Pagination', message: '[data-algolia-pages] container needs a [data-algolia-page-button-template] child.', element: pagesEl })
    }

    // Tags
    const tagsEl = wrapper.querySelector<HTMLElement>('[data-algolia-tags]')
    if (tagsEl && !tagsEl.querySelector('[data-algolia-tag-template]')) {
      issues.push({ level: 'error', category: 'Tags', message: '[data-algolia-tags] container needs a [data-algolia-tag-template] child.', element: tagsEl })
    }
  })

  return issues
}

// ─── Outline mode ─────────────────────────────────────────────────────────────

function tagAlgoliaElements(): void {
  document.querySelectorAll('*').forEach((el) => {
    if (el.hasAttribute('data-algolia-inspector-tagged')) return
    for (const a of el.attributes) {
      if (a.name.startsWith('data-algolia') && !a.name.startsWith('data-algolia-inspector')) {
        el.setAttribute('data-algolia-inspector-tagged', '')
        break
      }
    }
  })
}

function setOutline(on: boolean): void {
  document.body.toggleAttribute('data-algolia-inspector-outline', on)
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function injectStyles(): void {
  const css = `
    [data-algolia-inspector-outline] [data-algolia-inspector-tagged] {
      outline: 2px solid ${CYAN};
      outline-offset: 2px;
    }
    .aw-inspector-badge {
      position: fixed; bottom: 16px; right: 16px; z-index: 2147483646;
      background: #111; color: #fff; border: 1px solid #333; border-radius: 999px;
      padding: 8px 14px; font: 500 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      display: flex; align-items: center; gap: 8px; user-select: none;
    }
    .aw-inspector-badge:hover { background: #1a1a1a; }
    .aw-inspector-dot {
      width: 8px; height: 8px; border-radius: 50%; display: inline-block;
    }
    .aw-inspector-dot[data-level="ok"]    { background: #22c55e; }
    .aw-inspector-dot[data-level="warn"]  { background: #f59e0b; }
    .aw-inspector-dot[data-level="error"] { background: #ef4444; }
    .aw-inspector-count { color: #888; font-weight: 600; }
    .aw-inspector-panel {
      position: fixed; bottom: 64px; right: 16px; width: 400px; max-height: 70vh;
      background: #111; color: #fff; border: 1px solid #333; border-radius: 8px;
      z-index: 2147483647; box-shadow: 0 10px 40px rgba(0,0,0,0.5);
      font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      display: flex; flex-direction: column; overflow: hidden;
    }
    .aw-inspector-panel[hidden] { display: none; }
    .aw-inspector-header {
      padding: 12px 16px; border-bottom: 1px solid #2a2a2a;
      display: flex; align-items: center; justify-content: space-between;
    }
    .aw-inspector-title { font-weight: 600; font-size: 14px; }
    .aw-inspector-close {
      background: none; border: none; color: #888; font-size: 22px;
      line-height: 1; cursor: pointer; padding: 0 4px;
    }
    .aw-inspector-close:hover { color: #fff; }
    .aw-inspector-toolbar {
      padding: 10px 16px; border-bottom: 1px solid #2a2a2a;
      display: flex; align-items: center; gap: 10px; font-size: 12px;
    }
    .aw-inspector-toolbar label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
    .aw-inspector-toolbar input { accent-color: ${CYAN}; }
    .aw-inspector-toolbar .aw-hotkey { margin-left: auto; color: #888; }
    .aw-inspector-toolbar code {
      background: #222; padding: 2px 6px; border-radius: 4px;
      font-size: 11px; color: ${CYAN};
    }
    .aw-inspector-issues { overflow-y: auto; padding: 4px 0 8px; flex: 1; }
    .aw-inspector-section { padding: 4px 16px; }
    .aw-inspector-section-title {
      text-transform: uppercase; letter-spacing: 0.05em;
      font-size: 10px; color: #888; margin: 10px 0 6px;
    }
    .aw-inspector-issue {
      padding: 8px 10px; border-radius: 6px; margin-bottom: 4px;
      background: #1a1a1a; border-left: 3px solid #444;
      display: flex; gap: 8px; align-items: flex-start;
      font-size: 12px; cursor: default;
    }
    .aw-inspector-issue[data-clickable] { cursor: pointer; }
    .aw-inspector-issue[data-clickable]:hover { background: #222; }
    .aw-inspector-issue[data-level="error"]   { border-left-color: #ef4444; }
    .aw-inspector-issue[data-level="warning"] { border-left-color: #f59e0b; }
    .aw-inspector-issue[data-level="info"]    { border-left-color: #3b82f6; }
    .aw-inspector-icon { flex-shrink: 0; font-weight: 700; width: 14px; text-align: center; font-family: monospace; }
    .aw-inspector-issue[data-level="error"]   .aw-inspector-icon { color: #ef4444; }
    .aw-inspector-issue[data-level="warning"] .aw-inspector-icon { color: #f59e0b; }
    .aw-inspector-issue[data-level="info"]    .aw-inspector-icon { color: #3b82f6; }
    .aw-inspector-empty { padding: 24px 16px; text-align: center; color: #888; }
    .aw-inspector-empty strong { color: #22c55e; display: block; font-size: 16px; margin-bottom: 4px; }
    .aw-inspector-footer {
      padding: 8px 16px; border-top: 1px solid #2a2a2a;
      font-size: 11px; color: #888;
    }
    .aw-inspector-tooltip {
      position: fixed; z-index: 2147483647;
      background: #111; color: #fff; padding: 6px 10px;
      border-radius: 6px; border: 1px solid #333;
      font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
      max-width: 320px; pointer-events: none;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .aw-inspector-tooltip[hidden] { display: none; }
    .aw-inspector-tooltip-attr { color: ${CYAN}; }
    .aw-inspector-tooltip-val { color: #fbbf24; }
    .aw-inspector-pulse { outline: 3px solid ${CYAN} !important; outline-offset: 4px; transition: outline-color 0.2s; }
  `
  const style = document.createElement('style')
  style.setAttribute('data-algolia-inspector', '')
  style.textContent = css
  document.head.appendChild(style)
}

// ─── UI ───────────────────────────────────────────────────────────────────────

function renderIssues(container: HTMLElement, issues: Issue[]): void {
  container.innerHTML = ''
  if (issues.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'aw-inspector-empty'
    empty.innerHTML = '<strong>✓ Looks good</strong>No configuration issues detected.'
    container.appendChild(empty)
    return
  }

  const grouped = new Map<string, Issue[]>()
  issues.forEach((iss) => {
    if (!grouped.has(iss.category)) grouped.set(iss.category, [])
    grouped.get(iss.category)!.push(iss)
  })

  grouped.forEach((items, category) => {
    const section = document.createElement('div')
    section.className = 'aw-inspector-section'
    const title = document.createElement('div')
    title.className = 'aw-inspector-section-title'
    title.textContent = category
    section.appendChild(title)
    items.forEach((iss) => {
      const row = document.createElement('div')
      row.className = 'aw-inspector-issue'
      row.setAttribute('data-level', iss.level)
      const icon = document.createElement('span')
      icon.className = 'aw-inspector-icon'
      icon.textContent = iss.level === 'error' ? '!' : iss.level === 'warning' ? '?' : 'i'
      const msg = document.createElement('span')
      msg.textContent = iss.message
      row.append(icon, msg)
      if (iss.element) {
        row.setAttribute('data-clickable', '')
        row.addEventListener('click', () => locateElement(iss.element!))
      }
      section.appendChild(row)
    })
    container.appendChild(section)
  })
}

function locateElement(el: HTMLElement): void {
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('aw-inspector-pulse')
  setTimeout(() => el.classList.remove('aw-inspector-pulse'), 1600)
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function buildTooltip(): HTMLElement {
  const tip = document.createElement('div')
  tip.className = 'aw-inspector-tooltip'
  tip.hidden = true
  document.body.appendChild(tip)

  document.addEventListener('mousemove', (e) => {
    if (!document.body.hasAttribute('data-algolia-inspector-outline')) {
      tip.hidden = true
      return
    }
    const target = (e.target as Element | null)?.closest('[data-algolia-inspector-tagged]') as HTMLElement | null
    if (!target) {
      tip.hidden = true
      return
    }
    const parts: string[] = []
    for (const a of target.attributes) {
      if (a.name.startsWith('data-algolia') && !a.name.startsWith('data-algolia-inspector')) {
        parts.push(
          a.value
            ? `<span class="aw-inspector-tooltip-attr">${a.name}</span>=<span class="aw-inspector-tooltip-val">"${a.value}"</span>`
            : `<span class="aw-inspector-tooltip-attr">${a.name}</span>`
        )
      }
    }
    if (parts.length === 0) {
      tip.hidden = true
      return
    }
    tip.innerHTML = parts.join('<br>')
    tip.style.whiteSpace = 'normal'
    tip.hidden = false
    const margin = 12
    const x = Math.min(e.clientX + margin, window.innerWidth - tip.offsetWidth - margin)
    const y = Math.min(e.clientY + margin, window.innerHeight - tip.offsetHeight - margin)
    tip.style.left = x + 'px'
    tip.style.top = y + 'px'
  })

  return tip
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export function initInspector(): void {
  if (!shouldLoadInspector()) return
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start)
  } else {
    start()
  }
}

function start(): void {
  injectStyles()
  tagAlgoliaElements()
  buildTooltip()

  // Outline ON by default — that's the immediate visual cue that the inspector loaded.
  let outlineOn = true
  setOutline(true)

  const issues = audit()

  // Badge
  const badge = document.createElement('div')
  badge.className = 'aw-inspector-badge'
  const dot = document.createElement('span')
  dot.className = 'aw-inspector-dot'
  const errors = issues.filter((i) => i.level === 'error').length
  const warnings = issues.filter((i) => i.level === 'warning').length
  dot.setAttribute('data-level', errors ? 'error' : warnings ? 'warn' : 'ok')
  const label = document.createElement('span')
  label.textContent = 'Algolia Inspector'
  const count = document.createElement('span')
  count.className = 'aw-inspector-count'
  count.textContent = errors + warnings > 0 ? String(errors + warnings) : '✓'
  badge.append(dot, label, count)
  document.body.appendChild(badge)

  // Panel
  const panel = document.createElement('div')
  panel.className = 'aw-inspector-panel'
  panel.hidden = true
  panel.innerHTML = `
    <div class="aw-inspector-header">
      <div class="aw-inspector-title">Algolia Inspector</div>
      <button class="aw-inspector-close" aria-label="Close">×</button>
    </div>
    <div class="aw-inspector-toolbar">
      <label>
        <input type="checkbox" class="aw-inspector-outline-toggle" checked>
        <span>Outline data-algolia elements</span>
      </label>
      <span class="aw-hotkey">Hotkey: <code>Shift + ?</code></span>
    </div>
    <div class="aw-inspector-issues"></div>
    <div class="aw-inspector-footer">Click an issue to locate the offending element. Re-run by refreshing the page.</div>
  `
  const issuesEl = panel.querySelector<HTMLElement>('.aw-inspector-issues')!
  renderIssues(issuesEl, issues)

  const outlineToggle = panel.querySelector<HTMLInputElement>('.aw-inspector-outline-toggle')!
  const applyOutline = (on: boolean): void => {
    outlineOn = on
    setOutline(on)
    outlineToggle.checked = on
  }
  outlineToggle.addEventListener('change', () => applyOutline(outlineToggle.checked))
  panel.querySelector<HTMLButtonElement>('.aw-inspector-close')!.addEventListener('click', () => {
    panel.hidden = true
  })

  document.body.appendChild(panel)

  badge.addEventListener('click', () => {
    panel.hidden = !panel.hidden
  })

  // Hotkey: Shift+? toggles outline
  document.addEventListener('keydown', (e) => {
    if (e.key === '?' && e.shiftKey) {
      // Don't trigger when typing into form fields
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      applyOutline(!outlineOn)
    }
  })

  // Keep newly-rendered result items tagged so outline mode covers them too
  const observer = new MutationObserver(() => tagAlgoliaElements())
  document.querySelectorAll('[data-algolia]').forEach((wrap) => {
    observer.observe(wrap, { childList: true, subtree: true })
  })
}
