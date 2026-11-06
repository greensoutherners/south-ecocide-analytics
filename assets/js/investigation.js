/* The investigation engine.
 *
 * An investigation is a long-form page in the manner of Forensic Architecture's:
 * a metadata block, an introduction, then areas of analysis, each read beside a
 * pinned visual that changes as the reader scrolls through its findings.
 *
 * Two things are borrowed from the rest of this site and are not negotiable.
 *
 * **Every figure in the prose is live.** A sentence is written as
 * `<span data-fig="BRN.n"></span> fires were recorded`, and the number is filled
 * from the published data when the page loads. An investigation is read for
 * months after it is written; prose with figures typed into it would be wrong
 * by the next refresh, and wrong in the one place a reader trusts most.
 *
 * **A chapter's visual is the data, not a picture of it.** Each chapter pins a
 * stage (a map, a chart, the satellite pictures) and each step of the text sets
 * that stage's state: a time window, a filter, a map mode. Scrolling is the
 * reader moving through the material in the order the argument needs it.
 *
 * Markup, all of it plain HTML:
 *
 *   <section class="chapter" data-stage='{"kind":"map","type":"fires"}'>
 *     <div class="stage"></div>
 *     <div class="steps">
 *       <div class="step" data-state='{"to":"2024-06-30"}'>...</div>
 *     </div>
 *   </section>
 *
 * Stage kinds: map, chart, lanes, swipe, lapse. A step's state is merged over
 * the chapter's, so a step only says what changes.
 *
 * The data are statistics, never records (the data owner, 2026-11-06): the
 * records counted by week, town and documented column. So a figure is a
 * count, a date is a week or a month, and a map counts by town.
 */

import {
  dataset,
  dateLabel,
  dayToISO,
  fmt,
  fmtMeasure,
  geo,
  isoToDay,
  monthLabel,
  meta,
  ongeo,
  ROOT,
  summary,
  timelapseIndex,
  villages,
} from './data.js';
import { lanes, stacked, timeline } from './charts.js';
import {
  autoScale,
  burnedLayer,
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
  zoneLayer,
} from './maps.js';
import { defaultDim } from './explore.js';
import { typeRamp } from './theme.js';
import { swipe } from './compare.js';
import { timelapse } from './timelapse.js';
import { monthsBetween } from './scrubber.js';
import { countLabel, el, kindNoun } from './ui.js';

const SLUGS = {
  BRN: 'fires',
  // Detonations are hidden for now (the data owner, 2026-11-06). To show them
  // again: DET: 'detonations'.
  WPB: 'phosphorus',
  ALR: 'displacement',
  ATT: 'strikes',
};

/** The kinds a lane chart shows when a chapter names none: every published one. */
const LANE_KINDS = ['BRN', 'WPB', 'ALR'];

/* ------------------------------------------------------------------ facts */

/**
 * Everything a sentence may quote, computed from the published data.
 *
 * Keys are dotted paths: `BRN.n`, `BRN.towns`, `BRN.peak_month`,
 * `BRN.fire_cause_id.<value>`, `town.235.BRN.n`, `meta.snapshot`. A key the
 * data does not hold renders as a visible gap rather than as zero, because a
 * missing figure printed as 0 is a finding nobody made.
 */
class Facts {
  constructor() {
    this.values = new Map();
    this.sets = new Map();
  }

  set(key, value) {
    this.values.set(key, value);
  }

  get(key) {
    return this.values.get(key);
  }

  async load(codes, townIds) {
    const [metaPayload, summaryPayload, villagePayload] = await Promise.all([
      meta(),
      summary(),
      villages(),
    ]);
    this.set('meta.snapshot', dateLabel(metaPayload.generated_at.slice(0, 10)));
    this.set('meta.war_start', dateLabel(metaPayload.war_start));
    this.set('meta.towns', fmt(villagePayload.towns.length));

    for (const t of summaryPayload.types) {
      if (!codes.has(t.code)) continue;
      const ds = await dataset(t.slug);
      this.sets.set(t.code, ds);
      this.typeFacts(t.code, ds, ds.all, t.code);
    }

    for (const id of townIds) {
      const town = villagePayload.towns.find((x) => String(x.id) === String(id));
      if (!town) continue;
      this.set(`town.${id}.name`, town.name);
      this.set(`town.${id}.name_ar`, town.name_ar || '');
      this.set(`town.${id}.district`, town.district || '');
      for (const [code, ds] of this.sets) {
        const sel = ds.select({ filters: { town: [town.name] } });
        this.typeFacts(code, ds, sel, `town.${id}.${code}`);
      }
    }
  }

