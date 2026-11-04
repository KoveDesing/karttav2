/* KARTTA Dynamic Cards — reemplazo visual de alert() / confirm() / prompt().
   Misma semántica que las nativas pero con promesas:
     await KDialog.confirm({ title, message, ok, cancel, danger })  -> true | false
     await KDialog.prompt({ title, message, label, placeholder, value, maxlength, ok, required, inputmode }) -> string | null
     await KDialog.alert({ title, message, ok })                      -> undefined
   Usa los tokens de cada página (--accent / --red, --panel, --border, --strong/--text, --muted), así respeta
   el acento del restaurante y el tema claro/oscuro sin duplicar estilos. */
(function () {
  if (window.KDialog) return;
  var css = '' +
    '.kd-bg{position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.6);opacity:0;transition:opacity .18s ease}' +
    '.kd-bg.in{opacity:1}' +
    '.kd-card{width:100%;max-width:420px;max-height:92vh;overflow:auto;background:var(--panel,#151515);color:var(--text,#E4E4E4);border:1px solid var(--border,#262626);border-radius:22px;padding:24px;box-shadow:0 30px 80px -20px rgba(0,0,0,.6);transform:translateY(10px) scale(.97);opacity:0;transition:transform .22s cubic-bezier(.16,1,.3,1),opacity .18s ease;font-family:inherit}' +
    '.kd-bg.in .kd-card{transform:none;opacity:1}' +
    '.kd-card h3{margin:0 0 6px;font-size:18px;font-weight:800;color:var(--strong,#fff);letter-spacing:-.01em}' +
    '.kd-card p{margin:0 0 16px;font-size:14px;line-height:1.5;color:var(--muted,#8F8F8F)}' +
    '.kd-card label{display:block;font-size:12px;font-weight:700;margin:0 0 6px;color:var(--text,#E4E4E4)}' +
    '.kd-card input{width:100%;min-height:46px;padding:11px 13px;border:1px solid var(--border,#303030);border-radius:12px;background:var(--panel2,#292929);color:var(--strong,#fff);font:inherit;font-size:15px;outline:none;transition:border-color .15s ease,box-shadow .15s ease}' +
    '.kd-card input::placeholder{color:var(--muted,#777)}' +
    '.kd-card input:focus{border-color:var(--accent,var(--red,#FF3145));box-shadow:0 0 0 3px color-mix(in srgb,var(--accent,var(--red,#FF3145)) 18%,transparent)}' +
    '.kd-err{min-height:18px;margin:6px 0 0;font-size:12.5px;color:#FF5A5A}' +
    '.kd-row{display:flex;gap:10px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap}' +
    '.kd-btn{min-height:44px;padding:0 18px;border-radius:12px;border:1px solid var(--border,#303030);background:var(--panel2,#1C1C1C);color:var(--strong,#fff);font:inherit;font-size:13.5px;font-weight:700;cursor:pointer;transition:transform .15s ease,filter .15s ease,background .15s ease}' +
    '.kd-btn:hover{filter:brightness(1.1)}.kd-btn:active{transform:scale(.97)}' +
    '.kd-btn.pri{background:var(--accent,var(--red,#FF3145));border-color:transparent;color:var(--on-accent,#fff)}' +
    '.kd-btn.dan{background:#E5323F;border-color:transparent;color:#fff}' +
    '.kd-btn:focus-visible{outline:2px solid var(--accent,var(--red,#FF3145));outline-offset:2px}' +
    '@media (max-width:480px){.kd-bg{align-items:flex-end;padding:12px}.kd-card{max-width:none}.kd-row .kd-btn{flex:1}}' +
    '@media (prefers-reduced-motion:reduce){.kd-bg,.kd-card,.kd-btn{transition:none!important}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function el(tag, cls, txt) { var n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; }

  function open(o, build) {
    return new Promise(function (resolve) {
      var prev = document.activeElement, n = 'kd' + Math.random().toString(36).slice(2, 8), done = false;
      var bg = el('div', 'kd-bg'), card = el('div', 'kd-card');
      bg.setAttribute('role', 'dialog'); bg.setAttribute('aria-modal', 'true'); bg.setAttribute('aria-labelledby', n + 't');
      var h = el('h3', null, o.title || ''); h.id = n + 't'; card.appendChild(h);
      if (o.message) card.appendChild(el('p', null, o.message));
      function close(val) {
        if (done) return; done = true; document.removeEventListener('keydown', onKey, true); bg.classList.remove('in');
        setTimeout(function () { bg.remove(); if (prev && prev.focus) { try { prev.focus(); } catch (e) {} } }, matchMedia('(prefers-reduced-motion:reduce)').matches ? 0 : 180);
        resolve(val);
      }
      var ctl = build(card, close);
      function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(ctl.cancelValue); }
        else if (e.key === 'Enter' && ctl.onEnter && e.target.tagName !== 'BUTTON') { e.preventDefault(); ctl.onEnter(); }
        else if (e.key === 'Tab') {
          var f = Array.prototype.slice.call(card.querySelectorAll('button,input')).filter(function (x) { return !x.disabled; });
          if (!f.length) return; var i = f.indexOf(document.activeElement);
          if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
        }
      }
      document.addEventListener('keydown', onKey, true);
      bg.addEventListener('mousedown', function (e) { if (e.target === bg) close(ctl.cancelValue); });
      bg.appendChild(card); document.body.appendChild(bg);
      requestAnimationFrame(function () { bg.classList.add('in'); });
      setTimeout(function () { if (ctl.focus) ctl.focus.focus(); }, 30);
    });
  }

  function asOpts(a, b) { return typeof a === 'string' ? { message: a, title: b } : (a || {}); }

  window.KDialog = {
    confirm: function (a) {
      var o = asOpts(a);
      return open(o, function (card, close) {
        var row = el('div', 'kd-row'), no = el('button', 'kd-btn', o.cancel || 'Cancelar'), ok = el('button', 'kd-btn ' + (o.danger ? 'dan' : 'pri'), o.ok || 'Confirmar');
        no.type = ok.type = 'button'; no.onclick = function () { close(false); }; ok.onclick = function () { close(true); };
        row.append(no, ok); card.appendChild(row);
        return { cancelValue: false, focus: o.danger ? no : ok };
      });
    },
    alert: function (a) {
      var o = asOpts(a);
      return open(o, function (card, close) {
        var row = el('div', 'kd-row'), ok = el('button', 'kd-btn pri', o.ok || 'Entendido'); ok.type = 'button'; ok.onclick = function () { close(); };
        row.appendChild(ok); card.appendChild(row);
        return { cancelValue: undefined, focus: ok, onEnter: function () { close(); } };
      });
    },
    prompt: function (a) {
      var o = asOpts(a);
      return open(o, function (card, close) {
        if (o.label) { var l = el('label', null, o.label); card.appendChild(l); }
        var inp = el('input'); inp.type = o.type || 'text'; inp.value = o.value || ''; if (o.placeholder) inp.placeholder = o.placeholder;
        if (o.maxlength) inp.maxLength = o.maxlength; if (o.inputmode) inp.inputMode = o.inputmode; inp.autocomplete = 'off';
        if (o.label) inp.setAttribute('aria-label', o.label);
        var err = el('div', 'kd-err'); err.setAttribute('role', 'alert');
        var row = el('div', 'kd-row'), no = el('button', 'kd-btn', o.cancel || 'Cancelar'), ok = el('button', 'kd-btn pri', o.ok || 'Aceptar');
        no.type = ok.type = 'button';
        function submit() {
          var v = inp.value.trim();
          if (o.required !== false && !v) { err.textContent = o.requiredMsg || 'Escribe algo para continuar.'; inp.focus(); return; }
          if (o.validate) { var m = o.validate(v); if (m) { err.textContent = m; inp.focus(); return; } }
          close(v);
        }
        inp.addEventListener('input', function () { err.textContent = ''; });
        no.onclick = function () { close(null); }; ok.onclick = submit;
        row.append(no, ok); card.append(inp, err, row);
        return { cancelValue: null, focus: inp, onEnter: submit };
      });
    }
  };
})();
