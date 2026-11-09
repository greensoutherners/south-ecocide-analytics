/* A town watched from orbit, one frame per clear pass.
 *
 * The rest of this site counts things. This is the one view where the war is
 * visible as something that happened: play it and the fields change colour, a
 * burn scar appears and fades over a few weeks, a block goes grey and stays
 * grey.
 *
 * Built from flat JPEGs rather than a video so the sequence can be paused on a
 * date, scrubbed back and forth and linked to. The cost is one request per
 * frame, which is why the player preloads around the cursor instead of waiting
 * for the whole sequence, and why a frame that has not arrived yet holds the
 * previous one on screen rather than flashing to white.
 *
 * The dates are uneven on purpose. Sentinel-2 passes every few days but a
 * cloudy pass is no picture at all, so a gap in the sequence is weather, not
 * an absence of events. The player says so and the scrubber is spaced by
 * position rather than by time, so nothing about the drawing implies a
 * regular interval.
 */

import { dateLabel } from './data.js';
import { el } from './ui.js';

const SPEEDS = [
  { value: 1600, label: 'Slow' },
  { value: 1000, label: '1 a second' },
  { value: 450, label: 'Fast' },
];

const PRELOAD = 4;

/**
 * Build a player.
 *
 * `manifest` is a town's `frames.json`; `base` is the URL its frames sit under.
 */
export function timelapse(host, manifest, { base, speed = 1000, autoplay = false } = {}) {
  const frames = manifest.frames || [];
  if (!frames.length) return null;

  const state = { index: 0, playing: false, speed };
  let timer = null;

  /* ---------------------------------------------------------------- parts */

  const stage = el('div', { class: 'lapse-stage' });
  const images = frames.map((frame, i) =>
    el('img', {
      class: 'lapse-img',
      alt: `${manifest.town}, ${frame.d}`,
      draggable: 'false',
      src: i === 0 ? new URL(frame.f, base).href : null,
    })
  );
  images[0].classList.add('on');
  stage.append(...images);

  const stamp = el('div', { class: 'lapse-stamp' }, [
    el('b', { text: dateLabel(frames[0].d) }),
    el('i', { text: `1 of ${frames.length}` }),
  ]);
  stage.append(stamp);

  const playButton = el('button', { class: 'btn primary lapse-play', type: 'button' });
  const range = el('input', {
    type: 'range',
    class: 'lapse-range',
    min: '0',
    max: String(frames.length - 1),
    value: '0',
    step: '1',
    'aria-label': 'Satellite pass',
  });

  const speedSelect = el('select', { class: 'lapse-speed', 'aria-label': 'Speed' });
  for (const s of SPEEDS) {
    speedSelect.append(el('option', { value: String(s.value), text: s.label, selected: s.value === state.speed }));
  }
  speedSelect.addEventListener('change', () => {
    state.speed = Number(speedSelect.value);
    if (state.playing) {
      pause(true);
      play();
    }
  });

  /* ---------------------------------------------------------------- logic */

  function ensure(i) {
    const img = images[i];
    if (img && !img.src) img.src = new URL(frames[i].f, base).href;
  }

  function show(i) {
    state.index = Math.max(0, Math.min(frames.length - 1, i));
    for (let n = state.index - 1; n <= state.index + PRELOAD; n++) {
      if (n >= 0 && n < frames.length) ensure(n);
    }
    images.forEach((img, n) => img.classList.toggle('on', n === state.index));
    stamp.replaceChildren(
      el('b', { text: dateLabel(frames[state.index].d) }),
      el('i', { text: `${state.index + 1} of ${frames.length}` })
    );
    range.value = String(state.index);
  }

  function step() {
    show(state.index >= frames.length - 1 ? 0 : state.index + 1);
  }

  function play() {
    if (state.playing) return;
    state.playing = true;
    if (state.index >= frames.length - 1) show(0);
    timer = setInterval(step, state.speed);
    render();
  }

  function pause(quiet = false) {
    state.playing = false;
    if (timer) clearInterval(timer);
    timer = null;
    if (!quiet) render();
  }

  function render() {
    playButton.textContent = state.playing ? '■  Pause' : '▶  Play';
  }

  playButton.addEventListener('click', () => (state.playing ? pause() : play()));
  range.addEventListener('input', () => {
    pause();
    show(Number(range.value));
  });

  host.replaceChildren(
    el('div', { class: 'lapse' }, [
      stage,
      el('div', { class: 'lapse-bar' }, [playButton, range, speedSelect]),
      el('p', {
        class: 'card-note',
        // A sequence chosen by hand (one pass a month, say) says how it was chosen.
        text: manifest.card_note ||
          `${frames.length} clear passes between ${dateLabel(frames[0].d)} and ` +
          `${dateLabel(frames[frames.length - 1].d)}. The gaps are cloud, not quiet weeks: ` +
          'a cloudy pass is no picture at all. What a frame shows is the ground on that ' +
          'day, not what changed it.',
      }),
    ])
  );

  // Warm the opening frames before anyone presses play. Without this the
  // first second or two of a sequence is the black stage while the browser
  // fetches, which reads as a fault rather than as loading.
  for (let i = 0; i < Math.min(frames.length, PRELOAD + 2); i++) ensure(i);

  show(0);
  render();
  if (autoplay) play();

  return {
    play,
    pause,
    show,
    destroy: () => pause(true),
    get playing() {
      return state.playing;
    },
  };
}
