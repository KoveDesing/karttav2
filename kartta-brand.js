/* KARTTA — Marca tipográfica: cada vez que un texto visible menciona la marca, se muestra como "Kartta"
   en Mr Dafoe con las dos "tt" en rojo coral. Solo presentación: el HTML original (y lo que leen buscadores y
   lectores de pantalla) no cambia. Se aplica también a lo que se dibuja después (planes, paneles, avisos). */
(function () {
  'use strict';
  var doc = document;
  var CORAL = '#FF3145';
  var SKIP_TAG = /^(SCRIPT|STYLE|TITLE|TEXTAREA|INPUT|SELECT|OPTION|CODE|PRE|NOSCRIPT|SVG|CANVAS|IFRAME)$/;
  var SKIP_SEL = '.kk,[contenteditable="true"],[data-no-brand],.k-loader,#kBoot';

  var css = '.kk{font-family:"Mr Dafoe",cursive;font-weight:400;font-style:normal;letter-spacing:0;text-transform:none;' +
    'font-size:1.22em;line-height:0;white-space:nowrap;display:inline;vertical-align:baseline;}' +
    '.kk b{font-weight:400;font-style:normal;color:' + CORAL + ';}' +
    /* sobre fondos coral (rectángulos, botones rojos, cinta) las "tt" van en blanco para que se vean */
    '.hl .kk b,.btn-primary .kk b,.btn-accent .kk b,.kbar-cta .kk b,.kx-ribbon .kk b,.plan-badge .kk b,.hl.kk b{color:inherit;}' +
    '.kk-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}';
  var st = doc.createElement('style'); st.setAttribute('data-kartta-brand', ''); st.textContent = css;
  (doc.head || doc.documentElement).appendChild(st);

  function isWordChar(c) { return !!c && /[A-Za-z0-9_@.\/\-]/.test(c); }
  var RE = /kartta/gi;

  function build(text) {
    var out = null, last = 0, m;
    RE.lastIndex = 0;
    while ((m = RE.exec(text))) {
      var s = m.index, e = s + 5 + 1;                       // "kartta" = 6 letras
      var before = text.charAt(s - 1), after = text.charAt(e);
      // no tocar direcciones (kartta.food, hola@kartta..., /kartta, kartta-ui) ni palabras más largas
      if (isWordChar(before) || /[A-Za-z0-9_@\/\-]/.test(after) || (after === '.' && /[A-Za-z]/.test(text.charAt(e + 1)))) continue;
      out = out || doc.createDocumentFragment();
      if (s > last) out.appendChild(doc.createTextNode(text.slice(last, s)));
      var k = doc.createElement('span'); k.className = 'kk'; k.setAttribute('translate', 'no');
      var vis = doc.createElement('span'); vis.setAttribute('aria-hidden', 'true');
      vis.appendChild(doc.createTextNode('Kar')); var b = doc.createElement('b'); b.textContent = 'tt'; vis.appendChild(b); vis.appendChild(doc.createTextNode('a'));
      var sr = doc.createElement('span'); sr.className = 'kk-sr'; sr.textContent = 'Kartta';
      k.appendChild(vis); k.appendChild(sr); out.appendChild(k);
      last = e;
    }
    if (!out) return null;
    if (last < text.length) out.appendChild(doc.createTextNode(text.slice(last)));
    return out;
  }

  function walk(root) {
    if (!root || root.nodeType !== 1 && root.nodeType !== 11) return;
    var tw = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentNode, v = n.nodeValue;
        if (!p || !v || !/kartta/i.test(v)) return NodeFilter.FILTER_REJECT;
        if (p.nodeType === 1) {
          if (SKIP_TAG.test(p.nodeName.toUpperCase())) return NodeFilter.FILTER_REJECT;
          if (p.closest && p.closest(SKIP_SEL)) return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var list = [], n;
    while ((n = tw.nextNode())) list.push(n);
    list.forEach(function (node) {
      var frag = build(node.nodeValue);
      if (frag && node.parentNode) node.parentNode.replaceChild(frag, node);
    });
  }

  var pending = [], timer = 0;
  function flush() {
    timer = 0;
    var items = pending; pending = [];
    if (mo) mo.disconnect();
    items.forEach(function (n) { if (n.isConnected !== false) walk(n); });
    observe();
  }
  var mo = null;
  function observe() {
    if (!mo || !doc.body) return;
    mo.observe(doc.body, { childList: true, subtree: true, characterData: true });
  }
  function start() {
    if (!doc.body) return;
    walk(doc.body);
    if ('MutationObserver' in window) {
      mo = new MutationObserver(function (muts) {
        muts.forEach(function (m) {
          if (m.type === 'characterData') { if (m.target.parentNode) pending.push(m.target.parentNode); return; }
          Array.prototype.forEach.call(m.addedNodes, function (n) {
            if (n.nodeType === 1 && !(n.classList && n.classList.contains('kk'))) pending.push(n);
            else if (n.nodeType === 3 && n.parentNode) pending.push(n.parentNode);
          });
        });
        if (pending.length && !timer) timer = setTimeout(flush, 60);
      });
      observe();
    }
  }
  try {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
  } catch (e) { /* nunca romper la página */ }
})();
