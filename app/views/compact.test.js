import { describe, expect, test } from 'vitest';
import { createSubscriptionIssueStore } from '../data/subscription-issue-store.js';
import { createCompactView } from './compact.js';

function createTestIssueStores() {
  /** @type {Map<string, any>} */
  const stores = new Map();
  /** @type {Set<() => void>} */
  const listeners = new Set();
  /**
   * @param {string} id
   * @returns {any}
   */
  function getStore(id) {
    let s = stores.get(id);
    if (!s) {
      s = createSubscriptionIssueStore(id);
      stores.set(id, s);
      s.subscribe(() => {
        for (const fn of Array.from(listeners)) {
          try {
            fn();
          } catch {
            /* ignore */
          }
        }
      });
    }
    return s;
  }
  return {
    getStore,
    /** @param {string} id */
    snapshotFor(id) {
      return getStore(id).snapshot().slice();
    },
    /** @param {() => void} fn */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
}

/** @param {ReturnType<typeof createTestIssueStores>} issueStores */
function seedIssues(issueStores) {
  const base = new Date('2025-10-20T00:00:00.000Z').getTime();
  issueStores.getStore('tab:issues').applyPush({
    type: 'snapshot',
    id: 'tab:issues',
    revision: 1,
    issues: [
      {
        id: 'A-2',
        title: 'second',
        status: 'open',
        priority: 1,
        issue_type: 'task',
        labels: ['project:beads-ui'],
        dependency_count: 1,
        created_at: base + 2000,
        updated_at: base + 2000
      },
      {
        id: 'A-1',
        title: 'first critical',
        status: 'in_progress',
        priority: 0,
        issue_type: 'bug',
        labels: ['project:beads-ui', 'urgent'],
        dependent_count: 2,
        created_at: base + 1000,
        updated_at: base + 1000
      },
      {
        id: 'A-3',
        title: 'third done',
        status: 'closed',
        priority: 2,
        issue_type: 'feature',
        labels: ['project:other'],
        created_at: base + 3000,
        updated_at: base + 3000,
        closed_at: base + 4000
      }
    ]
  });
}

/** @param {ReturnType<typeof createTestIssueStores>} issueStores */
function seedTree(issueStores) {
  const base = new Date('2025-10-20T00:00:00.000Z').getTime();
  issueStores.getStore('tab:issues').applyPush({
    type: 'snapshot',
    id: 'tab:issues',
    revision: 1,
    issues: [
      {
        id: 'E-1.2',
        title: 'child two',
        status: 'open',
        priority: 1,
        issue_type: 'task',
        created_at: base + 3000,
        updated_at: base + 3000
      },
      {
        id: 'E-1',
        title: 'the epic',
        status: 'open',
        priority: 0,
        issue_type: 'epic',
        created_at: base + 1000,
        updated_at: base + 1000
      },
      {
        id: 'E-1.1',
        title: 'child one',
        status: 'open',
        priority: 0,
        issue_type: 'task',
        created_at: base + 2000,
        updated_at: base + 2000
      }
    ]
  });
}

describe('views/compact', () => {
  test('renders dense one-line rows sorted by priority with a count', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const issueStores = createTestIssueStores();
    seedIssues(issueStores);

    const view = createCompactView(mount, () => {}, undefined, issueStores);
    await view.load();

    const ids = Array.from(mount.querySelectorAll('.cmp-row .cmp-id')).map(
      (el) => el.textContent?.trim()
    );
    // priority asc (0,1,2)
    expect(ids).toEqual(['A-1', 'A-2', 'A-3']);

    // Status glyphs reflect the bd legend
    const glyphs = Array.from(
      mount.querySelectorAll('.cmp-row .cmp-glyph')
    ).map((el) => el.textContent?.trim());
    expect(glyphs).toEqual(['◐', '○', '✓']);

    const count = mount.querySelector('.cmp-count')?.textContent?.trim();
    expect(count).toBe('3 rows');
  });

  test('click navigates to the issue id', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const issueStores = createTestIssueStores();
    seedIssues(issueStores);

    /** @type {string[]} */
    const navigations = [];
    const view = createCompactView(
      mount,
      (id) => navigations.push(id),
      undefined,
      issueStores
    );
    await view.load();

    const first = /** @type {HTMLElement|null} */ (
      mount.querySelector('.cmp-row')
    );
    first?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(navigations[0]).toBe('A-1');
  });

  test('keyboard j/k moves selection and Enter opens', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const issueStores = createTestIssueStores();
    seedIssues(issueStores);

    /** @type {string[]} */
    const navigations = [];
    const view = createCompactView(
      mount,
      (id) => navigations.push(id),
      undefined,
      issueStores
    );
    await view.load();

    // j → first row selected, j again → second row
    mount.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'j', bubbles: true })
    );
    mount.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'j', bubbles: true })
    );
    const selected = mount.querySelector('.cmp-row.is-selected .cmp-id');
    expect(selected?.textContent?.trim()).toBe('A-2');

    mount.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );
    expect(navigations[navigations.length - 1]).toBe('A-2');
  });

  test('search filters rows by id or title', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const issueStores = createTestIssueStores();
    seedIssues(issueStores);

    const view = createCompactView(mount, () => {}, undefined, issueStores);
    await view.load();

    const search = /** @type {HTMLInputElement} */ (
      mount.querySelector('input[type="search"]')
    );
    search.value = 'critical';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    const ids = Array.from(mount.querySelectorAll('.cmp-row .cmp-id')).map(
      (el) => el.textContent?.trim()
    );
    expect(ids).toEqual(['A-1']);
  });

  test('status chip narrows to a single status client-side', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const issueStores = createTestIssueStores();
    seedIssues(issueStores);

    const view = createCompactView(mount, () => {}, undefined, issueStores);
    await view.load();

    const openChip = Array.from(mount.querySelectorAll('.cmp-chip')).find(
      (el) => el.textContent?.trim() === 'Open'
    );
    /** @type {HTMLElement} */ (openChip).click();

    const ids = Array.from(mount.querySelectorAll('.cmp-row .cmp-id')).map(
      (el) => el.textContent?.trim()
    );
    expect(ids).toEqual(['A-2']);
    expect(openChip?.classList.contains('is-active')).toBe(true);
  });

  test('clicking a label filters to that label and clear restores', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const issueStores = createTestIssueStores();
    seedIssues(issueStores);

    /** @type {string[]} */
    const navigations = [];
    const view = createCompactView(
      mount,
      (id) => navigations.push(id),
      undefined,
      issueStores
    );
    await view.load();

    // Click the 'urgent' label on A-1
    const urgent = Array.from(mount.querySelectorAll('.cmp-label')).find(
      (el) => el.textContent?.trim() === 'urgent'
    );
    /** @type {HTMLElement} */ (urgent).click();

    let ids = Array.from(mount.querySelectorAll('.cmp-row .cmp-id')).map((el) =>
      el.textContent?.trim()
    );
    expect(ids).toEqual(['A-1']);
    // Label click must not trigger navigation
    expect(navigations.length).toBe(0);

    // Clear
    /** @type {HTMLElement} */ (mount.querySelector('.cmp-clear')).click();
    ids = Array.from(mount.querySelectorAll('.cmp-row .cmp-id')).map((el) =>
      el.textContent?.trim()
    );
    expect(ids).toEqual(['A-1', 'A-2', 'A-3']);
  });

  test('shows dependency / dependent indicators', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const issueStores = createTestIssueStores();
    seedIssues(issueStores);

    const view = createCompactView(mount, () => {}, undefined, issueStores);
    await view.load();

    const deps = Array.from(mount.querySelectorAll('.cmp-dep')).map((el) =>
      el.textContent?.trim()
    );
    // A-1 has dependent_count 2 (↓2), A-2 has dependency_count 1 (↑1)
    expect(deps).toContain('↓2');
    expect(deps).toContain('↑1');
  });

  test('tree mode groups children under their epic with indentation', async () => {
    document.body.innerHTML = '<div id="m"></div>';
    const mount = /** @type {HTMLElement} */ (document.getElementById('m'));
    const issueStores = createTestIssueStores();
    seedTree(issueStores);

    const view = createCompactView(mount, () => {}, undefined, issueStores);
    await view.load();

    // Enable tree mode
    /** @type {HTMLElement} */ (
      mount.querySelector('.cmp-tree-toggle')
    ).click();

    const ids = Array.from(mount.querySelectorAll('.cmp-row .cmp-id')).map(
      (el) => el.textContent?.trim()
    );
    // Epic first, then children (priority asc within siblings)
    expect(ids).toEqual(['E-1', 'E-1.1', 'E-1.2']);

    // Children are indented deeper than the epic
    const rows = mount.querySelectorAll('.cmp-row');
    const padOf = (/** @type {Element} */ el) =>
      parseInt(/** @type {HTMLElement} */ (el).style.paddingLeft || '0', 10);
    expect(padOf(rows[1])).toBeGreaterThan(padOf(rows[0]));

    // Collapse the epic → children hidden
    /** @type {HTMLElement} */ (
      mount.querySelector('.cmp-row .cmp-caret')
    ).click();
    const collapsedIds = Array.from(
      mount.querySelectorAll('.cmp-row .cmp-id')
    ).map((el) => el.textContent?.trim());
    expect(collapsedIds).toEqual(['E-1']);
  });
});
