/* Method and limits.
 *
 * The page a reader should open before quoting anything here. It is written
 * from the data files rather than hard-coded, so the type list, the windows and
 * the declared measures cannot drift from what the site is actually serving.
 */

import { dateLabel, fmt, meta, summary } from './data.js';
import { chrome, contactNote, el, failure, fill, loading, table, url } from './ui.js';

export async function aboutPage() {
  const mount = document.getElementById('page');
  mount.append(loading());

  try {
    const [metaPayload, summaryPayload] = await Promise.all([meta(), summary()]);
    await chrome('about', Promise.resolve(metaPayload));
    render(mount, { meta: metaPayload, summary: summaryPayload });
  } catch (err) {
    fill(mount, failure(err));
  }
}

function render(mount, { meta: metaPayload, summary: summaryPayload }) {
  const stamp = new Date(metaPayload.generated_at).toISOString().replace('T', ' ').slice(0, 16);
  const types = summaryPayload.types;

  mount.replaceChildren(
    el('div', { style: 'max-width:74ch' }, [
      el('h1', { text: 'Method and limits' }),
      el('p', {
        class: 'lede',
        text:
          'This site publishes figures from an OSINT corpus of the war in South Lebanon. ' +
          'What follows is what each figure rests on and, more usefully, what it does not ' +
          'establish. Read it before quoting a number.',
      }),

      section('How a record is made', [
        'Material is collected from Telegram channels, the Lebanese press, official ' +
          'statements, and from satellites directly: NASA FIRMS thermal detections, ' +
          'Copernicus Sentinel-2 imagery and Copernicus EFFIS burnt-area polygons. Fires ' +
          'run the opposite way to everything else: a satellite sees heat, the heat is ' +
          'clustered into an event, and the event becomes a record. Everything else begins ' +
          'with a human report.',
        'A report becomes a record only after a person has read it against a match rule ' +
          'that is deliberately narrow. The rule refuses, among other things, daily ' +
          'bulletins that merely list a village beside an unrelated word, operations ' +
          'communiqués describing attacks elsewhere, and place names that collide with ' +
          'ordinary Arabic words.',
        'Each record is then given sources, which are archived and hashed so a citation ' +
          'stays checkable after the original post is deleted.',
        'Fires are published here where the corpus links them to an Israeli military ' +
          'attack (an attack documented at the same town on a day of the fire, or a source ' +
          'that names the attack), and where they burned in the yellow-line zone or round ' +
          'Beaufort Castle, whatever lit them. The cause given is the attack: white ' +
          'phosphorus, an incendiary munition, illumination flares, or a fire lit by an ' +
          'explosion.',
      ]),

      section('What is published, and what is not', [
        'This site publishes statistics, not records. Each kind of record is counted by ' +
          'week, by town and by every documented column, with the measures that add up. No ' +
          'record, record number or single location is published.',
        'A week here runs from Monday, and is cut at the turn of a month so every month ' +
          'is exact. That is the finest grain any chart on the site holds.',
      ]),
      contactNote({ cls: 'contact-note' }),

      section('What is never done here', [
        'No figure is added across incident types. The corpus collects a few specific ' +
          'kinds of record, each over its own window and from its own sources. A combined ' +
          'total would measure what we looked for rather than what happened, and whoever ' +
          'quoted it would be quoting an artefact of our collection.',
        'No column is summed unless the corpus declares it additive. Hectares of burned ' +
          'ground add up. A count of records does not become a count of events.',
        'A record marked as a duplicate of another is excluded from every figure on this ' +
          'site, and is kept in the database rather than deleted.',
        'Absence is never published as a finding. A district with no shade on a map is ' +
          'outside the collection area; a town missing from the register is a town no ' +
          'record names. Neither is a statement that nothing happened there.',
      ]),

      section('What the maps show', [
        'A map here counts records by town. Each town is one circle at the town’s own ' +
          'point, its area growing with the records that name it in the view chosen. A ' +
          'circle places the town, never an event in it.',
        'How each record was placed is still counted, as a column: an exact location ' +
          '(placed by a sensor, a measured outline or a visual match) or an approximate one ' +
          '(known by its village only). For white phosphorus the same split reads as ' +
          'geolocated or not.',
        'Displacement orders are records about a whole town, so the maps shade the ' +
          'municipality they name.',
        'Burned ground is measured on Sentinel-2 passes either side of a fire and merged by ' +
          'the month the fires began, so it can be filtered by date and by nothing else.',
        'Village territories on these maps are Voronoi cells of locality points, a way ' +
          'of saying "roughly this village’s ground". They are drawn dashed because ' +
          'they are not cadastral or administrative boundaries.',
      ]),

      section('What the imagery shows', [
        'The before-and-after pictures on a village page pair an earlier archive picture ' +
          'with a later aerial picture read for the village damage report. Each is dated in ' +
          'its own label.',
        'An archive release date is the day the imagery was published, which is on or after ' +
          'the day it was captured. It dates the publication, not the overflight.',
        'The pictures show that ground changed between two dates. They do not by themselves ' +
          'show what caused the change.',
      ]),
    ]),

    el('div', { class: 'section', style: 'max-width:none' }, [
      el('h2', { text: 'The types, as published' }),
      el('div', { class: 'card' }, [
        table(
          [
            'Type',
            'Code',
            { label: 'Records', num: true },
            'Window',
            'Declared additive measures',
          ],
          types.map((t) =>
            el('tr', {}, [
              el('td', {}, [el('a', { href: url(`pages/${t.slug}.html`), text: t.label })]),
              el('td', { text: t.code }),
              el('td', { class: 'num', text: fmt(t.total) }),
              el('td', {
                text: t.date_range[0]
                  ? `${dateLabel(t.date_range[0])} to ${dateLabel(t.date_range[1])}`
                  : 'n/a',
              }),
              el('td', {
                text:
                  t.measures.map((m) => `${m.label} (${m.unit})`).join(', ') ||
                  'none, records are counted and nothing is summed',
              }),
            ])
          )
        ),
      ]),
    ]),

    el('div', { class: 'section', style: 'max-width:74ch' }, [
      el('h2', { text: 'Citing this' }),
      el('div', { class: 'card' }, [
        el('p', {
          text:
            'Every figure here is a snapshot. Counts rise as more material is collected and ' +
            'can fall when duplicates are folded together, so a citation needs the date of ' +
            'the snapshot it was read from.',
        }),
        el('pre', {
          style:
            'background:var(--plane);border:1px solid var(--hairline);border-radius:8px;' +
            'padding:12px 14px;font-size:.82rem;overflow-x:auto;white-space:pre-wrap',
          text:
            `Green Southerners, South Ecocide Analytics. Data of ${stamp} UTC.\n` +
            'https://greensoutherners.github.io/south-ecocide-analytics/',
        }),
        contactNote(),
      ]),
    ]),

    el('div', { class: 'section', style: 'max-width:74ch' }, [
      el('h2', { text: 'Outside layers and their licences' }),
      el('div', { class: 'card' }, [
        el(
          'ul',
          { style: 'margin:0;padding-inline-start:20px;font-size:.9rem;line-height:1.7' },
          Object.values(metaPayload.attribution).map((a) =>
            el('li', {}, [
              el('b', { text: `${a.title}: ` }),
              a.url ? el('a', { href: a.url, rel: 'noopener', text: a.org }) : a.org,
              ` (${a.license})`,
            ])
          )
        ),
      ]),
    ])
  );
}

function section(heading, paragraphs) {
  return el('div', { class: 'section' }, [
    el('h2', { text: heading }),
    ...paragraphs.map((t) => el('p', { text: t })),
  ]);
}
