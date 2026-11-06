/* The corpus's layers on a GL map, shared by the platform and the
 * investigations.
 *
 * Each function here takes the handle `glMap` returns and gives back a small
 * object that keeps its own state (data, filter, visibility) and reinstalls
 * itself after a base-map switch, so a page only says *what* to show.
 *
 * The drawing rules are the site's:
 *   - every kind of record keeps its own colour and nothing is added across
 *     kinds;
 *   - the site holds statistics, never records (the data owner, 2026-11-06):
 *     fires and white phosphorus are counted at their town, one mark per town
 *     and kind at the town's own point, its area growing with the records
 *     there (a circle for fires, a diamond for white phosphorus); a mark
 *     places the town, never an event in it;
 *   - displacement orders shade the whole municipality, darker with more
 *     records, and a municipality with none stays unshaded;
 *   - a change mapped in the Village Studio appears on the day it was first
 *     seen, which is when it entered the record, not when it happened.
 */

import { add, layer } from './gl.js';
import { mix, palette, typeColor, typeRamp } from './theme.js';
import { toDay } from './strip.js';

/** A day far past any record: map filters take finite numbers only. */
const FAR = 1e7;

export const KINDS = [
  { code: 'BRN', slug: 'fires', short: 'Fires', long: 'Fire', form: 'points', measure: 'area_ha', unit: 'ha burned' },
  // Detonations are hidden for now: their collection is not complete (the data
  // owner, 2026-11-06). To show them again: { code: 'DET', slug: 'detonations',
  // short: 'Detonations', long: 'Detonation or demolition', form: 'towns' },
  // and DET back in spec.TYPES.
  { code: 'WPB', slug: 'phosphorus', short: 'White phosphorus', long: 'White phosphorus attack', form: 'points', shape: 'diamond' },
  { code: 'ALR', slug: 'displacement', short: 'Displacement orders', long: 'Forced displacement order', form: 'towns' },
  // Attacks on towns are hidden for now (the data owner, 2026-11-05). To show
  // them again: { code: 'ATT', slug: 'strikes', short: 'Attacks on towns',
  // long: 'Attack on a town', form: 'points' }, and ATT back in spec.TYPES.
];
export const KIND = Object.fromEntries(KINDS.map((k) => [k.code, k]));

/** A fire with no attack linked to it (in the yellow-line zone or round
 * Beaufort Castle): the fire's orange, paled, so the two read apart. */
export const FIRE_UNLINKED = '#f0b25e';

/** The colour expression for a mark's kind, read from the site's tokens. */
function kindMatch() {
  const out = ['match', ['get', 't']];
  for (const k of KINDS) out.push(k.code, typeColor(k.code));
  out.push('#888888');
  return out;
}

/* --------------------------------------------------------------- marks */

/**
 * How big a town's mark is drawn: its radius grows with the square root of
 * the records it holds, so its area grows with their number, never smaller
 * than one record can be seen and never so large it buries the towns round
 * it. Each stop: [zoom, pixels per square root of a record, least, most].
 */
const MARK_SCALE = [
  [7, 1.5, 2.4, 9],
  [9, 2.3, 3, 14],
  [11, 3.3, 3.8, 20],
  [13, 4.5, 4.8, 27],
  [16, 6.4, 6.4, 36],
];
/** The mark images' radius, in CSS pixels at icon-size 1. */
const MARK_R = 12;
/** A diamond's half-diagonal against a circle's radius, for the same area. */
const DIAMOND = Math.sqrt(Math.PI / 2);
/** The layers a pointer can find a town's mark on. */
const MARK_LAYERS = ['marks'];

/** The radius in CSS pixels of a circle mark holding `n` records, at `zoom`. */
export function markRadius(zoom, n) {
  const at = ([, c, lo, hi]) => Math.max(lo, Math.min(hi, c * Math.sqrt(Math.max(1, n))));
  const s = MARK_SCALE;
  if (zoom <= s[0][0]) return at(s[0]);
  for (let i = 0; i < s.length - 1; i++) {
    if (zoom <= s[i + 1][0]) {
      const t = (zoom - s[i][0]) / (s[i + 1][0] - s[i][0]);
      return at(s[i]) + (at(s[i + 1]) - at(s[i])) * t;
    }
  }
  return at(s[s.length - 1]);
}

/** The same radius as a map expression, per feature (`n`, `t`) and zoom. */
function markExpr(fn) {
  const n = ['max', 1, ['to-number', ['coalesce', ['get', 'n'], 1], 1]];
  const shape = ['case', ['==', ['get', 't'], 'WPB'], DIAMOND, 1];
  const out = ['interpolate', ['linear'], ['zoom']];
  for (const [z, c, lo, hi] of MARK_SCALE) out.push(z, fn(['*', shape, ['max', lo, ['min', hi, ['*', c, ['sqrt', n]]]]]));
  return out;
}

/**
 * A circle and a diamond as signed distance fields, so one image draws every
 * size crisply and the halo round it follows its edge.
 */
function addMarkShapes(map) {
  const size = 64;
  const r = 2 * MARK_R;
  const buffer = 8;
  const shapes = {
    'mark-circle': (x, y) => Math.hypot(x, y) - r,
    'mark-diamond': (x, y) => (Math.abs(x) + Math.abs(y) - r) / Math.SQRT2,
  };
  for (const [name, distance] of Object.entries(shapes)) {
    if (map.hasImage(name)) continue;
    const data = new Uint8Array(size * size * 4);
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const d = distance(i + 0.5 - size / 2, j + 0.5 - size / 2);
        data[(j * size + i) * 4 + 3] = Math.round(255 * Math.max(0, Math.min(1, 0.75 - d / buffer)));
      }
    }
    map.addImage(name, { width: size, height: size, data }, { sdf: true, pixelRatio: 2 });
  }
}

/**
 * One mark per town and kind. `set(features)` takes GeoJSON points at the
 * town's own point whose properties carry `t` (the kind), `n` (the records of
 * that kind at the town, in the selection) and `k` (the town's key). Every
 * mark is in one layer, the smaller drawn over the larger, so a town's white
 * phosphorus diamond and its fire circle both stay in sight.
 */