  typeFacts(code, ds, sel, prefix) {
    const n = ds.size(sel);
    this.set(`${prefix}.n`, fmt(n));
    this.set(`${prefix}.n_raw`, n);
    this.set(`${prefix}.n_words`, countLabel(code, n));
    const towns = ds.towns(sel).filter((t) => t.name !== 'No town recorded');
    this.set(`${prefix}.towns`, fmt(towns.length));
    if (towns[0]) {
      this.set(`${prefix}.top_town`, towns[0].name);
      this.set(`${prefix}.top_town_n`, fmt(towns[0].n));
    }

    // The statistics are counted by week, so the span is told in months and
    // the busy stretch in weeks: no figure here is a day.
    const months = ds.series(sel, { grain: 'month' }).filter((b) => b.n > 0);
    if (months.length) {
      this.set(`${prefix}.first`, monthLabel(months[0].key));
      this.set(`${prefix}.last`, monthLabel(months[months.length - 1].key));
      const peak = months.reduce((a, b) => (b.n > a.n ? b : a), months[0]);
      this.set(`${prefix}.peak_month`, monthLabel(peak.key));
      this.set(`${prefix}.peak_n`, fmt(peak.n));
      this.set(`${prefix}.months`, fmt(months.length));
      this.set(`${prefix}.weeks`, fmt(ds.series(sel, { grain: 'week' }).filter((b) => b.n > 0).length));
    }

    for (const m of ds.measures) {
      const { total, records, coverage } = ds.sum(sel, m.k);
      this.set(`${prefix}.${m.k}`, fmtMeasure(total, m.unit));
      this.set(`${prefix}.${m.k}_records`, fmt(records));
      this.set(`${prefix}.${m.k}_coverage`, `${Math.round(coverage * 100)}%`);
    }

    // Every documented column's values, so a sentence can quote one share.
    for (const dim of ds.dims) {
      for (const g of ds.group(sel, dim.k)) {
        const key = `${prefix}.${dim.k}.${g.key}`;
        this.set(key, fmt(g.n));
        this.set(`${key}_pct`, n ? `${Math.round((100 * g.n) / n)}%` : '0%');
      }
    }
  }

