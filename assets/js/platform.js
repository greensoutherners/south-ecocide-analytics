/* The platform: the corpus's statistics on one map, under one timeline.
 *
 * Built the way Forensic Architecture builds its databases: a map that fills
 * the page, a panel beside it (filters, a search, and the towns in view, one
 * per row), a card that opens on a town, and a timeline along the foot that
 * chooses the dates and plays them.
 *
 * The site holds statistics, never records (the data owner, 2026-11-06): each
 * kind is counted by week and by town, and the page lists, draws and opens
 * towns, never a record. Where it once offered the records it says how to ask
 * Green Southerners for them.
 *
 * The corpus's rules hold here unchanged:
 *   - nothing is added across kinds: the panel, the list, every tooltip and
 *     every card count each kind apart;
 *   - fires and white phosphorus are drawn at their town, one mark per town
 *     and kind at the town's own point, its area growing with the records
 *     there in the dates chosen (a circle for fires, a diamond for white
 *     phosphorus); a mark places the town, never an event in it;
 *   - displacement orders shade the whole municipality, on a scale fixed for
 *     the whole period, so a place does not darken because the timeline moved,
 *     and a place with no order stays unshaded;
 *   - fires: every fire linked to an Israeli military attack, and every fire
 *     in the yellow-line zone or round Beaufort Castle with no attack linked; a
 *     town's tooltip and card say how many are which;
 *   - everything is the war of 2026, from 1 March 2026; the wildlife and trees
 *     layer is earlier context (2023 to 2024) and says so;
 *   - an embed about one kind shows that kind only, and `places=` keeps a view
 *     to the municipalities an investigation is about.
 *
 * Everything the reader sets is in the address, so a view can be shared, and
 * a post embeds a prepared view the same way: `?embed=1&types=BRN&...`.
 */

import { dataset, dateLabel, DATA, fmt, fmtArea, geo, load, meta, monthLabel, villages } from './data.js';
import { glMap, SOUTH_LL } from './gl.js';
import {
  COVER_CLASSES,
  coverLayer,
  ecoLayer,
  KIND,
  KINDS,
  landmarksLayer,
  markRadius,
  marksLayer,
  PLACE_GROUPS,
  placesLayer,
  regionsLayer,
  riverLayer,
  scarsLayer,
  STUDIO_STYLE,
  studioLayer,
  townsLayer,
  waterLayer,
  zonesLayer,
} from './gl-layers.js';
import { fromDay, strip, toDay } from './strip.js';
import { typeColor, typeRamp } from './theme.js';
import { el, fill, params, url } from './ui.js';

/** Where a reader asks for the records themselves. */
const CONTACT = 'https://greensoutherners.org/contact-us';

/** Towns with a written investigation, so a card can send a reader there. */
const INVESTIGATIONS = {
  273: { title: 'Aitaroun: a border town before and after', path: 'investigations/aitaroun.html' },
  183: { title: 'Beaufort castle and the ground around it', path: 'investigations/beaufort.html' },
  215: { title: 'Beaufort castle and the ground around it', path: 'investigations/beaufort.html' },
  217: { title: 'Beaufort castle and the ground around it', path: 'investigations/beaufort.html' },
  199: { title: 'Beaufort castle and the ground around it', path: 'investigations/beaufort.html' },
};

/** Prepared views a post or an investigation can open on. */
const FOCUS = {
  beaufort: {
    camera: { center: [35.5385, 33.3205], zoom: 12.4, pitch: 52, bearing: -28 },
    terrain: true,
    layers: { castle: true, river: true, studio: true, scars: true },
    studio: [215, 217],
  },
  litani: {
    bounds: [
      [35.2, 33.12],
      [35.72, 33.52],
    ],
    layers: { river: true, scars: true },
  },
  // The land before the war, what lives on it and the water through it, with
  // the attacks of 2026 over them.
  ecosystem: {
    bounds: [
      [35.1, 33.05],
      [35.9, 33.62],
    ],
    layers: { eco: true, cover: true, water: true },
  },
  // The orders addressed to whole regions, from Beirut's southern suburbs to
  // the border and the sea off Tyre.
  regions: {
    bounds: [
      [34.98, 33.05],
      [35.92, 33.9],
    ],
    layers: { regions: true },
  },
};

const DEFAULT_KINDS = KINDS.map((k) => k.code);

/** Columns that say where a record is, not what it is: never a filter. */
const PLACE_KEYS = new Set(['municipality', 'adm2', 'loc', 'district', 'governorate', 'town']);

/** How a sentence names one record of a kind, and several. */
const NOUN = {
  BRN: ['fire', 'fires'],
  WPB: ['white phosphorus attack', 'white phosphorus attacks'],
  ALR: ['displacement order', 'displacement orders'],
  ATT: ['attack on a town', 'attacks on towns'],
};

/** The columns a town's card breaks each kind down by. */
const BREAKDOWN = {
  BRN: ['fire_cause_id'],
  ALR: ['alarm_scope_id'],
  ATT: ['attack_type_id'],
};

/** The sizes the legend draws a mark at, in records. */
const SIZE_KEY = [1, 5, 20];

