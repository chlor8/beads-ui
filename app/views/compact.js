import { html, render } from 'lit-html';
import { createListSelectors } from '../data/list-selectors.js';
import { cmpClosedDesc, cmpPriorityThenCreated } from '../data/sort.js';
import { typeLabel } from '../utils/issue-type.js';
import { debug } from '../utils/logging.js';
import { emojiForPriority } from '../utils/priority-badge.js';
import { priority_levels } from '../utils/priority.js';
import { statusLabel } from '../utils/status.js';

/**
 * @typedef {{ id: string, title?: string, status?: 'open'|'in_progress'|'closed', priority?: number, issue_type?: string, assignee?: string, labels?: string[], dependency_count?: number, dependent_count?: number, closed_at?: number }} Issue
 */

/**
 * @typedef {{ issue: Issue, depth: number, hasChildren: boolean }} Entry
 */

const STATUS_CHIPS = [
  ['all', 'All'],
  ['open', 'Open'],
  ['in_progress', 'In progress'],
  ['closed', 'Closed'],
  ['ready', 'Ready']
];

const TREE_KEY = 'beads-ui.compact.tree';

/**
 * Status glyphs mirror the `bd` CLI legend (○ open, ◐ in_progress, ✓ closed)
 * so the compact view reads like terminal `bd list` output.
 *
 * @param {string | null | undefined} status
 * @returns {string}
 */
function statusGlyph(status) {
  switch ((status || '').toString()) {
    case 'in_progress':
      return '◐';
    case 'closed':
      return '✓';
    case 'deferred':
      return '❄';
    case 'blocked':
      return '●';
    default:
      return '○';
  }
}

/**
 * Parent id by trimming the last dotted segment (bd encodes hierarchy in ids,
 * e.g. `epic.2.1` → parent `epic.2`). Returns null for flat/top-level ids.
 *
 * @param {string} id
 * @returns {string | null}
 */
function dotParent(id) {
  const i = id.lastIndexOf('.');
  return i > 0 ? id.slice(0, i) : null;
}

/**
 * Create the Compact (bd-list-style) view. Renders dense one-line rows from
 * the SAME `tab:issues` subscription store the Issues list uses, so it issues
 * no additional `bd` calls. Selecting a row opens the existing detail dialog.
 *
 * @param {HTMLElement} mount_element - Element to render into.
 * @param {(id: string) => void} navigateFn - Open an issue by id (router.gotoIssue).
 * @param {{ getState: () => any, setState: (patch: any) => void }} [store] - App state store.
 * @param {{ snapshotFor?: (client_id: string) => any[], subscribe?: (fn: () => void) => () => void }} [issue_stores]
 * @returns {{ load: () => Promise<void>, destroy: () => void }}
 */
