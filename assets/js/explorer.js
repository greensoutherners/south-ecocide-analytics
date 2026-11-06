/* The map explorer: every kind of record counted by town, and the layers
 * behind them.
 *
 * One map of Lebanon, bounded to Lebanon, with the record types as switchable
 * layers and the ground layers (village territories, burned ground, presence
 * zones) underneath. Layers load only when they are switched on, because the
 * ground layers are most of this site's weight and most readers never ask for
 * them.
 *
 * The site publishes statistics, never records (the data owner, 2026-11-06):
 * each kind is drawn as one circle per town, at the town's own point, its area
 * growing with the records that name the town. Displacement orders are records
 * about a town, so the municipality they name is shaded instead, the way the
 * platform draws them. Each kind keeps its fixed colour, and nothing is added
 * across kinds.
 */

import { dataset, fmt, geo, isoToDay, meta, summary } from './data.js';
import {
  adminLayer,
  autoScale,
  burnedLayer,
  countryLayer,
  LEBANON,
  lebanonMap,
  legend,
  SOUTH,
  TOWN_KINDS,
  townLayer,
  villageLayer,
  zoneLayer,
} from './maps.js';
import { palette, typeColor, typeRamp } from './theme.js';
import {
  chrome,
  contactNote,
  countLabel,
  el,
  failure,
  fill,
  listParam,
  loading,
  noteList,
  params,
  select,
  stat,
  syncURL,
} from './ui.js';

export async function explorerPage() {
  const mount = document.getElementById('page');
  mount.append(loading());

  try {
    const [metaPayload, summaryPayload] = await Promise.all([meta(), summary()]);
    await chrome('map', Promise.resolve(metaPayload));
    const types = summaryPayload.types.filter((t) => t.total > 0);
    const sets = await Promise.all(types.map((t) => dataset(t.slug)));
    render(mount, { types, sets });
  } catch (err) {
    fill(mount, failure(err));
  }
}

