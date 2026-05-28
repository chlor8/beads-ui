import { html, render, svg } from 'lit-html';
import { createListSelectors } from '../data/list-selectors.js';

/**
 * @typedef {{ id: string, title?: string, status?: string, priority?: number, issue_type?: string, dependencies?: string[], dependency_count?: number, dependent_count?: number }} DepIssue
 */

const NODE_W = 180;
const NODE_H = 48;
const H_GAP = 60;
const V_GAP = 80;

/**
 * Build layer map via longest-path layering (sources at layer 0).
 * Edge direction: A depends on B means B → A (B is prerequisite).
 *
 * @param {DepIssue[]} issues
 * @returns {{ layers: Map<string, number>, max_layer: number }}
 */
function computeLayers(issues) {
  /** @type {Map<string, string[]>} deps of each node (nodes it depends on) */
  const deps_of = new Map();
  /** @type {Set<string>} all ids in graph */
  const all_ids = new Set();

  for (const it of issues) {
    const id = String(it.id || '');
    if (!id) continue;
    all_ids.add(id);
    const d = Array.isArray(it.dependencies) ? it.dependencies.map(String) : [];
    deps_of.set(id, d);
  }

  /** @type {Map<string, number>} */
  const layers = new Map();
  /** @type {Set<string>} */
  const visiting = new Set();

  /**
   * @param {string} id
   * @returns {number}
   */
  function depth(id) {
    if (layers.has(id)) return /** @type {number} */ (layers.get(id));
    if (visiting.has(id)) return 0; // cycle guard
    visiting.add(id);
    const prereqs = (deps_of.get(id) || []).filter((d) => all_ids.has(d));
    const d = prereqs.length === 0 ? 0 : Math.max(...prereqs.map(depth)) + 1;
    visiting.delete(id);
    layers.set(id, d);
    return d;
  }

  for (const id of all_ids) {
    depth(id);
  }

  let max_layer = 0;
  for (const v of layers.values()) {
    if (v > max_layer) max_layer = v;
  }

  return { layers, max_layer };
}

/**
 * Assign x/y positions. Returns Map<id, {x, y}>.
 *
 * @param {DepIssue[]} issues
 * @param {Map<string, number>} layers
 * @param {number} max_layer
 * @returns {Map<string, {x: number, y: number}>}
 */
function assignPositions(issues, layers, max_layer) {
  /** @type {Map<number, string[]>} */
  const by_layer = new Map();
  for (let i = 0; i <= max_layer; i++) {
    by_layer.set(i, []);
  }
  for (const it of issues) {
    const id = String(it.id || '');
    if (!id) continue;
    const layer = layers.get(id) ?? 0;
    by_layer.get(layer)?.push(id);
  }

  const positions = new Map();
  for (let layer = 0; layer <= max_layer; layer++) {
    const ids = by_layer.get(layer) || [];
    const total_w = ids.length * NODE_W + (ids.length - 1) * H_GAP;
    const start_x = -total_w / 2;
    for (let i = 0; i < ids.length; i++) {
      positions.set(ids[i], {
        x: start_x + i * (NODE_W + H_GAP),
        y: layer * (NODE_H + V_GAP)
      });
    }
  }
  return positions;
}

const STATUS_COLOR = {
  open: '#6b7280',
  in_progress: '#3b82f6',
  closed: '#10b981',
  blocked: '#ef4444',
  deferred: '#8b5cf6'
};

/**
 * @param {string | undefined} status
 * @returns {string}
 */
function nodeColor(status) {
  return STATUS_COLOR[/** @type {keyof typeof STATUS_COLOR} */ (status || 'open')] || '#6b7280';
}

/**
 * Deps view: full-page SVG DAG of issues with dep relationships.
 *
 * @param {HTMLElement} mount_element
 * @param {(id: string) => void} goto_issue
 * @param {{ snapshotFor?: (client_id: string) => any[], subscribe?: (fn: () => void) => () => void }} [issue_stores]
 */
