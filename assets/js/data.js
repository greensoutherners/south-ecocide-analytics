/* Loading the corpus's published files, and the in-browser table the pages
 * filter and re-aggregate against.
 *
 * Every page here is static HTML on a static host: there is no API to ask, so
 * the interactivity has to come from holding the figures in the page. The site
 * holds statistics, never records (the data owner, 2026-11-06): a type's file
 * is its records counted by week and town and by every documented column, each
 * row a cell with `n` records, no record id, no day and no coordinate. Every
 * count below is a sum of `n`; a map draws a town's count at the town.
 *
 * Two rules are enforced here rather than left to each page:
 *
 *   - `sum()` refuses a column the export did not declare additive. A count of
 *     records is not a count of events, and hectares are the only measure in
 *     this corpus that add up without an argument.
 *   - Nothing in this module can combine two types. `Dataset` holds exactly one
 *     type's rows, and the village register's per-type counts are read as
 *     separate columns, never added.
 */

/* Where the data lives, resolved from this module's own URL so a page works at
 * the repository root, under /south-ecocide-analytics/ on GitHub Pages, and
 * inside an iframe on another domain, with no configuration. */
export const DATA = new URL('../../data/', import.meta.url);
export const ROOT = new URL('../../', import.meta.url);

const cache = new Map();

/** Fetch and parse one data file, once per page. */
export function load(path) {
  if (!cache.has(path)) {
    cache.set(
      path,
      fetch(new URL(path, DATA), { cache: 'no-cache' }).then((r) => {
        if (!r.ok) throw new Error(`${path}: ${r.status} ${r.statusText}`);
        return r.json();
      })
    );
  }
  return cache.get(path);
}

export const meta = () => load('meta.json');
export const summary = () => load('summary.json');
export const typeSummary = (slug) => load(`types/${slug}.json`);
/** A type's statistics: its records counted by week, town and column. */
export const records = (slug) => load(`stats/${slug}.json`);
export const villages = () => load('villages.json');
export const wayback = () => load('imagery/wayback.json');
export const ongeo = () => load('imagery/ongeo.json').catch(() => ({ villages: [] }));
export const timelapseIndex = () => load('imagery/timelapse.json');
export const geo = (name) => load(`geo/${name}.geojson`);

/* ------------------------------------------------------------------ dates */

const DAY = 86400000;

/** A day offset from a record file's epoch, back to a Date. */
export function dayToDate(epoch, day) {
  return new Date(Date.parse(epoch + 'T00:00:00Z') + day * DAY);
}

export function dayToISO(epoch, day) {
  return dayToDate(epoch, day).toISOString().slice(0, 10);
}

export function isoToDay(epoch, iso) {
  return Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(epoch + 'T00:00:00Z')) / DAY);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 2023": short enough for an axis tick, unambiguous in any locale. */
export function monthLabel(key) {
  const [y, m] = key.split('-');
  return `${MONTHS[+m - 1]} ${y}`;
}

export function dateLabel(iso) {
  if (!iso) return 'not recorded';
  const [y, m, d] = iso.split('-');
  return `${+d} ${MONTHS[+m - 1]} ${y}`;
}

/* ------------------------------------------------------------------ dataset */

/**
 * One incident type's records, held as columns and queried by index.
 *
 * The constructor takes an exported record file verbatim. `select()` returns a
 * plain array of row indexes, and every aggregate takes such an array, so a
 * page computes the selection once per interaction and then draws five charts
 * and a map from it, instead of filtering five times.
 */
export class Dataset {
  constructor(payload) {
    this.code = payload.code;
    this.slug = payload.slug;
    this.label = payload.label;
    this.epoch = payload.epoch;
    this.rows = payload.rows;
    this.dict = payload.dict;
    this.labelMap = payload.label_map;
    this.columns = payload.columns;
    // Each row is a cell: n records of one week, one town, one value per column.
    this.townPoints = payload.town_ll || {};

    this.at = {};
    payload.columns.forEach((c, i) => {
      this.at[c.k] = i;
    });
    this.wi = this.at.n;

    this.measures = payload.columns.filter((c) => c.t === 'num' && c.label);
    this.dims = payload.columns.filter((c) => c.t === 'dict' && c.label);

    const days = this.rows.map((r) => r[this.at.d]).filter((d) => d != null);
    this.minDay = days.length ? Math.min(...days) : 0;
    this.maxDay = days.length ? Math.max(...days) : 0;
    this.all = this.rows.map((_, i) => i);
  }