  /**
   * The order in which two record types first appear in each town, to the week.
   *
   * `seq.ALR.BRN.*` asks: in the towns that carry both, which came first? It is
   * a sequence in the records and nothing more. Two rules keep it honest. A
   * town only tests the order if both types were being collected when its
   * earlier record was made: a record made before the other type was being
   * collected at all cannot be said to have come "before" it. And a town with
   * only one of the two says nothing either way, so it is counted apart rather
   * than as a case for or against. The figures are counted by week, so two
   * firsts in the same week are a tie and count for neither.
   */
  sequence(a, b) {
    const A = this.sets.get(a);
    const B = this.sets.get(b);
    if (!A || !B) return;
    const firsts = (ds) => {
      const out = new Map();
      for (const r of ds.all) {
        const t = ds.value(r, 'town');
        const d = ds.rows[r][ds.at.d];
        if (!t || d == null) continue;
        const iso = dayToISO(ds.epoch, d);
        if (!out.has(t) || iso < out.get(t)) out.set(t, iso);
      }
      return out;
    };
    const fa = firsts(A);
    const fb = firsts(B);
    // Both are being collected from the later of the two collection starts.
    const common = [dayToISO(A.epoch, A.minDay), dayToISO(B.epoch, B.minDay)].sort()[1];
    const both = [...fa.keys()].filter((t) => fb.has(t));
    const testable = both.filter((t) => fa.get(t) >= common || fb.get(t) >= common);
    const aFirst = testable.filter((t) => fa.get(t) < fb.get(t));
    const bFirst = testable.filter((t) => fb.get(t) < fa.get(t));
    const untestable = both.filter((t) => fb.get(t) < common && fb.get(t) < fa.get(t));
    const gaps = aFirst
      .map((t) => (Date.parse(fb.get(t)) - Date.parse(fa.get(t))) / 86400000)
      .sort((x, y) => x - y);
    const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
    const k = `seq.${a}.${b}`;
    this.set(`${k}.a_towns`, fmt(fa.size));
    this.set(`${k}.b_towns`, fmt(fb.size));
    this.set(`${k}.both`, fmt(both.length));
    this.set(`${k}.testable`, fmt(testable.length));
    this.set(`${k}.a_first`, fmt(aFirst.length));
    this.set(`${k}.b_first`, fmt(bFirst.length - untestable.length));
    this.set(`${k}.untestable`, fmt(untestable.length));
    // The towns that can actually test the order: both types were being
    // collected when the earlier of their two records was made.
    this.set(`${k}.can_test`, fmt(both.length - untestable.length));
    this.set(`${k}.median_days`, median == null ? null : fmt(Math.round(median)));
    this.set(`${k}.min_days`, gaps.length ? fmt(Math.round(gaps[0])) : null);
    this.set(`${k}.max_days`, gaps.length ? fmt(Math.round(gaps[gaps.length - 1])) : null);
    this.set(`${k}.only_a`, fmt([...fa.keys()].filter((t) => !fb.has(t)).length));
    this.set(`${k}.only_b`, fmt([...fb.keys()].filter((t) => !fa.has(t)).length));
    this.set(`${k}.common_start`, dateLabel(common));
  }

  /** The same facts, restricted to a window of days. */
  windowed(from, to) {
    const sub = new Facts();
    sub.values = new Map(this.values);
    sub.sets = this.sets;
    for (const [code, ds] of this.sets) {
      const sel = ds.select({
        from: from ? isoToDay(ds.epoch, from) : null,
        to: to ? isoToDay(ds.epoch, to) : null,
      });
      sub.typeFacts(code, ds, sel, code);
    }
    return sub;
  }

  /** Fill every `[data-fig]` in a container. */
  fill(root, { skipWindows = false } = {}) {
    for (const node of root.querySelectorAll('[data-fig]')) {
      if (skipWindows && node.closest('[data-window]') && node.closest('[data-window]') !== root) continue;
      const value = this.get(node.dataset.fig);
      if (value == null || value === '') {
        node.textContent = '…';
        node.classList.add('fig-missing');
        node.title = `No figure for ${node.dataset.fig} in this data snapshot`;
      } else {
        node.textContent = value;
        node.classList.add('fig');
      }
    }
  }
}

/* ------------------------------------------------------------------ stages */

/**
 * A pinned visual that can be put into a state.
 *
 * `show(state)` is the only thing the scroll observer calls. Each stage keeps
 * its expensive parts (the Leaflet map, the chart instance, the pictures) and
 * only changes what the state changes, so stepping through a chapter feels like
 * the record moving rather than the page reloading.
 */
class Stage {
  constructor(host, spec, facts) {
    this.host = host;
    this.spec = spec;
    this.facts = facts;
    this.caption = el('div', { class: 'stage-caption' });
    this.canvas = el('div', { class: 'stage-canvas' });
    host.replaceChildren(this.canvas, this.caption);
    this.token = 0;
  }

  async show(state) {
    const s = { ...this.spec, ...state };
    const token = ++this.token;
    try {
      await this.render(s, token);
    } catch (err) {
      console.error(err);
      if (token === this.token) {
        this.canvas.replaceChildren(el('p', { class: 'loading', text: 'This visual did not load.' }));
      }
    }
    if (token === this.token) this.caption.innerHTML = s.caption || '';
  }

