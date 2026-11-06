/* The embed runtime: one widget, in somebody else's page.
 *
 * An embed is a page in an iframe on greensoutherners.org, so it is built to
 * different rules from the rest of the site:
 *
 *   - **It tells the host how tall it is.** A cross-origin iframe cannot size
 *     itself, so the widget measures its own content and posts the height up;
 *     `embed/host.js` on the host page listens and resizes. Without that an
 *     article gets a fixed-height box with a scrollbar in the middle of it.
 *   - **Its background is transparent** so it sits on the host's own page
 *     rather than cutting a grey rectangle into the article.
 *   - **It carries a credit.** A chart that travels away from this site must
 *     still say where its numbers came from and when they were read, or it is
 *     not citable once somebody screenshots it.
 *   - **It never hijacks the page scroll.** The maps here only take the wheel
 *     after a click.
 *
 * Every widget is addressed entirely by query string, so an editor can write an
 * embed URL by hand and the builder at /embed/ is a convenience rather than a
 * requirement.
 *
 * Like every page here, a widget shows statistics and never a record (the data
 * owner, 2026-11-06): its maps count by town, village or district.
 */

import {
  dataset,
  dateLabel,
  fmt,
  fmtMeasure,
  geo,
  isoToDay,
  meta,
  summary,
  typeSummary,
  villages,
  ongeo,
  timelapseIndex,
  ROOT,
} from './data.js';
import { bars, calendar, donut, lanes, stacked, timeline } from './charts.js';
import {
  adminLayer,
  burnedLayer,
  choropleth,
  countryLayer,
  lebanonMap,
  legend,
  SOUTH,
  rampLegendHTML,
  sizeLegendHTML,
  townLayer,
  townPeak,
  TOWN_KINDS,
  villageLayer,
  autoScale,
} from './maps.js';
import { setTheme, typeRamp } from './theme.js';
import { swipe } from './compare.js';
import { defaultDim, explorer } from './explore.js';
import { timelapse } from './timelapse.js';
import { countLabel, el, failure, fill, kindNoun, params } from './ui.js';

const SITE = 'https://greensoutherners.github.io/south-ecocide-analytics/';

/* ------------------------------------------------------------------ height */

/**
 * Tell the host page how tall this widget is.
 *
 * Posted on load, on every resize of the content, and once more a beat later:
 * a chart that lays out asynchronously (ECharts measuring its own labels, a map
 * loading tiles) is routinely a different height one frame after it first
 * settles, and a stale height is a scrollbar inside the article.
 */
function reportHeight() {
  const send = () => {
    const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
    try {
      parent.postMessage({ type: 'gsa:height', height, id: location.href }, '*');
    } catch {
      /* not framed, or a host that does not listen: the widget still works */
    }
  };
  send();
  new ResizeObserver(send).observe(document.documentElement);
  window.addEventListener('load', send);
  setTimeout(send, 400);
  setTimeout(send, 1600);
  return send;
}

/* ------------------------------------------------------------------ frame */

function frame({ title, subtitle, body, credit, link }) {
  const root = el('div', { class: 'embed-root' }, [
    el('div', { class: 'embed-frame' }, [
      title ? el('p', { class: 'embed-title', text: title }) : null,
      subtitle ? el('p', { class: 'embed-sub', text: subtitle }) : null,
      ...[].concat(body),
      el('div', { class: 'embed-credit' }, [
        el('span', { html: credit }),
        el('a', { href: link || SITE, target: '_blank', rel: 'noopener', text: 'Explore the data →' }),
      ]),
    ]),
  ]);
  return root;
}

function creditLine(metaPayload) {
  const stamp = metaPayload ? metaPayload.generated_at.slice(0, 10) : '';
  return `Green Southerners &middot; South Lebanon OSINT corpus &middot; data of ${stamp}`;
}

/* ------------------------------------------------------------------ entry */

export async function embed(kind) {
  const query = params();
  const mount = document.getElementById('widget');

  document.body.classList.add('embed');
  if (query.bare === '1') document.body.classList.add('bare');
  if (query.theme === 'dark' || query.theme === 'light') setTheme(query.theme);

  const send = reportHeight();

  try {
    const metaPayload = await meta();
    const builders = { chart, map: mapWidget, stat: statWidget, compare, pair: pairWidget, lanes: lanesWidget, explore, lapse: lapseWidget };
    const build = builders[kind] || chart;
    await build({ mount, query, meta: metaPayload });
    send();
  } catch (err) {
    fill(mount, failure(err));
    send();
  }
}

