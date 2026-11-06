/* The timeline strip along the foot of the platform and the investigations.
 *
 * One horizontal axis of days, from the war's first day to the corpus's last.
 * Across the top, the war's periods as bands. Under them one lane per kind of
 * record, each a row of small bars counting that kind's records per week, in
 * its own colour and never stacked onto another kind. Over the lanes, the
 * window the map is showing: drag it, drag its edges, or drag anywhere else to
 * draw a new one, and press play to walk it forward.
 *
 * Two ways to play. "Up to" grows the window from the first day, so the map
 * fills as the war goes on; "window" keeps its width and slides it, so the
 * map shows a moving month. The readout says which, and the dates, in words.
 */

import { dateLabel } from './data.js';
import { palette } from './theme.js';

const DAY = 86400000;
const NS = 'http://www.w3.org/2000/svg';
const LANE_H = 13;
const LANE_GAP = 3;
const BAND_H = 18;
const AXIS_H = 16;
const PAD_X = 10;

export function toDay(iso) {
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);
}

export function fromDay(day) {
  return new Date(day * DAY).toISOString().slice(0, 10);
}

/**
 * Build the strip in `host`.
 *
 * `start`/`end` are ISO dates of the whole axis. `onChange({from, to})` gets ISO
 * dates whenever the window moves. Returns a handle with `setLanes(lanes)`,
 * `setRange(from, to)`, `play()`, `stop()` and `range()`.
 */
