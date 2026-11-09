/* An investigation, told step by step on the map.
 *
 * The form Forensic Architecture calls "analysis": a map that fills the frame
 * and a card beside it that walks the reader through a place, one step at a
 * time. Each step moves the camera, chooses the kinds of record and the dates
 * the map shows, and switches the ground layers on and off; the reader can
 * step back and forth, or leave the story for the database at the same view.
 *
 * The story itself is data: `data/stories/<slug>.json`, written by
 * `tools/publish/build_stories.py` in the corpus repository from the same
 * export as everything else, so every figure in it is the corpus's own and a
 * refresh of the data refreshes the story. This file only draws it.
 *
 * The site's rules hold in every step. It publishes statistics, never records
 * (the data owner, 2026-11-06): each kind of record is drawn as one mark per
 * town, at the town's own point, its area growing with the records counted
 * there, in the kind's own colour and never added to another kind; white
 * phosphorus is a diamond, fires a circle, the same marks the database draws
 * (`marksLayer`). Displacement orders shade the municipality they name.
 * Burned ground is merged by month and follows the step's dates only.
 *
 * The kinds are the database's own (`KINDS` in gl-layers.js, where a hidden
 * kind is listed with how to show it again). A kind a step names that is not
 * there, or whose figures did not load, is left out of the map.
 */

import { dataset, dateLabel, DATA, geo, isoToDay, load } from './data.js';
import { add, glMap, layer } from './gl.js';
import {
  KIND,
  KINDS,
  landmarksLayer,
  marksLayer,
  riverLayer,
  scarsLayer,
  STUDIO_STYLE,
  studioLayer,
  townsLayer,
  zonesLayer,
} from './gl-layers.js';
import { typeColor, typeRamp } from './theme.js';
import { countLabel, el, fill, params, url } from './ui.js';

/** A kind about a whole town shades it; every other kind is a mark per town. */
const shaded = (k) => k.form === 'towns';

/** Changes seen before the 2026 war: off unless a step asks for them. */
const PRIOR = ['building_prior', 'road_prior', 'airstrike_crater_prior'];

/** The first day of an ISO day's month: burned ground is held by month. */
const monthStart = (iso) => `${iso.slice(0, 7)}-01`;

