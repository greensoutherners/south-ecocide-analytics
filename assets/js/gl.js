/* Maps on the GPU: the platform's and the investigations'.
 *
 * Mapbox GL JS draws them where a Mapbox public token is configured
 * (assets/js/config.js), over Mapbox's vector streets, satellite imagery and
 * terrain. Without a token, MapLibre GL JS, the open fork of the same library,
 * draws them over OpenFreeMap's OpenStreetMap tiles, Esri imagery and AWS
 * terrain tiles, none of which needs a key. The two share an API, and
 * every layer the corpus adds is written once, against what they share.
 *
 * A base map here is a *project*: a small style written in this file rather
 * than a style hosted somewhere else, so the colours of the land, the water and
 * the roads are chosen to sit under the corpus's orange, red and violet, and a
 * base map can never bring its own labels for places outside Lebanon. Our own
 * labels come from the gazetteer, so a town reads as the corpus names it.
 *
 * Lebanon, and nothing outside it, as on every map of the site: a mask fades
 * the neighbouring states to the colour of the paper, and the camera cannot
 * leave the country.
 *
 * Switching the base map replaces the style, which removes every layer on it.
 * So nothing is added to a map directly: a page registers an *overlay*, a
 * function that adds its sources and layers, and the overlays run again after
 * every style load. They must therefore be safe to run twice.
 */

import { MAPBOX } from './config.js';
import { geo, villages } from './data.js';
import { isDark, onThemeChange, palette } from './theme.js';

const VENDOR = new URL('../vendor/', import.meta.url);

/** Lebanon, in longitude and latitude, a little generous. */
export const LEBANON_LL = [
  [35.05, 33.02],
  [36.66, 34.72],
];
/** The south, where the corpus collects. */
export const SOUTH_LL = [
  [35.1, 33.05],
  [35.75, 33.62],
];
const MAX_BOUNDS = [
  [34.55, 32.7],
  [37.15, 35.05],
];

/* ---------------------------------------------------------------- engine */

let enginePromise = null;

/** The library, loaded once: Mapbox GL JS with a token, MapLibre otherwise. */
export function engine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      if (MAPBOX.token) {
        try {
          await Promise.all([script(new URL('mapbox-gl.js', VENDOR)), sheet(new URL('mapbox-gl.css', VENDOR))]);
          window.mapboxgl.accessToken = MAPBOX.token;
          return { gl: window.mapboxgl, kind: 'mapbox' };
        } catch (err) {
          // A blocked or broken Mapbox load must not leave an empty panel:
          // the open library draws the same map over open tiles.
          console.warn('Mapbox GL JS did not load; drawing with MapLibre instead.', err);
        }
      }
      await Promise.all([script(new URL('maplibre-gl.js', VENDOR)), sheet(new URL('maplibre-gl.css', VENDOR))]);
      return { gl: window.maplibregl, kind: 'maplibre' };
    })();
  }
  return enginePromise;
}

function script(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.append(s);
  });
}

function sheet(href) {
  return new Promise((resolve) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.onload = resolve;
    l.onerror = resolve;
    document.head.append(l);
  });
}

/* ------------------------------------------------------------- base maps */

/** The colours the base maps are drawn in, read from the site's own tokens. */
function paper() {
  const p = palette();
  const dark = isDark();
  return {
    dark,
    land: dark ? '#262523' : '#f3f1ec',
    water: dark ? '#1b1d22' : '#dcdde2',
    waterway: dark ? '#3a3d48' : '#b9bac6',
    park: dark ? '#2b2d27' : '#e6e9dc',
    road: dark ? '#3b3a36' : '#ffffff',
    roadCase: dark ? '#2f2e2b' : '#e2ded4',
    building: dark ? '#33322f' : '#e4e0d8',
    outline: p.ink2,
    label: p.ink1,
    halo: dark ? 'rgba(20,20,19,0.9)' : 'rgba(255,255,255,0.92)',
    mask: dark ? '#1a1a19' : '#f3f1ec',
  };
}

const MAPBOX_FONTS = ['DIN Pro Medium', 'Arial Unicode MS Regular'];
const OPEN_FONTS = ['Noto Sans Regular'];

/**
 * The style for one base map.
 *
 * `light` is a quiet paper map: land, water, a whisper of relief and the road
 * network, with no labels of its own. `satellite` is imagery. Both carry a
 * terrain source, so relief and the 3D view work on either.
 */