export async function platformPage({ embed = false } = {}) {
  const root = document.getElementById('platform');
  const away = embed ? { target: '_blank', rel: 'noopener' } : {};
  root.replaceChildren(el('p', { class: 'db-loading', text: 'Loading the statistics…' }));
  fitToViewport(root, embed);

  const query = params();
  const none = () => ({ type: 'FeatureCollection', features: [] });
  const [metaPayload, register, shapes, burnedData, zonesData, river, landmarks, studioIndex, regionsData] = await Promise.all([
    meta(),
    villages(),
    geo('municipalities'),
    geo('burned').catch(none),
    geo('zones'),
    geo('litani').catch(none),
    geo('landmarks').catch(none),
    load('studio/index.json').catch(() => ({ labels: [], towns: [] })),
    geo('alr_regions').catch(none),
  ]);
  const sets = {};
  await Promise.all(KINDS.map(async (k) => (sets[k.code] = await dataset(k.slug))));

  // Towns by name and district, as the statistics key them; municipalities by code.
  const townIndex = new Map(register.towns.map((t) => [`${t.name}|${t.district}`, t]));
  const places = new Map(shapes.features.map((f) => [f.properties.pcod, f.properties]));
  // Every town any kind counts, by its key.
  const known = new Set(townIndex.keys());
  for (const k of KINDS) {
    const ds = sets[k.code];
    const ti = ds.at.town;
    const di = ds.at.district;
    if (ti == null) continue;
    for (const row of ds.rows) {
      if (row[ti] == null) continue;
      known.add(`${ds.dict.town[row[ti]]}|${di != null && row[di] != null ? ds.dict.district[row[di]] : ''}`);
    }
  }

  /* ---------------------------------------------------------------- state */

  const firstDay = Math.min(...KINDS.map((k) => sets[k.code].minDay + toDay(sets[k.code].epoch)));
  const lastCell = Math.max(...KINDS.map((k) => sets[k.code].maxDay + toDay(sets[k.code].epoch)));
  // The site shows the record from its published day (1 March 2026) on, and
  // counts it by week, so the axis runs to the end of the last week counted.
  const start = metaPayload.published_from || metaPayload.war_start || fromDay(firstDay);
  const end = fromDay(monday(lastCell) + 6);

  const focus = FOCUS[query.focus] || null;
  const focusTown = /^\d+$/.test(query.focus || '') ? Number(query.focus) : null;
  const wanted = (query.types || '').split(',').filter((c) => KIND[c]);
  // An embed made for one kind of record shows that kind and offers no other.
  const locked = embed && wanted.length > 0;
  // The municipalities a view is about (an investigation's own places): every
  // record outside them is left out, and the rest of the map fades.
  const keep = (query.places || '').split(',').filter((x) => places.has(x));
  // An old address may still carry `id=`: a record is never opened here, so
  // it is read as nothing and drops out when the page rewrites the address.
  const state = {
    kinds: new Set(wanted.length ? wanted : DEFAULT_KINDS),
    // `none` leaves every municipality unshaded and outlines the towns named.
    shade: query.shade === 'none' ? 'none' : KIND[query.shade] && KIND[query.shade].form === 'towns' ? query.shade : null,
    filters: parseFilters(query.flt),
    loc: (query.loc || '').split(',').filter(Boolean),
    district: query.district || '',
    q: query.q || '',
    from: query.from || start,
    to: query.to || end,
    base: query.base === 'satellite' ? 'satellite' : 'light',
    terrain: query.terrain === '1' || Boolean(focus && focus.terrain),
    layers: {
      scars: query.scars !== '0',
      zones: query.zones === '1',
      studio: query.studio === '1' || Boolean(focus && focus.layers.studio) || focusTown != null,
      river: query.river === '1' || Boolean(focus && focus.layers.river),
      castle: query.castle === '1' || Boolean(focus && focus.layers.castle),
      lines: query.lines !== '0',
      regions: query.regions !== '0',
      cover: query.cover === '1' || Boolean(focus && focus.layers.cover),
      water: query.water === '1' || Boolean(focus && focus.layers.water),
      sites: query.sites === '1' || Boolean(focus && focus.layers.sites),
      eco: query.eco === '1' || Boolean(focus && focus.layers.eco),
    },
    // A frame as narrow as a post's column opens on the map, the panel a tap away.
    panel: ['records', 'layers', 'about', 'closed'].includes(query.panel)
      ? query.panel
      : window.matchMedia('(max-width: 900px)').matches
        ? 'closed'
        : 'records',
    // The town whose card is open, as "Town|District".
    town: query.town && known.has(query.town) ? query.town : null,
    place: query.place || null,
    area: null,
  };

  /* ---------------------------------------------------------------- frame */

  const app = el('div', { class: `db${embed ? ' db-embed' : ''}${state.panel === 'closed' ? ' panel-closed' : ''}` });
  const panel = el('aside', { class: 'db-panel', 'aria-label': 'Statistics and map layers' });
  const stage = el('div', { class: 'db-stage' });
  const mapEl = el('div', { class: 'db-map', role: 'region', 'aria-label': 'Map of Lebanon' });
  const legendEl = el('div', { class: 'db-legend' });
  const bannerEl = el('p', { class: 'db-banner', role: 'status' });
  const card = el('article', { class: 'db-card', 'aria-live': 'polite', hidden: true });
  const tip = el('div', { class: 'db-tip', hidden: true });
  const stripHost = el('div', { class: 'db-strip' });
  const toggle = el('button', {
    class: 'db-panel-toggle',
    type: 'button',
    'aria-expanded': state.panel === 'closed' ? 'false' : 'true',
    text: state.panel === 'closed' ? 'Filters and towns' : 'Close the panel',
    onclick: () => setPanel(app.classList.contains('panel-closed') ? 'records' : 'closed'),
  });
  fill(stage, el('div', { class: 'db-map-wrap' }, [mapEl, legendEl, bannerEl, card, tip, toggle]));
  root.replaceChildren(fill(app, panel, stage, stripHost));

  const keepBounds = keep.length ? boundsOf(keep) : null;
  const handle = await glMap(mapEl, {
    bounds: keepBounds || (focus && focus.bounds) || SOUTH_LL,
    camera: viewCamera(query.view) || (keepBounds ? null : focus && focus.camera),
    base: state.base,
    terrain: state.terrain,
    cooperative: embed,
  });
  const { map } = handle;
  if (new URLSearchParams(location.search).has('debug')) window.__db = { handle, state, sets, view: () => view };

  /* Layers, in the order they stack: the regions named by an order, town
   * shading, burned ground, the zone, the Studio's damage, municipal outlines,
   * the regions' outlines and names, the river, the towns' marks, the castle. */
  const site = new URL('../', DATA).href;
  const cover = coverLayer(handle);
  const regions = regionsLayer(handle, regionsData, {
    onPick: (key) => openArea(key),
    onHover: (key, e) => showTip(key ? areaTip(key) : null, e),
  });
  const regionScopes = new Set((regionsData.properties && regionsData.properties.scopes) || []);
  const towns = townsLayer(handle, shapes, {
    onPick: (props) => openPlace(props.pcod),
    onHover: (props, e, n) => showTip(props ? placeTip(props, n) : null, e),
  });
  const scars = scarsLayer(handle, burnedData);
  const zones = zonesLayer(handle, zonesData);
  const studio = studioLayer(handle, studioIndex, { base: DATA });
  towns.outlines();
  regions.above();
  const water = waterLayer(handle, () => geo('water'));
  const sites = placesLayer(handle, () => geo('places'), { onHover: (props, e) => showTip(props ? siteTip(props) : null, e) });
  const eco = ecoLayer(handle, () => geo('ecosystem'), { base: site, onHover: (props, e) => showTip(props ? ecoTip(props) : null, e) });
  const litani = riverLayer(handle, river);
  const marks = marksLayer(handle, {
    onPick: (props) => openTown(props.k, { fly: false }),
    onHover: (props, e) => showTip(props ? townTip(props.k) : null, e),
  });
  const castle = landmarksLayer(handle, landmarks);
  await handle.ready;

  scars.show(state.layers.scars);
  zones.show(state.layers.zones);
  regions.show(state.layers.regions && state.kinds.has('ALR'));
  cover.show(state.layers.cover);
  water.show(state.layers.water);
  sites.show(state.layers.sites);
  eco.show(state.layers.eco).then(() => {
    drawLayersTab();
    drawLegend();
  });
  towns.keep(keep);
  studio.show(state.layers.studio);
  litani.show(state.layers.river);
  castle.show(state.layers.castle);
  towns.lines(state.layers.lines);
  if (focus && focus.studio) studio.load(focus.studio);
  if (keep.length) {
    // The Studio's towns among the places kept.
    const kept = new Set(keep);
    const ids = register.towns.filter((t) => kept.has(t.adm3_pcod)).map((t) => t.id);
    const mapped = studioIndex.towns.filter((t) => ids.includes(t.id)).map((t) => t.id);
    if (mapped.length) studio.load(mapped);
  }
  if (focusTown != null) {
    studio.load([focusTown]);
    const t = studioIndex.towns.find((x) => x.id === focusTown) || register.towns.find((x) => x.id === focusTown);
    const box = t && (t.box || null);
    // With places kept, the view already frames all of them.
    if (box && !keep.length) map.fitBounds([[box[0], box[1]], [box[2], box[3]]], { padding: 40, duration: 0 });
  }
  // A base-map switch reinstalls every layer; the filters that depend on the
  // towns in view are put back once it has.
  map.on('style.load', () => setTimeout(() => refresh(), 0));
  map.on('moveend', () => {
    if (!studio.on || map.getZoom() < 10.5) return;
    const b = map.getBounds();
    const ids = studioIndex.towns
      .filter((t) => t.box && t.box[0] < b.getEast() && t.box[2] > b.getWest() && t.box[1] < b.getNorth() && t.box[3] > b.getSouth())
      .map((t) => t.id);
    if (ids.length) studio.load(ids);
  });
  // The legend draws the marks at the size the map draws them now, and stays
  // as open or as closed as the reader left it.
  let legendOpen = !embed || window.innerWidth > 700;
  let sizeKeyEl = null;
  map.on('zoomend', () => drawSizeKey());

  /* ---------------------------------------------------------------- panel */

  const tabs = el('nav', { class: 'db-tabs', role: 'tablist' });
  const recordsTab = el('section', { class: 'db-tab', 'data-tab': 'records' });
  const layersTab = el('section', { class: 'db-tab', 'data-tab': 'layers' });
  const aboutTab = el('section', { class: 'db-tab', 'data-tab': 'about' });
  const kindsHost = el('div', { class: 'db-block' });
  const filtersHost = el('div', { class: 'db-block' });
  const placeHost = el('div', { class: 'db-block' });
  const listHead = el('div', { class: 'db-list-head' });
  const list = el('div', { class: 'db-list', role: 'list', 'aria-label': 'Towns in view' });
  const listInner = el('div', { class: 'db-list-inner' });
  list.append(listInner);

  /** The kinds this view offers, in words: an embed made for one kind names that kind. */
  function offered() {
    const words = KINDS.filter((k) => !locked || state.kinds.has(k.code)).map((k) => noun(k.code, 2));
    return words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0] || '';
  }

  /** Where the records themselves went: to Green Southerners, on request. */
  const contactNote = (cls = 'db-note') =>
    el('p', { class: `${cls} db-contact` }, [
      'The records themselves are not published. To access them, ',
      el('a', { href: CONTACT, target: '_blank', rel: 'noopener', text: 'contact Green Southerners' }),
      '.',
    ]);

  fill(
    panel,
    el('header', { class: 'db-head' }, [
      el('span', { class: 'db-eyebrow', text: 'Green Southerners · Database' }),
      el('h1', { text: 'South Lebanon in the 2026 war, recorded' }),
      el('p', {
        text: `What the corpus recorded since 1 March 2026, counted by town and by week: ${offered()}. Filter, search a town, play the timeline, and open a town for its figures.`,
      }),
      keep.length ? el('p', { class: 'db-keep', text: keepLabel() }) : null,
      embed
        ? el('a', {
            class: 'db-full',
            href: url('platform.html'),
            ...away,
            text: 'Open the database full screen',
            onclick: (e) => {
              const q = new URLSearchParams(location.search);
              q.delete('embed');
              e.currentTarget.href = `${url('platform.html')}${q.toString() ? `?${q}` : ''}`;
            },
          })
        : null,
    ]),
    tabs,
    recordsTab,
    layersTab,
    aboutTab
  );

  for (const [key, label] of [
    ['records', 'Statistics'],
    ['layers', 'Map layers'],
    ['about', 'About'],
  ]) {
    tabs.append(
      el('button', {
        type: 'button',
        role: 'tab',
        class: 'db-tab-button',
        'data-tab': key,
        text: label,
        onclick: () => setPanel(key),
      })
    );
  }

  fill(recordsTab, kindsHost, filtersHost, placeHost, listHead, list, el('div', { class: 'db-block db-actions' }, [contactNote()]));

  function setPanel(name) {
    state.panel = name;
    app.classList.toggle('panel-closed', name === 'closed');
    toggle.setAttribute('aria-expanded', name === 'closed' ? 'false' : 'true');
    toggle.textContent = name === 'closed' ? 'Filters and towns' : 'Close the panel';
    for (const b of tabs.children) b.setAttribute('aria-selected', b.dataset.tab === name ? 'true' : 'false');
    for (const t of [recordsTab, layersTab, aboutTab]) t.hidden = t.dataset.tab !== name;
    requestAnimationFrame(() => map.resize());
    sync();
  }

  /* --------------------------------------------------------- kinds list */

  function drawKinds(counts) {
    const rows = KINDS.filter((k) => !locked || state.kinds.has(k.code)).map((k) => {
      const on = state.kinds.has(k.code);
      const input = el('input', { type: 'checkbox', checked: on, 'aria-label': k.short });
      input.addEventListener('change', () => {
        if (input.checked) state.kinds.add(k.code);
        else state.kinds.delete(k.code);
        if (!input.checked && state.shade === k.code) state.shade = null;
        drawFilters();
        drawLayersTab();
        refresh();
      });
      const n = counts[k.code];
      return el('label', { class: `db-kind${on ? '' : ' off'}` }, [
        input,
        swatch(k),
        el('span', { class: 'db-kind-name', text: k.short }),
        el('span', { class: 'db-kind-n', text: on ? `${fmt(n)}` : '' }),
      ]);
    });
    const shadeable = KINDS.filter((k) => k.form === 'towns' && state.kinds.has(k.code));
    let shadeRow = null;
    if (shadeable.length) {
      const choices = [...shadeable.map((k) => [k.code, k.short]), ['none', 'None']];
      shadeRow = el('div', { class: 'db-shade' }, [
        el('span', { class: 'db-label', text: 'Shade municipalities by' }),
        el(
          'div',
          { class: 'chips' },
          choices.map(([code, label]) =>
            el('button', {
              type: 'button',
              class: 'chip',
              'aria-pressed': (code === 'none' ? state.shade === 'none' : shadeCode() === code) ? 'true' : 'false',
              text: label,
              onclick: () => {
                state.shade = code;
                refresh();
              },
            })
          )
        ),
      ]);
    }
    fill(
      kindsHost,
      el('h2', { text: 'Kinds of record' }),
      el('div', { class: 'db-kinds' }, rows),
      el('p', { class: 'db-note', text: 'Each kind counted apart, in the dates the timeline shows, and never added together.' }),
      shadeRow
    );
  }

  /* ------------------------------------------------------------- filters */

  function drawFilters() {
    const groups = [];
    for (const k of KINDS) {
      if (!state.kinds.has(k.code)) continue;
      const ds = sets[k.code];
      const dims = ds.dims.filter((d) => !PLACE_KEYS.has(d.k) && ds.options(d.k).length > 1);
      const loc = k.code === 'WPB' ? null : ds.at.loc != null && ds.options('loc').length > 1 ? 'loc' : null;
      const keys = [...dims.map((d) => d.k), ...(loc ? [loc] : [])];
      if (!keys.length) continue;
      const active = Object.values(state.filters[k.code] || {}).some((v) => v.length);
      const details = el('details', { class: 'db-filter', open: active || state.kinds.size === 1 }, [
        el('summary', {}, [swatch(k), ` ${k.short}`, active ? el('span', { class: 'db-dot-on', 'aria-label': 'filtered' }) : null]),
      ]);
      for (const key of keys) {
        const options = ds.options(key);
        const chosen = (state.filters[k.code] || {})[key] || [];
        details.append(
          el('div', { class: 'db-group' }, [
            el('span', { class: 'db-label', text: key === 'loc' ? 'Location' : ds.dimLabel(key) }),
            el(
              'div',
              { class: 'chips' },
              options.map((o) =>
                el('button', {
                  type: 'button',
                  class: 'chip',
                  'aria-pressed': chosen.includes(o.value) ? 'true' : 'false',
                  text: o.label,
                  onclick: () => {
                    const f = (state.filters[k.code] = state.filters[k.code] || {});
                    const now = f[key] || [];
                    f[key] = now.includes(o.value) ? now.filter((v) => v !== o.value) : [...now, o.value];
                    drawFilters();
                    refresh();
                  },
                })
              )
            ),
          ])
        );
      }
      groups.push(details);
    }
    fill(
      filtersHost,
      el('h2', { text: 'Filter' }),
      groups.length ? groups : el('p', { class: 'db-note', text: 'Choose a kind of record to filter it.' })
    );
  }

  /* --------------------------------------------------------- place, search */

  function drawPlace() {
    const districts = new Set();
    for (const k of KINDS) for (const o of sets[k.code].options('district')) districts.add(o.value);
    const choose = el('select', { class: 'db-select', 'aria-label': 'District' });
    choose.append(el('option', { value: '', text: 'Every district' }));
    for (const d of [...districts].sort((a, b) => a.trim().localeCompare(b.trim()))) {
      choose.append(el('option', { value: d, text: d.trim(), selected: d === state.district }));
    }
    choose.addEventListener('change', () => {
      state.district = choose.value;
      refresh();
    });
    const search = el('input', {
      type: 'search',
      class: 'db-search',
      placeholder: 'Search a town',
      value: state.q,
      'aria-label': 'Search a town by its name',
    });
    let timer = null;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.q = search.value.trim();
        refresh();
      }, 180);
    });
    fill(
      placeHost,
      el('div', { class: 'db-place-row' }, [
        el('label', { class: 'db-group' }, [el('span', { class: 'db-label', text: 'District' }), choose]),
        el('label', { class: 'db-group db-grow' }, [el('span', { class: 'db-label', text: 'Town' }), search]),
      ])
    );
  }

  /* ---------------------------------------------------------- layers tab */

  // The Studio's layers that hold something and that the site draws.
  const studioHeld = new Set(studioIndex.towns.flatMap((t) => Object.entries(t.layers || {}).filter(([, n]) => n > 0).map(([key]) => key)));

  function drawLayersTab() {
    const baseRow = el('div', { class: 'chips' }, [
      ['light', 'Map'],
      ['satellite', 'Satellite'],
    ].map(([value, label]) =>
      el('button', {
        type: 'button',
        class: 'chip',
        'aria-pressed': handle.base === value ? 'true' : 'false',
        text: label,
        onclick: () => {
          state.base = value;
          handle.setBase(value);
          drawLayersTab();
          drawLegend();
          sync();
        },
      })
    ));
    const terrain = el('input', { type: 'checkbox', checked: handle.terrain });
    terrain.addEventListener('change', () => {
      state.terrain = terrain.checked;
      handle.setTerrain(terrain.checked);
      sync();
    });
    const toggleRow = (key, label, note, layerObj) => {
      const input = el('input', { type: 'checkbox', checked: state.layers[key] });
      input.addEventListener('change', () => {
        state.layers[key] = input.checked;
        if (key === 'lines') towns.lines(input.checked);
        else if (key === 'regions') refresh();
        else {
          const shown = layerObj.show(input.checked);
          // A layer that loads its data says so when it has: draw its key then.
          if (shown && shown.then) shown.then(() => {
            drawLayersTab();
            drawLegend();
          });
        }
        if (key === 'studio' && input.checked) map.fire('moveend');
        drawLegend();
        drawLayersTab();
        sync();
      });
      return el('label', { class: 'db-option' }, [input, el('span', {}, [label, el('small', { text: note })])]);
    };
    const studioKeys = studio.keys.filter((k) => k !== 'counting_area' && STUDIO_STYLE[k] && studioHeld.has(k));
    const studioList = state.layers.studio && studioKeys.length
      ? el(
          'div',
          { class: 'db-studio-keys' },
          studioKeys.map((key) => {
            const label = studioIndex.labels.find((l) => l.key === key);
            const input = el('input', { type: 'checkbox', checked: !studio.isHidden(key) });
            input.addEventListener('change', () => studio.hide(key, !input.checked));
            return el('label', { class: 'db-option small' }, [
              input,
              el('span', { class: 'db-sw', style: `background:${STUDIO_STYLE[key].color}` }),
              el('span', { text: label ? label.title : key }),
            ]);
          })
        )
      : null;

    fill(
      layersTab,
      el('div', { class: 'db-block' }, [
        el('h2', { text: 'Ground' }),
        baseRow,
        el('label', { class: 'db-option' }, [terrain, el('span', {}, ['Relief in 3D', el('small', { text: 'tilt the map with the right button, or two fingers' })])]),
      ]),
      el('div', { class: 'db-block' }, [
        el('h2', { text: 'Layers' }),
        state.kinds.has('BRN')
          ? toggleRow('scars', 'Burned ground', 'the ground the fires burned, measured on Sentinel-2 and merged by the month each fire began; drawn for the months the dates reach, whatever the filters', scars)
          : null,
        !locked || state.layers.studio || keep.length
          ? toggleRow('studio', 'Damage mapped in the Village Studio', `buildings and roads read on sharp pictures in ${studioIndex.towns.length} towns, from the day each change was first seen`, studio)
          : null,
        studioList,
        state.kinds.has('ALR')
          ? toggleRow('regions', 'Orders to a whole region', "everyone south of a river, Beirut's southern suburbs, Tyre and its camps, the sea off Tyre; drawn from the orders' words and counted by week, while an order is in the dates shown and no filter, district or search narrows the orders", regions)
          : null,
        toggleRow('zones', 'The yellow-line zone', 'declared or observed military presence, from the day each outline applies; a place, not a finding', zones),
        toggleRow('river', 'The Litani River', 'OpenStreetMap', litani),
        toggleRow('castle', 'Beaufort Castle', 'OpenStreetMap', castle),
        toggleRow('lines', 'Municipal boundaries', 'OCHA, 1,627 municipalities', null),
      ]),
      el('div', { class: 'db-block' }, [
        el('h2', { text: 'The land, before the war' }),
        toggleRow('eco', 'Wildlife and trees, recorded 2023 to 2024', 'Green Southerners field records of 22 animals and 11 trees and shrubs, before this war, each drawn as its species', eco),
        ecoKey(),
        toggleRow('cover', 'Land use and land cover, 2025', 'Impact Observatory, Microsoft and Esri, from Sentinel-2 at 10 m', cover),
        toggleRow('water', 'Water', 'rivers, streams, canals, lakes and reservoirs; OpenStreetMap', water),
        toggleRow('sites', 'Places', 'cultural sites and places of worship, hospitals and clinics, schools and universities; OpenStreetMap, which maps only part of them', sites),
      ])
    );
  }

  /* ----------------------------------------------------------- about tab */

  fill(
    aboutTab,
    el('div', { class: 'db-block db-prose' }, [
      el('h2', { text: 'What the database holds' }),
      el('p', { text: 'Green Southerners recorded the war of 2026 in South Lebanon from 1 March 2026, from satellites, footage, press reporting and official statements. The page shows statistics, never single records: fires, white phosphorus attacks and displacement orders, each counted by town and by week. Everything on the map belongs to the 2026 war, except the wildlife and trees layer, recorded in 2023 and 2024, and the land cover of 2025, which show the land before it.' }),
      contactNote('db-contact-about'),
      el('h3', { text: 'How to read it' }),
      el('ul', {}, [
        el('li', { text: 'Each kind of record is collected and counted apart. The database never adds two kinds together: the corpus does not collect every kind of attack, so a combined total would claim a completeness it does not have.' }),
        el('li', { text: "Each mark on the map is a town, at the town's own point, sized by the records there in the dates chosen: its area grows with their number. A mark places the town, not an event in it. Fires are circles and white phosphorus attacks are diamonds; open a town for its figures." }),
        el('li', { text: 'Records are counted by week, so the dates chosen take in whole weeks: a week is counted when its first day falls inside them.' }),
        el('li', { text: 'Displacement orders name a town, so they shade the whole municipality, darker with more orders. A municipality with no order is left unshaded: not having a record is not the same as nothing having happened.' }),
        el('li', { text: "Some displacement orders name no town but a whole region: everyone south of the Zahrani or the Litani, Beirut's southern suburbs, Tyre with its camps, the sea off Tyre. Each region is a violet area with a dashed edge, drawn from the orders' words, because the maps the orders came with are not held. Its orders are counted on the area by week, and on a town only where an order names the town too." }),
        el('li', { text: 'Fires: every fire the corpus links to an Israeli military attack (an attack documented at the same town on a day of the fire, or a source that names it), and every fire in the yellow-line zone or in Arnoun, Kfar Tebnit, Yohmor and the two Zawtars round Beaufort Castle with no attack linked. A town says how many of its fires are which. No attack linked is not a finding that none happened.' }),
        el('li', { text: 'Burned ground is the ground the fires burned, measured on Sentinel-2 and merged by the month each fire began. It is drawn for every fire in the months the dates reach, whatever the filters.' }),
      ]),
      el('h3', { text: 'Sources' }),
      el('p', { text: 'Municipal boundaries: OCHA Lebanon, Common Operational Dataset. Fire detections: NASA FIRMS. Burn scars and imagery: Copernicus Sentinel-2. The Litani, the Zahrani, water, places and Beaufort Castle: OpenStreetMap contributors (ODbL). Land cover 2025: Impact Observatory, Microsoft and Esri (CC BY 4.0). Wildlife and trees: Green Southerners, 2023 to 2024. Base map: Mapbox, or OpenFreeMap and OpenStreetMap where Mapbox is not configured. Relief: Mapbox or AWS Terrain Tiles.' }),
      el('p', { class: 'db-note' }, [
        `Data of ${dateLabel(metaPayload.generated_at.slice(0, 10))}. `,
        el('a', { href: url('pages/about.html'), ...away, text: 'Method and limits' }),
        ' · ',
        el('a', { href: url('investigations/'), ...away, text: 'Investigations' }),
      ]),
    ])
  );

  /* ------------------------------------------------------------- compute */

  let view = { towns: [], byKey: new Map(), counts: {}, peaks: {}, perPcod: {}, shade: null, other: null, unplaced: {} };

  /** The town names a search matches, in English or in Arabic. */
  let searched = { q: null, names: new Set() };
  function townsMatching(q) {
    if (searched.q === q) return searched.names;
    const needle = fold(q);
    const names = new Set();
    if (needle) {
      for (const k of KINDS) for (const name of sets[k.code].dict.town || []) if (fold(name).includes(needle)) names.add(name);
      for (const t of register.towns) if (t.name_ar && fold(t.name_ar).includes(needle)) names.add(t.name);
    }
    searched = { q, names };
    return names;
  }

  function selection(k, withTime) {
    const ds = sets[k.code];
    const filters = { ...(state.filters[k.code] || {}) };
    if (keep.length) filters.municipality = keep;
    if (state.loc.length && ds.at.loc != null) filters.loc = state.loc;
    if (state.district) filters.district = [state.district];
    const range = withTime
      ? { from: toDay(state.from) - toDay(ds.epoch), to: toDay(state.to) - toDay(ds.epoch) }
      : {};
    let rows = ds.select({ filters, ...range });
    if (state.q) {
      // A search reads town names only: the site holds no record to find.
      const names = townsMatching(state.q);
      const ti = ds.at.town;
      rows = rows.filter((r) => {
        const t = ds.rows[r][ti];
        return t != null && names.has(ds.dict.town[t]);
      });
    }
    return rows;
  }

  function shadeCode() {
    if (state.shade === 'none') return null;
    if (state.shade && state.kinds.has(state.shade)) return state.shade;
    const k = KINDS.find((x) => x.form === 'towns' && state.kinds.has(x.code));
    return k ? k.code : null;
  }

  /**
   * Whether the regions can be drawn as the panel stands. Their orders are
   * counted by week only, so they follow the dates and nothing else: while a
   * filter, a district or a search narrows the orders, they are left out
   * rather than drawn with counts the filter never reached. A filter on the
   * scope that keeps a region's own scope leaves them in.
   */
  function regionsHeld() {
    if (!state.layers.regions || !state.kinds.has('ALR')) return false;
    if (keep.length || state.district || state.q || state.loc.length) return false;
    for (const [key, values] of Object.entries(state.filters.ALR || {})) {
      if (!values || !values.length) continue;
      if (key === 'alarm_scope_id' && values.some((v) => regionScopes.has(v))) continue;
      return false;
    }
    return true;
  }

  function refresh() {
    const counts = {};
    const lanes = [];
    const perPcod = {};
    const peaks = {};
    const byKey = new Map();
    const unplaced = {};

    for (const k of KINDS) {
      const ds = sets[k.code];
      const inWindow = selection(k, true);
      counts[k.code] = ds.size(inWindow);
      if (!state.kinds.has(k.code)) continue;
      const all = selection(k, false);
      const epoch = toDay(ds.epoch);
      lanes.push({ code: k.code, label: k.short, color: typeColor(k.code), bins: weekBins(ds, all, epoch) });

      // Each town in view, with its count and its cells per kind.
      const ti = ds.at.town;
      const di = ds.at.district;
      const mi = ds.at.municipality;
      for (const r of inWindow) {
        const row = ds.rows[r];
        const w = ds.weight(r);
        if (ti == null || row[ti] == null) {
          unplaced[k.code] = (unplaced[k.code] || 0) + w;
          continue;
        }
        const name = ds.dict.town[row[ti]];
        const district = di != null && row[di] != null ? ds.dict.district[row[di]] : '';
        const key = `${name}|${district}`;
        let t = byKey.get(key);
        if (!t) {
          t = { key, name, district, n: {}, cells: {}, pcod: null, point: null };
          byKey.set(key, t);
        }
        t.n[k.code] = (t.n[k.code] || 0) + w;
        (t.cells[k.code] = t.cells[k.code] || []).push(r);
        if (!t.pcod && mi != null && row[mi] != null) t.pcod = ds.dict.municipality[row[mi]];
      }

      if (k.form === 'towns') {
        perPcod[k.code] = perMunicipality(ds, inWindow);
        // The scale is fixed for the whole period, so playing does not darken a place.
        peaks[k.code] = Math.max(1, ...Object.values(perMunicipality(ds, all)));
      }
    }

    // One mark per town and kind drawn as points, at the town's own point.
    const features = [];
    for (const t of byKey.values()) {
      t.point = townPoint(t.key);
      if (!t.point) continue;
      for (const k of KINDS) {
        if (k.form !== 'points' || !t.n[k.code]) continue;
        features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: t.point }, properties: { t: k.code, n: t.n[k.code], k: t.key } });
      }
    }
    // The towns in view, by their largest single count: two kinds are never added.
    const largest = (t) => Math.max(0, ...Object.values(t.n));
    const listed = [...byKey.values()].sort((a, b) => largest(b) - largest(a) || a.name.localeCompare(b.name));

    const shade = shadeCode();
    if (shade) towns.shade(shade, perPcod[shade], peaks[shade]);
    else towns.shade(null, {}, 1);
    const other = KINDS.find((k) => k.form === 'towns' && k.code !== shade && state.kinds.has(k.code));
    towns.mark(other ? other.code : null, other ? Object.keys(perPcod[other.code] || {}) : []);

    marks.set(features);
    marks.select(state.town);
    scars.show(state.layers.scars && state.kinds.has('BRN'));
    scars.window(state.from, state.to);
    zones.at(state.to);
    studio.until(state.to);
    regions.window(state.from, state.to);
    regions.show(regionsHeld());

    view = { towns: listed, byKey, counts, peaks, perPcod, shade, other: other ? other.code : null, unplaced };
    strips.setLanes(lanes);
    drawKinds(counts);
    drawList();
    drawLegend();
    drawBanner();
    if (state.town) drawTownCard();
    else if (state.place) drawPlaceCard();
    else if (state.area) drawAreaCard();
    sync();
  }

  /** Records per municipality code over some cells. */
  function perMunicipality(ds, rows) {
    const out = {};
    const mi = ds.at.municipality;
    if (mi == null) return out;
    for (const r of rows) {
      const v = ds.rows[r][mi];
      if (v == null) continue;
      const pcod = ds.dict.municipality[v];
      out[pcod] = (out[pcod] || 0) + ds.weight(r);
    }
    return out;
  }

  /** A town's own point, [lon, lat], from the statistics or the register. */
  function townPoint(key) {
    for (const k of KINDS) {
      const p = sets[k.code].townPoints[key];
      if (p) return p;
    }
    const t = townIndex.get(key);
    return t && t.lon != null && t.lat != null ? [t.lon, t.lat] : null;
  }

  /* ---------------------------------------------------------------- list */

  function drawList() {
    const visible = KINDS.filter((k) => state.kinds.has(k.code));
    fill(
      listHead,
      el('h2', { text: 'Towns in view' }),
      el(
        'div',
        { class: 'db-counts' },
        visible.map((k) => el('span', { class: 'db-count', title: `${k.short} in view` }, [swatch(k), ` ${fmt(view.counts[k.code])}`]))
      )
    );
    const rows = view.towns.map((t) =>
      el(
        'button',
        {
          type: 'button',
          role: 'listitem',
          class: `db-town${state.town === t.key ? ' on' : ''}`,
          'data-key': t.key,
          onclick: () => openTown(t.key, { fly: true }),
        },
        [
          el('span', { class: 'db-town-name' }, [t.name, t.district ? el('small', { text: t.district.trim() }) : null]),
          el(
            'span',
            { class: 'db-town-counts' },
            visible.map((k) => {
              const n = t.n[k.code];
              return el('span', { class: 'db-town-n', title: n ? `${fmt(n)} ${noun(k.code, n)}` : null }, n ? [swatch(k), fmt(n)] : []);
            })
          ),
        ]
      )
    );
    // Records that name no town (an order to a whole region, the sea, a
    // building) are in the counts above and on no row.
    const notes = visible
      .filter((k) => view.unplaced[k.code])
      .map((k) => {
        const n = view.unplaced[k.code];
        return el('p', { class: 'db-note db-unplaced', text: `${fmt(n)} ${noun(k.code, n)} in view ${n === 1 ? 'names' : 'name'} no town: ${n === 1 ? 'it is' : 'they are'} in the count above, on no row.` });
      });
    listInner.replaceChildren(
      ...(rows.length ? rows : [el('p', { class: 'db-note db-empty', text: 'No town matches these filters and dates.' })]),
      ...notes
    );
  }

  /** Scroll the list to a town's row, if it is in view. */
  function reveal(key) {
    const row = [...listInner.children].find((n) => n.dataset && n.dataset.key === key);
    if (!row || !list.clientHeight) return;
    const top = row.offsetTop;
    if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = Math.max(0, top - list.clientHeight / 3);
  }

  /* ---------------------------------------------------------------- cards */

  function openTown(key, { fly = true } = {}) {
    if (!key || !known.has(key)) return;
    state.town = key;
    state.place = null;
    state.area = null;
    regions.select(null);
    marks.select(key);
    const t = view.byKey.get(key);
    const reg = townIndex.get(key);
    towns.select((t && t.pcod) || (reg && reg.adm3_pcod) || null);
    const point = townPoint(key);
    const narrow = window.matchMedia('(max-width: 900px)').matches;
    // On a narrow screen the card is a sheet over the lower half: the town
    // lands above it.
    const offset = narrow ? [0, -Math.round(mapEl.clientHeight * 0.25)] : [0, 0];
    if (fly && point) map.flyTo({ center: point, zoom: Math.max(map.getZoom(), 11.5), offset, duration: 900 });
    drawTownCard();
    // On a narrow screen the panel covers the map: get it out of the way.
    if (narrow) setPanel('closed');
    drawList();
    reveal(key);
    sync();
  }

  function drawTownCard() {
    const key = state.town;
    const cut = key.lastIndexOf('|');
    const name = key.slice(0, cut);
    const district = key.slice(cut + 1).trim();
    const reg = townIndex.get(key) || null;
    const t = view.byKey.get(key);
    const blocks = [];
    for (const k of KINDS) {
      if (!state.kinds.has(k.code)) continue;
      const cells = (t && t.cells[k.code]) || [];
      if (cells.length) blocks.push(kindBlock(k, cells));
    }
    const pcod = (t && t.pcod) || (reg && reg.adm3_pcod) || null;
    const muni = pcod ? places.get(pcod) : null;
    const fields = [];
    if (district) fields.push(['District', district]);
    if (muni) fields.push(['Municipality', muni.name_ar ? `${muni.name} · ${muni.name_ar}` : muni.name]);
    const links = [];
    if (reg) links.push(el('a', { href: url(`pages/village.html?v=${reg.id}`), ...away, text: `${reg.name}: everything recorded there` }));
    const inv = reg && INVESTIGATIONS[reg.id];
    if (inv) links.push(el('a', { href: url(inv.path), ...away, text: `Investigation: ${inv.title}` }));
    fill(
      card,
      el('div', { class: 'db-card-head' }, [
        el('span', { class: 'db-card-kind', text: 'Town' }),
        el('button', { type: 'button', class: 'db-close', 'aria-label': 'Close the card', text: '×', onclick: closeCard }),
      ]),
      el('h3', { class: 'db-card-id', text: name }),
      reg && reg.name_ar ? el('p', { class: 'db-card-ar', lang: 'ar', dir: 'rtl', text: reg.name_ar }) : null,
      fields.length ? el('dl', { class: 'db-card-fields' }, fields.flatMap(([a, b]) => [el('dt', { text: a }), el('dd', { text: b })])) : null,
      blocks.length
        ? el('div', { class: 'db-sums' }, blocks)
        : el('p', { class: 'db-note', text: 'Nothing of the kinds shown is recorded at this town in these dates.' }),
      el('p', { class: 'db-note', text: 'Counted per kind, by week, in the dates the timeline shows. The kinds are never added together.' }),
      links.length ? el('div', { class: 'db-card-links' }, links) : null,
      contactNote()
    );
    card.hidden = false;
  }

  /** One kind at a town or a municipality: its count, how it splits, its measures. */
  function kindBlock(k, cells) {
    const ds = sets[k.code];
    const n = ds.size(cells);
    const parts = [el('div', { class: 'db-sum-head' }, [swatch(k), el('b', { text: fmt(n) }), el('span', { text: noun(k.code, n) })])];
    const lead = split(k.code, cells, n);
    if (lead) parts.push(el('p', { class: 'db-sum-lead', text: lead }));
    for (const key of BREAKDOWN[k.code] || []) {
      if (ds.at[key] == null) continue;
      const groups = ds.group(cells, key);
      if (!groups.length) continue;
      parts.push(
        el('div', { class: 'db-sum-group' }, [
          el('span', { class: 'db-label', text: ds.dimLabel(key) }),
          el('dl', { class: 'db-sum-list' }, groups.flatMap((g) => [el('dt', { text: g.label }), el('dd', { text: fmt(g.n) })])),
        ])
      );
    }
    for (const m of ds.measures) {
      const s = ds.sum(cells, m.k);
      if (!s.records) continue;
      const value = m.unit === 'ha' ? `${fmtArea(s.total)} ha` : fmt(s.total);
      parts.push(
        el('p', { class: 'db-sum-measure' }, [
          `${m.label}: `,
          el('b', { text: value }),
          s.records < n ? `, for ${fmt(s.records)} of the ${fmt(n)}` : '',
        ])
      );
    }
    return el('section', { class: 'db-sum' }, parts);
  }

  /**
   * How a kind's records at a town split, in a few words: fires linked to an
   * attack or not, white phosphorus geolocated or not. Empty for other kinds.
   */
  function split(code, cells, n) {
    const ds = sets[code];
    const count = (key, value) => (ds.group(cells, key).find((g) => g.key === value) || { n: 0 }).n;
    if (code === 'BRN' && ds.at.shown_as != null) {
      const linked = count('shown_as', 'attack');
      if (linked === n) return n === 1 ? 'Linked to an Israeli attack' : 'All linked to an Israeli attack';
      if (!linked) return n === 1 ? 'No attack linked' : 'No attack linked to any of them';
      return `${fmt(linked)} linked to an Israeli attack, ${fmt(n - linked)} with no attack linked`;
    }
    if (code === 'WPB' && ds.at.geolocated != null) {
      const placed = count('geolocated', 'geolocated');
      if (placed === n) return n === 1 ? 'Geolocated' : 'All geolocated';
      if (!placed) return n === 1 ? 'Not geolocated' : 'None geolocated';
      return `${fmt(placed)} geolocated, ${fmt(n - placed)} not geolocated`;
    }
    return '';
  }

  function closeCard() {
    card.hidden = true;
    state.town = null;
    state.place = null;
    state.area = null;
    marks.select(null);
    towns.select(null);
    regions.select(null);
    drawList();
    sync();
  }

  function openPlace(pcod) {
    state.place = pcod;
    state.town = null;
    state.area = null;
    marks.select(null);
    regions.select(null);
    towns.select(pcod);
    drawPlaceCard();
    drawList();
    sync();
  }

  /** A region named by orders: its outline, its orders in the dates shown, how it was drawn. */
  function openArea(key, { fly = true } = {}) {
    if (!regions.area(key)) return;
    state.area = key;
    state.town = null;
    state.place = null;
    marks.select(null);
    towns.select(null);
    regions.select(key);
    if (fly) flyToArea(key);
    drawAreaCard();
    if (window.matchMedia('(max-width: 900px)').matches) setPanel('closed');
    drawList();
    sync();
  }

  function drawAreaCard() {
    const a = regions.area(state.area);
    if (!a) return;
    const size =
      a.kind === 'river' && a.share_of_south
        ? `about ${fmt(Math.round(a.km2))} km², ${Math.round(a.share_of_south * 100)}% of the South and Nabatieh governorates`
        : `about ${fmt(Math.round(a.km2))} km²`;
    // Months, never days: the region file gives its first and last orders by month.
    const ml = (ym) => (ym && ym.length <= 7 ? monthLabel(ym) : dateLabel(ym));
    const span = a.first ? (a.first === a.last ? ml(a.first) : `${ml(a.first)} to ${ml(a.last)}`) : '';
    const orders = (n) => `${fmt(n)} ${n === 1 ? 'order' : 'orders'}`;
    const fields = [
      ['In these dates', a.count === a.n ? `${orders(a.count)}, every one on record` : `${fmt(a.count)} of the ${orders(a.n)} on record`],
      ['On record', `${orders(a.n)}${span ? `, ${span}` : ''}`],
      ['Area drawn', size],
    ];
    fill(
      card,
      el('div', { class: 'db-card-head' }, [
        el('span', { class: 'db-card-kind' }, [swatch(KIND.ALR), ' Displacement orders to a whole region']),
        el('button', { type: 'button', class: 'db-close', 'aria-label': 'Close the card', text: '×', onclick: closeCard }),
      ]),
      el('h3', { class: 'db-card-id', text: a.name }),
      a.name_ar ? el('p', { class: 'db-card-ar', lang: 'ar', dir: 'rtl', text: a.name_ar }) : null,
      el('dl', { class: 'db-card-fields' }, fields.flatMap(([x, y]) => [el('dt', { text: x }), el('dd', { text: y })])),
      (a.targets || []).length
        ? el('div', { class: 'db-area-targets' }, [
            el('span', { class: 'db-label', text: 'Named in the orders' }),
            el('ul', {}, a.targets.map((x) => el('li', { text: x }))),
          ])
        : null,
      regionsHeld() ? null : el('p', { class: 'db-note', text: 'Counted by date only: a filter, a district or a search does not reach the orders to a region, so the area is off the map while one is on.' }),
      el('p', { class: 'db-note', text: a.basis }),
      el('p', { class: 'db-note', text: 'An area is where an order told people to leave, not a finding about what happened there. An order that also names a town is counted on that town too. Orders are counted by week: a week is in these dates when its first day is.' })
    );
    card.hidden = false;
  }

  function flyToArea(key) {
    const a = regions.area(key);
    if (!a) return;
    const b = bbox(a.geometry);
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, maxZoom: 12.5, duration: 900 });
  }

  function drawPlaceCard() {
    const props = places.get(state.place);
    if (!props) return;
    const blocks = [];
    for (const k of KINDS) {
      if (!state.kinds.has(k.code)) continue;
      const ds = sets[k.code];
      const mi = ds.at.municipality;
      const code = mi == null ? -1 : (ds.dict.municipality || []).indexOf(state.place);
      if (code < 0) continue;
      const cells = selection(k, true).filter((r) => ds.rows[r][mi] === code);
      if (cells.length) blocks.push(kindBlock(k, cells));
    }
    const here = view.towns.filter((t) => t.pcod === state.place);
    const town = register.towns.find((t) => t.adm3_pcod === state.place);
    const inside = regions.on ? regions.containing(state.place) : [];
    fill(
      card,
      el('div', { class: 'db-card-head' }, [
        el('span', { class: 'db-card-kind', text: props.district ? `Municipality, ${props.district}` : 'Municipality' }),
        el('button', { type: 'button', class: 'db-close', 'aria-label': 'Close the card', text: '×', onclick: closeCard }),
      ]),
      el('h3', { class: 'db-card-id', text: props.name }),
      props.name_ar ? el('p', { class: 'db-card-ar', lang: 'ar', dir: 'rtl', text: props.name_ar }) : null,
      blocks.length
        ? el('div', { class: 'db-sums' }, blocks)
        : el('p', { class: 'db-note', text: 'No record of the kinds shown names this municipality in these dates.' }),
      here.length
        ? el('div', { class: 'db-place-towns' }, [
            el('span', { class: 'db-label', text: here.length === 1 ? 'Its town' : 'Its towns' }),
            el(
              'div',
              { class: 'chips' },
              here.map((t) => el('button', { type: 'button', class: 'chip', text: t.name, onclick: () => openTown(t.key, { fly: true }) }))
            ),
          ])
        : null,
      inside.length
        ? el('div', { class: 'db-place-regions' }, [
            el('span', { class: 'db-label', text: 'Also inside a region an order named' }),
            ...inside.map((a) =>
              el('button', { type: 'button', class: 'db-place-kind db-place-region', onclick: () => openArea(a.key) }, [
                el('span', { class: 'db-sw region', 'aria-hidden': 'true' }),
                el('span', { text: ` ${a.name}` }),
                el('b', { text: `${fmt(a.count)} ${a.count === 1 ? 'order' : 'orders'}` }),
              ])
            ),
          ])
        : null,
      el('p', {
        class: 'db-note',
        text: inside.length
          ? 'Counted per kind, by week, in the dates the timeline shows. The kinds are not added together. An order to a whole region is counted on its area, and here only if it names this town too.'
          : 'Counted per kind, by week, in the dates the timeline shows. The kinds are not added together.',
      }),
      town ? el('div', { class: 'db-card-links' }, [el('a', { href: url(`pages/village.html?v=${town.id}`), ...away, text: `${town.name}: everything recorded there` })]) : null,
      contactNote()
    );
    card.hidden = false;
  }

  function flyToPlace(pcod) {
    const f = shapes.features.find((x) => x.properties.pcod === pcod);
    if (!f) return;
    const b = bbox(f.geometry);
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 80, maxZoom: 13, duration: 900 });
  }

  /* ------------------------------------------------------------- tooltip */

  function showTip(html, e) {
    if (!html || !e) {
      tip.hidden = true;
      return;
    }
    tip.innerHTML = html;
    tip.hidden = false;
    const r = mapEl.getBoundingClientRect();
    const x = e.point.x + 14;
    const y = e.point.y + 14;
    tip.style.left = `${Math.min(x, r.width - 250)}px`;
    tip.style.top = `${Math.min(y, r.height - 110)}px`;
  }

  /** A town under the pointer: each kind shown there, counted apart. */
  function townTip(key) {
    const t = view.byKey.get(key);
    if (!t) return '';
    const reg = townIndex.get(key);
    const lines = KINDS.filter((k) => state.kinds.has(k.code) && t.n[k.code]).map((k) => {
      const n = t.n[k.code];
      const lead = split(k.code, t.cells[k.code], n);
      return `${swatchHtml(k)} <b>${fmt(n)}</b> ${escape(noun(k.code, n))}${lead ? `<br><span class="muted db-tip-lead">${escape(lead)}</span>` : ''}`;
    });
    const where = t.district ? `${escape(t.district.trim())}, in these dates` : 'in these dates';
    return `<b>${escape(t.name)}</b>${reg && reg.name_ar ? ` <span class="muted">${escape(reg.name_ar)}</span>` : ''}<br><span class="muted">${where}</span><br>${lines.join('<br>')}`;
  }

  function placeTip(props, n) {
    const shade = view.shade;
    const line = shade
      ? n
        ? `${fmt(n)} ${escape(noun(shade, n))} in these dates`
        : `<span class="muted">no ${escape(noun(shade, 2))} in these dates</span>`
      : '';
    const inside = regions.on ? regions.containing(props.pcod) : [];
    const within = inside.length
      ? `<br><span class="muted">inside: ${inside.map((a) => `${escape(a.name)} (${fmt(a.count)} ${a.count === 1 ? 'order' : 'orders'})`).join(', ')}</span>`
      : '';
    return `<b>${escape(props.name)}</b>${props.name_ar ? ` <span class="muted">${escape(props.name_ar)}</span>` : ''}<br><span class="muted">${escape(props.district || '')}</span>${line ? `<br>${line}` : ''}${within}`;
  }

  function siteTip(p) {
    const g = PLACE_GROUPS[p.g];
    const name = p.n || p.a || 'Unnamed';
    return `<b>${escape(name)}</b>${p.a && p.n ? ` <span class="muted">${escape(p.a)}</span>` : ''}<br><span class="muted">${escape(String(p.k || '').replace(/_/g, ' '))}${g ? `, ${escape(g.label.toLowerCase())}` : ''}; OpenStreetMap</span>`;
  }

  function ecoTip(p) {
    return `<b>${escape(p.n)}</b>${p.a ? ` <span class="muted">${escape(p.a)}</span>` : ''}${p.l ? `<br><i class="muted">${escape(p.l)}</i>` : ''}<br><span class="muted">${p.g === 'tree' ? 'tree or shrub' : 'wildlife'}, recorded by Green Southerners in 2023 to 2024</span>`;
  }

  /** The species of the wildlife and trees layer, each with its picture and count. */
  function ecoKey() {
    if (!state.layers.eco || !eco.species.length) return null;
    return el(
      'div',
      { class: 'db-eco-species' },
      [['wildlife', 'Wildlife'], ['tree', 'Trees and shrubs']].map(([group, label]) =>
        el('div', { class: 'db-eco-group' }, [
          el('span', { class: 'db-label', text: label }),
          el(
            'div',
            { class: 'db-eco-grid' },
            eco.species
              .filter((s) => s.group === group)
              .map((s) =>
                el('span', { class: 'db-eco-item', title: [s.name, s.latin, s.name_ar].filter(Boolean).join(' · ') }, [
                  el('img', { src: new URL(s.icon, site).href, alt: '', loading: 'lazy' }),
                  el('span', { text: s.name }),
                  el('b', { text: fmt(s.n) }),
                ])
              )
          ),
        ])
      )
    );
  }

  function keepLabel() {
    const named = focusTown != null ? register.towns.find((t) => t.id === focusTown) : null;
    const others = keep.length - (named && keep.includes(named.adm3_pcod) ? 1 : 0);
    return named
      ? `Showing ${named.name} and the ${others} ${others === 1 ? 'municipality' : 'municipalities'} next to it, and nothing else.`
      : `Showing the ${keep.length} municipalities of this investigation, and nothing else.`;
  }

  function boundsOf(pcods) {
    const out = [Infinity, Infinity, -Infinity, -Infinity];
    for (const f of shapes.features) {
      if (!pcods.includes(f.properties.pcod)) continue;
      const b = bbox(f.geometry);
      out[0] = Math.min(out[0], b[0]);
      out[1] = Math.min(out[1], b[1]);
      out[2] = Math.max(out[2], b[2]);
      out[3] = Math.max(out[3], b[3]);
    }
    return Number.isFinite(out[0]) ? [[out[0], out[1]], [out[2], out[3]]] : null;
  }

  function areaTip(key) {
    const a = regions.area(key);
    if (!a) return '';
    const n = a.count;
    return `<b>${escape(a.name)}</b><br>${fmt(n)} ${n === 1 ? 'order' : 'orders'} to the whole region in these dates<br><span class="muted">drawn from the orders' words</span>`;
  }

  /* -------------------------------------------------------------- legend */

  function drawLegend() {
    const items = [];
    const points = KINDS.filter((k) => k.form === 'points' && state.kinds.has(k.code));
    for (const k of points) {
      items.push(el('div', { class: 'key' }, [swatch(k), el('span', { text: capital(noun(k.code, 2)) })]));
    }
    if (points.length) {
      items.push(el('div', { class: 'key hint' }, [el('span', { text: 'A mark per town, its area the records there in these dates:' })]));
      sizeKeyEl = el('div', { class: 'key hint size-key' });
      items.push(sizeKeyEl);
    } else sizeKeyEl = null;
    if (view.shade) {
      const ramp = typeRamp(view.shade, 6)
        .map((c) => `<span style="background:${c}"></span>`)
        .join('');
      items.push(
        el('div', { class: 'key ramp-key' }, [
          el('span', { text: `${KIND[view.shade].short} per municipality` }),
          el('div', { class: 'ramp', html: ramp }),
          el('div', { class: 'ramp-ends', html: `<span>1</span><span>${fmt(view.peaks[view.shade])}</span>` }),
        ])
      );
    }
    if (view.other) {
      items.push(el('div', { class: 'key' }, [el('span', { class: 'mark outline', style: `border-color:${typeColor(view.other)}` }), el('span', { text: `outlined: ${KIND[view.other].short.toLowerCase()}` })]));
    }
    if (state.layers.scars && state.kinds.has('BRN')) items.push(el('div', { class: 'key' }, [el('span', { class: 'mark area', style: `background:${typeColor('BRN')}66` }), el('span', { text: 'burned ground, by month' })]));
    if (state.layers.studio) items.push(el('div', { class: 'key wide' }, [el('span', { class: 'mark area', style: 'background:#c81e3a' }), el('span', { text: 'damage mapped in the Studio (zoom in)' })]));
    if (regions.on && regions.count) {
      items.push(el('div', { class: 'key wide' }, [el('span', { class: 'mark area region' }), el('span', { text: 'an order to a whole region, drawn from its words' })]));
    }
    if (state.layers.zones) items.push(el('div', { class: 'key' }, [el('span', { class: 'mark dash' }), el('span', { text: 'the yellow-line zone' })]));
    if (state.layers.eco) {
      items.push(
        el('div', { class: 'key wide' }, [
          el('img', { class: 'mark-img', src: new URL('assets/eco/red-fox.png', site).href, alt: '' }),
          el('img', { class: 'mark-img', src: new URL('assets/eco/palestine-oak.png', site).href, alt: '' }),
          el('span', { text: 'Wildlife and trees, recorded 2023 to 2024: each its species, listed under Map layers' }),
        ])
      );
    }
    if (state.layers.sites) {
      for (const x of Object.values(PLACE_GROUPS)) items.push(el('div', { class: 'key wide' }, [el('span', { class: `mark shape ${x.shape}`, style: `--c:${x.color}` }), el('span', { text: x.label })]));
    }
    if (state.layers.water) items.push(el('div', { class: 'key' }, [el('span', { class: 'mark line' }), el('span', { text: 'water' })]));
    if (state.layers.cover) {
      items.push(
        el('div', { class: 'key cover-key' }, [
          el('span', { text: 'Land cover, 2025' }),
          el('div', { class: 'cover-classes' }, COVER_CLASSES.map((c) => el('span', {}, [el('i', { style: `background:${c.color}` }), c.label]))),
        ])
      );
    }
    if (state.layers.river) items.push(el('div', { class: 'key' }, [el('span', { class: 'mark line' }), el('span', { text: 'the Litani River' })]));
    const box = el('details', { class: 'db-legend-box', open: legendOpen }, [el('summary', { text: 'Legend' }), ...items]);
    box.addEventListener('toggle', () => (legendOpen = box.open));
    fill(legendEl, box);
    drawSizeKey();
  }

  /** Marks of 1, 5 and 20 records, at the size the map draws them now. */
  function drawSizeKey() {
    if (!sizeKeyEl) return;
    const z = map.getZoom();
    const radii = SIZE_KEY.map((n) => markRadius(z, n));
    const h = Math.ceil(2 * Math.max(...radii)) + 2;
    let x = 1;
    const parts = [];
    SIZE_KEY.forEach((n, i) => {
      const r = radii[i];
      parts.push(`<circle cx="${(x + r).toFixed(1)}" cy="${(h / 2).toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="currentColor" stroke-width="1.2"/>`);
      x += 2 * r + 4;
      parts.push(`<text x="${x.toFixed(1)}" y="${(h / 2 + 3.5).toFixed(1)}" font-size="10.5" fill="currentColor">${n}</text>`);
      x += String(n).length * 6.5 + 9;
    });
    sizeKeyEl.innerHTML = `<svg width="${Math.ceil(x)}" height="${h}" viewBox="0 0 ${Math.ceil(x)} ${h}" aria-hidden="true">${parts.join('')}</svg><span>records</span>`;
    sizeKeyEl.setAttribute('aria-label', `A mark's area grows with the records at the town: shown here for ${SIZE_KEY.join(', ')} records`);
  }

  /* -------------------------------------------------------------- banner */

  function drawBanner() {
    const before = KINDS.filter((k) => state.kinds.has(k.code) && toDay(state.to) < sets[k.code].minDay + toDay(sets[k.code].epoch));
    if (!before.length) {
      bannerEl.hidden = true;
      return;
    }
    bannerEl.hidden = false;
    bannerEl.textContent = `Not yet collected in these dates: ${before
      .map((k) => `${k.short.toLowerCase()} (from ${dateLabel(fromDay(sets[k.code].minDay + toDay(sets[k.code].epoch)))})`)
      .join(', ')}. Before a collection begins the corpus has not looked, which is not the same as nothing having happened.`;
  }

  /* ---------------------------------------------------------------- url */

  function sync() {
    const q = new URLSearchParams();
    if (embed) q.set('embed', '1');
    const kinds = [...state.kinds].sort().join(',');
    if (kinds !== [...DEFAULT_KINDS].sort().join(',')) q.set('types', [...state.kinds].join(','));
    if (state.shade) q.set('shade', state.shade);
    const flt = serialiseFilters(state.filters);
    if (flt) q.set('flt', flt);
    if (state.loc.length) q.set('loc', state.loc.join(','));
    if (state.district) q.set('district', state.district);
    if (state.q) q.set('q', state.q);
    if (state.from !== start) q.set('from', state.from);
    if (state.to !== end) q.set('to', state.to);
    if (state.base !== 'light') q.set('base', state.base);
    if (state.terrain) q.set('terrain', '1');
    for (const [key, on] of Object.entries(state.layers)) {
      const dflt = key === 'scars' || key === 'lines' || key === 'regions';
      if (on !== dflt) q.set(key, on ? '1' : '0');
    }
    if (query.focus) q.set('focus', query.focus);
    if (state.panel !== 'records') q.set('panel', state.panel);
    if (state.town) q.set('town', state.town);
    if (state.place) q.set('place', state.place);
    if (state.area) q.set('area', state.area);
    if (keep.length) q.set('places', keep.join(','));
    history.replaceState(null, '', `${location.pathname}${q.toString() ? `?${q}` : ''}`);
  }

  /* --------------------------------------------------------------- start */

  const strips = strip(stripHost, {
    start,
    end,
    periods: metaPayload.periods || [],
    label: 'Timeline of the records, counted by week: drag to choose the dates the map shows',
    onChange: ({ from, to }) => {
      state.from = from;
      state.to = to;
      refresh();
    },
  });
  strips.setRange(state.from, state.to, { quiet: true });

  drawPlace();
  drawFilters();
  drawLayersTab();
  setPanel(state.panel);
  refresh();

  if (state.town) {
    openTown(state.town, { fly: !viewCamera(query.view) });
  } else if (state.place) {
    openPlace(state.place);
    if (!viewCamera(query.view)) flyToPlace(state.place);
  } else if (query.area && regions.area(query.area)) {
    openArea(query.area, { fly: !viewCamera(query.view) });
  }
  if (query.play === '1') {
    if (query.mode && /^\d+$/.test(query.mode)) strips.setMode('window', Number(query.mode));
    setTimeout(() => strips.play(), 700);
  }
  window.addEventListener('resize', () => fitToViewport(root, embed));
}

