# Pictures of the posts

The banners, covers and figures of the posts on greensoutherners.org, kept here
so a post's pictures sit in version control beside the data they show. The post
bodies (`cms/`) link them; the banners and covers are also uploaded to the
website's own media library.

- `covers/`: per post, `<key>-banner.jpg` (1920 x 1100, the hero behind the
  title) and `<key>-cover.jpg` (1200 x 860, cards and share previews).
- `figures/`: maps rendered from this site's own database view.
- `beaufort/`: the castle on 27 July 2023 (GeoEye-1, Esri World Imagery Wayback)
  and on 3 September 2026 (OnGeo Intelligence, 0.3 m), cut to one frame
  (`castle-pair.json`, shown by `embed/pair.html`), and part of Arnoun on
  3 September 2026. A `photos.json` here (file, caption, credit) adds
  photographs to the Beaufort post.
- `al-mansouri-orchards/`: Al-Mansouri. `parts/`: the OnGeo picture of 8 October
  2026 (0.3 m) cut into a grid, each part beside the same ground on Esri World
  Imagery from before the war (Wayback release 13192, Maxar, January to April
  2023, the capture date of each part in its pair file), plain and with the
  outlines readers found (`-outlined`): buildings destroyed and damaged, the
  orchards, fields and trees outlined by hand, roads bulldozed. `index.json`
  lists the parts for `embed/parts.html`. `sequence/`: the centre of the village
  on every sharp picture, for `embed/lapse.html?src=`. `references.json`: what
  was published about the detonations, shown through each platform's own embed
  or as a link, never copied here. Written by `tools/publish/village_imagery.py`
  and `tools/publish/build_stories.py` in the collection repository.
- `litani/`: the Litani investigation, the reel's way: three stretches of the river on
  Sentinel-2 (21 October 2025 and 23 October 2026, Copernicus Browser) with the yellow
  boxes Green Southerners marked (`-marked`), the land-cover classification of the same days
  (a pair and the year as a video), `timeline/` (the clearest pass of each month from
  October 2025, for `embed/lapse.html?src=`), and `wide.json` (27 September 2023 beside
  26 October 2026).
- `photos/`: photographs from Wikimedia Commons under free licences; author,
  licence and source of each are in `photos/credits.json` and under each
  picture in the posts.
- `ecosystem/figures.json`: the land cover shares and Key Biodiversity Areas the
  ecosystem post states, written by `python -m tools.publish.ecosystem_figures`
  in the collection repository.

The 3D model of Beaufort Castle (`assets/3d/beaufort-castle.glb`, shown by
`embed/castle3d.html`) comes from the film project From above, from within.
