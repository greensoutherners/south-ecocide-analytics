/* The catalogue: the one page that is not meant to be embedded.
 *
 * Everything else here is built to travel: into an article, a post, a frame
 * on another site. This page is the index behind them: what exists, what each
 * page answers, and how fresh the numbers are. It is for the team, not for the
 * audience.
 *
 * The site publishes statistics, never records (the data owner, 2026-11-06),
 * so there are no record files to list: the page says where to ask instead.
 */

import { dateLabel, fmt, fmtMeasure, meta, summary, villages } from './data.js';
import { spark } from './charts.js';
import { dataset } from './data.js';
import { chrome, contactNote, el, failure, fill, loading, url } from './ui.js';

export async function cataloguePage() {
  const mount = document.getElementById('page');
  mount.append(loading());

  try {
    const [metaPayload, summaryPayload, villagePayload] = await Promise.all([
      meta(),
      summary(),
      villages(),
    ]);
    await chrome('catalogue', Promise.resolve(metaPayload));
    render(mount, { meta: metaPayload, summary: summaryPayload, villages: villagePayload });
  } catch (err) {
    fill(mount, failure(err));
  }
}

function render(mount, { meta: metaPayload, summary: summaryPayload, villages: villagePayload }) {
  const types = summaryPayload.types.filter((t) => t.total > 0);
  const stamp = new Date(metaPayload.generated_at).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  });

  mount.replaceChildren(
    el('div', { style: 'max-width:76ch' }, [
      el('h1', { text: 'South Ecocide Analytics' }),
      el('p', {
        class: 'lede',
        text:
          'Published figures from the Green Southerners OSINT corpus of the war in South ' +
          'Lebanon: statistics, not records, counted by week, by town and by every documented ' +
          'column. Every page here is a static page of HTML and JavaScript: no server, no ' +
          'database, nothing to go down.',
      }),
      el('p', {
        style: 'font-size:.88rem;color:var(--ink-3)',
        text:
          `Data of ${stamp} UTC · ${fmt(types.length)} record types · ` +
          `${fmt(villagePayload.towns.length)} towns`,
      }),
    ]),

    group('The database and the investigations', [
      page('Database', 'platform.html',
        'Every kind of record on one map from 1 March 2026, counted by town: the filters, the ' +
        'timeline that plays them, burned ground, the Village Studio’s damage and the relief ' +
        'in 3D.'),
      page('Investigations', 'investigations/',
        'Investigations of a place, told step by step on the map: Aitaroun, Beaufort Castle and ' +
        'the ground around it, and the Litani River.'),
      page('I.02 Aitaroun', 'investigations/aitaroun.html',
        'A border town two kilometres from the Blue Line, read building by building on sharp ' +
        'satellite pictures.'),
      page('I.05 Beaufort Castle', 'investigations/beaufort.html',
        'The ground within 5.5 km of the castle above the Litani: fires, white phosphorus, and ' +
        'the damage mapped in Yohmor and Zawtar El Sharqiyeh.'),
      page('I.06 The Litani River', 'investigations/litani.html',
        'The places within 2 km of the river in the south, the gorge below Beaufort, and the ' +
        'fires on both banks.'),
    ]),

    group('Start here', [
      page('Overview', 'pages/overview.html',
        'Every kind of record the corpus holds, counted apart, with the measures that do ' +
        'add up and the lane chart that shows them side by side.'),
      page('Method and limits', 'pages/about.html',
        'How a record is made, what its location means, what is never done here, and how ' +
        'to cite a figure. Read before quoting anything.'),
      page('Embed builder', 'embed/',
        'Pick a widget, watch the real preview, copy the snippet. This is the page the ' +
        'social team works from.', true),
    ]),

    group('Cross-cutting pages', [
      page('Timeline', 'pages/timeline.html',
        'The whole war month by month, every type on its own lane. Click a month to read ' +
        'it out across all types at once.'),
      page('Map', 'pages/map.html',
        'Every kind of record counted by town on one map of Lebanon, with village ' +
        'territories, burned ground and presence zones as switchable ground layers.'),
      page('Villages', 'pages/villages.html',
        `All ${fmt(villagePayload.towns.length)} towns the corpus names, searchable and ` +
        'sortable by any single type. No total column.'),
      page('A village', `pages/village.html?v=${(villagePayload.towns[0] || {}).id || ''}`,
        'One village, every type counted apart: its counts by month and by column, its map, ' +
        'the ground before and after on a swipe, and a satellite time-lapse of every clear pass.'),
    ]),

    el('div', { class: 'section' }, [
      el('h2', { text: 'One page per record type' }),
      el('p', {
        class: 'lede',
        style: 'margin-bottom:14px',
        text:
          'Each is the same interactive dashboard: filter by date, district and any ' +
          'documented column, and every chart, the map and the tables recompute together.',
      }),
      el('div', { class: 'grid cols-3' }, types.map(typeCard)),
    ]),

    el('div', { class: 'section' }, [
      el('h2', { text: 'Embeddable widgets' }),
      el('p', {
        class: 'lede',
        style: 'margin-bottom:14px',
        html:
          'Each takes its whole configuration from the query string, so an editor can write ' +
          'one by hand. The <a href="' + url('embed/') + '">builder</a> is the easier way.',
      }),
      el('div', { class: 'card' }, [
        el('div', { class: 'table-wrap' }, [
          el('table', { class: 'data' }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { text: 'Widget' }),
                el('th', { text: 'What it draws' }),
                el('th', { text: 'An example' }),
              ]),
            ]),
            el('tbody', {}, [
              widgetRow('database', 'The database: the map, its filters and the timeline',
                '../platform.html?embed=1'),
              widgetRow('story', 'An investigation told step by step on the map',
                'story.html?story=beaufort'),
              widgetRow('explore', 'One type with its own controls: play head, column filter, district, chart and map',
                'explore.html?type=fires&controls=time,dim,district'),
              widgetRow('chart', 'A timeline, share, ranking, split or week grid of one type',
                'chart.html?type=fires&chart=timeline'),
              widgetRow('map', 'Lebanon with one type counted by town, or shaded by village or district',
                'map.html?type=phosphorus&mode=towns'),
              widgetRow('stat', 'One to three headline figures, each with its denominator',
                'stat.html?type=fires&stat=records,towns,area_ha'),
              widgetRow('lanes', 'Every type month by month, in separate lanes',
                'lanes.html'),
              widgetRow('lapse', 'One town, every clear Sentinel-2 pass, one a second',
                'lapse.html?v=235'),
              widgetRow('compare', 'One village before and after, on a slider',
                `compare.html?v=${(villagePayload.towns[0] || {}).id || '235'}`),
            ]),
          ]),
        ]),
        el('p', {
          class: 'card-note',
          html:
            'Add <code>&amp;theme=dark</code> or <code>&amp;theme=light</code> to pin the ' +
            'colours, <code>&amp;bare=1</code> to drop the card and draw straight on the ' +
            'article background, and <code>&amp;h=360</code> to set a height.',
        }),
      ]),
    ]),

    el('div', { class: 'section' }, [
      el('h2', { text: 'The records' }),
      el('div', { class: 'card' }, [
        el('p', {
          style: 'font-size:.9rem;color:var(--ink-2);margin-top:0',
          text:
            'Every page here reads statistics: the records counted by week, by town and by ' +
            'every documented column, with the measures that add up. No record, record ' +
            'number or single location is published.',
        }),
        contactNote({ cls: 'contact-note' }),
      ]),
    ]),

    el('div', { class: 'section' }, [
      el('div', { class: 'note' }, [
        el('b', { text: 'The rules every page here keeps' }),
        el('ul', {}, (metaPayload.notes || []).map((t) => el('li', { text: t }))),
      ]),
    ])
  );
}

