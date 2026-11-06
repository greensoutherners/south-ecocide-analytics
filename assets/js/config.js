/* Site settings that are not data.
 *
 * MAPBOX.token is a Mapbox *public* access token (it starts with "pk."). A
 * public token is meant to sit in a web page's code; restrict it in the Mapbox
 * account to the site's own addresses (greensoutherners.github.io and
 * greensoutherners.org) so nobody else can spend it.
 *
 * With a token, the maps draw on Mapbox GL JS and Mapbox's own tiles: vector
 * streets, satellite imagery and terrain. Without one they draw on MapLibre GL
 * JS, the open fork of the same library, over CARTO, Esri and AWS terrain
 * tiles. Every layer the corpus adds is the same either way.
 *
 * MAPBOX.styles lets a Mapbox Studio style replace a built-in base map: set a
 * value to its "mapbox://styles/<account>/<style>" URL. Left null, the site
 * builds its own light and satellite base maps from Mapbox's tilesets.
 */

export const MAPBOX = {
  token: '',
  styles: {
    light: null,
    satellite: null,
  },
};
