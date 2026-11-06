/* The war on one time axis.
 *
 * Every type gets a lane. Lanes rather than a stack, for the reason the
 * overview page gives at length: these counts may share an axis but they may
 * not share a bar.
 *
 * The page adds one thing the lane chart cannot: a cursor. Pick a month and the
 * panel underneath reads out what the corpus holds for that month, per type,
 * with the towns that carry it. That is the question a timeline actually gets
 * asked ("what was happening in July 2026?"), and it is answerable from the
 * counts already in the page: records by week and town, never a record.
 */

import { dataset, dateLabel, fmt, fmtMeasure, meta, monthLabel, summary } from './data.js';
import { lanes, timeline } from './charts.js';
import { scrubber } from './scrubber.js';
import {
  card,
  chrome,
  el,
  failure,
  fill,
  loading,
  noteList,
  params,
  syncURL,
  table,
  url,
} from './ui.js';

export async function timelinePage() {
  const mount = document.getElementById('page');
  mount.append(loading());

  try {
    const [metaPayload, summaryPayload] = await Promise.all([meta(), summary()]);
    await chrome('timeline', Promise.resolve(metaPayload));
    const types = summaryPayload.types.filter((t) => t.total > 0 && !t.frozen);
    const sets = await Promise.all(types.map((t) => dataset(t.slug)));
    render(mount, { types, sets, warStart: summaryPayload.published_from || summaryPayload.war_start });
  } catch (err) {
    fill(mount, failure(err));
  }
}

function render(mount, { types, sets, warStart }) {
  const query = params();

  const months = monthRange(
    types.map((t) => t.date_range[0]).filter(Boolean).sort()[0],
    types.map((t) => t.date_range[1]).filter(Boolean).sort().reverse()[0]
  );

  const state = {
    month: query.month && months.includes(query.month) ? query.month : months[months.length - 1],
    grain: query.grain || 'month',
  };

  const series = sets.map((ds, i) => {
    const counts = new Map(ds.series(ds.all, { grain: 'month' }).map((b) => [b.key, b.n]));
    return {
      code: types[i].code,
      slug: types[i].slug,
      label: types[i].label,
      ds,
      total: ds.size(ds.all),
      counts: months.map((m) => counts.get(m) || 0),
    };
  });

  const lanesEl = el('div', { class: 'chart' });
  const monthPanel = el('div');
  const pickerHost = el('div', { class: 'card', style: 'margin-bottom:16px' });
  let scrub = null;

  mount.replaceChildren(
    el('div', {}, [
      el('h1', { text: 'Timeline' }),
      el('p', {
        class: 'lede',
        text:
          'Every kind of record the corpus holds, month by month, on one axis and in ' +
          'separate lanes. The war opens on ' +
          dateLabel(warStart) +
          '. Each lane carries its own scale; the counts are never added together.',
      }),
    ]),
    el('div', { class: 'section' }, [
      card({
        title: 'All types, month by month',
        note:
          'Click a month in any lane to read it out below. Each lane is scaled to its own ' +
          'peak, which is why a quiet type is still legible, and why two lanes of the same ' +
          'height do not mean the same number.',
        body: [lanesEl],
      }),
    ]),
    el('div', { class: 'section' }, [
      el('h2', { text: 'One month, read across' }),
      pickerHost,
      monthPanel,
    ]),
    el('div', { class: 'section' }, [
      el('h2', { text: 'Each type on its own' }),
      el('div', { class: 'grid cols-2' }, series.map(perType)),
    ]),
    el('div', { class: 'section' }, [
      noteList([
        'The lanes share a time axis and nothing else. A tall bar in one lane and a tall ' +
          'bar in another are different measurements of different things.',
        'A month with no bar is a month with no record of that kind. For most types that ' +
          'means nothing was collected, which is not the same as nothing happening.',
        'Each kind was collected over its own window and from its own sources, so a ' +
          'difference between two lanes can be a difference in collection, not in events.',
      ]),
    ])
  );

  const laneChart = lanes(lanesEl);
  laneChart.update(series, { months });
  laneChart.chart.on('click', (e) => {
    if (e.dataIndex != null && months[e.dataIndex] && scrub) scrub.goTo(months[e.dataIndex]);
  });

  /* The cursor is the scrubber, not a dropdown.
   *
   * A month picker answers "what happened in July 2026". Pressing play answers
   * the question this page is really for, which is what the three years looked
   * like as they happened: which types start when, and which months carry the
   * weight. */
  function drawPicker() {
    scrub = scrubber(
      pickerHost,
      months,
      (_from, _to, cursor) => {
        state.month = cursor.month;
        drawMonth();
      },
      { label: 'records' }
    );
  }

  function drawMonth() {
    syncURL({ month: state.month }, ['month']);
    const cards = [];

    for (const s of series) {
      const from = isoDay(s.ds, `${state.month}-01`);
      const to = isoDay(s.ds, lastDayOf(state.month));
      const selection = s.ds.select({ from, to });
      const n = s.ds.size(selection);
      if (!n) continue;

      const towns = s.ds.towns(selection).slice(0, 6);
      const measureBits = [];
      for (const m of s.ds.measures) {
        const { total, records } = s.ds.sum(selection, m.k);
        if (total) {
          measureBits.push(
            `${fmtMeasure(total, m.unit)} ${m.unit === 'ha' ? 'ha' : ''} ${m.label.toLowerCase()}`.replace(
              /\s+/g,
              ' '
            ) + ` (${fmt(records)} records)`
          );
        }
      }

      cards.push(
        card({
          title: s.label,
          aside: el('span', {
            style: 'font-size:1.3rem;font-weight:650;letter-spacing:-.02em',
            text: fmt(n),
          }),
          body: [
            el('p', {
              style: 'font-size:.85rem;color:var(--ink-2);margin:2px 0 8px',
              text: measureBits.join(' · ') || `${fmt(n)} records this month`,
            }),
            table(
              ['Town', { label: 'Records', num: true }],
              towns.map((t) =>
                el('tr', {}, [
                  el('td', { class: 'name', text: t.name }),
                  el('td', { class: 'num', text: fmt(t.n) }),
                ])
              )
            ),
            el('p', { class: 'card-note' }, [
              el('a', {
                href: url(`pages/${s.slug}.html?from=${state.month}-01&to=${lastDayOf(state.month)}`),
                text: `Open ${s.label} for this month →`,
              }),
            ]),
          ],
        })
      );
    }

    fill(
      monthPanel,
      el('h3', { style: 'margin:4px 0 12px', text: monthLabel(state.month) }),
      cards.length
        ? el('div', { class: 'grid cols-3' }, cards)
        : el('p', { class: 'loading', text: 'No records of any type in this month.' })
    );
  }

  drawPicker();
}

/* ------------------------------------------------------------------ pieces */

function perType(s) {
  const chartEl = el('div', { class: 'chart short' });
  const node = card({
    title: s.label,
    note: `${fmt(s.total)} records in all. Drag under the bars to zoom this lane alone.`,
    body: [chartEl],
    aside: el('a', { href: url(`pages/${s.slug}.html`), style: 'font-size:.82rem', text: 'Open →' }),
  });
  requestAnimationFrame(() => {
    timeline(chartEl).update(s.ds.series(s.ds.all, { grain: 'month' }), { grain: 'month' });
  });
  return node;
}

function isoDay(ds, iso) {
  return Math.round(
    (Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${ds.epoch}T00:00:00Z`)) / 86400000
  );
}

function lastDayOf(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
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
