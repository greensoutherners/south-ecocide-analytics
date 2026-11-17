/* One incident type, as an interactive dashboard.
 *
 * Every type page is this module: the shells in `pages/` set a slug and call
 * `typePage()`. There is no per-type JavaScript, because a type's shape is
 * already declared in the export (`tools/publish/spec.py` in the collection
 * repository) and carried in `meta.json`: which columns may be grouped by,
 * which measures add up, and what the type's caveats are. Adding a type to the
 * site is adding an entry there and a nine-line HTML shell here.
 *
 * The page holds statistics, never records (the data owner, 2026-11-06): the
 * type's records counted by week, by town and by every documented column. So
 * every figure, chart and map here is a count or a sum, the map draws towns and
 * places no single event, and nothing on the page names a record.
 *
 * The interaction model is one selection, many views. A filter change computes
 * the matching cells once and then redraws the charts, the map and the tables
 * from that one array. That is what keeps the dashboard responsive on a phone
 * with no server behind it.
 *
 * The filters are deliberately visible as chips rather than hidden in a drawer:
 * a dashboard that does not show what it is filtered by will sooner or later
 * have one of its numbers quoted as a corpus-wide figure.
 */

import {
  dataset,
  dayToISO,
  fmt,
  fmtArea,
  fmtMeasure,
  geo,
  isoToDay,
  meta,
  typeSummary,
  dateLabel,
} from './data.js';
import { bars, calendar, donut, stacked, timeline } from './charts.js';
import { monthsBetween, scrubber } from './scrubber.js';
import {
  autoScale,
  adminLayer,
  burnedLayer,
  choropleth,
  countryLayer,
  lebanonMap,
  leftOutText,
  legend,
  rampLegendHTML,
  sizeLegendHTML,
  townLayer,
  townPeak,
  LEBANON,
  SOUTH,
  TOWN_KINDS,
} from './maps.js';
import { defaultDim } from './explore.js';
import { typeRamp } from './theme.js';
import {
  card,
  chipRow,
  chrome,
  contactNote,
  countLabel,
  el,
  failure,
  fill,
  kindNoun,
  listParam,
  loading,
  noteList,
  params,
  select,
  stat,
  table,
  tableFor,
  syncURL,
} from './ui.js';
import { shareCard } from './share.js';

/* Which map a type opens on.
 *
 * The data owner's rule: displacement orders are about a town, so the map
 * opens on the municipalities they name, shaded. Every other type opens on its
 * towns, one circle each at the town's own point, sized by its count. Both are
 * counts: no map here places a single record.
 */
function defaultMapMode(code) {
  return TOWN_KINDS.has(code) ? 'villages' : 'towns';
}

/** The map modes an older link may name, read as what they became. */
function readMapMode(asked) {
  if (asked === 'points') return 'towns';
  return ['towns', 'villages', 'districts', 'scars'].includes(asked) ? asked : null;
}

export async function typePage(slug) {
  const mount = document.getElementById('page');
  mount.append(loading());

  try {
    const [metaPayload, summaryPayload, ds] = await Promise.all([
      meta(),
      typeSummary(slug),
      dataset(slug),
    ]);
    await chrome(slug, Promise.resolve(metaPayload));
    document.title = `${summaryPayload.label}  | South Ecocide Analytics`;
    render(mount, { meta: metaPayload, summary: summaryPayload, ds });
  } catch (err) {
    fill(mount, failure(err));
  }
}