function baseStyle(kind, name) {
  const c = paper();
  const mapbox = kind === 'mapbox';
  const studio = mapbox && MAPBOX.styles && MAPBOX.styles[name];
  if (studio) return studio;

  const sources = mapbox
    ? {
        streets: { type: 'vector', url: 'mapbox://mapbox.mapbox-streets-v8' },
        satellite: { type: 'raster', url: 'mapbox://mapbox.satellite', tileSize: 256 },
        dem: { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14 },
      }
    : {
        streets: {
          type: 'vector',
          url: 'https://tiles.openfreemap.org/planet',
          attribution:
            '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        },
        satellite: {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          maxzoom: 19,
          attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
        },
        dem: {
          type: 'raster-dem',
          tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
          encoding: 'terrarium',
          tileSize: 256,
          // Relief from z12 is overzoomed rather than fetched: a quarter of the requests.
          maxzoom: 12,
          attribution: 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles</a>',
        },
      };

  const layers = [{ id: 'base-bg', type: 'background', paint: { 'background-color': c.land } }];

  if (name === 'satellite') {
    // In grey and a little softened: the picture is a single date, so its own
    // colours would compete with the records and the changes drawn over it.
    // Only the data is in colour.
    layers.push({
      id: 'base-satellite',
      type: 'raster',
      source: 'satellite',
      paint: { 'raster-saturation': -1, 'raster-contrast': -0.08, 'raster-brightness-min': 0.06, 'raster-brightness-max': 0.94 },
    });
  } else if (mapbox) {
    layers.push(
      {
        id: 'base-park',
        type: 'fill',
        source: 'streets',
        'source-layer': 'landuse',
        filter: ['match', ['get', 'class'], ['park', 'wood', 'grass', 'scrub', 'agriculture'], true, false],
        paint: { 'fill-color': c.park, 'fill-opacity': 0.55 },
      },
      hillshade(c),
      { id: 'base-water', type: 'fill', source: 'streets', 'source-layer': 'water', paint: { 'fill-color': c.water } },
      {
        id: 'base-waterway',
        type: 'line',
        source: 'streets',
        'source-layer': 'waterway',
        minzoom: 9,
        paint: { 'line-color': c.waterway, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 14, 1.6] },
      },
      {
        id: 'base-building',
        type: 'fill',
        source: 'streets',
        'source-layer': 'building',
        minzoom: 13.5,
        paint: { 'fill-color': c.building, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 15, 0.9] },
      },
      {
        id: 'base-road-case',
        type: 'line',
        source: 'streets',
        'source-layer': 'road',
        minzoom: 8,
        filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], true, false],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': c.roadCase, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 12, 2.6, 16, 9] },
      },
      {
        id: 'base-road',
        type: 'line',
        source: 'streets',
        'source-layer': 'road',
        minzoom: 8,
        filter: [
          'match',
          ['get', 'class'],
          ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'street', 'street_limited', 'track'],
          true,
          false,
        ],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': c.road, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.3, 12, 1.4, 16, 6] },
      }
    );
  } else {
    // The same paper map from OpenMapTiles' schema, which names its layers
    // differently from Mapbox's.
    layers.push(
      {
        id: 'base-park',
        type: 'fill',
        source: 'streets',
        'source-layer': 'landcover',
        filter: ['match', ['get', 'class'], ['wood', 'grass', 'farmland', 'scrub'], true, false],
        paint: { 'fill-color': c.park, 'fill-opacity': 0.5 },
      },
      hillshade(c),
      { id: 'base-water', type: 'fill', source: 'streets', 'source-layer': 'water', paint: { 'fill-color': c.water } },
      {
        id: 'base-waterway',
        type: 'line',
        source: 'streets',
        'source-layer': 'waterway',
        minzoom: 9,
        paint: { 'line-color': c.waterway, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 14, 1.6] },
      },
      {
        id: 'base-building',
        type: 'fill',
        source: 'streets',
        'source-layer': 'building',
        minzoom: 13.5,
        paint: { 'fill-color': c.building, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 15, 0.9] },
      },
      {
        id: 'base-road-case',
        type: 'line',
        source: 'streets',
        'source-layer': 'transportation',
        minzoom: 8,
        filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], true, false],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': c.roadCase, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 12, 2.6, 16, 9] },
      },
      {
        id: 'base-road',
        type: 'line',
        source: 'streets',
        'source-layer': 'transportation',
        minzoom: 8,
        filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'track'], true, false],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': c.road, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.3, 12, 1.4, 16, 6] },
      }
    );
  }

  return {
    version: 8,
    glyphs: mapbox
      ? 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf'
      : 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources,
    layers,
  };
}

