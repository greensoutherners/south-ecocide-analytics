/* The time scrubber: a play head that moves through the war and takes the
 * whole page with it.
 *
 * The corpus is a record of events in time, and a page that shows only the
 * total shows the one thing the data is least interesting about. Pressing play
 * here moves a month cursor forward and every chart, every figure and the map
 * redraw for that moment, so the shape of the war is watched rather than read
 * off a bar chart.
 *
 * Two ways of reading time, and they answer different questions:
 *
 *   - **Building up** keeps everything from the start to the cursor. The map
 *     fills in, and what you watch is the record accumulating: where the corpus
 *     has reached by March 2026.
 *   - **Month by month** keeps only the cursor's own month. The map empties and
 *     refills, and what you watch is where the war was at that moment.
 *
 * Neither is the "right" one, so both are offered and the label always says
 * which is on. A reader who sees a filling map and thinks it is a single month
 * has been misled by the page, not by the data.
 */

import { monthLabel } from './data.js';
import { el } from './ui.js';

const SPEEDS = [
  { value: 900, label: 'Slow' },
  { value: 500, label: 'Normal' },
  { value: 220, label: 'Fast' },
];

/**
 * Build a scrubber.
 *
 * `months` is every month the type covers, oldest first. `onChange(from, to)`
 * is called with the ISO day bounds of the current cursor, and is the only way
 * this talks to the page.
 */
export function scrubber(host, months, onChange, { mode = 'cumulative', label = 'records' } = {}) {
  if (!months.length) return null;

  const state = {
    index: months.length - 1,
    mode,
    speed: 500,
    playing: false,
  };
  let timer = null;

  /* ---------------------------------------------------------------- parts */

  const range = el('input', {
    type: 'range',
    min: '0',
    max: String(months.length - 1),
    value: String(state.index),
    step: '1',
    class: 'scrub-range',
    'aria-label': 'Month',
  });

  const playButton = el('button', {
    class: 'btn primary scrub-play',
    type: 'button',
    'aria-label': 'Play the timeline',
  });

  const readout = el('div', { class: 'scrub-readout' });
  const ticks = el('div', { class: 'scrub-ticks' });

  const modeButtons = el('div', { class: 'chips' }, [
    modeChip('cumulative', 'Building up'),
    modeChip('month', 'Month by month'),
  ]);

  function modeChip(value, text) {
    return el('button', {
      class: 'chip',
      type: 'button',
      'aria-pressed': state.mode === value ? 'true' : 'false',
      text,
      onclick: () => {
        state.mode = value;
        [...modeButtons.children].forEach((b, i) =>
          b.setAttribute('aria-pressed', (i === 0) === (value === 'cumulative') ? 'true' : 'false')
        );
        emit();
      },
    });
  }

  const speedSelect = el('select', { 'aria-label': 'Speed', class: 'scrub-speed' });
  for (const s of SPEEDS) {
    speedSelect.append(el('option', { value: String(s.value), text: s.label, selected: s.value === state.speed }));
  }
  speedSelect.addEventListener('change', () => {
    state.speed = Number(speedSelect.value);
    if (state.playing) {
      stop(true);
      play();
    }
  });

  /* ---------------------------------------------------------------- logic */

  function bounds() {
    const to = lastDayOf(months[state.index]);
    const from = state.mode === 'cumulative' ? `${months[0]}-01` : `${months[state.index]}-01`;
    return [from, to];
  }

  function emit() {
    const [from, to] = bounds();
    readout.replaceChildren(
      el('b', { text: monthLabel(months[state.index]) }),
      el('span', {
        class: 'scrub-sub',
        text:
          state.mode === 'cumulative'
            ? `everything up to this month`
            : `this month only`,
      })
    );
    range.value = String(state.index);
    onChange(from, to, { index: state.index, month: months[state.index], mode: state.mode });
  }

  function step() {
    if (state.index >= months.length - 1) {
      // Hold on the last month for a beat, then run again from the start:
      // a loop makes the shape of three years readable on a second viewing.
      state.index = 0;
    } else {
      state.index += 1;
    }
    emit();
  }

  function play() {
    if (state.playing) return;
    state.playing = true;
    // Starting from the end would show one frame and stop, so a play from the
    // last month rewinds first.
    if (state.index >= months.length - 1) state.index = 0;
    emit();
    timer = setInterval(step, state.speed);
    render();
  }

  function stop(quiet = false) {
    state.playing = false;
    if (timer) clearInterval(timer);
    timer = null;
    if (!quiet) render();
  }

  function render() {
    playButton.textContent = state.playing ? '■  Pause' : '▶  Play';
    playButton.setAttribute('aria-label', state.playing ? 'Pause the timeline' : 'Play the timeline');
  }

  playButton.addEventListener('click', () => (state.playing ? stop() : play()));

  range.addEventListener('input', () => {
    stop();
    state.index = Number(range.value);
    emit();
  });

  // The arrow keys step a month at a time once the scrubber has focus.
  range.addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) stop();
  });

  /* Year marks under the track, so the cursor has something to be at. */
  const years = [];
  months.forEach((m, i) => {
    const year = m.slice(0, 4);
    if (!years.length || years[years.length - 1].year !== year) {
      years.push({ year, index: i });
    }
  });
  const crowded = years.length > 1 && years[1].index - years[0].index < Math.max(4, months.length * 0.09);
  ticks.replaceChildren(
    ...years.map((y, i) =>
      el('span', {
        class: 'scrub-tick',
        style: `left:${(y.index / Math.max(1, months.length - 1)) * 100}%`,
        text: i === 0 && crowded ? '' : y.year,
        title: y.year,
      })
    )
  );

  host.replaceChildren(
    el('div', { class: 'scrub' }, [
      el('div', { class: 'scrub-top' }, [playButton, readout, modeButtons, speedSelect]),
      el('div', { class: 'scrub-track' }, [range, ticks]),
      el('p', {
        class: 'scrub-note',
        text:
          'Press play to run the whole period. Everything on this page follows the ' +
          'cursor: the figures, the charts and the map.',
      }),
    ])
  );

  render();
  emit();

  return {
    play,
    stop,
    /** Move to a month, without playing. */
    goTo(month) {
      const i = months.indexOf(month);
      if (i >= 0) {
        stop();
        state.index = i;
        emit();
      }
    },
    /** Show the whole period again and stop. */
    reset() {
      stop();
      state.mode = 'cumulative';
      state.index = months.length - 1;
      [...modeButtons.children].forEach((b, i) => b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false'));
      emit();
    },
    get playing() {
      return state.playing;
    },
    destroy: () => stop(true),
  };
}

/** Every month between two ISO days, inclusive, oldest first. */
export function monthsBetween(first, last) {
  if (!first || !last) return [];
  const out = [];
  let [y, m] = first.slice(0, 7).split('-').map(Number);
  const [ly, lm] = last.slice(0, 7).split('-').map(Number);
  for (let guard = 0; guard < 600; guard++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (y === ly && m === lm) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function lastDayOf(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
