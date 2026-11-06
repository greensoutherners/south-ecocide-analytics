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
- `photos/`: photographs from Wikimedia Commons under free licences; author,
  licence and source of each are in `photos/credits.json` and under each
  picture in the posts.
- `ecosystem/figures.json`: the land cover shares and Key Biodiversity Areas the
  ecosystem post states, written by `python -m tools.publish.ecosystem_figures`
  in the collection repository.

The 3D model of Beaufort Castle (`assets/3d/beaufort-castle.glb`, shown by
`embed/castle3d.html`) comes from the film project From above, from within.