export function marksLayer(handle, { onPick = null, onHover = null } = {}) {
  const { map } = handle;
  const state = { data: { type: 'FeatureCollection', features: [] }, selected: '' };

  function install() {
    const p = palette();
    addMarkShapes(map);
    add(map, 'marks', { type: 'geojson', data: state.data });
    layer(map, {
      id: 'marks',
      type: 'symbol',
      source: 'marks',
      layout: {
        'icon-image': ['case', ['==', ['get', 't'], 'WPB'], 'mark-diamond', 'mark-circle'],
        'icon-size': markExpr((r) => ['/', r, MARK_R]),
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'symbol-sort-key': ['-', 0, ['to-number', ['coalesce', ['get', 'n'], 1], 1]],
      },
      paint: {
        'icon-color': kindMatch(),
        'icon-opacity': 0.9,
        'icon-halo-color': p.card || '#ffffff',
        'icon-halo-width': 1.6,
      },
    });
    layer(map, {
      id: 'marks-selected',
      type: 'circle',
      source: 'marks',
      filter: ['==', ['get', 'k'], state.selected],
      paint: {
        'circle-radius': markExpr((r) => ['+', r, 3.5]),
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': p.ink1,
        'circle-stroke-width': 2,
      },
    });
  }
  handle.overlay(install);

  for (const id of MARK_LAYERS) {
    map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', id, () => {
      map.getCanvas().style.cursor = '';
      if (onHover) onHover(null);
    });
    if (onPick) map.on('click', id, (e) => e.features && e.features[0] && onPick(e.features[0].properties, e));
    if (onHover) map.on('mousemove', id, (e) => e.features && e.features[0] && onHover(e.features[0].properties, e));
  }

  return {
    layers: MARK_LAYERS,
    set(features) {
      state.data = { type: 'FeatureCollection', features };
      const src = map.getSource('marks');
      if (src) src.setData(state.data);
    },
    /** Ring the marks of one town, by its key; null rings none. */
    select(key) {
      state.selected = key || '';
      if (map.getLayer('marks-selected')) map.setFilter('marks-selected', ['==', ['get', 'k'], state.selected]);
    },
  };
}

/** The marks' former name, kept so a page written before the site held
 * statistics still loads; it now draws towns, never records. */
export const recordsLayer = marksLayer;

/* --------------------------------------------------------------- towns */

/**
 * Municipalities: shaded by one kind's count, outlined for a second.
 *
 * `shade(code, counts)` takes {pcod: n}. The scale is square-root against the
 * peak given (or found), so a few heavily recorded places do not flatten the
 * rest into the palest step; a place with no record stays unshaded.
 */
export function townsLayer(handle, shapes, { onPick = null, onHover = null } = {}) {
  const { map } = handle;
  const state = { code: null, counts: {}, peak: 1, mark: null, marks: new Set(), selected: null, hover: null, lines: true, keep: null };

  function rampExpression() {
    const ramp = typeRamp(state.code || 'ALR', 6);
    const expr = ['interpolate', ['linear'], ['coalesce', ['feature-state', 'v'], 0], 0, ramp[0]];
    ramp.forEach((c, i) => {
      if (i) expr.push(i / (ramp.length - 1), c);
    });
    return expr;
  }

  function installFill() {
    add(map, 'towns', { type: 'geojson', data: shapes, promoteId: 'pcod' });
    layer(map, {
      id: 'towns-fill',
      type: 'fill',
      source: 'towns',
      paint: {
        'fill-color': rampExpression(),
        // Strong over the region, faint over a village, where the ground
        // itself (burn scars, the Studio's damage) is what to read.
        'fill-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          9,
          ['case', ['>', ['coalesce', ['feature-state', 'v'], 0], 0], 0.84, 0],
          12,
          ['case', ['>', ['coalesce', ['feature-state', 'v'], 0], 0], 0.42, 0],
          14.5,
          ['case', ['>', ['coalesce', ['feature-state', 'v'], 0], 0], 0.16, 0],
        ],
      },
    });
    paint();
  }

  function installLines() {
    const p = palette();
    // Everything outside the places a view is about, faded, so an investigation
    // shows its own ground and the rest of the south recedes.
    layer(map, {
      id: 'towns-veil',
      type: 'fill',
      source: 'towns',
      paint: {
        'fill-color': p.map.land || '#f3f1ec',
        'fill-opacity': ['case', ['boolean', ['feature-state', 'out'], false], 0.72, 0],
      },
    });
    layer(map, {
      id: 'towns-line',
      type: 'line',
      source: 'towns',
      minzoom: 8.5,
      layout: { visibility: state.lines ? 'visible' : 'none' },
      paint: {
        'line-color': p.map.stroke,
        'line-width': ['interpolate', ['linear'], ['zoom'], 8.5, 0.25, 12, 0.8],
        'line-opacity': 0.7,
      },
    });
    layer(map, {
      id: 'towns-mark',
      type: 'line',
      source: 'towns',
      paint: {
        'line-color': typeColor(state.mark || 'ALR'),
        // Zoom must be the outermost input, so the case sits inside each stop.
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          8,
          ['case', ['==', ['coalesce', ['feature-state', 'm'], 0], 1], 0.7, 0],
          12,
          ['case', ['==', ['coalesce', ['feature-state', 'm'], 0], 1], 1.6, 0],
        ],
        'line-opacity': 0.75,
      },
    });
    layer(map, {
      id: 'towns-hover',
      type: 'line',
      source: 'towns',
      paint: {
        'line-color': p.ink2,
        'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 1.6, ['boolean', ['feature-state', 'sel'], false], 2.6, 0],
      },
    });
    paint();
  }
  handle.overlay(installFill);

  function paint() {
    if (!map.getSource('towns')) return;
    map.removeFeatureState({ source: 'towns' });
    const peak = Math.max(1, state.peak);
    if (state.code) {
      for (const [pcod, n] of Object.entries(state.counts)) {
        if (n > 0) map.setFeatureState({ source: 'towns', id: pcod }, { v: Math.max(0.02, Math.sqrt(n / peak)) });
      }
    }
    for (const pcod of state.marks) map.setFeatureState({ source: 'towns', id: pcod }, { m: 1 });
    if (state.selected) map.setFeatureState({ source: 'towns', id: state.selected }, { sel: true });
    if (state.keep) {
      for (const f of shapes.features) {
        const pcod = f.properties.pcod;
        if (!state.keep.has(pcod)) map.setFeatureState({ source: 'towns', id: pcod }, { out: true });
      }
    }
    if (map.getLayer('towns-fill')) map.setPaintProperty('towns-fill', 'fill-color', rampExpression());
    if (map.getLayer('towns-mark')) map.setPaintProperty('towns-mark', 'line-color', typeColor(state.mark || 'ALR'));
  }

  map.on('mousemove', 'towns-fill', (e) => {
    const f = e.features && e.features[0];
    if (!f) return;
    if (state.hover && state.hover !== f.id) map.setFeatureState({ source: 'towns', id: state.hover }, { hover: false });
    state.hover = f.id;
    map.setFeatureState({ source: 'towns', id: f.id }, { hover: true });
    if (onHover) onHover(f.properties, e, state.counts[f.id] || 0);
  });
  map.on('mouseleave', 'towns-fill', () => {
    if (state.hover) map.setFeatureState({ source: 'towns', id: state.hover }, { hover: false });
    state.hover = null;
    if (onHover) onHover(null);
  });
  if (onPick) {
    map.on('click', 'towns-fill', (e) => {
      // A town's mark or a region's label under the pointer wins: the place
      // opens only from bare ground.
      const hits = map.queryRenderedFeatures(e.point, { layers: [...MARK_LAYERS, 'regions-label'].filter((id) => map.getLayer(id)) });
      if (hits.length) return;
      const f = e.features && e.features[0];
      if (f) onPick(f.properties, e);
    });
  }

  return {
    /** Register the outlines; call after the layers that belong between. */
    outlines() {
      handle.overlay(installLines);
    },
    shade(code, counts, peak = null) {
      state.code = code;
      state.counts = counts || {};
      state.peak = peak || Math.max(1, ...Object.values(state.counts));
      paint();
    },
    mark(code, pcods) {
      state.mark = code;
      state.marks = new Set(pcods || []);
      paint();
    },
    select(pcod) {
      state.selected = pcod || null;
      paint();
    },
    lines(on) {
      state.lines = Boolean(on);
      if (map.getLayer('towns-line')) map.setLayoutProperty('towns-line', 'visibility', on ? 'visible' : 'none');
    },
    /** Keep only these municipalities in full; fade every other. null: none faded. */
    keep(pcods) {
      state.keep = pcods && pcods.length ? new Set(pcods) : null;
      paint();
    },
    get code() {
      return state.code;
    },
    get peak() {
      return state.peak;
    },
  };
}

