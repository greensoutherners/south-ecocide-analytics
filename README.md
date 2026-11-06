# South Ecocide Analytics

Published statistics from the Green Southerners OSINT corpus of the war in
South Lebanon (fires, white phosphorus and forced displacement orders, in the
2026 war), as interactive pages and as widgets that embed in articles on
[greensoutherners.org](https://greensoutherners.org).

**Statistics, never records.** The site holds the records counted by town and by
week and by every documented column, with the same filters, maps and timeline;
it holds no record, no record id, no exact date or point of an event, and offers
no download of records. The records themselves are available from Green
Southerners on request: https://greensoutherners.org/contact-us. Detonations and
demolitions are not shown for now: their collection is not complete.

**Live:** https://greensoutherners.github.io/south-ecocide-analytics/

Plain HTML, CSS and JavaScript. No build step, no framework, no server: every
page reads JSON from `data/` in this same repository. Clone it and open it over
any static file server and it works.

---

## One repository, many pages

All of it lives here rather than in a repository per analytic. GitHub Pages
serves the whole tree, so every page already has a URL; one `data/` snapshot
means every page quotes the same figures with the same date on them; and the
stylesheet, the palette and the chart code are written once. A repository per
analytic would duplicate all of that and let the copies drift apart, which is
the one failure nobody would notice until a figure was quoted twice with two
different values.

```
index.html                 the catalogue: what exists, and where the data is
platform.html              the database: every kind of record on one map, counted by town (Mapbox or MapLibre)
investigations/            the investigations; I.02, I.05 and I.06 are told step by step
pages/
  overview.html            every type, counted apart
  timeline.html            the war month by month, one lane per type
  map.html                 every kind counted by town, with switchable ground layers
  villages.html            the register of towns
  village.html?v=<id>      one village: every type, and the imagery before and after
  about.html               method and limits
  fires|phosphorus|displacement.html
embed/
  index.html               the embed builder: the page the social team uses
  chart|map|stat|lanes|compare|lapse|explore.html    the widgets themselves
  story.html?story=<slug>  an investigation, step by step on the map
  host.js                  the one script greensoutherners.org needs
assets/
  css/site.css             design tokens, layout, components
  js/                      the data engine, charts, maps, and one module per page
  js/gl.js, gl-layers.js   the GL maps: base maps, the Lebanon mask, the corpus's layers
  js/config.js             the Mapbox public token, and room for Mapbox Studio styles
  vendor/                  ECharts, Leaflet, Mapbox GL JS and MapLibre GL JS, committed
data/                      the published figures, see "Refreshing the numbers"
  studio/                  the Village Studio's change layers, one file per town
  stories/                 the step-by-step investigations, written by build_stories
```

### The database and the Mapbox token

`platform.html` is a database in the manner of Forensic Architecture's: the
map, a panel of the towns in view with filters and a search, a card per town
with its counts, and a timeline along the foot that plays the war. Every mark
is a town, sized by its records in the dates chosen. The investigations told step by step
(`embed/story.html`) draw on the same map layers.

They draw with Mapbox GL JS and Mapbox's own tiles when `assets/js/config.js`
holds a Mapbox **public** token (`pk.`), and with MapLibre GL JS over
OpenFreeMap, Esri imagery and AWS terrain tiles when it does not, so the maps
work either way. Restrict the token to the site's addresses in the Mapbox
account. A Mapbox Studio style can replace either base map through
`MAPBOX.styles`.

Displacement orders that name a whole region rather than a town (everyone south
of the Zahrani or the Litani, Beirut's southern suburbs, Tyre and its camps, the
sea off Tyre) are drawn as violet areas with a dashed edge from
`data/geo/alr_regions.geojson`, each shown while one of its orders is in the
dates. The outlines are drawn from the orders' words, not from their maps; see
`docs/alr-region-areas.md` in the collection repository. In the address,
`focus=regions` frames Beirut to the border, `shade=none` leaves the
municipalities unshaded, `regions=0` hides the areas and `area=<key>` opens one.

### The time scrubber

Every type page, the timeline and each village profile carry a play head. Press
play and the cursor walks the months while the figures, the charts and the map
redraw at each step, so the shape of the war is watched rather than read off a
bar. Two readings are offered and the label always says which is on: **building
up** keeps everything from the start to the cursor, so the map fills in;
**month by month** keeps only that month, so it empties and refills. While the
head is moving the heavy views (the calendar, the tables) hold still and catch
up when it stops, which is what keeps it smooth.

### Adding a page

A type page is a nine-line HTML shell that calls `typePage('<slug>')`. There is
no per-type JavaScript: a type's shape (which columns may be grouped by, which
measures add up, what its caveats are) is declared once in the collection
repository and travels in `data/meta.json`.

