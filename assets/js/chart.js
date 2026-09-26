// Progressive enhancement for {{< chart >}} figures: tooltips, series toggles,
// grow-in on scroll. The static SVG is the complete chart without this file.
(function () {
  var figs = document.querySelectorAll('figure.wd-chart');
  if (!figs.length) return;
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  var css =
    '.wd-chart{position:relative}' +
    '.wd-ctl{display:flex;flex-wrap:wrap;gap:.5rem 1rem;margin:0 0 .75rem;font-size:.875rem}' +
    '.wd-ctl [role=group]{display:inline-flex;border:1px solid #d7d5d0;border-radius:999px;padding:2px}' +
    '.wd-ctl button{font:inherit;border:0;background:none;color:#555;padding:.25rem .8rem;border-radius:999px;cursor:pointer}' +
    '.wd-ctl button[aria-pressed=true]{background:#1f6f5c;color:#fff}' +
    '.wd-ctl button:focus-visible,.wd-chart [data-value]:focus-visible{outline:2px solid #57a08b;outline-offset:2px}' +
    '.wd-tip{position:absolute;pointer-events:none;background:#111;color:#fff;font-size:.8125rem;line-height:1.35;' +
    'padding:.4rem .6rem;border-radius:6px;max-width:16rem;opacity:0;transform:translate(-50%,-100%);z-index:2}' +
    '.wd-tip b{font-weight:600}' +
    '.wd-chart [data-value]{transform-box:fill-box;transform-origin:left center}' +
    '.wd-chart svg[data-orient=v] [data-value]{transform-origin:center bottom}' +
    '.wd-chart circle[data-value]{transform-origin:center}' +
    '.wd-anim [data-value]{transition:transform .6s cubic-bezier(.2,.7,.2,1)}' +
    '.wd-anim .wd-tip{transition:opacity .15s}' +
    '.wd-pre [data-value]{transform:scale(0,1)}' +
    '.wd-pre svg[data-orient=v] [data-value]{transform:scale(1,0)}' +
    '.wd-pre circle[data-value]{transform:scale(0)}' +
    '@media (prefers-color-scheme:dark){.wd-ctl [role=group]{border-color:#444}.wd-ctl button{color:#bbb}' +
    '.wd-ctl button[aria-pressed=true]{background:#57a08b;color:#111}.wd-tip{background:#f2f2f2;color:#111}}' +
    '@media (prefers-reduced-motion:reduce){.wd-chart *{transition:none!important}}';
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  var io = !still && 'IntersectionObserver' in window && new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      requestAnimationFrame(function () { e.target.classList.remove('wd-pre'); });
    });
  }, { threshold: 0.35 });

  function grow(fig) {
    if (still) return;
    fig.classList.add('wd-pre');
    fig.getBoundingClientRect();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { fig.classList.remove('wd-pre'); });
    });
  }

  figs.forEach(function (fig) {
    var svg = fig.querySelector('svg');
    if (!svg) return;
    var data = {};
    var raw = fig.querySelector('script.wd-chart-data');
    try { if (raw) data = JSON.parse(raw.textContent); } catch (e) {}
    var unit = data.unit || '';

    var tip = document.createElement('div');
    tip.className = 'wd-tip';
    tip.setAttribute('aria-hidden', 'true');
    fig.appendChild(tip);

    function show(m) {
      var d = m.dataset, r = m.getBoundingClientRect(), f = fig.getBoundingClientRect();
      var b = document.createElement('b');
      b.textContent = (d.model || '') + ': ' + d.value + unit;
      tip.replaceChildren(b);
      if (d.setup) tip.appendChild(document.createTextNode(' ' + d.setup));
      tip.style.left = (r.left - f.left + r.width / 2) + 'px';
      tip.style.top = (r.top - f.top - 8) + 'px';
      tip.style.opacity = 1;
    }
    function hide() { tip.style.opacity = 0; }

    svg.querySelectorAll('[data-value]').forEach(function (m) {
      var d = m.dataset;
      m.setAttribute('tabindex', '0');
      m.setAttribute('role', 'img');
      m.setAttribute('aria-label', (d.model || '') + ': ' + d.value + unit + (d.setup ? ', ' + d.setup : ''));
      m.addEventListener('pointerenter', function () { show(m); });
      m.addEventListener('pointerleave', hide);
      m.addEventListener('focus', function () { show(m); });
      m.addEventListener('blur', hide);
    });

    var toggles = data.toggles || [];
    var groups = svg.querySelectorAll('.wd-series');
    if (toggles.length && groups.length) {
      var state = {};
      var ctl = document.createElement('div');
      ctl.className = 'wd-ctl';
      var apply = function (animate) {
        ctl.querySelectorAll('button').forEach(function (b) {
          b.setAttribute('aria-pressed', String(state[b.dataset.t] === b.dataset.v));
        });
        groups.forEach(function (g) {
          var on = toggles.every(function (t) {
            var v = g.getAttribute('data-' + t.id);
            return v == null || v === state[t.id];
          });
          if (on) g.removeAttribute('display'); else g.setAttribute('display', 'none');
          g.setAttribute('aria-hidden', String(!on));
        });
        hide();
        if (animate) grow(fig);
      };
      toggles.forEach(function (t) {
        state[t.id] = t.default || t.options[0].value;
        var g = document.createElement('div');
        g.setAttribute('role', 'group');
        g.setAttribute('aria-label', t.label || t.id);
        t.options.forEach(function (o) {
          var b = document.createElement('button');
          b.type = 'button';
          b.textContent = o.label || o.value;
          b.dataset.t = t.id;
          b.dataset.v = o.value;
          b.addEventListener('click', function () {
            if (state[t.id] === o.value) return;
            state[t.id] = o.value;
            apply(true);
          });
          g.appendChild(b);
        });
        ctl.appendChild(g);
      });
      fig.insertBefore(ctl, fig.firstChild);
      apply(false);
    }

    if (!still) fig.classList.add('wd-anim');
    if (io) {
      fig.classList.add('wd-pre');
      io.observe(fig);
    }
  });
})();
