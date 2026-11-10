/* KARTTA · Editor de foto de perfil y banner
 * Uso:  KARTTA_PHOTO.edit({ kind:'logo'|'banner', file, onSave: async (blob) => {...} })
 * - No sube nada: entrega un Blob JPEG ya recortado a onSave(). Quien llama sube a Storage y guarda en la BD.
 * - Si onSave lanza un error, el editor queda abierto, muestra un mensaje claro y deja reintentar.
 * - Sin dependencias. Usa las variables de color del panel (--panel, --border, --accent…) con valores por defecto.
 */
(function () {
  'use strict';
  if (window.KARTTA_PHOTO) return;

  var TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  var MAX_INPUT = 12 * 1024 * 1024;           // 12 MB de entrada
  var KINDS = {
    logo:   { title: 'Ajustar foto de perfil', ratio: 1,   out: [512, 512],   minSide: 200, maxBytes: 350 * 1024, q: 0.9 },
    banner: { title: 'Ajustar banner',         ratio: 2,   out: [1600, 800],  minSide: 600, maxBytes: 600 * 1024, q: 0.82 }
  };
  // Alturas reales del encabezado del menú (menu.html): auto ≈ contenido, Baja 150, Media 210, Alta 290; ancho de 360 a 430 px.
  var BANNER_PREVIEWS = [['Automática', 130], ['Baja', 150], ['Media', 210], ['Alta', 290]];
  var PREV_W = 390;

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.append(c); });
    return n;
  }
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };

  function injectCSS() {
    if (document.getElementById('kpe-css')) return;
    var s = document.createElement('style'); s.id = 'kpe-css';
    s.textContent = [
      '.kpe-bg{position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.66);display:flex;align-items:center;justify-content:center;padding:16px;animation:kpe-in .18s ease}',
      '@keyframes kpe-in{from{opacity:0}to{opacity:1}}',
      '.kpe{box-sizing:border-box;background:var(--panel,#202020);color:var(--text,#E4E4E4);border:1px solid var(--border,#2c2c2c);border-radius:22px;width:100%;max-width:520px;max-height:calc(100dvh - 32px);overflow-y:auto;padding:22px;box-shadow:0 30px 80px -20px rgba(0,0,0,.6);font-family:inherit}',
      '.kpe.wide{max-width:640px}',
      '.kpe h3{margin:0 0 4px;font-size:19px;font-weight:800;color:var(--strong,#fff)}',
      '.kpe .kpe-sub{margin:0 0 16px;font-size:13px;color:var(--muted,#8F8F8F)}',
      '.kpe-stage{position:relative;margin:0 auto;background:#0d0d0d;border-radius:16px;overflow:hidden;touch-action:none;cursor:grab;user-select:none;-webkit-user-select:none;outline-offset:3px}',
      '.kpe-stage:active{cursor:grabbing}',
      '.kpe-stage.round{border-radius:50%}',
      '.kpe-stage img{position:absolute;left:0;top:0;max-width:none;transform-origin:0 0;pointer-events:none;will-change:transform}',
      '.kpe-ring{position:absolute;inset:0;pointer-events:none;border-radius:inherit;box-shadow:inset 0 0 0 2px rgba(255,255,255,.55)}',
      '.kpe-grid{position:absolute;inset:0;pointer-events:none;background:linear-gradient(rgba(255,255,255,.22),rgba(255,255,255,.22)) 33.33% 0/1px 100% no-repeat,linear-gradient(rgba(255,255,255,.22),rgba(255,255,255,.22)) 66.66% 0/1px 100% no-repeat,linear-gradient(rgba(255,255,255,.22),rgba(255,255,255,.22)) 0 33.33%/100% 1px no-repeat,linear-gradient(rgba(255,255,255,.22),rgba(255,255,255,.22)) 0 66.66%/100% 1px no-repeat;opacity:0;transition:opacity .15s}',
      '.kpe-stage.drag .kpe-grid{opacity:1}',
      '.kpe-safe{position:absolute;left:20%;top:20%;width:60%;height:60%;border:1.5px dashed rgba(255,255,255,.7);border-radius:8px;pointer-events:none}',
      '.kpe-safe i{position:absolute;left:6px;top:4px;font:700 10px/1 inherit;font-style:normal;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.7)}',
      '.kpe-ctl{margin-top:16px;display:grid;gap:12px}',
      '.kpe-row{display:flex;align-items:center;gap:10px}',
      '.kpe-row label{font-size:12.5px;font-weight:700;color:var(--muted,#8F8F8F);min-width:70px}',
      '.kpe-row input[type=range]{flex:1;accent-color:var(--accent,#FF3145);min-height:28px}',
      '.kpe-row output{min-width:46px;text-align:right;font-size:12.5px;font-weight:800;color:var(--strong,#fff);font-variant-numeric:tabular-nums}',
      '.kpe-tools{display:flex;flex-wrap:wrap;gap:8px}',
      '.kpe-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:0 16px;border-radius:12px;border:1px solid var(--border,#2c2c2c);background:var(--panel2,#292929);color:var(--strong,#fff);font:700 13.5px/1 inherit;font-family:inherit;cursor:pointer;transition:background .15s,transform .15s}',
      '.kpe-btn:hover{background:var(--border,#2c2c2c)}.kpe-btn:active{transform:scale(.97)}',
      '.kpe-btn.sm{min-height:38px;padding:0 12px;font-size:12.5px}',
      '.kpe-btn.accent{background:var(--accent,#FF3145);border-color:transparent;color:var(--on-accent,#fff)}.kpe-btn.accent:hover{background:var(--accent-dim,var(--accent,#FF3145));filter:brightness(.92)}',
      '.kpe-btn[disabled]{opacity:.5;cursor:not-allowed;transform:none}',
      '.kpe-foot{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:18px}',
      '.kpe-err{margin-top:12px;padding:10px 12px;border-radius:12px;background:rgba(229,72,77,.12);color:#E5484D;font-size:13px;font-weight:600}',
      '.kpe-hint{font-size:12px;color:var(--muted,#8F8F8F);text-align:center;margin-top:10px}',
      '.kpe-pv{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:16px}',
      '.kpe-pv figure{margin:0}.kpe-pv figcaption{font-size:11.5px;font-weight:700;color:var(--muted,#8F8F8F);margin-top:5px}',
      '.kpe-pvbox{position:relative;width:100%;overflow:hidden;border-radius:12px;border:1px solid var(--border,#2c2c2c);background:#111}',
      '.kpe-pvbox canvas{position:absolute;inset:0;width:100%;height:100%}',
      '.kpe-pvbox span{position:absolute;left:10px;bottom:8px;color:#fff;font:800 12px/1 inherit;text-shadow:0 1px 3px rgba(0,0,0,.8)}',
      '.kpe-spin{width:15px;height:15px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;animation:kpe-sp .7s linear infinite}',
      '@keyframes kpe-sp{to{transform:rotate(360deg)}}',
      '.kpe-guide{margin-top:12px;padding:12px 14px;border-radius:14px;background:var(--panel2,#292929);border:1px solid var(--border,#2c2c2c);font-size:12.5px;line-height:1.55;color:var(--text,#E4E4E4)}',
      '.kpe-guide b{color:var(--strong,#fff)}',
      '.kpe-guide .kpe-zone{margin-top:10px;display:flex;gap:12px;align-items:center}',
      '.kpe-guide .kpe-mini{position:relative;width:120px;aspect-ratio:2/1;border-radius:8px;background:linear-gradient(135deg,#3a3a3a,#242424);border:1px solid var(--border,#2c2c2c);flex-shrink:0}',
      '.kpe-guide .kpe-mini i{position:absolute;left:20%;top:20%;width:60%;height:60%;border:1.5px dashed var(--accent,#FF3145);border-radius:5px}',
      '@media (max-width:520px){.kpe{padding:16px;border-radius:18px}.kpe-row label{min-width:58px}}',
      '@media (prefers-reduced-motion:reduce){.kpe-bg,.kpe-btn,.kpe-spin{animation:none;transition:none}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file || TYPES.indexOf(file.type) < 0) return reject({ code: 'type' });
      if (file.size > MAX_INPUT) return reject({ code: 'size' });
      if (file.size === 0) return reject({ code: 'corrupt' });
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        if (!img.naturalWidth || !img.naturalHeight) { URL.revokeObjectURL(url); return reject({ code: 'corrupt' }); }
        resolve({ img: img, url: url });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject({ code: 'corrupt' }); };
      img.src = url;
    });
  }
  var LOAD_MSG = {
    type: 'Ese formato no está permitido. Usa JPG, PNG o WebP.',
    size: 'La imagen pesa más de 12 MB. Elige una más liviana.',
    corrupt: 'No pudimos leer esa imagen. Prueba con otro archivo.'
  };

  function canvasToBlob(c, type, q) {
    return new Promise(function (res) { c.toBlob(function (b) { res(b); }, type, q); });
  }

  function open(opts) {
    var cfg = KINDS[opts && opts.kind];
    if (!cfg) throw new Error('kind inválido');
    injectCSS();
    var prevFocus = document.activeElement;
    var st = { img: null, url: null, z: 1, ox: 0, oy: 0, busy: false, fw: 0, fh: 0, base: 1, closed: false };
    var pointers = new Map(), pinch = null;

    var uid = 'kpe' + Math.random().toString(36).slice(2, 7);
    var bg = el('div', { class: 'kpe-bg' });
    var box = el('div', { class: 'kpe' + (opts.kind === 'banner' ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': uid + 't' });
    var stage = el('div', { class: 'kpe-stage' + (opts.kind === 'logo' ? ' round' : ''), tabindex: '0', role: 'img', 'aria-label': 'Área de encuadre. Arrastra para mover; usa las flechas para mover y + o - para acercar.' });
    var imgEl = el('img', { alt: '', draggable: 'false' });
    stage.append(imgEl, el('div', { class: 'kpe-grid' }), el('div', { class: 'kpe-ring' }));
    if (opts.kind === 'banner') stage.append(el('div', { class: 'kpe-safe' }, [el('i', { text: 'Zona segura' })]));

    var zoom = el('input', { type: 'range', min: '100', max: '400', step: '1', value: '100', 'aria-label': 'Zoom' });
    var zOut = el('output', { text: '100%' });
    var xr = el('input', { type: 'range', min: '-100', max: '100', step: '1', value: '0', 'aria-label': 'Posición horizontal' });
    var yr = el('input', { type: 'range', min: '-100', max: '100', step: '1', value: '0', 'aria-label': 'Posición vertical' });
    var err = el('div', { class: 'kpe-err', role: 'alert', hidden: '' });
    var file = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: '' });

    var bCenter = el('button', { type: 'button', class: 'kpe-btn sm', text: 'Centrar' });
    var bZoom = el('button', { type: 'button', class: 'kpe-btn sm', text: 'Restablecer zoom' });
    var bReset = el('button', { type: 'button', class: 'kpe-btn sm', text: 'Restablecer' });
    var bChange = el('button', { type: 'button', class: 'kpe-btn sm', text: 'Cambiar foto' });
    var bCancel = el('button', { type: 'button', class: 'kpe-btn', text: 'Cancelar' });
    var bSave = el('button', { type: 'button', class: 'kpe-btn accent', text: opts.kind === 'logo' ? 'Guardar foto' : 'Guardar banner' });

    var pv = null, pvCanvases = [];
    if (opts.kind === 'banner') {
      pv = el('div', { class: 'kpe-pv' });
      BANNER_PREVIEWS.forEach(function (p) {
        var c = document.createElement('canvas'); c.width = PREV_W; c.height = p[1];
        var b = el('div', { class: 'kpe-pvbox', style: 'aspect-ratio:' + PREV_W + '/' + p[1] }, [c, el('span', { text: 'Tu negocio' })]);
        pv.append(el('figure', null, [b, el('figcaption', { text: 'Menú · altura ' + p[0].toLowerCase() })]));
        pvCanvases.push({ c: c, h: p[1] });
      });
    }

    box.append(
      el('h3', { id: uid + 't', text: cfg.title }),
      el('p', { class: 'kpe-sub', text: opts.kind === 'logo' ? 'Así se verá tu foto en el menú y en tu panel.' : 'Arrastra y haz zoom hasta que el encuadre quede como quieres.' }),
      stage,
      el('div', { class: 'kpe-hint', text: 'Arrastra la imagen · rueda del ratón o pellizco para el zoom' }),
      el('div', { class: 'kpe-ctl' }, [
        el('div', { class: 'kpe-row' }, [el('label', { text: 'Zoom' }), zoom, zOut]),
        el('div', { class: 'kpe-row' }, [el('label', { text: 'Horizontal' }), xr]),
        el('div', { class: 'kpe-row' }, [el('label', { text: 'Vertical' }), yr]),
        el('div', { class: 'kpe-tools' }, [bCenter, bZoom, bReset, bChange])
      ]),
      pv,
      err,
      el('div', { class: 'kpe-foot' }, [bCancel, bSave]),
      file
    );
    bg.append(box);

    /* ---------- geometría ---------- */
    function layout() {
      var maxW = Math.min(opts.kind === 'logo' ? 340 : 560, box.clientWidth - 44 || 300);
      var vh = window.innerHeight * (opts.kind === 'logo' ? 0.5 : 0.34);
      var w = opts.kind === 'logo' ? Math.min(maxW, vh) : maxW;
      st.fw = Math.max(180, Math.round(w)); st.fh = Math.round(st.fw / cfg.ratio);
      stage.style.width = st.fw + 'px'; stage.style.height = st.fh + 'px';
      if (st.img) st.base = Math.max(st.fw / st.img.naturalWidth, st.fh / st.img.naturalHeight);
      apply();
    }
    function maxOff() {
      var s = st.base * st.z;
      return { x: Math.max(0, (st.img.naturalWidth * s - st.fw) / 2), y: Math.max(0, (st.img.naturalHeight * s - st.fh) / 2) };
    }
    function apply() {
      if (!st.img) return;
      var m = maxOff(); st.ox = clamp(st.ox, -m.x, m.x); st.oy = clamp(st.oy, -m.y, m.y);
      var s = st.base * st.z, w = st.img.naturalWidth * s, h = st.img.naturalHeight * s;
      var left = st.fw / 2 - w / 2 + st.ox, top = st.fh / 2 - h / 2 + st.oy;
      imgEl.style.width = w + 'px'; imgEl.style.height = h + 'px';
      imgEl.style.transform = 'translate(' + left + 'px,' + top + 'px)';
      zoom.value = String(Math.round(st.z * 100)); zOut.textContent = Math.round(st.z * 100) + '%';
      xr.disabled = m.x < 1; yr.disabled = m.y < 1;
      xr.value = m.x < 1 ? '0' : String(Math.round(st.ox / m.x * 100));
      yr.value = m.y < 1 ? '0' : String(Math.round(st.oy / m.y * 100));
      drawPreviews();
    }
    // Dibuja el recorte en un canvas de tamaño (ow×oh) a partir del encuadre actual (el recorte es la zona visible del escenario).
    function render(cv, ow, oh) {
      var ctx = cv.getContext('2d'), k = ow / st.fw;
      var s = st.base * st.z * k, w = st.img.naturalWidth * s, h = st.img.naturalHeight * s;
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, ow, oh);   // PNG con transparencia: fondo blanco (JPEG no admite transparencia)
      ctx.drawImage(st.img, ow / 2 - w / 2 + st.ox * k, oh / 2 - h / 2 + st.oy * k, w, h);
    }
    var raf = 0;
    function drawPreviews() {
      if (!pvCanvases.length || raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0; if (st.closed || !st.img) return;
        var tmp = document.createElement('canvas'); tmp.width = 800; tmp.height = 400; render(tmp, 800, 400);
        pvCanvases.forEach(function (p) {
          var ctx = p.c.getContext('2d'), sc = Math.max(PREV_W / 800, p.h / 400); // background-size: cover; position: center
          var w = 800 * sc, h = 400 * sc;
          ctx.clearRect(0, 0, PREV_W, p.h); ctx.drawImage(tmp, (PREV_W - w) / 2, (p.h - h) / 2, w, h);
          ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(0, 0, PREV_W, p.h);   // el menú oscurece la foto para que el texto se lea
        });
      });
    }

    /* ---------- interacción ---------- */
    function setZoom(z, cx, cy) {
      z = clamp(z, 1, 4); if (!st.img) return;
      // zoom centrado en (cx,cy) dentro del escenario (por defecto, el centro)
      var ax = (cx == null ? st.fw / 2 : cx) - st.fw / 2, ay = (cy == null ? st.fh / 2 : cy) - st.fh / 2;
      var r = z / st.z; st.ox = ax - (ax - st.ox) * r; st.oy = ay - (ay - st.oy) * r; st.z = z; apply();
    }
    stage.addEventListener('wheel', function (e) {
      e.preventDefault(); var rc = stage.getBoundingClientRect();
      setZoom(st.z * Math.exp(-e.deltaY * 0.0015), e.clientX - rc.left, e.clientY - rc.top);
    }, { passive: false });
    stage.addEventListener('pointerdown', function (e) {
      if (!st.img || st.busy) return; stage.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); stage.classList.add('drag');
      if (pointers.size === 2) { var a = Array.from(pointers.values()); pinch = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), z: st.z }; }
    });
    stage.addEventListener('pointermove', function (e) {
      var p = pointers.get(e.pointerId); if (!p) return;
      if (pointers.size === 1) { st.ox += e.clientX - p.x; st.oy += e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; apply(); }
      else if (pointers.size === 2 && pinch) {
        p.x = e.clientX; p.y = e.clientY; var a = Array.from(pointers.values()), rc = stage.getBoundingClientRect();
        var d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1;
        setZoom(pinch.z * d / (pinch.d || 1), (a[0].x + a[1].x) / 2 - rc.left, (a[0].y + a[1].y) / 2 - rc.top);
      }
    });
    function up(e) { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; if (!pointers.size) stage.classList.remove('drag'); }
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    stage.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 30 : 10, used = true;
      if (e.key === 'ArrowLeft') st.ox += step; else if (e.key === 'ArrowRight') st.ox -= step;
      else if (e.key === 'ArrowUp') st.oy += step; else if (e.key === 'ArrowDown') st.oy -= step;
      else if (e.key === '+' || e.key === '=') setZoom(st.z + 0.1); else if (e.key === '-') setZoom(st.z - 0.1);
      else used = false;
      if (used) { e.preventDefault(); apply(); }
    });
    zoom.addEventListener('input', function () { setZoom(Number(zoom.value) / 100); });
    xr.addEventListener('input', function () { st.ox = Number(xr.value) / 100 * maxOff().x; apply(); });
    yr.addEventListener('input', function () { st.oy = Number(yr.value) / 100 * maxOff().y; apply(); });
    bCenter.onclick = function () { st.ox = 0; st.oy = 0; apply(); };
    bZoom.onclick = function () { setZoom(1); };
    bReset.onclick = function () { st.z = 1; st.ox = 0; st.oy = 0; apply(); };
    bChange.onclick = function () { if (!st.busy) file.click(); };
    file.onchange = function () { var f = file.files[0]; file.value = ''; if (f) setFile(f, true); };

    /* ---------- carga / cierre ---------- */
    function showErr(msg) { err.textContent = msg; err.hidden = !msg; }
    function release() { if (st.url) { URL.revokeObjectURL(st.url); st.url = null; } imgEl.removeAttribute('src'); }
    function setFile(f, isReplace) {
      showErr('');
      return loadImage(f).then(function (r) {
        var small = Math.min(r.img.naturalWidth, r.img.naturalHeight) < cfg.minSide;
        release(); st.img = r.img; st.url = r.url; st.z = 1; st.ox = 0; st.oy = 0; imgEl.src = r.url;
        bSave.disabled = false; layout();
        if (small) showErr('La imagen es pequeña (' + r.img.naturalWidth + '×' + r.img.naturalHeight + ' px) y puede verse borrosa. Se recomienda mínimo ' + (opts.kind === 'logo' ? '400×400' : '1200×600') + ' px.');
      }).catch(function (e) {
        showErr(LOAD_MSG[e && e.code] || LOAD_MSG.corrupt);
        if (!isReplace) { bSave.disabled = true; }
      });
    }
    function close() {
      if (st.closed) return; st.closed = true;
      document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', layout);
      cancelAnimationFrame(raf); release(); pointers.clear(); st.img = null;
      bg.remove(); document.documentElement.style.overflow = st.prevOverflow || '';
      if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) {} }
      if (opts.onClose) { try { opts.onClose(); } catch (e) {} }
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); if (!st.busy) close(); return; }
      if (e.key !== 'Tab') return;
      var f = Array.from(box.querySelectorAll('button:not([disabled]),input:not([disabled]):not([hidden]),[tabindex="0"]')).filter(function (n) { return n.offsetParent !== null; });
      if (!f.length) return; var a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    }
    bCancel.onclick = function () { if (!st.busy) close(); };
    bg.addEventListener('mousedown', function (e) { if (e.target === bg && !st.busy) close(); });

    bSave.onclick = async function () {
      if (st.busy || !st.img) return;           // protección contra doble clic
      st.busy = true; showErr('');
      [bSave, bCancel, bChange, bReset, bZoom, bCenter, zoom, xr, yr].forEach(function (n) { n.disabled = true; });
      var label = bSave.textContent; bSave.textContent = ''; bSave.append(el('span', { class: 'kpe-spin' }), document.createTextNode(' Guardando…'));
      try {
        var cv = document.createElement('canvas'); cv.width = cfg.out[0]; cv.height = cfg.out[1];
        render(cv, cfg.out[0], cfg.out[1]);
        var q = cfg.q, blob = await canvasToBlob(cv, 'image/jpeg', q);
        while (blob && blob.size > cfg.maxBytes && q > 0.5) { q -= 0.08; blob = await canvasToBlob(cv, 'image/jpeg', q); }
        cv.width = cv.height = 0;
        if (!blob || blob.size < 500 || blob.type !== 'image/jpeg') throw { code: 'export' };
        await opts.onSave(blob);
        close();
      } catch (e) {
        console.error(e);
        showErr(e && e.code === 'export' ? 'No pudimos preparar la imagen. Prueba con otra foto.' : 'No se pudo guardar la imagen. Revisa tu conexión e inténtalo de nuevo.');
        st.busy = false; [bSave, bCancel, bChange, bReset, bZoom, bCenter, zoom].forEach(function (n) { n.disabled = false; });
        bSave.textContent = label; apply();
      }
    };

    st.prevOverflow = document.documentElement.style.overflow; document.documentElement.style.overflow = 'hidden';
    document.body.appendChild(bg); document.addEventListener('keydown', onKey, true); window.addEventListener('resize', layout);
    bSave.disabled = true; layout();
    setFile(opts.file, false).then(function () { stage.focus({ preventScroll: true }); });
    return { close: close };
  }

  /* Guía de dimensiones del banner (se coloca bajo el selector). Medidas reales del menú: ver BANNER_PREVIEWS. */
  function bannerGuide() {
    injectCSS();
    return el('div', { class: 'kpe-guide' }, [
      el('div', null, [el('b', { text: 'Tamaño recomendado: 1600 × 800 px' }), document.createTextNode(' (proporción 2:1).')]),
      el('div', { text: 'Formatos: JPG, PNG o WebP · Peso máximo de la imagen elegida: 12 MB (se optimiza a menos de 600 KB al guardar).' }),
      el('div', { class: 'kpe-zone' }, [
        el('div', { class: 'kpe-mini', 'aria-hidden': 'true' }, [el('i')]),
        el('div', { text: 'En el menú el encabezado se recorta según el ancho del celular y la altura que elijas (automática, baja, media o alta). Deja lo importante dentro de la zona punteada: el 60 % central siempre se ve.' })
      ])
    ]);
  }

  window.KARTTA_PHOTO = { edit: open, bannerGuide: bannerGuide };
})();
