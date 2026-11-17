/* Share a component: its link, or the code that embeds it, with Green Southerners named.
 *
 * Every map, chart, story and picture viewer on this site is made to travel. Two
 * buttons sit on each one. "Share as link" gives the published address that opens
 * it, with what the reader chose (a step, a picture, the filters) wherever the
 * component keeps that in its address. "Share as embed" gives an <iframe> for
 * another page, followed by a line naming Green Southerners as the source, so the
 * credit stays beside the frame wherever it is pasted; the component inside the
 * frame names Green Southerners again on its own (`credit()` below, or the credit
 * row of an embed widget).
 *
 * A component of a page that has no widget of its own (a table, a group of
 * figures, a chart with the page's filters) is embedded as that page with
 * `only=<its id>`: the page draws as usual, then shows that one component and
 * hides everything else (`onlyMode()`), so the embed keeps every filter the page
 * keeps in its address.
 *
 * The addresses always point at the published site, never at whatever host is
 * serving this copy. A frame on another site may not write to the clipboard unless
 * that site allows it, so a copy falls back to execCommand and then to a selected
 * box the reader copies by hand. The panel is fixed to the window, so no scrolling
 * card or map can clip it.
 *
 * Self-contained on purpose: it imports nothing, so a page that loads none of the
 * site's other scripts (the 3D castle) can use it too.
 */

export const SITE = 'https://greensoutherners.github.io/south-ecocide-analytics/';
export const ORG = { name: 'Green Southerners', url: 'https://greensoutherners.org' };

/** This copy's own root: assets/js/share.js sits two folders under it. */
const ROOT = new URL('../../', import.meta.url).href;

/** True inside a frame (on another site, or in a page of this one). */
export const FRAMED = (() => {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
})();

/**
 * The published address of a page of this site: a path from the site root
 * ("embed/chart.html?type=fires"), or an address on the host serving this copy.
 */
export function published(href = location.href) {
  const abs = new URL(href, ROOT).href;
  return abs.startsWith(ROOT) ? SITE + abs.slice(ROOT.length) : abs;
}

/** An address with some query parameters set; null, '' and false remove one. */
export function withParams(href, values) {
  const u = new URL(href, ROOT);
  for (const [k, v] of Object.entries(values || {})) {
    if (v == null || v === '' || v === false) u.searchParams.delete(k);
    else u.searchParams.set(k, String(v));
  }
  // Commas and slashes are plain in a query and easier to read in a shared link.
  return u.href.replace(/%2C/gi, ',').replace(/%2F/gi, '/');
}

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

function h(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of [].concat(children)) if (c != null) node.append(c);
  return node;
}

/**
 * The code that embeds a component: the frame, then the line that credits
 * Green Southerners, with the data's date when the component knows it.
 */
export function embedCode({ src, title, height = 600, link, date }) {
  const hpx = Math.max(160, Math.round(height));
  const named = title ? `${title}, by ${ORG.name}` : `By ${ORG.name}`;
  return (
    `<iframe src="${esc(published(src))}" title="${esc(named)}" width="100%" height="${hpx}" ` +
    `style="width:100%;height:${hpx}px;border:0;display:block" loading="lazy" ` +
    `allow="fullscreen; clipboard-write; web-share" allowfullscreen></iframe>\n` +
    `<p style="margin:6px 0 0;font:13px/1.5 system-ui,sans-serif;color:#55544f">` +
    `${title ? `${esc(title)}. ` : ''}Source: <a href="${ORG.url}">${ORG.name}</a>, ` +
    `<a href="${esc(published(link || src))}">South Ecocide Analytics</a>` +
    `${date ? `, data of ${esc(date)}` : ''}.</p>`
  );
}

/* ------------------------------------------------------------------ the credit */