function hillshade(c) {
  return {
    id: 'base-hillshade',
    type: 'hillshade',
    source: 'dem',
    paint: {
      'hillshade-exaggeration': c.dark ? 0.35 : 0.28,
      'hillshade-shadow-color': c.dark ? '#000000' : '#6f665a',
      'hillshade-highlight-color': c.dark ? '#3a3935' : '#ffffff',
      'hillshade-accent-color': c.dark ? '#000000' : '#8a8173',
    },
  };
}

/* ------------------------------------------------------------- the map */

/**
 * A map of Lebanon.
 *
 * Returns a promise of a handle: `map` is the library's own object, and
 * `overlay(fn)` registers a function that adds layers, run now and again after
 * every base-map switch. `setBase('light' | 'satellite')` and
 * `setTerrain(on)` change the ground; both keep the camera where it is.
 */
export async function glMap(el, {
  bounds = SOUTH_LL,
  base = 'light',
  terrain = false,
  cooperative = false,
  interactive = true,
  labels = true,
  camera = null,
} = {}) {
  // Everything the ground needs is fetched before the map exists, so its first
  // load cannot fire before the handlers below are listening.
  const [{ gl, kind }, country, towns, register] = await Promise.all([
    engine(),
    geo('lebanon'),
    geo('towns'),
    villages(),
  ]);
  const state = { base, terrain, kind, installed: false };
  const overlays = [];
  // Overlays drawn above the town names, for names that must not give way to them.
  const tops = [];

  const options = {
    container: el,
    style: baseStyle(kind, base),
    maxBounds: MAX_BOUNDS,
    minZoom: 7,
    maxZoom: 18,
    attributionControl: false,
    interactive,
    cooperativeGestures: cooperative,
    dragRotate: true,
    pitchWithRotate: true,
    fadeDuration: 0,
  };
  if (camera) {
    Object.assign(options, { center: camera.center, zoom: camera.zoom, pitch: camera.pitch || 0, bearing: camera.bearing || 0 });
  } else {
    options.bounds = bounds;
    options.fitBoundsOptions = { padding: 24 };
  }
  if (kind === 'mapbox') options.projection = 'mercator';

  const map = new gl.Map(options);

  /* Measure again whenever the frame changes size. A map built while its page
   * is still laying out measures a box it will not end up in; until the reader
   * moves the map, the first view is fitted again to the box it has now. */
  let touched = false;
  map.on('dragstart', () => (touched = true));
  map.on('zoomstart', (e) => {
    if (e.originalEvent) touched = true;
  });
  new ResizeObserver(() => {
    map.resize();
    if (!touched && !camera && el.clientHeight > 0) map.fitBounds(bounds, { padding: 24, duration: 0 });
  }).observe(el);
  map.addControl(new gl.AttributionControl({ compact: true }), 'bottom-right');
  if (interactive) map.addControl(new gl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new gl.ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-left');

  const held = new Map(register.towns.map((t) => [t.id, t]));
  const labelData = {
    type: 'FeatureCollection',
    features: towns.features.map((f) => {
      const t = held.get(f.properties.id);
      const n = t ? Object.values(t.types).reduce((m, v) => Math.max(m, v.n || 0), 0) : 0;
      return {
        type: 'Feature',
        geometry: f.geometry,
        properties: { id: f.properties.id, name: f.properties.name, held: n > 0 ? 1 : 0, rank: -n },
      };
    }),
  };

  function installGround() {
    const c = paper();
    // The country is a hole in a box. A renderer tells a hole from a second
    // polygon by its winding, so the hole must wind against the box, or the
    // mask covers Lebanon too.
    const box = [
      [25, 25],
      [45, 25],
      [45, 42],
      [25, 42],
      [25, 25],
    ];
    let ring = country.features[0].geometry.coordinates[0];
    if (signedArea(ring) * signedArea(box) > 0) ring = [...ring].reverse();
    add(map, 'lebanon-mask', {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [box, ring],
        },
      },
    });
    layer(map, {
      id: 'lebanon-mask',
      type: 'fill',
      source: 'lebanon-mask',
      paint: { 'fill-color': c.mask, 'fill-opacity': state.base === 'satellite' ? 0.72 : 0.9 },
    });
    add(map, 'lebanon', { type: 'geojson', data: country });
    layer(map, {
      id: 'lebanon-outline',
      type: 'line',
      source: 'lebanon',
      paint: { 'line-color': state.base === 'satellite' ? '#ffffff' : c.outline, 'line-width': 1.1, 'line-opacity': 0.8 },
    });
  }

  function installLabels() {
    if (!labels) return;
    const c = paper();
    const sat = state.base === 'satellite';
    add(map, 'town-labels', { type: 'geojson', data: labelData });
    layer(map, {
      id: 'town-labels',
      type: 'symbol',
      source: 'town-labels',
      filter: ['any', ['==', ['get', 'held'], 1], ['>=', ['zoom'], 11.5]],
      minzoom: 9.2,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': kind === 'mapbox' ? MAPBOX_FONTS : OPEN_FONTS,
        'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10.5, 13, 13.5],
        'symbol-sort-key': ['get', 'rank'],
        'text-padding': 3,
        'text-max-width': 8,
      },
      paint: {
        'text-color': sat ? '#ffffff' : c.label,
        'text-halo-color': sat ? 'rgba(0,0,0,0.75)' : c.halo,
        'text-halo-width': 1.4,
        'text-opacity': ['interpolate', ['linear'], ['zoom'], 9.2, 0.65, 11, 1],
      },
    });
  }

  function installAll() {
    installGround();
    for (const fn of overlays) {
      try {
        fn(map);
      } catch (err) {
        console.error(err);
      }
    }
    installLabels();
    for (const fn of tops) {
      try {
        fn(map);
      } catch (err) {
        console.error(err);
      }
    }
    if (state.terrain) applyTerrain();
    state.installed = true;
  }

  function applyTerrain() {
    try {
      map.setTerrain(state.terrain ? { source: 'dem', exaggeration: 1.35 } : null);
    } catch (err) {
      console.warn('terrain unavailable', err);
    }
  }

  let first = true;
  const ready = new Promise((resolve) => {
    map.once('load', () => {
      installAll();
      resolve();
    });
  });
  map.on('style.load', () => {
    // The first load is handled above; this runs after a base-map switch.
    if (!first) {
      state.installed = false;
      installAll();
    }
    first = false;
  });

  const handle = {
    map,
    gl,
    kind,
    ready,
    /**
     * Register a function that adds layers; it runs now if the map is ready.
     * With `top`, it runs after the town names, so its layers sit above them.
     */
    overlay(fn, { top = false } = {}) {
      (top ? tops : overlays).push(fn);
      if (state.installed) fn(map);
    },
    setBase(name) {
      if (name === state.base) return;
      state.base = name;
      map.setStyle(baseStyle(kind, name));
    },
    get base() {
      return state.base;
    },
    setTerrain(on) {
      state.terrain = Boolean(on);
      applyTerrain();
      if (state.terrain && map.getPitch() < 20) map.easeTo({ pitch: 55, duration: 900 });
      if (!state.terrain && map.getPitch() > 0) map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
    },
    get terrain() {
      return state.terrain;
    },
  };

  onThemeChange(() => map.setStyle(baseStyle(kind, state.base)));
  return handle;
}