/* ------------------------------------------------------------------ explore */

/** One type with its own controls: play head, filters, chart and map. */
async function explore({ mount, query, meta: metaPayload }) {
  const slug = query.type || 'fires';
  await explorer(mount, query, {
    credit: creditLine(metaPayload),
    link: `${SITE}pages/${slug}.html`,
  });
}

/* ------------------------------------------------------------------ chart */

/* The charts a widget can be. `calendar` is the week grid: the statistics are
 * counted by week, so the name stays for older embeds and the grid is weeks. */
const CHART_KINDS = {
  timeline: 'Records over time',
  calendar: 'Week by week',
  donut: 'Share',
  bars: 'Ranked',
  stacked: 'Over time, split',
  towns: 'Towns',
};

/** "3 Mar 2026 to 10 Oct 2026", from the query or the type's own window. */
function periodOf(query, info) {
  const range = info.date_range || [];
  return query.from || query.to
    ? `, ${dateLabel(query.from || range[0])} to ${dateLabel(query.to || range[1])}`
    : '';
}

async function chart({ mount, query, meta: metaPayload }) {
  const slug = query.type || 'fires';
  const [info, ds] = await Promise.all([typeSummary(slug), dataset(slug)]);
  const kind = CHART_KINDS[query.chart] ? query.chart : 'timeline';
  // A column an older embed names that the data no longer carries falls back
  // to the type's own default.
  const dim = query.dim && ds.at[query.dim] != null ? query.dim : defaultDim(ds);
  const measure = query.measure && ds.at[query.measure] != null ? query.measure : null;
  const unit = (ds.measures.find((m) => m.k === measure) || {}).unit || '';
  const height = Number(query.h) || defaultHeight(kind);

  const selection = ds.select({
    from: query.from ? isoToDay(ds.epoch, query.from) : null,
    to: query.to ? isoToDay(ds.epoch, query.to) : null,
  });

  const node = el('div', { class: 'chart', style: `height:${height}px` });
  const title = query.title || titleFor(info, kind, dim, ds);
  const subtitle = query.subtitle || `${fmt(ds.size(selection))} records${periodOf(query, info)}`;

  fill(
    mount,
    frame({
      title,
      subtitle,
      body: [node],
      credit: creditLine(metaPayload),
      link: `${SITE}pages/${slug}.html`,
    })
  );

  const options = { measure, unit, centreLabel: measure ? unit : 'records' };

  if (kind === 'timeline') {
    // Month or week: the statistics hold no finer grain.
    const grain = query.grain === 'week' ? 'week' : 'month';
    timeline(node).update(ds.series(selection, { grain, measure }), { ...options, grain });
  } else if (kind === 'calendar') {
    // On the published statistics a "day" bucket is a week, dated by its first day.
    calendar(node).update(ds.series(selection, { grain: 'day', measure }), options);
  } else if (kind === 'stacked') {
    stacked(node).update(ds.seriesBy(selection, dim, { grain: 'month', limit: 6 }));
  } else if (kind === 'towns') {
    bars(node, { labelKey: 'name' }).update(
      ds.towns(selection, { measure }).slice(0, Number(query.limit) || 12),
      options
    );
  } else {
    const groups = ds.group(selection, dim, { measure, limit: Number(query.limit) || 8 });
    (kind === 'bars' ? bars : donut)(node).update(groups, options);
  }
}

function defaultHeight(kind) {
  if (kind === 'calendar') return 320;
  if (kind === 'bars' || kind === 'towns') return 360;
  return 300;
}

function titleFor(info, kind, dim, ds) {
  if (kind === 'timeline') return `${info.label} over time`;
  if (kind === 'calendar') return `${info.label}, week by week`;
  if (kind === 'towns') return `${info.label} by town`;
  if (kind === 'stacked') return `${info.label} by ${ds.dimLabel(dim).toLowerCase()}, month by month`;
  return `${info.label} by ${ds.dimLabel(dim).toLowerCase()}`;
}

/* ------------------------------------------------------------------ map */

