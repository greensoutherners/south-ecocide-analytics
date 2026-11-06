/* Maps. Lebanon, and nothing outside it.
 *
 * Every map here opens on Lebanon and is bounded to it: the corpus covers the
 * south, and a map that pans away to the Mediterranean or into a neighbouring
 * state invites comparisons the data cannot support. `fitLebanon` sets both the
 * view and `maxBounds`.
 *
 * Three honesty rules are implemented rather than documented:
 *
 *   - **A mark is a town's count, never a record.** The site publishes
 *     statistics only (the data owner, 2026-11-06), so a map draws one circle
 *     per town, at the town's own point, its area growing with the records that
 *     name the town in the current view. Nothing on a map places one event.
 *   - **A village territory is a Voronoi cell of a locality point, not a
 *     boundary.** The layer is drawn with a dashed hairline so it does not read
 *     as a cadastre, and the legend says what it is.
 *   - **A choropleth needs a denominator.** `choropleth` labels its ramp with
 *     what is being counted and never shades a district the corpus did not
 *     cover, which would read as zero rather than as unsurveyed.
 */

import { fmt, fmtArea, fmtMeasure, monthLabel } from './data.js';
import { palette, onThemeChange, typeColor } from './theme.js';
import { countLabel } from './ui.js';

const L = () => window.L;

/** Lebanon's extent, a touch generous so the coast is not clipped. */
export const LEBANON = [
  [33.02, 35.08],
  [34.72, 36.64],
];

/** The south, where the corpus actually collects. */
export const SOUTH = [
  [33.05, 35.1],
  [33.62, 35.72],
];

const BASEMAPS = {
  none: null,
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19,
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19,
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics and the GIS User Community',
    maxZoom: 19,
  },
};

/**
 * A map of Lebanon, bounded to Lebanon.
 *
 * `basemap` defaults to none: the first thing most of these maps show is the
 * country's own outline with the corpus's layers over it, and a tiled photo
 * under a scatter of points mostly adds noise. Pages that want imagery ask for
 * it, and the explorer lets the reader switch.
 */
export function lebanonMap(el, { basemap = 'none', bounds = LEBANON, zoomSnap = 0.25, wheel = false, canvas = false } = {}) {
  const map = L().map(el, {
    // Canvas for a map that redraws on every tick of a play head: a few
    // thousand SVG nodes restyled twice a second is what makes a map stutter.
    preferCanvas: canvas,
    zoomSnap,
    zoomDelta: 0.5,
    minZoom: 7,
    maxZoom: 18,
    // Tight to the country, and sticky. The corpus covers South Lebanon, and
    // a map that pans off into the Mediterranean or across a border invites
    // comparisons the data cannot support.
    maxBounds: L().latLngBounds(LEBANON).pad(0.06),
    maxBoundsViscosity: 1,
    // A map inside an article must not hijack the scroll. A map that is the
    // whole page, like the platform's, is the one place the wheel belongs to it.
    scrollWheelZoom: wheel,
    attributionControl: true,
    worldCopyJump: false,
  });

  map.fitBounds(bounds, { padding: [10, 10] });

  /* Re-fit whenever the container changes size.
   *
   * Leaflet measures its container once, at construction. In a page whose
   * layout is still settling, or in an iframe that resizes itself to its
   * content, that first measurement is of a box the map will not end up in:
   * Leaflet keeps the centre, the zoom no longer matches the width, and the
   * country slides off to one side. Telling it to measure again, and fitting
   * the bounds once more, is what keeps the view on Lebanon.
   */
  let settled = false;
  const refit = () => {
    map.invalidateSize({ animate: false });
    if (!settled && el.clientWidth > 0) {
      map.fitBounds(map.__bounds || bounds, { padding: [10, 10], animate: false });
      settled = true;
    }
  };
  map.__bounds = bounds;
  map.refit = () => {
    settled = false;
    refit();
  };
  /** Re-frame the map, e.g. when a layer change makes the whole country the
   * subject rather than the south. */
  map.setBoundsAndRefit = (next) => {
    const changed = String(next) !== String(map.__bounds);
    map.__bounds = next;
    if (changed) {
      settled = false;
      refit();
    }
  };
  new ResizeObserver(refit).observe(el);
  requestAnimationFrame(refit);

  // The wheel zooms once the reader has asked for the map by clicking it.
  if (!wheel) {
    map.on('click', () => map.scrollWheelZoom.enable());
    map.on('mouseout', () => map.scrollWheelZoom.disable());
  }
  // Once the reader has moved the map themselves, a later resize must not
  // throw their view away.
  map.on('dragstart zoomstart', () => {
    settled = true;
  });

  let tiles = null;
  map.setBasemap = (name) => {
    if (tiles) {
      map.removeLayer(tiles);
      tiles = null;
    }
    const spec = BASEMAPS[name === 'auto' ? (isDarkNow() ? 'dark' : 'light') : name];
    if (spec) {
      tiles = L()
        .tileLayer(spec.url, { attribution: spec.attribution, maxZoom: spec.maxZoom, detectRetina: true })
        .addTo(map);
      tiles.bringToBack();
    }
    map.__basemap = name;
  };
  map.setBasemap(basemap);

  onThemeChange(() => {
    if (map.__basemap === 'auto') map.setBasemap('auto');
  });

  return map;
}