/* ------------------------------------------------------------- helpers */

/** Twice the signed area of a ring: positive when it winds anticlockwise. */
function signedArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return sum;
}

/** Add a source unless it is there; replace its data when it is. */
export function add(map, id, source) {
  const have = map.getSource(id);
  if (have) {
    if (source.data && have.setData) have.setData(source.data);
    return have;
  }
  map.addSource(id, source);
  return map.getSource(id);
}

/** Add a layer unless it is there. `before` places it under another. */
export function layer(map, spec, before = null) {
  if (map.getLayer(spec.id)) return;
  const under = before && map.getLayer(before) ? before : map.getLayer('town-labels') ? 'town-labels' : undefined;
  map.addLayer(spec, under);
}

/** A filled and a hollow diamond, drawn once, tinted by `icon-color`. */
export function addShapes(map) {
  for (const [name, hollow] of [
    ['shape-diamond', false],
    ['shape-diamond-ring', true],
  ]) {
    if (map.hasImage(name)) continue;
    const size = 40;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(size / 2, 3);
    ctx.lineTo(size - 3, size / 2);
    ctx.lineTo(size / 2, size - 3);
    ctx.lineTo(3, size / 2);
    ctx.closePath();
    if (hollow) {
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#000';
      ctx.stroke();
    } else {
      ctx.fillStyle = '#000';
      ctx.fill();
    }
    const data = ctx.getImageData(0, 0, size, size);
    map.addImage(name, { width: size, height: size, data: data.data }, { sdf: true, pixelRatio: 2 });
  }
}

/** Fit the camera to a [[w,s],[e,n]] box, padded, without animating. */
export function frame(map, box, { padding = 40, maxZoom = 14, duration = 0 } = {}) {
  map.fitBounds(box, { padding, maxZoom, duration });
}
