/* One village: what the corpus counts there, and the ground itself.
 *
 * This is the page that crosses types, and it is the one place where that is
 * clearly the right thing to do: a reader asking about Al-Khiyam wants fires,
 * white phosphorus and displacement orders on one screen. They are still shown
 * apart: one card and one lane per kind, and no row that adds them.
 *
 * The site publishes statistics, never records (the data owner, 2026-11-06),
 * so each kind is shown by its count, the months it covers and how its
 * records split by every documented column. No record is listed or named.
 *
 * The imagery is the other half: a before-and-after swipe and a satellite
 * time-lapse, where they have been built for the town.
 */

import {
  dataset,
  dateLabel,
  fmt,
  fmtArea,
  fmtMeasure,
  geo,
  isoToDay,
  meta,
  monthLabel,
  summary,
  villages,
  ongeo,
  timelapseIndex,
  ROOT,
} from './data.js';
import { lanes } from './charts.js';
import { scrubber } from './scrubber.js';
import { swipe } from './compare.js';
import { timelapse } from './timelapse.js';
import {
  adminLayer,
  autoScale,
  countryLayer,
  lebanonMap,
  legend,
  townLayer,
  TOWN_KINDS,
  villageLayer,
} from './maps.js';
import { colorsFor, typeColor } from './theme.js';
import {
  card,
  chrome,
  contactNote,
  countLabel,
  el,
  failure,
  fill,
  kindNoun,
  loading,
  noteList,
  params,
  stat,
  url,
} from './ui.js';

/* Columns that place a record rather than describe it: the choropleths' join
 * keys. A village page is already one place, so they are not broken down. */
const PLACE_DIMS = new Set(['municipality', 'adm2']);

export async function villagePage() {
  const mount = document.getElementById('page');
  mount.append(loading());

  try {
    const [metaPayload, summaryPayload, payload] = await Promise.all([
      meta(),
      summary(),
      villages(),
    ]);
    await chrome('villages', Promise.resolve(metaPayload));

    const query = params();
    const wanted = query.v || query.village || query.id;
    const town =
      payload.towns.find((t) => String(t.id) === String(wanted)) ||
      payload.towns.find((t) => (t.name || '').toLowerCase() === String(wanted || '').toLowerCase());

    if (!town) {
      fill(mount, chooser(payload.towns, wanted));
      return;
    }

    document.title = `${town.name}  | South Ecocide Analytics`;
    const types = summaryPayload.types.filter((t) => t.total > 0 && town.types[t.code]);
    const sets = await Promise.all(types.map((t) => dataset(t.slug)));
    const highRes = (await ongeo()).villages.find((v) => v.city_id === town.id) || null;
    render(mount, { town, types, sets, towns: payload.towns, highRes });
  } catch (err) {
    fill(mount, failure(err));
  }
}

function chooser(towns, wanted) {
  const list = towns.slice(0, 60);
  return el('div', {}, [
    el('h1', { text: 'Pick a village' }),
    wanted
      ? el('p', { class: 'error', text: `No town matches “${wanted}”.` })
      : el('p', {
          class: 'lede',
          text: 'This page shows one village at a time. The most documented are listed here.',
        }),
    el('div', { class: 'card', style: 'margin-top:16px' }, [
      el(
        'div',
        { class: 'chips' },
        list.map((t) =>
          el('a', {
            class: 'chip',
            href: url(`pages/village.html?v=${t.id}`),
            style: 'text-decoration:none',
            // The kinds of record that name the town, never a total of them.
            title: Object.keys(t.types).join(', '),
            text: t.name,
          })
        )
      ),
      el('p', { class: 'card-note' }, [
        el('a', { href: url('pages/villages.html'), text: `The full register of ${towns.length} towns →` }),
      ]),
    ]),
  ]);
}

/** The filter that picks one town's cells: its name, and its district where
 * the type's data knows that district, so a namesake elsewhere stays out. */
function townFilter(ds, town) {
  const filters = { town: [town.name] };
  if (town.district && (ds.dict.district || []).includes(town.district)) filters.district = [town.district];
  return filters;
}