function isDarkNow() {
  return document.documentElement.dataset.theme === 'dark';
}

/* ------------------------------------------------------------------ outlines */

/** Lebanon's own outline, as the quiet ground every other layer sits on. */
export function countryLayer(geojson) {
  const p = palette();
  return L().geoJSON(geojson, {
    interactive: false,
    style: { color: p.map.stroke, weight: 1.2, fill: true, fillColor: p.map.land, fillOpacity: 1 },
  });
}

/** District or governorate outlines, hairline, no fill. */
export function adminLayer(geojson, { weight = 0.8 } = {}) {
  const p = palette();
  return L().geoJSON(geojson, {
    interactive: false,
    style: { color: p.map.stroke, weight, fill: false, opacity: 0.8 },
  });
}

/**
 * Village territories.
 *
 * Dashed on purpose. These are Voronoi cells of locality points, a way of
 * saying "roughly this village's ground", and a solid line would read as a
 * surveyed boundary.
 */
export function villageLayer(geojson, { onPick = null } = {}) {
  const p = palette();
  return L().geoJSON(geojson, {
    style: {
      color: p.map.stroke,
      weight: 0.7,
      dashArray: '3 3',
      fill: true,
      fillColor: 'transparent',
      fillOpacity: 0,
    },
    onEachFeature(feature, layer) {
      const q = feature.properties || {};
      layer.bindTooltip(
        `${q.name || 'Unnamed'}<br><span style="opacity:.7">${fmtArea(q.area_ha)} ha, approximate</span>`,
        { sticky: true }
      );
      layer.on('mouseover', () => layer.setStyle({ fillColor: p.map.accent, fillOpacity: 0.1, weight: 1.4 }));
      layer.on('mouseout', () => layer.setStyle({ fillOpacity: 0, weight: 0.7 }));
      if (onPick) layer.on('click', () => onPick(q));
    },
  });
}

/** Declared or observed military presence zones. */
export function zoneLayer(geojson) {
  const p = palette();
  return L().geoJSON(geojson, {
    style: {
      color: p.map.zone,
      weight: 1.4,
      dashArray: '6 3',
      fill: true,
      fillColor: p.map.zone,
      fillOpacity: 0.07,
    },
    onEachFeature(feature, layer) {
      const q = feature.properties || {};
      layer.bindTooltip(
        `<b>${q.name || 'Zone'}</b><br>${q.valid_from || ''}${q.valid_to ? ` to ${q.valid_to}` : ' onwards'}` +
          `<br><span style="opacity:.7">a place, not a finding</span>`,
        { sticky: true }
      );
    },
  });
}

/* ------------------------------------------------------------ burned ground */

/** The first and last day of the month a burned-ground feature stands for. */
function monthSpan(d) {
  const [y, m] = String(d).slice(0, 7).split('-').map(Number);
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return [first, last];
}

/**
 * The burned-ground features whose month meets a window of ISO days.
 *
 * Burned ground is published merged by the month its fires began
 * (`data/geo/burned.geojson`, one feature per month), so it can be filtered
 * by date and by nothing else: a month is in when any of its days is.
 */