  async render(s, token) {
    const kind = s.kind;
    if (kind === 'map') return this.renderMap(s, token);
    if (kind === 'chart') return this.renderChart(s, token);
    if (kind === 'lanes') return this.renderLanes(s, token);
    if (kind === 'swipe') return this.renderSwipe(s, token);
    if (kind === 'lapse') return this.renderLapse(s, token);
    return null;
  }

  selection(ds, s) {
    const filters = {};
    for (const [k, v] of Object.entries(s.filter || {})) filters[k] = [].concat(v);
    if (s.town) {
      const name = this.facts.get(`town.${s.town}.name`);
      if (name) filters.town = [name];
    }
    return ds.select({
      filters,
      from: s.from ? isoToDay(ds.epoch, s.from) : null,
      to: s.to ? isoToDay(ds.epoch, s.to) : null,
    });
  }

  async renderMap(s, token) {
    const code = s.type;
    if (!this.facts.sets.get(code) && !SLUGS[code]) {
      this.canvas.replaceChildren(el('p', { class: 'loading', text: 'This kind of record is not published.' }));
      return;
    }
    const ds = this.facts.sets.get(code) || (await dataset(SLUGS[code]));
    if (token !== this.token) return;

    if (!this.map) {
      this.mapEl = el('div', { class: 'stage-map' });
      this.canvas.replaceChildren(this.mapEl);
      this.map = lebanonMap(this.mapEl, { bounds: SOUTH });
      this.layers = [];
    }
    for (const layer of this.layers) this.map.removeLayer(layer);
    this.layers = [];
    if (this.legend) {
      this.map.removeControl(this.legend);
      this.legend = null;
    }

    const sel = this.selection(ds, s);
    // A town kind shades the town it names, whatever the chapter asks for;
    // every other kind is counted by town, one circle each. An older chapter's
    // points read as towns: the data hold no single record.
    const mode = TOWN_KINDS.has(code)
      ? s.mode === 'districts'
        ? 'districts'
        : 'villages'
      : s.mode === 'districts' || s.mode === 'villages'
        ? s.mode
        : 'towns';

    // Circles need ground under them, or they float on a blank page. The
    // ground is the municipality layer itself, drawn plain, so a town map and
    // a shaded map in the same investigation share one coastline and one set
    // of borders. A shaded map is its own ground and does not need it.
    if (mode === 'towns' && !this.ground) {
      const shapes = await geo('municipalities');
      if (token !== this.token) return;
      this.ground = choropleth(shapes, {}, { key: 'pcod', land: true }).addTo(this.map);
      this.ground.bringToBack();
    } else if (mode !== 'towns' && this.ground) {
      this.map.removeLayer(this.ground);
      this.ground = null;
    }
    if (mode === 'towns' && this.ground && !this.map.hasLayer(this.ground)) this.ground.addTo(this.map);

    if (mode === 'towns') {
      const layer = townLayer(ds.towns(sel), { code }).addTo(this.map);
      autoScale(this.map, [layer]);
      this.layers.push(layer);
      const word = kindNoun(code, 2);
      this.legend = legend(
        sizeLegendHTML({
          code,
          title: s.legend || `${word.charAt(0).toUpperCase()}${word.slice(1)} per town`,
          peak: townPeak(ds),
        })
      ).addTo(this.map);
    } else {
      const column = mode === 'districts' ? 'adm2' : 'municipality';
      const shapes = await geo(mode === 'districts' ? 'districts' : 'municipalities');
      if (token !== this.token) return;
      const counts = {};
      for (const g of ds.group(sel, column)) {
        if (g.key !== '__none__' && g.key !== '__other__') counts[g.key] = g.n;
      }
      // One kind of record, so its own colour, from a wash to the full hue.
      const ramp = typeRamp(code);
      const layer = choropleth(shapes, counts, {
        key: 'pcod',
        unit: 'records',
        land: true,
        ramp,
        format: (v) => countLabel(code, v),
      }).addTo(this.map);
      this.layers.push(layer);
      this.legend = legend(rampLegendHTML(layer.__peak, s.legend || 'Records', null, ramp)).addTo(this.map);
    }

    for (const extra of (s.layers || '').split(',').filter(Boolean)) {
      if (extra === 'zones') this.layers.push(zoneLayer(await geo('zones')).addTo(this.map));
      // Burned ground is merged by month, so it follows the chapter's dates only.
      if (extra === 'scars') {
        this.layers.push(burnedLayer(await geo('burned'), { from: s.from || null, to: s.to || null }).addTo(this.map));
      }
    }
    if (token !== this.token) return;

    // Framing: a named box, a town's own frame, or the default south.
    if (s.fit === 'lebanon') this.map.setBoundsAndRefit(LEBANON);
    else if (s.fit && s.fit.startsWith('town')) {
      const towns = (await villages()).towns;
      const t = towns.find((x) => String(x.id) === String(s.town || s.fit.split(':')[1]));
      if (t && t.box) this.map.setBoundsAndRefit([[t.box[1], t.box[0]], [t.box[3], t.box[2]]]);
    } else this.map.setBoundsAndRefit(SOUTH);
  }

