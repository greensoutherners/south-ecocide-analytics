# Vendored libraries

These libraries are committed rather than loaded from a CDN, on purpose.

The pages here are embedded in articles and opened over connections that are
not always good or unfiltered, and a chart that silently fails to draw because
a third-party CDN is slow, blocked or down is worse than no chart: an empty
panel reads as "nothing happened". Serving them from the same origin as the
data means a page has exactly one host to reach, and an embed cannot break for
a reason nobody here can see or fix.

| File | Library | Version | Licence |
|---|---|---|---|
| `echarts.min.js` | [Apache ECharts](https://echarts.apache.org/) | 5.5.1 | Apache-2.0 |
| `leaflet.js`, `leaflet.css` | [Leaflet](https://leafletjs.com/) | 1.9.4 | BSD-2-Clause |
| `mapbox-gl.js`, `mapbox-gl.css` | [Mapbox GL JS](https://docs.mapbox.com/mapbox-gl-js/) | 3.33.0 | Mapbox Terms of Service (`MAPBOX-GL-LICENSE.txt`) |
| `maplibre-gl.js`, `maplibre-gl.css` | [MapLibre GL JS](https://maplibre.org/) | 5.24.0 | BSD-3-Clause (`MAPLIBRE-LICENSE.txt`) |

The two GL libraries draw the database and the investigations
(`assets/js/gl.js`). Only one loads on a page: Mapbox GL JS when a Mapbox public
token is set in `assets/js/config.js`, MapLibre GL JS otherwise, so the maps
keep working with no token and no account.

## Replacing one

Download the exact release, drop it in, and update the table and the hashes:

```bash
curl -sSLo assets/vendor/echarts.min.js https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js
curl -sSLo assets/vendor/leaflet.js    https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js
curl -sSLo assets/vendor/leaflet.css   https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css
curl -sSLo assets/vendor/mapbox-gl.js   https://cdn.jsdelivr.net/npm/mapbox-gl@3.33.0/dist/mapbox-gl.js
curl -sSLo assets/vendor/mapbox-gl.css  https://cdn.jsdelivr.net/npm/mapbox-gl@3.33.0/dist/mapbox-gl.css
curl -sSLo assets/vendor/maplibre-gl.js https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js
curl -sSLo assets/vendor/maplibre-gl.css https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.css
sha256sum assets/vendor/*
```

Nothing else in the site pins a version, so a bump is these files and this
table.

SHA-256 of the committed copies:

    e84270bd0cd5bdf60fefc26d00c2a391cb2e81f4d26a7a9ee16185a54773a3cf  echarts.min.js
    5c9aecfc30e4564519dbdcddcc53a418227dcc7568e619e9762ddcec7609ed47  leaflet.js
    b570abbda963c60b4de4b4ff4b26f9326f53fb2ccf1461fdf0955ca094fb2539  leaflet.css
    d0e40476915ab351ca35c5b881f4ed73068cb2428af9e5ba18ceaa3d5f32fd78  mapbox-gl.js
    48833ccdced793ae305a93ea33a310e567aba60e293148a5060abeec3030ffa9  mapbox-gl.css
    45a9b07a9189ce56054c620a947ccf41e291e58c95e9b61533b740aaa65ee5cb  maplibre-gl.js
    ab1e70d59ec40465bae7e7030da2f3ccf28133fd502e62bd598eefbadfd7a732  maplibre-gl.css