export function strip(host, { start, end, periods = [], onChange = () => {}, mode = 'cumulative', label = '' } = {}) {
  const d0 = toDay(start);
  const d1 = toDay(end);
  const state = {
    from: d0,
    to: d1,
    mode,
    width: 30,
    lanes: [],
    playing: false,
    timer: null,
  };

  host.classList.add('strip');
  host.innerHTML = '';

  const controls = el('div', 'strip-controls');
  const playButton = button('strip-play', 'Play the timeline', '▶');
  const back = button('strip-step', 'Step back', '‹');
  const fwd = button('strip-step', 'Step forward', '›');
  const modeSelect = document.createElement('select');
  modeSelect.className = 'strip-mode';
  modeSelect.setAttribute('aria-label', 'How the timeline plays');
  for (const [value, text] of [
    ['cumulative', 'Everything up to the date'],
    ['30', 'A 30-day window'],
    ['90', 'A 90-day window'],
  ]) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    modeSelect.append(o);
  }
  modeSelect.value = mode === 'cumulative' ? 'cumulative' : String(state.width);
  const readout = el('div', 'strip-readout');
  readout.setAttribute('aria-live', 'polite');
  const reset = button('strip-reset', 'Show the whole period', 'All dates');
  controls.append(playButton, back, fwd, modeSelect, readout, reset);

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'strip-svg');
  svg.setAttribute('role', 'slider');
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('aria-label', label || 'Timeline: drag to choose the dates the map shows');
  host.append(controls, svg);

  let width = host.clientWidth || 800;
  const x = (day) => PAD_X + ((day - d0) / Math.max(1, d1 - d0)) * (width - 2 * PAD_X);
  const dayAt = (px) => Math.round(d0 + ((px - PAD_X) / Math.max(1, width - 2 * PAD_X)) * (d1 - d0));
  const clamp = (day) => Math.min(d1, Math.max(d0, day));

  function height() {
    return BAND_H + AXIS_H + Math.max(1, state.lanes.length) * (LANE_H + LANE_GAP) + 6;
  }

  function draw() {
    const p = palette();
    width = Math.max(320, host.clientWidth || width);
    const h = height();
    svg.setAttribute('viewBox', `0 0 ${width} ${h}`);
    svg.setAttribute('width', width);
    svg.setAttribute('height', h);
    svg.replaceChildren();

    // Period bands.
    periods.forEach((period, i) => {
      const a = clamp(toDay(period.from));
      const b = clamp(period.to ? toDay(period.to) : d1);
      if (b <= a) return;
      const band = rect(x(a), 0, x(b) - x(a), BAND_H, i % 2 ? p.plane : p.hairline);
      band.setAttribute('opacity', i % 2 ? '1' : '0.55');
      svg.append(band);
      const t = text(x(a) + 6, 12.5, period.label, p.ink2, 10.5);
      t.setAttribute('font-weight', '600');
      clip(t, x(b) - x(a) - 8);
      svg.append(t);
    });

    // Year and month ticks.
    const top = BAND_H;
    const first = new Date(d0 * DAY);
    for (let y = first.getUTCFullYear(); y <= new Date(d1 * DAY).getUTCFullYear(); y++) {
      for (let m = 0; m < 12; m++) {
        const day = Math.round(Date.UTC(y, m, 1) / DAY);
        if (day < d0 || day > d1) continue;
        const px = x(day);
        const line = rect(px, top, 1, m === 0 ? AXIS_H : 4, m === 0 ? p.axis : p.hairline);
        svg.append(line);
        if (m === 0) svg.append(text(px + 4, top + 12, String(y), p.ink3, 10.5));
      }
    }

    // Lanes: weekly bars per kind, each scaled to its own peak.
    const lanesTop = BAND_H + AXIS_H;
    state.lanes.forEach((lane, i) => {
      const y0 = lanesTop + i * (LANE_H + LANE_GAP);
      svg.append(rect(PAD_X, y0 + LANE_H - 0.5, width - 2 * PAD_X, 0.5, p.hairline));
      const peak = Math.max(1, ...lane.bins.map((b) => b[1]));
      const bw = Math.max(1, x(d0 + 7) - x(d0) - 0.6);
      for (const [day, n] of lane.bins) {
        if (!n) continue;
        const hgt = Math.max(1.5, (Math.sqrt(n / peak)) * (LANE_H - 1));
        const bar = rect(x(day), y0 + LANE_H - hgt, bw, hgt, lane.color);
        bar.setAttribute('opacity', day + 6 < state.from || day > state.to ? '0.28' : '0.95');
        svg.append(bar);
      }
      const name = text(width - PAD_X - 2, y0 + 10, lane.label, p.ink3, 9.5);
      name.setAttribute('text-anchor', 'end');
      name.setAttribute('paint-order', 'stroke');
      name.setAttribute('stroke', p.surface);
      name.setAttribute('stroke-width', '3');
      svg.append(name);
    });

    // The window.
    const bx = x(state.from);
    const bwid = Math.max(2, x(state.to) - bx);
    const brush = rect(bx, BAND_H, bwid, h - BAND_H, p.accent);
    brush.setAttribute('opacity', '0.1');
    brush.setAttribute('class', 'strip-brush');
    svg.append(brush);
    for (const edge of [bx, bx + bwid]) {
      const handle = rect(edge - 1.5, BAND_H, 3, h - BAND_H, p.accent);
      handle.setAttribute('class', 'strip-edge');
      svg.append(handle);
    }
    const head = rect(x(state.to) - 1, 0, 2, h, p.ink1);
    head.setAttribute('opacity', '0.75');
    svg.append(head);

    svg.setAttribute('aria-valuetext', `${dateLabel(fromDay(state.from))} to ${dateLabel(fromDay(state.to))}`);
    readout.textContent = describe();
  }

  function describe() {
    const a = dateLabel(fromDay(state.from));
    const b = dateLabel(fromDay(state.to));
    if (state.from === d0 && state.to === d1) return `All dates, ${a} to ${b}`;
    if (state.from === d0) return `Up to ${b}`;
    return `${a} to ${b}`;
  }

  function emit() {
    draw();
    onChange({ from: fromDay(state.from), to: fromDay(state.to) });
  }

  function set(from, to, quiet = false) {
    let a = clamp(Math.min(from, to));
    let b = clamp(Math.max(from, to));
    if (b - a < 1) b = Math.min(d1, a + 1);
    if (b - a < 1) a = Math.max(d0, b - 1);
    state.from = a;
    state.to = b;
    if (quiet) draw();
    else emit();
  }

  /* ------------------------------------------------------------- dragging */

  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    stop();
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * width;
    const day = dayAt(px);
    const fx = x(state.from);
    const tx = x(state.to);
    if (Math.abs(px - fx) < 7) drag = { kind: 'from' };
    else if (Math.abs(px - tx) < 7) drag = { kind: 'to' };
    else if (px > fx && px < tx) drag = { kind: 'move', offset: day - state.from, span: state.to - state.from };
    else drag = { kind: 'new', anchor: day, moved: false };
    drag.startX = e.clientX;
    svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = svg.getBoundingClientRect();
    const day = dayAt(((e.clientX - r.left) / r.width) * width);
    if (drag.kind === 'from') set(day, state.to, true);
    else if (drag.kind === 'to') set(state.from, day, true);
    else if (drag.kind === 'move') {
      const a = clamp(day - drag.offset);
      const b = a + drag.span;
      if (b <= d1) set(a, b, true);
    } else if (Math.abs(e.clientX - drag.startX) > 3) {
      drag.moved = true;
      set(drag.anchor, day, true);
    }
  });
  const release = (e) => {
    if (!drag) return;
    if (drag.kind === 'new' && !drag.moved) {
      // A click moves the play head to that day, keeping the way it plays.
      const r = svg.getBoundingClientRect();
      const day = dayAt(((e.clientX - r.left) / r.width) * width);
      if (state.mode === 'cumulative') set(d0, day, true);
      else set(day - state.width, day, true);
    }
    drag = null;
    emit();
  };
  svg.addEventListener('pointerup', release);
  svg.addEventListener('pointercancel', release);
  svg.addEventListener('dblclick', () => set(d0, d1));
  svg.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 30 : 7;
    if (e.key === 'ArrowRight') stepBy(step);
    else if (e.key === 'ArrowLeft') stepBy(-step);
    else if (e.key === 'Home') set(d0, state.mode === 'cumulative' ? d0 + 1 : d0 + state.width);
    else if (e.key === 'End') set(state.mode === 'cumulative' ? d0 : d1 - state.width, d1);
    else return;
    e.preventDefault();
  });

  /* ------------------------------------------------------------- playing */

  function stepBy(days) {
    if (state.mode === 'cumulative') set(state.from, state.to + days);
    else {
      const span = state.to - state.from;
      let a = state.from + days;
      a = Math.min(Math.max(d0, a), d1 - span);
      set(a, a + span);
    }
  }

  function play() {
    if (state.playing) return stop();
    // From the beginning when the window is already at the end. The map is
    // redrawn at once, so the war builds up on a clear map rather than on the
    // colours of the whole period it was showing.
    if (state.to >= d1) {
      if (state.mode === 'cumulative') set(d0, d0 + 7);
      else set(d0, d0 + state.width);
    }
    state.playing = true;
    playButton.textContent = '❚❚';
    playButton.setAttribute('aria-label', 'Pause the timeline');
    const tick = () => {
      if (!state.playing) return;
      if (state.to >= d1) return stop();
      stepBy(7);
      state.timer = setTimeout(tick, 260);
    };
    state.timer = setTimeout(tick, 120);
  }

  function stop() {
    state.playing = false;
    clearTimeout(state.timer);
    playButton.textContent = '▶';
    playButton.setAttribute('aria-label', 'Play the timeline');
  }

  playButton.addEventListener('click', play);
  back.addEventListener('click', () => {
    stop();
    stepBy(-7);
  });
  fwd.addEventListener('click', () => {
    stop();
    stepBy(7);
  });
  reset.addEventListener('click', () => {
    stop();
    set(d0, d1);
  });
  modeSelect.addEventListener('change', () => {
    stop();
    if (modeSelect.value === 'cumulative') {
      state.mode = 'cumulative';
      set(d0, state.to);
    } else {
      state.mode = 'window';
      state.width = Number(modeSelect.value);
      set(state.to - state.width, state.to);
    }
  });

  new ResizeObserver(() => draw()).observe(host);
  draw();

  return {
    setLanes(lanes) {
      state.lanes = lanes;
      draw();
    },
    setRange(from, to, { quiet = false } = {}) {
      set(toDay(from || start), toDay(to || end), quiet);
    },
    setMode(next, days = 30) {
      state.mode = next;
      if (next !== 'cumulative') state.width = days;
      modeSelect.value = next === 'cumulative' ? 'cumulative' : String(days);
      draw();
    },
    play,
    stop,
    range: () => ({ from: fromDay(state.from), to: fromDay(state.to) }),
    get playing() {
      return state.playing;
    },
  };
}