function render(mount, { meta: metaPayload, summary, ds }) {
  const query = params();

  /* ------------------------------------------------------------- state */

  const measures = ds.measures;
  const dims = ds.dims;
  /* The page opens on the column that says the most about the type itself
   * (`defaultDim`): the place codes exist for the choropleths and the location
   * key for the map, not as a first reading of the corpus. A column an older
   * link asks for that the data no longer carries falls back to it. */
  const openingDim = (query.by && dims.find((d) => d.k === query.by) && query.by) || defaultDim(ds);

  /* How the records were placed. White phosphorus states it as geolocated or
   * not; every other type as an exact or an approximate location. A count by
   * that column, never a mark on the map. */
  const locKey = ds.at.geolocated != null ? 'geolocated' : 'loc';

  const state = {
    by: openingDim,
    measure: query.measure && measures.some((m) => m.k === query.measure) ? query.measure : null,
    grain: query.grain === 'week' ? 'week' : 'month',
    from: query.from ? isoToDay(ds.epoch, query.from) : ds.minDay,
    to: query.to ? isoToDay(ds.epoch, query.to) : ds.maxDay,
    district: listParam(query.district),
    // Only values the opening column holds: a value an older link names for a
    // column that is gone would otherwise filter the page down to nothing.
    value: listParam(query.value).filter(
      (v) => v === '__none__' || (ds.dict[openingDim] || []).includes(v)
    ),
    mapMode: readMapMode(query.map) || defaultMapMode(ds.code),
  };
  if (state.mapMode === 'scars' && ds.code !== 'BRN') state.mapMode = defaultMapMode(ds.code);

  let selection = [];
  const total = ds.size(ds.all);

  /* The town list always carries the type's first declared measure, so the
   * table beside it can show hectares even while the page is counting records.
   * Asked for explicitly rather than by patching the dataset, which is shared
   * and cached for the whole page. */
  const townMeasure = measures.length ? measures[0].k : null;

  /* The scale of the town circles, fixed on the whole type so a filter or the
   * play head moves the circles and never the scale. */
  const peakOf = (measure) => townPeak(ds, measure);

  /* ------------------------------------------------------------- shell */

  const head = el('div', {}, [
    el('h1', {}, [
      summary.label,
      summary.frozen ? el('span', { class: 'badge frozen', text: 'frozen' }) : null,
    ]),
    el('p', { class: 'lede', text: summary.blurb }),
  ]);

  const filterBar = el('div', { class: 'card', style: 'margin-bottom:18px' });
  const scrubHost = el('div', { class: 'card', style: 'margin-bottom:18px' });
  const statRow = el('div', { class: 'grid cols-4' });
  // The tiles are refilled on every update and every tick of the play head,
  // so they are shared through this wrapper, which is made once.
  const figures = el('section', { 'aria-label': 'In figures', style: 'margin-bottom:18px' }, [statRow]);

  const timelineEl = el('div', { class: 'chart' });
  const byEl = el('div', { class: 'chart' });
  const locEl = el('div', { class: 'chart short' });
  const stackEl = el('div', { class: 'chart' });
  const calEl = el('div', { class: 'chart' });
  const townsEl = el('div', { class: 'chart tall' });
  const mapEl = el('div', { class: 'map' });

  // The group-by card's title and count follow the chosen column, changed in
  // place, so the share buttons beside them are never wiped by a refill.
  const byTitle = el('h3');
  const byCount = el('span', { style: 'font-size:.78rem;color:var(--ink-3)' });
  const byAside = headAside([byCount]);
  const byHead = el('div', { class: 'card-head' }, [byTitle, byAside]);
  const byTable = el('div');
  const locTable = el('div');
  const townsTable = el('div');
  const mapNote = el('p', { class: 'card-note' });

  /* Beside the chosen column, how the records were placed, counted. Hidden
   * while the page is grouped by that column itself, when it would only repeat
   * the chart beside it. */
  const locCard = card({
    title: locKey === 'geolocated' ? 'Geolocated or not' : 'How the records were placed',
    note:
      locKey === 'geolocated'
        ? 'Geolocated: placed on the ground from footage, a satellite detection or a burn ' +
          'scar. Not geolocated: the village is known and the spot is not. The map counts ' +
          'both by town or by district, and places no single record.'
        : 'Exact: placed by a sensor, a measured outline or a visual match. Approximate: ' +
          'known by its village only. The map counts both by town or by district, and ' +
          'places no single record.',
    body: [locEl, locTable],
  });
  const byCard = el('section', { class: 'card' }, [byHead, byEl, byTable]);
  const byPair = el('div', { class: 'section grid cols-2' }, [byCard, locCard]);

  const whenCard = card({
    title: 'When',
    note:
      'Drag the handles under the bars to narrow every chart and the map on this ' +
      'page to a period. An empty month is drawn as zero: it holds no record in this category, ' +
      'which is not evidence that nothing happened.',
    body: [timelineEl],
  });
  const splitCard = card({
    title: 'Month by month, split',
    note: 'Stacked by the column chosen above. Click a segment to filter by that value.',
    body: [stackEl],
  });
  // buildMapModes refills the mode chips; the share buttons sit beside them.
  const mapAside = headAside([el('div', { class: 'chips', id: 'map-modes' })]);
  const mapCard = card({
    title: 'Where',
    note: '',
    body: [mapEl, mapNote],
    aside: mapAside,
  });
  const townsCard = card({
    title: 'Towns',
    note: 'Click a bar to filter the page to that town’s district.',
    body: [townsEl, townsTable],
  });
  const weeksCard = card({
    title: 'Week by week',
    note:
      'One row per month, one cell per week of the month. This is what a monthly bar ' +
      'hides: whether a month came from one heavy week or from four ordinary ones. ' +
      'The figures are counted by week, so no cell here is a single day.',
    body: [calEl],
  });

  /* ------------------------------------------------------------- sharing */

  /* Every component carries "Share as link" and "Share as embed" (the data
   * owner, 2026-11-17). The link is this page's own address, which already
   * holds the filters, landing on the component; the embed is that address
   * showing the component alone with the Green Southerners credit under it
   * (share.js). Each is wired once, on an element made once, so no refill
   * takes the buttons away.
   *
   * A shared title names the type and what the component shows, then the
   * filters it is drawn under, so a filtered figure is not quoted as the whole
   * corpus. */
  const dataDate = String((metaPayload && metaPayload.generated_at) || '').slice(0, 10);
  const plural = kindNoun(ds.code, 2);
  const firstYear = Number(
    String((summary.date_range && summary.date_range[0]) || dayToISO(ds.epoch, ds.minDay)).slice(0, 4)
  );
  const what =
    `${plural === 'records' ? summary.label : cap(plural)} ` +
    (firstYear >= 2026 ? 'in the 2026 war' : 'in South Lebanon');

  /** The chosen measure in words, "burned area (ha)", or '' while counting records. */
  function measureWords() {
    const m = measures.find((x) => x.k === state.measure);
    if (!m) return '';
    const name = m.label.charAt(0).toLowerCase() + m.label.slice(1);
    return m.unit && m.unit !== 'count' ? `${name} (${m.unit})` : name;
  }

  /** "by month", or "burned area (ha) by month" while a measure is chosen. */
  function measured(phrase) {
    const m = measureWords();
    if (!m) return phrase;
    return `${m}${/^(by |week )/.test(phrase) ? ' ' : ', '}${phrase}`;
  }

  /* A column in words: "by cause", or "inside a protected area or not" for a
   * column that only says yes or no. One label names a reason rather than
   * what is shown, so a title says what its two values mean instead. */
  const TITLE_WORDS = { shown_as: 'linked to an attack or in the yellow-line zone' };

  function columnWords(key) {
    if (TITLE_WORDS[key]) return { words: TITLE_WORDS[key], bare: true };
    const label = ds.dimLabel(key);
    const values = ds.dict[key] || [];
    const bare =
      values.length > 0 &&
      values.every((v) => ['yes', 'no', 'unassessed', key, `not_${key}`].includes(v));
    const words = label.charAt(0).toLowerCase() + label.slice(1);
    return { words: bare ? `${words} or not` : words, bare };
  }

  function groupWords(key) {
    const c = columnWords(key);
    return c.bare ? c.words : `by ${c.words}`;
  }

  function splitWords(key) {
    const c = columnWords(key);
    return c.bare ? `by month, ${c.words}` : `by month and ${c.words}`;
  }

  /** "A", "A and B", "A, B and C". */
  function listWords(items, joiner = 'and') {
    return items.length > 1 ? `${items.slice(0, -1).join(', ')} ${joiner} ${items[items.length - 1]}` : items.join('');
  }

  /** The filters in force, " (Tyre district; 1 May 2026 to 31 May 2026)", or ''. */
  function filtered({ district = true, value = true } = {}) {
    const parts = [];
    if (district && state.district.length) {
      parts.push(`${listWords(state.district)} district${state.district.length === 1 ? '' : 's'}`);
    }
    if (value && state.by && state.value.length) {
      const names = new Map(ds.options(state.by).map((o) => [o.value, o.label]));
      const picked = listWords(
        state.value.map((v) =>
          v === '__none__' ? 'Not assessed' : v === '__other__' ? 'Other' : names.get(v) || v
        ),
        'or'
      );
      parts.push(TITLE_WORDS[state.by] ? picked : `${ds.dimLabel(state.by)}: ${picked}`);
    }
    if (state.from > ds.minDay || state.to < ds.maxDay) {
      parts.push(
        `${dateLabel(dayToISO(ds.epoch, state.from))} to ` +
          `${dateLabel(dayToISO(ds.epoch, Math.max(state.to, state.from)))}`
      );
    }
    return parts.length ? ` (${parts.join('; ')})` : '';
  }

  function mapTitle() {
    // The burned ground follows the dates and no other filter.
    if (state.mapMode === 'scars') return `${what}, map of burned ground${filtered({ district: false, value: false })}`;
    const unit = { villages: 'municipality', districts: 'district' }[state.mapMode] || 'town';
    const m = measureWords();
    return `${what}, ${m ? `map of ${m} by ${unit}` : `map by ${unit}`}${filtered()}`;
  }

  /* The frame of the stat tiles. They reflow with the width of the page that
   * holds the frame, so it is sized for three tiles a row, the row an article
   * column gives them, where a tile's note takes three lines (140 px). */
  function figuresHeight() {
    const tiles = [...statRow.children];
    const tallest = Math.max(0, ...tiles.map((t) => t.getBoundingClientRect().height));
    const rows = Math.max(1, Math.ceil(tiles.length / 3));
    return Math.max(240, Math.ceil(rows * Math.max(140, tallest + 12) + (rows - 1) * 16 + 64));
  }

  function shareOn(node, id, title, { aside = null, height = null } = {}) {
    const bar = shareCard(node, id, () => ({
      title: title(),
      height: height ? height() : frameHeight(node),
      date: dataDate || undefined,
    }));
    // Beside what the page refills in the head, never inside it.
    if (aside && bar) aside.append(bar);
  }

  shareOn(figures, 'figures', () => `${what}, in figures${filtered()}`, { height: figuresHeight });
  // The bars count the whole type whatever the filters, so the title names none.
  shareOn(whenCard, 'when', () => `${what}, ${measured(`by ${state.grain}`)}`);
  shareOn(byCard, 'by', () => `${what}, ${measured(groupWords(state.by))}${filtered()}`, { aside: byAside });
  shareOn(
    locCard,
    'placed',
    () =>
      `${what}, ${measured(locKey === 'geolocated' ? 'geolocated or not' : 'exact or approximate location')}` +
      filtered()
  );
  shareOn(splitCard, 'split', () => `${what}, ${splitWords(state.by)}${filtered()}`);
  shareOn(mapCard, 'where', mapTitle, { aside: mapAside });
  shareOn(townsCard, 'towns', () => `${what}, ${measured('by town')}${filtered()}`);
  shareOn(weeksCard, 'weeks', () => `${what}, ${measured('week by week')}${filtered()}`);

  mount.replaceChildren(
    head,
    filterBar,
    scrubHost,
    figures,
    el('div', { class: 'grid' }, [whenCard]),
    byPair,
    el('div', { class: 'section grid' }, [splitCard]),
    el('div', { class: 'section grid' }, [mapCard]),
    el('div', { class: 'section grid cols-2' }, [townsCard, weeksCard]),
    el('div', { class: 'section' }, [
      noteList(summary.caveats, { frozen: summary.frozen }),
      contactNote(),
    ])
  );

  /* ------------------------------------------------------------- charts */

  const charts = {
    timeline: timeline(timelineEl, {
      onBrush: (fromKey, toKey) => {
        if (!fromKey || !toKey) return;
        // A month bar's key is "2026-03", a week bar's "2026-03-09".
        state.from = isoToDay(ds.epoch, fromKey.length === 7 ? `${fromKey}-01` : fromKey);
        state.to = isoToDay(ds.epoch, endOf(toKey));
        update({ keepTimeline: true });
      },
    }),
    by: null,
    loc: donut(locEl),
    stack: stacked(stackEl, { onSelect: (key) => toggle('value', key) }),
    towns: bars(townsEl, {
      labelKey: 'name',
      onSelect: (_key, town) => town.district && toggle('district', town.district),
    }),
    calendar: calendar(calEl),
  };

  /* ------------------------------------------------------------- map */

  const map = lebanonMap(mapEl, { bounds: SOUTH });
  const mapLayers = {
    towns: null,
    districts: null,
    villages: null,
    burned: null,
  };
  let mapLegend = null;
  const baseLayers = [];

  /* The ground under the counts, chosen to match what is drawn on top.
   *
   * Drawing the country outline under the municipalities looked obvious and
   * was wrong: the two are generalised differently, so the coastline and the
   * border disagreed by a few hundred metres and the map grew a second set of
   * edges nothing could explain. When municipalities are the subject they are
   * also the land: an unshaded one is filled in the land colour, and there is
   * nothing underneath to disagree with.
   */
  let baseMode = null;

  async function loadBase(forMode) {
    const wanted = forMode === 'villages' ? 'none' : forMode === 'districts' ? 'none' : 'country';
    if (baseMode === wanted) return;

    for (const layer of baseLayers) map.removeLayer(layer);
    baseLayers.length = 0;
    baseMode = wanted;
    if (wanted === 'none') return;

    try {
      const [lebanon, districts] = await Promise.all([geo('lebanon'), geo('districts')]);
      const country = countryLayer(lebanon).addTo(map);
      country.bringToBack();
      baseLayers.push(country, adminLayer(districts).addTo(map));
    } catch (err) {
      console.warn('boundaries unavailable', err);
    }
  }

  /* ------------------------------------------------------------- filters */

  function toggle(key, value) {
    const list = state[key];
    const i = list.indexOf(value);
    if (i >= 0) list.splice(i, 1);
    else list.push(value);
    update();
  }

  function buildFilterBar() {
    const districts = ds.group(ds.all, 'district');

    const dimOptions = dims.map((d) => ({ value: d.k, label: d.label }));
    const measureOptions = [{ value: '', label: 'Count of records' }].concat(
      measures.map((m) => ({ value: m.k, label: `${m.label} (${m.unit})` }))
    );

    const controls = el('div', { class: 'controls' }, [
      select('Group by', dimOptions, state.by, (v) => {
        state.by = v;
        state.value = [];
        update();
      }, { id: 'f-by' }),
      measures.length
        ? select('Measure', measureOptions, state.measure || '', (v) => {
            state.measure = v || null;
            update();
          }, { id: 'f-measure' })
        : null,
      select(
        'Time grain',
        [
          { value: 'month', label: 'Month' },
          { value: 'week', label: 'Week' },
        ],
        state.grain,
        (v) => {
          state.grain = v;
          update();
        },
        { id: 'f-grain' }
      ),
      el('div', { class: 'field' }, [
        el('label', { text: 'From', for: 'f-from' }),
        el('input', {
          type: 'date',
          id: 'f-from',
          value: dayToISO(ds.epoch, state.from),
          min: dayToISO(ds.epoch, ds.minDay),
          max: summaryEnd(),
          onchange: (e) => {
            if (e.target.value) {
              state.from = isoToDay(ds.epoch, e.target.value);
              update();
            }
          },
        }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: 'To', for: 'f-to' }),
        el('input', {
          type: 'date',
          id: 'f-to',
          value: dayToISO(ds.epoch, Math.max(state.to, state.from)),
          min: dayToISO(ds.epoch, ds.minDay),
          max: summaryEnd(),
          onchange: (e) => {
            if (e.target.value) {
              state.to = isoToDay(ds.epoch, e.target.value);
              update();
            }
          },
        }),
      ]),
      el('button', {
        class: 'btn',
        type: 'button',
        text: 'Clear filters',
        onclick: () => {
          state.from = ds.minDay;
          state.to = ds.maxDay;
          state.district = [];
          state.value = [];
          update({ rebuild: true });
        },
      }),
    ]);

    const rows = [controls];

    if (districts.length > 1) {
      rows.push(
        el('div', { style: 'margin-top:12px' }, [
          el('label', {
            style: 'font-size:.76rem;color:var(--ink-2);font-weight:560;display:block;margin-bottom:5px',
            text: 'District',
          }),
          chipRow(
            districts.map((d) => ({ value: d.key, label: d.label, n: d.n })),
            state.district,
            (next) => {
              state.district = next;
              update();
            }
          ),
        ])
      );
    }

    fill(filterBar, ...rows);
  }

  /* The last day the type covers, from its summary: the cells are dated by
   * the start of their week, so the data's own last day is up to six days on. */
  function summaryEnd() {
    const last = summary.date_range && summary.date_range[1];
    return last || dayToISO(ds.epoch, ds.maxDay);
  }

  /* ------------------------------------------------------------- map modes */

  function buildMapModes() {
    const host = document.getElementById('map-modes');
    const modes = [
      { value: 'towns', label: 'Towns' },
      { value: 'villages', label: 'Villages, shaded' },
      { value: 'districts', label: 'Districts, shaded' },
    ];
    if (ds.code === 'BRN') modes.push({ value: 'scars', label: 'Burned ground' });

    fill(
      host,
      ...modes.map((m) =>
        el('button', {
          class: 'chip',
          type: 'button',
          text: m.label,
          'aria-pressed': state.mapMode === m.value ? 'true' : 'false',
          onclick: () => {
            state.mapMode = m.value;
            buildMapModes();
            drawMap();
            syncState();
          },
        })
      )
    );
  }

  /* ------------------------------------------------------------- draw */

  /* Draws overlap, so the last one wins.
   *
   * drawMap awaits a layer file, and the scrubber can ask for another draw
   * before the first has finished. Both would then pass the removal loop
   * before either had added anything, and the map would end up with two
   * copies of a 1,627-polygon layer stacked on itself. The token says which
   * draw is still the current one; an older draw stops as soon as it is not.
   */
  let drawToken = 0;

  async function drawMap() {
    const token = ++drawToken;
    await loadBase(state.mapMode);
    if (token !== drawToken) return;
    for (const key of Object.keys(mapLayers)) {
      if (mapLayers[key]) {
        map.removeLayer(mapLayers[key]);
        mapLayers[key] = null;
      }
    }
    if (mapLegend) {
      map.removeControl(mapLegend);
      mapLegend = null;
    }

    if (state.mapMode === 'towns' || state.mapMode === 'scars') map.setBoundsAndRefit(SOUTH);

    if (state.mapMode === 'towns') {
      const measure = state.measure;
      const towns = ds.towns(selection, { measure });
      const peak = measure ? peakOf(measure) : null;
      const unit = unitOf(measure);
      mapLayers.towns = townLayer(towns, { code: ds.code, measure, unit, peak }).addTo(map);
      autoScale(map, [mapLayers.towns]);
      mapLegend = legend(
        sizeLegendHTML({
          code: ds.code,
          title: measure ? `${labelOf(measure)} per town (${unit})` : `${cap(kindNoun(ds.code, 2))} per town`,
          peak: measure ? peak : peakOf(null),
          measure,
          unit,
        })
      ).addTo(map);
      const drawn = mapLayers.towns.__towns;
      const left = leftOutText(ds.code, mapLayers.towns);
      mapNote.textContent =
        `${fmt(drawn)} town${drawn === 1 ? '' : 's'} in view, each a circle at the town’s own ` +
        'point, its area growing with ' +
        (measure ? `the ${labelOf(measure).toLowerCase()} of its records` : 'the records that name it') +
        '. The map counts by town and places no single event.' +
        (left ? ` ${left}` : '');
    } else if (state.mapMode === 'districts' || state.mapMode === 'villages') {
      const village = state.mapMode === 'villages';
      const column = village ? 'municipality' : 'adm2';

      if (ds.at[column] == null) {
        // The boundary join has not been exported. Say so rather than drawing
        // an empty country, which would read as "no records anywhere".
        mapNote.textContent =
          'This view needs the official boundary codes, which this data snapshot does not ' +
          'carry. Choose Towns for the counts by town.';
        return;
      }

      const groups = ds.group(selection, column, { measure: state.measure });
      const counts = {};
      for (const g of groups) {
        if (g.key === '__none__' || g.key === '__other__') continue;
        counts[g.key] = state.measure ? g.v || 0 : g.n;
      }

      const shapes = await geo(village ? 'municipalities' : 'districts');
      if (token !== drawToken) return;
      // One kind of record, so its own colour, from a wash to the full hue.
      const ramp = typeRamp(ds.code);
      const unit = unitOf(state.measure);
      const layer = choropleth(shapes, counts, {
        key: 'pcod',
        label: 'records',
        land: true,
        ramp,
        unit: state.measure ? unit : 'records',
        format: (v) => (state.measure ? `${fmtMeasure(v, unit)} ${unit}` : countLabel(ds.code, v)),
        onPick: (code) => {
          if (state.by !== column) {
            state.by = column;
            state.value = [];
          }
          toggle('value', code);
        },
      }).addTo(map);
      mapLayers[village ? 'villages' : 'districts'] = layer;
      // The drawing covers the whole country; the view frames the ground that
      // carries records, which the reader can still pan out of.
      map.setBoundsAndRefit(layer.__shadedBounds || LEBANON);

      mapLegend = legend(
        rampLegendHTML(
          layer.__peak,
          state.measure ? labelOf(state.measure) : 'Records',
          village
            ? 'Unshaded means no record in this category names it, not that nothing happened there.'
            : 'Unshaded means no record in this category falls in it, not that nothing happened there.',
          ramp
        )
      ).addTo(map);

      const shaded = Object.keys(counts).length;
      mapNote.textContent = village
        ? `${fmt(shaded)} of ${fmt(shapes.features.length)} Lebanese municipalities carry a ` +
          'record in this category. An unshaded municipality is one no record in this category ' +
          'names, which is not a finding that nothing happened there. The scale is ' +
          'square-rooted, because a few places carry far more records than most.'
        : 'A district with no shade holds no record in this category, which is not a finding ' +
          'that it had no incidents. The scale is square-rooted, because a few districts ' +
          'carry most records.';
    } else if (state.mapMode === 'scars') {
      try {
        const burned = await geo('burned');
        if (token !== drawToken) return;
        const from = dayToISO(ds.epoch, state.from);
        const to = dayToISO(ds.epoch, state.to);
        mapLayers.burned = burnedLayer(burned, { from, to }).addTo(map);
        const months = mapLayers.burned.__months;
        mapNote.textContent =
          `${fmtArea(mapLayers.burned.__ha)} ha of burned ground, from the fires that began in ` +
          `the ${fmt(months)} month${months === 1 ? '' : 's'} in view, measured on Sentinel-2 ` +
          'passes either side of each fire. The ground is merged by month, so it follows the ' +
          'dates and no other filter on this page, and ground two fires share is drawn and ' +
          'counted once: it can be less than the burned area the records add up to. It says ' +
          'that ground burned, not what lit it.';
      } catch (err) {
        mapNote.textContent = 'The burned-ground layer did not load.';
      }
    }
  }

  function unitOf(key) {
    const m = measures.find((x) => x.k === key);
    return m ? m.unit : '';
  }

  function labelOf(key) {
    const m = measures.find((x) => x.k === key);
    return m ? m.label : 'Records';
  }

  function syncState() {
    syncURL(
      {
        by: state.by,
        measure: state.measure,
        grain: state.grain === 'month' ? null : state.grain,
        // The whole period is the default, however it is written.
        from: state.from <= ds.minDay ? null : dayToISO(ds.epoch, state.from),
        to: state.to >= ds.maxDay ? null : dayToISO(ds.epoch, state.to),
        district: state.district,
        value: state.value,
        map: state.mapMode === defaultMapMode(ds.code) ? null : state.mapMode,
      },
      ['by', 'measure', 'grain', 'from', 'to', 'district', 'value', 'map']
    );
  }

  function update({ rebuild = false, keepTimeline = false, fromScrubber = false } = {}) {
    // Twelve frames a second of a week grid and a full table rebuild is what
    // makes an animated dashboard stutter. While the play head is moving, the
    // figures, the map and the two charts that carry the story redraw; the
    // rest catch up when it stops.
    const light = fromScrubber && scrub && scrub.playing;
    const filters = { district: state.district };
    if (state.by && state.value.length) filters[state.by] = state.value;

    selection = ds.select({ filters, from: state.from, to: state.to });
    const inView = ds.size(selection);

    /* --- stat tiles --- */
    const towns = ds.towns(selection, { measure: townMeasure });
    const named = towns.filter((t) => t.name !== 'No town recorded');
    const districtCount = new Set(named.map((t) => t.district).filter(Boolean)).size;
    const weeks = ds.series(selection, { grain: 'week' }).filter((b) => b.n > 0);

    const tiles = [
      stat({
        label: 'Records in view',
        value: fmt(inView),
        sub: inView === total ? 'the whole published corpus for this type' : `of ${fmt(total)} published`,
      }),
      stat({
        label: 'Towns',
        value: fmt(named.length),
        sub: districtCount ? `in ${fmt(districtCount)} district${districtCount === 1 ? '' : 's'}` : 'no town in view',
      }),
      stat({
        label: 'Weeks with a record',
        // The count of weeks, not the length of the span: a type with 600
        // records in 9 weeks is a different pattern from one spread over every
        // week of the year, and the span alone hides which it is.
        value: fmt(weeks.length),
        sub: weeks.length
          ? `from the week of ${dateLabel(weeks[0].key)} to the week of ${dateLabel(weeks[weeks.length - 1].key)}`
          : 'no dated records in view',
      }),
    ];

    for (const m of measures) {
      const { total: sum, records, coverage } = ds.sum(selection, m.k);
      tiles.push(
        stat({
          label: m.label,
          value: fmtMeasure(sum, m.unit),
          unit: m.unit === 'ha' ? ' ha' : '',
          sub:
            records === inView
              ? 'every record in view carries a figure'
              : `from ${fmt(records)} of ${fmt(inView)} records (${Math.round(coverage * 100)}%)`,
        })
      );
    }
    fill(statRow, ...tiles);

    /* --- timeline --- */
    if (!keepTimeline) {
      const whole = ds.series(ds.all, { grain: state.grain, measure: state.measure });
      charts.timeline.update(whole, {
        measure: state.measure,
        unit: unitOf(state.measure),
        grain: state.grain,
      });
    }

    /* --- group-by --- */
    const groups = ds.group(selection, state.by, { measure: state.measure, limit: 8 });
    const dimLabel = ds.dimLabel(state.by);
    const useDonut = groups.length <= 6;
    // The location card sits beside this one, unless the page is grouped by
    // location already and it would only repeat it.
    const showLoc = ds.at[locKey] != null && state.by !== locKey;
    locCard.style.display = showLoc ? '' : 'none';
    byPair.className = showLoc ? 'section grid cols-2' : 'section grid';

    byTitle.textContent = dimLabel;
    byCount.textContent = `${groups.length} values`;

    if (charts.by) charts.by.dispose();
    byEl.replaceChildren();
    byEl.className = useDonut ? 'chart' : 'chart tall';
    // Alone on its row, a donut keeps its legend beside it rather than across
    // the page.
    byEl.style.maxWidth = useDonut && !showLoc ? '640px' : '';
    charts.by = (useDonut ? donut : bars)(byEl, { onSelect: (key) => toggle('value', key) });
    charts.by.update(groups, {
      measure: state.measure,
      unit: unitOf(state.measure),
      centreLabel: state.measure ? unitOf(state.measure) : 'records',
    });
    fill(
      byTable,
      tableFor(groups, {
        dimension: dimLabel,
        measure: state.measure ? labelOf(state.measure) : null,
        unit: unitOf(state.measure),
      })
    );

    /* --- how the records were placed --- */
    const locGroups = showLoc
      ? ds.group(selection, locKey, { measure: state.measure, keepOrder: true })
      : [];
    if (locGroups.length) {
      charts.loc.update(locGroups, {
        measure: state.measure,
        unit: unitOf(state.measure),
        centreLabel: state.measure ? unitOf(state.measure) : 'records',
      });
      fill(
        locTable,
        tableFor(locGroups, {
          dimension: ds.dimLabel(locKey),
          measure: state.measure ? labelOf(state.measure) : null,
          unit: unitOf(state.measure),
        })
      );
    }

    /* --- stacked --- */
    charts.stack.update(ds.seriesBy(selection, state.by, { grain: 'month', limit: 6 }));

    /* --- towns --- */
    // The bars carry the measure the reader chose (the list above carries the
    // type's first one, for the table), so a second measure is read for them.
    const barTowns = state.measure && state.measure !== townMeasure ? ds.towns(selection, { measure: state.measure }) : towns;
    const topTowns = barTowns.slice(0, 18);
    charts.towns.update(topTowns, {
      measure: state.measure,
      unit: unitOf(state.measure),
    });
    if (light) {
      drawMap();
      syncState();
      return;
    }

    fill(
      townsTable,
      el('details', { class: 'table-toggle' }, [
        el('summary', { text: `Table (${towns.length} towns)` }),
        table(
          [
            'Town',
            'District',
            { label: 'Records', num: true },
            measures.length ? { label: `${measures[0].label} (${measures[0].unit})`, num: true } : null,
          ].filter(Boolean),
          towns.map((t) =>
            el('tr', {}, [
              el('td', { class: 'name', text: t.name }),
              el('td', { text: t.district || 'n/a' }),
              el('td', { class: 'num', text: fmt(t.n) }),
              measures.length
                ? el('td', {
                    class: 'num',
                    text:
                      t.v == null
                        ? 'n/a'
                        : fmtMeasure(t.v, measures[0].unit),
                  })
                : null,
            ].filter(Boolean))
          )
        ),
      ])
    );

    /* --- week by week --- */
    // On the published statistics a "day" bucket is a week: each cell is dated
    // by its week's first day.
    charts.calendar.update(ds.series(selection, { grain: 'day', measure: state.measure }), {
      measure: state.measure,
      unit: unitOf(state.measure),
    });

    if (rebuild) buildFilterBar();
    drawMap();
    syncState();
  }

  /* ------------------------------------------------------------- scrubber */

  const months = monthsBetween(dayToISO(ds.epoch, ds.minDay), summaryEnd());

  // A period the link asked for. The scrubber opens on the whole period and
  // would otherwise replace it.
  const asked = { from: state.from, to: state.to };

  let scrub = null;
  if (months.length > 1) {
    scrub = scrubber(
      scrubHost,
      months,
      (from, to) => {
        state.from = isoToDay(ds.epoch, from);
        state.to = isoToDay(ds.epoch, to);
        // The filter bar's own date inputs are the same state, so keep them in
        // step rather than letting the page show two different periods.
        const fromInput = document.getElementById('f-from');
        const toInput = document.getElementById('f-to');
        if (fromInput) fromInput.value = from;
        if (toInput) toInput.value = to;
        update({ keepTimeline: true, fromScrubber: true });
      },
      { label: 'records' }
    );
  } else {
    scrubHost.remove();
  }

  if (query.from || query.to) {
    state.from = asked.from;
    state.to = asked.to;
  }

  buildFilterBar();
  buildMapModes();
  update();
}