function render(mount, { town, types, sets, towns, highRes }) {
  /* ------------------------------------------------------------- header */

  const neighbours = towns
    .filter((t) => t.district === town.district && t.id !== town.id)
    .slice(0, 8);

  const head = el('div', {}, [
    el('p', { style: 'margin:0 0 2px' }, [
      el('a', { href: url('pages/villages.html'), style: 'font-size:.84rem', text: '‹ All villages' }),
    ]),
    el('h1', {}, [
      town.name,
      town.name_ar
        ? el('span', {
            style: 'color:var(--ink-3);font-weight:500;margin-inline-start:12px',
            text: town.name_ar,
          })
        : null,
    ]),
    el('p', {
      class: 'lede',
      text:
        `${town.district || 'District not recorded'}, ${town.governorate || ''}` +
        (town.population ? ` · population ${fmt(town.population)} (CAS)` : '') +
        // Months, not days: the published figures hold no single record's date.
        (town.first
          ? town.first.slice(0, 7) === town.last.slice(0, 7)
            ? ` · records in ${monthLabel(town.first.slice(0, 7))}`
            : ` · records from ${monthLabel(town.first.slice(0, 7))} to ${monthLabel(town.last.slice(0, 7))}`
          : ''),
    }),
  ]);

  /* ------------------------------------------------------------- tiles */

  const tiles = types.map((type) => {
    const entry = town.types[type.code];
    const [a, b] = [entry.first.slice(0, 7), entry.last.slice(0, 7)];
    return stat({
      label: type.label,
      value: fmt(entry.n),
      sub:
        (entry.area_ha ? `${fmtArea(entry.area_ha)} ha · ` : '') +
        (a === b ? monthLabel(a) : `${monthLabel(a)} to ${monthLabel(b)}`),
    });
  });

  /* ------------------------------------------------------------- elements */

  const scrubHost = el('div', { class: 'card', style: 'margin-bottom:18px' });
  const lanesEl = el('div', { class: 'chart' });
  const mapEl = el('div', { class: 'map short' });
  const mapNote = el('p', { class: 'card-note' });
  const compareEl = el('div');
  const compareBar = el('div', { class: 'swipe-bar' });
  const compareNote = el('p', { class: 'card-note' });
  const kindsHost = el('div', { class: 'grid cols-2' });
  const lapseHost = el('section', { class: 'card' });

  const tileRow = el('div', { class: 'grid cols-4', style: 'margin:18px 0' }, tiles);

  mount.replaceChildren(
    head,
    scrubHost,
    tileRow,
    el('div', { class: 'section' }, [
      card({
        title: 'The ground, before and after',
        note: '',
        body: [compareEl, compareBar, compareNote],
      }),
    ]),
    el('div', { class: 'section' }, [lapseHost]),
    el('div', { class: 'section grid cols-2' }, [
      card({
        title: 'What is recorded here, month by month',
        note:
          'One lane per kind of record, each on its own scale. Counted apart, never added.',
        body: [lanesEl],
      }),
      card({
        title: 'This town and the towns round it',
        note: '',
        body: [mapEl, mapNote],
      }),
    ]),
    el('div', { class: 'section' }, [
      el('h2', { text: 'Each kind of record' }),
      kindsHost,
    ]),
    neighbours.length
      ? el('div', { class: 'section' }, [
          el('h3', { text: `Other towns in ${town.district}` }),
          el(
            'div',
            { class: 'chips' },
            neighbours.map((t) =>
              el('a', {
                class: 'chip',
                style: 'text-decoration:none',
                href: url(`pages/village.html?v=${t.id}`),
                text: t.name,
              })
            )
          ),
        ])
      : null,
    el('div', { class: 'section' }, [
      noteList([
        'The counts on this page are never added together. Each kind of record was ' +
          'collected over its own window from its own sources.',
        'The site publishes statistics, not records: each kind is counted here by month and ' +
          'by every documented column, and the map counts records by town.',
        'The before and after pictures are dated in their own labels. What they show is ' +
          'ground that changed between two pictures; it does not, by itself, show what ' +
          'caused the change.',
      ]),
      contactNote(),
    ])
  );

  /* ------------------------------------------------------------- lanes */

  const months = monthRange(town.first, town.last);
  const laneSeries = sets.map((ds, i) => {
    const sel = ds.select({ filters: townFilter(ds, town) });
    const counts = new Map(ds.series(sel, { grain: 'month' }).map((b) => [b.key, b.n]));
    return {
      code: types[i].code,
      label: types[i].label,
      total: ds.size(sel),
      counts: months.map((m) => counts.get(m) || 0),
      selection: sel,
      ds,
      slug: types[i].slug,
    };
  });
  const laneChart = lanes(lanesEl);
  laneChart.update(laneSeries, { months });

  /* ------------------------------------------------------------- map */

  const map = lebanonMap(mapEl, {
    bounds: [
      [town.box[1], town.box[0]],
      [town.box[3], town.box[2]],
    ],
  });
  map.setZoom(Math.min(map.getZoom(), 13));

  Promise.all([geo('lebanon'), geo('districts'), geo('villages')])
    .then(([lebanon, districts, villageGeo]) => {
      countryLayer(lebanon).addTo(map).bringToBack();
      adminLayer(districts).addTo(map);
      villageLayer(villageGeo).addTo(map);
      // The ground arrives after the circles: put the circles back on top, so
      // each still answers a hover with its town's count.
      for (const group of markLayers) group.eachLayer((m) => m.bringToFront && m.bringToFront());
    })
    .catch((err) => console.warn('base layers', err));

  /* Each kind in its own colour, one circle per town at the town's own point,
   * sized by the records that name it: this town and the towns round it. The
   * town kinds are counted above and in the lanes, not drawn: their rule is to
   * shade the town they name. */
  const drawnKinds = types.filter((t) => !TOWN_KINDS.has(t.code));
  const markLayers = [];
  let markLegend = null;

  function drawMarks(from = null, to = null) {
    for (const layer of markLayers) map.removeLayer(layer);
    markLayers.length = 0;
    for (const type of drawnKinds) {
      const ds = sets[types.indexOf(type)];
      const sel = ds.select({
        from: from ? isoToDay(ds.epoch, from) : null,
        to: to ? isoToDay(ds.epoch, to) : null,
      });
      markLayers.push(townLayer(ds.towns(sel), { code: type.code }).addTo(map));
    }
    autoScale(map, markLayers);
    if (!markLegend && drawnKinds.length) {
      const keys = drawnKinds
        .map(
          (t) =>
            `<div class="key"><span class="swatch" style="border-radius:50%;` +
            `background:${typeColor(t.code)}"></span>${t.label}</div>`
        )
        .join('');
      // Kept short: the map is small, and the card's note says the rest.
      markLegend = legend(
        `<b>Records per town</b>${keys}<div style="margin-top:5px;font-size:.7rem;opacity:.8">` +
          'One circle per town and kind. Area grows with the count.</div>'
      ).addTo(map);
    }
  }

  const townKinds = types.filter((t) => TOWN_KINDS.has(t.code)).map((t) => t.label.toLowerCase());
  function noteMap() {
    mapNote.textContent =
      (drawnKinds.length
        ? 'Each circle is a town, at the town’s own point, one colour per kind of record, its ' +
          'area growing with the records that name the town. The map counts by town and ' +
          'places no single event. '
        : 'No kind of record held here is drawn as circles. ') +
      (townKinds.length
        ? `${capitalise(townKinds.join(' and '))} are about the whole town, so they are ` +
          'counted above and in the lanes rather than drawn.'
        : '');
  }
  drawMarks();
  noteMap();

  /* ------------------------------------------------------------- kinds */

  function drawKinds(from = null, to = null) {
    fill(
      kindsHost,
      ...laneSeries.map((s) => {
        const ds = s.ds;
        const sel = ds.select({
          filters: townFilter(ds, town),
          from: from ? isoToDay(ds.epoch, from) : null,
          to: to ? isoToDay(ds.epoch, to) : null,
        });
        return kindCard(s, ds, sel, town);
      })
    );
  }
  drawKinds();

  /* The scrubber here re-counts the town's own tiles, its lanes, its cards and
   * the map, so playing it shows the order things happened in this village:
   * the orders, then the fires. */
  if (months.length > 1) {
    scrubber(
      scrubHost,
      months,
      (from, to) => {
        const counted = laneSeries.map((s) => {
          const sel = s.ds.select({
            filters: townFilter(s.ds, town),
            from: isoToDay(s.ds.epoch, from),
            to: isoToDay(s.ds.epoch, to),
          });
          const series = s.ds.series(sel, { grain: 'month' });
          const byMonth = new Map(series.map((b) => [b.key, b.n]));
          const held = series.filter((b) => b.n > 0).map((b) => b.key);
          const ha = s.ds.at.area_ha != null ? s.ds.sum(sel, 'area_ha').total : 0;
          return {
            ...s,
            total: s.ds.size(sel),
            counts: months.map((m) => byMonth.get(m) || 0),
            span: held.length
              ? held.length === 1
                ? monthLabel(held[0])
                : `${monthLabel(held[0])} to ${monthLabel(held[held.length - 1])}`
              : '',
            ha,
          };
        });
        laneChart.update(counted, { months });
        fill(
          tileRow,
          ...counted.map((s, i) =>
            stat({
              label: types[i].label,
              value: fmt(s.total),
              sub: s.total
                ? (s.ha ? `${fmtArea(s.ha)} ha · ` : '') + s.span
                : 'nothing recorded in this period',
            })
          )
        );
        drawKinds(from, to);
        drawMarks(from, to);
      },
      { label: 'records' }
    );
  } else {
    scrubHost.remove();
  }

  /* ------------------------------------------------------------- imagery */

  buildCompare({ town, compareEl, compareBar, compareNote, highRes });
  buildTimelapse({ town, host: lapseHost });
}