export function burnedInWindow(geojson, { from = null, to = null } = {}) {
  const features = ((geojson && geojson.features) || []).filter((f) => {
    const d = f.properties && f.properties.d;
    if (!d) return false;
    const [first, last] = monthSpan(d);
    if (from && last < from) return false;
    if (to && first > to) return false;
    return true;
  });
  const ha = features.reduce((s, f) => s + (Number(f.properties.ha) || 0), 0);
  return { type: 'FeatureCollection', features, ha };
}

/**
 * Burned ground: what the published fires burned, measured on Sentinel-2
 * before and after passes and merged by the month the fires began. Drawn in
 * the fires' own colour because it is the fires' own ground. `from` and `to`
 * (ISO days) keep the months that meet that window.
 */
export function burnedLayer(geojson, { from = null, to = null } = {}) {
  const fire = typeColor('BRN');
  const kept = burnedInWindow(geojson, { from, to });
  const layer = L().geoJSON(kept, {
    style: { color: fire, weight: 0.8, fill: true, fillColor: fire, fillOpacity: 0.42 },
    onEachFeature(feature, lyr) {
      const q = feature.properties || {};
      lyr.bindTooltip(
        `<b>Burned ground, ${monthLabel(String(q.d).slice(0, 7))}</b>` +
          `<br>${fmtArea(q.ha)} ha, by the fires that began that month` +
          `<br><span style="opacity:.72">Measured on Sentinel-2 before and after passes. ` +
          `Ground that burned, which is not by itself what lit it.</span>`,
        { sticky: true }
      );
    },
  });
  layer.__ha = kept.ha;
  layer.__months = kept.features.length;
  return layer;
}

/* ------------------------------------------------------------------ towns */

/* The kinds of record that are about a whole town: displacement orders. The
 * data owner's rule is that they shade the municipality they name, and the
 * maps open on that shading. Detonations (DET) are hidden for now (the data
 * owner, 2026-11-06); to show them again, add 'DET' to this set. */
export const TOWN_KINDS = new Set(['ALR']);

/* How large a town's circle is drawn.
 *
 * Area grows with the value, so the radius grows with its square root: a town
 * with four times the records is twice as wide, never four times. Counts use
 * one fixed scale on every map, so the same count is the same size whatever
 * else the map holds; a measure (hectares, shells) is scaled to its peak.
 */
const MARK_MIN = 3.5;
const MARK_MAX = 26;
const MARK_PER_RECORD = 4.2;

export function markRadius(value, peak = null) {
  if (!(value > 0)) return MARK_MIN;
  const r = peak ? MARK_MAX * 0.92 * Math.sqrt(value / Math.max(peak, value)) : MARK_PER_RECORD * Math.sqrt(value);
  return Math.max(MARK_MIN, Math.min(MARK_MAX, r));
}

/** A little larger close in and smaller far out, so a village does not vanish at z13. */
function zoomFactor(zoom) {
  return zoom <= 8 ? 0.72 : zoom <= 10 ? 0.9 : zoom <= 12 ? 1.05 : zoom <= 14 ? 1.25 : 1.45;
}

/** The label `Dataset.towns()` gives the records that name no town. */
const NO_TOWN = 'No town recorded';

/**
 * The largest town a type holds over all its dates: the top of a town map's
 * scale, so a filter or the play head moves the circles and never the scale.
 * Only towns a map can draw count: the records that name no town, or a town
 * with no point, are not a circle.
 */
export function townPeak(ds, measure = null) {
  const values = ds
    .towns(ds.all, { measure })
    .filter((t) => t.name !== NO_TOWN && t.lat != null && t.lon != null)
    .map((t) => (measure ? Number(t.v) || 0 : t.n));
  return Math.max(1, ...values);
}

/**
 * Towns, one circle each, sized by their count in the current view.
 *
 * `towns` is what `Dataset.towns()` or `Dataset.features()` returns: a town's
 * name, district, count `n` and, for a measure, its total `v`, at the town's
 * own point. A town with no point is left off and counted in `__unplaced`, and
 * the records that name no town in `__untowned`. With `measure`, the circle is
 * sized by the measure, scaled to `peak` (the whole type's largest town, from
 * `townPeak`, so a filter does not rescale the map); a town whose records carry
 * no figure is drawn as a small ring.
 */
