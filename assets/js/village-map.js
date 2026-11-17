/* One village, every layer we hold of it, on one map.
 *
 * The database (platform.html) counts every town; an investigation walks a
 * reader through one. This page is the third form: a single village opened in
 * full, with its sharp pictures as the ground (OnGeo's 0.3 m pictures of 2026,
 * Esri's Maxar pictures from before), every change the readers found on them
 * as a layer of its own, and the records the corpus holds about the town
 * counted week by week on a timeline that moves the map.
 *
 * The site's rules hold here as everywhere: statistics, never records. Fires,
 * white phosphorus, displacement orders and detonations are counted by week at
 * the town, never one by one, never at a point or on a day. What is drawn is
 * measured on pictures: buildings, roads and land read as changed, each with
 * the dates of the pictures that bracket it, and burned ground merged by
 * month. A change says where and between which pictures, never why or by whom.
 *
 * The data is `data/village-maps/<city>/`, written by
 * `tools/publish/village_map.py` and `tools/publish/village_imagery.py` in the
 * corpus repository.
 */

import { DATA, dateLabel, load } from './data.js';
import { add, glMap, layer } from './gl.js';
import { typeColor } from './theme.js';
import { CONTACT_URL, el, fill, params } from './ui.js';
import { credit, shareBar, withParams } from './share.js';

/* ------------------------------------------------------------------ layers */

/** When a building was first seen gone, as a colour: earliest dark, latest light. The
 * windows are the town's own, between its sharp pictures (`map.json` "when"). */
const WHEN_COLOURS = ['#5c0f1c', '#a3162f', '#e0242c', '#ff7a00', '#ffb000', '#ffd166'];
let WHEN = [{ key: 'wx', label: 'Not dated more closely', color: '#9c8f86' }];
function whenList(info) {
  const ws = (info.when || []).filter((w) => w.key !== 'wx');
  return [
    ...ws.map((w, i) => ({
      key: w.key,
      label: w.from ? `${dateLabel(w.from)} to ${dateLabel(w.to)}` : `Gone by ${dateLabel(w.to)}`,
      color: WHEN_COLOURS[i] || WHEN_COLOURS[WHEN_COLOURS.length - 1],
      n: w.n,
    })),
    { key: 'wx', label: 'Not dated more closely', color: '#9c8f86', n: ((info.when || []).find((w) => w.key === 'wx') || {}).n },
  ];
}

/**
 * Every layer, in drawing order within its group. `src` is the file, `match`
 * picks its features, `kind` how it is drawn. A layer whose features are all
 * absent is listed with 0 and cannot be switched on.
 */