/* --------------------------------------------------------- ground layers */

function visibility(map, ids, on) {
  for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
}

/**
 * Burned ground (`data/geo/burned.geojson`): the ground the published fires
 * burned, merged by the month each fire began, one feature a month with `d`
 * its first day. A month is drawn while the dates shown reach into it. It
 * carries no fire and no town, so no filter but the dates applies to it.
 */
export function scarsLayer(handle, data) {
  const { map } = handle;
  for (const f of data.features) {
    const d = f.properties.d;
    f.properties.dd = d ? toDay(d) : 0;
    f.properties.de = d ? toDay(monthEnd(d)) : FAR;
  }
  const state = { on: true, until: FAR, from: -FAR };
  const filter = () => ['all', ['<=', ['get', 'dd'], state.until], ['>=', ['get', 'de'], state.from]];

  function install() {
    add(map, 'scars', { type: 'geojson', data });
    const c = typeColor('BRN');
    layer(map, {
      id: 'scars-fill',
      type: 'fill',
      source: 'scars',
      filter: filter(),
      layout: { visibility: state.on ? 'visible' : 'none' },
      paint: { 'fill-color': c, 'fill-opacity': 0.4 },
    });
    layer(map, {
      id: 'scars-line',
      type: 'line',
      source: 'scars',
      filter: filter(),
      layout: { visibility: state.on ? 'visible' : 'none' },
      paint: { 'line-color': mix(c, '#000000', 0.25), 'line-width': 0.8 },
    });
  }
  handle.overlay(install);
  return {
    show(on) {
      state.on = Boolean(on);
      visibility(map, ['scars-fill', 'scars-line'], state.on);
    },
    window(fromIso, toIso) {
      state.from = fromIso ? toDay(fromIso) : -FAR;
      state.until = toIso ? toDay(toIso) : FAR;
      for (const id of ['scars-fill', 'scars-line']) if (map.getLayer(id)) map.setFilter(id, filter());
    },
    get on() {
      return state.on;
    },
  };
}

/** The last day of the month an ISO date falls in. */
function monthEnd(iso) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** The yellow-line zone and the named places held with it, from their first day. */
export function zonesLayer(handle, data) {
  const { map } = handle;
  for (const f of data.features) {
    f.properties.df = f.properties.valid_from ? toDay(f.properties.valid_from) : 0;
    f.properties.dt = f.properties.valid_to ? toDay(f.properties.valid_to) : 999999;
  }
  const state = { on: false, at: FAR };
  const filter = () => ['all', ['<=', ['get', 'df'], state.at], ['>=', ['get', 'dt'], state.at === FAR ? 0 : state.at]];
  function install() {
    const c = palette().map.zone;
    add(map, 'zones', { type: 'geojson', data });
    layer(map, {
      id: 'zones-fill',
      type: 'fill',
      source: 'zones',
      filter: filter(),
      layout: { visibility: state.on ? 'visible' : 'none' },
      paint: { 'fill-color': c, 'fill-opacity': 0.08 },
    });
    layer(map, {
      id: 'zones-line',
      type: 'line',
      source: 'zones',
      filter: filter(),
      layout: { visibility: state.on ? 'visible' : 'none' },
      paint: { 'line-color': c, 'line-width': 1.6, 'line-dasharray': [3, 2] },
    });
  }
  handle.overlay(install);
  return {
    show(on) {
      state.on = Boolean(on);
      visibility(map, ['zones-fill', 'zones-line'], state.on);
    },
    at(iso) {
      state.at = iso ? toDay(iso) : FAR;
      for (const id of ['zones-fill', 'zones-line']) if (map.getLayer(id)) map.setFilter(id, filter());
    },
    get on() {
      return state.on;
    },
  };
}