/**
 * A visible credit, "By Green Southerners", linked to greensoutherners.org. It
 * carries the class the site's fallback badge looks for, and takes that badge
 * away if it was pinned before the component had drawn. `text: ''` and
 * `className: ''` give the bare linked name, to sit inside a label of its own.
 */
export function credit({ text = 'By', className = 'gs-credit-line' } = {}) {
  injectStyle();
  for (const badge of document.querySelectorAll('.gs-credit-badge')) badge.remove();
  return h('span', { class: `gs-credit ${className}`.trim() }, [
    text ? `${text} ` : null,
    h('a', { href: ORG.url, target: '_blank', rel: 'noopener', text: ORG.name }),
  ]);
}

/* ------------------------------------------------------------------ the bar */

let current = null; // the one panel open on the page

/**
 * The two buttons for one component. `get()` is called at the moment of the
 * click and returns { title, link, embed: { src, height }, date }, so what is
 * shared is the component as the reader sees it then. The buttons read "Share
 * as link" and "Share as embed", and "Link" and "Embed" on a narrow screen or
 * with `compact` (a crowded row). Options: `className`, `align` ('left' or
 * 'right': the edge of the button the panel keeps to).
 */
export function shareBar(get, { compact = false, className = '', align = 'left' } = {}) {
  injectStyle();
  const bar = h('div', { class: `gs-share${compact ? ' compact' : ''} ${className}`.trim(), role: 'group', 'aria-label': 'Share' });
  const button = (mode, label, short, tip) => {
    const b = h('button', {
      type: 'button',
      class: 'gs-share-btn',
      title: tip,
      'aria-label': label,
      'aria-expanded': 'false',
      'aria-haspopup': 'dialog',
      html: `${ICONS[mode]}<span class="gs-long">${label}</span><span class="gs-short">${short}</span>`,
    });
    b.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggle(bar, b, mode, get, align);
    });
    return b;
  };
  bar.append(
    button('link', 'Share as link', 'Link', 'Copy a link that opens this'),
    button('embed', 'Share as embed', 'Embed', 'Copy the code that shows this in another page, with its credit')
  );
  return bar;
}

/**
 * Put a share bar in a card's head (made if the card has none), for a
 * component of a page. The component gets `data-share-id` and the id
 * `share-<id>`, so `only=<id>` shows it alone and `#share-<id>` lands on it.
 * `get()` returns { title, height?, date? }; by default the link is the page's
 * own address (its filters) with the anchor, and the embed is the page with
 * `only=<id>`. A component that has a widget of its own returns `embed: { src,
 * height }` (and may return `link`) to share that instead. Returns the bar.
 */
export function shareCard(card, id, get, opts = {}) {
  if (!card) return null;
  card.dataset.shareId = id;
  if (!card.id) card.id = `share-${id}`;
  let head = card.querySelector(':scope > .card-head');
  if (!head) {
    head = h('div', { class: 'card-head gs-share-head' });
    card.prepend(head);
  }
  head.querySelector(':scope > .gs-share')?.remove();
  const bar = shareBar(() => {
    const g = get() || {};
    const base = pageComponent(card, id, g);
    return { ...base, ...(g.link ? { link: g.link } : {}), ...(g.embed ? { embed: g.embed } : {}) };
  }, { align: 'right', ...opts });
  head.append(bar);
  return bar;
}

/** What a page component shares: the page's address (its filters) with the anchor, and itself alone. */
export function pageComponent(node, id, { title, height, date } = {}) {
  const page = new URL(location.href);
  page.searchParams.delete('only');
  page.searchParams.delete('embed');
  page.hash = '';
  const link = `${page.href}#share-${id}`;
  const alone = withParams(page.href, { only: id });
  const tall = Math.ceil((node && node.getBoundingClientRect().height) || 0) + 64;
  return { title: title || document.title, link, embed: { src: alone, height: height || Math.max(240, tall) }, date };
}