/* ------------------------------------------------------------------ pieces */

function group(heading, cards) {
  return el('div', { class: 'section' }, [
    el('h2', { text: heading }),
    el('div', { class: 'grid cols-3' }, cards),
  ]);
}

function page(title, href, note, external = false) {
  return el('a', { class: 'type-card', href: url(href) }, [
    el('h3', { text: title }),
    el('p', { style: 'font-size:.86rem;color:var(--ink-2);margin:0', text: note }),
    el('span', { class: 'more', text: external ? 'Open the builder →' : 'Open →' }),
  ]);
}

function typeCard(type) {
  const node = el('a', { class: 'type-card', href: url(`pages/${type.slug}.html`) }, [
    el('span', { class: 'code' }, [
      type.code,
      type.frozen
        ? el('span', { class: 'badge frozen', style: 'margin-inline-start:6px', text: 'frozen' })
        : null,
    ]),
    el('h3', { text: type.label }),
    el('span', { class: 'big' }, [fmt(type.total), el('small', { text: ' records' })]),
    el('span', {
      class: 'span',
      text: type.date_range[0]
        ? `${dateLabel(type.date_range[0])} to ${dateLabel(type.date_range[1])}`
        : 'no dated records',
    }),
  ]);

  const sparkEl = el('div', { class: 'spark' });
  node.append(sparkEl);

  const bits = [`${fmt(type.towns)} towns`];
  for (const m of type.measures) {
    if (m.total) bits.push(`${fmtMeasure(m.total, m.unit)} ${m.unit === 'ha' ? 'ha' : m.label.toLowerCase()}`);
  }
  node.append(el('span', { class: 'more', text: bits.join(' · ') }));

  dataset(type.slug)
    .then((ds) => spark(sparkEl).update(ds.series(ds.all, { grain: 'month' })))
    .catch(() => sparkEl.remove());

  return node;
}

function widgetRow(name, what, example) {
  return el('tr', {}, [
    el('td', {}, [el('code', { text: name })]),
    el('td', { class: 'name', text: what }),
    el('td', {}, [
      el('a', {
        href: url(`embed/${example}`),
        target: '_blank',
        rel: 'noopener',
        style: 'font-size:.8rem',
        text: 'open →',
      }),
    ]),
  ]);
}