/* ------------------------------------------------------------- regions */

const SHORT_DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const SHORT_MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
// A region's first and last orders are given by month ("2026-04"): never a day.
const shortDay = (iso) =>
  iso && iso.length <= 7 ? SHORT_MONTH.format(new Date(`${iso}-01T00:00:00Z`)) : SHORT_DAY.format(new Date(`${iso}T00:00:00Z`));

/**
 * Displacement orders addressed to a whole region: everyone south of a river,
 * Beirut's southern suburbs, Tyre with its camps, the sea off Tyre. Each area
 * is drawn from the words of its orders, since their own maps are not held,
 * and shows while at least one of its orders is in the dates shown, its label
 * saying how many. An order is counted on a town only where it names the town
 * too.
 *
 * The orders are counted by week (`weeks`: the Monday, and the orders that
 * week). A week is in the dates shown when its Monday is, which is all the
 * file can say: no order is listed one by one.
 *
 * The fill registers at once, so it lies under the town shading and a town
 * named by its own order still reads on top; `above()` registers the outline
 * and the label, to be called once the layers between are in.
 */
export function regionsLayer(handle, data, { onPick = null, onHover = null } = {}) {
  const { map, kind } = handle;
  const areas = data.features;
  const byPcod = new Map();
  for (const f of areas) {
    for (const pcod of f.properties.pcods || []) {
      if (!byPcod.has(pcod)) byPcod.set(pcod, []);
      if (!byPcod.get(pcod).includes(f.properties.key)) byPcod.get(pcod).push(f.properties.key);
    }
  }
  const color = typeColor('ALR');
  const ink = mix(color, '#000000', 0.38);
  const state = { on: true, from: null, to: null, selected: null, shapes: { type: 'FeatureCollection', features: [] }, labels: { type: 'FeatureCollection', features: [] } };

  const find = (key) => areas.find((f) => f.properties.key === key) || null;
  /** The orders of an area in the dates shown: its weeks whose Monday is in them. */
  const held = (f) => {
    let n = 0;
    for (const [monday, count] of Object.entries(f.properties.weeks || {})) {
      if (state.from && monday < state.from) continue;
      if (state.to && monday > state.to) continue;
      n += count;
    }
    return n;
  };

  function compute() {
    const shapes = [];
    const labels = [];
    for (const f of areas) {
      const n = held(f);
      if (!n) continue;
      const p = f.properties;
      // The first and last day are the area's own; they are said only while
      // every one of its orders is in view.
      const span = n === p.n && p.first ? `, ${p.first === p.last ? shortDay(p.first) : `${shortDay(p.first)} to ${shortDay(p.last)}`}` : '';
      const props = { key: p.key, n, sea: p.kind === 'sea' ? 1 : 0, sel: state.selected === p.key ? 1 : 0 };
      shapes.push({ type: 'Feature', geometry: f.geometry, properties: props });
      labels.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: p.label },
        properties: { ...props, km2: p.km2 || 0, text: `${p.short || p.name}\n${n === 1 ? '1 order' : `${n} orders`}${span}` },
      });
    }
    state.shapes = { type: 'FeatureCollection', features: shapes };
    state.labels = { type: 'FeatureCollection', features: labels };
  }

  function push() {
    const a = map.getSource('regions');
    const b = map.getSource('region-labels');
    if (a) a.setData(state.shapes);
    if (b) b.setData(state.labels);
  }

  const vis = () => (state.on ? 'visible' : 'none');

  function installFill() {
    add(map, 'regions', { type: 'geojson', data: state.shapes });
    layer(map, {
      id: 'regions-fill',
      type: 'fill',
      source: 'regions',
      layout: { visibility: vis() },
      paint: {
        'fill-color': color,
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 7, ['case', ['==', ['get', 'sea'], 1], 0.1, 0.17], 11, ['case', ['==', ['get', 'sea'], 1], 0.07, 0.1], 14, 0.04],
      },
    });
  }

  function installLine() {
    layer(map, {
      id: 'regions-line',
      type: 'line',
      source: 'regions',
      layout: { visibility: vis(), 'line-join': 'round' },
      paint: {
        'line-color': color,
        'line-width': ['case', ['==', ['get', 'sel'], 1], 3.2, 1.7],
        'line-opacity': 0.95,
        'line-dasharray': [3, 1.6],
      },
    });
  }

  // Above the town names, so a region's name is placed first and is not
  // crowded out by them; past village scale it gives way.
  function installLabel() {
    add(map, 'region-labels', { type: 'geojson', data: state.labels });
    if (map.getLayer('regions-label')) return;
    map.addLayer({
      id: 'regions-label',
      type: 'symbol',
      source: 'region-labels',
      maxzoom: 11.5,
      layout: {
        visibility: vis(),
        'text-field': ['get', 'text'],
        'text-font': kind === 'mapbox' ? ['DIN Pro Medium', 'Arial Unicode MS Regular'] : ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 7, 11, 10, 13.5],
        'text-line-height': 1.25,
        'text-max-width': 18,
        'text-padding': 4,
        // The larger region places first; each label may shift off its point
        // to make room for the others.
        'symbol-sort-key': ['-', 0, ['get', 'km2']],
        'text-variable-anchor': ['center', 'top', 'bottom', 'left', 'right'],
        'text-radial-offset': 0.6,
      },
      paint: { 'text-color': ink, 'text-halo-color': 'rgba(255,255,255,0.94)', 'text-halo-width': 1.8 },
    });
  }

  compute();
  handle.overlay(installFill);

  // The sea has no municipality over it, so the area opens from the water
  // itself; on land a click opens the place, whose card names its areas.
  const covered = (e) => {
    const ids = ['towns-fill', ...MARK_LAYERS].filter((id) => map.getLayer(id));
    return ids.length ? map.queryRenderedFeatures(e.point, { layers: ids }).length > 0 : false;
  };
  map.on('click', 'regions-fill', (e) => {
    if (!onPick || covered(e)) return;
    const f = e.features && e.features[0];
    if (f) onPick(f.properties.key, e);
  });
  map.on('click', 'regions-label', (e) => {
    // A town's mark under the name still wins.
    const marks = MARK_LAYERS.filter((id) => map.getLayer(id));
    if (marks.length && map.queryRenderedFeatures(e.point, { layers: marks }).length) return;
    const f = e.features && e.features[0];
    if (onPick && f) onPick(f.properties.key, e);
  });
  map.on('mousemove', 'regions-fill', (e) => {
    if (!onHover) return;
    if (covered(e)) return;
    const f = e.features && e.features[0];
    onHover(f ? f.properties.key : null, e);
  });
  map.on('mouseleave', 'regions-fill', () => onHover && onHover(null));
  for (const id of ['regions-label']) {
    map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''));
  }

  return {
    /** Register the outline and the label; call after the layers between. */
    above() {
      handle.overlay(installLine);
      handle.overlay(installLabel, { top: true });
    },
    show(on) {
      state.on = Boolean(on);
      visibility(map, ['regions-fill', 'regions-line', 'regions-label'], state.on);
    },
    /** The dates shown, as ISO days (either may be null: no bound). */
    window(from, to) {
      state.from = from || null;
      state.to = to || null;
      compute();
      push();
    },
    select(key) {
      state.selected = key || null;
      compute();
      push();
    },
    /** An area's properties, with `count`, its orders in the dates shown. */
    area(key) {
      const f = find(key);
      return f ? { ...f.properties, count: held(f), geometry: f.geometry } : null;
    },
    /** The areas with an order in the dates shown that take in a municipality. */
    containing(pcod) {
      return (byPcod.get(pcod) || [])
        .map((key) => this.area(key))
        .filter((a) => a && a.count);
    },
    /** How many areas have an order in view. */
    get count() {
      return state.shapes.features.length;
    },
    get on() {
      return state.on;
    },
  };
}