/* ---------------------------------------------------------------- helpers */

function swatch(k) {
  const c = typeColor(k.code);
  if (k.code === 'WPB') return el('span', { class: 'db-sw diamond', style: `background:${c}`, 'aria-hidden': 'true' });
  if (k.form === 'towns') return el('span', { class: 'db-sw square', style: `background:${c}`, 'aria-hidden': 'true' });
  return el('span', { class: 'db-sw', style: `background:${c}`, 'aria-hidden': 'true' });
}

function swatchHtml(k) {
  const shape = k.code === 'WPB' ? ' diamond' : k.form === 'towns' ? ' square' : '';
  return `<span class="db-sw${shape}" style="background:${typeColor(k.code)}" aria-hidden="true"></span>`;
}

/** "fire" or "fires", as many as `n`. */
function noun(code, n) {
  const words = NOUN[code];
  if (words) return n === 1 ? words[0] : words[1];
  const k = KIND[code];
  return k ? (n === 1 ? k.long : k.short).toLowerCase() : 'records';
}

function capital(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** A day number back to the Monday of its week (day 0, 1 January 1970, was a Thursday). */
function monday(day) {
  return day - ((((day + 3) % 7) + 7) % 7);
}

/**
 * Records per week over some cells, for the timeline's lane: each cell is a
 * week (or the part of one in a new month), weighted by the records it holds.
 */
function weekBins(ds, rows, epoch) {
  const di = ds.at.d;
  const bins = new Map();
  for (const r of rows) {
    const d = ds.rows[r][di];
    if (d == null) continue;
    const w = monday(d + epoch);
    bins.set(w, (bins.get(w) || 0) + ds.weight(r));
  }
  return [...bins.entries()].sort((a, b) => a[0] - b[0]);
}

/** A name as a search compares it: no case, no accents or vowel marks, no spaces or hyphens. */
function fold(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, '')
    .replace(/\u0671/g, '\u0627')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u0649/g, '\u064a')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function bbox(geometry) {
  const out = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      out[0] = Math.min(out[0], c[0]);
      out[1] = Math.min(out[1], c[1]);
      out[2] = Math.max(out[2], c[0]);
      out[3] = Math.max(out[3], c[1]);
    } else c.forEach(walk);
  };
  walk(geometry.coordinates);
  return out;
}

