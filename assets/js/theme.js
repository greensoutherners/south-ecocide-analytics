/* The one place a colour is turned from a role into a hex.
 *
 * `site.css` owns every value; this reads them back out of the cascade so the
 * charts and the Leaflet layers, which both need concrete colours, agree with
 * the page they sit on and follow the light/dark toggle without a second
 * palette written in JavaScript.
 *
 * The palette is orange, red and violet (the data owner, 2026-11-04: no blue):
 * eight categorical hues in a fixed order (never cycled: a ninth series folds
 * into "Other"), one colour per kind of record, and one orange-to-violet ramp
 * for magnitude. No colour stands for a record's status: the public site does
 * not publish one.
 */

const listeners = new Set();

/** The resolved value of one CSS custom property on :root. */
export function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function series(n) {
  return token(`--series-${((n % 8) + 8) % 8 + 1}`);
}

export function palette() {
  return {
    surface: token('--surface-1'),
    card: token('--surface-2'),
    plane: token('--plane'),
    ink1: token('--ink-1'),
    ink2: token('--ink-2'),
    ink3: token('--ink-3'),
    hairline: token('--hairline'),
    axis: token('--axis'),
    ring: token('--ring'),
    accent: token('--accent'),
    accentInk: token('--accent-ink'),
    accentWash: token('--accent-wash'),
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => token(`--series-${n}`)),
    sequential: [1, 2, 3, 4, 5, 6, 7].map((n) => token(`--seq-${n}`)),
    types: Object.fromEntries(TYPE_CODES.map((c) => [c, token(`--type-${c.toLowerCase()}`)])),
    map: {
      land: token('--map-land'),
      stroke: token('--map-stroke'),
      accent: token('--map-accent'),
      zone: token('--zone-stroke'),
    },
  };
}

/** True when the page is currently rendering dark. */
export function isDark() {
  // Dark only when chosen. The operating system's setting is deliberately
  // ignored: these pages live inside a light site, see site.css.
  return document.documentElement.dataset.theme === 'dark';
}

const TYPE_CODES = ['BRN', 'DET', 'ALR', 'WPB', 'ATT'];

/** The colour of one kind of record, the same everywhere on the site. */
export function typeColor(code) {
  return token(`--type-${String(code).toLowerCase()}`) || palette().series[0];
}

/**
 * A ramp of one kind of record's colour, from a wash to the full colour, for a
 * town shaded by how many records of that kind name it. `steps` shades, lightest
 * first.
 */
export function typeRamp(code, steps = 6) {
  const full = typeColor(code);
  const base = palette().card || '#ffffff';
  return Array.from({ length: steps }, (_, i) => mix(base, full, 0.22 + (0.78 * i) / (steps - 1)));
}

/** `a` blended toward `b` by `t` (0..1), both hex. */
export function mix(a, b, t) {
  const pa = hex(a);
  const pb = hex(b);
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function hex(value) {
  const h = String(value).trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0);
}

/** Colours for a grouped result, honouring the fixed slot order. */
export function colorsFor(groups) {
  const p = palette();
  return groups.map((g, i) => {
    if (g.key === '__none__' || g.key === '__other__') return p.ink3;
    return p.series[i % 8];
  });
}

/* ------------------------------------------------------------------ toggle */

const STORE = 'gsa-theme';

export function setTheme(mode) {
  if (mode !== 'dark') {
    delete document.documentElement.dataset.theme;
    try {
      localStorage.removeItem(STORE);
    } catch {
      /* private mode: the toggle still works for this page view */
    }
  } else {
    document.documentElement.dataset.theme = mode;
    try {
      localStorage.setItem(STORE, mode);
    } catch {
      /* ignored: a remembered theme is a convenience, never a requirement */
    }
  }
  announce();
}

export function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** Restore the reader's choice. Call before first paint. */
export function restoreTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem(STORE);
  } catch {
    saved = null;
  }
  if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved;
}

/** Run `fn` whenever the rendered theme changes, either way. */
export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function announce() {
  for (const fn of listeners) {
    try {
      fn(isDark());
    } catch (err) {
      console.error(err);
    }
  }
}


/* ------------------------------------------------------------------ echarts */

/**
 * The option fragment every chart on the site starts from.
 *
 * Hairline grid, recessive axes, no animation on a re-render (the data changed
 * because the reader moved a filter, and a 500 ms morph makes a dashboard feel
 * slow rather than alive), and a tooltip by default: an HTML chart that does
 * not respond to a cursor is a picture, and the numbers behind it go unread.
 */
export function chartBase() {
  const p = palette();
  return {
    animationDuration: 320,
    animationDurationUpdate: 180,
    textStyle: {
      fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
      color: p.ink2,
      fontSize: 12,
    },
    grid: { left: 8, right: 14, top: 18, bottom: 6, containLabel: true },
    tooltip: {
      backgroundColor: p.card,
      borderColor: p.hairline,
      borderWidth: 1,
      padding: [8, 11],
      textStyle: { color: p.ink1, fontSize: 12 },
      extraCssText: 'box-shadow: 0 3px 16px rgba(0,0,0,.16); border-radius: 8px;',
      confine: true,
    },
    axisPointer: { lineStyle: { color: p.axis, width: 1 } },
  };
}

export function axisStyle(p = palette()) {
  return {
    axisLine: { lineStyle: { color: p.axis, width: 1 } },
    axisTick: { show: false },
    axisLabel: { color: p.ink3, fontSize: 11, hideOverlap: true },
    splitLine: { lineStyle: { color: p.hairline, width: 1, type: 'solid' } },
  };
}
