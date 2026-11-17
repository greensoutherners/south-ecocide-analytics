/* The village register: every town the corpus holds a record for.
 *
 * A table, searchable and sortable, with one column per incident type and no
 * total column. That absence is the page's whole argument: a town with four
 * fires and one displacement order has not had "five incidents", because the
 * corpus looks for a few specific things and a sum would read as a measure of
 * how badly the town was hit rather than of how much we happened to collect
 * there.
 *
 * Sorting is allowed per column, which is the honest way to answer "where is
 * it worst": worst *by fires*, worst *by displacement orders*, worst *by
 * hectares burned*, each a question the data can answer. Every cell is a count
 * for a town; no record is listed.
 */

import { fmt, fmtArea, meta, monthLabel, ongeo, summary, timelapseIndex, villages } from './data.js';
import {
  chrome,
  contactNote,
  el,
  failure,
  fill,
  loading,
  noteList,
  params,
  stat,
  syncURL,
  url,
} from './ui.js';
import { shareCard } from './share.js';

/* `only=<id>`: one component of this page shown alone, in a frame on another
 * page (share.js). Read once, before the page rewrites its own address, and
 * kept in that address so a reloaded frame still shows the component alone. */
const ONLY = new URLSearchParams(location.search).get('only') || '';

export async function villagesPage() {
  const mount = document.getElementById('page');
  mount.append(loading());

  try {
    const [metaPayload, summaryPayload, payload, pictures, lapses] = await Promise.all([
      meta(),
      summary(),
      villages(),
      ongeo().catch(() => ({ villages: [] })),
      timelapseIndex().catch(() => ({ towns: [] })),
    ]);
    await chrome('villages', Promise.resolve(metaPayload));
    const withSwipe = new Set(
      (pictures.villages || []).filter((v) => v.compare).map((v) => v.city_id)
    );
    const withLapse = new Set((lapses.towns || []).map((t) => t.city_id));
    render(mount, { meta: metaPayload, summary: summaryPayload, payload, withSwipe, withLapse });
  } catch (err) {
    fill(mount, failure(err));
  }
}

