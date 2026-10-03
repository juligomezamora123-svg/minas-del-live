(function () {
  'use strict';

  // =====================================================================
  // utilidades
  // =====================================================================
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var fmt = function (n) { n = Number(n) || 0; return (n < 0 ? '-' : '') + String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); };
  var signed = function (n) { return (n > 0 ? '+' : '') + fmt(n); };
  var pesos = function (n) { return '$' + fmt(n); };
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } },
  };
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }
  function fmtFull(iso) {
    try { return new Date(iso).toLocaleString('es', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }
  function hexToRgb(h) {
    var m = /^#?([0-9a-f]{6})$/i.exec(h || '');
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mixRgb(a, b, t) { return [0, 1, 2].map(function (i) { return Math.round(a[i] + (b[i] - a[i]) * t); }); }
  function rgbStr(a) { return 'rgb(' + a.join(',') + ')'; }
  function randId() { return 't' + Math.random().toString(36).slice(2, 10); }

  async function api(method, path, body) {
    var opts = { method: method, credentials: 'same-origin', headers: {} };
    if (method !== 'GET') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body || {});
    }
    var res;
    try { res = await fetch(path, opts); } catch (e) { var ne = new Error('Sin conexión con el servidor. Revisa tu internet.'); ne.status = 0; throw ne; }
    var data = {};
    try { data = await res.json(); } catch (e) { /* sin cuerpo */ }
    if (!res.ok) {
      var err = new Error(data.error || 'Algo salió mal.');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  var toastTimer = null;
  function toast(msg, kind) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast ' + (kind || '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3600);
  }

  var confirmCb = null;
  function askConfirm(message, onYes) {
    $('confirmMessage').textContent = message;
    confirmCb = onYes;
    $('confirmModal').hidden = false;
  }
  function closeConfirm() { $('confirmModal').hidden = true; confirmCb = null; }
  $('confirmOkBtn').addEventListener('click', function () { var cb = confirmCb; closeConfirm(); if (cb) cb(); });
  $('confirmCancelBtn').addEventListener('click', closeConfirm);
  $('confirmModal').addEventListener('click', function (e) { if (e.target === $('confirmModal')) closeConfirm(); });

  // =====================================================================
  // estado
  // =====================================================================
  var DEFAULT_TEXTS = {
    eyebrow: 'TikTok Live · Sorteo de regalos', title: 'Minas del Live', controlHeading: 'Panel de control',
    controlIntro: '', prizesHeading: 'Premios del tablero', prizesSub: '', stageHeading: 'Tablero en vivo', playerHeading: 'Tu tablero',
  };
  var DEFAULT_THEME = { accent: '#FFC93C', bg: '#0B0509' };
  var METHOD_TXT = { banco: 'Transferencia bancaria', breb: 'Bre-B', usdt: 'USDT (red TRC-20)', nequi: 'Nequi', daviplata: 'Daviplata', otro: 'Otro medio' };
  var WD_METHODS = ['banco', 'breb', 'usdt', 'nequi', 'daviplata', 'otro'];
  var STATUS_TXT = { pending: 'Pendiente', paid: 'Pagado', rejected: 'Rechazado' };

  var me = null;
  var site = { texts: DEFAULT_TEXTS, money: { pointValue: 1, minWithdraw: 0, methods: { banco: true }, banks: [], askDoc: true, title: '🏦 Retirar a cuenta bancaria o cripto', note: '' }, support: { hours: '', message: '', email: '' } };
  var unread = 0, pendingWd = 0;
  var view = store.get('minasView', 'player');
  var prevView = null;
  var game = null;          // partida actual de la página que se está viendo
  var busy = false;         // evita doble clic mientras el servidor responde
  var myWds = [];
  var authTab = 'login';
  var ownerExists = true;

  var adm = {
    target: store.get('minasAdminTarget', 'live') === 'player' ? 'player' : 'live',
    tab: store.get('minasAdminTab', 'premios'),
    cfgs: { live: null, player: null },
    dirty: { live: false, player: false, site: false },
    draft: null,   // copia editable de { texts, money, support }
    players: [], wds: [], tickets: [],
  };
  var TABS = ['premios', 'colores', 'reglas', 'textos', 'jugadores', 'retiros', 'soporte'];
  if (TABS.indexOf(adm.tab) < 0) adm.tab = 'premios';

  var isOwner = function () { return !!me && me.role === 'owner'; };
  var pageOfView = function () { return view === 'live' ? 'live' : 'player'; };
  var playing = function () { return view === 'live' || view === 'player'; };

  // =====================================================================
  // apariencia: ancho, pantalla completa, barra superior, fondo
  // =====================================================================
  var wide = (function () { var v = store.get('minasWide2', null); return v === '1' ? true : v === '0' ? false : null; })();
  var headerHidden = store.get('minasHeaderHidden', '0') === '1';
  function isWide() { return wide === null ? window.innerWidth >= 860 : wide; }
  function fsOn() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function applyFs() {
    var on = fsOn();
    document.body.classList.toggle('fs', on);
    var b = $('fsBtn');
    b.classList.toggle('on', on);
    b.textContent = on ? '⛶ Salir de pantalla completa' : '⛶ Pantalla completa';
  }
  function applyWide() {
    var on = isWide();
    document.body.classList.toggle('wide', on);
    var b = $('wideBtn');
    b.classList.toggle('on', on);
    b.textContent = on ? '🖥 Web completo ✓' : '🖥 Web completo';
    b.setAttribute('aria-pressed', String(on));
  }
  /** En modo ancho el tablero se mide con la altura libre para verlo entero sin bajar. */
  function fitBoard() {
    var g = $('grid'), root = document.documentElement.style;
    var b = document.body.classList;
    root.removeProperty('--chrome');
    if (!b.contains('wide') || !b.contains('playing') || window.innerWidth < 860) return;
    var top = g.getBoundingClientRect().top + window.scrollY;
    root.setProperty('--chrome', Math.round(top + 18) + 'px');
  }
  $('wideBtn').addEventListener('click', function () {
    wide = !isWide();
    store.set('minasWide2', wide ? '1' : '0');
    applyWide(); fitBoard();
  });
  $('fsBtn').addEventListener('click', function () {
    var el = document.documentElement;
    try {
      if (fsOn()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
      var req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (!req) throw new Error('no');
      var p = req.call(el);
      if (p && p.catch) p.catch(function () { toast('Tu navegador bloqueó la pantalla completa. Prueba con F11.', 'err'); });
    } catch (e) { toast('Tu navegador no permite pantalla completa desde aquí. Prueba con F11.', 'err'); }
  });
  document.addEventListener('fullscreenchange', function () { applyFs(); setTimeout(fitBoard, 50); });
  document.addEventListener('webkitfullscreenchange', function () { applyFs(); setTimeout(fitBoard, 50); });
  window.addEventListener('resize', function () { if (wide === null) applyWide(); fitBoard(); });
  $('headerToggleBtn').addEventListener('click', function () {
    headerHidden = !headerHidden;
    store.set('minasHeaderHidden', headerHidden ? '1' : '0');
    document.body.classList.toggle('header-hidden', headerHidden);
    $('headerToggleBtn').textContent = headerHidden ? '▸' : '▾';
    setTimeout(fitBoard, 30);
  });

  (function initBgFx() {
    var el = $('bgFx'), symbols = ['🪙', '🪙', '✨', '♦️', '🪙', '✨', '♣️'];
    for (var i = 0; i < 16; i++) {
      var s = document.createElement('span');
      s.className = 'spark';
      s.textContent = symbols[Math.floor(Math.random() * symbols.length)];
      var dur = 16 + Math.random() * 16;
      s.style.left = (Math.random() * 100) + '%';
      s.style.fontSize = (14 + Math.random() * 18) + 'px';
      s.style.animationDuration = dur + 's';
      s.style.animationDelay = (-Math.random() * dur) + 's';
      el.appendChild(s);
    }
  })();

  function applyTheme(settings) {
    var s = settings || DEFAULT_THEME, rs = document.documentElement.style;
    var acc = hexToRgb(s.accent) ? s.accent : DEFAULT_THEME.accent;
    rs.setProperty('--gold', acc);
    rs.setProperty('--gold-soft', 'rgba(' + hexToRgb(acc).join(',') + ',.2)');
    rs.setProperty('--bg', hexToRgb(s.bg) ? s.bg : DEFAULT_THEME.bg);
  }

  // =====================================================================
  // colores y fichas de premio
  // =====================================================================
  var PALETTE = [
    { fg: '#FFF3C4', mid: '#FFC93C', dark: '#A9740E', border: '#FFE27A', glow: '255,201,60' },
    { fg: '#FF95A5', mid: '#E8213F', dark: '#7A0E1E', border: '#FF6B84', glow: '232,33,63' },
    { fg: '#C9F7E5', mid: '#1BE39A', dark: '#0B6E4C', border: '#6FFFC9', glow: '27,227,154' },
    { fg: '#E2D2FF', mid: '#9B5CFF', dark: '#4A1F8A', border: '#C39CFF', glow: '155,92,255' },
    { fg: '#4A4A4A', mid: '#1A1A1A', dark: '#000000', border: '#5A5A5A', glow: '0,0,0' },
  ];
  function autoHex(t, idx) {
    if (t.wipeout) return '#FF1E3C';
    if ((t.points || 0) < 0) return '#7A0000';
    return PALETTE[idx % PALETTE.length].mid;
  }
  function cellStyleFor(tier, idx) {
    var cc = tier && hexToRgb(tier.color);
    if (cc) return 'background:radial-gradient(circle at 34% 28%,' + rgbStr(mixRgb(cc, [255, 255, 255], .6)) + ',' + rgbStr(cc) + ' 55%,' + rgbStr(mixRgb(cc, [0, 0, 0], .55)) + ' 100%);border-color:' + rgbStr(mixRgb(cc, [255, 255, 255], .35)) + ';box-shadow:0 0 14px rgba(' + cc.join(',') + ',.45);';
    if (tier && tier.wipeout) return 'background:radial-gradient(circle at 34% 28%,#FFD9D9,#FF1E3C 55%,#3A0008 100%);border-color:#FF6B84;box-shadow:0 0 18px rgba(255,20,50,.6);';
    if (tier && (tier.points || 0) < 0) return 'background:radial-gradient(circle at 34% 28%,#7A2A2A,#7A0000 55%,#1A0000 100%);border-color:#FF3B3B;box-shadow:0 0 14px rgba(255,40,40,.4);';
    var p = PALETTE[idx % PALETTE.length];
    return 'background:radial-gradient(circle at 34% 28%,' + p.fg + ',' + p.mid + ' 55%,' + p.dark + ' 100%);border-color:' + p.border + ';box-shadow:0 0 14px rgba(' + p.glow + ',.45);';
  }
  function chipStyleFor(tier, idx) {
    var cc = tier && hexToRgb(tier.color);
    if (cc) return 'background:rgba(' + cc.join(',') + ',.22);border-color:' + rgbStr(cc) + ';';
    if (tier && tier.wipeout) return 'background:rgba(255,20,50,.28);border-color:#FF1E3C;';
    if (tier && (tier.points || 0) < 0) return 'background:rgba(255,40,40,.18);border-color:#FF3B3B;';
    var p = PALETTE[idx % PALETTE.length];
    return 'background:rgba(' + p.glow + ',.22);border-color:' + p.mid + ';';
  }

  // =====================================================================
  // textos del sitio
  // =====================================================================
  function renderTexts() {
    var t = (view === 'admin' && adm.draft) ? adm.draft.texts : site.texts;
    $('brandEyebrow').textContent = t.eyebrow;
    $('brandTitle').textContent = t.title;
    document.title = t.title;
    $('controlHeadingText').textContent = t.controlHeading;
    $('controlIntroText').textContent = t.controlIntro;
    $('prizesHeadingText').textContent = t.prizesHeading;
    $('prizesSubText').textContent = t.prizesSub;
    $('stageHeadingText').textContent = view === 'player' ? t.playerHeading : t.stageHeading;
  }

  // =====================================================================
  // sesión y arranque
  // =====================================================================
  async function refreshMe() {
    var d = await api('GET', '/api/me');
    me = d.user;
    if (d.site) site = d.site;
    unread = d.unread || 0;
    pendingWd = d.pending || 0;
  }

  function renderChrome() {
    var logged = !!me;
    document.body.classList.toggle('noauth', !logged);
    $('authScreen').hidden = logged;
    $('mainLayout').hidden = !logged;
    $('userChip').hidden = !logged;
    $('viewSwitch').hidden = !isOwner();
    $('saveBar').hidden = !(isOwner() && view === 'admin');
    if (logged) {
      $('userName').textContent = '👤 ' + me.username + (isOwner() ? ' · Dueño' : '');
      $('userBalance').textContent = 'Saldo ' + pesos(me.balance);
      $('withdrawBtn').disabled = me.balance < 1;
      var b = $('supBtnBadge');
      b.hidden = !(unread > 0);
      b.textContent = unread;
      var pb = $('pendingBadge'); pb.hidden = !(pendingWd > 0); pb.textContent = pendingWd;
      var sb = $('supBadge'); sb.hidden = !(isOwner() && unread > 0); sb.textContent = unread;
    }
    [['admin', 'viewAdminBtn'], ['live', 'viewLiveBtn'], ['player', 'viewPlayerBtn']].forEach(function (p) {
      $(p[1]).classList.toggle('active', view === p[0]);
    });
    document.body.classList.toggle('playing', logged && playing());
    document.body.classList.toggle('account', logged && view === 'account');
    $('userName').classList.toggle('active', view === 'account');
    renderTexts();
  }

  async function boot() {
    applyWide(); applyFs();
    document.body.classList.toggle('header-hidden', headerHidden);
    $('headerToggleBtn').textContent = headerHidden ? '▸' : '▾';
    try { await refreshMe(); } catch (e) { toast(e.message, 'err'); }
    if (!me) {
      try { ownerExists = (await api('GET', '/api/auth/owner-exists')).exists; } catch (e) { ownerExists = true; }
      applyTheme(null); renderChrome(); renderAuth();
      return;
    }
    if (!isOwner()) view = 'player';
    else if (['admin', 'live', 'player'].indexOf(view) < 0) view = 'player';
    await go(view, true);
  }

  async function go(v, initial) {
    if (!me) return;
    if (!isOwner() && v !== 'player' && v !== 'account') v = 'player';
    if (v === 'account' && view !== 'account') prevView = view;
    if (view === 'admin' && v !== 'admin' && v !== 'account' && isDirty() && !initial) {
      askConfirm('Tienes cambios sin guardar en Administrador. ¿Guardarlos ahora?', function () { saveAll(); });
    }
    view = v;
    if (v !== 'account') store.set('minasView', v);
    renderChrome();
    try {
      if (v === 'admin') await enterAdmin();
      else if (v === 'account') await enterAccount();
      else await enterPlay();
    } catch (e) {
      if (e.status === 401) { me = null; renderChrome(); renderAuth(); }
      toast(e.message, 'err');
    }
    setTimeout(fitBoard, 30);
  }

  // =====================================================================
  // pantalla de ingreso
  // =====================================================================
  function authMsg(text, ok) { var m = $('authMsg'); m.textContent = text || ''; m.className = 'auth-msg' + (ok ? ' ok' : ''); }
  function renderAuth() {
    $('ownerTab').hidden = ownerExists;
    if (authTab === 'owner' && ownerExists) authTab = 'login';
    document.querySelectorAll('#authTabs [data-auth]').forEach(function (b) { b.classList.toggle('active', b.dataset.auth === authTab); });
    document.querySelectorAll('[data-auth-form]').forEach(function (f) { f.hidden = f.dataset.authForm !== authTab; });
    $('authTitle').textContent = { login: '🔐 Ingresar', register: '📝 Crear cuenta', owner: '🛠 Cuenta del dueño', forgot: '🔑 Recuperar clave' }[authTab] || '🔐 Ingresar';
  }
  $('authScreen').addEventListener('click', function (e) {
    var b = e.target.closest('[data-auth]');
    if (!b) return;
    authTab = b.dataset.auth; authMsg('');
    if (authTab === 'forgot') resetForgot();
    renderAuth();
  });

  async function afterLogin(user) {
    me = user;
    ['loginId', 'loginPass', 'regUser', 'regEmail', 'regPhone', 'regPass', 'regPass2', 'ownKey', 'ownUser', 'ownEmail', 'ownPhone', 'ownPass', 'ownPass2', 'fgEmail', 'fgCode', 'fgPass', 'fgPass2'].forEach(function (k) { $(k).value = ''; });
    authMsg('');
    await refreshMe();
    view = isOwner() ? (store.get('minasView', 'admin') === 'account' ? 'admin' : store.get('minasView', 'admin')) : 'player';
    await go(view, true);
  }

  function formBusy(form, on) {
    form.querySelectorAll('button[type=submit]').forEach(function (b) { b.disabled = on; });
  }

  $('loginForm').addEventListener('submit', async function (e) {
    e.preventDefault(); formBusy(this, true);
    try {
      var d = await api('POST', '/api/auth/login', { id: $('loginId').value, password: $('loginPass').value });
      await afterLogin(d.user);
    } catch (err) { authMsg(err.message); }
    formBusy(this, false);
  });

  $('registerForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    if ($('regPass').value !== $('regPass2').value) return authMsg('Las dos claves no coinciden.');
    formBusy(this, true);
    try {
      var d = await api('POST', '/api/auth/register', { username: $('regUser').value, email: $('regEmail').value, phone: $('regPhone').value, password: $('regPass').value });
      await afterLogin(d.user);
    } catch (err) { authMsg(err.message); }
    formBusy(this, false);
  });

  $('ownerForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    if ($('ownPass').value !== $('ownPass2').value) return authMsg('Las dos claves no coinciden.');
    formBusy(this, true);
    try {
      var d = await api('POST', '/api/auth/owner', { setupKey: $('ownKey').value, username: $('ownUser').value, email: $('ownEmail').value, phone: $('ownPhone').value, password: $('ownPass').value });
      ownerExists = true;
      await afterLogin(d.user);
    } catch (err) { authMsg(err.message); }
    formBusy(this, false);
  });

  // recuperar clave: 1) pedir el código al correo, 2) escribir el código y la clave nueva
  var forgotStep = 1;
  function resetForgot() {
    forgotStep = 1;
    $('forgotStep2').hidden = true;
    $('fgEmail').readOnly = false;
    $('fgSubmit').textContent = 'Enviarme el código';
    $('forgotHint').textContent = 'Escribe el correo de tu cuenta y te enviamos un código de 6 dígitos.';
  }
  $('forgotForm').addEventListener('submit', async function (e) {
    e.preventDefault(); formBusy(this, true);
    try {
      if (forgotStep === 1) {
        await api('POST', '/api/auth/forgot', { email: $('fgEmail').value });
        forgotStep = 2;
        $('forgotStep2').hidden = false;
        $('fgEmail').readOnly = true;
        $('fgSubmit').textContent = 'Cambiar mi clave';
        $('forgotHint').textContent = 'Si ese correo tiene cuenta, te llegó un código de 6 dígitos (revisa también spam). Sirve 10 minutos.';
        authMsg('');
      } else {
        if ($('fgPass').value !== $('fgPass2').value) { authMsg('Las dos claves no coinciden.'); formBusy(this, false); return; }
        await api('POST', '/api/auth/reset', { email: $('fgEmail').value, code: $('fgCode').value, password: $('fgPass').value });
        var em = $('fgEmail').value;
        resetForgot(); authTab = 'login'; renderAuth();
        $('loginId').value = em; $('loginPass').value = '';
        ['fgCode', 'fgPass', 'fgPass2'].forEach(function (k) { $(k).value = ''; });
        authMsg('Clave cambiada. Ingresa con tu clave nueva.', true);
      }
    } catch (err) { authMsg(err.message); }
    formBusy(this, false);
  });

  $('logoutBtn').addEventListener('click', function () {
    var out = async function () {
      try { await api('POST', '/api/auth/logout'); } catch (e) { /* igual se cierra */ }
      me = null; game = null; view = 'player'; adm.cfgs = { live: null, player: null }; adm.draft = null; adm.dirty = { live: false, player: false, site: false };
      try { ownerExists = (await api('GET', '/api/auth/owner-exists')).exists; } catch (e) { /* sin cambio */ }
      authTab = 'login'; applyTheme(null); renderChrome(); renderAuth();
    };
    if (view === 'admin' && isDirty()) askConfirm('Tienes cambios sin guardar. ¿Salir de todos modos?', out); else out();
  });

  // ojito para ver u ocultar lo que se escribe
  function wireEye(input, eye) {
    eye.addEventListener('click', function () {
      var hide = input.type === 'text';
      input.type = hide ? 'password' : 'text';
      eye.textContent = hide ? '👁' : '🙈';
    });
  }
  document.querySelectorAll('[data-eye-for]').forEach(function (b) { wireEye($(b.dataset.eyeFor), b); });

  // =====================================================================
  // juego
  // =====================================================================
  async function enterPlay() {
    var page = pageOfView();
    var d = await api('GET', '/api/game?page=' + page);
    game = d.game;
    renderPlay();
    loadMyWithdrawals();
  }

  function tierIdx(key) { return game.tiers.findIndex(function (t) { return t.key === key; }); }
  function tierOfKey(key) { return game.tiers[tierIdx(key)] || null; }

  function pointsBadge(tier) {
    if (!game.settings.showCellPoints) return '';
    if (!tier) return '<span class="cell-points">0</span>';
    if (tier.wipeout) return '<span class="cell-points cell-points-wipe">¡TODO!</span>';
    var v = tier.points || 0;
    return '<span class="cell-points ' + (v < 0 ? 'cell-points-neg' : v > 0 ? 'cell-points-pos' : '') + '">' + signed(v) + '</span>';
  }

  function gridHTML() {
    var openedMap = {}, last = game.opened.length ? game.opened[game.opened.length - 1].idx : -1;
    game.opened.forEach(function (o) { openedMap[o.idx] = o.key; });
    var over = game.status !== 'active', out = '';
    for (var i = 0; i < game.totalCells; i++) {
      var n = i + 1;
      if (openedMap[i] === undefined) {
        out += over
          ? '<button class="cell hidden" data-idx="' + i + '" disabled aria-label="Casilla ' + n + '">' + n + '</button>'
          : '<button class="cell hidden demo-clickable" data-idx="' + i + '" aria-label="Casilla ' + n + '">' + n + '</button>';
      } else {
        var key = openedMap[i], tier = tierOfKey(key);
        out += '<div class="cell revealed demo-mark ' + (i === last && game.status === 'active' ? 'just-revealed' : '') + '" style="' + cellStyleFor(tier, tierIdx(key)) + '" title="' + esc(tier ? tier.label : '') + '">' +
          '<span class="cell-emoji">' + esc(tier ? tier.emoji : '') + '</span>' + pointsBadge(tier) + '</div>';
      }
    }
    return out;
  }

  function bannerHTML() {
    var unit = esc(game.settings.unit || 'pts');
    var again = '<button type="button" class="btn btn-primary banner-newgame" data-action="restart">🆕 Crear nuevo juego</button>';
    var wd = me && me.balance >= 1 ? '<button type="button" class="btn banner-cash" data-action="withdraw">🏦 Retirar a cuenta bancaria o cripto</button>' : '';
    if (game.status === 'cashed') {
      return '<div class="banner-eyebrow">Puntos cobrados</div>' +
        '<div class="banner-cashed"><span class="cashed-label">💰 ¡Puntos cobrados!</span><span class="cashed-amount mono">' + signed(game.points) + '<small>' + unit + '</small></span></div>' +
        '<div class="banner-total">' + (game.pesos > 0 ? 'Se sumaron <b class="mono pos">' + pesos(game.pesos) + ' pesos</b> a tu saldo · ' : 'Sin puntos a favor: no se suma saldo · ') + 'El juego terminó</div>' +
        '<div class="banner-actions">' + again + wd + '</div>';
    }
    if (game.status === 'bomb') {
      return '<div class="banner-eyebrow">Fin del juego</div>' +
        '<div class="banner-over">💥 ¡BOMBA ROJA! Se perdió todo lo acumulado' + (game.lost > 0 ? ' (−' + fmt(game.lost) + ' ' + unit + ')' : '') + '</div>' +
        '<div class="banner-total">Suma final: <b class="mono neg">0 ' + unit + '</b> · El juego terminó</div>' +
        '<div class="banner-actions">' + again + wd + '</div>';
    }
    var sum = game.points, done = game.opened.length >= game.totalCells;
    return '<div class="banner-eyebrow">' + (done ? 'Tablero completo' : (game.page === 'live' ? 'En vivo' : 'Tu juego')) + '</div>' +
      '<div class="banner-main">' + (done ? '🎉 ¡Destapaste todo!' : '✨ Destapando premios...') + '</div>' +
      (game.settings.showTotal ? '<div class="banner-total">Suma de cajones abiertos: <b class="mono ' + (sum < 0 ? 'neg' : 'pos') + '">' + signed(sum) + ' ' + unit + '</b></div>' : '') +
      '<div class="banner-actions"><button type="button" class="btn banner-cash" data-action="cash"' + (game.opened.length ? '' : ' disabled') + '>💰 Cobrar puntos</button>' +
      '<button type="button" class="btn banner-restart" data-action="restart">🔁 Reiniciar juego</button>' + wd + '</div>';
  }

  function renderPlay() {
    applyTheme(game.settings);
    document.body.classList.toggle('no-pop', !game.settings.popAnimation);
    var cols = game.settings.columns > 0 ? game.settings.columns : Math.max(10, Math.ceil(Math.sqrt(game.totalCells)));
    $('grid').style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
    $('turnBanner').innerHTML = bannerHTML();
    $('grid').innerHTML = gridHTML();
    $('progressText').textContent = 'Destapadas ' + game.opened.length + '/' + game.totalCells + ' · Juego ' + game.code;
    var who = $('playerWho');
    who.hidden = false;
    who.textContent = isOwner() ? '👤 ' + me.username + ' · ' + (view === 'live' ? 'tu live' : 'vista previa del dueño') : '👤 ' + me.username + ' · ' + me.email;
    renderChrome();
    setTimeout(fitBoard, 0);
  }

  $('grid').addEventListener('click', async function (e) {
    var b = e.target.closest('.cell.demo-clickable');
    if (!b || busy || !game || game.status !== 'active') return;
    busy = true;
    try {
      var d = await api('POST', '/api/game/reveal', { id: game.id, idx: Number(b.dataset.idx) });
      game = d.game; renderPlay();
    } catch (err) {
      toast(err.message, 'err');
      if (err.status === 409) { try { game = (await api('GET', '/api/game?page=' + pageOfView())).game; renderPlay(); } catch (e2) { /* nada */ } }
    }
    busy = false;
  });

  $('turnBanner').addEventListener('click', function (e) {
    var a = e.target.closest('[data-action]');
    if (!a || busy || !game) return;
    var act = a.dataset.action;
    if (act === 'withdraw') return openWithdraw();
    if (act === 'cash') {
      var gain = Math.max(0, game.points) * site.money.pointValue;
      askConfirm('¿Cobrar ' + fmt(game.points) + ' ' + (game.settings.unit || 'pts') + ' (' + pesos(gain) + ' pesos a tu saldo) ahora? El juego termina y ya no podrás destapar más casillas.', async function () {
        busy = true;
        try {
          var d = await api('POST', '/api/game/cash', { id: game.id });
          game = d.game; me.balance = d.balance; renderPlay(); loadMyWithdrawals();
        } catch (err) { toast(err.message, 'err'); }
        busy = false;
      });
    } else if (act === 'restart') {
      var start = async function () {
        busy = true;
        try { game = (await api('POST', '/api/game/restart', { id: game.id })).game; renderPlay(); } catch (err) { toast(err.message, 'err'); }
        busy = false;
      };
      if (game.status === 'active' && game.opened.length > 0) askConfirm('¿Reiniciar el juego? Se pierde lo que llevas destapado y se reparten los premios de nuevo.', start); else start();
    }
  });

  // =====================================================================
  // retiros: ventana, lista y comprobante
  // =====================================================================
  var wdModal = $('withdrawModal');
  function activeMethods() { return WD_METHODS.filter(function (k) { return site.money.methods[k]; }); }
  function refreshWdFields() {
    var m = $('wdMethod').value;
    wdModal.querySelectorAll('[data-methods]').forEach(function (f) {
      var off = f.dataset.methods.split(' ').indexOf(m) < 0;
      if (f.classList.contains('wd-doc') && !site.money.askDoc) off = true;
      f.hidden = off;
    });
    $('wdNumberLabel').textContent = m === 'banco' ? 'Número de cuenta' : 'Celular';
  }
  function wdMsg(t) { $('wdMsg').textContent = t || ''; }
  function updateWdRemain() {
    var a = Math.floor(Number($('wdAmount').value)) || 0;
    $('wdRemain').textContent = a >= 1 && a <= me.balance ? 'Te quedarán ' + pesos(me.balance - a) + ' pesos' : '';
  }
  var SENS = ['wdNumber', 'wdDoc', 'wdKey', 'wdWallet'];
  SENS.forEach(function (id) {
    var inp = $(id), wrap = document.createElement('span');
    wrap.className = 'eye-wrap';
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    var eye = document.createElement('button');
    eye.type = 'button'; eye.className = 'eye-btn'; eye.textContent = '👁'; eye.title = 'Mostrar / ocultar';
    eye.setAttribute('aria-label', 'Mostrar u ocultar'); eye.setAttribute('data-eye', id);
    wrap.appendChild(eye);
    wireEye(inp, eye);
  });
  function hideWdFields() {
    SENS.forEach(function (id) { $(id).type = 'password'; var e = document.querySelector('[data-eye="' + id + '"]'); if (e) e.textContent = '👁'; });
  }

  function openWithdraw() {
    if (!me || me.balance < 1) return;
    var m = site.money;
    hideWdFields();
    $('wdTitle').textContent = m.title;
    $('wdNote').hidden = !m.note; $('wdNote').textContent = m.note;
    var act = activeMethods(), sel = $('wdMethod'), prev = sel.value;
    sel.innerHTML = act.map(function (k) { return '<option value="' + k + '">' + esc(METHOD_TXT[k]) + '</option>'; }).join('');
    if (act.indexOf(prev) >= 0) sel.value = prev;
    $('wdMethodWrap').hidden = act.length < 2;
    $('wdBanks').innerHTML = m.banks.map(function (b) { return '<option value="' + esc(b) + '">'; }).join('');
    refreshWdFields();
    $('wdBalanceInfo').textContent = 'Saldo disponible: ' + pesos(me.balance) + ' pesos' + (m.minWithdraw ? ' · Mínimo ' + pesos(m.minWithdraw) : '');
    $('wdAmount').max = me.balance; $('wdAmount').value = '';
    updateWdRemain(); wdMsg('');
    wdModal.hidden = false;
  }
  function closeWithdraw() { wdModal.hidden = true; }
  $('withdrawBtn').addEventListener('click', openWithdraw);
  $('wdCancel').addEventListener('click', closeWithdraw);
  $('wdMethod').addEventListener('change', refreshWdFields);
  $('wdAmount').addEventListener('input', updateWdRemain);
  $('wdAll').addEventListener('click', function () { $('wdAmount').value = Math.floor(me.balance); updateWdRemain(); });
  wdModal.addEventListener('click', function (e) { if (e.target === wdModal) closeWithdraw(); });

  $('withdrawForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var amount = Math.floor(Number($('wdAmount').value)), method = $('wdMethod').value;
    if (!(amount >= 1)) return wdMsg('Escribe cuántos pesos quieres retirar.');
    var details = {
      bank: $('wdBank').value, acctType: $('wdAcctType').value, number: $('wdNumber').value, holder: $('wdHolder').value, doc: $('wdDoc').value,
      keyType: $('wdKeyType').value, key: $('wdKey').value, wallet: $('wdWallet').value, other: $('wdOther').value,
    };
    $('wdSubmit').disabled = true;
    try {
      var d = await api('POST', '/api/withdrawals', { amount: amount, method: method, details: details, page: pageOfView() });
      me.balance = d.balance;
      ['wdBank', 'wdNumber', 'wdHolder', 'wdDoc', 'wdKey', 'wdWallet', 'wdOther', 'wdAmount'].forEach(function (k) { $(k).value = ''; });
      closeWithdraw();
      toast('Solicitud enviada. Queda pendiente hasta que el dueño la pague.', 'ok');
      renderChrome();
      if (playing()) { renderPlay(); loadMyWithdrawals(); }
    } catch (err) { wdMsg(err.message); }
    $('wdSubmit').disabled = false;
  });

  function secret(v) {
    v = String(v);
    var mask = '•'.repeat(Math.min(Math.max(v.length, 6), 14));
    return '<span class="secret" data-real="' + esc(v) + '" data-mask="' + mask + '">' + mask + '</span>';
  }
  function detailsHTML(w) {
    var d = w.details || {}, rows = [];
    if (d.bank) rows.push('Banco: ' + esc(d.bank));
    if (d.acctType) rows.push('Cuenta: ' + esc(d.acctType));
    if (d.keyType) rows.push('Llave Bre-B (' + esc(d.keyType) + '): ' + secret(d.key));
    if (d.wallet) rows.push('Billetera USDT (' + esc(d.network || 'TRC-20') + '): ' + secret(d.wallet));
    if (d.number) rows.push((w.method === 'banco' ? 'N.º de cuenta: ' : 'Celular: ') + secret(d.number));
    if (d.holder) rows.push('Titular: ' + esc(d.holder));
    if (d.doc) rows.push('Documento: ' + secret(d.doc));
    if (d.other) rows.push(esc(d.other));
    var sens = !!(d.key || d.wallet || d.number || d.doc);
    return rows.join('<br>') + (sens ? '<br><button type="button" class="link-btn" data-reveal="1">👁 Mostrar datos</button>' : '');
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-reveal]');
    if (!b) return;
    e.preventDefault();
    var box = b.closest('.req-data') || b.parentNode, show = b.dataset.reveal === '1';
    box.querySelectorAll('.secret').forEach(function (s) { s.textContent = show ? s.dataset.real : s.dataset.mask; s.style.wordBreak = 'break-all'; });
    b.dataset.reveal = show ? '0' : '1';
    b.textContent = show ? '🙈 Ocultar datos' : '👁 Mostrar datos';
  });

  var openReqs = {};
  document.addEventListener('toggle', function (e) {
    var d = e.target;
    if (d && d.matches && d.matches('details.req') && d.dataset.req) { if (d.open) openReqs[d.dataset.req] = true; else delete openReqs[d.dataset.req]; }
  }, true);

  function reqRowHTML(w, adminMode) {
    var acts = '';
    if (adminMode && w.status === 'pending') acts += '<button type="button" class="req-ico ok" data-wd-paid="' + w.id + '" title="Marcar como pagado">✅</button><button type="button" class="req-ico no" data-wd-reject="' + w.id + '" title="Rechazar">↩</button>';
    if (w.status === 'paid') acts += '<button type="button" class="req-ico" data-wd-receipt="' + w.id + '" title="Descargar comprobante">🧾</button>';
    return '<details class="req' + (w.status === 'pending' ? ' pending' : '') + '" data-req="' + w.id + '"' + (openReqs[w.id] ? ' open' : '') + '>' +
      '<summary><span class="status ' + w.status + '">' + STATUS_TXT[w.status] + '</span>' +
      '<b class="req-amount">' + pesos(w.amount) + '</b>' +
      '<span class="req-line">' + esc(METHOD_TXT[w.method] || w.method) + (adminMode ? ' · ' + esc(w.username) + ' · ' + (w.page === 'live' ? '🎮 Jugar' : '📺 Vista del jugador') : '') + ' · ' + fmtDate(w.createdAt) + '</span>' +
      '<span class="req-acts">' + acts + '</span></summary>' +
      '<div class="req-data">' + detailsHTML(w) + (adminMode && w.email ? '<br>Correo: ' + esc(w.email) : '') + '</div></details>';
  }

  async function loadMyWithdrawals() {
    if (!me) return;
    try { myWds = (await api('GET', '/api/withdrawals?mine=1')).withdrawals; } catch (e) { return; }
    var page = pageOfView();
    var list = myWds.filter(function (w) { return !isOwner() || w.page === page; });
    list.sort(function (a, b) { return (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || (a.createdAt < b.createdAt ? 1 : -1); });
    var box = $('myWithdrawals');
    box.hidden = !list.length;
    if (!list.length) return;
    $('myWithdrawalsTitle').textContent = isOwner() ? '💸 Retiros de ' + (page === 'live' ? 'Jugar' : 'la Vista del jugador') : '💸 Mis retiros';
    $('myWithdrawalsSub').textContent = isOwner() ? 'Solo se aprueban o rechazan desde Administrador' : 'Estado de tus solicitudes de pago';
    var shown = list.slice(0, 8);
    $('myWithdrawalsList').innerHTML = shown.map(function (w) { return reqRowHTML(w, false); }).join('') +
      (list.length > shown.length ? '<p class="empty-note">y ' + (list.length - shown.length) + ' más</p>' : '');
  }

  // comprobante en imagen (se dibuja en el navegador, sin librerías)
  function maskEnd(s, keep) { s = String(s || ''); return s.length <= keep ? s : '••••' + s.slice(-keep); }
  function receiptDest(w) {
    var d = w.details || {};
    if (w.method === 'banco') return (d.bank || '') + ' · ' + (d.acctType || '') + ' ' + maskEnd(d.number, 4);
    if (w.method === 'breb') return 'Llave ' + (d.keyType || '') + ' ' + maskEnd(d.key, 3);
    if (w.method === 'usdt') return 'TRC-20 ' + String(d.wallet || '').slice(0, 5) + '…' + String(d.wallet || '').slice(-4);
    if (w.method === 'nequi' || w.method === 'daviplata') return METHOD_TXT[w.method] + ' ' + maskEnd(d.number, 4);
    return 'Otro medio';
  }
  function makeReceiptBlob(w) {
    return new Promise(function (resolve, reject) {
      var c = document.createElement('canvas'), W = 640, H = 780;
      c.width = W; c.height = H;
      var x = c.getContext('2d');
      x.fillStyle = '#0B0509'; x.fillRect(0, 0, W, H);
      x.fillStyle = '#1D1013'; x.fillRect(24, 24, W - 48, H - 48);
      x.strokeStyle = '#FFC93C'; x.lineWidth = 3; x.strokeRect(24, 24, W - 48, H - 48);
      var sans = "'Manrope', system-ui, -apple-system, 'Segoe UI', sans-serif";
      x.textAlign = 'center';
      x.fillStyle = '#C9A46A'; x.font = '600 15px ' + sans; x.fillText(String(site.texts.title).toUpperCase(), W / 2, 78);
      x.fillStyle = '#FFF6E6'; x.font = '800 30px ' + sans; x.fillText('Comprobante de retiro', W / 2, 122);
      x.fillStyle = '#1BE39A'; x.font = '800 54px ' + sans; x.fillText(pesos(w.amount), W / 2, 200);
      x.fillStyle = '#C9A46A'; x.font = '600 16px ' + sans; x.fillText('pesos · PAGADO', W / 2, 232);
      var d = w.details || {};
      var rows = [
        ['N.º de solicitud', String(w.id).replace(/-/g, '').slice(0, 8).toUpperCase()],
        ['Solicitante', w.username],
        ['Medio de pago', METHOD_TXT[w.method] || w.method],
        ['Destino', receiptDest(w)],
        ['Titular', d.holder || '—'],
        ['Solicitado', fmtFull(w.createdAt)],
        ['Pagado', fmtFull(w.resolvedAt || w.createdAt)],
      ];
      var y = 292;
      rows.forEach(function (r) {
        x.textAlign = 'left'; x.fillStyle = '#C9A46A'; x.font = '600 14px ' + sans; x.fillText(r[0], 60, y);
        x.textAlign = 'right'; x.fillStyle = '#FFF6E6'; x.font = '700 16px ' + sans;
        var t = String(r[1]);
        while (x.measureText(t).width > 350 && t.length > 4) t = t.slice(0, -2);
        x.fillText(t === String(r[1]) ? t : t + '…', W - 60, y);
        x.strokeStyle = 'rgba(138,106,42,.5)'; x.lineWidth = 1; x.setLineDash([4, 4]);
        x.beginPath(); x.moveTo(60, y + 14); x.lineTo(W - 60, y + 14); x.stroke(); x.setLineDash([]);
        y += 52;
      });
      x.textAlign = 'center'; x.fillStyle = '#C9A46A'; x.font = '500 12.5px ' + sans;
      x.fillText('Constancia interna emitida por ' + site.texts.title + '.', W / 2, H - 78);
      x.fillText('No es un comprobante bancario.', W / 2, H - 58);
      c.toBlob(function (b) { b ? resolve(b) : reject(new Error('sin imagen')); }, 'image/png');
    });
  }
  async function downloadReceipt(w) {
    try {
      var blob = await makeReceiptBlob(w);
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'comprobante-retiro-' + String(w.id).replace(/-/g, '').slice(0, 8) + '.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    } catch (e) { toast('No se pudo crear el comprobante.', 'err'); }
  }

  async function onWdClick(e) {
    var paid = e.target.closest('[data-wd-paid]'), rej = e.target.closest('[data-wd-reject]'), rec = e.target.closest('[data-wd-receipt]');
    var btn = paid || rej || rec;
    if (!btn) return;
    e.preventDefault(); // los botones están dentro del resumen: que no abran ni cierren el detalle
    var id = paid ? paid.dataset.wdPaid : rej ? rej.dataset.wdReject : rec.dataset.wdReceipt;
    var pool = adm.wds.concat(myWds);
    var w = pool.filter(function (x) { return x.id === id; })[0];
    if (!w) return;
    if (rec) { if (w.status === 'paid') downloadReceipt(w); return; }
    if (view !== 'admin' || !isOwner() || w.status !== 'pending') return; // aprobar o rechazar: solo en Administrador
    var run = async function (action) {
      try { await api('POST', '/api/withdrawals/' + id + '/' + action); await loadAdminWds(); await refreshMe(); renderChrome(); }
      catch (err) { toast(err.message, 'err'); await loadAdminWds(); }
    };
    if (paid) askConfirm('¿Marcar como pagados ' + pesos(w.amount) + ' a ' + w.username + '? Hazlo solo cuando ya le hayas pagado.', function () { run('paid'); });
    else askConfirm('¿Rechazar la solicitud y devolver ' + pesos(w.amount) + ' al saldo de ' + w.username + '?', function () { run('reject'); });
  }
  $('withdrawalsList').addEventListener('click', onWdClick);
  $('myWithdrawalsList').addEventListener('click', onWdClick);

  // =====================================================================
  // administrador
  // =====================================================================
  function isDirty() { return adm.dirty.live || adm.dirty.player || adm.dirty.site; }
  function cfg() { return adm.cfgs[adm.target]; }
  function markDirty(kind) {
    adm.dirty[kind] = true;
    renderSaveBar();
  }
  function renderSaveBar() {
    var st = $('saveStatus'), btn = $('saveBtn'), d = isDirty();
    st.textContent = d ? '● Tienes cambios sin guardar' : '✓ Todo guardado';
    st.className = 'save-status ' + (d ? 'warn' : 'ok');
    btn.classList.toggle('pending', d);
  }

  async function enterAdmin() {
    if (!adm.draft) adm.draft = JSON.parse(JSON.stringify({ texts: site.texts, money: site.money, support: site.support }));
    if (!adm.cfgs[adm.target]) adm.cfgs[adm.target] = (await api('GET', '/api/admin/config/' + adm.target)).config;
    renderAdmin();
    loadProgress();
    if (adm.tab === 'jugadores') loadPlayers();
    if (adm.tab === 'retiros') loadAdminWds();
    if (adm.tab === 'soporte') loadTickets();
  }

  async function saveAll() {
    if (!isOwner()) return;
    $('saveBtn').disabled = true;
    try {
      var saved = [];
      for (var page of ['live', 'player']) {
        if (adm.dirty[page] && adm.cfgs[page]) {
          adm.cfgs[page] = (await api('PUT', '/api/admin/config/' + page, { config: adm.cfgs[page] })).config;
          adm.dirty[page] = false; saved.push(page);
        }
      }
      if (adm.dirty.site) {
        site = await api('PUT', '/api/admin/site', adm.draft);
        adm.draft = JSON.parse(JSON.stringify(site));
        adm.dirty.site = false;
      }
      toast('Cambios guardados. Ya se ven en las otras páginas.', 'ok');
      renderAdmin();
    } catch (err) { toast(err.message, 'err'); }
    $('saveBtn').disabled = false;
    renderSaveBar();
  }
  $('saveBtn').addEventListener('click', saveAll);

  function renderAdmin() {
    var c = cfg();
    applyTheme(c.settings);
    renderTexts();
    document.querySelectorAll('#adminTabs .admin-tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === adm.tab); });
    document.querySelectorAll('#setupCol > section[data-tab]').forEach(function (s) { s.hidden = s.dataset.tab !== adm.tab; });
    document.querySelectorAll('#targetSwitch .target-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.target === adm.target); });
    $('targetNote').textContent = adm.target === 'live'
      ? 'Aquí editas la página 🎮 Jugar (tu live): sus premios, casillas, reglas y colores. No afecta la Vista del jugador.'
      : 'Aquí editas la 📺 Vista del jugador (la página para otras personas): sus premios, casillas, reglas y colores. No afecta tu página Jugar.';
    var pageTab = ['jugadores', 'retiros', 'soporte', 'textos'].indexOf(adm.tab) < 0;
    $('targetSwitch').hidden = !pageTab;
    $('targetNote').hidden = !pageTab;
    $('totalCellsInput').value = c.totalCells;
    var wipeNames = c.tiers.filter(function (t) { return t.wipeout && t.count > 0; }).map(function (t) { return t.emoji + ' ' + t.label; });
    $('wipeNote').hidden = !wipeNames.length;
    $('wipeNote').textContent = wipeNames.length ? '💥 Actúan como bomba roja (pierden todo al destaparse): ' + wipeNames.join(', ') + '. Si no lo quieres, apaga su botón 💥.' : '';
    if (!isTyping($('tiersList'))) $('tiersList').innerHTML = tiersHTML();
    refreshTierTotal();
    renderRules(); renderColors(); renderTextsForm(); renderMoneyForm(); renderSupportForm();
    renderChrome();
    renderSaveBar();
  }

  function isTyping(container) {
    var a = document.activeElement;
    return !!(a && container.contains(a) && a.matches('input:not([type=checkbox]):not([type=color]), textarea'));
  }

  function tiersHTML() {
    var canRemove = cfg().tiers.length > 1;
    return cfg().tiers.map(function (t) {
      return '<div class="tier-row" data-key="' + esc(t.key) + '">' +
        '<div class="tier-img-wrap"><span class="tier-img-btn" style="cursor:default;">' + esc(t.emoji) + '</span></div>' +
        '<input class="tier-emoji" data-field="emoji" value="' + esc(t.emoji) + '" maxlength="4" aria-label="Emoji">' +
        '<input class="tier-label" data-field="label" value="' + esc(t.label) + '" maxlength="40" aria-label="Nombre">' +
        '<input class="tier-points ' + (t.points < 0 ? 'neg' : t.points > 0 ? 'pos' : '') + '" type="number" step="1" placeholder="Pts" data-field="points" value="' + (t.points || 0) + '" aria-label="Puntos">' +
        '<input class="tier-count" type="number" min="0" max="' + cfg().totalCells + '" data-field="count" value="' + t.count + '" aria-label="Cantidad">' +
        '<div class="tier-actions">' +
          '<button type="button" class="tier-wipe-toggle ' + (t.wipeout ? 'active' : '') + '" data-act="wipe" title="Bomba roja: al caer aquí se pierde todo lo acumulado">💥</button>' +
          '<button type="button" class="tier-remove" data-act="remove" aria-label="Quitar premio" ' + (canRemove ? '' : 'disabled') + '>×</button>' +
        '</div></div>';
    }).join('');
  }
  function tierTotal() { return cfg().tiers.reduce(function (s, t) { return s + (Number(t.count) || 0); }, 0); }
  function refreshTierTotal() {
    var total = tierTotal(), cells = cfg().totalCells;
    $('tierTotalNum').textContent = total; $('tierTotalDenom').textContent = cells;
    $('tierTotal').className = 'tier-total ' + (total === cells ? 'ok' : 'bad');
    $('tierTotalHint').textContent = total === cells ? ''
      : total < cells ? 'Faltan ' + (cells - total) + ' casillas por asignar: al jugar se rellenan al azar con los premios que tengan cantidad.'
      : 'Te pasas por ' + (total - cells) + ' casillas: al jugar se recortan los últimos premios de la lista.';
  }
  function tierByRow(el) {
    var row = el.closest('.tier-row');
    return row ? cfg().tiers.filter(function (t) { return t.key === row.dataset.key; })[0] : null;
  }
  $('tiersList').addEventListener('input', function (e) {
    var el = e.target.closest('input'), t = el && tierByRow(el);
    if (!t || !el.dataset.field) return;
    var f = el.dataset.field;
    if (f === 'count') t.count = Math.max(0, Math.min(1000, Math.floor(Number(el.value)) || 0));
    else if (f === 'points') t.points = Math.floor(Number(el.value)) || 0;
    else t[f] = el.value;
    markDirty(adm.target); refreshTierTotal();
  });
  $('tiersList').addEventListener('change', function () { renderAdmin(); });
  $('tiersList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'), t = b && tierByRow(b);
    if (!t) return;
    if (b.dataset.act === 'wipe') t.wipeout = !t.wipeout;
    else if (b.dataset.act === 'remove') { if (cfg().tiers.length <= 1) return; cfg().tiers = cfg().tiers.filter(function (x) { return x !== t; }); }
    markDirty(adm.target); renderAdmin();
  });
  $('addTierBtn').addEventListener('click', function () {
    cfg().tiers.push({ key: randId(), emoji: '🎁', label: 'Nuevo premio', count: 0, points: 0, wipeout: false, color: null });
    markDirty(adm.target); renderAdmin();
  });
  $('totalCellsInput').addEventListener('input', function () {
    cfg().totalCells = Math.max(1, Math.min(1000, Math.floor(Number(this.value)) || 1));
    markDirty(adm.target); refreshTierTotal();
  });
  $('totalCellsInput').addEventListener('change', renderAdmin);

  function renderRules() {
    document.querySelectorAll('#rulesPanel [data-setting], #colorsPanel [data-setting]').forEach(function (el) {
      var k = el.dataset.setting, v = cfg().settings[k];
      if (el.type === 'checkbox') el.checked = !!v; else if (document.activeElement !== el) el.value = v;
    });
  }
  function onSetting(e) {
    var el = e.target.closest('[data-setting]');
    if (!el) return;
    var k = el.dataset.setting, s = cfg().settings;
    if (el.type === 'checkbox') s[k] = el.checked;
    else if (el.type === 'color') s[k] = el.value;
    else if (k === 'columns') s[k] = Math.max(0, Math.min(40, Math.floor(Number(el.value)) || 0));
    else s[k] = (el.value.trim().slice(0, 12)) || 'pts';
    markDirty(adm.target);
    if (el.type !== 'text' && el.type !== 'number') { applyTheme(s); }
  }
  $('rulesPanel').addEventListener('change', onSetting);
  $('colorsPanel').addEventListener('input', function (e) { if (e.target.type === 'color' && e.target.dataset.setting) { onSetting(e); applyTheme(cfg().settings); } });
  $('colorsPanel').addEventListener('change', onSetting);

  function renderColors() {
    if (isTyping($('tierColors'))) return;
    $('tierColors').innerHTML = cfg().tiers.map(function (t, i) {
      var val = hexToRgb(t.color) ? t.color : autoHex(t, i);
      return '<div class="rule-row" data-key="' + esc(t.key) + '"><span>' + esc(t.emoji) + ' ' + esc(t.label) + '<small>' + (t.color ? 'Personalizado' : 'Automático') + '</small></span>' +
        '<span class="color-ctl"><input type="color" data-tier-color value="' + val + '">' + (t.color ? '<button type="button" class="btn" data-tier-reset>Auto</button>' : '') + '</span></div>';
    }).join('');
  }
  $('tierColors').addEventListener('change', function (e) {
    var el = e.target.closest('[data-tier-color]'), t = el && tierByRow2(el);
    if (t) { t.color = el.value; markDirty(adm.target); renderColors(); }
  });
  $('tierColors').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tier-reset]'), t = b && tierByRow2(b);
    if (t) { t.color = null; markDirty(adm.target); renderColors(); }
  });
  function tierByRow2(el) { var r = el.closest('[data-key]'); return r ? cfg().tiers.filter(function (t) { return t.key === r.dataset.key; })[0] : null; }

  // textos
  function renderTextsForm() {
    document.querySelectorAll('#textsPanel [data-text-key]').forEach(function (el) {
      if (document.activeElement !== el) el.value = adm.draft.texts[el.dataset.textKey] || '';
    });
  }
  $('textsPanel').addEventListener('input', function (e) {
    var el = e.target.closest('[data-text-key]');
    if (!el) return;
    adm.draft.texts[el.dataset.textKey] = el.value;
    markDirty('site'); renderTexts();
  });

  // retiros: configuración
  function renderMoneyForm() {
    var m = adm.draft.money, ae = document.activeElement;
    function put(id, v) { var el = $(id); if (ae !== el) el.value = v; }
    put('pointValueInput', m.pointValue); put('minWithdrawInput', m.minWithdraw); put('wdTitleInput', m.title); put('wdNoteInput', m.note); put('wdBanksInput', m.banks.join('\n'));
    $('wdAskDoc').checked = !!m.askDoc;
    document.querySelectorAll('#wdConfig [data-wd-method]').forEach(function (c) { c.checked = !!m.methods[c.dataset.wdMethod]; });
  }
  function readMoneyForm() {
    var m = adm.draft.money;
    m.pointValue = Math.max(1, Math.floor(Number($('pointValueInput').value)) || 1);
    m.minWithdraw = Math.max(0, Math.floor(Number($('minWithdrawInput').value)) || 0);
    m.title = $('wdTitleInput').value.slice(0, 40);
    m.note = $('wdNoteInput').value.slice(0, 200);
    m.banks = $('wdBanksInput').value.split('\n').map(function (b) { return b.trim().slice(0, 40); }).filter(Boolean).slice(0, 40);
    m.askDoc = $('wdAskDoc').checked;
    var ms = {};
    document.querySelectorAll('#wdConfig [data-wd-method]').forEach(function (c) { ms[c.dataset.wdMethod] = c.checked; });
    m.methods = ms;
    markDirty('site');
  }
  $('wdConfig').addEventListener('input', readMoneyForm);
  $('wdConfig').addEventListener('change', readMoneyForm);

  // soporte: configuración
  function renderSupportForm() {
    var s = adm.draft.support, ae = document.activeElement;
    function put(id, v) { var el = $(id); if (ae !== el) el.value = v; }
    put('supHours', s.hours); put('supMsg', s.message); put('supEmail', s.email);
  }
  $('supportConfig').addEventListener('input', function () {
    adm.draft.support = { hours: $('supHours').value, message: $('supMsg').value, email: $('supEmail').value };
    markDirty('site');
  });

  $('targetSwitch').addEventListener('click', async function (e) {
    var b = e.target.closest('.target-btn');
    if (!b || b.dataset.target === adm.target) return;
    adm.target = b.dataset.target;
    store.set('minasAdminTarget', adm.target);
    try { await enterAdmin(); } catch (err) { toast(err.message, 'err'); }
  });
  $('adminTabs').addEventListener('click', function (e) {
    var b = e.target.closest('.admin-tab');
    if (!b) return;
    adm.tab = b.dataset.tab;
    store.set('minasAdminTab', adm.tab);
    renderAdmin();
    if (adm.tab === 'jugadores') loadPlayers();
    if (adm.tab === 'retiros') loadAdminWds();
    if (adm.tab === 'soporte') loadTickets();
  });

  // avance por premio del juego en curso del dueño (solo se ve en Administrador)
  async function loadProgress() {
    var el = $('adminTally');
    try {
      var p = (await api('GET', '/api/admin/progress/' + adm.target)).progress;
      if (!p) { el.innerHTML = '<span class="hint">No tienes un juego en curso en esta página.</span>'; return; }
      el.innerHTML = p.tiers.map(function (t, i) {
        if (!t.total) return '';
        return '<span class="chip" style="' + chipStyleFor(t, i) + '">' + esc(t.emoji) + ' ' + esc(t.label) + ' <b>' + t.opened + '/' + t.total + '</b></span>';
      }).join('') + '<span class="hint" style="width:100%;margin:6px 0 0;">Destapadas ' + p.openedCount + ' de ' + p.totalCells + ' · Juego ' + esc(p.code) + '</span>';
    } catch (e) { el.innerHTML = ''; }
  }

  // jugadores
  async function loadPlayers() {
    try { adm.players = (await api('GET', '/api/admin/players')).players; } catch (e) { return toast(e.message, 'err'); }
    var el = $('playersAdminList');
    if (!adm.players.length) { el.innerHTML = '<p class="empty-note">Todavía no hay jugadores registrados.</p>'; return; }
    el.innerHTML = adm.players.map(function (p) {
      return '<div class="player-admin-row"><span class="pa-info"><b>' + esc(p.username) + '</b><small>' + esc(p.email) + ' · ' + esc(p.phone ? '+' + p.phone : '') + ' · ' + p.games + ' juegos · ' + p.withdrawals + ' retiros</small></span>' +
        '<span class="mono" style="color:var(--teal);">' + pesos(p.balance) + '</span>' +
        '<button type="button" class="btn btn-danger" data-del-player="' + p.id + '">Eliminar</button></div>';
    }).join('');
  }
  $('playersAdminList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-del-player]');
    if (!b) return;
    var p = adm.players.filter(function (x) { return x.id === b.dataset.delPlayer; })[0];
    if (!p) return;
    askConfirm('¿Eliminar la cuenta de ' + p.username + '? Se pierde su saldo (' + pesos(p.balance) + ') y sus juegos.', async function () {
      try { await api('DELETE', '/api/admin/players/' + p.id); loadPlayers(); } catch (err) { toast(err.message, 'err'); }
    });
  });

  // retiros: lista del dueño
  async function loadAdminWds() {
    try { adm.wds = (await api('GET', '/api/withdrawals')).withdrawals; } catch (e) { return toast(e.message, 'err'); }
    var pending = adm.wds.filter(function (w) { return w.status === 'pending'; });
    var done = adm.wds.filter(function (w) { return w.status !== 'pending'; });
    pendingWd = pending.length;
    var pb = $('pendingBadge'); pb.hidden = !pendingWd; pb.textContent = pendingWd;
    if (!adm.wds.length) { $('withdrawalsList').innerHTML = '<p class="empty-note">No hay solicitudes de retiro.</p>'; return; }
    $('withdrawalsList').innerHTML =
      (pending.length ? '<p class="req-title">⏳ Pendientes (' + pending.length + ')</p>' + pending.map(function (w) { return reqRowHTML(w, true); }).join('') : '') +
      (done.length ? '<p class="req-title">🗂 Historial (' + done.length + ')</p>' + done.map(function (w) { return reqRowHTML(w, true); }).join('') : '');
  }

  // =====================================================================
  // soporte
  // =====================================================================
  var TK_TXT = { open: 'Abierto', closed: 'Resuelto' };
  var openTks = {};
  function bubbles(t) {
    return t.msgs.map(function (m) {
      return '<div class="bubble ' + m.from + '"><small>' + (m.from === 'admin' ? 'Soporte' : esc(t.username)) + ' · ' + fmtDate(m.at) + '</small>' + esc(m.text).replace(/\n/g, '<br>') + '</div>';
    }).join('');
  }
  async function loadTickets() {
    try { adm.tickets = (await api('GET', '/api/tickets')).tickets; } catch (e) { return toast(e.message, 'err'); }
    renderTickets();
  }
  function renderTickets() {
    var el = $('ticketList');
    if (isTyping(el)) return;
    var list = adm.tickets.slice().sort(function (a, b) { return (b.adminUnread ? 1 : 0) - (a.adminUnread ? 1 : 0) || (a.updatedAt < b.updatedAt ? 1 : -1); });
    if (!list.length) { el.innerHTML = '<p class="empty-note">Todavía no hay mensajes de soporte.</p>'; return; }
    el.innerHTML = list.map(function (t) {
      var contact = [t.email, t.phone ? 'Cel. +' + t.phone : '', t.contact].filter(Boolean).join(' · ');
      return '<details class="req tk' + (t.status === 'open' ? ' pending' : '') + '" data-tk="' + t.id + '"' + (openTks[t.id] ? ' open' : '') + '>' +
        '<summary><span class="status ' + (t.status === 'open' ? 'pending' : 'paid') + '">' + TK_TXT[t.status] + '</span>' +
        '<b>' + esc(t.username) + (t.adminUnread ? ' <span class="badge">nuevo</span>' : '') + '</b>' +
        '<span class="req-line">' + esc(t.subject) + ' · ' + fmtDate(t.updatedAt) + '</span></summary>' +
        '<div class="req-data">' + (contact ? '<small>' + esc(contact) + '</small>' : '') + bubbles(t) +
        '<textarea class="tk-reply" data-tk-text="' + t.id + '" maxlength="600" rows="2" placeholder="Escribe tu respuesta…"' + (t.guest ? ' disabled' : '') + '></textarea>' +
        (t.guest ? '<p class="hint" style="margin:4px 0;">Este mensaje llegó sin sesión: contáctalo con los datos de arriba.</p>' : '') +
        '<div class="req-actions"><button type="button" class="btn btn-primary" data-tk-send="' + t.id + '"' + (t.guest ? ' disabled' : '') + '>Enviar respuesta</button>' +
        '<button type="button" class="btn" data-tk-toggle="' + t.id + '">' + (t.status === 'open' ? '✅ Marcar resuelto' : '↩ Reabrir') + '</button></div></div></details>';
    }).join('');
  }
  $('ticketList').addEventListener('click', async function (e) {
    var send = e.target.closest('[data-tk-send]'), tog = e.target.closest('[data-tk-toggle]');
    try {
      if (send) {
        var ta = $('ticketList').querySelector('[data-tk-text="' + send.dataset.tkSend + '"]');
        if (!ta || !ta.value.trim()) return;
        await api('POST', '/api/tickets/' + send.dataset.tkSend + '/reply', { text: ta.value });
        await loadTickets();
      } else if (tog) {
        await api('POST', '/api/tickets/' + tog.dataset.tkToggle + '/toggle');
        await loadTickets();
      }
    } catch (err) { toast(err.message, 'err'); }
  });
  document.addEventListener('toggle', async function (e) {
    var d = e.target;
    if (!d || !d.matches || !d.matches('details.tk')) return;
    var id = d.dataset.tk;
    if (d.open) {
      openTks[id] = true;
      var t = adm.tickets.filter(function (x) { return x.id === id; })[0];
      if (t && t.adminUnread) { t.adminUnread = false; try { await api('POST', '/api/tickets/' + id + '/read'); unread = Math.max(0, unread - 1); renderChrome(); } catch (err) { /* sin cambio */ } }
    } else delete openTks[id];
  }, true);

  // ventana de soporte del jugador (o de quien no ha entrado)
  var sup = { mode: 'home', id: null, tickets: [] };
  function supMsg(t, ok) { var m = $('supMsgLine'); if (m) { m.textContent = t || ''; m.className = 'auth-msg' + (ok ? ' ok' : ''); } }
  async function openSupport() {
    if (isOwner()) { adm.tab = 'soporte'; store.set('minasAdminTab', 'soporte'); await go('admin'); return; }
    sup = { mode: 'home', id: null, tickets: [] };
    if (me) { try { sup.tickets = (await api('GET', '/api/tickets')).tickets; } catch (e) { toast(e.message, 'err'); } }
    renderSupportModal();
    $('supportModal').hidden = false;
  }
  function renderSupportModal() {
    var s = site.support;
    $('supIntro').textContent = s.message || 'Escríbenos y te respondemos por aquí.';
    $('supHoursTxt').textContent = s.hours ? 'Horario: ' + s.hours : '';
    var body = '';
    var alt = s.email ? '<p class="hint" style="margin:8px 0 0;">También puedes escribir a <b>' + esc(s.email) + '</b></p>' : '';
    var cur = sup.tickets.filter(function (t) { return t.id === sup.id; })[0];
    if (!me) {
      body = '<div class="auth-form"><label>Tu usuario o nombre<input id="supGName" type="text" maxlength="40"></label>' +
        '<label>Tu correo o celular (para responderte)<input id="supGContact" type="text" maxlength="80"></label>' +
        '<label>Mensaje<textarea id="supGText" maxlength="600" rows="4" class="tk-reply"></textarea></label>' +
        '<button type="button" class="btn btn-primary" data-sup="send-guest">Enviar a soporte</button></div>';
    } else if (sup.mode === 'thread' && cur) {
      body = '<button type="button" class="link-btn" data-sup="back">← Mis consultas</button>' + bubbles(cur) +
        (cur.status === 'open'
          ? '<textarea id="supReplyText" class="tk-reply" maxlength="600" rows="2" placeholder="Escribe tu mensaje…"></textarea><button type="button" class="btn btn-primary" data-sup="send-reply">Enviar</button>'
          : '<p class="hint">Esta consulta está resuelta. Si necesitas algo más, crea una nueva.</p>');
    } else if (sup.mode === 'new' || !sup.tickets.length) {
      body = (sup.tickets.length ? '<button type="button" class="link-btn" data-sup="back">← Mis consultas</button>' : '') +
        '<div class="auth-form"><label>¿En qué te ayudamos?<textarea id="supNewText" class="tk-reply" maxlength="600" rows="4" placeholder="Cuéntanos qué pasó…"></textarea></label>' +
        '<button type="button" class="btn btn-primary" data-sup="send-new">Enviar a soporte</button></div>';
    } else {
      body = sup.tickets.map(function (t) {
        return '<div class="sup-item" data-sup-open="' + t.id + '" style="cursor:pointer;"><span class="status ' + (t.status === 'open' ? 'pending' : 'paid') + '">' + TK_TXT[t.status] + '</span>' +
          '<span class="sup-val">' + esc(t.subject) + '</span>' + (t.playerUnread ? '<span class="badge">respuesta</span>' : '') + '</div>';
      }).join('') + '<button type="button" class="btn btn-primary" style="margin-top:8px;" data-sup="new">✉️ Nueva consulta</button>';
    }
    $('supBody').innerHTML = body + '<p id="supMsgLine" class="auth-msg" role="alert" style="margin:8px 0 0;"></p>' + alt;
    if (cur && cur.playerUnread) {
      cur.playerUnread = false;
      api('POST', '/api/tickets/' + cur.id + '/read').then(function () { unread = Math.max(0, unread - 1); renderChrome(); }).catch(function () { /* sin cambio */ });
    }
  }
  function closeSupport() { $('supportModal').hidden = true; if (me) refreshMe().then(renderChrome).catch(function () { /* nada */ }); }
  $('supportBtn').addEventListener('click', openSupport);
  $('supportBtnAuth').addEventListener('click', openSupport);
  $('supClose').addEventListener('click', closeSupport);
  $('supportModal').addEventListener('click', async function (e) {
    if (e.target === $('supportModal')) return closeSupport();
    var op = e.target.closest('[data-sup-open]');
    if (op) { sup.mode = 'thread'; sup.id = op.dataset.supOpen; return renderSupportModal(); }
    var b = e.target.closest('[data-sup]');
    if (!b) return;
    var act = b.dataset.sup;
    try {
      if (act === 'back') { sup.mode = 'home'; renderSupportModal(); }
      else if (act === 'new') { sup.mode = 'new'; renderSupportModal(); }
      else if (act === 'send-new') {
        var tx = $('supNewText').value.trim();
        if (tx.length < 3) return supMsg('Escribe tu mensaje.');
        var d = await api('POST', '/api/tickets', { text: tx });
        sup.tickets = (await api('GET', '/api/tickets')).tickets;
        sup.mode = 'thread'; sup.id = d.ticket.id; renderSupportModal(); supMsg('✓ Enviado. Te responderemos aquí mismo.', true);
      } else if (act === 'send-reply') {
        var rt = $('supReplyText').value.trim();
        if (!rt) return;
        await api('POST', '/api/tickets/' + sup.id + '/reply', { text: rt });
        sup.tickets = (await api('GET', '/api/tickets')).tickets; renderSupportModal();
      } else if (act === 'send-guest') {
        await api('POST', '/api/tickets/guest', { name: $('supGName').value, contact: $('supGContact').value, text: $('supGText').value });
        $('supBody').innerHTML = '<p class="hint">✓ Mensaje enviado a soporte. Te contactarán con los datos que dejaste.</p>';
      }
    } catch (err) { supMsg(err.message); }
  });

  // =====================================================================
  // mi cuenta
  // =====================================================================
  var RES_TXT = { cashed: 'Cobrado', bomb: 'Bomba roja', reset: 'Reiniciado', active: 'En curso', canceled: 'Cancelado' };
  var RES_CLS = { cashed: 'paid', bomb: 'rejected', reset: 'muted', active: 'pending', canceled: 'muted' };
  function gameRowHTML(h) {
    var won = (h.status === 'cashed' || h.status === 'active') ? h.points : 0;
    var line = 'Ganado ' + signed(won) + ' pts' + (won > 0 ? ' · ' + pesos(h.pesos || won * site.money.pointValue) : '') +
      (h.status === 'bomb' ? ' · perdió ' + fmt(h.lost) + ' pts' : h.status === 'reset' && h.lost > 0 ? ' · sin cobrar ' + fmt(h.lost) + ' pts' : '');
    return '<details class="req"><summary><span class="status ' + RES_CLS[h.status] + '">' + RES_TXT[h.status] + '</span>' +
      '<b class="req-amount mono">' + esc(h.code) + '</b>' +
      '<span class="req-line">' + esc(line) + ' · ' + (h.endedAt ? fmtDate(h.endedAt) : 'ahora') + '</span></summary>' +
      '<div class="req-data">Código del juego: ' + esc(h.code) + '<br>Página: ' + (h.page === 'live' ? 'Jugar' : 'Vista del jugador') +
      '<br>Inicio: ' + fmtFull(h.createdAt) + (h.endedAt ? '<br>Fin: ' + fmtFull(h.endedAt) : '') +
      '<br>Casillas destapadas: ' + h.opened + ' de ' + h.totalCells +
      '<br><b>' + (h.status === 'active' ? 'Ganado hasta ahora: ' : 'Ganado: ') + signed(won) + ' pts</b>' +
      (h.status === 'bomb' ? '<br>Puntos perdidos por la bomba roja: ' + fmt(h.lost) : '') +
      (h.status === 'reset' && h.lost > 0 ? '<br>Puntos sin cobrar al reiniciar: ' + fmt(h.lost) : '') + '</div></details>';
  }
  async function enterAccount() {
    applyTheme(null);
    $('pfUser').value = me.username; $('pfEmail').value = me.email; $('pfName').value = me.fullName || ''; $('pfPhone').value = me.phone ? '+' + me.phone : '';
    $('pfPassWrap').hidden = true; $('pfCurrent').value = '';
    var d = await api('GET', '/api/history');
    var hist = d.games, done = hist.filter(function (h) { return h.status !== 'active'; }), won = hist.filter(function (h) { return h.status === 'cashed'; });
    $('historySub').textContent = 'Cada juego tiene un código único · ' + done.length + ' terminados';
    $('historyList').innerHTML =
      (done.length ? '<p class="hist-stats">Cobrados: ' + won.length + ' · Total ganado: ' + pesos(won.reduce(function (s, h) { return s + h.pesos; }, 0)) + ' · Bombas rojas: ' + hist.filter(function (h) { return h.status === 'bomb'; }).length + '</p>' : '') +
      (hist.length ? hist.map(gameRowHTML).join('') : '<p class="empty-note">Todavía no has jugado. Tus juegos aparecerán aquí, cada uno con su código.</p>');
  }
  function pfMsg(id, t, ok) { var m = $(id); m.textContent = t || ''; m.className = 'auth-msg' + (ok ? ' ok' : ''); m.style.margin = '0'; }
  $('pfEmail').addEventListener('input', function () { $('pfPassWrap').hidden = this.value.trim().toLowerCase() === me.email; });
  $('profileForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    try {
      var body = { fullName: $('pfName').value, phone: $('pfPhone').value };
      if ($('pfEmail').value.trim().toLowerCase() !== me.email) { body.email = $('pfEmail').value; body.currentPassword = $('pfCurrent').value; }
      var d = await api('PATCH', '/api/me', body);
      me = d.user; pfMsg('pfMsg', '✓ Datos guardados', true); $('pfPassWrap').hidden = true; $('pfCurrent').value = ''; renderChrome();
    } catch (err) { pfMsg('pfMsg', err.message); }
  });
  $('passForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    if ($('pwNew').value !== $('pwNew2').value) return pfMsg('pwMsg', 'Las dos claves nuevas no coinciden.');
    try {
      await api('POST', '/api/me/password', { current: $('pwCur').value, next: $('pwNew').value });
      ['pwCur', 'pwNew', 'pwNew2'].forEach(function (k) { $(k).value = ''; });
      pfMsg('pwMsg', '✓ Clave cambiada. Las demás sesiones se cerraron.', true);
    } catch (err) { pfMsg('pwMsg', err.message); }
  });
  $('userName').addEventListener('click', function () {
    if (view === 'account') go(prevView && prevView !== 'account' ? prevView : (isOwner() ? 'admin' : 'player')); else go('account');
  });
  $('accountBack').addEventListener('click', function () { go(prevView && prevView !== 'account' ? prevView : (isOwner() ? 'admin' : 'player')); });

  $('viewAdminBtn').addEventListener('click', function () { go('admin'); });
  $('viewLiveBtn').addEventListener('click', function () { go('live'); });
  $('viewPlayerBtn').addEventListener('click', function () { go('player'); });

  // =====================================================================
  // avisos nuevos: se revisa cada 20 segundos mientras la página está abierta
  // =====================================================================
  setInterval(async function () {
    if (!me || document.hidden) return;
    try {
      await refreshMe();
      if (!me) return renderChrome();
      renderChrome();
      if (view === 'admin' && isOwner()) {
        if (adm.tab === 'retiros' && !isTyping($('withdrawalsList'))) loadAdminWds();
        if (adm.tab === 'soporte' && !isTyping($('ticketList'))) loadTickets();
      }
    } catch (e) {
      if (e.status === 401) { me = null; renderChrome(); renderAuth(); toast('Tu sesión terminó. Ingresa de nuevo.', 'err'); }
    }
  }, 20000);

  boot();
})();