export function createDepsView(mount_element, goto_issue, issue_stores = undefined) {
  const selectors = issue_stores ? createListSelectors(issue_stores) : null;

  /** @type {number} */
  let pan_x = 0;
  /** @type {number} */
  let pan_y = 40;
  /** @type {number} */
  let zoom = 1;
  /** @type {boolean} */
  let dragging = false;
  /** @type {number} */
  let drag_start_x = 0;
  /** @type {number} */
  let drag_start_y = 0;
  /** @type {number} */
  let pan_start_x = 0;
  /** @type {number} */
  let pan_start_y = 0;

  if (selectors) {
    selectors.subscribe(() => doRender());
  }

  function doRender() {
    render(template(), mount_element);
  }

  function template() {
    const all_issues = /** @type {DepIssue[]} */ (
      issue_stores?.snapshotFor ? issue_stores.snapshotFor('tab:deps') : []
    );
    // Only show issues involved in dep relationships
    const connected = all_issues.filter(
      (it) =>
        (it.dependency_count || 0) > 0 || (it.dependent_count || 0) > 0
    );

    if (connected.length === 0) {
      return html`<div class="panel__header muted" style="padding:24px">
        No dependency relationships found.
      </div>`;
    }

    const { layers, max_layer } = computeLayers(connected);
    const positions = assignPositions(connected, layers, max_layer);

    // Build edges: for each issue, draw edges TO each of its dependencies
    /** @type {Array<{from: string, to: string}>} */
    const edges = [];
    for (const it of connected) {
      const id = String(it.id || '');
      if (!id) continue;
      for (const dep_id of Array.isArray(it.dependencies) ? it.dependencies : []) {
        const dep = String(dep_id);
        if (positions.has(dep)) {
          edges.push({ from: dep, to: id });
        }
      }
    }

    const issue_map = new Map(connected.map((it) => [String(it.id || ''), it]));
    const container_w = mount_element.clientWidth || 800;
    const container_h = mount_element.clientHeight || 600;
    const cx = container_w / 2;
    const cy = container_h / 2;

    return html`
      <div
        class="deps-container"
        style="width:100%;height:100%;overflow:hidden;position:relative;cursor:${dragging ? 'grabbing' : 'grab'}"
        @mousedown=${onMouseDown}
        @mousemove=${onMouseMove}
        @mouseup=${onMouseUp}
        @mouseleave=${onMouseUp}
        @wheel=${onWheel}
      >
        <svg
          width=${container_w}
          height=${container_h}
          style="display:block;user-select:none"
        >
          <defs>
            <marker
              id="arrow"
              markerWidth="8"
              markerHeight="8"
              refX="6"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L0,6 L8,3 z" fill="#94a3b8" />
            </marker>
          </defs>
          <g transform="translate(${cx + pan_x},${cy + pan_y}) scale(${zoom})">
            ${edges.map((e) => {
              const fp = positions.get(e.from);
              const tp = positions.get(e.to);
              if (!fp || !tp) return svg``;
              const x1 = fp.x + NODE_W / 2;
              const y1 = fp.y + NODE_H;
              const x2 = tp.x + NODE_W / 2;
              const y2 = tp.y;
              const cy_ctrl = (y1 + y2) / 2;
              return svg`
                <path
                  d="M${x1},${y1} C${x1},${cy_ctrl} ${x2},${cy_ctrl} ${x2},${y2}"
                  stroke="#94a3b8"
                  stroke-width="1.5"
                  fill="none"
                  marker-end="url(#arrow)"
                />
              `;
            })}
            ${connected.map((it) => {
              const id = String(it.id || '');
              const pos = positions.get(id);
              if (!pos) return svg``;
              const color = nodeColor(it.status);
              const title = it.title || id;
              const short_title = title.length > 22 ? title.slice(0, 20) + '…' : title;
              const short_id = id.length > 14 ? id.slice(-10) : id;
              return svg`
                <g
                  transform="translate(${pos.x},${pos.y})"
                  class="dep-node"
                  style="cursor:pointer"
                  @click=${(/** @type {MouseEvent} */ e) => { e.stopPropagation(); goto_issue(id); }}
                >
                  <rect
                    width=${NODE_W}
                    height=${NODE_H}
                    rx="6"
                    ry="6"
                    fill="var(--bg-secondary, #1e2030)"
                    stroke=${color}
                    stroke-width="2"
                  />
                  <text
                    x="10"
                    y="18"
                    font-size="10"
                    fill=${color}
                    font-family="monospace"
                  >${short_id}</text>
                  <text
                    x="10"
                    y="34"
                    font-size="11"
                    fill="var(--text-primary, #cdd6f4)"
                    font-family="system-ui, sans-serif"
                  >${short_title}</text>
                </g>
              `;
            })}
          </g>
        </svg>
        <div style="position:absolute;bottom:8px;right:12px;font-size:11px;opacity:0.5">
          ${connected.length} issues · scroll to zoom · drag to pan
        </div>
      </div>
    `;
  }

  /** @param {MouseEvent} e */
  function onMouseDown(e) {
    if (e.button !== 0) return;
    dragging = true;
    drag_start_x = e.clientX;
    drag_start_y = e.clientY;
    pan_start_x = pan_x;
    pan_start_y = pan_y;
  }

  /** @param {MouseEvent} e */
  function onMouseMove(e) {
    if (!dragging) return;
    pan_x = pan_start_x + (e.clientX - drag_start_x);
    pan_y = pan_start_y + (e.clientY - drag_start_y);
    doRender();
  }

  /** @param {MouseEvent} _e */
  function onMouseUp(_e) {
    dragging = false;
  }

  /** @param {WheelEvent} e */
  function onWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    zoom = Math.max(0.2, Math.min(3, zoom * delta));
    doRender();
  }

  return {
    load() {
      doRender();
    }
  };
}