/* ------------------------------------------------------ reference layers */

const textFont = (kind) => (kind === 'mapbox' ? ['DIN Pro Medium', 'Arial Unicode MS Regular'] : ['Noto Sans Regular']);

/** A layer whose data is fetched the first time it is switched on. */
function lazy(load) {
  let promise = null;
  return () => (promise = promise || load().catch(() => ({ type: 'FeatureCollection', features: [] })));
}

const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * Land use and land cover in 2025, the year before the war: Impact
 * Observatory's Sentinel-2 10 m map (with Microsoft and Esri, CC BY 4.0),
 * rendered by Esri's image service in the site's own colours, so built ground
 * reads grey and does not compete with the records' reds.
 */
export const COVER_CLASSES = [
  { v: 2, label: 'Trees', color: '#3f7d3a' },
  { v: 11, label: 'Rangeland', color: '#cbb994' },
  { v: 5, label: 'Crops', color: '#e3c86b' },
  { v: 7, label: 'Built area', color: '#9a9087' },
  { v: 8, label: 'Bare ground', color: '#d9cbb5' },
  { v: 4, label: 'Flooded vegetation', color: '#7fa36b' },
  { v: 1, label: 'Water', color: '#b9bac6' },
];
const COVER_URL = (() => {
  const colormap = [...COVER_CLASSES.map((c) => [c.v, ...hexRgb(c.color)]), [9, 255, 255, 255], [10, 238, 238, 238]];
  const q = new URLSearchParams({
    bboxSR: '3857',
    imageSR: '3857',
    size: '256,256',
    format: 'png32',
    transparent: 'true',
    f: 'image',
    // The year 2025: the land as it was before the war of 2026.
    time: '1735689600000,1767225599000',
    renderingRule: JSON.stringify({ rasterFunction: 'Colormap', rasterFunctionArguments: { Colormap: colormap }, variableName: 'Raster' }),
  });
  return `https://ic.imagery1.arcgis.com/arcgis/rest/services/Sentinel2_10m_LandCover/ImageServer/exportImage?bbox={bbox-epsg-3857}&${q}`;
})();

export function coverLayer(handle) {
  const { map } = handle;
  const state = { on: false };
  // Added only once it is switched on: its tiles are drawn on request by a
  // remote image service, and a source present at load would hold the whole
  // map back until every one of them had arrived.
  function install() {
    if (!state.on) return;
    add(map, 'cover', {
      type: 'raster',
      tiles: [COVER_URL],
      tileSize: 256,
      minzoom: 7,
      maxzoom: 15,
      attribution: 'Land cover 2025: Impact Observatory, Microsoft, Esri (CC BY 4.0)',
    });
    // Under the mask that greys out the land beyond Lebanon's borders.
    layer(
      map,
      {
        id: 'cover',
        type: 'raster',
        source: 'cover',
        layout: { visibility: state.on ? 'visible' : 'none' },
        paint: { 'raster-opacity': 0.62, 'raster-resampling': 'nearest' },
      },
      'lebanon-mask'
    );
  }
  handle.overlay(install);
  return {
    show(on) {
      state.on = Boolean(on);
      if (state.on && !map.getLayer('cover')) install();
      visibility(map, ['cover'], state.on);
    },
    get on() {
      return state.on;
    },
  };
}