export function townLayer(towns, { code = null, color = null, measure = null, unit = '', peak = null, onPick = null } = {}) {
  const p = palette();
  const group = L().layerGroup();
  const fill = color || (code ? typeColor(code) : p.series[0]);
  const markers = [];
  let unplaced = 0;
  let untowned = 0;
  let drawn = 0;

  const value = (t) => (measure ? Number(t.v) || 0 : t.n);
  const list = towns
    .filter((t) => t.n > 0)
    .map((t) => ({ ...t, name: t.name || t.town }))
    .sort((a, b) => value(b) - value(a));
  const top =
    peak ||
    (measure ? Math.max(0, ...list.filter((t) => t.name !== NO_TOWN && t.lat != null).map(value)) : null);

  for (const t of list) {
    if (t.name === NO_TOWN) {
      untowned += t.n;
      continue;
    }
    if (t.lat == null || t.lon == null) {
      unplaced += t.n;
      continue;
    }
    const v = value(t);
    const empty = measure && !(v > 0);
    const base = markRadius(measure ? v : t.n, measure ? top : null);
    const marker = L().circleMarker([t.lat, t.lon], {
      radius: base,
      color: empty ? fill : p.card,
      weight: empty ? 1.4 : 1,
      fillColor: fill,
      fillOpacity: empty ? 0.08 : 0.58,
    });
    marker.__base = base;
    const measureLine = measure
      ? empty
        ? `<br><span style="opacity:.7">no ${unit || 'figure'} measured</span>`
        : `<br>${fmtMeasure(v, unit)} ${unit}`
      : '';
    marker.bindTooltip(
      `<b>${t.name}</b>: ${countLabel(code, t.n)}${measureLine}` +
        (t.district ? `<br><span style="opacity:.7">${t.district}</span>` : ''),
      { sticky: true }
    );
    if (onPick) marker.on('click', () => onPick(t));
    marker.addTo(group);
    markers.push(marker);
    drawn += 1;
  }

  group.__scale = (zoom) => {
    const k = zoomFactor(zoom);
    for (const m of markers) m.setRadius(m.__base * k);
  };
  group.__peak = top;
  group.__towns = drawn;
  group.__unplaced = unplaced;
  group.__untowned = untowned;
  return group;
}

/**
 * What a town map leaves out, in a sentence: the records that name a town with
 * no point, and the records that name no town. Empty when it leaves out none.
 */
export function leftOutText(code, layer) {
  const parts = [];
  if (layer.__unplaced) {
    parts.push(`${countLabel(code, layer.__unplaced)} ${layer.__unplaced === 1 ? 'names a town' : 'name towns'} with no point on the map`);
  }
  if (layer.__untowned) {
    parts.push(`${countLabel(code, layer.__untowned)} ${layer.__untowned === 1 ? 'names' : 'name'} no town`);
  }
  if (!parts.length) return '';
  const both = layer.__unplaced + layer.__untowned;
  return `${parts.join(', and ')}: ${both === 1 ? 'it is' : 'they are'} counted in the figures and not drawn.`;
}

/**
 * The size key for `townLayer`: three circles, the smallest, a middle and the
 * largest value the scale holds, with what they count.
 */
export function sizeLegendHTML({ code = null, title = null, peak = 1, measure = null, unit = '', note = null } = {}) {
  const p = palette();
  const color = code ? typeColor(code) : p.series[0];
  const top = Math.max(1, peak || 1);
  const steps = measure
    ? [top / 16, top / 4, top].map((v) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10))
    : [...new Set([1, Math.min(top, Math.max(2, Math.round(top / 4))), top])];
  const circles = steps
    .map((v) => {
      const r = markRadius(v, measure ? top : null);
      const d = Math.round(r * 2);
      return (
        `<span class="size-step"><span class="size-dot" style="width:${d}px;height:${d}px;` +
        `background:${color}94;border-color:${p.card}"></span>` +
        `<span>${measure ? fmtMeasure(v, unit) : fmt(v)}</span></span>`
      );
    })
    .join('');
  return (
    `<b>${title || (measure ? `${unit} per town` : 'Records per town')}</b>` +
    `<div class="size-key">${circles}</div>` +
    `<div style="margin-top:5px;font-size:.7rem;opacity:.8">${
      note || 'One circle per town, at its own point. Area grows with the count.'
    }</div>`
  );
}

