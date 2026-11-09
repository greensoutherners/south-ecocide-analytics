/* The embed builder: pick a widget, watch it, copy the snippet.
 *
 * This exists so nobody has to learn a query-string grammar to put a chart in
 * an article. Choose a type, a chart and a period; the preview is the real
 * widget in a real iframe, so what is previewed is exactly what will appear on
 * greensoutherners.org; then copy the snippet.
 *
 * The preview is deliberately an iframe rather than an inline render. An inline
 * copy would be a second implementation that could drift, and it would not
 * catch the thing most likely to go wrong in a real embed, which is the height
 * handshake.
 */

import { dataset, meta, summary, timelapseIndex, villages } from './data.js';
import { defaultDim } from './explore.js';
import { TOWN_KINDS } from './maps.js';
import { chrome, el, failure, fill, loading, params, syncURL, url } from './ui.js';

const WIDGETS = {
  database: {
    label: 'Database, with the map',
    note:
      'The database in a frame: the map, its filters and the timeline, counted by town. ' +
      'Choose the kinds of record it opens on, or a place.',
  },
  story: {
    label: 'Investigation, step by step',
    note: 'One investigation told on the map, a step at a time, with its text beside the map.',
  },
  explore: {
    label: 'Explorer, with controls',
    note:
      'One record type the reader controls: a play head through the months, a column ' +
      'filter, a district picker, and a chart and a map that follow them.',
  },
  chart: {
    label: 'Chart',
    note: 'A timeline, a share, a ranking or a week grid of one record type.',
  },
  map: {
    label: 'Map',
    note: 'Lebanon, with one record type counted by town, village or district, and the ground layers you choose.',
  },
  stat: { label: 'Figures', note: 'One to three headline numbers, with their denominators.' },
  lanes: { label: 'All types', note: 'Every record type month by month, in separate lanes.' },
  compare: { label: 'Before and after', note: 'One village, two dated satellite releases, with a slider.' },
  lapse: {
    label: 'Time-lapse',
    note: 'One town, every clear Sentinel-2 pass in order, one a second, with the date on each frame.',
  },
};

/** What the database opens on: its kinds of record, or a place. */
const DATABASE_VIEWS = [
  { value: '', label: 'Every kind of record' },
  { value: 'types=BRN', label: 'Fires from attacks' },
  // Detonations are hidden for now (the data owner, 2026-11-06). To show them
  // again: { value: 'types=DET&shade=DET', label: 'Detonations and demolitions' }.
  { value: 'types=WPB', label: 'White phosphorus' },
  { value: 'types=ALR&shade=ALR', label: 'Displacement orders' },
  { value: 'focus=beaufort', label: 'Beaufort Castle and the ground around it' },
  { value: 'focus=litani&river=1', label: 'The Litani River' },
  { value: 'focus=273', label: 'Aitaroun' },
];

const STORIES = [
  { value: 'aitaroun', label: 'I.02 Aitaroun: a border town, before and after' },
  { value: 'beaufort', label: 'I.05 Beaufort Castle and the ground around it' },
  { value: 'litani', label: 'I.06 The Litani River Basin' },
];

/** A frame's height when the widget is a whole application rather than a chart. */
const APP_HEIGHT = { database: 940, story: 880 };

const CONTROL_SETS = [
  { value: 'time,dim,district', label: 'Timeline and every filter' },
  { value: 'time,dim', label: 'Timeline and one column' },
  { value: 'time,district', label: 'Timeline and district' },
  { value: 'time', label: 'Timeline only' },
  { value: 'dim,district', label: 'Filters, no timeline' },
];

const CHARTS = [
  { value: 'timeline', label: 'Over time (bars)' },
  { value: 'donut', label: 'Share (donut)' },
  { value: 'bars', label: 'Ranked (bars)' },
  { value: 'stacked', label: 'Over time, split' },
  { value: 'towns', label: 'By town' },
  { value: 'calendar', label: 'Week by week (grid)' },
];

export async function builderPage() {
  const mount = document.getElementById('page');
  mount.append(loading());

  try {
    const [metaPayload, summaryPayload, villagePayload] = await Promise.all([
      meta(),
      summary(),
      villages(),
    ]);
    await chrome('embed', Promise.resolve(metaPayload));
    render(mount, { meta: metaPayload, summary: summaryPayload, villages: villagePayload });
  } catch (err) {
    fill(mount, failure(err));
  }
}

