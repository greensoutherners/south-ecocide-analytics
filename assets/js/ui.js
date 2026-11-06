/* The page furniture: header, footer, stat tiles, filter chips, tables.
 *
 * Built in plain DOM rather than with a framework, because the whole point of
 * this repository is that it is HTML and JavaScript a browser can serve from a
 * static host with no build step, and a page that works when a CDN is slow.
 *
 * Two of these helpers carry a rule rather than a style. `tableFor` exists so
 * every chart has a table behind it: that is the accessibility fallback and
 * also how somebody checks a figure. `noteList` is where a type's caveats are
 * printed; they ship with the numbers, on the same page, not on a methodology
 * note nobody opens.
 */

import { DATA, ROOT, fmt, fmtMeasure } from './data.js';
import { currentTheme, palette, restoreTheme, setTheme } from './theme.js';

restoreTheme();

export const PAGES = [
  { href: 'index.html', label: 'Catalogue', key: 'catalogue', root: true },
  { href: 'investigations/', label: 'Investigations', key: 'investigations' },
  { href: 'platform.html', label: 'Platform', key: 'platform' },
  // Detonations are hidden for now (the data owner, 2026-11-06: their collection
  // is incomplete). To show them again, make this `types=BRN,WPB,DET`.
  { href: 'platform.html?focus=ecosystem&types=BRN,WPB&shade=none', label: 'Ecosystem', key: 'ecosystem' },
  { href: 'pages/overview.html', label: 'Overview', key: 'overview' },
  { href: 'pages/timeline.html', label: 'Timeline', key: 'timeline' },
  { href: 'pages/map.html', label: 'Map', key: 'map' },
  { href: 'pages/villages.html', label: 'Villages', key: 'villages' },
  { href: 'pages/about.html', label: 'Method', key: 'about' },
];

export const TYPE_PAGES = [
  { slug: 'fires', label: 'Fires', code: 'BRN' },
  // Detonations are hidden for now (the data owner, 2026-11-06). To show them
  // again: { slug: 'detonations', label: 'Detonations', code: 'DET' }, with
  // pages/detonations.html restored and DET back in spec.TYPES.
  { slug: 'phosphorus', label: 'Phosphorus', code: 'WPB' },
  { slug: 'displacement', label: 'Displacement', code: 'ALR' },
];

/* Where a reader asks for the records themselves. The site publishes
 * statistics only (the data owner, 2026-11-06): counts by week, town and
 * documented column, never a record. */
export const CONTACT_URL = 'https://greensoutherners.org/contact-us';

/** The one sentence every page says where records used to be offered. */
export function contactNote({ tag = 'p', cls = 'card-note' } = {}) {
  return el(tag, { class: cls }, [
    'The records themselves are not published. To access them, ',
    el('a', { href: CONTACT_URL, target: '_blank', rel: 'noopener', text: 'contact Green Southerners' }),
    '.',
  ]);
}

/* What one record of each kind is called, so a count reads "12 fires" rather
 * than "12 records". A kind not listed here reads as records. */
const NOUNS = {
  BRN: ['fire', 'fires'],
  WPB: ['white phosphorus attack', 'white phosphorus attacks'],
  ALR: ['displacement order', 'displacement orders'],
  // Detonations are hidden for now (the data owner, 2026-11-06). To show them
  // again: DET: ['detonation or demolition', 'detonations and demolitions'].
  ATT: ['attack on a town', 'attacks on towns'],
};

/** The word for `n` records of one kind: "fire" or "fires". */
export function kindNoun(code, n) {
  const pair = NOUNS[code] || ['record', 'records'];
  return n === 1 ? pair[0] : pair[1];
}

/** A count with its word: "12 fires", "1 displacement order". */
export function countLabel(code, n) {
  return `${fmt(n)} ${kindNoun(code, n)}`;
}

