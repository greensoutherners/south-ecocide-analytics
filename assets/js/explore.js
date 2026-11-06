/* The explorer: one record type, with its own controls, small enough to embed.
 *
 * Every other widget shows one view of the corpus, chosen by whoever wrote the
 * embed. This one hands the choice to the reader: a play head that walks the
 * months, chips that filter by one documented column, a district picker, and a
 * switch between the chart and the map. Everything inside the frame recomputes
 * from the same selection on every change, so the figures, the chart and the
 * map can never disagree with one another.
 *
 * It is the type dashboard compressed into an article's width, and it is
 * configured entirely by query string:
 *
 *   type      the record type's slug                     fires
 *   controls  which controls to show, comma separated    time,dim,district
 *   dim       the column offered as filter chips         fire_cause_id
 *   view      chart, map or both                         both
 *   map       towns, villages or districts               towns; villages for ALR
 *                                                        (an older link's points
 *                                                        read as towns)
 *   mode      the scrubber's reading: cumulative/month   cumulative
 *   autoplay  1 to start playing on load                 0
 *   vh        the chart and map height in pixels          400 with both views
 *   title     override the heading
 *
 * Three rules from the rest of the site hold here too. Nothing is summed across
 * types, because the widget only ever holds one. Every figure that a filter
 * changes says what it is now filtered by, because a number quoted from an
 * embedded widget without its filter is a corpus figure it never was. And it
 * holds statistics, never records: its map counts by town.
 */

import { dataset, dateLabel, dayToISO, fmt, fmtMeasure, geo, isoToDay, typeSummary } from './data.js';
import { timeline } from './charts.js';
import {
  autoScale,
  choropleth,
  lebanonMap,
  legend,
  LEBANON,
  rampLegendHTML,
  sizeLegendHTML,
  SOUTH,
  townLayer,
  townPeak,
  TOWN_KINDS,
} from './maps.js';
import { monthsBetween, scrubber } from './scrubber.js';
import { typeRamp } from './theme.js';
import { countLabel, el, fill, kindNoun } from './ui.js';

/* The documented column each type opens on: the explorer's filter chips, and,
 * through `defaultDim`, what a type page or a chart embed groups by first. */
export const DEFAULT_DIM = {
  BRN: 'fire_cause_id',
  // Detonations are hidden for now (the data owner, 2026-11-06). To show them
  // again: DET: 'whole_town_operation'.
  WPB: 'geolocated',
  ALR: 'alarm_scope_id',
  ATT: 'attack_type_id',
};

/* Columns that place a record rather than describe it. They exist for the
 * choropleths and the location key, not as a first reading of a type. */
const PLACE_DIMS = new Set(['municipality', 'adm2', 'loc']);

/**
 * The column a chart of one type opens on.
 *
 * The type's own default where the data gives it two or more assessed values.
 * Where it does not (a column no record in the snapshot has assessed yet), the
 * first documented column that does, then the official district, so a chart
 * never opens on a single slice.
 */
export function defaultDim(ds) {
  const spread = (k) =>
    ds.at[k] != null && ds.group(ds.all, k).filter((g) => !g.none && g.key !== 'unassessed').length > 1;
  const own = DEFAULT_DIM[ds.code];
  if (own && spread(own)) return own;
  const next = ds.dims.find((d) => !PLACE_DIMS.has(d.k) && spread(d.k));
  if (next) return next.k;
  if (spread('adm2')) return 'adm2';
  return own && ds.at[own] != null ? own : (ds.dims[0] || {}).k || null;
}

/* The types whose map shades the town they name (see `TOWN_KINDS` in maps.js).
 * They open on shaded villages; every other type on its towns, sized. */
export const TOWN_TYPES = TOWN_KINDS;

const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);