  /** How many records a row (a cell) holds. */
  weight(row) {
    return this.wi == null ? 1 : this.rows[row][this.wi] || 0;
  }

  /** How many records a selection of cells holds. */
  size(selection) {
    if (this.wi == null) return selection.length;
    let n = 0;
    for (const r of selection) n += this.rows[r][this.wi] || 0;
    return n;
  }

  /** The stored value of one column on one row, decoded. */
  value(row, key) {
    const i = this.at[key];
    if (i == null) return null;
    const raw = this.rows[row][i];
    if (raw == null) return null;
    const col = this.columns[i];
    if (col.t === 'dict') return this.dict[key][raw];
    if (col.t === 'day') return dayToISO(this.epoch, raw);
    return raw;
  }

  /** How that value should read on screen. */
  display(row, key) {
    const i = this.at[key];
    if (i == null) return null;
    const raw = this.rows[row][i];
    if (raw == null) return key === 'town' ? 'No town recorded' : 'Not assessed';
    const col = this.columns[i];
    if (col.t === 'dict') return (this.labelMap[key] || this.dict[key])[raw];
    if (col.t === 'day') return dayToISO(this.epoch, raw);
    return raw;
  }

  dimLabel(key) {
    const col = this.columns[this.at[key]];
    return (col && col.label) || key;
  }

  /** Every value of one column, with its label, in the export's own order. */
  options(key) {
    const values = this.dict[key] || [];
    const labels = this.labelMap[key] || values;
    return values.map((v, i) => ({ value: v, label: labels[i], index: i }));
  }

  /**
   * Row indexes matching a filter.
   *
   * `filters` maps a column key to an array of stored values; an empty or
   * missing array means that column does not constrain anything, which is why
   * clearing a filter widens rather than empties the view. `from` and `to` are
   * day offsets, inclusive.
   */
  select({ filters = {}, from = null, to = null } = {}) {
    const active = [];
    for (const [key, values] of Object.entries(filters)) {
      if (!values || !values.length) continue;
      const i = this.at[key];
      if (i == null) continue;
      const dict = this.dict[key] || [];
      // Compare integers, not strings: a selection over 1,859 rows and six
      // filters is 11,000 comparisons on every keystroke.
      const wanted = new Set(
        values.map((v) => dict.indexOf(v)).filter((n) => n >= 0)
      );
      const wantsNull = values.includes(null) || values.includes('__none__');
      active.push([i, wanted, wantsNull]);
    }

    const di = this.at.d;
    const out = [];
    for (let r = 0; r < this.rows.length; r++) {
      const row = this.rows[r];
      if (from != null || to != null) {
        const d = row[di];
        if (d == null) continue;
        if (from != null && d < from) continue;
        if (to != null && d > to) continue;
      }
      let ok = true;
      for (const [i, wanted, wantsNull] of active) {
        const v = row[i];
        if (v == null ? !wantsNull : !wanted.has(v)) {
          ok = false;
          break;
        }
      }
      if (ok) out.push(r);
    }
    return out;
  }

  /** The additive total of one declared measure over a selection. */
  sum(selection, measure) {
    const col = this.columns[this.at[measure]];
    if (!col || col.t !== 'num') {
      // A guard, not a convenience: the export declares which columns add up,
      // and a page that sums anything else is publishing a figure the corpus
      // does not stand behind.
      throw new Error(`${measure} is not a declared measure of ${this.code}`);
    }
    const i = this.at[measure];
    // `<measure>_n` is how many of a cell's records carry the measure.
    const ci = this.at[`${measure}_n`];
    let total = 0;
    let n = 0;
    for (const r of selection) {
      const v = this.rows[r][i];
      if (v != null) {
        total += v;
        n += ci != null ? this.rows[r][ci] || 0 : 1;
      }
    }
    const all = this.size(selection);
    return { total, records: n, coverage: all ? n / all : 0 };
  }