/** Rivers, streams and canals, lakes, reservoirs and ponds, from OpenStreetMap. */
export function waterLayer(handle, load) {
  const { map, kind } = handle;
  const state = { on: false, data: { type: 'FeatureCollection', features: [] } };
  const fetchData = lazy(load);
  const ids = ['water-area', 'water-line', 'water-name'];
  const polygon = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
  const line = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
  function install() {
    const vis = state.on ? 'visible' : 'none';
    add(map, 'water', { type: 'geojson', data: state.data });
    layer(map, { id: 'water-area', type: 'fill', source: 'water', filter: polygon, layout: { visibility: vis }, paint: { 'fill-color': '#a9a6cf', 'fill-opacity': 0.6 } });
    layer(map, {
      id: 'water-line',
      type: 'line',
      source: 'water',
      filter: line,
      layout: { visibility: vis, 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#6f6a9c',
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, ['match', ['get', 'k'], 'river', 1.3, 0.45], 13, ['match', ['get', 'k'], 'river', 3.2, 1.3]],
        'line-opacity': 0.9,
      },
    });
    layer(map, {
      id: 'water-name',
      type: 'symbol',
      source: 'water',
      minzoom: 11,
      filter: ['all', line, ['has', 'n']],
      layout: { visibility: vis, 'symbol-placement': 'line', 'text-field': ['get', 'n'], 'text-font': textFont(kind), 'text-size': 11, 'symbol-spacing': 360 },
      paint: { 'text-color': '#4d4880', 'text-halo-color': 'rgba(255,255,255,0.9)', 'text-halo-width': 1.2 },
    });
  }
  handle.overlay(install);
  return {
    show(on) {
      state.on = Boolean(on);
      visibility(map, ids, state.on);
      if (state.on) {
        fetchData().then((data) => {
          state.data = data;
          const src = map.getSource('water');
          if (src) src.setData(data);
        });
      }
    },
    get on() {
      return state.on;
    },
  };
}

/** The kinds of place, each a small mark of its own shape. */
export const PLACE_GROUPS = {
  culture: { label: 'Cultural sites and places of worship', color: '#7a4b2a', shape: 'square' },
  health: { label: 'Hospitals and clinics', color: '#2f2e2b', shape: 'plus' },
  education: { label: 'Schools and universities', color: '#5c6b2e', shape: 'triangle' },
};

/** Draw the place marks once, as single-colour images tinted by `icon-color`. */
function addPlaceShapes(map) {
  const size = 40;
  const draw = {
    square: (ctx) => ctx.fillRect(8, 8, 24, 24),
    plus: (ctx) => {
      ctx.fillRect(15, 5, 10, 30);
      ctx.fillRect(5, 15, 30, 10);
    },
    triangle: (ctx) => {
      ctx.beginPath();
      ctx.moveTo(20, 5);
      ctx.lineTo(35, 33);
      ctx.lineTo(5, 33);
      ctx.closePath();
      ctx.fill();
    },
  };
  for (const [name, fn] of Object.entries(draw)) {
    if (map.hasImage(`place-${name}`)) continue;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    fn(ctx);
    map.addImage(`place-${name}`, { width: size, height: size, data: ctx.getImageData(0, 0, size, size).data }, { sdf: true, pixelRatio: 2 });
  }
}

/** Cultural sites, health sites and schools, from OpenStreetMap. */
export function placesLayer(handle, load, { onHover = null } = {}) {
  const { map, kind } = handle;
  const state = { on: false, data: { type: 'FeatureCollection', features: [] } };
  const fetchData = lazy(load);
  const ids = ['places-mark', 'places-name'];
  const colour = ['match', ['get', 'g'], ...Object.entries(PLACE_GROUPS).flatMap(([g, x]) => [g, x.color]), '#555555'];
  const shape = ['match', ['get', 'g'], ...Object.entries(PLACE_GROUPS).flatMap(([g, x]) => [g, `place-${x.shape}`]), 'place-square'];
  function install() {
    const vis = state.on ? 'visible' : 'none';
    addPlaceShapes(map);
    add(map, 'places', { type: 'geojson', data: state.data });
    layer(map, {
      id: 'places-mark',
      type: 'symbol',
      source: 'places',
      layout: {
        visibility: vis,
        'icon-image': shape,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.22, 11, 0.36, 14, 0.55],
        'icon-allow-overlap': true,
      },
      paint: { 'icon-color': colour, 'icon-halo-color': '#ffffff', 'icon-halo-width': 0.8, 'icon-opacity': 0.9 },
    });
    layer(map, {
      id: 'places-name',
      type: 'symbol',
      source: 'places',
      minzoom: 13,
      filter: ['has', 'n'],
      layout: { visibility: vis, 'text-field': ['get', 'n'], 'text-font': textFont(kind), 'text-size': 10.5, 'text-offset': [0, 1.0], 'text-anchor': 'top', 'text-max-width': 10 },
      paint: { 'text-color': colour, 'text-halo-color': 'rgba(255,255,255,0.92)', 'text-halo-width': 1.2 },
    });
  }
  handle.overlay(install);
  if (onHover) {
    map.on('mousemove', 'places-mark', (e) => e.features && e.features[0] && onHover(e.features[0].properties, e));
    map.on('mouseleave', 'places-mark', () => onHover(null));
  }
  return {
    show(on) {
      state.on = Boolean(on);
      visibility(map, ids, state.on);
      if (state.on) {
        fetchData().then((data) => {
          state.data = data;
          const src = map.getSource('places');
          if (src) src.setData(data);
        });
      }
    },
    get on() {
      return state.on;
    },
  };
}

/** Load an image with either library: MapLibre returns a promise, Mapbox calls back. */
function loadImage(map, url) {
  return new Promise((resolve, reject) => {
    const r = map.loadImage(url, (err, img) => (err ? reject(err) : resolve(img)));
    if (r && typeof r.then === 'function') r.then((x) => resolve(x && x.data ? x.data : x), reject);
  });
}

export const ECO_GROUPS = {
  wildlife: { label: 'Wildlife', color: '#8a5a2b' },
  tree: { label: 'Trees and shrubs', color: '#2f6b2f' },
};

/**
 * The wildlife and trees Green Southerners recorded across the south in 2023
 * and 2024, before this war: a dot per record from afar, the species' own
 * picture once the map is close enough to tell them apart.
 */
