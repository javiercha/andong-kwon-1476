/* Google Analytics 4 — the property samhan.ai, Sebo and Relinkings report to.
   The tag itself is loaded async from googletagmanager (admitted in the
   Content-Security-Policy by host); this bootstrap is a file rather than an
   inline block so the policy needs no hash for it. The application is
   hash-routed, so it sends its own page_view per leaf (app.js, route());
   the static pages — People, Lineages, Data — take the default one. */
window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag('js', new Date());
gtag('config', 'G-95JRMG14B7', { send_page_view: !document.documentElement.hasAttribute('data-spa') });