---

## Embedding

Build one at **[/embed/](https://greensoutherners.github.io/south-ecocide-analytics/embed/)**,
or write the URL by hand: every widget takes its whole configuration from the
query string.

```html
<iframe src="https://greensoutherners.github.io/south-ecocide-analytics/embed/chart.html?type=fires&chart=timeline"
        style="width:100%;border:0;display:block;height:460px"
        title="Fires over time" loading="lazy" scrolling="no"></iframe>
```

Add this **once per site**, in the theme footer, and every embed sizes itself to
its content:

```html
<script src="https://greensoutherners.github.io/south-ecocide-analytics/embed/host.js" async></script>
```

A cross-origin iframe cannot size itself, so each widget measures its own
content and posts the height up; `host.js` listens and resizes the frame. It
ignores messages from any other origin, sets no globals and touches nothing else
on the page. Without it the frame keeps whatever height you gave it, which still
works, it just cannot grow.

| Widget | Draws | Key parameters |
|---|---|---|
| `chart.html` | timeline, donut, bars, stacked, towns, calendar | `type`, `chart`, `dim`, `measure`, `from`, `to`, `limit`, `grain` |
| `map.html` | Lebanon with one type | `type`, `mode=points\|towns\|villages\|districts`, `layers=villages,scars`, `basemap` |
| `stat.html` | one to three headline figures | `type`, `stat=records,towns,placed,<measure>` |
| `lanes.html` | every type, month by month | none |
| `compare.html` | one village, before and after | `v=<city id>`, `before`, `after`, `sweep=1` |

Common to all: `theme=light|dark` pins the colours (the default follows the
reader), `bare=1` drops the card so the widget draws straight on the article
background, `h=<px>` sets a height, and `title` / `subtitle` override the text.

If greensoutherners.org sets a content-security policy, it needs to allow frames
from `greensoutherners.github.io`.

---

## Refreshing the numbers

The exporter lives in the collection repository, beside the database:

```bash
cd ../alarms
python -m tools.publish.export_site_data --plan
```

```bash
python -m tools.publish.export_site_data
```

```bash
python -m tools.publish.export_site_data --geo --commit --push
```

`--plan` reads and reports without writing. `--geo` re-exports the boundary and
layer files, which rarely change and are the slow part. `--commit --push`
commits `data/` here with the counts in the message. It is **read-only against
the database** and safe to run against the production copy at any time.

| Path | Holds |
|---|---|
| `data/meta.json` | when the data was read, each type's shape, layer attributions |
| `data/summary.json` | the overview figures, per type, never summed |
| `data/types/<slug>.json` | one type's series, breakdowns and declared measures |
| `data/stats/<slug>.json` | the records counted by week, town and every documented column, columnar: what the pages filter |
| `data/villages.json` | every town with a record, counted per type |
| `data/imagery/wayback.json` | Esri Wayback release dates for the before-and-after slider |
| `data/imagery/ongeo.json` | which towns were read on high-resolution imagery, and the before/after pair |
| `data/imagery/timelapse.json` | which towns have a Sentinel-2 sequence |
| `assets/compare/` | the before and after pictures, two per town |
| `assets/timelapse/<town>/` | one JPEG per clear pass, with a `frames.json` |

The pictures are the bulk of this repository, around 130 MB, and they are built
once from fixed imagery runs rather than refreshed with the figures. A single
pack of them times out on GitHub's HTTP endpoint, so they go up a few towns at
a time.
| `data/geo/*.geojson` | Lebanon's boundaries and the corpus's own layers |

Boundaries come from the UN OCHA Lebanon Common Operational Dataset, fetched
separately because they change rarely:

```bash
python -m tools.publish.fetch_boundaries
```

That writes `db/gis/ocha/` in the collection repository; the exporter simplifies
it for the web and joins each town to the municipality whose polygon contains
its gazetteer point. The join is spatial rather than by name on purpose: the
same place is "Tyre" in the corpus and "Sour" in the release, "Bint Jbeil" and
"Bent Jbeil", and a map that joins on a transliteration leaves a district
unshaded and shows it as having had no incidents. Every town then carries the
official P-code, and the choropleths key on that.

Statistics files are dictionary-coded columns rather than arrays of objects:
each row is a cell (a week, a town and one value of every column) with `n`
records and the declared measures summed, which lets a page re-filter on every
keystroke without a server and without holding a single record.

---

## The rules these pages keep

These are not presentation choices. They are what the corpus can and cannot
support, and they are enforced in the code rather than left to whoever builds
the next chart.

- **No figure is added across incident types.** The corpus collects six
  specific kinds of record, each over its own window from its own sources. A
  combined total would measure what we looked for rather than what happened, so
  `summary.json` has no total key and the village register has no total column.
- **No column is summed unless the corpus declares it additive.** Hectares of
  burned or cleared ground add up; a count of records does not become a count of
  events. `Dataset.sum()` throws on anything else.
- **No status and no record state is published** (the data owner, 4 November
  2026). The pages say what was recorded, where and when. The one exception is
  white phosphorus: an attack is *geolocated* or *not geolocated*, and the map
  draws the two apart.
- **Fires are published only where an Israeli military attack is linked to
  them** (the data owner, 4 November 2026). The export leaves every other fire
  out of every file.
- **Statistics, never records** (the data owner, 6 November 2026). Every mark
  is a town at the town's own point, sized by the records counted there in the
  dates chosen; no record is listed, shown alone or downloadable. The records
  are available on request.
- **An order about a town shades the town.** Displacement orders open as a
  shaded municipality rather than a dot, because that is what the record
  claims: this town had this many.
- **A choropleth is the land, not a layer over it.** The country outline and
  the municipality set are generalised differently, so drawing one under the
  other gives the map two coastlines a few hundred metres apart. When
  municipalities are the subject they are drawn as the whole country, with
  unshaded ones in the land colour and nothing underneath.
- **Two different village layers, and they are not interchangeable.**
  "Municipalities" are the official OCHA boundaries and are what the village
  choropleth shades. "Fire search territories" are the corpus's own Voronoi
  cells of locality points, which is the ground a fire was *searched over*;
  they are drawn dashed so no line reads as a boundary.
- **Absence is never published as a finding.** An unshaded district is outside
  the collection area; a missing town is one no record names. Neither says
  nothing happened there.
- **Records marked as duplicates are excluded from every figure** and kept in
  the database rather than deleted.

Read [the method page](https://greensoutherners.github.io/south-ecocide-analytics/pages/about.html)
before quoting a number.

---

## Imagery

The before-and-after slider reads **Esri's Wayback archive live**: two dated
releases either side of a date, from Esri's own tile service. No imagery is
copied into this repository, and `data/imagery/wayback.json` holds only release
numbers and their dates.

A village page carries two picture views, and neither is a map.

**Before and after** is two flat JPEGs of the same ground, cut to the same
pixels, with a handle between them: the last archive release published before
the war against the 0.3 m aerial picture the village damage report was read on.
Tile layers were tried first and were the wrong tool, because a tile layer
cannot promise it holds imagery newer than the war for a given village, the
reader had to hunt for a zoom where a destroyed house was bigger than a pixel,
and when one layer had no tile the two dates quietly stopped showing the same
ground. The frame is about 1.4 km across at 1,800 pixels, roughly 0.8 m a
pixel, which is the scale at which a flattened block is unmistakable. Built by
`python -m tools.publish.build_compare_images`; 23 towns.

**The time-lapse** is one frame per clear Sentinel-2 pass, played at a second a
frame with the date on it, scrubbable and pausable. Built by
`python -m tools.publish.build_timelapse --limit 0`: every town in the run that
the register knows, 50 of them and about 1,800 frames. The gaps between frames
are cloud, not quiet weeks, and the player says so.

A release date is the day Esri *published* that imagery, which is on or after
the day it was captured. It dates the publication, not the overflight, and a
tile inside one release can be older still. The labels say "release" for that
reason.

The project's OnGeo 0.3 m imagery is deliberately **not** published here. It is
licensed material, and whether it may be redistributed from a public page is a
licence question for the data owner rather than a technical one.

## Charts and colour

Charts are [Apache ECharts](https://echarts.apache.org/), maps are
[Leaflet](https://leafletjs.com/) and, for the database and the investigations,
Mapbox GL JS or MapLibre GL JS, all committed to `assets/vendor/` rather than
loaded from a CDN: these pages are read over connections that are not always
good or unfiltered, and a chart that silently fails to draw because a CDN is slow
is worse than no chart.

The palette is orange, red and violet (the data owner, 4 November 2026: no
blue): a categorical set in a fixed order (never cycled: a ninth series folds
into "Other"), one colour per kind of record, the same on every chart and map,
and one orange to violet ramp for magnitude. No chart here has two y-axes.

## Licence

Code: MIT. Figures and derived data: © Green Southerners, free to reuse with
attribution and the snapshot date. Outside layers keep their own licences:
OCHA Lebanon / CAS (CC BY), NASA FIRMS (public domain),
Copernicus EFFIS and Sentinel-2 (Copernicus terms), OpenStreetMap / CARTO
(ODbL / CC BY), Esri World Imagery (Esri terms, served live and not
redistributed). They are listed with their terms in the footer of every page and
in `data/meta.json`.