export function ecoLayer(handle, load, { base = null, onHover = null } = {}) {
  const { map } = handle;
  const state = { on: false, data: { type: 'FeatureCollection', features: [] }, species: [] };
  const fetchData = lazy(load);
  const ids = ['eco-icon'];
  // Each record is its species' own picture, at every zoom, scaled by the size
  // the species had on the Flourish map (`z`, about 1 to 4), so the map reads
  // as it did there: small across the south, larger close in.
  const scaled = (f) => ['*', f, ['coalesce', ['get', 'z'], 2]];
  async function addIcons() {
    for (const s of state.species) {
      const id = `eco-${s.key}`;
      if (map.hasImage(id)) continue;
      try {
        const img = await loadImage(map, new URL(s.icon, base || location.href).href);
        if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio: 1 });
      } catch (err) {
        /* a missing picture leaves its records unseen, not wrong */
      }
    }
  }
  function install() {
    const vis = state.on ? 'visible' : 'none';
    add(map, 'eco', { type: 'geojson', data: state.data });
    layer(map, {
      id: 'eco-icon',
      type: 'symbol',
      source: 'eco',
      layout: {
        visibility: vis,
        'icon-image': ['concat', 'eco-', ['get', 's']],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 7, scaled(0.07), 9, scaled(0.1), 11, scaled(0.16), 13, scaled(0.24), 15, scaled(0.32)],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });
    if (state.species.length) addIcons();
  }
  handle.overlay(install);
  if (onHover) {
    for (const id of ids) {
      map.on('mousemove', id, (e) => e.features && e.features[0] && onHover(e.features[0].properties, e));
      map.on('mouseleave', id, () => onHover(null));
    }
  }
  return {
    show(on) {
      state.on = Boolean(on);
      visibility(map, ids, state.on);
      if (state.on) {
        return fetchData().then((payload) => {
          state.data = { type: 'FeatureCollection', features: payload.features || [] };
          state.species = (payload.properties && payload.properties.species) || [];
          const src = map.getSource('eco');
          if (src) src.setData(state.data);
          addIcons();
          return state.species;
        });
      }
      return Promise.resolve(state.species);
    },
    get species() {
      return state.species;
    },
    get on() {
      return state.on;
    },
  };
}

/** The Litani, from OpenStreetMap, as a line with its name along it. */
export function riverLayer(handle, data, { fonts = null } = {}) {
  const { map, kind } = handle;
  const state = { on: false };
  function install() {
    add(map, 'litani', { type: 'geojson', data });
    layer(map, {
      id: 'litani-glow',
      type: 'line',
      source: 'litani',
      layout: { visibility: state.on ? 'visible' : 'none', 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 13, 8], 'line-opacity': 0.7 },
    });
    layer(map, {
      id: 'litani-line',
      type: 'line',
      source: 'litani',
      layout: { visibility: state.on ? 'visible' : 'none', 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#6f6a9c', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.4, 13, 3.6] },
    });
    layer(map, {
      id: 'litani-name',
      type: 'symbol',
      source: 'litani',
      layout: {
        visibility: state.on ? 'visible' : 'none',
        'symbol-placement': 'line',
        'text-field': 'Litani River',
        'text-font': fonts || (kind === 'mapbox' ? ['DIN Pro Medium', 'Arial Unicode MS Regular'] : ['Noto Sans Regular']),
        'text-size': 12,
        'text-letter-spacing': 0.08,
        'symbol-spacing': 420,
      },
      paint: { 'text-color': '#4d4880', 'text-halo-color': 'rgba(255,255,255,0.9)', 'text-halo-width': 1.4 },
    });
  }
  handle.overlay(install);
  return {
    show(on) {
      state.on = Boolean(on);
      visibility(map, ['litani-glow', 'litani-line', 'litani-name'], state.on);
    },
    get on() {
      return state.on;
    },
  };
}