function toggle(bar, btn, mode, get, align) {
  const same = current && current.bar === bar && current.mode === mode;
  close();
  if (same) return;
  const what = get() || {};
  const link = published(what.link || location.href);
  const panel = mode === 'link' ? linkPanel(what, link) : embedPanel(what, link);
  panel.style.visibility = 'hidden';
  document.body.append(panel);
  current = { bar, btn, mode, panel, align };
  place();
  panel.style.visibility = '';
  btn.setAttribute('aria-expanded', 'true');
  const field = panel.querySelector('input, textarea');
  // One click copies: the panel opens with its text already copied, or selected.
  copy(field.value, field, panel.querySelector('.gs-share-status'));
}

/** Keep the open panel beside its button and inside the window. */
function place() {
  if (!current) return;
  const { btn, panel, align } = current;
  if (!btn.isConnected) return close(); // the component redrew under its panel
  const r = btn.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight) return close();
  const width = Math.min(440, innerWidth - 16);
  panel.style.width = `${width}px`;
  panel.style.maxHeight = `${Math.max(120, innerHeight - 16)}px`;
  let left = align === 'right' ? r.right - width : r.left;
  left = Math.max(8, Math.min(left, innerWidth - width - 8));
  const ph = panel.offsetHeight;
  const below = innerHeight - r.bottom - 8;
  const above = r.top - 8;
  let top = ph <= below || below >= above ? r.bottom + 6 : r.top - 6 - ph;
  top = Math.max(8, Math.min(top, innerHeight - ph - 8));
  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
}

function close() {
  if (!current) return;
  current.panel.remove();
  current.btn.setAttribute('aria-expanded', 'false');
  current = null;
}

function linkPanel(what, link) {
  const field = h('input', { type: 'text', readonly: true, value: link, 'aria-label': 'Link', spellcheck: 'false' });
  field.value = link;
  const status = h('span', { class: 'gs-share-status', role: 'status' });
  // The phone's own share sheet, where the page is not inside a frame: inside
  // one it needs a permission most hosts do not give.
  const native =
    !FRAMED && typeof navigator.share === 'function'
      ? h('button', {
          type: 'button',
          class: 'gs-share-plain',
          text: 'Share…',
          onclick: () => navigator.share({ title: what.title || document.title, url: link }).catch(() => {}),
        })
      : null;
  return h('div', { class: 'gs-share-panel', role: 'dialog', 'aria-label': 'Share as link' }, [
    h('b', { text: 'Link' }),
    field,
    h('div', { class: 'gs-share-row' }, [copyButton(field, status), native, status]),
  ]);
}

function embedPanel(what, link) {
  const e = what.embed || {};
  const code = embedCode({ src: e.src || link, title: what.title, height: e.height || 600, link, date: what.date });
  const field = h('textarea', { rows: String(innerHeight < 320 ? 2 : 5), readonly: true, 'aria-label': 'Embed code', spellcheck: 'false' });
  field.value = code;
  const status = h('span', { class: 'gs-share-status', role: 'status' });
  return h('div', { class: 'gs-share-panel', role: 'dialog', 'aria-label': 'Share as embed' }, [
    h('b', { text: 'Embed code' }),
    field,
    h('div', { class: 'gs-share-row' }, [copyButton(field, status), status]),
    innerHeight < 320
      ? null
      : h('p', {
          class: 'gs-share-note',
          text:
            'Paste it into a page’s HTML. The line under the frame names Green Southerners as the ' +
            'source; keep it with the frame.',
        }),
  ]);
}

function copyButton(field, status) {
  return h('button', { type: 'button', class: 'gs-share-copy', text: 'Copy', onclick: () => copy(field.value, field, status) });
}