  async renderChart(s, token) {
    if (!this.facts.sets.get(s.type) && !SLUGS[s.type]) {
      this.canvas.replaceChildren(el('p', { class: 'loading', text: 'This kind of record is not published.' }));
      return;
    }
    const ds = this.facts.sets.get(s.type) || (await dataset(SLUGS[s.type]));
    if (token !== this.token) return;
    const sel = this.selection(ds, s);
    const wanted = s.chart || 'timeline';
    if (!this.chart || this.chartKind !== wanted) {
      this.chartEl = el('div', { class: 'chart stage-chart' });
      this.canvas.replaceChildren(this.chartEl);
      this.chart = wanted === 'stacked' ? stacked(this.chartEl) : timeline(this.chartEl);
      this.chartKind = wanted;
    }
    if (wanted === 'stacked') {
      // A column the data no longer carries falls back to the type's own.
      const dim = s.dim && ds.at[s.dim] != null ? s.dim : defaultDim(ds);
      this.chart.update(ds.seriesBy(sel, dim, { grain: 'month', limit: 6 }));
    } else {
      this.chart.update(ds.series(sel, { grain: 'month' }), { grain: 'month' });
    }
  }

  async renderLanes(s, token) {
    // A kind that is not published (a hidden one an older chapter names) is
    // left out rather than drawn as an empty lane.
    const codes = s.types ? s.types.split(',') : LANE_KINDS;
    const sets = codes.map((c) => this.facts.sets.get(c)).filter(Boolean);
    if (token !== this.token || !sets.length) return;
    const firstDays = sets.map((d) => dayToISO(d.epoch, d.minDay)).sort();
    const lastDays = sets.map((d) => dayToISO(d.epoch, d.maxDay)).sort();
    const months = monthsBetween(s.from || firstDays[0], s.to || lastDays[lastDays.length - 1]);
    const series = sets.map((d) => {
      const sel = this.selection(d, s);
      const counts = new Map(d.series(sel, { grain: 'month' }).map((b) => [b.key, b.n]));
      return { code: d.code, label: d.label, total: d.size(sel), counts: months.map((m) => counts.get(m) || 0) };
    });
    if (!this.lanes) {
      this.lanesEl = el('div', { class: 'chart stage-chart' });
      this.canvas.replaceChildren(this.lanesEl);
      this.lanes = lanes(this.lanesEl);
    }
    this.lanes.update(series, { months });
  }

  async renderSwipe(s, token) {
    if (this.swiped === s.town) return;
    const pairs = (await ongeo()).villages || [];
    if (token !== this.token) return;
    const entry = pairs.find((v) => String(v.city_id) === String(s.town));
    if (!entry || !entry.compare) {
      this.canvas.replaceChildren(el('p', { class: 'loading', text: 'No before and after pair for this town.' }));
      return;
    }
    const host = el('div');
    this.canvas.replaceChildren(host);
    swipe(host, { ...entry.compare, town: entry.name }, { base: ROOT, startAt: s.split ?? 0.5 });
    this.swiped = s.town;
  }