/** Beaufort castle's footprint and name, from OpenStreetMap. */
export function landmarksLayer(handle, data) {
  const { map, kind } = handle;
  const state = { on: false };
  const points = {
    type: 'FeatureCollection',
    features: data.features.map((f) => ({ type: 'Feature', properties: f.properties, geometry: { type: 'Point', coordinates: centroid(f.geometry) } })),
  };
  function install() {
    add(map, 'landmarks', { type: 'geojson', data });
    add(map, 'landmark-points', { type: 'geojson', data: points });
    layer(map, {
      id: 'landmarks-fill',
      type: 'fill',
      source: 'landmarks',
      layout: { visibility: state.on ? 'visible' : 'none' },
      paint: { 'fill-color': '#2b2a28', 'fill-opacity': 0.55 },
    });
    layer(map, {
      id: 'landmarks-dot',
      type: 'circle',
      source: 'landmark-points',
      layout: { visibility: state.on ? 'visible' : 'none' },
      paint: { 'circle-radius': 4.5, 'circle-color': '#2b2a28', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 },
    });
    layer(map, {
      id: 'landmarks-name',
      type: 'symbol',
      source: 'landmark-points',
      layout: {
        visibility: state.on ? 'visible' : 'none',
        'text-field': ['get', 'name'],
        'text-font': kind === 'mapbox' ? ['DIN Pro Medium', 'Arial Unicode MS Regular'] : ['Noto Sans Regular'],
        'text-size': 12.5,
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#1f2220', 'text-halo-color': 'rgba(255,255,255,0.95)', 'text-halo-width': 1.6 },
    });
  }
  handle.overlay(install);
  return {
    show(on) {
      state.on = Boolean(on);
      visibility(map, ['landmarks-fill', 'landmarks-dot', 'landmarks-name'], state.on);
    },
    get on() {
      return state.on;
    },
  };
}

function centroid(geometry) {
  const rings = geometry.type === 'Polygon' ? [geometry.coordinates[0]] : geometry.type === 'MultiPolygon' ? geometry.coordinates.map((p) => p[0]) : [[geometry.coordinates]];
  let x = 0;
  let y = 0;
  let n = 0;
  for (const ring of rings) for (const [a, b] of ring) {
    x += a;
    y += b;
    n++;
  }
  return n ? [x / n, y / n] : [35.5, 33.3];
}

/* -------------------------------------------------------------- studio */

/**
 * The Village Studio's change layers: the buildings destroyed or damaged, the
 * roads cratered or blocked and the airstrike craters, as the village damage
 * reports read them on sharp pictures and Sentinel-2. Colours are the site's
 * own warm family, by what changed. Bulldozing and cleared land are off the
 * public maps (the data owner, 2026-11-06), and a layer with no colour here is
 * never drawn.
 */
export const STUDIO_STYLE = {
  building_destroyed: { color: '#c81e3a', group: 'Buildings' },
  building_damaged: { color: '#f08c00', group: 'Buildings' },
  building_changed_s2: { color: '#9b5de5', group: 'Buildings' },
  building_prior: { color: '#8d7b6f', group: 'Before the 2026 war' },
  road_damaged: { color: '#d68be0', group: 'Roads' },
  airstrike_crater: { color: '#7a1424', group: 'Craters' },
  airstrike_crater_unfixed: { color: '#7a1424', group: 'Craters' },
  airstrike_crater_prior: { color: '#8d7b6f', group: 'Before the 2026 war' },
  counting_area: { color: '#6b6b6b', group: 'Area read' },
};

export function studioLayer(handle, index, { base = null } = {}) {
  const { map } = handle;
  const keys = index.labels.map((l) => l.key);
  const loaded = new Map();
  const state = { on: false, until: FAR, undatedFrom: 0, hidden: new Set(['building_prior', 'airstrike_crater_prior']) };
  const all = { type: 'FeatureCollection', features: [] };
  const lastDay = Math.max(...index.towns.map((t) => (t.last ? toDay(t.last) : 0)));
  state.undatedFrom = lastDay;

  const colorExpr = () => {
    const out = ['match', ['get', 'k']];
    keys.forEach((k, i) => out.push(i, (STUDIO_STYLE[k] || {}).color || '#999999'));
    out.push('#999999');
    return out;
  };
  const visibleKeys = () => keys.map((k, i) => (state.hidden.has(k) || !STUDIO_STYLE[k] ? null : i)).filter((v) => v != null);
  const filterFor = (geom) => [
    'all',
    ['==', ['geometry-type'], geom],
    ['in', ['get', 'k'], ['literal', visibleKeys()]],
    // An undated change is shown once the timeline reaches the reports' last
    // date: it was there by then, and nothing says since when. Decided here,
    // in JavaScript, because a filter comparing two numbers reads as the old
    // filter syntax and is refused.
    ['any', ['all', ['>=', ['get', 'dd'], 0], ['<=', ['get', 'dd'], state.until]], ['all', ['<', ['get', 'dd'], 0], state.until >= state.undatedFrom]],
  ];
  const areaIndex = keys.indexOf('counting_area');

  function install() {
    add(map, 'studio', { type: 'geojson', data: all });
    layer(map, {
      id: 'studio-area',
      type: 'line',
      source: 'studio',
      filter: ['==', ['get', 'k'], areaIndex],
      layout: { visibility: state.on ? 'visible' : 'none' },
      paint: { 'line-color': '#6b6b6b', 'line-width': 1.2, 'line-dasharray': [2, 2], 'line-opacity': 0.8 },
    });
    layer(map, {
      id: 'studio-fill',
      type: 'fill',
      source: 'studio',
      filter: ['all', filterFor('Polygon'), ['!=', ['get', 'k'], areaIndex]],
      layout: { visibility: state.on ? 'visible' : 'none' },
      paint: { 'fill-color': colorExpr(), 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 15, 0.82] },
    });
    layer(map, {
      id: 'studio-line',
      type: 'line',
      source: 'studio',
      filter: filterFor('LineString'),
      layout: { visibility: state.on ? 'visible' : 'none', 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': colorExpr(), 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.2, 16, 4] },
    });
    layer(map, {
      id: 'studio-point',
      type: 'circle',
      source: 'studio',
      filter: filterFor('Point'),
      layout: { visibility: state.on ? 'visible' : 'none' },
      paint: { 'circle-color': colorExpr(), 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 16, 6], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 },
    });
  }
  handle.overlay(install);

  function refilter() {
    if (map.getLayer('studio-fill')) map.setFilter('studio-fill', ['all', filterFor('Polygon'), ['!=', ['get', 'k'], areaIndex]]);
    if (map.getLayer('studio-line')) map.setFilter('studio-line', filterFor('LineString'));
    if (map.getLayer('studio-point')) map.setFilter('studio-point', filterFor('Point'));
  }

  async function load(ids) {
    const wanted = ids.filter((id) => !loaded.has(id) && index.towns.some((t) => t.id === id));
    if (!wanted.length) return;
    const files = await Promise.all(
      wanted.map((id) =>
        fetch(new URL(`studio/${id}.geojson`, base))
          .then((r) => (r.ok ? r.json() : { features: [] }))
          .catch(() => ({ features: [] }))
      )
    );
    wanted.forEach((id, i) => {
      const feats = files[i].features || [];
      for (const f of feats) {
        f.properties.dd = f.properties.d ? toDay(f.properties.d) : -1;
        f.properties.town = id;
      }
      // Multi-part geometries are split so one filter on geometry type holds.
      const flat = [];
      for (const f of feats) {
        const g = f.geometry;
        if (g.type.startsWith('Multi')) {
          const single = g.type.slice(5);
          for (const part of g.coordinates) flat.push({ type: 'Feature', properties: f.properties, geometry: { type: single, coordinates: part } });
        } else flat.push(f);
      }
      loaded.set(id, flat);
    });
    all.features = [...loaded.values()].flat();
    const src = map.getSource('studio');
    if (src) src.setData(all);
  }

  return {
    keys,
    index,
    load,
    show(on) {
      state.on = Boolean(on);
      visibility(map, ['studio-area', 'studio-fill', 'studio-line', 'studio-point'], state.on);
    },
    until(iso) {
      state.until = iso ? toDay(iso) : FAR;
      refilter();
    },
    hide(key, hidden) {
      if (hidden) state.hidden.add(key);
      else state.hidden.delete(key);
      refilter();
    },
    isHidden: (key) => state.hidden.has(key),
    get on() {
      return state.on;
    },
    towns: index.towns,
  };
}