async function mapWidget({ mount, query, meta: metaPayload }) {
  const slug = query.type || 'fires';
  const [info, ds] = await Promise.all([typeSummary(slug), dataset(slug)]);
  const height = Number(query.h) || 460;
  // Displacement orders open on the municipalities they name, shaded; every
  // other type on its towns, one circle each. An older embed's points read as
  // towns: the site holds no single record to draw.
  const asked = query.mode === 'points' ? 'towns' : query.mode;
  const mode = ['towns', 'villages', 'districts'].includes(asked)
    ? asked
    : TOWN_KINDS.has(ds.code)
      ? 'villages'
      : 'towns';
  const layers = (query.layers || '').split(',').filter(Boolean);

  const node = el('div', { class: 'map', style: `height:${height}px` });
  const selection = ds.select({
    from: query.from ? isoToDay(ds.epoch, query.from) : null,
    to: query.to ? isoToDay(ds.epoch, query.to) : null,
  });
  const n = ds.size(selection);
  const townCount = ds.towns(selection).filter((t) => t.name !== 'No town recorded').length;

  fill(
    mount,
    frame({
      title: query.title || `${info.label}, mapped`,
      subtitle:
        query.subtitle ||
        `${fmt(n)} records in ${fmt(townCount)} town${townCount === 1 ? '' : 's'}${periodOf(query, info)}`,
      body: [node],
      credit: creditLine(metaPayload),
      link: `${SITE}pages/${slug}.html`,
    })
  );

  const map = lebanonMap(node, { bounds: SOUTH, basemap: query.basemap || 'none' });

  const districts = await geo('districts');
  if (mode !== 'villages') {
    // Municipalities are their own land; anything drawn under them shows a
    // second coastline a few hundred metres away.
    const lebanon = await geo('lebanon');
    countryLayer(lebanon).addTo(map).bringToBack();
    adminLayer(districts).addTo(map);
  }

  if (layers.includes('villages')) villageLayer(await geo('villages')).addTo(map);
  // Burned ground is merged by month, so it follows the dates and nothing else.
  if (layers.includes('scars')) {
    burnedLayer(await geo('burned'), { from: query.from || null, to: query.to || null }).addTo(map);
  }

  if (mode === 'districts' || mode === 'villages') {
    const column = mode === 'villages' ? 'municipality' : 'adm2';
    const shapes = mode === 'villages' ? await geo('municipalities') : districts;
    const groups = ds.group(selection, column);
    const counts = {};
    for (const g of groups) {
      if (g.key === '__none__' || g.key === '__other__') continue;
      counts[g.key] = g.n;
    }
    // One kind of record, so its own colour, from a wash to the full hue.
    const ramp = typeRamp(ds.code);
    const layer = choropleth(shapes, counts, {
      key: 'pcod',
      unit: 'records',
      land: true,
      ramp,
      format: (v) => countLabel(ds.code, v),
    }).addTo(map);
    if (layer.__shadedBounds) map.setBoundsAndRefit(layer.__shadedBounds);
    if (query.legend !== '0') legend(rampLegendHTML(layer.__peak, 'Records', null, ramp)).addTo(map);
  } else {
    const layer = townLayer(ds.towns(selection), { code: ds.code }).addTo(map);
    autoScale(map, [layer]);
    if (query.legend !== '0') {
      const peak = townPeak(ds);
      const label = kindNoun(ds.code, 2);
      legend(
        sizeLegendHTML({ code: ds.code, title: `${label.charAt(0).toUpperCase()}${label.slice(1)} per town`, peak })
      ).addTo(map);
    }
  }
}

/* ------------------------------------------------------------------ stat */

/**
 * A headline figure.
 *
 * A stat tile, not a one-bar bar chart: when the story is one number, the
 * number is the chart. The denominator goes underneath, because a measure that
 * only part of the corpus carries will otherwise be read as covering all of it.
 */