  /**
   * Counts by one column over a selection, descending.
   *
   * `measure` adds that column's additive total per slice. `limit` folds the
   * tail into one "Other" row rather than cycling a ninth colour, which is the
   * rule the palette is built on.
   */
  group(selection, key, { measure = null, limit = 0, keepOrder = false } = {}) {
    const i = this.at[key];
    if (i == null) return [];
    const mi = measure != null ? this.at[measure] : null;
    const dict = this.dict[key] || [];
    const labels = this.labelMap[key] || dict;

    const counts = new Array(dict.length).fill(0);
    const sums = new Array(dict.length).fill(0);
    let nulls = 0;
    let nullSum = 0;

    for (const r of selection) {
      const v = this.rows[r][i];
      const m = mi != null ? this.rows[r][mi] : null;
      const w = this.weight(r);
      if (v == null) {
        nulls += w;
        if (m != null) nullSum += m;
      } else {
        counts[v] += w;
        if (m != null) sums[v] += m;
      }
    }

    let out = dict
      .map((value, n) => ({
        key: value,
        label: labels[n],
        n: counts[n],
        v: mi != null ? round(sums[n]) : undefined,
      }))
      .filter((d) => d.n > 0);

    if (nulls) {
      out.push({
        key: '__none__',
        label: 'Not assessed',
        n: nulls,
        v: mi != null ? round(nullSum) : undefined,
        none: true,
      });
    }

    if (!keepOrder) out.sort((a, b) => b.n - a.n);

    if (limit && out.length > limit) {
      const head = out.slice(0, limit - 1);
      const tail = out.slice(limit - 1);
      head.push({
        key: '__other__',
        label: `Other (${tail.length})`,
        n: tail.reduce((s, d) => s + d.n, 0),
        v: mi != null ? round(tail.reduce((s, d) => s + (d.v || 0), 0)) : undefined,
        other: true,
        members: tail,
      });
      out = head;
    }
    return out;
  }