const LAYERS = [
  {
    group: 'Houses and other buildings',
    items: [
      { key: 'destroyed', label: 'Destroyed', src: 'buildings', color: '#c81e3a', kind: 'fill',
        match: (p) => p.k === 'building_destroyed' && !p.added, on: true },
      { key: 'damaged', label: 'Damaged', src: 'buildings', color: '#f08c00', kind: 'fill',
        match: (p) => p.k === 'building_damaged' && !p.added, on: true },
      { key: 'added', label: 'Destroyed or damaged, on no pre-war map', src: 'buildings', color: '#ff2e63', kind: 'fill', ring: true,
        match: (p) => Boolean(p.added), on: true },
      { key: 's2', label: 'Changed, seen from space only (Sentinel-2)', src: 'buildings', color: '#9b5de5', kind: 'fill',
        match: (p) => p.k === 'building_changed_s2', on: false },
      { key: 'prior', label: 'Already in ruins before the 2026 war', src: 'buildings', color: '#8d7b6f', kind: 'fill',
        match: (p) => p.k === 'building_prior', on: false },
    ],
  },
  {
    group: 'Bulldozed land and roads',
    items: [
      { key: 'orchards', label: 'Orchards, fields and trees lost (outlined by hand)', src: 'land', color: '#ffd400', kind: 'area',
        match: (p) => p.k === 'orchards_outlined', on: true },
      { key: 'bulldozed', label: 'Bulldozed ground, read on the 2026 pictures', src: 'land', color: '#ff7a00', kind: 'area',
        match: (p) => p.k === 'bulldozed_counted', on: true },
      { key: 'landloss', label: 'Farmland, orchard or forest removed (Sentinel-2)', src: 'land', color: '#c98a00', kind: 'area',
        match: (p) => ['forest_removed', 'orchard_removed', 'field_removed', 'bulldozed_ground'].includes(p.k), on: false },
      { key: 'tracks', label: 'New tracks and earthworks', src: 'land', color: '#a86b00', kind: 'area',
        match: (p) => ['track', 'earthworks_spot', 'earthworks_spot_unfixed'].includes(p.k), on: false },
      { key: 'roads', label: 'Roads bulldozed', src: 'roads', color: '#b04cff', kind: 'line',
        match: (p) => ['road_bulldozed', 'road_razed_ground'].includes(p.k), on: true },
      { key: 'roadsdmg', label: 'Roads cratered or blocked', src: 'roads', color: '#e07be8', kind: 'line',
        match: (p) => p.k === 'road_damaged', on: false },
    ],
  },
  {
    group: 'Fires',
    items: [
      { key: 'burned', label: 'Burned ground, by month (fire records)', src: 'burned', color: '', type: 'BRN', kind: 'area',
        match: () => true, on: true },
    ],
  },
  {
    group: 'Context',
    items: [
      { key: 'municipality', label: 'The municipality', src: 'context', color: '#2b2a28', kind: 'outline',
        match: (p) => p.k === 'municipality', on: true },
      { key: 'zone', label: 'The yellow-line zone the Israeli army declared', src: 'context', color: '#f2c200', kind: 'outline',
        match: (p) => p.k === 'zone', on: false },
      // Every counting area in the Village Studio is the village and the ground within 1.5 km
      // of its built-up area (the Studio's own definition of the label, measured 2026-11-17 on
      // all 11 towns). A town whose area is drawn otherwise needs its own words, from its data.
      { key: 'area', label: 'The area read on the pictures: the village and the ground within 1.5 km of its built-up area', src: 'context', color: '#6b6b6b', kind: 'outline',
        match: (p) => p.k === 'counting_area', on: false },
    ],
  },
];
const ALL = LAYERS.flatMap((g) => g.items);

/** The timeline's lanes: one per kind of record, counted by week at the town. */
const LANES = [
  { code: 'DET', label: 'Detonations reported', note: 'reports of detonations of houses in the town' },
  { code: 'BRN', label: 'Fires', note: 'fires linked to an attack, or in the yellow-line zone' },
  { code: 'WPB', label: 'White phosphorus', note: 'white phosphorus attacks' },
  { code: 'ALR', label: 'Orders naming the town', note: 'displacement orders naming the town' },
  { code: 'REG', label: 'Region-wide orders', note: 'orders to leave a whole region that includes the town' },
];

/* -------------------------------------------------------------------- page */