/**
 * A choropleth over administrative areas, at any level.
 *
 * `counts` maps a feature's key to a value. The key is the official P-code by
 * default, not the name: the corpus calls a place "Tyre" and the boundary
 * release calls it "Sour", and a map that joins on a transliteration will
 * quietly leave a district unshaded and show it as having no incidents. The
 * join is made upstream, in PostGIS, on the polygon that contains the town.
 *
 * An area with no entry is left unfilled rather than shaded as zero. Outside
 * the collection area the corpus has not looked, and a pale fill would publish
 * "none here" as a finding.
 *
 * `ramp` is the shades, lightest first. A map of one kind of record passes
 * that kind's own (`typeRamp(code)`); without one the layer uses the general
 * orange-to-violet ramp.
 */
export function choropleth(
  geojson,
  counts,
  { key = 'pcod', label = 'records', onPick = null, unit = '', land = false, scale = 'sqrt', ramp = null, format = null } = {}
) {
  const p = palette();
  const values = Object.values(counts).filter((v) => v > 0);
  const peak = Math.max(1, ...values);
  const steps = ramp && ramp.length ? ramp : p.sequential;

  const bucket = (v) => {
    if (!v) return null;
    // Square root by default, because a handful of places carry most of the
    // corpus and a linear ramp would paint everything else the palest step.
    // A small count of categories, like the platform's kinds of record, is
    // linear instead, so each value keeps a step of its own.
    const t = scale === 'linear' ? v / peak : Math.sqrt(v / peak);
    return steps[Math.min(steps.length - 1, Math.floor(t * steps.length))];
  };

  const valueOf = (feature) => counts[feature.properties[key]];

  /* With `land` on, this layer *is* the map: an area with no value is filled
   * in the land colour rather than left transparent, so nothing needs to be
   * drawn underneath it. That matters because a country outline and a
   * municipality set are generalised differently, and laying one over the
   * other gives the map two coastlines a few hundred metres apart. */
  const empty = land ? p.map.land : 'transparent';

  const layer = L().geoJSON(geojson, {
    style(feature) {
      const fill = bucket(valueOf(feature));
      return {
        color: p.map.stroke,
        weight: 0.5,
        fill: true,
        fillColor: fill || empty,
        fillOpacity: fill ? 0.9 : land ? 1 : 0,
      };
    },
    onEachFeature(feature, lyr) {
      const q = feature.properties;
      const v = valueOf(feature);
      const place = q.name_ar ? `${q.name}<span style="opacity:.6"> ${q.name_ar}</span>` : q.name;
      const parent = q.district ? `<br><span style="opacity:.6">${q.district}</span>` : '';
      lyr.bindTooltip(
        `<b>${place}</b>${parent}<br>` +
          (v
            ? format
              ? format(v)
              : `${fmt(v)} ${unit || label}`
            : `<span style="opacity:.7">no record of this kind</span>`),
        { sticky: true }
      );
      lyr.on('mouseover', () => lyr.setStyle({ weight: 2, color: p.ink2 }));
      lyr.on('mouseout', () => lyr.setStyle({ weight: 0.5, color: p.map.stroke }));
      if (onPick && v) lyr.on('click', () => onPick(q[key], v, q));
    },
  });

  layer.__peak = peak;
  layer.__steps = steps;
  layer.__bucket = bucket;

  /* The extent of the areas that actually carry a value.
   *
   * The layer is the whole country so that no polygon is cut off at the frame
   * and no second outline is needed underneath, but framing the view on the
   * whole country would show the reader mostly empty ground. The data decides
   * where to look; the country is still there to pan to.
   */
  let shaded = null;
  layer.eachLayer((lyr) => {
    if (!valueOf(lyr.feature)) return;
    const box = lyr.getBounds();
    if (!shaded) shaded = L().latLngBounds(box.getSouthWest(), box.getNorthEast());
    else shaded.extend(box);
  });
  layer.__shadedBounds = shaded && shaded.isValid() ? shaded.pad(0.06) : null;

  return layer;
}