/** Weekly bins over a list of day numbers: [[weekStartDay, n], ...]. */
export function weekly(days, start) {
  const d0 = toDay(start);
  const bins = new Map();
  for (const d of days) {
    if (d == null) continue;
    const w = d0 + Math.floor((d - d0) / 7) * 7;
    bins.set(w, (bins.get(w) || 0) + 1);
  }
  return [...bins.entries()].sort((a, b) => a[0] - b[0]);
}

function el(tag, cls) {
  const node = document.createElement(tag);
  node.className = cls;
  return node;
}

function button(cls, aria, label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.setAttribute('aria-label', aria);
  b.textContent = label;
  return b;
}

function rect(x, y, w, h, fill) {
  const r = document.createElementNS(NS, 'rect');
  r.setAttribute('x', x);
  r.setAttribute('y', y);
  r.setAttribute('width', Math.max(0, w));
  r.setAttribute('height', Math.max(0, h));
  r.setAttribute('fill', fill);
  return r;
}

function text(x, y, value, fill, size) {
  const t = document.createElementNS(NS, 'text');
  t.setAttribute('x', x);
  t.setAttribute('y', y);
  t.setAttribute('fill', fill);
  t.setAttribute('font-size', size);
  t.textContent = value;
  return t;
}

function clip(t, max) {
  // A band too narrow for its label shows none rather than an overprint.
  if (max < 40) t.textContent = '';
  else if (t.textContent.length * 5.6 > max) t.textContent = `${t.textContent.slice(0, Math.max(3, Math.floor(max / 5.6) - 1))}…`;
}