function render(mount, { meta: metaPayload, summary: summaryPayload, villages: villagePayload }) {
  const query = params();
  const types = summaryPayload.types.filter((t) => t.total > 0);

  const state = {
    widget: query.widget || 'chart',
    type: query.type || 'fires',
    chart: query.chart || 'timeline',
    // Empty until a chart that groups asks for it: then the type's own default.
    dim: query.dim || '',
    measure: query.measure || '',
    // A map of records as points is no more: an older link's points read as
    // towns. Empty means the type's own default, set when the map is chosen.
    mode: query.mode === 'points' ? 'towns' : query.mode || '',
    layers: query.layers || '',
    // "Records placed" counted coordinates, which the site no longer holds.
    stat: (query.stat || 'records').split(',').filter((s) => s !== 'placed').join(',') || 'records',
    v: query.v || String((villagePayload.towns[0] || {}).id || ''),
    from: query.from || '',
    to: query.to || '',
    h: query.h || '',
    theme: query.theme || '',
    bare: query.bare === '1',
    title: query.title || '',
    // A control an older link names that the explorer no longer has is dropped.
    controls: (query.controls || 'time,dim,district')
      .split(',')
      .filter((c) => ['time', 'dim', 'district'].includes(c))
      .join(','),
    xdim: query.xdim || '',
    view: query.view || 'both',
    xmap: query.xmap === 'points' ? 'towns' : query.xmap || '',
    xmode: query.xmode || 'cumulative',
    autoplay: query.autoplay === '1',
  };

  const controlsHost = el('div', { class: 'card' });
  const previewHost = el('div', { class: 'card' });
  const snippetHost = el('div', { class: 'card' });
  let dimOptions = [];

  mount.replaceChildren(
    el('div', {}, [
      el('h1', { text: 'Embed a chart or a map' }),
      el('p', {
        class: 'lede',
        text:
          'Build the widget here, copy the snippet, paste it into a post. The preview below ' +
          'is the real embed in a real frame, so what you see is what the article will show.',
      }),
    ]),
    el('div', { class: 'section' }, [controlsHost]),
    el('div', { class: 'section' }, [el('h2', { text: 'Preview' }), previewHost]),
    el('div', { class: 'section' }, [el('h2', { text: 'The snippet' }), snippetHost]),
    el('div', { class: 'section' }, [setupCard()])
  );

  /* ---------------------------------------------------------- controls */

  async function drawControls() {
    const fields = [
      field(
        'Widget',
        Object.entries(WIDGETS).map(([value, w]) => ({ value, label: w.label })),
        state.widget,
        (v) => {
          state.widget = v;
          refresh();
        }
      ),
    ];

    if (state.widget === 'database') {
      if (!DATABASE_VIEWS.some((o) => o.value === state.dbview)) state.dbview = '';
      fields.push(
        field('Opens on', DATABASE_VIEWS, state.dbview, (v) => {
          state.dbview = v;
          refresh();
        })
      );
    }
    if (state.widget === 'story') {
      if (!STORIES.some((o) => o.value === state.story)) state.story = STORIES[0].value;
      fields.push(
        field('Investigation', STORIES, state.story, (v) => {
          state.story = v;
          refresh();
        })
      );
    }

    if (!['lanes', 'compare', 'lapse', 'database', 'story'].includes(state.widget)) {
      fields.push(
        field(
          'Record type',
          types.map((t) => ({ value: t.slug, label: t.label })),
          state.type,
          (v) => {
            state.type = v;
            state.dim = '';
            // A map shown the old type's own way opens the new type its own way.
            if (state.mode === 'towns' || state.mode === 'villages') state.mode = '';
            refresh();
          }
        )
      );
    }

    if (state.widget === 'chart') {
      fields.push(
        field('Chart', CHARTS, state.chart, (v) => {
          state.chart = v;
          refresh();
        })
      );
      if (['donut', 'bars', 'stacked'].includes(state.chart)) {
        const ds = await dataset(state.type);
        dimOptions = ds.dims.map((d) => ({ value: d.k, label: d.label }));
        if (!dimOptions.some((o) => o.value === state.dim)) state.dim = defaultDim(ds) || dimOptions[0].value;
        fields.push(
          field('Group by', dimOptions, state.dim, (v) => {
            state.dim = v;
            refresh();
          })
        );
      }
      const ds = await dataset(state.type);
      if (ds.measures.length) {
        fields.push(
          field(
            'Measure',
            [{ value: '', label: 'Count of records' }].concat(
              ds.measures.map((m) => ({ value: m.k, label: `${m.label} (${m.unit})` }))
            ),
            state.measure,
            (v) => {
              state.measure = v;
              refresh();
            }
          )
        );
      }
    }

    if (state.widget === 'explore') {
      const ds = await dataset(state.type);
      if (state.xdim && !ds.dims.some((d) => d.k === state.xdim)) state.xdim = '';
      // A town kind opens on its municipalities, shaded, and offers no circles.
      const townKind = TOWN_KINDS.has(ds.code);
      if (townKind && state.xmap === 'towns') state.xmap = '';
      fields.push(
        field('Controls', CONTROL_SETS, state.controls, (v) => {
          state.controls = v;
          refresh();
        }),
        field(
          'Filter column',
          [{ value: '', label: 'Default for the type' }].concat(ds.dims.map((d) => ({ value: d.k, label: d.label }))),
          state.xdim,
          (v) => {
            state.xdim = v;
            refresh();
          }
        ),
        field(
          'Shows',
          [
            { value: 'both', label: 'Chart and map, switchable' },
            { value: 'chart', label: 'Chart only' },
            { value: 'map', label: 'Map only' },
          ],
          state.view,
          (v) => {
            state.view = v;
            refresh();
          }
        ),
        field(
          'Map as',
          [
            { value: '', label: 'Default for the type' },
            { value: 'towns', label: 'Towns, sized by count' },
            { value: 'villages', label: 'Villages, shaded' },
            { value: 'districts', label: 'Districts, shaded' },
          ].filter((o) => !townKind || o.value !== 'towns'),
          state.xmap,
          (v) => {
            state.xmap = v;
            refresh();
          }
        ),
        field(
          'Timeline reads',
          [
            { value: 'cumulative', label: 'Building up' },
            { value: 'month', label: 'Month by month' },
          ],
          state.xmode,
          (v) => {
            state.xmode = v;
            refresh();
          }
        ),
        field(
          'On load',
          [
            { value: '', label: 'Wait for the reader' },
            { value: '1', label: 'Play the timeline' },
          ],
          state.autoplay ? '1' : '',
          (v) => {
            state.autoplay = v === '1';
            refresh();
          }
        )
      );
    }

    if (state.widget === 'map') {
      // Displacement orders open on the municipalities they name, shaded;
      // every other type on its towns.
      const townKind = TOWN_KINDS.has((types.find((t) => t.slug === state.type) || {}).code);
      if (!state.mode) state.mode = townKind ? 'villages' : 'towns';
      fields.push(
        field(
          'Shown as',
          [
            { value: 'towns', label: 'Towns, sized by count' },
            { value: 'villages', label: 'Villages, shaded' },
            { value: 'districts', label: 'Districts, shaded' },
          ],
          state.mode,
          (v) => {
            state.mode = v;
            refresh();
          }
        ),
        field(
          'Ground layer',
          [
            { value: '', label: 'None' },
            { value: 'villages', label: 'Fire search territories' },
            { value: 'scars', label: 'Burned ground' },
            { value: 'villages,scars', label: 'Territories and burned ground' },
          ],
          state.layers,
          (v) => {
            state.layers = v;
            refresh();
          }
        )
      );
    }

    if (state.widget === 'stat') {
      const ds = await dataset(state.type);
      const options = [
        { value: 'records', label: 'Records' },
        { value: 'towns', label: 'Towns affected' },
        ...ds.measures.map((m) => ({ value: m.k, label: m.label })),
      ];
      options.push({
        value: `records,towns${ds.measures[0] ? `,${ds.measures[0].k}` : ''}`,
        label: 'All three together',
      });
      fields.push(
        field('Figure', options, state.stat, (v) => {
          state.stat = v;
          refresh();
        })
      );
    }

    if (state.widget === 'lapse') {
      const index = await timelapseIndex().catch(() => ({ towns: [] }));
      const towns = (index.towns || []).slice().sort((a, b) => b.frames - a.frames);
      if (towns.length && !towns.some((t) => String(t.city_id) === state.v)) state.v = String(towns[0].city_id);
      fields.push(
        field(
          'Town',
          towns.map((t) => ({ value: String(t.city_id), label: `${t.name} (${t.frames} passes)` })),
          state.v,
          (v) => {
            state.v = v;
            refresh();
          }
        ),
        field(
          'On load',
          [
            { value: '', label: 'Wait for the reader' },
            { value: '1', label: 'Play the sequence' },
          ],
          state.autoplay ? '1' : '',
          (v) => {
            state.autoplay = v === '1';
            refresh();
          }
        )
      );
    }

    if (state.widget === 'compare') {
      fields.push(
        field(
          'Village',
          villagePayload.towns.slice(0, 120).map((t) => ({ value: String(t.id), label: t.name })),
          state.v,
          (v) => {
            state.v = v;
            refresh();
          }
        )
      );
    }

    if (!['compare', 'explore', 'lapse'].includes(state.widget)) {
      fields.push(
        dateField('From', state.from, (v) => {
          state.from = v;
          refresh();
        }),
        dateField('To', state.to, (v) => {
          state.to = v;
          refresh();
        })
      );
    }

    fields.push(
      field(
        'Colour theme',
        [
          { value: '', label: 'Follow the reader' },
          { value: 'light', label: 'Always light' },
          { value: 'dark', label: 'Always dark' },
        ],
        state.theme,
        (v) => {
          state.theme = v;
          refresh();
        }
      ),
      el('div', { class: 'field' }, [
        el('label', { text: 'Height (px)', for: 'b-h' }),
        el('input', {
          type: 'text',
          id: 'b-h',
          value: state.h,
          placeholder: 'auto',
          style: 'min-width:90px',
          oninput: (e) => {
            state.h = e.target.value.replace(/\D/g, '');
            refresh({ controls: false });
          },
        }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: 'Title (optional)', for: 'b-title' }),
        el('input', {
          type: 'text',
          id: 'b-title',
          value: state.title,
          placeholder: 'the widget picks one',
          style: 'min-width:200px',
          oninput: (e) => {
            state.title = e.target.value;
            refresh({ controls: false });
          },
        }),
      ])
    );

    fill(
      controlsHost,
      el('div', { class: 'controls' }, fields),
      el('label', { style: 'display:flex;gap:7px;align-items:center;font-size:.85rem;margin-top:12px' }, [
        el('input', {
          type: 'checkbox',
          checked: state.bare,
          onchange: (e) => {
            state.bare = e.target.checked;
            refresh({ controls: false });
          },
        }),
        'No card, draw straight on the article background',
      ]),
      el('p', { class: 'card-note', text: WIDGETS[state.widget].note })
    );
  }

  /* ---------------------------------------------------------- preview */

  function build() {
    const q = new URLSearchParams();
    const put = (k, v) => v && q.set(k, v);

    // The two applications have addresses of their own.
    if (state.widget === 'database') {
      return `${url('platform.html')}?embed=1${state.dbview ? `&${state.dbview}` : ''}`;
    }
    if (state.widget === 'story') return `${url('embed/story.html')}?story=${encodeURIComponent(state.story)}`;

    if (!['lanes', 'compare', 'lapse'].includes(state.widget)) put('type', state.type);
    if (state.widget === 'chart') {
      put('chart', state.chart);
      if (['donut', 'bars', 'stacked'].includes(state.chart)) put('dim', state.dim);
      put('measure', state.measure);
    }
    if (state.widget === 'map') {
      put('mode', state.mode);
      put('layers', state.layers);
    }
    if (state.widget === 'stat') put('stat', state.stat);
    if (state.widget === 'compare' || state.widget === 'lapse') put('v', state.v);
    if (state.widget === 'lapse' && state.autoplay) q.set('autoplay', '1');
    if (state.widget === 'explore') {
      put('controls', state.controls);
      put('dim', state.xdim);
      if (state.view !== 'both') put('view', state.view);
      put('map', state.xmap);
      if (state.xmode === 'month') put('mode', 'month');
      if (state.autoplay) q.set('autoplay', '1');
    }
    if (!['compare', 'explore', 'lapse'].includes(state.widget)) {
      put('from', state.from);
      put('to', state.to);
    }
    put('h', state.h);
    put('theme', state.theme);
    if (state.bare) q.set('bare', '1');
    put('title', state.title);

    return `${url(`embed/${state.widget}.html`)}${q.toString() ? `?${q}` : ''}`;
  }

  async function refresh({ controls = true } = {}) {
    // The controls settle first: they replace a column or a map the type does
    // not carry, and the preview and the snippet are built from what holds.
    if (controls) await drawControls();
    const href = build();
    syncURL({ ...state, autoplay: state.autoplay ? '1' : '' }, [
      'widget', 'type', 'chart', 'dim', 'measure', 'mode', 'layers',
      'stat', 'v', 'from', 'to', 'h', 'theme', 'title',
      'controls', 'xdim', 'view', 'xmap', 'xmode', 'autoplay',
    ]);

    const frame = el('iframe', {
      src: href,
      style: `width:100%;border:0;display:block;height:${APP_HEIGHT[state.widget] || 460}px;background:transparent`,
      title: 'Embed preview',
      scrolling: 'no',
    });

    // The same height handshake the host snippet performs, so the preview
    // proves the handshake works and not just that the chart draws.
    const onMessage = (event) => {
      if (event.source !== frame.contentWindow) return;
      const data = event.data;
      if (data && data.type === 'gsa:height' && typeof data.height === 'number') {
        frame.style.height = `${Math.max(120, Math.min(4000, Math.round(data.height)))}px`;
      }
    };
    window.addEventListener('message', onMessage);

    fill(
      previewHost,
      el('div', { class: 'card-head' }, [
        el('h3', { text: 'As it will appear' }),
        el('a', { href, target: '_blank', rel: 'noopener', style: 'font-size:.82rem', text: 'Open on its own →' }),
      ]),
      frame,
      el('p', {
        class: 'card-note',
        text:
          'The frame below is sizing itself through the same message the host snippet ' +
          'listens for, so this previews the handshake as well as the chart.',
      })
    );

    drawSnippet(href);
  }

  function drawSnippet(href) {
    const iframe =
      `<iframe src="${href}"\n` +
      `        style="width:100%;border:0;display:block;height:${APP_HEIGHT[state.widget] || state.h || 460}px"\n` +
      `        title="${state.title || 'South Ecocide Analytics'}"\n` +
      `        loading="lazy" scrolling="no"></iframe>`;
    const script = `<script src="${url('embed/host.js')}" async><\/script>`;

    fill(
      snippetHost,
      el('p', {
        style: 'font-size:.88rem;color:var(--ink-2);margin:0 0 10px',
        html:
          'Paste this where the chart should go. Add the second line <b>once per site</b> ' +
          '(in the theme footer, say) and every embed will size itself.',
      }),
      codeBlock('The embed', iframe),
      codeBlock('Once per site', script),
      el('p', {
        class: 'card-note',
        html:
          'Without the second line the frame keeps the fixed height above, which still ' +
          'works, it just cannot grow with the content. The widget URL is also a ' +
          'normal page: <a href="' + href + '" rel="noopener" target="_blank">open it</a> ' +
          'to share or screenshot it.',
      })
    );
  }

  function codeBlock(label, text) {
    const pre = el('pre', {
      style:
        'background:var(--plane);border:1px solid var(--hairline);border-radius:8px;' +
        'padding:12px 14px;font-size:.78rem;overflow-x:auto;margin:0;white-space:pre-wrap;' +
        'word-break:break-all',
      text,
    });
    const button = el('button', {
      class: 'btn primary',
      type: 'button',
      text: 'Copy',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(text);
          button.textContent = 'Copied';
        } catch {
          // Clipboard access can be refused; selecting the text is the fallback
          // that always works.
          const range = document.createRange();
          range.selectNodeContents(pre);
          const selection = getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          button.textContent = 'Selected, press Ctrl+C';
        }
        setTimeout(() => (button.textContent = 'Copy'), 2200);
      },
    });

    return el('div', { style: 'margin-bottom:14px' }, [
      el('div', { class: 'card-head', style: 'margin-bottom:6px' }, [
        el('h3', { style: 'font-size:.84rem', text: label }),
        button,
      ]),
      pre,
    ]);
  }

  function setupCard() {
    return el('div', { class: 'note' }, [
      el('b', { text: 'Before the first embed goes live' }),
      el('ul', {}, [
        el('li', {
          text:
            'Add the host snippet once to greensoutherners.org so embeds can size ' +
            'themselves. It touches nothing else on the page and ignores messages from ' +
            'any other origin.',
        }),
        el('li', {
          text:
            'If the site has a content-security policy, it needs to allow frames from ' +
            'greensoutherners.github.io.',
        }),
        el('li', {
          text:
            'Every widget carries the data date in its own credit line, so a screenshot ' +
            'taken from an article still says when the figures were read.',
        }),
      ]),
    ]);
  }

  refresh();
}

/* ------------------------------------------------------------------ fields */

function field(label, options, value, onChange) {
  const id = `b-${label.toLowerCase().replace(/\W+/g, '-')}`;
  const node = el('select', { id });
  for (const o of options) {
    node.append(el('option', { value: o.value, text: o.label, selected: o.value === value }));
  }
  node.addEventListener('change', () => onChange(node.value));
  return el('div', { class: 'field' }, [el('label', { text: label, for: id }), node]);
}

function dateField(label, value, onChange) {
  const id = `b-${label.toLowerCase()}`;
  return el('div', { class: 'field' }, [
    el('label', { text: label, for: id }),
    el('input', {
      type: 'date',
      id,
      value,
      onchange: (e) => onChange(e.target.value),
    }),
  ]);
}