export function url(path) {
  return new URL(path, ROOT).href;
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/* ------------------------------------------------------------------ chrome */

/** The site header, with the page's own nav item marked. */
export function header(active) {
  const nav = el('nav', { class: 'site-nav', 'aria-label': 'Sections' });
  for (const page of PAGES) {
    nav.append(
      el('a', {
        href: url(page.href),
        text: page.label,
        'aria-current': page.key === active ? 'page' : null,
      })
    );
  }

  const toggle = el('button', {
    class: 'theme-toggle',
    type: 'button',
    title: 'Switch between light and dark',
    'aria-label': 'Change the colour theme',
    text: themeGlyph(),
  });
  toggle.addEventListener('click', () => {
    const order = ['light', 'dark'];
    const next = order[(order.indexOf(currentTheme()) + 1) % order.length];
    setTheme(next);
    toggle.textContent = themeGlyph();
  });
  nav.append(toggle);

  return el('header', { class: 'site-head' }, [
    el('div', { class: 'wrap' }, [
      el('a', { class: 'brand', href: url('index.html') }, [
        el('span', { class: 'dot' }),
        'South Ecocide Analytics',
      ]),
      nav,
    ]),
  ]);
}

function themeGlyph() {
  return { light: '☀', dark: '☽' }[currentTheme()];
}

/**
 * The footer.
 *
 * It carries the data stamp, because a page of numbers with no date on it is
 * unciteable, and the attribution for every outside layer the site draws.
 */
export function footer(metaPayload) {
  const stamp = metaPayload
    ? new Date(metaPayload.generated_at).toLocaleString('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      }) + ' UTC'
    : 'unknown';

  const sources = Object.values((metaPayload && metaPayload.attribution) || {}).map((a) =>
    el('li', {}, [
      a.url ? el('a', { href: a.url, rel: 'noopener', target: '_blank', text: a.org }) : a.org,
      ` (${a.license})`,
    ])
  );

  return el('footer', { class: 'site-foot' }, [
    el('div', { class: 'wrap' }, [
      el('div', {}, [
        el('h4', { text: 'Green Southerners' }),
        el('p', {
          html:
            'Documentation of the environmental and civilian harm of the war in ' +
            'South Lebanon. <a href="https://greensoutherners.org" rel="noopener">greensoutherners.org</a>',
        }),
        el('p', { class: 'stamp', text: `Data last refreshed ${stamp}` }),
      ]),
      el('div', {}, [
        el('h4', { text: 'Read first' }),
        el('ul', {}, [
          el('li', {}, [el('a', { href: url('pages/about.html'), text: 'Method and limits' })]),
          el('li', {}, [el('a', { href: url('embed/'), text: 'Embed a chart or map' })]),
          el('li', {}, [
            el('a', {
              href: CONTACT_URL,
              target: '_blank',
              rel: 'noopener',
              text: 'Ask for the records',
            }),
          ]),
        ]),
      ]),
      el('div', {}, [el('h4', { text: 'Layers and sources' }), el('ul', {}, sources)]),
      el('div', {}, [
        el('h4', { text: 'How to read a figure' }),
        el('p', {
          text:
            'No number here is added across incident types, and a count of records is ' +
            'not a count of events. The site publishes statistics, not records: a map ' +
            'counts records by town, at the town’s own point.',
        }),
      ]),
    ]),
  ]);
}

/** Put the header and footer round a page and mark the active nav item. */
export async function chrome(active, metaPromise) {
  document.body.prepend(header(active));
  const metaPayload = await metaPromise;
  document.body.append(footer(metaPayload));
  return metaPayload;
}

/* ------------------------------------------------------------------ pieces */

export function stat({ label, value, unit = '', sub = '' }) {
  return el('div', { class: 'stat' }, [
    el('span', { class: 'label', text: label }),
    el('span', { class: 'value', html: `${value}${unit ? `<span class="unit">${unit}</span>` : ''}` }),
    sub ? el('span', { class: 'sub', html: sub }) : null,
  ]);
}

export function card({ title, note = '', body = [], aside = null, id = null }) {
  return el('section', { class: 'card', id }, [
    title
      ? el('div', { class: 'card-head' }, [el('h3', { text: title }), aside])
      : null,
    ...[].concat(body),
    note ? el('p', { class: 'card-note', html: note }) : null,
  ]);
}

/** A type's caveats, printed with its numbers. */
export function noteList(items, { title = 'What these figures do and do not show', frozen = false } = {}) {
  return el('div', { class: `note${frozen ? ' frozen' : ''}` }, [
    el('b', { text: title }),
    el('ul', {}, items.map((t) => el('li', { text: t }))),
  ]);
}

/**
 * A table behind a chart.
 *
 * Always available, never the primary view. It is the accessibility fallback
 * for a canvas chart, and the way a reader checks a bar they do not believe.
 */
export function tableFor(groups, { dimension = 'Value', measure = null, unit = '', total = null }) {
  const sum = total != null ? total : groups.reduce((s, g) => s + g.n, 0);
  const head = el('tr', {}, [
    el('th', { text: dimension }),
    el('th', { class: 'num', text: 'Records' }),
    el('th', { class: 'num', text: 'Share' }),
    measure ? el('th', { class: 'num', text: `${measure}${unit ? ` (${unit})` : ''}` }) : null,
  ]);
  const body = groups.map((g) =>
    el('tr', {}, [
      el('td', { class: 'name', text: g.label }),
      el('td', { class: 'num', text: fmt(g.n) }),
      el('td', { class: 'num', text: sum ? `${((g.n / sum) * 100).toFixed(1)}%` : 'n/a' }),
      measure ? el('td', { class: 'num', text: g.v == null ? 'n/a' : fmtMeasure(g.v, unit) }) : null,
    ])
  );

  return el('details', { class: 'table-toggle' }, [
    el('summary', { text: `Table (${groups.length} row${groups.length === 1 ? '' : 's'})` }),
    el('div', { class: 'table-wrap' }, [
      el('table', { class: 'data' }, [el('thead', {}, [head]), el('tbody', {}, body)]),
    ]),
  ]);
}

/** A generic table from rows of cells. */
export function table(headers, rows) {
  return el('div', { class: 'table-wrap' }, [
    el('table', { class: 'data' }, [
      el('thead', {}, [
        el(
          'tr',
          {},
          headers.map((h) =>
            el('th', { class: h.num ? 'num' : null, text: h.label || h })
          )
        ),
      ]),
      el('tbody', {}, rows),
    ]),
  ]);
}

/* ------------------------------------------------------------------ controls */

/**
 * A multi-select chip row.
 *
 * Chips rather than a `<select multiple>`: the active filters have to be
 * readable at a glance, because a dashboard that hides what it is filtered by
 * reports the wrong number with total confidence.
 */
export function chipRow(options, selected, onChange, { colors = null } = {}) {
  const row = el('div', { class: 'chips' });
  const set = new Set(selected);

  options.forEach((option, i) => {
    const chip = el('button', {
      class: 'chip',
      type: 'button',
      'aria-pressed': set.has(option.value) ? 'true' : 'false',
    });
    if (colors) chip.append(el('span', { class: 'swatch', style: `background:${colors[i]}` }));
    chip.append(document.createTextNode(option.label));
    if (option.n != null) {
      chip.append(el('span', { style: 'opacity:.6;font-variant-numeric:tabular-nums', text: ` ${fmt(option.n)}` }));
    }
    chip.addEventListener('click', () => {
      if (set.has(option.value)) set.delete(option.value);
      else set.add(option.value);
      chip.setAttribute('aria-pressed', set.has(option.value) ? 'true' : 'false');
      onChange([...set]);
    });
    row.append(chip);
  });

  return row;
}

export function select(label, options, value, onChange, { id = null } = {}) {
  const node = el('select', { id });
  for (const option of options) {
    node.append(
      el('option', { value: option.value, text: option.label, selected: option.value === value })
    );
  }
  node.addEventListener('change', () => onChange(node.value));
  return el('div', { class: 'field' }, [el('label', { text: label, for: id }), node]);
}

/* ------------------------------------------------------------------ feedback */

export function loading(text = 'Loading the data...') {
  return el('p', { class: 'loading', text });
}

/**
 * Report a failure where the reader can see it.
 *
 * A page of charts that silently renders empty is worse than one that says the
 * data did not load: an empty chart reads as "nothing happened".
 */
export function failure(err) {
  console.error(err);
  const message = String((err && err.message) || err);

  /* Say which kind of failure it was.
   *
   * Every error used to be reported as "the data did not load", which sent
   * whoever hit a plain coding mistake off to check their web server. A fetch
   * that failed names the file it wanted; anything else is this code's fault
   * and should say so.
   */
  const isFetch = /(fetch|NetworkError|Failed to fetch|\d{3} )/i.test(message) || /\.(json|geojson)/.test(message);

  return el('div', { class: 'error' }, [
    el('b', { text: isFetch ? 'The data did not load. ' : 'This page hit an error. ' }),
    isFetch
      ? `It reads JSON from ${DATA.href}. Opened straight from disk a browser will ` +
        'block that, so serve the folder over HTTP instead. '
      : 'The figures are fine; the page that draws them is not. ',
    el('code', { text: message }),
  ]);
}

/** Replace a container's contents. */
export function fill(node, ...children) {
  node.replaceChildren(...children.flat().filter(Boolean));
  return node;
}

/* ------------------------------------------------------------------ querystring */

/** Read the page's own query string, with defaults. */
export function params(defaults = {}) {
  const q = new URLSearchParams(location.search);
  const out = { ...defaults };
  for (const [k, v] of q.entries()) out[k] = v;
  return out;
}

/** Keep the URL in step with the reader's filters, so a view can be shared. */
export function syncURL(state, keys) {
  const q = new URLSearchParams();
  for (const key of keys) {
    const v = state[key];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    q.set(key, Array.isArray(v) ? v.join(',') : String(v));
  }
  const next = `${location.pathname}${q.toString() ? `?${q}` : ''}`;
  history.replaceState(null, '', next);
}

export function listParam(value) {
  return value ? String(value).split(',').filter(Boolean) : [];
}