async function statWidget({ mount, query, meta: metaPayload }) {
  const slug = query.type || 'fires';
  const [info, ds] = await Promise.all([typeSummary(slug), dataset(slug)]);
  const selection = ds.select({
    from: query.from ? isoToDay(ds.epoch, query.from) : null,
    to: query.to ? isoToDay(ds.epoch, query.to) : null,
  });

  // "placed" counted the records that carried a coordinate. The site holds
  // none now, so an older embed that asks for it is shown its towns instead.
  const wanted = [
    ...new Set((query.stat || 'records').split(',').map((k) => (k === 'placed' ? 'towns' : k))),
  ];
  const n = ds.size(selection);
  const tiles = [];

  for (const key of wanted) {
    if (key === 'records') {
      tiles.push(
        tile(
          query.label || 'Records',
          fmt(n),
          '',
          `${info.label}${query.from ? `, from ${dateLabel(query.from)}` : ''}`
        )
      );
    } else if (key === 'towns') {
      const towns = ds.towns(selection).filter((t) => t.name !== 'No town recorded');
      tiles.push(tile('Towns affected', fmt(towns.length), '', `with at least one ${info.label.toLowerCase()} record`));
    } else {
      const measure = ds.measures.find((m) => m.k === key);
      if (!measure) continue;
      const { total, records, coverage } = ds.sum(selection, key);
      tiles.push(
        tile(
          measure.label,
          fmtMeasure(total, measure.unit),
          measure.unit === 'ha' ? ' ha' : '',
          coverage < 0.999
            ? `from ${fmt(records)} of ${fmt(n)} records (${Math.round(coverage * 100)}%)`
            : `from all ${fmt(records)} records`
        )
      );
    }
  }

  fill(
    mount,
    frame({
      title: query.title || null,
      subtitle: query.subtitle || null,
      body: [el('div', { class: tiles.length > 1 ? 'grid cols-3' : 'grid' }, tiles)],
      credit: creditLine(metaPayload),
      link: `${SITE}pages/${slug}.html`,
    })
  );
}

function tile(label, value, unit, sub) {
  return el('div', { class: 'stat', style: 'border:0;padding:4px 0' }, [
    el('span', { class: 'label', text: label }),
    el('span', { class: 'value', html: `${value}${unit ? `<span class="unit">${unit}</span>` : ''}` }),
    el('span', { class: 'sub', text: sub }),
  ]);
}

/* ------------------------------------------------------------------ lanes */

async function lanesWidget({ mount, query, meta: metaPayload }) {
  const summaryPayload = await summary();
  const types = summaryPayload.types.filter((t) => t.total > 0 && !t.frozen);
  const sets = await Promise.all(types.map((t) => dataset(t.slug)));

  const months = monthRange(
    types.map((t) => t.date_range[0]).filter(Boolean).sort()[0],
    types.map((t) => t.date_range[1]).filter(Boolean).sort().reverse()[0]
  );
  const series = sets.map((ds, i) => {
    const counts = new Map(ds.series(ds.all, { grain: 'month' }).map((b) => [b.key, b.n]));
    return {
      code: types[i].code,
      label: types[i].label,
      total: ds.size(ds.all),
      counts: months.map((m) => counts.get(m) || 0),
    };
  });

  const node = el('div', { class: 'chart', style: `height:${Number(query.h) || 340}px` });
  fill(
    mount,
    frame({
      title: query.title || 'Every kind of record, month by month',
      subtitle: query.subtitle || 'Each lane has its own scale. The counts are never added together.',
      body: [node],
      credit: creditLine(metaPayload),
      link: `${SITE}pages/timeline.html`,
    })
  );
  lanes(node).update(series, { months });
}

/* ------------------------------------------------------------------ lapse */

/**
 * One town, every clear Sentinel-2 pass, as a player.
 *
 * The frames are flat pictures in this repository, built from the imagery
 * runs, so the widget needs no outside service. The gaps between dates are
 * cloud, not quiet, and the player's own note says so.
 */