/* ------------------------------------------------------------------ kinds */

/**
 * One kind of record at this town: how many, over which months, how much of
 * its measure, and how its records split by every documented column. All of
 * it counts; none of it is a record.
 */
function kindCard(s, ds, sel, town) {
  const n = ds.size(sel);
  const months = ds.series(sel, { grain: 'month' }).filter((b) => b.n > 0);
  const span = months.length
    ? months.length === 1
      ? `in ${monthLabel(months[0].key)}`
      : `from ${monthLabel(months[0].key)} to ${monthLabel(months[months.length - 1].key)}, ` +
        `in ${fmt(months.length)} months`
    : 'nothing in this period';

  const lines = [
    n
      ? el('p', { class: 'kind-total' }, [el('b', { text: countLabel(s.code, n) }), el('span', { text: ` ${span}` })])
      : el('p', { class: 'kind-total', text: `No ${kindNoun(s.code, 2)} recorded in this period.` }),
  ];

  for (const m of ds.measures) {
    const { total, records } = ds.sum(sel, m.k);
    if (!records) continue;
    lines.push(
      el('p', {
        class: 'kind-measure',
        text:
          `${m.label}: ${fmtMeasure(total, m.unit)}${m.unit === 'ha' ? ' ha' : ''}, ` +
          (records === n ? 'from every record' : `from ${fmt(records)} of the ${fmt(n)} records`),
      })
    );
  }

  const breakdowns = ds.dims
    .filter((d) => !PLACE_DIMS.has(d.k))
    .map((d) => {
      const groups = ds.group(sel, d.k, { limit: 6 });
      if (!groups.length) return null;
      return el('div', { class: 'kind-dim' }, [el('h4', { text: d.label }), miniBars(groups, n)]);
    })
    .filter(Boolean);

  return card({
    title: s.label,
    aside: el('a', {
      href: url(`pages/${s.slug}.html`),
      style: 'font-size:.82rem',
      text: 'Open the type →',
    }),
    body: [...lines, n ? el('div', { class: 'kind-dims' }, breakdowns) : null],
    note: n
      ? 'Counts by documented column, over the period chosen. Each split adds up to the count above.'
      : '',
  });
}