/* ------------------------------------------------------------------ legend */

/** A legend control. `html` is built by the caller so each map says its own piece. */
export function legend(html, position = 'bottomleft') {
  const control = L().control({ position });
  control.onAdd = () => {
    const div = L().DomUtil.create('div', 'map-legend');
    div.innerHTML = html;
    L().DomEvent.disableClickPropagation(div);
    return div;
  };
  return control;
}

/** The shading key. `steps` is the ramp the layer was drawn with, when it was
 * given one of its own. */
export function rampLegendHTML(peak, label, note = null, steps = null) {
  const p = palette();
  const ramp = (steps && steps.length ? steps : p.sequential)
    .map((c) => `<span style="background:${c}"></span>`)
    .join('');
  return (
    `<b>${label}</b><div class="ramp">${ramp}</div>` +
    `<div class="ramp-ends"><span>1</span><span>${fmt(peak)}</span></div>` +
    `<div style="margin-top:5px;font-size:.7rem;opacity:.8">${
      note || 'Unshaded means no record of this kind names it, not that nothing happened there.'
    }</div>`
  );
}

/* ------------------------------------------------------------- before / after
 *
 * A dated imagery comparison, built on Esri's Wayback archive.
 *
 * The imagery is never copied into this repository: the slider points the
 * reader's browser at Esri's own tile service, two dated releases either side
 * of a date, with Esri's attribution on the map. That keeps a licensed picture
 * where its licence expects it and still lets a page show a village before and
 * after.
 *
 * What a release date is *not* is the day the picture was taken. It is the day
 * Esri published that imagery, which is on or after the overflight, so the
 * labels say "release" and the caption says why.
 */
