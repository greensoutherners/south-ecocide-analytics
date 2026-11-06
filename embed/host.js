/* Put this on greensoutherners.org, once.
 *
 * A cross-origin iframe cannot size itself: the browser gives it whatever
 * height the HTML asks for, and the widget inside has no way to change it. So
 * each widget measures its own content and posts the number up; this listens
 * and resizes the frame. Without it an embedded chart sits in a fixed box with
 * a scrollbar through the middle of the article.
 *
 * Add it anywhere on the page, once:
 *
 *   <script src="https://greensoutherners.github.io/south-ecocide-analytics/embed/host.js"
 *           async></script>
 *
 * Then any iframe pointing at the embed folder resizes itself. Nothing else on
 * the host page is touched: no globals, no styles, no other postMessage
 * traffic. Messages from any other origin are ignored.
 */

(function () {
  'use strict';

  var ORIGIN = 'https://greensoutherners.github.io';
  var SELECTOR = 'iframe[src*="south-ecocide-analytics/embed/"]';

  function frames() {
    return Array.prototype.slice.call(document.querySelectorAll(SELECTOR));
  }

  window.addEventListener('message', function (event) {
    // Only this site may resize a frame on the host page. Without this check
    // any page in any other frame could drive the layout.
    if (event.origin !== ORIGIN) return;

    var data = event.data;
    if (!data || data.type !== 'gsa:height' || typeof data.height !== 'number') return;

    var height = Math.max(120, Math.min(4000, Math.round(data.height)));
    frames().forEach(function (frame) {
      if (frame.contentWindow === event.source) {
        frame.style.height = height + 'px';
        frame.setAttribute('height', String(height));
      }
    });
  });

  // Sensible defaults so a frame looks right before its first message arrives,
  // and keeps looking right if the script is blocked.
  function style() {
    frames().forEach(function (frame) {
      if (frame.dataset.gsaStyled) return;
      frame.dataset.gsaStyled = '1';
      frame.style.width = '100%';
      frame.style.border = '0';
      frame.style.display = 'block';
      frame.setAttribute('loading', 'lazy');
      frame.setAttribute('scrolling', 'no');
      if (!frame.getAttribute('title')) {
        frame.setAttribute('title', 'South Ecocide Analytics chart');
      }
      if (!frame.style.height) frame.style.height = '420px';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', style);
  } else {
    style();
  }

  // Articles that load content after the fact (infinite scroll, a CMS block
  // rendered late) get their frames styled too.
  if (window.MutationObserver) {
    new MutationObserver(style).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
})();
