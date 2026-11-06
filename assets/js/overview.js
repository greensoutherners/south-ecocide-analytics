/* The overview: every type the corpus publishes, counted apart.
 *
 * The hardest thing about this page is what it must not do. The obvious
 * dashboard would open with one big number ("4,000 incidents
 * documented"), and it would be false. The corpus does not collect every kind of attack: it
 * collects six kinds, each with its own window, its own sources and its own
 * bar for what counts as a record. Adding them would publish a completeness
 * nobody here can stand behind, and whoever quoted the total would be quoting
 * an artefact of what we happen to have looked for.
 *
 * So the page is a row of cards, one per type, each with its own count, its own
 * window and its own sparkline, and a lane chart that shows them sharing a time
 * axis without ever sharing a bar. The only figures that cross types are the
 * two that genuinely can: how many towns are affected, and over what period.
 */

import { dataset, fmt, fmtMeasure, dateLabel, meta, summary, villages } from './data.js';
import { lanes, spark } from './charts.js';
import {
  card,
  chrome,
  contactNote,
  el,
  failure,
  fill,
  loading,
  noteList,
  stat,
  table,
  url,
} from './ui.js';

export async function overviewPage() {
  const mount = document.getElementById('page');
  mount.append(loading());

  try {
    const [metaPayload, summaryPayload, villagePayload] = await Promise.all([
      meta(),
      summary(),
      villages(),
    ]);
    await chrome('overview', Promise.resolve(metaPayload));
    render(mount, { meta: metaPayload, summary: summaryPayload, villages: villagePayload });
  } catch (err) {
    fill(mount, failure(err));
  }
}

function render(mount, { summary: payload, villages: villagePayload }) {
  const types = payload.types.filter((t) => t.total > 0);
  const live = types.filter((t) => !t.frozen);

  /* The two figures that may legitimately cross types. A town is a town
   * whichever record names it, and the window is the window. */
  const towns = villagePayload.towns.length;
  const first = live.map((t) => t.date_range[0]).filter(Boolean).sort()[0];
  const last = live
    .map((t) => t.date_range[1])
    .filter(Boolean)
    .sort()
    .reverse()[0];

  const head = el('div', {}, [
    el('h1', { text: 'What the corpus holds' }),
    el('p', {
      class: 'lede',
      text:
        `The corpus holds ${fmt(types.length)} kinds of record, collected from satellites, ` +
        'social media, the Lebanese press and official statements. They are counted apart, ' +
        'and on this site they are never added together.',
    }),
  ]);

  const topStats = el('div', { class: 'grid cols-3', style: 'margin:20px 0 10px' }, [
    stat({
      label: 'Towns and villages with a record',
      value: fmt(towns),
      sub: 'across every type, counted once each',
    }),
    stat({
      label: 'Period covered',
      value: first ? first.slice(0, 4) : 'n/a',
      sub: first ? `${dateLabel(first)} to ${dateLabel(last)}` : 'no dated records',
    }),
    stat({
      label: 'Kinds of record',
      value: String(types.length),
      sub: 'each with its own window, its own sources and its own bar for a record',
    }),
  ]);

  const grid = el('div', { class: 'grid cols-3', style: 'margin-top:4px' });
  for (const type of types) grid.append(typeCard(type));

  const lanesEl = el('div', { class: 'chart' });
  const measuresEl = el('div', { class: 'grid cols-3' });

  mount.replaceChildren(
    head,
    topStats,
    el('div', { class: 'section' }, [
      el('h2', { text: 'Each kind of record' }),
      grid,
    ]),
    el('div', { class: 'section' }, [
      el('h2', { text: 'Side by side, never stacked' }),
      card({
        note:
          'One lane per type, sharing a time axis. Each lane has its own scale, so a type ' +
          'with three records a month is as legible as one with forty, and nothing about ' +
          'the drawing invites adding them. Hover to read a month across every lane.',
        body: [lanesEl],
      }),
    ]),
    el('div', { class: 'section' }, [
      el('h2', { text: 'The measures that do add up' }),
      el('p', {
        class: 'lede',
        style: 'margin-bottom:14px',
        text:
          'Hectares of ground add up; counts of records do not become counts of events. ' +
          'These are the only columns the corpus declares additive, each with the share ' +
          'of its records that carry a figure at all.',
      }),
      measuresEl,
    ]),
    el('div', { class: 'section' }, [
      el('h2', { text: 'The corpus at a glance' }),
      card({ body: [summaryTable(types)] }),
    ]),
    el('div', { class: 'section' }, [
      noteList([
        'No figure on this site is added across incident types. The corpus does not ' +
          'collect every kind of attack, so a combined total would state a completeness ' +
          'it cannot claim.',
        'A count of records is not a count of events. One fire may be recorded once from ' +
          'a satellite and once from a report, and the corpus folds those together when it ' +
          'can prove they are the same fire, but a record is still a record, not an event.',
        'Fires are counted here only where the corpus links them to an Israeli military ' +
          'attack (an attack documented at the same town on a day of the fire, or a source ' +
          'that names the attack), or where they burned in the yellow-line zone or round ' +
          'Beaufort Castle, whatever lit them.',
        'The site publishes statistics, not records: every figure is a count of records by ' +
          'week, by town or by a documented column, and the maps count records by town, at ' +
          'the town’s own point. No map here places a single event.',
      ]),
      contactNote(),
    ])
  );

  /* ------------------------------------------------------------- lanes */

  Promise.all(live.map((t) => dataset(t.slug)))
    .then((sets) => {
      const months = monthRange(first, last);
      const series = sets.map((ds, i) => {
        const counts = new Map(ds.series(ds.all, { grain: 'month' }).map((b) => [b.key, b.n]));
        return {
          code: live[i].code,
          label: live[i].label,
          total: ds.size(ds.all),
          counts: months.map((m) => counts.get(m) || 0),
        };
      });
      lanes(lanesEl).update(series, { months });
    })
    .catch((err) => {
      lanesEl.replaceChildren(failure(err));
    });

  /* ------------------------------------------------------------- measures */

  const tiles = [];
  for (const type of types) {
    for (const m of type.measures) {
      if (m.total == null || m.total === 0) continue;
      tiles.push(
        stat({
          label: `${m.label}, ${type.label}`,
          value: fmtMeasure(m.total, m.unit),
          unit: m.unit === 'ha' ? ' ha' : '',
          sub:
            m.coverage != null && m.coverage < 0.999
              ? `from ${fmt(m.records)} of ${fmt(type.total)} records (${Math.round(m.coverage * 100)}%)`
              : `from all ${fmt(m.records)} records`,
        })
      );
    }
  }
  fill(measuresEl, ...tiles);
}