export function createCompactView(
  mount_element,
  navigateFn,
  store,
  issue_stores = undefined
) {
  const log = debug('views:compact');
  const selectors = issue_stores ? createListSelectors(issue_stores) : null;

  /** @type {Issue[]} */
  let issues_cache = [];
  /** @type {string} */
  let search_text = store ? store.getState().filters?.search || '' : '';
  /** @type {string} */
  let status_filter = store ? store.getState().filters?.status || 'all' : 'all';
  /** @type {string | null} */
  let label_filter = null;
  /** @type {string | null} */
  let selected_id = store ? store.getState().selected_id : null;
  /** @type {boolean} */
  let tree_mode = readTreePref();
  /** @type {Set<string>} */
  const collapsed = new Set();
  /** @type {null | (() => void)} */
  let unsubscribe = null;

  /**
   * Tree grouping is the default; an explicit '0' in storage opts out.
   *
   * @returns {boolean}
   */
  function readTreePref() {
    try {
      return window.localStorage.getItem(TREE_KEY) !== '0';
    } catch {
      return true;
    }
  }

  /**
   * Apply status / label / search filters to the cached issues.
   *
   * @returns {Issue[]}
   */
  function computeFiltered() {
    let rows = issues_cache;
    // Concrete-status narrowing (the subscription also narrows when a store is
    // wired; this keeps the client honest for the all-issues snapshot too).
    if (
      status_filter === 'open' ||
      status_filter === 'in_progress' ||
      status_filter === 'closed'
    ) {
      rows = rows.filter((it) => String(it.status || '') === status_filter);
    }
    if (label_filter) {
      const lf = label_filter;
      rows = rows.filter((it) =>
        Array.isArray(it.labels) ? it.labels.includes(lf) : false
      );
    }
    if (search_text) {
      const needle = search_text.toLowerCase();
      rows = rows.filter((it) => {
        const a = String(it.id).toLowerCase();
        const b = String(it.title || '').toLowerCase();
        return a.includes(needle) || b.includes(needle);
      });
    }
    if (status_filter === 'closed' && !tree_mode) {
      rows = rows.slice().sort(cmpClosedDesc);
    }
    return rows;
  }

  /**
   * Ordered, depth-tagged entries honoring tree mode + collapse state.
   *
   * @returns {Entry[]}
   */
  function computeEntries() {
    const rows = computeFiltered();
    if (!tree_mode) {
      return rows.map((issue) => ({ issue, depth: 0, hasChildren: false }));
    }
    const byId = new Map(rows.map((it) => [String(it.id), it]));
    /** @param {string} id */
    const presentParent = (id) => {
      let p = dotParent(id);
      while (p) {
        if (byId.has(p)) return p;
        p = dotParent(p);
      }
      return null;
    };
    /** @type {Map<string, Issue[]>} */
    const childrenOf = new Map();
    /** @type {Issue[]} */
    const roots = [];
    for (const it of rows) {
      const pid = presentParent(String(it.id));
      if (pid) {
        if (!childrenOf.has(pid)) childrenOf.set(pid, []);
        /** @type {Issue[]} */ (childrenOf.get(pid)).push(it);
      } else {
        roots.push(it);
      }
    }
    /** @param {Issue[]} arr */
    const sortSib = (arr) => arr.slice().sort(cmpPriorityThenCreated);
    /** @type {Entry[]} */
    const out = [];
    /**
     * @param {Issue} it
     * @param {number} depth
     */
    const walk = (it, depth) => {
      const kids = childrenOf.get(String(it.id)) || [];
      out.push({ issue: it, depth, hasChildren: kids.length > 0 });
      if (kids.length > 0 && !collapsed.has(String(it.id))) {
        for (const k of sortSib(kids)) walk(k, depth + 1);
      }
    };
    for (const r of sortSib(roots)) walk(r, 0);
    return out;
  }

  /**
   * @param {Event} ev
   */
  const onSearchInput = (ev) => {
    const input = /** @type {HTMLInputElement} */ (ev.currentTarget);
    search_text = input.value;
    if (store) {
      store.setState({ filters: { search: search_text } });
    }
    doRender();
  };

  /**
   * @param {string} status
   */
  function setStatus(status) {
    status_filter = status;
    // Driving the shared filter re-points the tab:issues subscription via the
    // existing machinery in main.js (ready→ready-issues, closed→closed, …).
    if (store) {
      store.setState({ filters: { status } });
    }
    doRender();
  }

  /**
   * @param {string | null} label
   */
  function setLabel(label) {
    label_filter = label;
    doRender();
  }

  function toggleTree() {
    tree_mode = !tree_mode;
    try {
      window.localStorage.setItem(TREE_KEY, tree_mode ? '1' : '0');
    } catch {
      // ignore
    }
    doRender();
  }

  /**
   * @param {string} id
   */
  function toggleCollapse(id) {
    if (collapsed.has(id)) {
      collapsed.delete(id);
    } else {
      collapsed.add(id);
    }
    doRender();
  }

  /**
   * @param {string} id
   */
  function open(id) {
    selected_id = id;
    navigateFn(id);
  }

  /**
   * @param {Entry} entry
   */
  function row(entry) {
    const it = entry.issue;
    const id = String(it.id);
    const is_selected = id === selected_id;
    const prio = typeof it.priority === 'number' ? it.priority : 2;
    const prio_label = priority_levels[Math.max(0, Math.min(4, prio))] || '';
    const closed = String(it.status || '') === 'closed';
    const indent = 12 + entry.depth * 16;
    const dep_count = Number(it.dependency_count) || 0;
    const dependent_count = Number(it.dependent_count) || 0;
    const labels = Array.isArray(it.labels) ? it.labels : [];
    const can_collapse = tree_mode && entry.hasChildren;
    return html`
      <button
        type="button"
        class="cmp-row${is_selected ? ' is-selected' : ''}${closed
          ? ' is-closed'
          : ''}"
        style=${`padding-left:${indent}px`}
        data-id=${id}
        role="row"
        aria-selected=${is_selected ? 'true' : 'false'}
        @click=${() => open(id)}
      >
        ${can_collapse
          ? html`<span
              class="cmp-caret"
              role="button"
              title=${collapsed.has(id) ? 'Expand' : 'Collapse'}
              @click=${(/** @type {Event} */ e) => {
                e.stopPropagation();
                toggleCollapse(id);
              }}
              >${collapsed.has(id) ? '▸' : '▾'}</span
            >`
          : tree_mode
            ? html`<span class="cmp-caret cmp-caret--leaf"></span>`
            : ''}
        <span
          class="cmp-glyph cmp-glyph--${String(it.status || 'open')}"
          title=${statusLabel(it.status)}
          >${statusGlyph(it.status)}</span
        >
        <span class="cmp-prio" title=${'Priority: ' + prio_label}
          >${emojiForPriority(prio)}</span
        >
        <span class="cmp-id mono">${id}</span>
        <span class="cmp-title">${it.title || '(untitled)'}</span>
        ${labels.map(
          (l) =>
            html`<span
              class="cmp-label"
              title=${'Filter by ' + l}
              @click=${(/** @type {Event} */ e) => {
                e.stopPropagation();
                setLabel(l);
              }}
              >${l}</span
            >`
        )}
        ${dep_count > 0
          ? html`<span class="cmp-dep" title=${`Depends on ${dep_count}`}
              >↑${dep_count}</span
            >`
          : ''}
        ${dependent_count > 0
          ? html`<span
              class="cmp-dep cmp-dep--out"
              title=${`${dependent_count} depend on this`}
              >↓${dependent_count}</span
            >`
          : ''}
        <span class="cmp-type">${typeLabel(it.issue_type) || ''}</span>
        <span class="cmp-assignee">${it.assignee || ''}</span>
      </button>
    `;
  }

  function template() {
    const entries = computeEntries();
    return html`
      <div class="panel__header cmp-header">
        <div class="cmp-chips" role="tablist">
          ${STATUS_CHIPS.map(
            ([value, label]) =>
              html`<button
                type="button"
                class="cmp-chip${status_filter === value ? ' is-active' : ''}"
                aria-pressed=${status_filter === value ? 'true' : 'false'}
                @click=${() => setStatus(value)}
              >
                ${label}
              </button>`
          )}
        </div>
        <input
          type="search"
          placeholder="Filter…"
          @input=${onSearchInput}
          .value=${search_text}
        />
        <button
          type="button"
          class="cmp-tree-toggle${tree_mode ? ' is-active' : ''}"
          title="Group by epic (tree)"
          aria-pressed=${tree_mode ? 'true' : 'false'}
          @click=${toggleTree}
        >
          Tree
        </button>
        <span class="cmp-count muted"
          >${entries.length} row${entries.length === 1 ? '' : 's'}</span
        >
      </div>
      ${label_filter
        ? html`<div class="cmp-subbar">
            <span class="cmp-label is-active">${label_filter}</span>
            <button
              type="button"
              class="cmp-clear"
              @click=${() => setLabel(null)}
            >
              ✕ clear
            </button>
          </div>`
        : ''}
      <div class="panel__body cmp-body" id="compact-root" role="grid">
        ${entries.length === 0
          ? html`<div class="muted" style="padding:10px 12px;">No issues</div>`
          : entries.map((e) => row(e))}
      </div>
    `;
  }

  function doRender() {
    render(template(), mount_element);
  }

  /**
   * Move keyboard selection by a delta within the currently visible entries
   * and focus the row button (highlight follows focus + selected_id).
   *
   * @param {number} delta
   */
  function moveSelection(delta) {
    const entries = computeEntries();
    if (entries.length === 0) {
      return;
    }
    let idx = entries.findIndex((e) => String(e.issue.id) === selected_id);
    if (idx < 0) {
      idx = delta > 0 ? -1 : entries.length;
    }
    const next = Math.max(0, Math.min(entries.length - 1, idx + delta));
    selected_id = String(entries[next].issue.id);
    doRender();
    // Focus by row index — avoids selector-escaping issue ids (dots/colons).
    const el = /** @type {HTMLElement|null} */ (
      mount_element.querySelectorAll('.cmp-row')[next] || null
    );
    if (el && typeof el.focus === 'function') {
      el.focus();
      if (typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  /**
   * @param {KeyboardEvent} ev
   */
  function onKeydown(ev) {
    const tgt = /** @type {HTMLElement} */ (ev.target);
    const tag = tgt && tgt.tagName ? tgt.tagName.toLowerCase() : '';
    const in_search = tag === 'input' || tag === 'textarea';
    const key = ev.key;
    if (!in_search && (key === 'j' || key === 'ArrowDown')) {
      ev.preventDefault();
      moveSelection(1);
    } else if (!in_search && (key === 'k' || key === 'ArrowUp')) {
      ev.preventDefault();
      moveSelection(-1);
    } else if (key === 'Enter' && selected_id) {
      ev.preventDefault();
      open(selected_id);
    }
  }

  mount_element.tabIndex = 0;
  mount_element.addEventListener('keydown', onKeydown);
  doRender();

  /**
   * Pull issues from the shared issues store and re-render.
   */
  async function load() {
    log('load');
    if (store) {
      const s = store.getState();
      selected_id = s.selected_id;
      search_text = s.filters?.search || search_text;
      status_filter = s.filters?.status || status_filter;
    }
    try {
      issues_cache = selectors
        ? /** @type {Issue[]} */ (selectors.selectIssuesFor('tab:issues'))
        : [];
    } catch (err) {
      log('load failed: %o', err);
      issues_cache = [];
    }
    doRender();
  }

  // Re-render live as the shared store receives push updates
  if (selectors) {
    unsubscribe = selectors.subscribe(() => {
      void load();
    });
  }

  return {
    load,
    destroy() {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      mount_element.removeEventListener('keydown', onKeydown);
      render(html``, mount_element);
    }
  };
}