export function compareMap(el, { box, before, after, tiles, attribution, maxZoom = 19 }) {
  const map = L().map(el, {
    zoomSnap: 0.25,
    minZoom: 10,
    maxZoom,
    scrollWheelZoom: false,
    attributionControl: true,
  });
  map.fitBounds(
    [
      [box[1], box[0]],
      [box[3], box[2]],
    ],
    { padding: [6, 6] }
  );
  map.on('click', () => map.scrollWheelZoom.enable());
  map.on('mouseout', () => map.scrollWheelZoom.disable());

  const url = (release) => tiles.replace('{r}', String(release));
  const left = L()
    .tileLayer(url(before.r), { attribution, maxZoom, maxNativeZoom: 19 })
    .addTo(map);
  const right = L()
    .tileLayer(url(after.r), { attribution, maxZoom, maxNativeZoom: 19 })
    .addTo(map);

  // The reveal is a clip on the upper layer rather than two maps side by side:
  // one map means one pan and one zoom, so the two dates stay registered to
  // each other however the reader moves around.
  const container = right.getContainer();
  container.style.willChange = 'clip-path';

  let split = 0.5;
  const apply = () => {
    container.style.clipPath = `inset(0 0 0 ${split * 100}%)`;
    handle.style.left = `${split * 100}%`;
  };

  const handle = document.createElement('div');
  handle.className = 'compare-handle';
  handle.setAttribute('role', 'slider');
  handle.setAttribute('aria-label', 'Reveal the later imagery');
  handle.setAttribute('aria-valuemin', '0');
  handle.setAttribute('aria-valuemax', '100');
  handle.tabIndex = 0;
  handle.innerHTML = '<span class="grip"></span>';
  el.appendChild(handle);

  /* The handle lives inside the map container, so Leaflet sees its mousedown
   * too and starts panning the map at the same time. The two then fight, and
   * what the reader gets is a handle that will not move. Taking the event off
   * Leaflet is what makes the drag work at all. */
  L().DomEvent.disableClickPropagation(handle);
  L().DomEvent.disableScrollPropagation(handle);

  const labels = document.createElement('div');
  labels.className = 'compare-labels';
  labels.innerHTML =
    `<span class="before">${before.d}</span><span class="after">${after.d}</span>`;
  el.appendChild(labels);

  const set = (ratio) => {
    split = Math.min(1, Math.max(0, ratio));
    handle.setAttribute('aria-valuenow', String(Math.round(split * 100)));
    apply();
  };

  const fromEvent = (e) => {
    const rect = el.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    set(x / rect.width);
  };

  let dragging = false;
  const start = (e) => {
    dragging = true;
    el.classList.add('dragging');
    // Stop Leaflet, and anything else up the tree, from treating this as the
    // start of a pan.
    e.stopPropagation();
    e.preventDefault();
    if (e.pointerId != null && handle.setPointerCapture) {
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        /* capture is a convenience; the window listeners carry the drag */
      }
    }
    fromEvent(e);
  };
  const move = (e) => {
    if (!dragging) return;
    e.preventDefault();
    fromEvent(e);
  };
  const end = () => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('dragging');
  };

  // Pointer events cover mouse, touch and pen in one path; the mouse and touch
  // listeners stay for browsers that do not have them.
  handle.addEventListener('pointerdown', start);
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  if (!window.PointerEvent) {
    handle.addEventListener('mousedown', start);
    handle.addEventListener('touchstart', start, { passive: false });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', end);
    window.addEventListener('touchend', end);
  }

  /* A click anywhere on the imagery moves the handle there.
   *
   * Dragging a two-pixel line is fiddly on a phone and not obvious on a
   * desktop, so the whole frame is a target as well. A drag of the map still
   * pans it: only a click that did not move counts. */
  let downAt = null;
  el.addEventListener('pointerdown', (e) => {
    downAt = e.target === handle || handle.contains(e.target) ? null : [e.clientX, e.clientY];
  });
  el.addEventListener('pointerup', (e) => {
    if (!downAt) return;
    const moved = Math.abs(e.clientX - downAt[0]) + Math.abs(e.clientY - downAt[1]);
    if (moved < 5) fromEvent(e);
    downAt = null;
  });

  // Dragging is not the only way in: the handle takes the arrow keys, so the
  // comparison works from a keyboard too.
  handle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowLeft') set(split - step);
    else if (e.key === 'ArrowRight') set(split + step);
    else if (e.key === 'Home') set(0);
    else if (e.key === 'End') set(1);
    else return;
    e.preventDefault();
  });

  apply();
  map.on('resize', apply);

  return {
    map,
    setSplit: set,
    setReleases(nextBefore, nextAfter) {
      left.setUrl(url(nextBefore.r));
      right.setUrl(url(nextAfter.r));
      labels.querySelector('.before').textContent = nextBefore.d;
      labels.querySelector('.after').textContent = nextAfter.d;
    },
    /** Step the reveal across and back, for the "play" button. */
    sweep(ms = 2600) {
      const t0 = performance.now();
      const tick = (t) => {
        const phase = ((t - t0) % ms) / ms;
        set(phase < 0.5 ? phase * 2 : 2 - phase * 2);
        if (!this.__stopped) this.__raf = requestAnimationFrame(tick);
      };
      this.__stopped = false;
      this.__raf = requestAnimationFrame(tick);
    },
    stop() {
      this.__stopped = true;
      if (this.__raf) cancelAnimationFrame(this.__raf);
      set(0.5);
    },
  };
}

/** Pick the release nearest a date, on the wanted side of it. */
export function pickRelease(releases, iso, side = 'before') {
  const sorted = [...releases].sort((a, b) => (a.d < b.d ? -1 : 1));
  if (side === 'before') {
    const earlier = sorted.filter((r) => r.d <= iso);
    return earlier.length ? earlier[earlier.length - 1] : sorted[0];
  }
  const later = sorted.filter((r) => r.d >= iso);
  return later.length ? later[0] : sorted[sorted.length - 1];
}

/** Keep marker sizes sensible as the reader zooms. */
export function autoScale(map, groups) {
  const apply = () => {
    const z = map.getZoom();
    for (const g of groups) if (g && g.__scale) g.__scale(z);
  };
  map.on('zoomend', apply);
  apply();
}