export async function explorer(mount, query, { credit, link }) {
  const slug = query.type || 'fires';
  const [info, ds] = await Promise.all([typeSummary(slug), dataset(slug)]);

  // A control an older embed names that this widget no longer has is ignored.
  const controls = new Set(
    (query.controls || 'time,dim,district').split(',').map((s) => s.trim()).filter(Boolean)
  );
  const dim =
    query.dim && ds.at[query.dim] != null ? query.dim : DEFAULT_DIM[ds.code] || ds.dims[0]?.k;
  const views = query.view === 'chart' ? ['chart'] : query.view === 'map' ? ['map'] : ['chart', 'map'];

  const askedMap = query.map === 'points' ? 'towns' : query.map;
  const state = {
    from: ds.minDay,
    to: ds.maxDay,
    value: [],
    district: '',
    view: views[0],
    mapMode: TOWN_TYPES.has(ds.code)
      ? askedMap === 'districts'
        ? 'districts'
        : 'villages'
      : ['towns', 'villages', 'districts'].includes(askedMap)
        ? askedMap
        : 'towns',
  };
  const total = ds.size(ds.all);
  // The circles' scale, fixed on the whole type so the play head moves the
  // circles and never the scale.
  const peak = townPeak(ds);

  /* ---------------------------------------------------------------- frame */

  const titleEl = el('p', { class: 'embed-title', text: query.title || info.label });
  const subEl = el('p', { class: 'embed-sub' });
  const scrubHost = el('div', { class: 'xp-scrub' });
  const chipHost = el('div', { class: 'xp-controls' });
  const statRow = el('div', { class: 'xp-stats' });
  const filterNote = el('p', { class: 'xp-filtered' });
  // With both views on offer, the chart and the map share one height, so
  // switching between them does not resize the frame an article holds them in.
  const visualHeight = Number(query.vh) || (views.length > 1 ? 400 : views[0] === 'map' ? 420 : 300);
  const chartEl = el('div', { class: 'chart', style: `height:${visualHeight}px` });
  const mapEl = el('div', { class: 'map', style: `height:${visualHeight}px` });
  const viewSwitch = el('div', { class: 'chips xp-view' });
  const visual = el('div', { class: 'xp-visual' });

  mount.replaceChildren(
    el('div', { class: 'embed-root' }, [
      el('div', { class: 'embed-frame' }, [
        el('div', { class: 'xp-head' }, [el('div', {}, [titleEl, subEl]), views.length > 1 ? viewSwitch : null]),
        controls.has('time') ? scrubHost : null,
        chipHost,
        statRow,
        filterNote,
        visual,
        el('div', { class: 'embed-credit' }, [
          el('span', { html: credit }),
          el('a', { href: link, target: '_blank', rel: 'noopener', text: 'Open the full dashboard →' }),
        ]),
      ]),
    ])
  );

  /* ---------------------------------------------------------------- controls */

  function chips(label, options, selected, onChange, colors = null) {
    const row = el('div', { class: 'chips' });
    options.forEach((o, i) => {
      const on = selected.includes(o.value);
      const chip = el('button', {
        class: 'chip',
        type: 'button',
        'aria-pressed': on ? 'true' : 'false',
        onclick: () => {
          const next = selected.includes(o.value)
            ? selected.filter((v) => v !== o.value)
            : [...selected, o.value];
          onChange(next);
        },
      });
      if (colors) chip.append(el('span', { class: 'swatch', style: `background:${colors[i]}` }));
      chip.append(document.createTextNode(o.label));
      row.append(chip);
    });
    return el('div', { class: 'xp-group' }, [el('span', { class: 'xp-label', text: label }), row]);
  }

  function drawControls() {
    const groups = [];

    if (controls.has('dim') && dim) {
      const opts = ds.group(ds.all, dim).filter((g) => g.key !== '__none__').slice(0, 7);
      if (opts.length > 1) {
        groups.push(
          chips(
            ds.dimLabel(dim),
            opts.map((g) => ({ value: g.key, label: g.label })),
            state.value,
            (next) => {
              state.value = next;
              update();
            }
          )
        );
      }
    }

    if (controls.has('district')) {
      const districts = ds.group(ds.all, 'district').filter((g) => g.key !== '__none__');
      if (districts.length > 1) {
        const select = el('select', { 'aria-label': 'District' });
        select.append(el('option', { value: '', text: 'Every district' }));
        for (const d of districts) {
          select.append(el('option', { value: d.key, text: `${d.label} (${fmt(d.n)})`, selected: d.key === state.district }));
        }
        select.addEventListener('change', () => {
          state.district = select.value;
          update();
        });
        groups.push(el('div', { class: 'xp-group' }, [el('span', { class: 'xp-label', text: 'District' }), select]));
      }
    }

    if (state.value.length || state.district) {
      groups.push(
        el('button', {
          class: 'btn xp-clear',
          type: 'button',
          text: 'Clear filters',
          onclick: () => {
            state.value = [];
            state.district = '';
            update();
          },
        })
      );
    }

    fill(chipHost, ...groups);
  }

  function drawViewSwitch() {
    fill(
      viewSwitch,
      ...views.map((v) =>
        el('button', {
          class: 'chip',
          type: 'button',
          'aria-pressed': state.view === v ? 'true' : 'false',
          text: v === 'chart' ? 'Chart' : 'Map',
          onclick: () => {
            state.view = v;
            drawViewSwitch();
            drawVisual();
            fit();
          },
        })
      )
    );
  }

  /* ---------------------------------------------------------------- views */

  const chart = timeline(chartEl);
  let map = null;
  let layer = null;
  let mapLegend = null;
  let drawToken = 0;

  function selection() {
    const filters = {};
    if (dim && state.value.length) filters[dim] = state.value;
    if (state.district) filters.district = [state.district];
    return ds.select({ filters, from: state.from, to: state.to });
  }

  async function drawMap(sel) {
    const token = ++drawToken;
    if (!map) {
      map = lebanonMap(mapEl, { bounds: SOUTH });
    }
    if (layer) {
      map.removeLayer(layer);
      layer = null;
    }
    if (mapLegend) {
      map.removeControl(mapLegend);
      mapLegend = null;
    }

    if (state.mapMode === 'towns') {
      if (token !== drawToken) return;
      layer = townLayer(ds.towns(sel), { code: ds.code }).addTo(map);
      autoScale(map, [layer]);
      mapLegend = legend(
        sizeLegendHTML({ code: ds.code, title: `${cap(kindNoun(ds.code, 2))} per town`, peak })
      ).addTo(map);
      return;
    }

    const column = state.mapMode === 'districts' ? 'adm2' : 'municipality';
    if (ds.at[column] == null) return;
    const shapes = await geo(state.mapMode === 'districts' ? 'districts' : 'municipalities');
    if (token !== drawToken) return;
    const counts = {};
    for (const g of ds.group(sel, column)) {
      if (g.key !== '__none__' && g.key !== '__other__') counts[g.key] = g.n;
    }
    // One kind of record, so its own colour, from a wash to the full hue.
    const ramp = typeRamp(ds.code);
    layer = choropleth(shapes, counts, {
      key: 'pcod',
      unit: 'records',
      land: true,
      ramp,
      format: (v) => countLabel(ds.code, v),
    }).addTo(map);
    mapLegend = legend(rampLegendHTML(layer.__peak, 'Records', null, ramp)).addTo(map);
    if (!drawMap.__framed) {
      map.setBoundsAndRefit(layer.__shadedBounds || LEBANON);
      drawMap.__framed = true;
    }
  }

  function drawVisual() {
    const sel = selection();
    if (state.view === 'chart') {
      if (!chartEl.isConnected) fill(visual, chartEl);
      chart.update(ds.series(sel, { grain: 'month' }), { grain: 'month' });
    } else {
      if (!mapEl.isConnected) fill(visual, mapEl);
      drawMap(sel);
    }
  }

  /* ---------------------------------------------------------------- update */

  function describeFilters() {
    const parts = [];
    if (state.value.length) {
      const labels = ds.group(ds.all, dim);
      parts.push(state.value.map((v) => labels.find((g) => g.key === v)?.label || v).join(' or '));
    }
    if (state.district) parts.push(`in ${state.district}`);
    return parts;
  }

  function update() {
    const sel = selection();
    const n = ds.size(sel);
    const towns = ds.towns(sel).filter((t) => t.name !== 'No town recorded').length;
    const tiles = [
      ['Records', fmt(n)],
      ['Towns', fmt(towns)],
    ];
    const m = ds.measures[0];
    if (m) {
      const { total } = ds.sum(sel, m.k);
      tiles.push([m.label, `${fmtMeasure(total, m.unit)}${m.unit === 'ha' ? ' ha' : ''}`]);
    }
    fill(
      statRow,
      ...tiles.map(([label, value]) =>
        el('div', { class: 'xp-stat' }, [el('span', { class: 'xp-stat-label', text: label }), el('b', { text: value })])
      )
    );

    const from = dayToISO(ds.epoch, Math.max(state.from, ds.minDay));
    // The last cell is dated by its week's first day; the type's own last day
    // is in its summary.
    const to =
      state.to >= ds.maxDay && info.date_range && info.date_range[1]
        ? info.date_range[1]
        : dayToISO(ds.epoch, state.to);
    subEl.textContent = `${fmt(n)} of ${fmt(total)} records, ${dateLabel(from)} to ${dateLabel(to)}`;

    const filters = describeFilters();
    filterNote.textContent = filters.length
      ? `Filtered to ${filters.join(', ')}. A figure quoted from this view is a filtered figure.`
      : '';
    filterNote.style.display = filters.length ? '' : 'none';

    drawControls();
    drawVisual();
    fit();
  }

  /* An article holds this widget in a frame of fixed height: the site it is
   * embedded in runs no script to resize frames. So inside a frame the chart
   * or the map takes whatever height the controls leave, and the widget fills
   * the frame at any width instead of overflowing it on a phone, where the
   * controls wrap onto more lines. `vh` in the query fixes the height instead. */
  const framed = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();

  function fit() {
    if (!framed || query.vh) return;
    const active = state.view === 'chart' ? chartEl : mapEl;
    if (!active.isConnected) return;
    const total = document.documentElement.getBoundingClientRect().height;
    const others = total - active.getBoundingClientRect().height;
    const target = Math.max(200, Math.floor(window.innerHeight - others - 2));
    if (Math.abs(target - (parseFloat(active.style.height) || 0)) > 2) {
      chartEl.style.height = `${target}px`;
      mapEl.style.height = `${target}px`;
    }
  }
  window.addEventListener('resize', fit);

  /* ---------------------------------------------------------------- start */

  const months = monthsBetween(dayToISO(ds.epoch, ds.minDay), dayToISO(ds.epoch, ds.maxDay));
  if (controls.has('time') && months.length > 1) {
    const scrub = scrubber(
      scrubHost,
      months,
      (fromIso, toIso) => {
        state.from = isoToDay(ds.epoch, fromIso);
        state.to = isoToDay(ds.epoch, toIso);
        update();
      },
      { mode: query.mode === 'month' ? 'month' : 'cumulative' }
    );
    if (query.autoplay === '1' && scrub) scrub.play();
  }

  if (views.length > 1) drawViewSwitch();
  update();
}
