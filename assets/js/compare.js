/* Two pictures of the same ground, and a handle between them.
 *
 * This replaced a pair of map layers, and it is better for the reason the
 * simplest thing usually is. A tile layer cannot promise it holds imagery
 * newer than the war for a given village; the reader had to find a zoom where
 * a destroyed house was larger than a pixel; and when one layer had no tile at
 * that zoom the two dates quietly stopped showing the same ground. Two flat
 * pictures, cut to one frame by `tools/publish/build_compare_images.py`, have
 * none of those problems: both are the same place at the same pixels, and the
 * only question left is where to put the handle.
 *
 * The dates are labelled by what they actually are. The later picture carries
 * the day it was taken, because an aerial sheet records that. The earlier one
 * carries the day its archive release was published, which is on or after the
 * day the picture was taken, so it is labelled as a release and not as a
 * capture.
 */

import { dateLabel } from './data.js';
import { el } from './ui.js';

/**
 * Build a swipe.
 *
 * `pair` is a village's `compare` entry: two image paths, two labels, and the
 * ground the frame covers.
 */
export function swipe(host, pair, { base, startAt = 0.5 } = {}) {
  const frame = el('div', { class: 'swipe' });

  const beforeImg = el('img', {
    class: 'swipe-img',
    src: new URL(pair.before, base).href,
    alt: `${pair.town || 'The village'}, ${pair.before_label}`,
    draggable: 'false',
  });
  const afterWrap = el('div', { class: 'swipe-after' });
  const afterImg = el('img', {
    class: 'swipe-img',
    src: new URL(pair.after, base).href,
    alt: `${pair.town || 'The village'}, ${pair.after_label}`,
    draggable: 'false',
  });
  afterWrap.append(afterImg);

  const handle = el('div', {
    class: 'swipe-handle',
    role: 'slider',
    tabindex: '0',
    'aria-label': 'Reveal the later picture',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
  }, [el('span', { class: 'grip' })]);

  const labels = el('div', { class: 'swipe-labels' }, [
    el('span', { class: 'before' }, [
      el('b', { text: dateLabel(pair.before_label) }),
      el('i', { text: pair.before_kind === 'release' ? 'archive release' : 'captured' }),
    ]),
    el('span', { class: 'after' }, [
      el('b', { text: dateLabel(pair.after_label) }),
      el('i', { text: pair.after_kind === 'captured' ? 'captured' : 'archive release' }),
    ]),
  ]);

  const loading = el('div', { class: 'swipe-loading', text: 'Loading the pictures…' });

  frame.append(beforeImg, afterWrap, handle, labels, loading);
  host.replaceChildren(frame);

  let loaded = 0;
  const done = () => {
    loaded += 1;
    if (loaded >= 2) loading.remove();
  };
  for (const img of [beforeImg, afterImg]) {
    if (img.complete) done();
    else {
      img.addEventListener('load', done);
      img.addEventListener('error', () => {
        loading.textContent = 'One of the pictures did not load.';
      });
    }
  }

  /* ---------------------------------------------------------------- split */

  let split = startAt;
  const apply = () => {
    // Clip the upper picture rather than resizing anything: the two stay
    // registered whatever the frame's width, and the browser does it on the
    // compositor so a drag stays smooth.
    afterWrap.style.clipPath = `inset(0 0 0 ${split * 100}%)`;
    handle.style.left = `${split * 100}%`;
    handle.setAttribute('aria-valuenow', String(Math.round(split * 100)));
  };

  const set = (value) => {
    split = Math.min(1, Math.max(0, value));
    apply();
  };

  const fromEvent = (e) => {
    const box = frame.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - box.left;
    set(x / box.width);
  };

  let dragging = false;
  const start = (e) => {
    dragging = true;
    frame.classList.add('dragging');
    stopSweep();
    fromEvent(e);
    e.preventDefault();
  };
  const move = (e) => {
    if (!dragging) return;
    fromEvent(e);
    e.preventDefault();
  };
  const end = () => {
    dragging = false;
    frame.classList.remove('dragging');
  };

  frame.addEventListener('pointerdown', start);
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);

  // The handle also takes the keyboard, so the comparison is usable without a
  // pointer at all.
  handle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowLeft') set(split - step);
    else if (e.key === 'ArrowRight') set(split + step);
    else if (e.key === 'Home') set(0);
    else if (e.key === 'End') set(1);
    else return;
    stopSweep();
    e.preventDefault();
  });

  /* ---------------------------------------------------------------- sweep */

  let raf = null;
  let t0 = 0;

  function sweep(ms = 3600) {
    stopSweep();
    t0 = performance.now();
    const tick = (t) => {
      const phase = ((t - t0) % ms) / ms;
      set(phase < 0.5 ? phase * 2 : 2 - phase * 2);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function stopSweep() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  apply();

  return {
    frame,
    set,
    sweep,
    stop() {
      stopSweep();
      set(0.5);
    },
    get sweeping() {
      return raf != null;
    },
  };
}