function copy(text, field, status) {
  const done = (ok) => {
    status.textContent = ok ? 'Copied' : 'Selected: press Ctrl+C (⌘C on a Mac) to copy';
  };
  const fallback = () => {
    field.focus();
    field.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    done(ok);
  };
  // A frame whose host did not allow the clipboard goes straight to the fallback
  // (asking anyway only logs a refusal).
  if (!clipboardAllowed()) return fallback();
  try {
    // Called inside the click, so the browser counts it as the reader's own act.
    navigator.clipboard.writeText(text).then(() => {
      field.select();
      done(true);
    }, fallback);
  } catch {
    fallback();
  }
}

function clipboardAllowed() {
  if (!navigator.clipboard || !window.isSecureContext) return false;
  try {
    const policy = document.permissionsPolicy || document.featurePolicy;
    return !policy || policy.allowsFeature('clipboard-write');
  } catch {
    return true;
  }
}

addEventListener('keydown', (event) => {
  if (event.key === 'Escape') close();
});
addEventListener(
  'pointerdown',
  (event) => {
    if (current && !current.panel.contains(event.target) && !current.bar.contains(event.target)) close();
  },
  true
);
addEventListener('resize', () => close());
addEventListener('scroll', () => place(), true);

/* ------------------------------------------------------------------ only one */

/**
 * `only=<id>` in a page's address: once the page has drawn, show the component
 * with `data-share-id=<id>` and nothing else, with the credit under it. Pages
 * refill their containers as the reader moves, so it keeps watching.
 */
export function onlyMode() {
  const id = new URLSearchParams(location.search).get('only');
  if (!id) return false;
  injectStyle();
  document.documentElement.classList.add('gs-only');
  const apply = () => {
    const node = document.querySelector(`[data-share-id="${CSS.escape(id)}"]`);
    if (!node) return;
    for (const old of document.querySelectorAll('.gs-only-keep')) old.classList.remove('gs-only-keep');
    for (let n = node; n && n !== document.body; n = n.parentElement) {
      n.classList.add('gs-only-keep');
      for (const sib of n.parentElement ? n.parentElement.children : []) {
        if (sib !== n && !sib.classList.contains('gs-only-credit') && sib.tagName !== 'SCRIPT') sib.classList.add('gs-only-hide');
      }
      n.classList.remove('gs-only-hide');
    }
    let foot = document.querySelector('.gs-only-credit');
    if (!foot) {
      foot = h('p', { class: 'gs-only-credit' }, [
        credit(),
        ' · ',
        h('a', { href: published(withParams(location.href, { only: null })), target: '_blank', rel: 'noopener', text: 'South Ecocide Analytics' }),
      ]);
    }
    if (foot.previousElementSibling !== node) node.after(foot);
  };
  let queued = false;
  const watch = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      apply();
    });
  });
  const start = () => {
    apply();
    watch.observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  return true;
}

/**
 * A link to a component (`#share-<id>`) lands on it once the page has drawn:
 * the components are drawn after their data loads, later than the browser's own
 * jump, and the page's address is rewritten as the reader moves.
 */
export function landOnAnchor() {
  const hash = location.hash;
  if (!hash.startsWith('#share-')) return;
  const id = hash.slice(1);
  let tries = 0;
  const look = () => {
    const node = document.getElementById(id);
    if (node) node.scrollIntoView({ block: 'start' });
    else if (tries++ < 40) setTimeout(look, 250);
  };
  setTimeout(look, 300);
}

// Every page that loads this module honours `only=` and `#share-<id>`, before its
// own scripts rewrite the address.
onlyMode();
landOnAnchor();

/* ------------------------------------------------------------------ looks */