  async renderLapse(s, token) {
    if (this.lapsed === s.town) return;
    const index = await timelapseIndex();
    if (token !== this.token) return;
    const entry = (index.towns || []).find((t) => String(t.city_id) === String(s.town));
    if (!entry) {
      this.canvas.replaceChildren(el('p', { class: 'loading', text: 'No satellite sequence for this town.' }));
      return;
    }
    const base = new URL(`assets/timelapse/${entry.slug}/`, ROOT);
    const manifest = await fetch(new URL('frames.json', base)).then((r) => r.json());
    if (token !== this.token) return;
    const host = el('div');
    this.canvas.replaceChildren(host);
    timelapse(host, manifest, { base, speed: 1000 });
    this.lapsed = s.town;
  }
}

/* ------------------------------------------------------------------ page */

/**
 * Wire an investigation page.
 *
 * Reads which types and towns the page mentions from its own markup, loads the
 * facts once, fills every figure, builds a stage per chapter, and moves each
 * stage as its steps come into view.
 */
export async function investigationPage() {
  const root = document.getElementById('investigation');
  if (!root) return;

  const codes = new Set();
  const towns = new Set();
  for (const node of root.querySelectorAll('[data-fig]')) {
    const parts = node.dataset.fig.split('.');
    if (parts[0] === 'town') {
      towns.add(parts[1]);
      if (parts[2] && SLUGS[parts[2]]) codes.add(parts[2]);
    } else if (SLUGS[parts[0]]) codes.add(parts[0]);
  }
  for (const node of root.querySelectorAll('[data-stage],[data-state]')) {
    const spec = JSON.parse(node.dataset.stage || node.dataset.state || '{}');
    if (spec.type) codes.add(spec.type);
    if (spec.town) towns.add(String(spec.town));
    for (const c of (spec.types || '').split(',').filter(Boolean)) codes.add(c);
  }
  // Lanes default to every published type.
  if (root.querySelector('[data-stage*="lanes"]')) {
    for (const c of LANE_KINDS) codes.add(c);
  }

  const facts = new Facts();
  await facts.load(codes, towns);

  const pairs = new Set();
  for (const node of root.querySelectorAll('[data-fig^="seq."]')) {
    const [, a, b] = node.dataset.fig.split('.');
    pairs.add(`${a}.${b}`);
  }
  for (const pair of pairs) facts.sequence(...pair.split('.'));

  facts.fill(root, { skipWindows: true });

  // A block can ask for its figures over a window: data-window="2024-10-01..2024-11-26".
  for (const block of root.querySelectorAll('[data-window]')) {
    const [from, to] = block.dataset.window.split('..');
    facts.windowed(from || null, to || null).fill(block);
  }

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  for (const chapter of root.querySelectorAll('.chapter[data-stage]')) {
    const stageHost = chapter.querySelector('.stage');
    const stage = new Stage(stageHost, JSON.parse(chapter.dataset.stage), facts);
    const steps = [...chapter.querySelectorAll('.step')];
    let active = null;

    const activate = (step) => {
      if (step === active) return;
      active = step;
      for (const s of steps) s.classList.toggle('is-active', s === step);
      stage.show(JSON.parse(step.dataset.state || '{}'));
    };

    if (!steps.length) {
      stage.show({});
      continue;
    }

    // The step whose middle crosses the middle of the viewport is the active
    // one. A thin band rather than a threshold, so exactly one step is live at
    // a time and a fast scroll does not fire every step on the way past.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) activate(entry.target);
      },
      { rootMargin: '-48% 0px -48% 0px', threshold: 0 }
    );
    steps.forEach((s) => observer.observe(s));
    activate(steps[0]);

    if (reduce) chapter.classList.add('no-motion');
  }

  // Footnote-style figure check: every live figure says where it came from.
  for (const node of root.querySelectorAll('.fig')) {
    node.title = node.title || `Live from the data snapshot of ${facts.get('meta.snapshot')}`;
  }
}