export async function storyPage({ embed = false, slug = null } = {}) {
  const root = document.getElementById('story');
  const query = params();
  const name = slug || query.story;
  const away = embed ? { target: '_blank', rel: 'noopener' } : {};
  root.replaceChildren(el('p', { class: 'st-loading', text: 'Loading the investigation…' }));

  const empty = { type: 'FeatureCollection', features: [] };
  const [story, shapes, scarsData, zonesData, river, landmarks, studioIndex] = await Promise.all([
    load(`stories/${name}.json`),
    geo('municipalities'),
    // Burned ground, one feature per month: a story still reads without it.
    geo('burned').catch(() => empty),
    geo('zones').catch(() => empty),
    geo('litani').catch(() => empty),
    geo('landmarks').catch(() => empty),
    load('studio/index.json').catch(() => ({ labels: [], towns: [] })),
  ]);
  const sets = {};
  await Promise.all(
    KINDS.map(async (k) => {
      try {
        sets[k.code] = await dataset(k.slug);
      } catch (err) {
        console.warn(`${k.code} did not load`, err);
      }
    })
  );

  const start = Math.max(0, Math.min(story.steps.length - 1, Number(query.step || 1) - 1));
  let at = start;
  // A step chosen before the map is ready only moves the card; the map follows
  // once it has loaded.
  let mapReady = false;

  /* ---------------------------------------------------------------- frame */

  const app = el('div', { class: `st${embed ? ' st-embed' : ''}` });
  const cardEl = el('article', { class: 'st-card', 'aria-live': 'polite' });
  const mapEl = el('div', { class: 'st-map', role: 'region', 'aria-label': `Map: ${story.title}` });
  const legendEl = el('div', { class: 'st-legend' });
  const dateEl = el('div', { class: 'st-date' });
  root.replaceChildren(fill(app, cardEl, el('div', { class: 'st-stage' }, [mapEl, legendEl, dateEl])));

  // The text first: it is what the reader came for, and the map's tiles can
  // take a few seconds on a slow connection.
  drawCard();

  const first = story.steps[start];
  const handle = await glMap(mapEl, {
    camera: first.camera,
    base: first.base || 'light',
    terrain: Boolean(first.terrain),
    cooperative: embed,
  });
  const { map } = handle;
  if (new URLSearchParams(location.search).has('debug')) window.__st = { handle, story };

  const towns = townsLayer(handle, shapes);
  const scars = scarsLayer(handle, scarsData);
  const zones = zonesLayer(handle, zonesData);
  const studio = studioLayer(handle, studioIndex, { base: DATA });
  towns.outlines();
  const litani = riverLayer(handle, river);
  // A hover names the town and its counts, each kind apart.
  let shown = [];
  const tip = handle.gl && handle.gl.Popup
    ? new handle.gl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: 'st-tip' })
    : null;
  const marks = marksLayer(handle, {
    onHover: (props, e) => {
      if (!tip) return;
      if (!props) {
        tip.remove();
        return;
      }
      const here = shown.filter((f) => f.properties.k === props.k);
      const lines = here.map((f) => escape(f.properties.text));
      tip.setLngLat(here.length ? here[0].geometry.coordinates : e.lngLat)
        .setHTML(`<b>${escape(props.name || '')}</b>: ${lines.join(', ')}`)
        .addTo(map);
    },
  });
  const castle = landmarksLayer(handle, landmarks);

  // A region a step draws round its subject: a circle round a point, or the
  // river's corridor, as a dashed outline that names what it holds.
  const region = { type: 'FeatureCollection', features: [] };
  handle.overlay((m) => {
    add(m, 'st-region', { type: 'geojson', data: region });
    layer(m, {
      id: 'st-region',
      type: 'line',
      source: 'st-region',
      paint: { 'line-color': '#2b2a28', 'line-width': 1.4, 'line-dasharray': [3, 2], 'line-opacity': 0.75 },
    });
  });
  // Areas a story publishes with itself (story.areas, by key: a label, a colour
  // and features), filled and outlined in their colour; a step names the ones
  // it shows in layers.areas.
  const areaData = { type: 'FeatureCollection', features: [] };
  handle.overlay((m) => {
    add(m, 'st-areas', { type: 'geojson', data: areaData });
    layer(m, {
      id: 'st-areas-fill',
      type: 'fill',
      source: 'st-areas',
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.32 },
    });
    layer(m, {
      id: 'st-areas-line',
      type: 'line',
      source: 'st-areas',
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.8 },
    });
  });
  const areaKeys = (step) => ((step.layers || {}).areas || []).filter((k) => story.areas && story.areas[k]);
  await handle.ready;
  // The municipalities the investigation is about: records outside them are
  // left out and the rest of the map fades.
  const own = story.pcods && story.pcods.length ? new Set(story.pcods) : null;
  towns.keep(story.pcods || null);

  /* ---------------------------------------------------------------- steps */

  function apply(step, { fly = true } = {}) {
    const kinds = new Set((step.kinds || []).filter((c) => KIND[c] && sets[c]));
    const from = step.from || null;
    const to = step.to || null;
    const where = step.towns ? new Set(step.towns) : null;

    const features = [];
    const perPcod = {};
    const peaks = {};
    for (const k of KINDS) {
      if (!kinds.has(k.code)) continue;
      const ds = sets[k.code];
      const range = {};
      if (from) range.from = isoToDay(ds.epoch, from);
      if (to) range.to = isoToDay(ds.epoch, to);
      // The cells of this kind on the investigation's own ground and the
      // step's places, in the step's dates.
      const rows = ds.select(range).filter((r) => {
        if (own && !own.has(ds.value(r, 'municipality'))) return false;
        if (where && !where.has(ds.display(r, 'town'))) return false;
        return true;
      });

      if (!shaded(k)) {
        for (const t of ds.towns(rows)) {
          if (t.lat == null || t.lon == null || !t.n) continue;
          features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [t.lon, t.lat] },
            properties: {
              t: k.code,
              n: t.n,
              k: `${t.name}|${t.district || ''}`,
              name: t.name,
              text: countLabel(k.code, t.n),
            },
          });
        }
      } else {
        const counts = {};
        for (const r of rows) {
          const pcod = ds.value(r, 'municipality');
          if (pcod) counts[pcod] = (counts[pcod] || 0) + ds.weight(r);
        }
        perPcod[k.code] = counts;
        // Shaded against the kind's busiest municipality on any day, so a
        // step's dates move the shading and never its scale.
        const whole = {};
        for (const r of ds.all) {
          const pcod = ds.value(r, 'municipality');
          if (pcod) whole[pcod] = (whole[pcod] || 0) + ds.weight(r);
        }
        peaks[k.code] = Math.max(1, ...Object.values(whole));
      }
    }
    const townKinds = KINDS.filter((k) => shaded(k) && kinds.has(k.code)).map((k) => k.code);
    const shade = step.shade && townKinds.includes(step.shade) ? step.shade : townKinds[0] || null;
    if (shade) towns.shade(shade, perPcod[shade] || {}, peaks[shade]);
    else towns.shade(null, {}, 1);
    const other = townKinds.find((c) => c !== shade) || null;
    towns.mark(other, other ? Object.keys(perPcod[other] || {}) : []);
    towns.select(step.place || null);
    shown = features;
    marks.set(features);
    if (tip) tip.remove();

    const layers = step.layers || {};
    scars.show(Boolean(layers.scars) && kinds.has('BRN'));
    // A month is shown when any of its days is in the step's dates.
    scars.window(from ? monthStart(from) : null, to);
    zones.show(Boolean(layers.zones));
    zones.at(to);
    studio.show(Boolean(layers.studio));
    studio.until(to);
    if (layers.studio && step.studio) studio.load(step.studio);
    // What the Studio shows: everything but the pre-war layers, unless the step
    // says otherwise ("all" hides every change and leaves the counting area).
    const hidden = layers.studioHide === 'all' ? new Set(studio.keys) : new Set(layers.studioHide || PRIOR);
    for (const key of studio.keys) if (key !== 'counting_area') studio.hide(key, hidden.has(key));
    litani.show(Boolean(layers.river));
    castle.show(Boolean(layers.castle));
    towns.lines(layers.lines !== false);

    region.features = step.region ? regionFeatures(step.region) : [];
    if (map.getSource('st-region')) map.getSource('st-region').setData(region);
    areaData.features = areaKeys(step).flatMap((k) =>
      (story.areas[k].features || []).map((f) => ({ ...f, properties: { ...(f.properties || {}), color: story.areas[k].color || '#c98a00' } }))
    );
    if (map.getSource('st-areas')) map.getSource('st-areas').setData(areaData);

    if (step.base && step.base !== handle.base) handle.setBase(step.base);
    if (Boolean(step.terrain) !== handle.terrain) handle.setTerrain(Boolean(step.terrain));
    if (fly && step.camera) {
      map.flyTo({
        center: step.camera.center,
        zoom: step.camera.zoom,
        pitch: step.camera.pitch || 0,
        bearing: step.camera.bearing || 0,
        duration: step.camera.duration || 2600,
        essential: true,
      });
    }
    drawLegend(step, kinds, shade, other, hidden);
    dateEl.textContent = from || to ? `Records ${from ? `from ${dateLabel(from)}` : ''}${to ? ` to ${dateLabel(to)}` : ''}` : 'All dates';
  }

  map.on('style.load', () => setTimeout(() => apply(story.steps[at], { fly: false }), 0));

  function go(i) {
    at = Math.max(0, Math.min(story.steps.length - 1, i));
    drawCard();
    if (mapReady) apply(story.steps[at]);
    const q = new URLSearchParams(location.search);
    q.set('step', String(at + 1));
    history.replaceState(null, '', `${location.pathname}?${q}`);
  }

  /* ---------------------------------------------------------------- card */

  function drawCard() {
    const step = story.steps[at];
    const dots = el(
      'div',
      { class: 'st-dots', role: 'tablist', 'aria-label': 'Steps' },
      story.steps.map((s, i) =>
        el('button', {
          type: 'button',
          class: `st-dot${i === at ? ' on' : ''}`,
          'aria-label': `Step ${i + 1}: ${s.title}`,
          'aria-selected': i === at ? 'true' : 'false',
          onclick: () => go(i),
        })
      )
    );
    const figures = (step.figures || []).map((f) =>
      el('div', { class: 'st-figure' }, [
        f.kind ? el('span', { class: `st-sw${f.kind === 'WPB' ? ' diamond' : ''}`, style: `background:${typeColor(f.kind)}` }) : null,
        el('b', { text: f.value }),
        el('span', { text: f.label }),
      ])
    );
    const explore = step.explore || story.explore;
    fill(
      cardEl,
      el('header', { class: 'st-head' }, [
        el('span', { class: 'st-eyebrow', text: 'Investigation · The 2026 war' }),
        el('h1', { text: story.title }),
        story.title_ar ? el('p', { class: 'st-ar', lang: 'ar', dir: 'rtl', text: story.title_ar }) : null,
      ]),
      el('div', { class: 'st-step' }, [
        el('span', { class: 'st-count', text: `Step ${at + 1} of ${story.steps.length}` }),
        el('h2', { text: step.title }),
        ...(step.text || []).map((p) => el('p', { text: p })),
        figures.length ? el('div', { class: 'st-figures' }, figures) : null,
        step.note ? el('p', { class: 'st-note', text: step.note }) : null,
      ]),
      el('footer', { class: 'st-foot' }, [
        dots,
        el('div', { class: 'st-nav' }, [
          el('button', { type: 'button', class: 'btn', text: 'Back', disabled: at === 0, onclick: () => go(at - 1) }),
          el('button', {
            type: 'button',
            class: 'btn primary',
            text: at === story.steps.length - 1 ? 'Start again' : 'Next',
            onclick: () => go(at === story.steps.length - 1 ? 0 : at + 1),
          }),
        ]),
        explore ? el('a', { class: 'st-explore', href: url(explore), ...away, text: 'Explore this place in the database' }) : null,
      ])
    );
  }

  /* -------------------------------------------------------------- legend */

  /** The Studio keys a step's legend lists: the step's own list, or else what
   * the map shows of the towns it loads. */
  function studioKeys(step, hidden) {
    const known = new Set(studioIndex.labels.map((l) => l.key));
    if (Array.isArray(step.studioKeys)) return step.studioKeys.filter((k) => known.has(k) && STUDIO_STYLE[k]);
    const held = new Set();
    for (const t of studioIndex.towns || []) {
      if (!(step.studio || []).includes(t.id)) continue;
      for (const [key, n] of Object.entries(t.layers || {})) if (n > 0) held.add(key);
    }
    return studio.keys.filter((k) => k !== 'counting_area' && !hidden.has(k) && held.has(k) && STUDIO_STYLE[k]);
  }

  function drawLegend(step, kinds, shade, other, hidden) {
    const items = [];
    const marked = KINDS.filter((k) => kinds.has(k.code) && !shaded(k));
    for (const k of marked) {
      items.push(
        el('div', { class: 'key' }, [
          el('span', { class: `st-sw${k.shape === 'diamond' ? ' diamond' : ''}`, style: `background:${typeColor(k.code)}` }),
          el('span', { text: `${k.short}, per town` }),
        ])
      );
    }
    if (marked.length) {
      items.push(el('div', { class: 'key note', text: 'One mark per town, at its own point: the larger, the more records' }));
    }
    if (shade) {
      const ramp = typeRamp(shade, 6)
        .map((c) => `<span style="background:${c}"></span>`)
        .join('');
      items.push(el('div', { class: 'key ramp-key' }, [el('span', { text: `${KIND[shade].short} per municipality` }), el('div', { class: 'ramp', html: ramp })]));
    }
    if (other) items.push(el('div', { class: 'key' }, [el('span', { class: 'mark outline', style: `border-color:${typeColor(other)}` }), el('span', { text: `outlined: ${KIND[other].short.toLowerCase()}` })]));
    const layers = step.layers || {};
    if (layers.scars && kinds.has('BRN')) items.push(el('div', { class: 'key' }, [el('span', { class: 'mark area', style: `background:${typeColor('BRN')}66` }), el('span', { text: 'burned ground, by month' })]));
    if (layers.studio) {
      for (const key of studioKeys(step, hidden)) {
        const label = studioIndex.labels.find((l) => l.key === key);
        items.push(el('div', { class: 'key' }, [el('span', { class: 'mark area', style: `background:${STUDIO_STYLE[key].color}` }), el('span', { text: label ? label.title : key })]));
      }
    }
    for (const k of areaKeys(step)) {
      const a = story.areas[k];
      const c = a.color || '#c98a00';
      items.push(el('div', { class: 'key' }, [el('span', { class: 'mark area', style: `background:${c}55;box-shadow:inset 0 0 0 1.5px ${c}` }), el('span', { text: a.label || k })]));
    }
    if (layers.river) items.push(el('div', { class: 'key' }, [el('span', { class: 'mark line' }), el('span', { text: 'the Litani River' })]));
    if (step.region) items.push(el('div', { class: 'key' }, [el('span', { class: 'mark dash' }), el('span', { text: step.region.label || 'the area counted' })]));
    fill(legendEl, items.length ? el('details', { class: 'st-legend-box', open: window.innerWidth > 700 }, [el('summary', { text: 'Legend' }), ...items]) : null);
  }

  document.addEventListener('keydown', (e) => {
    if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') go(at + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(at - 1);
  });

  mapReady = true;
  drawCard();
  apply(story.steps[at], { fly: at === start ? false : true });
}

/** Text for a tooltip's HTML, escaped. */
function escape(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/** A circle (centre, radius in metres) or a ready polygon, as an outline. */
function regionFeatures(region) {
  if (region.polygon) return [{ type: 'Feature', properties: {}, geometry: region.polygon }];
  if (!region.center || !region.radius_m) return [];
  const [lon, lat] = region.center;
  const ring = [];
  for (let i = 0; i <= 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    const dy = (region.radius_m * Math.sin(a)) / 111320;
    const dx = (region.radius_m * Math.cos(a)) / (111320 * Math.cos((lat * Math.PI) / 180));
    ring.push([lon + dx, lat + dy]);
  }
  return [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }];
}