/* ------------------------------------------------------------------ pieces */

function typeCard(type) {
  const node = el('a', { class: 'type-card', href: url(`pages/${type.slug}.html`) }, [
    el('span', { class: 'code' }, [
      type.code,
      type.frozen ? el('span', { class: 'badge frozen', style: 'margin-inline-start:6px', text: 'frozen' }) : null,
    ]),
    el('h3', { text: type.label }),
    el('span', { class: 'big' }, [
      fmt(type.total),
      el('small', { text: ' records' }),
    ]),
    el('span', {
      class: 'span',
      text: type.date_range[0]
        ? `${dateLabel(type.date_range[0])} to ${dateLabel(type.date_range[1])}`
        : 'no dated records',
    }),
  ]);

  const sparkEl = el('div', { class: 'spark' });
  node.append(sparkEl);

  const bits = [];
  if (type.towns) bits.push(`${fmt(type.towns)} towns`);
  for (const m of type.measures) {
    if (m.total) bits.push(`${fmtMeasure(m.total, m.unit)} ${m.unit === 'ha' ? 'ha' : m.label.toLowerCase()}`);
  }
  node.append(el('span', { class: 'more', text: bits.join(' · ') || 'Open' }));

  dataset(type.slug)
    .then((ds) => spark(sparkEl).update(ds.series(ds.all, { grain: 'month' })))
    .catch(() => sparkEl.remove());

  return node;
}

function summaryTable(types) {
  const rows = types.map((t) =>
    el('tr', {}, [
      el('td', {}, [
        el('a', { href: url(`pages/${t.slug}.html`), text: t.label }),
        t.frozen ? el('span', { class: 'badge frozen', style: 'margin-inline-start:6px', text: 'frozen' }) : null,
      ]),
      el('td', { text: t.code }),
      el('td', { class: 'num', text: fmt(t.total) }),
      el('td', { class: 'num', text: fmt(t.towns) }),
      el('td', { class: 'num', text: fmt(t.districts) }),
      el('td', { text: t.date_range[0] ? `${t.date_range[0]} to ${t.date_range[1]}` : 'n/a' }),
      el('td', {
        text:
          t.measures
            .filter((m) => m.total)
            .map((m) => `${fmtMeasure(m.total, m.unit)} ${m.unit === 'ha' ? 'ha' : ''}`.trim())
            .join(', ') || 'n/a',
      }),
    ])
  );

  return el('div', {}, [
    table(
      [
        'Type',
        'Code',
        { label: 'Records', num: true },
        { label: 'Towns', num: true },
        { label: 'Districts', num: true },
        'Period',
        'Declared measures',
      ],
      rows
    ),
    el('p', {
      class: 'card-note',
      text:
        'There is no total row, and that is deliberate: see the note at the foot of this page.',
    }),
  ]);
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