async function lapseWidget({ mount, query, meta: metaPayload }) {
  const payload = await villages();
  const town =
    payload.towns.find((t) => String(t.id) === String(query.v)) ||
    payload.towns.find((t) => (t.name || '').toLowerCase() === String(query.v || '').toLowerCase());
  const index = await timelapseIndex().catch(() => ({ towns: [] }));
  const entry = town && (index.towns || []).find((t) => t.city_id === town.id);

  if (!entry) {
    fill(
      mount,
      el('div', { class: 'error' }, [
        el('b', { text: `No time-lapse for ${town ? town.name : `"${query.v || ''}"`}. ` }),
        'Sequences are built for a set of towns, from Sentinel-2 imagery.',
      ])
    );
    return;
  }

  const base = new URL(`assets/timelapse/${entry.slug}/`, ROOT);
  const manifest = await fetch(new URL('frames.json', base)).then((r) => r.json());
  const host = el('div');
  fill(
    mount,
    frame({
      title: query.title || `${town.name}, every clear pass`,
      subtitle:
        query.subtitle ||
        `${entry.frames} Sentinel-2 passes, ${dateLabel(entry.first)} to ${dateLabel(entry.last)}`,
      body: [host],
      credit: creditLine(metaPayload),
      link: `${SITE}pages/village.html?v=${town.id}`,
    })
  );
  timelapse(host, manifest, {
    base,
    speed: Number(query.speed) || 1000,
    autoplay: query.autoplay === '1',
  });
}

/* ------------------------------------------------------------------ compare */

async function compare({ mount, query, meta: metaPayload }) {
  const payload = await villages();
  const town =
    payload.towns.find((t) => String(t.id) === String(query.v)) ||
    payload.towns.find((t) => (t.name || '').toLowerCase() === String(query.v || '').toLowerCase());

  if (!town) {
    fill(mount, el('div', { class: 'error', text: `No town matches "${query.v || ''}".` }));
    return;
  }

  const pictures = await ongeo();
  const entry = (pictures.villages || []).find((v) => v.city_id === town.id);
  const pair = entry && entry.compare;

  if (!pair) {
    fill(
      mount,
      el('div', { class: 'error' }, [
        el('b', { text: `No before and after pair for ${town.name}. ` }),
        'They are built from the high-resolution imagery the village damage reports were ' +
          'read on, which covers part of the corpus.',
      ])
    );
    return;
  }

  const host = el('div');
  const season = pair.seasonal
    ? ' The two were flown in different seasons, so the difference in how green the ' +
      'ground is, is the time of year and not damage: read the buildings.'
    : '';

  fill(
    mount,
    frame({
      title: query.title || `${town.name}, before and after`,
      subtitle:
        query.subtitle ||
        `${dateLabel(pair.before_label)} and ${dateLabel(pair.after_label)}, ` +
          `about ${pair.ground_m} m across`,
      body: [
        host,
        el('p', {
          class: 'card-note',
          style: 'margin-top:8px',
          text:
            'Drag the handle. The earlier date is when the archive release was published, ' +
            'on or after the day that picture was taken; the later one is when the aerial ' +
            `picture was captured.${season}`,
        }),
      ],
      credit: creditLine(metaPayload),
      link: `${SITE}pages/village.html?v=${town.id}`,
    })
  );

  const view = swipe(host, { ...pair, town: town.name }, { base: ROOT });
  if (query.sweep === '1') view.sweep();
}

/* ------------------------------------------------------------------ pair */

/**
 * Two pictures of one place that is not a village of the gazetteer (a castle, a
 * river bend), cut to one frame for a post. The pair is a small JSON file under
 * `assets/posts/`, written with the pictures, which names both dates and both
 * sources; only files there are read.
 */
async function pairWidget({ mount, query, meta: metaPayload }) {
  const src = String(query.src || '');
  if (!/^assets\/posts\/[a-z0-9/_-]+\.json$/.test(src)) {
    fill(mount, el('div', { class: 'error', text: 'No picture pair named.' }));
    return;
  }
  const pair = await fetch(new URL(src, ROOT)).then((r) => {
    if (!r.ok) throw new Error(`${src}: ${r.status}`);
    return r.json();
  });
  const host = el('div');
  fill(
    mount,
    frame({
      title: query.title || `${pair.town}, before and after`,
      subtitle:
        query.subtitle ||
        `${dateLabel(pair.before_label)} and ${dateLabel(pair.after_label)}, about ${pair.ground_m} m across`,
      body: [
        host,
        el('p', {
          class: 'card-note',
          style: 'margin-top:8px',
          text: `Drag the handle. Earlier: ${pair.before_source}. Later: ${pair.after_source}.` + (pair.note ? ` ${pair.note}` : ''),
        }),
      ],
      credit: creditLine(metaPayload),
      link: pair.link || SITE,
    })
  );
  const view = swipe(host, pair, { base: ROOT });
  if (query.sweep === '1') view.sweep();
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