const ICONS = {
  link:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 9.5l3-3M7 4.8l1-1a2.5 2.5 0 013.5 3.5l-1 1M9 11.2l-1 1A2.5 2.5 0 014.5 8.7l1-1" ' +
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  embed:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" fill="none" ' +
    'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function injectStyle() {
  if (document.getElementById('gs-share-style')) return;
  const style = document.createElement('style');
  style.id = 'gs-share-style';
  style.textContent = `
.gs-share { display: inline-flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.gs-share-btn {
  display: inline-flex; align-items: center; gap: 5px; cursor: pointer; white-space: nowrap;
  font: 500 12px/1.2 Inter, system-ui, sans-serif; padding: 4px 9px; border-radius: 999px;
  border: 1px solid var(--hairline, #e4e4e4); background: var(--surface-2, #fff); color: var(--ink-2, #4b4e4c);
}
.gs-share-btn svg { width: 13px; height: 13px; flex: none; }
.gs-share .gs-short, .gs-share.compact .gs-long { display: none; }
.gs-share.compact .gs-short { display: inline; }
@media (max-width: 520px) { .gs-share .gs-long { display: none; } .gs-share .gs-short { display: inline; } }
.gs-share-btn:hover, .gs-share-btn[aria-expanded="true"] {
  border-color: var(--accent, #3a954f); color: var(--accent-ink, #195828);
}
.gs-share-btn:focus-visible, .gs-share-copy:focus-visible, .gs-share-plain:focus-visible {
  outline: 2px solid var(--accent, #3a954f); outline-offset: 2px;
}
.gs-share-panel {
  position: fixed; z-index: 2147482000; box-sizing: border-box; overflow: auto;
  padding: 12px; border-radius: 10px; border: 1px solid var(--hairline, #e4e4e4);
  background: var(--surface-2, #fff); color: var(--ink-1, #1f2220); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  font: 13px/1.45 Inter, system-ui, sans-serif; text-align: left;
}
.gs-share-panel b { display: block; margin: 0 0 6px; font-weight: 600; }
.gs-share-panel input, .gs-share-panel textarea {
  display: block; width: 100%; box-sizing: border-box; margin: 0; padding: 7px 8px; resize: vertical;
  font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--ink-1, #1f2220);
  background: var(--surface-1, #fff); border: 1px solid var(--hairline, #e4e4e4); border-radius: 6px;
}
.gs-share-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; }
.gs-share-copy, .gs-share-plain {
  cursor: pointer; font: 600 12px/1.2 Inter, system-ui, sans-serif; padding: 6px 12px; border-radius: 6px;
}
.gs-share-copy { border: 1px solid var(--accent, #3a954f); background: var(--accent, #3a954f); color: #fff; }
.gs-share-plain { border: 1px solid var(--hairline, #e4e4e4); background: transparent; color: var(--ink-2, #4b4e4c); }
.gs-share-status { font-size: 12px; color: var(--accent-ink, #195828); }
.gs-share-note { margin: 8px 0 0; font-size: 12px; color: var(--ink-3, #828282); }
.gs-credit-line { font: 500 12px/1.4 Inter, system-ui, sans-serif; color: var(--ink-2, #4b4e4c); }
.gs-credit-line a { color: inherit; font-weight: 600; text-decoration: underline; text-underline-offset: 2px; }
.gs-share-head { display: flex; justify-content: flex-end; }
.card-head .gs-share { margin-inline-start: auto; }
[data-share-id] { scroll-margin-top: 84px; }
html.gs-only .site-head, html.gs-only .site-foot, html.gs-only .gs-only-hide, html.gs-only .card-head .gs-share { display: none !important; }
html.gs-only body { background: var(--surface-1, #fff); }
html.gs-only .gs-only-keep { margin-top: 0 !important; margin-bottom: 0 !important; }
html.gs-only .gs-only-keep[data-share-id], html.gs-only .grid > .gs-only-keep { grid-column: 1 / -1 !important; max-width: none !important; }
html.gs-only main, html.gs-only .wrap { padding-top: 6px !important; padding-bottom: 6px !important; max-width: none !important; }
.gs-only-credit { margin: 8px 0 0; font: 12px/1.5 Inter, system-ui, sans-serif; color: var(--ink-3, #828282); }
.gs-only-credit a { color: inherit; }
@media print { .gs-share { display: none; } }
`;
  document.head.append(style);
}