/** The last day of a month ("2026-03") or of a week ("2026-03-09"). */
function endOf(key) {
  if (key.length === 7) {
    const [y, m] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  }
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

function cap(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The right side of a card head: what the page refills there, then the share buttons. */
function headAside(children) {
  return el(
    'div',
    { style: 'display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px 12px' },
    children
  );
}

/* The height of the frame a shared card is embedded in. The card is measured
 * on what it holds, not on the box it is drawn in: beside a taller card in a
 * grid row it is stretched to that card's height. A table the reader opened is
 * left out, since a frame opens with them closed. The rest is room for the
 * credit line under the card and for its text to wrap in a narrower frame. */
function frameHeight(node) {
  const box = node.getBoundingClientRect();
  const css = getComputedStyle(node);
  let bottom = box.top;
  for (const child of node.children) {
    const r = child.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    bottom = Math.max(bottom, r.bottom + (parseFloat(getComputedStyle(child).marginBottom) || 0));
  }
  let height = bottom - box.top + (parseFloat(css.paddingBottom) || 0) + (parseFloat(css.borderBottomWidth) || 0);
  for (const open of node.querySelectorAll('details[open]')) {
    const summary = open.querySelector(':scope > summary');
    height -= open.getBoundingClientRect().height - (summary ? summary.getBoundingClientRect().height : 0);
  }
  // 66 px hold the credit line and the frame's margins; the rest is for wrapping.
  return Math.max(240, Math.ceil(height) + 112);
}
