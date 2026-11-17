/* Every part of one sharp picture, one pair at a time.
 *
 * A village's newest high-resolution picture is cut into a grid of parts
 * (`tools/publish/village_imagery.py parts`), each beside the same ground before
 * the war. This draws the overview with the grid, a button per part, and the
 * pair of the part chosen under its handle, with its outlines shown or hidden.
 * Only files under assets/posts/ are read.
 */

import { ROOT, dateLabel } from './data.js';
import { swipe } from './compare.js';
import { el, fill, params } from './ui.js';

export async function partsWidget(mount) {
  const q = params();
  const src = String(q.src || '');
  if (!/^assets\/posts\/[a-z0-9/_-]+\/index\.json$/.test(src)) {
    fill(mount, el('div', { class: 'error', text: 'No set of parts named.' }));
    return;
  }
  const index = await fetch(new URL(src, ROOT)).then((r) => {
    if (!r.ok) throw new Error(`${src}: ${r.status}`);
    return r.json();
  });
  const parts = index.parts || [];
  if (!parts.length) {
    fill(mount, el('div', { class: 'error', text: 'This set has no parts.' }));
    return;
  }
  let at = Math.max(0, parts.findIndex((p) => p.name === q.part));
  let marked = q.marked !== '0';
  const overview = el('div', { class: 'pw-overview' });
  const img = el('img', { src: new URL(index.overview, ROOT).href, alt: `${index.town}, the parts of the picture`, draggable: 'false' });
  overview.append(img);
  const buttons = el('div', { class: 'pw-buttons', role: 'group', 'aria-label': 'Parts of the picture' });
  const head = el('div', { class: 'pw-head' });
  const host = el('div', { class: 'pw-pair' });
  const note = el('p', { class: 'card-note pw-note' });
  const toggle = el('button', { type: 'button', class: 'btn', 'aria-pressed': String(marked) });
  fill(mount, el('div', { class: 'pw' }, [
    el('div', { class: 'pw-side' }, [overview, buttons, toggle]),
    el('div', { class: 'pw-main' }, [head, host, note]),
  ]));

  // the grid drawn over the overview, as buttons too, so a part can be chosen on the picture
  const [W, S, E, N] = bounds(parts);
  const boxes = parts.map((p, i) => {
    const [w, s, e, n] = p.bounds;
    const b = el('button', {
      type: 'button',
      class: 'pw-box',
      'aria-label': `Part ${p.name}`,
      style: `left:${((w - W) / (E - W)) * 100}%;top:${((N - n) / (N - S)) * 100}%;width:${((e - w) / (E - W)) * 100}%;height:${((n - s) / (N - S)) * 100}%`,
      onclick: () => show(i),
    }, [el('span', { text: p.name })]);
    overview.append(b);
    return b;
  });
  const chips = parts.map((p, i) => el('button', { type: 'button', class: 'btn pw-chip', text: p.name, onclick: () => show(i) }));
  buttons.append(...chips);

  let view = null;
  async function show(i) {
    at = i;
    const p = parts[i];
    boxes.forEach((b, k) => b.classList.toggle('on', k === i));
    chips.forEach((b, k) => {
      b.classList.toggle('primary', k === i);
      b.setAttribute('aria-pressed', String(k === i));
    });
    const pair = await fetch(new URL(p.file, ROOT)).then((r) => r.json());
    fill(head, el('b', { text: `Part ${p.name}` }), el('span', { text: `${dateLabel(pair.before_label)} and ${dateLabel(pair.after_label)}, about ${pair.ground_m} m across` }));
    host.replaceChildren();
    view = swipe(host, pair, { base: ROOT, marked });
    note.textContent = `Drag the handle. Earlier: ${pair.before_source}. Later: ${pair.after_source}. ${pair.note || ''}`;
    const url = new URL(location.href);
    url.searchParams.set('part', p.name);
    history.replaceState(null, '', url);
  }
  function label() {
    toggle.textContent = `${marked ? 'Hide' : 'Show'} the outlines`;
    toggle.setAttribute('aria-pressed', String(marked));
  }
  toggle.addEventListener('click', () => {
    marked = !marked;
    if (view) view.showMarks(marked);
    label();
  });
  label();
  await show(at);
}

function bounds(parts) {
  const bs = parts.map((p) => p.bounds);
  return [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))];
}