export async function villageMap({ city, root = document.getElementById('vmap'), onFrame = null } = {}) {
  const q = params();
  const base = `village-maps/${city}/`;
  root.replaceChildren(el('p', { class: 'vm-loading', text: 'Loading the map…' }));
  const [info, imagery, buildings, roads, land, burned, context] = await Promise.all([
    load(`${base}map.json`),
    load(`${base}imagery.json`).catch(() => null),
    load(`${base}buildings.geojson`),
    load(`${base}roads.geojson`),
    load(`${base}land.geojson`),
    load(`${base}burned.geojson`).catch(() => ({ type: 'FeatureCollection', features: [] })),
    load(`${base}context.geojson`).catch(() => ({ type: 'FeatureCollection', features: [] })),
  ]);
  const files = { buildings, roads, land, burned, context };
  const town = info.town;
  WHEN = whenList(info);
  // The pictures' own file is written by the tiler; the map file's copy is a fallback.
  if (imagery && (imagery.ongeo || imagery.esri)) info.pictures = imagery;
  info.pictures = info.pictures || {};

  /* The pictures: OnGeo's 2026 pictures as our own tiles, Esri's before the war
   * from the Wayback archive, and the two plain grounds of the site. */
  const pictures = [
    ...(info.pictures.ongeo || []).slice().reverse().map((p) => ({
      key: `o${p.key}`,
      label: `OnGeo, ${dateLabel(p.date)}`,
      sub: '0.3 m a pixel',
      // new URL() percent-encodes the {z}/{x}/{y} placeholders: put them back
      tiles: new URL(p.tiles, new URL('../', DATA)).href.replace(/%7B/gi, '{').replace(/%7D/gi, '}'),
      bounds: p.bounds,
      maxzoom: p.zmax,
      date: p.date,
      credit: `Picture: OnGeo Intelligence, ${dateLabel(p.date)}`,
      // OnGeo draws the edge of the area each report covers on its own pictures, in a red dashed line.
      note: 'The red dashed line is OnGeo’s own: the edge of the area its report covers.',
    })),
    ...(info.pictures.esri || []).map((p) => ({
      key: p.key,
      label: p.key === 'esri2023' ? 'Before the war, early 2023' : `Esri, ${dateLabel(p.dates[0])}`,
      sub: p.key === 'esri2023' ? 'Maxar, January to April 2023' : 'Maxar WorldView-3',
      tiles: p.tiles,
      maxzoom: 19,
      date: p.dates[p.dates.length - 1],
      credit: `Picture: Esri World Imagery (Wayback ${p.release}), Maxar`,
    })),
    { key: 'satellite', label: 'Satellite today, in grey', sub: 'Esri World Imagery', base: 'satellite' },
    { key: 'light', label: 'Plain map', sub: 'OpenStreetMap', base: 'light' },
  ];
  const state = {
    picture: pictures.find((p) => p.key === q.picture) ? q.picture : pictures[0].key,
    grey: q.grey === '1',
    opacity: 1,
    on: new Set(ALL.filter((l) => l.on).map((l) => l.key)),
    byWhen: q.when === '1',
    cursor: null,
    compare: false,
    right: null,
  };
  if (q.layers) state.on = new Set(q.layers.split(',').filter((k) => ALL.some((l) => l.key === k)));

  /* ------------------------------------------------------------ the frame */

  const panel = el('aside', { class: 'vm-panel', 'aria-label': 'Pictures and layers' });
  const mapEl = el('div', { class: 'vm-map', role: 'region', 'aria-label': `Map of ${town.name}` });
  const cmpEl = el('div', { class: 'vm-map vm-compare', hidden: true, 'aria-hidden': 'true' });
  const handleEl = el('div', { class: 'vm-handle', hidden: true, role: 'slider', tabindex: '0', 'aria-label': 'Move between the two pictures', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '50' });
  const creditEl = el('div', { class: 'vm-credit' });
  const timeline = el('div', { class: 'vm-timeline' });
  const toggle = el('button', { type: 'button', class: 'btn vm-panel-toggle', text: 'Pictures and layers', 'aria-expanded': 'false' });
  const stage = el('div', { class: 'vm-stage' }, [mapEl, cmpEl, handleEl, creditEl, toggle]);
  root.replaceChildren(el('div', { class: 'vm' }, [panel, el('div', { class: 'vm-main' }, [stage, timeline])]));
  if (onFrame) onFrame();   // the page sizes the frame under its header now, not after the map has loaded
  toggle.addEventListener('click', () => {
    const open = !document.body.classList.contains('vm-open');
    document.body.classList.toggle('vm-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  });

  const handle = await glMap(mapEl, { camera: { center: info.camera.center, zoom: info.camera.zoom, pitch: 0, bearing: 0 }, base: 'satellite' });
  const { map } = handle;
  map.setMaxZoom(19.4);
  if (new URLSearchParams(location.search).has('debug')) window.__vm = { handle, info, state };

  /* ------------------------------------------------------------ the picture */

  function pictureLayer(m, pic, id) {
    if (m.getLayer(id)) m.removeLayer(id);
    if (m.getSource(id)) m.removeSource(id);
    if (!pic || pic.base) return;
    const src = { type: 'raster', tiles: [pic.tiles], tileSize: 256, maxzoom: pic.maxzoom || 18, attribution: pic.credit };
    if (pic.bounds) src.bounds = pic.bounds;
    m.addSource(id, src);
    // under every layer of this page and under the Lebanon mask, above the base map
    const order = (m.getStyle().layers || []).map((l) => l.id);
    const firstVector = order.find((l) => l === 'lebanon-mask' || (l.startsWith('vm-') && l !== id));
    m.addLayer({
      id,
      type: 'raster',
      source: id,
      paint: {
        'raster-opacity': state.opacity,
        'raster-saturation': state.grey ? -1 : 0,
        'raster-fade-duration': 0,
      },
    }, firstVector);
  }

  function applyPicture() {
    const pic = pictures.find((p) => p.key === state.picture);
    const credit = () => fill(creditEl, pic.credit || '', pic.note ? el('span', { class: 'vm-credit-note', text: pic.note }) : null);
    credit();
    if (!map.isStyleLoaded()) return;   // the picture overlay draws it once the style has loaded
    const want = pic.base || 'satellite';
    if (handle.base !== want) handle.setBase(want);   // re-runs every overlay, the picture included
    else pictureLayer(map, pic, 'vm-picture');
    credit();
  }
  handle.overlay((m) => pictureLayer(m, pictures.find((p) => p.key === state.picture), 'vm-picture'));

  /* ------------------------------------------------------------ the layers */

  const sources = {};
  function dated(p) {
    // the day a change is drawn from: the picture it was first seen gone on, or its span's end
    return p.st || p.seen || p.to || null;
  }
  function dataFor(l) {
    const fs = files[l.src].features.filter((f) => l.match(f.properties || {}));
    const cut = state.cursor;
    return {
      type: 'FeatureCollection',
      features: fs
        .filter((f) => {
          if (!cut) return true;
          const d = l.src === 'burned' ? f.properties.d : dated(f.properties);
          return !d || d <= cut;
        })
        .map((f) => ({ ...f, properties: { ...f.properties, w: (f.properties || {}).w || 'wx' } })),
    };
  }
  const whenColour = ['match', ['get', 'w'], ...WHEN.flatMap((w) => [w.key, w.color]), '#9c8f86'];
  function whenCount(key) {
    return files.buildings.features.filter((f) => (f.properties || {}).w === key
      && ['building_destroyed', 'building_damaged'].includes(f.properties.k)).length;
  }

  function installLayers(m) {
    for (const l of [...ALL].reverse()) {
      const id = `vm-${l.key}`;
      const colour = l.type ? typeColor(l.type) : l.color;
      add(m, id, { type: 'geojson', data: dataFor(l) });
      const vis = state.on.has(l.key) ? 'visible' : 'none';
      if (l.kind === 'fill' || l.kind === 'area') {
        const byWhen = l.src === 'buildings' && state.byWhen && ['destroyed', 'damaged', 'added'].includes(l.key);
        layer(m, {
          id: `${id}-fill`, type: 'fill', source: id, layout: { visibility: vis },
          filter: ['==', ['geometry-type'], 'Polygon'],
          paint: { 'fill-color': byWhen ? whenColour : colour, 'fill-opacity': l.kind === 'area' ? 0.28 : 0.72 },
        });
        layer(m, {
          id: `${id}-line`, type: 'line', source: id, layout: { visibility: vis },
          filter: ['==', ['geometry-type'], 'Polygon'],
          paint: { 'line-color': l.ring ? '#ffffff' : byWhen ? whenColour : colour, 'line-width': l.kind === 'area' ? 1.8 : 1.1 },
        });
        layer(m, {
          id: `${id}-point`, type: 'circle', source: id, layout: { visibility: vis },
          filter: ['==', ['geometry-type'], 'Point'],
          paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 2.5, 17, 7], 'circle-color': byWhen ? whenColour : colour, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.2 },
        });
      } else if (l.kind === 'line') {
        layer(m, {
          id: `${id}-line`, type: 'line', source: id, layout: { visibility: vis, 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': colour, 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1.6, 17, 4.5] },
        });
      } else if (l.kind === 'outline') {
        layer(m, {
          id: `${id}-line`, type: 'line', source: id, layout: { visibility: vis },
          paint: { 'line-color': colour, 'line-width': 2, 'line-dasharray': [3, 2] },
        });
      }
      sources[l.key] = id;
    }
  }
  handle.overlay(installLayers);

  /* ------------------------------------------------------------ the panel */

  function counted(l) {
    return files[l.src].features.filter((f) => l.match(f.properties || {})).length;
  }

  function drawPanel() {
    const picList = el('div', { class: 'vm-pics', role: 'radiogroup', 'aria-label': 'Picture' },
      pictures.map((p) => el('label', { class: `vm-pic${p.key === state.picture ? ' on' : ''}` }, [
        el('input', { type: 'radio', name: 'vm-picture', value: p.key, checked: p.key === state.picture, onchange: () => { state.picture = p.key; applyPicture(); drawPanel(); syncCompare(); } }),
        el('span', {}, [el('b', { text: p.label }), el('i', { text: p.sub })]),
      ])));
    const controls = el('div', { class: 'vm-pic-controls' }, [
      el('label', {}, [
        el('input', { type: 'checkbox', checked: state.grey, onchange: (e) => { state.grey = e.target.checked; applyPicture(); syncCompare(); } }),
        ' In grey, so only the layers are in colour',
      ]),
      el('label', { class: 'vm-range' }, [
        'Picture ',
        el('input', { type: 'range', min: '0.2', max: '1', step: '0.05', value: String(state.opacity), oninput: (e) => {
          state.opacity = Number(e.target.value);
          if (map.getLayer('vm-picture')) map.setPaintProperty('vm-picture', 'raster-opacity', state.opacity);
        } }),
      ]),
      el('button', { type: 'button', class: `btn${state.compare ? ' primary' : ''}`, text: state.compare ? 'Stop comparing' : 'Compare two pictures', onclick: () => setCompare(!state.compare) }),
    ]);
    const groups = LAYERS.map((g) => el('fieldset', { class: 'vm-group' }, [
      el('legend', { text: g.group }),
      ...g.items.map((l) => {
        const n = counted(l);
        const colour = l.type ? typeColor(l.type) : l.color;
        return el('label', { class: `vm-layer${n ? '' : ' empty'}` }, [
          el('input', { type: 'checkbox', checked: state.on.has(l.key), disabled: !n, onchange: (e) => {
            if (e.target.checked) state.on.add(l.key); else state.on.delete(l.key);
            refresh();
          } }),
          el('span', { class: `vm-sw vm-sw-${l.kind}`, style: `--c:${colour}` }),
          el('span', { class: 'vm-name', text: l.label }),
          el('span', { class: 'vm-n', text: n ? n.toLocaleString('en-GB') : '0' }),
        ]);
      }),
      g.group === 'Houses and other buildings'
        ? el('label', { class: 'vm-when-toggle' }, [
          el('input', { type: 'checkbox', checked: state.byWhen, onchange: (e) => { state.byWhen = e.target.checked; refresh({ panel: true }); } }),
          ' Colour the buildings by the picture they were first seen gone on',
        ])
        : null,
      g.group === 'Houses and other buildings' && state.byWhen
        ? el('div', { class: 'vm-when' }, WHEN.map((w) => el('span', {}, [el('i', { style: `background:${w.color}` }), `${w.label} (${whenCount(w.key).toLocaleString('en-GB')})`])))
        : null,
    ]));
    fill(
      panel,
      el('header', { class: 'vm-head' }, [
        el('span', { class: 'st-eyebrow', text: 'Village map · The 2026 war' }),
        el('h1', { text: town.name }),
        town.name_ar ? el('p', { class: 'st-ar', lang: 'ar', dir: 'rtl', text: town.name_ar }) : null,
        el('p', { text: `${town.district || ''} district, South Lebanon. Every layer Green Southerners holds of the town: what its sharp pictures show changed on the ground, and the records of the 2026 war counted week by week below the map.` }),
      ]),
      el('section', {}, [el('h2', { text: 'Picture' }), picList, controls]),
      el('section', {}, [el('h2', { text: 'Layers' }), ...groups]),
      el('section', { class: 'vm-notes' }, [
        el('h2', { text: 'How to read it' }),
        el('p', { text: 'A change is drawn where it was found on two pictures, and dated by those pictures: it happened between them. The map says where and when it was first seen, never why or by whom.' }),
        el('p', { text: 'Fires, white phosphorus, displacement orders and detonations are counted by week at the town, never one by one: the corpus places most of them at the town, not at a house.' }),
        el('p', { text: 'Buildings on no pre-war map were found on the pictures and confirmed by further independent readings before they were drawn.' }),
        el('p', {}, ['The records themselves are not published. To access them, ', el('a', { href: CONTACT_URL, target: '_blank', rel: 'noopener', text: 'contact Green Southerners' }), '.']),
      ]),
    );
  }

  /* ------------------------------------------------------------ the timeline */

  const first = info.published_from;
  const lastWeek = (() => {
    const all = [...Object.keys(info.region_weeks || {}), ...Object.values(info.kinds).flatMap((k) => Object.keys(k.weeks))];
    const pics = (info.pictures.ongeo || []).map((p) => p.date);
    return [...all, ...pics].sort().pop() || first;
  })();
  const weeks = [];
  for (let d = mondayOf(first); d <= lastWeek; d = addDays(d, 7)) weeks.push(d);

  // The map as the reader has set it: its picture, layers, grey and dating colours. A link opens
  // the town's map page, an embed the same map without the site's header.
  const embedded = document.body.classList.contains('embed');
  const defaults = ALL.filter((l) => l.on).map((l) => l.key).sort().join(',');
  function shareWhat() {
    const layers = [...state.on].sort().join(',');
    const here = withParams(location.href, {
      embed: null,
      picture: state.picture === pictures[0].key ? null : state.picture,
      layers: layers === defaults ? null : layers,
      when: state.byWhen ? '1' : null,
      grey: state.grey ? '1' : null,
    });
    return {
      title: `${town.name}, every layer: the 2026 war`,
      link: here,
      embed: { src: withParams(here, { embed: '1' }), height: 900 },
    };
  }

  // The timeline is built once; a move of the cursor only changes classes, words and the slider's
  // value, so a drag is never cut short by the drawing it causes.
  const bars = [];
  const headText = el('b');
  const play = el('button', { type: 'button', class: 'btn', text: 'Play', onclick: () => togglePlay() });
  const slider = el('input', {
    type: 'range', min: '0', max: String(weeks.length), step: '1', value: String(weeks.length),
    'aria-label': 'Show what was seen up to this week',
    oninput: (e) => {
      const i = Number(e.target.value);
      state.cursor = i >= weeks.length ? null : addDays(weeks[i], 6);
      refresh();
    },
  });
  function buildTimeline() {
    const lanes = LANES.map((lane) => {
      const counts = lane.code === 'REG' ? info.region_weeks || {} : (info.kinds[lane.code] || {}).weeks || {};
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const peak = Math.max(1, ...Object.values(counts));
      const colour = lane.code === 'REG' ? typeColor('ALR') : typeColor(lane.code);
      return el('div', { class: 'vm-lane' }, [
        el('span', { class: 'vm-lane-label' }, [el('b', { text: lane.label }), el('i', { text: total ? `${total.toLocaleString('en-GB')} in all` : 'none' })]),
        el('div', { class: 'vm-bars' }, weeks.map((w) => {
          const n = counts[w] || 0;
          const bar = el('span', {
            class: 'vm-bar',
            title: n ? `Week of ${dateLabel(w)}: ${n} ${n === 1 ? lane.note.replace(/s\b/, '') : lane.note}` : `Week of ${dateLabel(w)}`,
            style: `--h:${n ? Math.max(12, (n / peak) * 100) : 0}%;--c:${colour}`,
          });
          bars.push([w, bar]);
          return bar;
        })),
      ]);
    });
    // Pictures a week or two apart (10 and 19 August at Al-Mansouri) would print over each other,
    // so one label names them all.
    const groups = [];
    for (const p of info.pictures.ongeo || []) {
      const i = weeks.findIndex((w) => w > p.date) - 1;
      const t = { at: i < 0 ? weeks.length - 1 : i, date: p.date };
      const g = groups[groups.length - 1];
      if (g && t.at - g[g.length - 1].at < 3) g.push(t);
      else groups.push([t]);
    }
    const pics = groups.map((g) => {
      const x = (g.reduce((s, t) => s + t.at, 0) / g.length + 0.5) / weeks.length * 100;
      return el('span', {
        class: 'vm-pic-tick',
        style: `--x:${x}%`,
        title: g.map((t) => `OnGeo picture of ${dateLabel(t.date)}`).join('; '),
        text: shortDays(g.map((t) => t.date)),
      });
    });
    fill(
      timeline,
      el('div', { class: 'vm-time-head' }, [
        headText,
        el('span', { class: 'vm-time-note', text: 'Records counted by week from 1 March 2026. The slider also limits the map to what was first seen by then; changes that cannot be dated more closely stay on.' }),
        play,
        el('span', { class: 'vm-share' }, [embedded ? credit() : null, shareBar(shareWhat, { align: 'right' })]),
      ]),
      el('div', { class: 'vm-lanes' }, [...lanes, el('div', { class: 'vm-lane vm-pics-lane' }, [el('span', { class: 'vm-lane-label' }, [el('b', { text: 'Sharp pictures' }), el('i', { text: 'OnGeo, 0.3 m' })]), el('div', { class: 'vm-ticks' }, pics)])]),
      el('div', { class: 'vm-slider' }, [slider]),
    );
  }
  function updateTimeline() {
    for (const [w, bar] of bars) bar.classList.toggle('after', Boolean(state.cursor && w > state.cursor));
    headText.textContent = state.cursor ? `Seen up to the week of ${dateLabel(mondayOf(state.cursor))}` : 'Everything, to the newest picture';
    const v = String(state.cursor ? weeks.findIndex((w) => w > state.cursor) : weeks.length);
    if (document.activeElement !== slider && slider.value !== v) slider.value = v;
    play.textContent = playing ? 'Pause' : 'Play';
  }

  let playing = false;
  let timer = null;
  function togglePlay() {
    playing = !playing;
    clearInterval(timer);
    if (playing) {
      let i = state.cursor ? weeks.findIndex((w) => w > state.cursor) : 0;
      if (i < 0 || i >= weeks.length) i = 0;
      timer = setInterval(() => {
        if (i >= weeks.length) {
          state.cursor = null;
          playing = false;
          clearInterval(timer);
        } else {
          state.cursor = addDays(weeks[i], 6);
          i++;
        }
        refresh();
      }, 650);
    }
    updateTimeline();
  }


  // The panel and the timeline are drawn before the map has loaded: the page reads at once on a
  // slow connection, and the map fills in when it is ready.
  buildTimeline();
  drawPanel();
  await handle.ready;

  /** Redraw the map; `panel` also redraws the panel (a colour key changed), never the timeline's
   * own slider, which is updated in place so a drag is never interrupted. */
  function refresh({ panel = false } = {}) {
    for (const l of ALL) {
      const src = map.getSource(`vm-${l.key}`);
      if (src) src.setData(dataFor(l));
      for (const part of ['fill', 'line', 'point']) {
        const id = `vm-${l.key}-${part}`;
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', state.on.has(l.key) ? 'visible' : 'none');
      }
      if (l.src === 'buildings' && ['destroyed', 'damaged', 'added'].includes(l.key)) {
        const colour = state.byWhen ? whenColour : l.color;
        if (map.getLayer(`vm-${l.key}-fill`)) map.setPaintProperty(`vm-${l.key}-fill`, 'fill-color', colour);
        if (map.getLayer(`vm-${l.key}-line`)) map.setPaintProperty(`vm-${l.key}-line`, 'line-color', l.ring ? '#ffffff' : colour);
        if (map.getLayer(`vm-${l.key}-point`)) map.setPaintProperty(`vm-${l.key}-point`, 'circle-color', colour);
      }
    }
    if (panel) drawPanel();
    updateTimeline();
  }

  /* A click on a change says what it is and between which pictures, never more. */
  const popup = handle.gl && handle.gl.Popup ? new handle.gl.Popup({ closeButton: true, maxWidth: '280px', className: 'vm-pop' }) : null;
  map.on('click', (e) => {
    if (!popup) return;
    const ids = ALL.flatMap((l) => ['fill', 'line', 'point'].map((p) => `vm-${l.key}-${p}`)).filter((id) => map.getLayer(id));
    const hits = map.queryRenderedFeatures(e.point, { layers: ids });
    if (!hits.length) return;
    const f = hits[0];
    const l = ALL.find((x) => f.layer.id.startsWith(`vm-${x.key}-`));
    popup.setLngLat(e.lngLat).setHTML(describe(l, f.properties || {})).addTo(map);
  });
  map.on('mousemove', (e) => {
    const ids = ALL.flatMap((l) => ['fill', 'point'].map((p) => `vm-${l.key}-${p}`)).filter((id) => map.getLayer(id));
    map.getCanvas().style.cursor = map.queryRenderedFeatures(e.point, { layers: ids }).length ? 'pointer' : '';
  });

  /* ------------------------------------------------------------ compare */

  let other = null;
  let syncing = false;
  async function setCompare(on) {
    state.compare = on;
    cmpEl.hidden = !on;
    handleEl.hidden = !on;
    if (on && !other) {
      other = await glMap(cmpEl, { camera: { center: map.getCenter().toArray(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() }, base: 'satellite', labels: false, interactive: false });
      other.map.setMaxZoom(19.4);
      other.overlay((m) => pictureLayer(m, pictures.find((p) => p.key === (state.right || defaultRight())), 'vm-picture'));
      await other.ready;
      const sync = () => {
        if (syncing) return;
        syncing = true;
        other.map.jumpTo({ center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() });
        syncing = false;
      };
      map.on('move', sync);
      sync();
    }
    if (on) {
      setSplit(0.5);
      syncCompare();
    }
    drawPanel();
  }
  function defaultRight() {
    // compare with the earliest picture before the war, else the oldest OnGeo
    const esri = pictures.find((p) => p.key === 'esri2023');
    return state.picture === 'esri2023' ? pictures[0].key : esri ? esri.key : pictures[pictures.length - 3].key;
  }
  function syncCompare() {
    if (!other || !state.compare) return;
    const right = pictures.find((p) => p.key === (state.right || defaultRight()));
    pictureLayer(other.map, right, 'vm-picture');
    if (other.map.getLayer('vm-picture')) other.map.setPaintProperty('vm-picture', 'raster-saturation', state.grey ? -1 : 0);
    creditEl.textContent = `Left: ${(pictures.find((p) => p.key === state.picture) || {}).label}. Right: ${right.label}.`;
  }
  function setSplit(x) {
    const r = Math.max(0.02, Math.min(0.98, x));
    cmpEl.style.clipPath = `inset(0 0 0 ${r * 100}%)`;
    handleEl.style.left = `${r * 100}%`;
    handleEl.setAttribute('aria-valuenow', String(Math.round(r * 100)));
  }
  const dragTo = (clientX) => {
    const box = stage.getBoundingClientRect();
    setSplit((clientX - box.left) / box.width);
  };
  handleEl.addEventListener('pointerdown', (e) => {
    handleEl.setPointerCapture(e.pointerId);
    const mv = (ev) => dragTo(ev.clientX);
    const up = () => { handleEl.removeEventListener('pointermove', mv); handleEl.removeEventListener('pointerup', up); };
    handleEl.addEventListener('pointermove', mv);
    handleEl.addEventListener('pointerup', up);
  });
  handleEl.addEventListener('keydown', (e) => {
    const now = Number(handleEl.getAttribute('aria-valuenow')) / 100;
    if (e.key === 'ArrowLeft') setSplit(now - 0.05);
    if (e.key === 'ArrowRight') setSplit(now + 0.05);
  });

  applyPicture();
  refresh();
}

/* ------------------------------------------------------------------ words */

function describe(l, p) {
  const span = p.sf || p.st
    ? `First seen gone on the picture of ${dateLabel(p.st)}${p.sf ? `; standing on the picture of ${dateLabel(p.sf)}` : ''}.`
    : p.seen
      ? `First seen changed on ${dateLabel(p.seen)}${p.from ? `; the last picture before it is of ${dateLabel(p.from)}` : ''}.`
      : p.from && p.to
        ? `Changed between the pictures of ${dateLabel(p.from)} and ${dateLabel(p.to)}.`
        : p.d
          ? `Fires that started in ${dateLabel(p.d).replace(/^1 /, '')}.`
          : '';
  const ground = p.gr === 'cleared' ? ' On the newest picture the plot is scraped clear.' : p.gr === 'rubble' ? ' On the newest picture rubble lies where it stood.' : '';
  const extra = p.added ? ' It is on no map of the buildings from before the war: it was found on the pictures.' : '';
  const size = p.ha ? ` About ${p.ha >= 1 ? p.ha.toFixed(1) : p.ha.toFixed(2)} ha.` : p.km ? ` About ${(p.km * 1000).toFixed(0)} m.` : '';
  return `<b>${escapeHtml(l ? l.label : '')}</b><br>${escapeHtml(span + ground + extra + size)}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function mondayOf(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  const k = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - k);
  return d.toISOString().slice(0, 10);
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function shortDay(iso) {
  const [, m, d] = iso.split('-');
  return `${+d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1]}`;
}

/** Several days as one label: "10 and 19 Aug" in one month, "31 Jul and 2 Aug" across two. */
function shortDays(isos) {
  if (isos.length === 1) return shortDay(isos[0]);
  const months = new Set(isos.map((d) => d.slice(0, 7)));
  if (months.size === 1) {
    const days = isos.map((d) => String(+d.slice(8, 10)));
    return `${days.slice(0, -1).join(', ')} and ${days[days.length - 1]} ${shortDay(isos[0]).split(' ')[1]}`;
  }
  return `${isos.slice(0, -1).map(shortDay).join(', ')} and ${shortDay(isos[isos.length - 1])}`;
}