/** `BRN.fire_cause_id=White phosphorus (WP)~Incendiary munition;WPB.geolocated=geolocated` */
function parseFilters(text) {
  const out = {};
  if (!text) return out;
  for (const part of text.split(';')) {
    const [left, right] = part.split('=');
    if (!left || right == null) continue;
    const [code, key] = left.split('.');
    if (!KIND[code] || !key) continue;
    (out[code] = out[code] || {})[key] = right.split('~').filter(Boolean);
  }
  return out;
}

function serialiseFilters(filters) {
  const parts = [];
  for (const [code, dims] of Object.entries(filters)) {
    for (const [key, values] of Object.entries(dims)) if (values && values.length) parts.push(`${code}.${key}=${values.join('~')}`);
  }
  return parts.join(';');
}

/** `view=lng,lat,zoom[,pitch,bearing]` as a camera. */
function viewCamera(text) {
  if (!text) return null;
  const v = text.split(',').map(Number);
  if (v.length < 3 || v.some((n) => Number.isNaN(n))) return null;
  return { center: [v[0], v[1]], zoom: v[2], pitch: v[3] || 0, bearing: v[4] || 0 };
}

function fitToViewport(root, embed) {
  const head = document.querySelector('.site-head');
  const top = embed || !head ? 0 : head.getBoundingClientRect().height;
  root.style.setProperty('--db-top', `${Math.round(top)}px`);
}
