import { html, render } from 'lit-html';
import { createListSelectors } from '../data/list-selectors.js';
import { typeLabel } from '../utils/issue-type.js';
import { debug } from '../utils/logging.js';
import { emojiForPriority } from '../utils/priority-badge.js';
import { priority_levels } from '../utils/priority.js';
import { statusLabel } from '../utils/status.js';

/**
 * @typedef {{ id: string, title?: string, status?: 'open'|'in_progress'|'closed', priority?: number, issue_type?: string, assignee?: string }} Issue
 */

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
    default:
      return '○';
  }
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
  /** @type {string | null} */
  let selected_id = store ? store.getState().selected_id : null;
  /** @type {null | (() => void)} */
  let unsubscribe = null;

  /**
   * Apply the client-side search filter to the cached issues.
   *
   * @returns {Issue[]}
   */
  function filtered() {
    if (!search_text) {
      return issues_cache;
    }
    const needle = search_text.toLowerCase();
    return issues_cache.filter((it) => {
      const a = String(it.id).toLowerCase();
      const b = String(it.title || '').toLowerCase();
      return a.includes(needle) || b.includes(needle);
    });
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
   * @param {string} id
   */
  function open(id) {
    selected_id = id;
    navigateFn(id);
  }

  /**
   * @param {Issue} it
   */
  function row(it) {
    const id = String(it.id);
    const is_selected = id === selected_id;
    const prio = typeof it.priority === 'number' ? it.priority : 2;
    const prio_label = priority_levels[Math.max(0, Math.min(4, prio))] || '';
    const closed = String(it.status || '') === 'closed';
    return html`
      <button
        type="button"
        class="cmp-row${is_selected ? ' is-selected' : ''}${closed
          ? ' is-closed'
          : ''}"
        data-id=${id}
        role="row"
        aria-selected=${is_selected ? 'true' : 'false'}
        @click=${() => open(id)}
      >
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
        <span class="cmp-type">${typeLabel(it.issue_type) || ''}</span>
        <span class="cmp-assignee">${it.assignee || ''}</span>
      </button>
    `;
  }

  function template() {
    const rows = filtered();
    return html`
      <div class="panel__header cmp-header">
        <input
          type="search"
          placeholder="Filter…"
          @input=${onSearchInput}
          .value=${search_text}
        />
        <span class="cmp-count muted"
          >${rows.length} issue${rows.length === 1 ? '' : 's'}</span
        >
      </div>
      <div class="panel__body cmp-body" id="compact-root" role="grid">
        ${rows.length === 0
          ? html`<div class="muted" style="padding:10px 12px;">No issues</div>`
          : rows.map((it) => row(it))}
      </div>
    `;
  }

  function doRender() {
    render(template(), mount_element);
  }

  /**
   * Move keyboard selection by a delta within the current filtered rows and
   * focus the row button (visual highlight follows focus + selected_id).
   *
   * @param {number} delta
   */
  function moveSelection(delta) {
    const rows = filtered();
    if (rows.length === 0) {
      return;
    }
    let idx = rows.findIndex((it) => String(it.id) === selected_id);
    if (idx < 0) {
      idx = delta > 0 ? -1 : rows.length;
    }
    const next = Math.max(0, Math.min(rows.length - 1, idx + delta));
    selected_id = String(rows[next].id);
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
      selected_id = store.getState().selected_id;
      search_text = store.getState().filters?.search || search_text;
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