/** A short ranked list with a bar under each value, for a card's breakdowns. */
function miniBars(groups, total) {
  const colors = colorsFor(groups);
  const peak = Math.max(1, ...groups.map((g) => g.n));
  return el(
    'ul',
    { class: 'mini-bars' },
    groups.map((g, i) =>
      el('li', {}, [
        el('span', { class: 'mb-label', text: g.label }),
        el('span', { class: 'mb-n', text: `${fmt(g.n)}${total ? ` · ${Math.round((100 * g.n) / total)}%` : ''}` }),
        el('span', { class: 'mb-track' }, [
          el('span', { class: 'mb-bar', style: `width:${(100 * g.n) / peak}%;background:${colors[i]}` }),
        ]),
      ])
    )
  );
}

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/* ------------------------------------------------------------------ imagery */

/* The before-and-after swipe, and the satellite time-lapse.
 *
 * Both are plain pictures. The swipe is two frames of the same ground cut to
 * the same pixels, so there is nothing to keep registered and nothing that can
 * silently fall back to older imagery. The time-lapse is one frame per clear
 * Sentinel-2 pass.
 *
 * A village may have one, both or neither, so each section only appears when
 * its pictures exist rather than leaving an empty box on the page.
 */
async function buildCompare({ town, compareEl, compareBar, compareNote, highRes }) {
  const pair = highRes && highRes.compare;
  if (!pair) {
    compareEl.replaceChildren(
      el('p', {
        class: 'loading',
        text:
          'No before-and-after pair has been built for this village yet. They are made ' +
          'from the high-resolution imagery the village damage reports were read on.',
      })
    );
    compareBar.remove();
    compareNote.remove();
    return;
  }

  const view = swipe(compareEl, { ...pair, town: town.name }, { base: ROOT });

  let sweeping = false;
  const sweepBtn = el('button', {
    class: 'btn',
    type: 'button',
    text: '▶  Sweep',
    onclick: () => {
      sweeping = !sweeping;
      sweepBtn.textContent = sweeping ? '■  Stop' : '▶  Sweep';
      if (sweeping) view.sweep();
      else view.stop();
    },
  });

  fill(
    compareBar,
    sweepBtn,
    el('button', {
      class: 'btn',
      type: 'button',
      text: 'Before only',
      onclick: () => {
        sweeping = false;
        sweepBtn.textContent = '▶  Sweep';
        view.stop();
        view.set(1);
      },
    }),
    el('button', {
      class: 'btn',
      type: 'button',
      text: 'After only',
      onclick: () => {
        sweeping = false;
        sweepBtn.textContent = '▶  Sweep';
        view.stop();
        view.set(0);
      },
    })
  );

  /* Say what to look at, and what to ignore.
   *
   * The two pictures were almost never flown in the same month, so one half is
   * routinely greener than the other. That is the season, and a reader who is
   * not told will read it as something the war did. Buildings and roads are
   * what carry the answer; `seasonal` marks the pairs where the colour
   * difference is strong enough that saying so once is not enough.
   */
  const season = pair.seasonal
    ? '<b>These two were flown in different seasons.</b> The difference in how green ' +
      'the ground is, is the time of year and not damage. '
    : '';

  compareNote.innerHTML =
    `About ${pair.ground_m} m of ground across, at roughly ` +
    `${(pair.ground_m / pair.size).toFixed(2)} m a pixel. Drag the handle, or use the arrow ` +
    'keys once it has focus. ' +
    `<b>${dateLabel(pair.before_label)}</b> is the day the archive release was published, ` +
    'which is on or after the day that picture was taken; ' +
    `<b>${dateLabel(pair.after_label)}</b> is the day the aerial picture was captured. ` +
    season +
    'Read the buildings and the roads: a roof that has become a grey scatter is the ' +
    'change this corpus records. What is visible here is the ground changing, which is ' +
    'not by itself a statement of what changed it. ' +
    '<span style="opacity:.8">Before: Esri, Maxar, Earthstar Geographics and the GIS User ' +
    'Community. After: aerial imagery read for the village damage report.</span>';
}

/** The satellite sequence, when one has been built for this town. */
async function buildTimelapse({ town, host }) {
  let index;
  try {
    index = await timelapseIndex();
  } catch {
    host.remove();
    return;
  }
  const entry = (index.towns || []).find((t) => t.city_id === town.id);
  if (!entry) {
    host.remove();
    return;
  }

  const base = new URL(`assets/timelapse/${entry.slug}/`, ROOT);
  let manifest;
  try {
    manifest = await fetch(new URL('frames.json', base)).then((r) => r.json());
  } catch {
    host.remove();
    return;
  }

  const player = el('div');
  fill(
    host,
    el('div', { class: 'card-head' }, [
      el('h3', { text: 'The same town, every clear pass' }),
      el('span', {
        style: 'font-size:.78rem;color:var(--ink-3)',
        text: `${entry.frames} passes, ${dateLabel(entry.first)} to ${dateLabel(entry.last)}`,
      }),
    ]),
    player
  );
  timelapse(player, manifest, { base, speed: 1000 });
}

function monthRange(first, last) {
  if (!first || !last) return [];
  const out = [];
  let [y, m] = first.split('-').map(Number);
  const [ly, lm] = last.split('-').map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}