function render(mount, { meta: metaPayload, summary: summaryPayload, payload, withSwipe, withLapse }) {
  const query = params();
  const types = summaryPayload.types.filter((t) => t.total > 0);
  const towns = payload.towns;
  // The day the data was built, named in the credit of an embedded component.
  const dataDate = ((metaPayload && metaPayload.generated_at) || '').slice(0, 10);

  const state = {
    q: query.q || '',
    district: query.district || '',
    sort: query.sort || 'types',
    type: query.type || '',
  };

  const districts = [...new Set(towns.map((t) => t.district).filter(Boolean))].sort();

  const searchEl = el('input', {
    type: 'text',
    id: 'v-q',
    placeholder: 'Al-Khiyam, Houla, عيترون …',
    value: state.q,
    style: 'min-width:220px',
  });
  searchEl.addEventListener('input', () => {
    state.q = searchEl.value;
    draw();
  });

  const districtEl = el('select', { id: 'v-district' });
  districtEl.append(el('option', { value: '', text: 'Every district' }));
  for (const d of districts) {
    districtEl.append(el('option', { value: d, text: d, selected: d === state.district }));
  }
  districtEl.addEventListener('change', () => {
    state.district = districtEl.value;
    draw();
  });

  const sortEl = el('select', { id: 'v-sort' });
  const sortOptions = [
    { value: 'types', label: 'Kinds of record held' },
    { value: 'pictures', label: 'Has pictures' },
    { value: 'name', label: 'Name' },
    { value: 'first', label: 'Earliest record' },
    { value: 'last', label: 'Most recent record' },
    ...types.map((t) => ({ value: `t:${t.code}`, label: `${t.label}: records` })),
    { value: 'ha:BRN', label: 'Hectares burned' },
  ];
  for (const o of sortOptions) {
    sortEl.append(el('option', { value: o.value, text: o.label, selected: o.value === state.sort }));
  }
  sortEl.addEventListener('change', () => {
    state.sort = sortEl.value;
    draw();
  });

  // Both components are made once here and never replaced, so their share
  // buttons stay put: each draw refills only the row of figures and the
  // register's count and table.
  const statRow = el('div', { class: 'grid cols-4' });
  const figures = el('section', { style: 'margin:18px 0' }, [statRow]);
  const countEl = el('h3');
  const tableBody = el('div');
  const tableHost = el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      countEl,
      el('span', {
        style: 'font-size:.78rem;color:var(--ink-3)',
        text: types.map((t) => `${t.code} = ${t.label}`).join(' · '),
      }),
    ]),
    tableBody,
  ]);

  mount.replaceChildren(
    el('div', {}, [
      el('h1', { text: 'Villages' }),
      el('p', {
        class: 'lede',
        text:
          'Every town and village the corpus holds at least one record for. The columns ' +
          'are counted apart and there is no total column: the corpus collects ' +
          `${fmt(types.length)} specific kinds of record, so adding a row would measure what ` +
          'we looked for rather than what happened.',
      }),
    ]),
    figures,
    el('div', { class: 'card', style: 'margin-bottom:16px' }, [
      el('div', { class: 'controls' }, [
        el('div', { class: 'field' }, [el('label', { text: 'Search', for: 'v-q' }), searchEl]),
        el('div', { class: 'field' }, [el('label', { text: 'District', for: 'v-district' }), districtEl]),
        el('div', { class: 'field' }, [el('label', { text: 'Sort by', for: 'v-sort' }), sortEl]),
        el('button', {
          class: 'btn',
          type: 'button',
          text: 'Clear',
          onclick: () => {
            state.q = '';
            state.district = '';
            state.sort = 'types';
            searchEl.value = '';
            districtEl.value = '';
            sortEl.value = 'types';
            draw();
          },
        }),
      ]),
    ]),
    tableHost,
    el('div', { class: 'section' }, [
      noteList([
        'A town appears here because a record names it. A town that does not appear is a ' +
          'town no record names, which is not the same as a town that was not touched.',
        'Columns are never added across a row. Each counts a different kind of record, ' +
          'collected over a different window and held to a different bar for what counts ' +
          'as a record.',
        'The fire column counts every fire the corpus links to an Israeli military attack ' +
          '(an attack documented at the same town on a day of the fire, or a source that ' +
          'names it), and every fire in the yellow-line zone or round Beaufort Castle, ' +
          'whatever lit it.',
        'Hectares are measured ground: burn scars read on Sentinel-2 passes either side ' +
          'of the fire. A town with no ' +
          'hectares may still have fires: the scar is measured for part of the corpus only.',
      ]),
      contactNote(),
    ])
  );

  /* --- sharing: a link to each component, or the code that embeds it --- */
  // What the reader has narrowed the towns to, named in a shared title.
  const scope = () => {
    const parts = [];
    if (state.district) parts.push(`${state.district.trim()} district`);
    if (state.q.trim()) parts.push(`matching "${state.q.trim()}"`);
    return parts.length ? `, ${parts.join(', ')}` : '';
  };
  // A frame narrower than this page wraps the five figures onto more rows:
  // the frame has room for two rows of them at least.
  const figuresHeight = () => {
    const tile = Math.max(0, ...[...statRow.children].map((n) => n.getBoundingClientRect().height));
    const shown = figures.getBoundingClientRect().height;
    return Math.ceil(Math.max(shown, 2 * tile + 16)) + 96;
  };
  // A frame of 800 px holds any register down to a phone's width: the table
  // scrolls inside 70% of the frame's height (its own cap). A short register
  // is sized to itself, with room for the names and the key that wrap in a
  // narrower frame.
  const registerHeight = () => {
    const wrap = tableBody.querySelector('.table-wrap');
    if (wrap && wrap.scrollHeight > wrap.clientHeight + 1) return 800;
    return Math.min(800, Math.ceil(tableHost.getBoundingClientRect().height) + 160);
  };
  shareCard(figures, 'figures', () => ({
    title: `Towns with a record of each kind${scope()}`,
    height: figuresHeight(),
    date: dataDate,
  }));
  shareCard(tableHost, 'register', () => ({
    title: `Village register${scope()}: records of each kind, town by town`,
    height: registerHeight(),
    date: dataDate,
  }));

  function draw() {
    syncURL({ ...state, only: ONLY }, ['q', 'district', 'sort', 'only']);

    const needle = state.q.trim().toLowerCase();
    let rows = towns.filter((t) => {
      if (state.district && t.district !== state.district) return false;
      if (!needle) return true;
      return (
        (t.name || '').toLowerCase().includes(needle) ||
        (t.name_ar || '').includes(state.q.trim()) ||
        (t.district || '').toLowerCase().includes(needle)
      );
    });

    rows = [...rows].sort(
      state.sort === 'pictures'
        ? (a, b) =>
            (withSwipe.has(b.id) ? 2 : 0) + (withLapse.has(b.id) ? 1 : 0) -
            ((withSwipe.has(a.id) ? 2 : 0) + (withLapse.has(a.id) ? 1 : 0))
        : comparator(state.sort)
    );

    /* --- the figures that may cross types --- */
    const withType = (code) => rows.filter((t) => t.types[code]).length;
    const burned = rows.reduce((s, t) => s + ((t.types.BRN && t.types.BRN.area_ha) || 0), 0);
    fill(
      statRow,
      stat({
        label: 'Towns listed',
        value: fmt(rows.length),
        sub: rows.length === towns.length ? 'every town with a record' : `of ${fmt(towns.length)}`,
      }),
      stat({
        label: 'With a fire record',
        value: fmt(withType('BRN')),
        sub: `${fmtArea(burned)} ha of measured burn scar`,
      }),
      stat({
        label: 'With a demolition record',
        value: fmt(withType('DET')),
        sub: 'detonations and demolitions reported',
      }),
      stat({
        label: 'With a white phosphorus record',
        value: fmt(withType('WPB')),
        sub: 'white phosphorus attacks reported',
      }),
      stat({
        label: 'With a displacement order',
        value: fmt(withType('ALR')),
        sub: 'evacuation or displacement orders issued',
      })
    );

    /* --- the table --- */
    const head = el('tr', {}, [
      el('th', { text: 'Town' }),
      el('th', { text: 'District' }),
      ...types.map((t) => el('th', { class: 'num', title: t.label, text: t.code })),
      el('th', { class: 'num', text: 'ha burned' }),
      el('th', { text: 'Period' }),
    ]);

    const body = rows.map((t) =>
      el('tr', {}, [
        el('td', { class: 'name' }, [
          // Shown alone in a frame, a town opens in a new tab, not in the frame.
          el('a', {
            href: url(`pages/village.html?v=${t.id}`),
            target: ONLY ? '_blank' : null,
            rel: ONLY ? 'noopener' : null,
            text: t.name || `#${t.id}`,
          }),
          t.name_ar
            ? el('span', { style: 'color:var(--ink-3);margin-inline-start:7px', text: t.name_ar })
            : null,
          // Which towns have pictures, so the ones worth opening can be found.
          withSwipe.has(t.id)
            ? el('span', {
                class: 'badge',
                style: 'margin-inline-start:7px',
                title: 'Before and after pictures',
                text: 'before / after',
              })
            : null,
          withLapse.has(t.id)
            ? el('span', {
                class: 'badge',
                style: 'margin-inline-start:5px',
                title: 'Satellite time-lapse',
                text: 'time-lapse',
              })
            : null,
        ]),
        el('td', { text: t.district || 'n/a' }),
        ...types.map((type) => {
          const entry = t.types[type.code];
          return el('td', {
            class: 'num',
            style: entry ? null : 'color:var(--ink-3)',
            text: entry ? fmt(entry.n) : '·',
          });
        }),
        el('td', {
          class: 'num',
          text: t.types.BRN && t.types.BRN.area_ha ? fmtArea(t.types.BRN.area_ha) : '·',
        }),
        el('td', {
          style: 'color:var(--ink-3);font-size:.8rem',
          text: t.first ? `${monthLabel(t.first.slice(0, 7))} to ${monthLabel(t.last.slice(0, 7))}` : 'n/a',
        }),
      ])
    );

    countEl.textContent = `${fmt(rows.length)} town${rows.length === 1 ? '' : 's'}`;
    fill(
      tableBody,
      el('div', { class: 'table-wrap', style: 'max-height:70vh' }, [
        el('table', { class: 'data' }, [el('thead', {}, [head]), el('tbody', {}, body)]),
      ]),
      el('p', {
        class: 'card-note',
        text: 'There is no total column. A dot means no record of that kind names this town.',
      })
    );
  }

  draw();
}

function comparator(sort) {
  if (sort === 'name') return (a, b) => (a.name || '').localeCompare(b.name || '');
  if (sort === 'first') return (a, b) => (a.first || '9999').localeCompare(b.first || '9999');
  if (sort === 'last') return (a, b) => (b.last || '').localeCompare(a.last || '');
  if (sort.startsWith('t:')) {
    const code = sort.slice(2);
    return (a, b) => ((b.types[code] || {}).n || 0) - ((a.types[code] || {}).n || 0);
  }
  if (sort.startsWith('ha:')) {
    const code = sort.slice(3);
    return (a, b) => ((b.types[code] || {}).area_ha || 0) - ((a.types[code] || {}).area_ha || 0);
  }
  // Default: the towns the corpus knows most about, by how many *kinds* of
  // record name them, then by how many records in all. Kinds first, because a
  // town with five kinds is documented from five directions, which is a
  // stronger statement than one with fifty records of a single kind.
  return (a, b) => {
    const kinds = Object.keys(b.types).length - Object.keys(a.types).length;
    if (kinds) return kinds;
    const sum = (t) => Object.values(t.types).reduce((s, v) => s + v.n, 0);
    return sum(b) - sum(a);
  };
}