function render(mount, { types, sets }) {
  const query = params();
  const p = palette();

  const state = {
    types: listParam(query.types).filter((c) => types.some((t) => t.code === c)),
    ground: listParam(query.ground),
    basemap: query.basemap || 'none',
    from: query.from || '',
    to: query.to || '',
  };
  if (!state.types.length && !listParam(query.types).length) state.types = types.map((t) => t.code);

  const mapEl = el('div', { class: 'map tall' });
  const typeChips = el('div', { class: 'chips' });
  const groundChips = el('div', { class: 'chips' });
  const statRow = el('div', { class: 'grid cols-4', style: 'margin:16px 0' });
  const controls = el('div', { class: 'controls' });

  mount.replaceChildren(
    el('div', {}, [
      el('h1', { text: 'Map' }),
      el('p', {
        class: 'lede',
        text:
          'Every kind of record the corpus holds, counted by town on one map of Lebanon. ' +
          'Switch the kinds on and off, and put the ground layers underneath. Each circle is a ' +
          'town at its own point, its area growing with the records that name it; displacement ' +
          'orders shade the municipality they name. The map holds no single record.',
      }),
    ]),
    el('div', { class: 'card', style: 'margin:16px 0' }, [
      el('label', {
        style: 'font-size:.76rem;color:var(--ink-2);font-weight:560;display:block;margin-bottom:6px',
        text: 'Record types',
      }),
      typeChips,
      el('label', {
        style: 'font-size:.76rem;color:var(--ink-2);font-weight:560;display:block;margin:14px 0 6px',
        text: 'Ground layers',
      }),
      groundChips,
      controls,
    ]),
    statRow,
    el('div', { class: 'card' }, [mapEl]),
    el('div', { class: 'section' }, [
      noteList([
        'A circle is a town, not an event. It sits at the town’s own point and counts the ' +
          'records that name the town in the period chosen; its area grows with the count, ' +
          'so a town twice the area holds twice the records.',
        'Displacement orders name a town, not a spot in it, so the municipality they name is ' +
          'shaded, darker with more orders. A municipality with none is left unshaded, which ' +
          'is not a finding that nothing happened there.',
        'Village territories are Voronoi cells of locality points, drawn dashed because ' +
          'they are not cadastral or administrative boundaries and no line on that layer ' +
          'should be read as one.',
        'Presence zones are a place, not a finding. A town falling inside one is a spatial ' +
          'fact about where it is, not a statement about what happened there.',
        'Burned ground is measured on Sentinel-2 passes either side of a fire and merged by ' +
          'the month the fires began, so it follows the dates chosen. It says the ground ' +
          'burned, not what lit it.',
      ]),
      contactNote(),
    ])
  );

  /* ------------------------------------------------------------- map */

  const map = lebanonMap(mapEl, { bounds: SOUTH, basemap: state.basemap });
  const typeLayers = new Map();
  const groundLayers = new Map();
  let typeLegend = null;
  let townLayerShaded = null;

  /* The country outline and the municipality set are generalised differently,
   * so drawing both gives the map two coastlines a few hundred metres apart.
   * When the reader switches municipalities on, they become the land. */
  const base = [];
  Promise.all([geo('lebanon'), geo('districts')])
    .then(([lebanon, districts]) => {
      base.push(countryLayer(lebanon).addTo(map), adminLayer(districts).addTo(map));
      syncBase();
    })
    .catch((err) => console.warn('boundaries', err));

  function syncBase() {
    const hide = state.ground.includes('municipalities');
    for (const layer of base) {
      if (hide) map.removeLayer(layer);
      else if (!map.hasLayer(layer)) layer.addTo(map);
    }
    order();
  }

  /* Back to front: the land, the shaded towns, the ground layers, the district
   * lines, then the town circles. Each layer arrives whenever its file does,
   * so the order is set again after every arrival rather than trusted to the
   * order they were asked for: a layer sent to the back on its own would land
   * under the opaque land and vanish. */
  function order() {
    const [country, admin] = base;
    if (admin && map.hasLayer(admin)) admin.bringToBack();
    for (const [key, layer] of groundLayers) {
      if (layer && key !== 'municipalities' && map.hasLayer(layer)) layer.bringToBack();
    }
    if (townLayerShaded && map.hasLayer(townLayerShaded)) townLayerShaded.bringToBack();
    const land = groundLayers.get('municipalities') || (country && map.hasLayer(country) ? country : null);
    if (land && map.hasLayer(land)) land.bringToBack();
  }

  const GROUND = {
    municipalities: {
      label: 'Municipalities',
      note: 'official boundaries (OCHA COD), drawn as the land',
      load: () =>
        geo('municipalities').then((g) =>
          window.L.geoJSON(g, {
            style: {
              color: p.map.stroke,
              weight: 0.5,
              fill: true,
              fillColor: p.map.land,
              fillOpacity: 1,
            },
            onEachFeature: (f, lyr) =>
              lyr.bindTooltip(
                `<b>${f.properties.name}</b>` +
                  (f.properties.name_ar ? ` <span style="opacity:.6">${f.properties.name_ar}</span>` : '') +
                  (f.properties.district ? `<br><span style="opacity:.6">${f.properties.district}</span>` : ''),
                { sticky: true }
              ),
          })
        ),
    },
    villages: {
      label: 'Fire search territories',
      note: 'the corpus’s own approximate cells, not boundaries',
      load: () => geo('villages').then((g) => villageLayer(g)),
    },
    scars: {
      label: 'Burned ground',
      note: 'measured ground, by the month the fires began',
      // Burned ground follows the dates chosen, by month.
      load: () => geo('burned').then((g) => burnedLayer(g, { from: state.from || null, to: state.to || null })),
      dated: true,
    },
    zones: {
      label: 'Presence zones',
      note: 'a place, not a finding',
      load: () => geo('zones').then((g) => zoneLayer(g)),
    },
    // No Key Biodiversity Area layer: the KBA Partnership's licence restricts
    // redistributing the outlines, so the site publishes how many fires fall
    // inside one (a column on the fires) and not the outlines themselves.
  };

  /* ------------------------------------------------------------- chips */

  /* What a chip counts: the records of that kind the map can show, all dates.
   * A circle kind shows the records whose town has a point; a town kind the
   * records that name a municipality, which is what it is shaded by. */
  const shown = types.map((t, i) => {
    const ds = sets[i];
    if (TOWN_KINDS.has(t.code)) {
      return ds.group(ds.all, 'municipality').reduce((s, g) => s + (g.none ? 0 : g.n), 0);
    }
    return ds.towns(ds.all).reduce((s, x) => s + (x.lat != null ? x.n : 0), 0);
  });

  function drawTypeChips() {
    fill(
      typeChips,
      ...types.map((t, i) =>
        el('button', {
          class: 'chip',
          type: 'button',
          'aria-pressed': state.types.includes(t.code) ? 'true' : 'false',
          onclick: () => {
            const n = state.types.indexOf(t.code);
            if (n >= 0) state.types.splice(n, 1);
            else state.types.push(t.code);
            drawTypeChips();
            draw();
          },
        }, [
          el('span', { class: 'swatch', style: `background:${typeColor(t.code)}` }),
          `${t.label} `,
          el('span', { style: 'opacity:.6', text: fmt(shown[i]) }),
        ])
      )
    );
  }

  function drawGroundChips() {
    fill(
      groundChips,
      ...Object.entries(GROUND).map(([key, spec]) =>
        el('button', {
          class: 'chip',
          type: 'button',
          title: spec.note,
          'aria-pressed': state.ground.includes(key) ? 'true' : 'false',
          onclick: () => {
            const n = state.ground.indexOf(key);
            if (n >= 0) state.ground.splice(n, 1);
            else state.ground.push(key);
            drawGroundChips();
            drawGround();
            syncBase();
          },
        }, [spec.label])
      )
    );
  }

  /* A new period redraws the counts, and the ground layers that follow the
   * dates are loaded again for it. */
  function onDates() {
    draw();
    for (const [key, spec] of Object.entries(GROUND)) {
      if (!spec.dated || !groundLayers.has(key)) continue;
      const layer = groundLayers.get(key);
      if (layer) map.removeLayer(layer);
      groundLayers.delete(key);
    }
    drawGround();
  }

  fill(
    controls,
    select(
      'Base map',
      [
        { value: 'none', label: 'None (outlines only)' },
        { value: 'auto', label: 'Street, following the theme' },
        { value: 'satellite', label: 'Satellite' },
      ],
      state.basemap,
      (v) => {
        state.basemap = v;
        map.setBasemap(v);
        sync();
      },
      { id: 'm-base' }
    ),
    el('div', { class: 'field' }, [
      el('label', { text: 'From', for: 'm-from' }),
      el('input', {
        type: 'date',
        id: 'm-from',
        value: state.from,
        onchange: (e) => {
          state.from = e.target.value;
          onDates();
        },
      }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'To', for: 'm-to' }),
      el('input', {
        type: 'date',
        id: 'm-to',
        value: state.to,
        onchange: (e) => {
          state.to = e.target.value;
          onDates();
        },
      }),
    ]),
    el('button', {
      class: 'btn',
      type: 'button',
      text: 'Whole of Lebanon',
      onclick: () => map.fitBounds(LEBANON, { padding: [10, 10] }),
    }),
    el('button', {
      class: 'btn',
      type: 'button',
      text: 'Back to the south',
      onclick: () => map.fitBounds(SOUTH, { padding: [10, 10] }),
    }),
    el('button', {
      class: 'btn',
      type: 'button',
      text: 'Clear dates',
      onclick: () => {
        state.from = '';
        state.to = '';
        document.getElementById('m-from').value = '';
        document.getElementById('m-to').value = '';
        onDates();
      },
    })
  );

  /* ------------------------------------------------------------- drawing */

  function sync() {
    syncURL(
      {
        types: state.types.length === types.length ? null : state.types,
        ground: state.ground,
        basemap: state.basemap === 'none' ? null : state.basemap,
        from: state.from || null,
        to: state.to || null,
      },
      ['types', 'ground', 'basemap', 'from', 'to']
    );
  }

  function draw() {
    sync();
    const tiles = [];
    const scaled = [];
    const shaded = {};

    types.forEach((type, i) => {
      const existing = typeLayers.get(type.code);
      if (existing) {
        map.removeLayer(existing);
        typeLayers.delete(type.code);
      }
      if (!state.types.includes(type.code)) return;

      const ds = sets[i];
      const selection = ds.select({
        from: state.from ? isoToDay(ds.epoch, state.from) : null,
        to: state.to ? isoToDay(ds.epoch, state.to) : null,
      });
      const n = ds.size(selection);

      if (TOWN_KINDS.has(type.code)) {
        // A town kind is counted by the municipality each record names.
        const counts = {};
        let named = 0;
        for (const g of ds.group(selection, 'municipality')) {
          if (g.none || g.other) continue;
          counts[g.key] = g.n;
          named += 1;
        }
        shaded[type.code] = counts;
        tiles.push(
          stat({
            label: type.label,
            value: fmt(n),
            sub:
              `${n === 1 ? 'record' : 'records'}, shading the ${fmt(named)} ` +
              `municipalit${named === 1 ? 'y' : 'ies'} ${n === 1 ? 'it names' : 'they name'}`,
          })
        );
        return;
      }

      const layer = townLayer(ds.towns(selection), { code: type.code }).addTo(map);
      typeLayers.set(type.code, layer);
      scaled.push(layer);

      const left = layer.__unplaced + layer.__untowned;
      tiles.push(
        stat({
          label: type.label,
          value: fmt(n),
          sub:
            `${n === 1 ? 'record' : 'records'} in ${fmt(layer.__towns)} town${layer.__towns === 1 ? '' : 's'} ` +
            'on the map' +
            (left ? `; ${fmt(left)} with no town or no point, not drawn` : ''),
        })
      );
    });

    autoScale(map, scaled);
    fill(statRow, ...tiles.slice(0, 4));
    drawShaded(shaded);
    drawLegend();
  }

  /* The town kinds, as one layer of municipalities: the first kind on shades
   * them, a second (when there is one) outlines them. One layer rather than
   * two, so a town that carries both answers one hover with both counts,
   * listed apart and never added. */
  let shadeToken = 0;

  async function drawShaded(byKind) {
    const token = ++shadeToken;
    const codes = types.map((t) => t.code).filter((c) => byKind[c]);
    if (!codes.length) {
      if (townLayerShaded) map.removeLayer(townLayerShaded);
      townLayerShaded = null;
      return;
    }
    let shapes;
    try {
      shapes = await geo('municipalities');
    } catch (err) {
      console.warn('municipalities', err);
      return;
    }
    if (token !== shadeToken) return;
    if (townLayerShaded) map.removeLayer(townLayerShaded);

    const [shadeCode, markCode] = codes;
    const shade = byKind[shadeCode];
    const marks = markCode ? byKind[markCode] : null;
    const ramp = typeRamp(shadeCode);
    const peak = Math.max(1, ...Object.values(shade));
    // Square root, as every choropleth here: a few towns carry most records.
    const step = (n) => ramp[Math.min(ramp.length - 1, Math.floor(Math.sqrt(n / peak) * ramp.length))];
    const named = shapes.features.filter(
      (f) => shade[f.properties.pcod] || (marks && marks[f.properties.pcod])
    );

    townLayerShaded = window.L.geoJSON(
      { type: 'FeatureCollection', features: named },
      {
        style(f) {
          const n = shade[f.properties.pcod];
          const marked = marks && marks[f.properties.pcod];
          return {
            color: marked ? typeColor(markCode) : p.map.stroke,
            weight: marked ? 1.8 : 0.5,
            fill: true,
            fillColor: n ? step(n) : p.map.land,
            fillOpacity: n ? 0.85 : 0,
          };
        },
        onEachFeature(f, lyr) {
          const q = f.properties;
          const rows = codes
            .filter((c) => byKind[c][q.pcod])
            .map((c) => countLabel(c, byKind[c][q.pcod]));
          lyr.bindTooltip(
            `<b>${q.name}</b>` +
              (q.name_ar ? ` <span style="opacity:.6">${q.name_ar}</span>` : '') +
              (q.district ? `<br><span style="opacity:.6">${q.district}</span>` : '') +
              `<br>${rows.join('<br>')}`,
            { sticky: true }
          );
        },
      }
    ).addTo(map);
    order();
  }

  function drawLegend() {
    if (typeLegend) map.removeControl(typeLegend);
    const on = types.filter((t) => state.types.includes(t.code));
    const shadedOn = on.filter((t) => TOWN_KINDS.has(t.code));
    const keys = on
      .map((t) => {
        if (TOWN_KINDS.has(t.code)) {
          if (t === shadedOn[0]) {
            const ramp = typeRamp(t.code);
            return (
              `<div class="key"><span class="swatch" style="background:linear-gradient(90deg,` +
              `${ramp[0]},${ramp[ramp.length - 1]})"></span>${t.label}, municipality shaded</div>`
            );
          }
          return (
            `<div class="key"><span class="swatch" style="background:transparent;` +
            `border:2px solid ${typeColor(t.code)}"></span>${t.label}, municipality outlined</div>`
          );
        }
        return (
          `<div class="key"><span class="swatch" style="border-radius:50%;` +
          `background:${typeColor(t.code)}"></span>${t.label}, per town</div>`
        );
      })
      .join('');
    const circles = on.some((t) => !TOWN_KINDS.has(t.code));
    typeLegend = legend(
      `<b>Records</b>${keys}` +
        (circles
          ? '<div style="margin-top:6px;font-size:.7rem;opacity:.8">One circle per town and kind, at ' +
            'the town’s own point. Area grows with the count.</div>'
          : '')
    ).addTo(map);
  }

  function drawGround() {
    sync();
    for (const [key, layer] of groundLayers.entries()) {
      if (!state.ground.includes(key)) {
        if (layer) map.removeLayer(layer);
        groundLayers.delete(key);
      }
    }
    for (const key of state.ground) {
      if (!GROUND[key] || groundLayers.has(key)) continue;
      groundLayers.set(key, null); // claim the slot so a double click loads once
      const asked = `${state.from}|${state.to}`;
      GROUND[key]
        .load()
        .then((layer) => {
          // Dropped if it was switched off, or the dates moved while it loaded.
          if (!state.ground.includes(key) || groundLayers.get(key) !== null) return;
          if (GROUND[key].dated && asked !== `${state.from}|${state.to}`) return;
          layer.addTo(map);
          groundLayers.set(key, layer);
          order();
        })
        .catch((err) => {
          console.warn(`${key} layer`, err);
          groundLayers.delete(key);
        });
    }
  }

  drawTypeChips();
  drawGroundChips();
  draw();
  drawGround();
}