  /** A time series over a selection: 'month', 'week' or 'day'. */
  series(selection, { grain = 'month', measure = null } = {}) {
    const di = this.at.d;
    const mi = measure != null ? this.at[measure] : null;
    const buckets = new Map();

    for (const r of selection) {
      const d = this.rows[r][di];
      if (d == null) continue;
      const iso = dayToISO(this.epoch, d);
      let key;
      if (grain === 'day') key = iso;
      else if (grain === 'month') key = iso.slice(0, 7);
      else {
        // Weeks start on Monday, so a bar covers one working week rather than
        // a window that drifts with the first record's weekday.
        const date = dayToDate(this.epoch, d);
        date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
        key = date.toISOString().slice(0, 10);
      }
      const b = buckets.get(key) || { key, n: 0, v: 0, hasV: false };
      b.n += this.weight(r);
      if (mi != null) {
        const m = this.rows[r][mi];
        if (m != null) {
          b.v += m;
          b.hasV = true;
        }
      }
      buckets.set(key, b);
    }

    const out = [...buckets.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
    for (const b of out) b.v = b.hasV ? round(b.v) : null;
    return grain === 'month' ? fillMonths(out) : out;
  }

  /**
   * A time series split by one column, as one row per bucket.
   *
   * Used for the stacked month chart. The split's own order is kept so a
   * series keeps its colour when a filter removes one of its neighbours.
   */
  seriesBy(selection, key, { grain = 'month', limit = 6 } = {}) {
    const top = this.group(selection, key, { limit });
    const index = new Map(top.map((d, i) => [d.key, i]));
    const members = new Map();
    for (const d of top) {
      if (d.members) for (const m of d.members) members.set(m.key, index.get('__other__'));
    }

    const di = this.at.d;
    const ki = this.at[key];
    const dict = this.dict[key] || [];
    const buckets = new Map();

    for (const r of selection) {
      const d = this.rows[r][di];
      if (d == null) continue;
      const iso = dayToISO(this.epoch, d);
      const bucketKey = grain === 'day' ? iso : iso.slice(0, 7);
      let row = buckets.get(bucketKey);
      if (!row) {
        row = { key: bucketKey, counts: new Array(top.length).fill(0) };
        buckets.set(bucketKey, row);
      }
      const raw = this.rows[r][ki];
      const value = raw == null ? '__none__' : dict[raw];
      let slot = index.get(value);
      if (slot == null) slot = members.get(value);
      if (slot != null) row.counts[slot] += this.weight(r);
    }

    let rows = [...buckets.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
    if (grain === 'month') {
      rows = fillMonths(rows, () => ({ counts: new Array(top.length).fill(0) }));
    }
    return { keys: top, rows };
  }

  /** Towns in a selection, with their point (the town's own) and count. */
  towns(selection, { measure = null } = {}) {
    const ti = this.at.town;
    const di = this.at.district;
    const mi = measure != null ? this.at[measure] : null;
    const out = new Map();

    for (const r of selection) {
      const t = this.rows[r][ti];
      const name = t == null ? 'No town recorded' : this.dict.town[t];
      // A town is its name and its district: two places can share a name.
      const dist = this.rows[r][di] == null ? '' : this.dict.district[this.rows[r][di]];
      const key = `${name}|${dist}`;
      let entry = out.get(key);
      if (!entry) {
        entry = {
          name,
          district: this.rows[r][di] == null ? null : this.dict.district[this.rows[r][di]],
          n: 0,
          v: 0,
          hasV: false,
          lat: null,
          lon: null,
        };
        out.set(key, entry);
      }
      entry.n += this.weight(r);
      if (mi != null) {
        const m = this.rows[r][mi];
        if (m != null) {
          entry.v += m;
          entry.hasV = true;
        }
      }
      if (entry.lat == null) {
        const p = this.townPoints[`${name}|${entry.district || ''}`];
        if (p) {
          entry.lon = p[0];
          entry.lat = p[1];
        }
      }
    }

    const list = [...out.values()].sort((a, b) => b.n - a.n);
    for (const t of list) t.v = t.hasV ? round(t.v) : null;
    return list;
  }

  /**
   * The selection as map features: one per town, at the town's own point, with
   * `n`, the records it holds in the selection. Never a record and never the
   * place of one event: the site holds statistics (2026-11-06). `loc` is always
   * `approximate`, the town's point.
   */
  features(selection) {
    return this.towns(selection)
      .filter((t) => t.lat != null && t.lon != null)
      .map((t) => ({
        row: null,
        id: null,
        code: this.code,
        slug: this.slug,
        lat: t.lat,
        lon: t.lon,
        n: t.n,
        date: null,
        town: t.name,
        district: t.district,
        loc: 'approximate',
        basis: null,
      }));
  }
}

/** No record is placed on the site: kept so older callers read an empty map. */
export function placedBy() {
  return Promise.resolve(new Map());
}

/** A type's statistics, ready to query. */
export async function dataset(slug) {
  const key = `__ds__${slug}`;
  if (!cache.has(key)) cache.set(key, records(slug).then((p) => new Dataset(p)));
  return cache.get(key);
}

/* ------------------------------------------------------------------ helpers */

function round(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * Put the empty months back.
 *
 * A gap in a monthly series is a month with no records, and a line chart that
 * simply joins February to May draws a slope through a quiet quarter as though
 * it were a trend. The zeroes are the finding.
 */
function fillMonths(buckets, blank = () => ({ n: 0, v: null })) {
  if (buckets.length < 2) return buckets;
  const out = [];
  const [y0, m0] = buckets[0].key.split('-').map(Number);
  const last = buckets[buckets.length - 1].key;
  const have = new Map(buckets.map((b) => [b.key, b]));
  let y = y0;
  let m = m0;
  for (let guard = 0; guard < 600; guard++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(have.get(key) || { key, ...blank() });
    if (key === last) break;
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ numbers */

export function fmt(n, digits = 0) {
  if (n == null) return 'n/a';
  return n.toLocaleString('en-GB', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Hectares, rounded the way the figure deserves rather than to a fixed place. */
export function fmtArea(n) {
  if (n == null) return 'n/a';
  if (n >= 1000) return fmt(Math.round(n));
  if (n >= 10) return fmt(n, 1);
  return fmt(n, 2);
}

export function fmtMeasure(n, unit) {
  return unit === 'ha' ? fmtArea(n) : fmt(n);
}

export function pct(n) {
  if (n == null) return 'n/a';
  return `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;
}
