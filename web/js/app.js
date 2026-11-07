/* North Star HQ (the Student Journey app). Plain JS, no build step. */
(function () {
  'use strict';

  var CONFIG = {
    api: 'https://script.google.com/macros/s/AKfycbw0t_2tYuBAnwDyagUzHIVIAIe4yWrpRzv2gjneNE0XH248dh6oCOOYc5Ek9wKKCVE3/exec',
    clientId: '1003602730249-2nnt3n1isqov67aiiv2rppb2o76ju50v.apps.googleusercontent.com',
    domain: 'northstarjazzworkshops.com'
  };
  window.NSJW_CONFIG = CONFIG; // tests may override api before load

  // GitHub Pages lets browsers keep index.html for 10 minutes, so a new release can hide
  // behind an old page. Ask for the page fresh; if it names a newer app.js, reload once.
  (function () {
    var me = document.currentScript && document.currentScript.getAttribute('src') || '';
    var mine = Number((me.match(/v=(\d+)/) || [])[1] || 0);
    function check() {
      if (!mine || !window.fetch) return;
      fetch('index.html', { cache: 'reload' }).then(function (r) { return r.text(); }).then(function (html) {
        var live = Number((html.match(/js\/app\.js\?v=(\d+)/) || [])[1] || 0);
        if (live > mine && sessionStorage.getItem('nsjw_reloaded') !== String(live)) {
          sessionStorage.setItem('nsjw_reloaded', String(live));
          location.reload();
        }
      }).catch(function () {});
    }
    setTimeout(check, 1500);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
  })();

  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };

  // ---------- storage (per-viewer convenience only) ----------
  function store(k, v) {
    try {
      if (v === undefined) return sessionStorage.getItem(k);
      if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v);
    } catch (e) { return null; }
  }

  // ---------- auth ----------
  var token = null, me = null;

  function decode(jwt) {
    try {
      var b = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(b))));
    } catch (e) { return null; }
  }

  function setToken(t) {
    var c = t && decode(t);
    if (!c || c.exp * 1000 < Date.now() + 60000) { token = null; me = null; store('nsjw_tok', null); return false; }
    token = t; me = c; store('nsjw_tok', t);
    return true;
  }

  function signOut() {
    clearCache();
    setToken(null);
    try { google.accounts.id.disableAutoSelect(); } catch (e) {}
    route();
  }

  function initGoogle() {
    if (!window.google || !google.accounts) { setTimeout(initGoogle, 150); return; }
    google.accounts.id.initialize({
      client_id: CONFIG.clientId,
      hd: CONFIG.domain,
      auto_select: true,
      callback: function (r) {
        var c = decode(r.credential);
        if (!c || c.hd !== CONFIG.domain) {
          showSigninError('Use your ' + CONFIG.domain + ' account.');
          return;
        }
        setToken(r.credential);
        route();
      }
    });
    google.accounts.id.renderButton($('#gsi-button'), { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with' });
    if (!token) google.accounts.id.prompt();
  }

  function showSigninError(msg) {
    var el = $('#signin-error'); el.textContent = msg; el.hidden = false;
  }

  // ---------- API ----------
  function api(action, params) {
    var body = Object.assign({ action: action, id_token: token }, params || {});
    // text/plain keeps this a simple request (no CORS preflight); the token stays out of the URL.
    return fetch(CONFIG.api, { method: 'POST', body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.error) {
          if (/sign.?in/i.test(d.error)) { setToken(null); route(); }
          throw new Error(d.error);
        }
        return d;
      });
  }

  // Show the last answer straight away, then refresh in the background (stale while revalidate).
  // Kept in this browser only, per signed-in account, and cleared on sign-out.
  var CK = 'nsjw_c1:';
  function ckey(a, p) { return CK + (me && me.email || '') + ':' + a + ':' + JSON.stringify(p || {}); }
  function clearCache() {
    try { Object.keys(localStorage).filter(function (k) { return k.indexOf('nsjw_c') === 0; }).forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
  }
  function swr(action, params, onData) {
    var k = ckey(action, params), raw = null, hit = null;
    try { raw = localStorage.getItem(k); hit = raw ? JSON.parse(raw) : null; } catch (e) { raw = null; }
    if (hit) { try { onData(hit, true); } catch (e) { hit = null; raw = null; } }
    return api(action, params).then(function (d) {
      var str = JSON.stringify(d);
      try { localStorage.setItem(k, str); } catch (e) { clearCache(); try { localStorage.setItem(k, str); } catch (e2) {} }
      if (str !== raw) onData(d, false);
    }, function (err) { if (!hit) throw err; });
  }

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function initials(name) {
    var p = String(name || '?').replace(/\([^)]*\)/g, ' ').replace(/[^\p{L}\s'-]/gu, ' ').trim().split(/\s+/);
    return ((p[0] || '')[0] + ((p.length > 1 ? p[p.length - 1] : '')[0] || '')).toUpperCase();
  }
  function ownerName(o) {
    var k = String(o || '').split('@')[0].toLowerCase();
    return ({ hello: 'Ben', admin: 'Kelley', joe: 'Joe', chris: 'Chris' })[k] || o;
  }
  function statusPill(s) {
    return '<span class="pill ' + esc(String(s || '').toLowerCase().replace(/\s+/g, '-')) + '">' + esc(s || 'Unknown') + '</span>';
  }
  // "2026-10-14" is a calendar date; new Date() would read it as UTC midnight and show the day before.
  function parse(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
    return m ? new Date(+m[1], m[2] - 1, +m[3]) : new Date(v);
  }
  function when(v) {
    if (!v) return '';
    var d = parse(v);
    if (isNaN(d)) return esc(v);
    var now = new Date(), days = Math.round((now - d) / 86400000);
    var opts = { month: 'short', day: 'numeric' };
    if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
    if (days === 0 && d.toDateString() === now.toDateString()) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days > 1 && days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
    return d.toLocaleDateString(undefined, opts);
  }
  function dayOnly(v) {
    if (!v) return '';
    var d = parse(v);
    return isNaN(d) ? String(v) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function show(id) { $$('.view').forEach(function (v) { v.hidden = v.id !== id; }); window.scrollTo(0, 0); }
  // #today, #group and #person are also element ids, so the browser jumps to them on load. Start at the top.
  window.addEventListener('load', function () { setTimeout(function () { window.scrollTo(0, 0); }, 0); });

  // ---------- People (HubSpot-style list: view tabs, quick filters, sortable table, pages) ----------
  var PVIEWS = [
    { id: 'all', name: 'All people', f: {}, sort: 'lastActivity:desc' },
    { id: 'active', name: 'Active members', f: { status: 'Active' }, sort: 'name:asc' },
    { id: 'leads', name: 'Leads by last activity', f: { status: 'Lead' }, sort: 'lastActivity:desc' },
    { id: 'new', name: 'New this month', f: { created: '30' }, sort: 'created:desc' },
    { id: 'past', name: 'Inactive', f: { status: 'Inactive' }, sort: 'name:asc' }
  ];
  function savedViews() { try { return JSON.parse(store('nsjw_pviews') || '[]'); } catch (e) { return []; } }
  var peopleState = { rows: null, view: store('nsjw_pview') || 'all', f: {}, adv: {}, sort: 'lastActivity:desc', q: '', page: 1,
    per: Number(store('nsjw_pper')) || 25 };
  function allViews() { return PVIEWS.concat(savedViews()); }
  function setView(id) {
    var v = allViews().filter(function (x) { return x.id === id; })[0] || PVIEWS[0];
    peopleState.view = v.id; peopleState.f = JSON.parse(JSON.stringify(v.f || {})); peopleState.adv = JSON.parse(JSON.stringify(v.adv || {}));
    peopleState.sort = v.sort || 'lastActivity:desc'; peopleState.page = 1; store('nsjw_pview', v.id);
  }
  setView(peopleState.view);

  function loadPeople(force) {
    if (peopleState.rows && !force) { renderPeople(); return; }
    $('#people-list').innerHTML = '<div class="loading">Loading</div>';
    swr('contacts', null, function (rows) { peopleState.rows = rows; renderPeople(); })
      .catch(function (e) { $('#people-list').innerHTML = '<div class="empty err">' + esc(e.message) + '</div>'; });
  }
  function daysAgo(d) { return d ? (Date.now() - parse(String(d).slice(0, 10))) / 864e5 : Infinity; }
  function pMatch(r) {
    var f = peopleState.f, a = peopleState.adv, q = peopleState.q;
    if (f.status && r.status !== f.status) return false;
    if (f.program && r.programs.indexOf(f.program) < 0) return false;
    if (f.track && (f.track === 'none' ? r.tracks.length : r.tracks.indexOf(f.track) < 0)) return false;
    if (f.created && !(daysAgo(r.created) <= Number(f.created))) return false;
    if (f.activity && (f.activity === 'none' ? r.lastActivity : !(daysAgo(r.lastActivity) <= Number(f.activity)))) return false;
    function any(k, have) { return !a[k] || !a[k].length || a[k].some(function (x) { return have.indexOf(x) >= 0; }); }
    if (!any('Status', [r.status]) || !any('Stage', [r.stage]) || !any('Program', r.programs) ||
      !any('Interested in', r.tracks) || !any('Instrument', r.instruments) || !any('Source', [r.source])) return false;
    if (q && (r.name + ' ' + r.email + ' ' + r.phone + ' ' + r.programs.join(' ') + ' ' + r.instruments.join(' ')).toLowerCase().indexOf(q) < 0) return false;
    return true;
  }
  function pSorted(rows) {
    var sp = peopleState.sort.split(':'), k = sp[0], dir = sp[1] === 'desc' ? -1 : 1;
    return rows.slice().sort(function (x, y) {
      var a = x[k] || '', b = y[k] || '';
      if (!a && b) return 1; if (a && !b) return -1;   // blanks last either way
      return dir * String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
    });
  }
  function actText(d) {
    if (!d) return '';
    var day = d.slice(0, 10), t = today0(), dd = parse(day), diff = Math.round((t - dd) / 864e5);
    var time = d.length > 10 ? new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    if (diff === 0) return 'Today' + (time ? ' at ' + time : '');
    if (diff === 1) return 'Yesterday';
    return dayOnly(day);
  }
  var PCOLS = [['name', 'Name'], ['email', 'Contact'], ['status', 'Status'], ['programs', 'Programs'], ['tracks', 'Interested in'], ['instruments', 'Plays'], ['created', 'Created'], ['lastActivity', 'Last activity']];
  // Inline edits on the People table. Each one writes the same MMS tag the person page does.
  function stageCell(r) {
    if (r.status === 'Active' || r.status === 'Inactive') return statusPill(r.status);
    var st = r.stage && LEAD.stages.indexOf(r.stage) >= 0 ? r.stage : 'First Contact';
    return '<select class="cellsel" data-edit="stage" data-id="' + esc(r.id) + '" aria-label="Stage for ' + esc(r.name) + '">' +
      LEAD.stages.map(function (x) { return '<option' + (x === st ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>' +
      (r.status === 'Waiting' || r.status === 'Trial' ? '<span class="cellnote">' + esc(r.status) + '</span>' : '');
  }
  function listCell(r, field) {
    var have = field === 'interest' ? (r.interests && r.interests.length ? r.interests : r.tracks) : r.instruments;
    var txt = have.map(function (t) { return t === 'Classes' ? 'Class' : t; }).join(', ');
    return '<button type="button" class="cellbtn' + (txt ? '' : ' empty') + '" data-edit="' + field + '" data-id="' + esc(r.id) + '">' + esc(txt || 'Add') + '</button>';
  }
  function renderPeople() {
    var rows = peopleState.rows; if (!rows) return;
    // tabs
    var vs = allViews();
    $('#pview-tabs').innerHTML = vs.map(function (v) {
      return '<button type="button" class="vtab' + (v.id === peopleState.view ? ' on' : '') + '" data-v="' + esc(v.id) + '">' + esc(v.name) +
        (v.saved ? '<span class="vx" data-del="' + esc(v.id) + '" title="Remove view">&times;</span>' : '') + '</button>';
    }).join('');
    // program options
    var progs = {}; rows.forEach(function (r) { r.programs.forEach(function (p) { progs[p] = 1; }); });
    var ps = $('#pquick [data-q="program"]');
    if (ps.options.length < 2) ps.innerHTML = '<option value="">Program</option>' + Object.keys(progs).sort(function (a, b) { return a.localeCompare(b, 'en', { numeric: true }); })
      .map(function (p) { return '<option>' + esc(p) + '</option>'; }).join('');
    $$('#pquick select').forEach(function (s) { s.value = peopleState.f[s.dataset.q] || ''; s.classList.toggle('on', !!s.value); });
    $('#psort').value = peopleState.sort;
    var nAdv = Object.keys(peopleState.adv).reduce(function (n, k) { return n + (peopleState.adv[k] || []).length; }, 0);
    $('#pfilter-btn').textContent = nAdv ? 'Filter · ' + nAdv : 'Filter';
    $('#pclear').hidden = !(Object.keys(peopleState.f).some(function (k) { return peopleState.f[k]; }) || nAdv);
    var list = pSorted(rows.filter(pMatch)), per = peopleState.per, pages = Math.max(1, Math.ceil(list.length / per));
    if (peopleState.page > pages) peopleState.page = pages;
    var pg = list.slice((peopleState.page - 1) * per, peopleState.page * per);
    $('#pcount').textContent = list.length + (list.length === 1 ? ' person' : ' people');
    if (useGrid()) {
      $('#ppager').innerHTML = ''; $('#people-list').classList.remove('list', 'ptable'); $('#people-list').classList.add('g-host');
      var gsp = peopleState.sort.split(':');
      NSJWGrid.people($('#people-list'), list.map(function (r) {
        return { id: r.id, name: r.name, email: r.email, phone: r.phone, status: r.status, stage: r.stage,
          programsText: r.programs.join(', '), interests: (r.interests || []).slice(), tracks: r.tracks, tagsKnown: Array.isArray(r.interests),
          instruments: r.instruments.slice(), formInstruments: r.formInstruments || [], nights: (r.nights || []).slice(), source: r.source, created: r.created, lastActivity: r.lastActivity };
      }), gridHooks({ per: per, sort: { column: { status: 'stage' }[gsp[0]] || gsp[0], dir: gsp[1] }, colsBtn: $('#pcols'),
        source: function (id) { return rowById(id); } }));
      return;
    }
    var sp = peopleState.sort.split(':');
    var head = '<div class="prow phead"><span class="pick" data-pickpage role="checkbox" aria-label="Select everyone on this page"></span>' + PCOLS.map(function (c) {
      var on = sp[0] === c[0], sortable = c[0] !== 'programs' && c[0] !== 'tracks';
      return '<span class="pc pc-' + c[0] + (sortable ? ' sortable' : '') + (on ? ' on' : '') + '"' + (sortable ? ' data-sort="' + c[0] + '"' : '') + '>' + c[1] +
        (on ? (sp[1] === 'desc' ? ' &darr;' : ' &uarr;') : '') + '</span>';
    }).join('') + '</div>';
    $('#people-list').innerHTML = pg.length ? head + pg.map(function (r) {
      return '<div class="card prow" data-href="#p/' + encodeURIComponent(r.id) + '" tabindex="0">' + pickBox(r.id, r.name) +
        '<a class="pc pc-name" href="#p/' + encodeURIComponent(r.id) + '"><span class="avatar sm">' + esc(initials(r.name)) + '</span><span class="nm">' + esc(r.name) + '</span></a>' +
        '<span class="pc pc-email"><span class="ln">' + esc(r.email) + '</span>' + (r.phone ? '<span class="ln sub">' + esc(r.phone) + '</span>' : '') + '</span>' +
        '<span class="pc pc-status">' + stageCell(r) + '</span>' +
        '<span class="pc pc-programs">' + esc(r.programs.join(', ')) + '</span>' +
        '<span class="pc pc-tracks">' + listCell(r, 'interest') + '</span>' +
        '<span class="pc pc-instruments">' + listCell(r, 'instrument') + '</span>' +
        '<span class="pc pc-created">' + esc(r.created ? dayOnly(r.created) : '') + '</span>' +
        '<span class="pc pc-lastActivity">' + esc(actText(r.lastActivity) || 'None yet') + '</span></div>';
    }).join('') : '<div class="empty">No one matches. Try another view or clear a filter.</div>';
    // pager
    var nums = [], p = peopleState.page;
    for (var i = 1; i <= pages; i++) if (i === 1 || i === pages || Math.abs(i - p) <= 2) nums.push(i); else if (nums[nums.length - 1] !== '…') nums.push('…');
    $('#ppager').innerHTML = pages > 1 || list.length > 25 ? '<button type="button" class="pg" data-pg="' + (p - 1) + '"' + (p === 1 ? ' disabled' : '') + '>&lsaquo; Prev</button>' +
      nums.map(function (n) { return n === '…' ? '<span class="pg gap">…</span>' : '<button type="button" class="pg' + (n === p ? ' on' : '') + '" data-pg="' + n + '">' + n + '</button>'; }).join('') +
      '<button type="button" class="pg" data-pg="' + (p + 1) + '"' + (p === pages ? ' disabled' : '') + '>Next &rsaquo;</button>' +
      '<select id="pper" aria-label="Per page">' + [25, 50, 100].map(function (n) { return '<option value="' + n + '"' + (n === per ? ' selected' : '') + '>' + n + ' per page</option>'; }).join('') + '</select>' : '';
  }
  $('#pview-tabs').addEventListener('click', function (e) {
    var d = e.target.closest('[data-del]');
    if (d) { e.stopPropagation(); store('nsjw_pviews', JSON.stringify(savedViews().filter(function (v) { return v.id !== d.dataset.del; }))); setView('all'); renderPeople(); return; }
    var b = e.target.closest('[data-v]'); if (!b) return; setView(b.dataset.v); renderPeople();
  });
  $('#pquick').addEventListener('change', function (e) {
    var s = e.target.closest('select[data-q]'); if (!s) return;
    peopleState.f[s.dataset.q] = s.value; peopleState.page = 1; renderPeople();
  });
  $('#psort').addEventListener('change', function () { peopleState.sort = this.value; peopleState.page = 1; renderPeople(); });
  function useGrid() { return !!(window.Tabulator && window.NSJWGrid); }
  // What the grid needs from the app: the option lists, how to save a tag, and where selections go.
  function gridHooks(o) {
    return Object.assign({
      LEAD: LEAD, picked: picked, actText: actText,
      onSelect: function (data) {
        picked = {}; data.forEach(function (d) { picked[d.id] = d.name; }); selBar();
      },
      save: function (row, field, value, on) {
        return api('leadtag', { sid: row.id, email: row.email, field: field, value: value, on: on }).then(function () {
          var src = o.source ? o.source(row.id) : null;
          [src, row].forEach(function (r) {
            if (!r) return;
            if (field === 'stage') { r.stage = value; return; }
            var key = { interest: 'interests', instrument: 'instruments', nights: 'nights' }[field];
            if (r === src && key) {
              var cur = (r[key] || []).filter(function (x) { return x !== value; });
              r[key] = on ? cur.concat(value) : cur;
              if (key === 'interests') r.tracks = tracksFrom(r.interests);
            }
          });
        });
      },
      saved: function (row, field, value) {
        leadsState.rows = o.keepLeads ? leadsState.rows : null; todayState.data = null; groupsState.rows = null; peopleState.rowsDirty = true;
        try { localStorage.removeItem(ckey('person', { sid: row.id })); } catch (e) {}
        toast(field === 'stage' ? row.name + ': ' + value : 'Saved to MMS');
      },
      failed: function (e) { toast(e.message); }
    }, o);
  }
  function rowById(id) { return (peopleState.rows || []).filter(function (r) { return r.id === id; })[0]; }
  function tracksFrom(list) { return ['Ensemble', 'Private lessons', 'Classes'].filter(function (x) { return list.indexOf(x) >= 0; }); }
  function cellSave(r, field, value, on) {
    var before = JSON.stringify({ stage: r.stage, interests: r.interests, tracks: r.tracks, instruments: r.instruments });
    if (field === 'stage') r.stage = value;
    if (field === 'interest') {
      var cur = r.interests && r.interests.length ? r.interests.slice() : [];
      r.interests = on ? cur.concat(value) : cur.filter(function (x) { return x !== value; });
      r.tracks = tracksFrom(r.interests);
    }
    if (field === 'instrument') r.instruments = on ? r.instruments.concat(value) : r.instruments.filter(function (x) { return x !== value; });
    return api('leadtag', { sid: r.id, email: r.email, field: field, value: value, on: on }).then(function () {
      leadsState.rows = null; todayState.data = null; groupsState.rows = null;
      try { localStorage.removeItem(ckey('person', { sid: r.id })); } catch (e) {}
      toast(field === 'stage' ? r.name + ': ' + value : 'Saved to MMS');
    }).catch(function (err) {
      var b = JSON.parse(before); r.stage = b.stage; r.interests = b.interests; r.tracks = b.tracks; r.instruments = b.instruments;
      toast(err.message); renderPeople();
    });
  }
  // Pop-over checklist for Interested in and Plays
  var cellPop = document.createElement('div'); cellPop.id = 'cellpop'; cellPop.hidden = true; document.body.appendChild(cellPop);
  function openCellPop(btn) {
    var r = rowById(btn.dataset.id); if (!r) return;
    var field = btn.dataset.edit, opts = field === 'interest' ? LEAD.interests : LEAD.instruments;
    var have = field === 'interest' ? (r.interests || []) : r.instruments;
    cellPop.dataset.id = r.id; cellPop.dataset.field = field;
    cellPop.innerHTML = '<div class="cp-h">' + (field === 'interest' ? 'Interested in' : 'Plays') + ' · ' + esc(r.name) + '</div>' +
      opts.map(function (o) {
        return '<label class="cp-row"><input type="checkbox" value="' + esc(o) + '"' + (have.indexOf(o) >= 0 ? ' checked' : '') + '> ' + esc(o) + '</label>';
      }).join('') +
      (field === 'interest' && !(r.interests || []).length && r.tracks.length ? '<p class="cp-note">From their sign-up form: ' + esc(r.tracks.join(', ')) + '. Tick to save it as a tag.</p>' : '') +
      '<button type="button" class="btn small" data-cpdone>Done</button>';
    var b = btn.getBoundingClientRect();
    cellPop.hidden = false;
    var w = cellPop.offsetWidth, h = cellPop.offsetHeight;
    cellPop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, b.left)) + 'px';
    cellPop.style.top = (b.bottom + h + 8 > window.innerHeight ? Math.max(8, b.top - h - 4) : b.bottom + 4) + 'px';
    cellPop._btn = btn;
  }
  function closeCellPop() { if (cellPop.hidden) return; cellPop.hidden = true; renderPeople(); }
  cellPop.addEventListener('change', function (e) {
    var cb = e.target.closest('input[type=checkbox]'); if (!cb) return;
    var r = rowById(cellPop.dataset.id); if (!r) return;
    cellSave(r, cellPop.dataset.field, cb.value, cb.checked);
  });
  cellPop.addEventListener('click', function (e) { if (e.target.closest('[data-cpdone]')) closeCellPop(); });
  document.addEventListener('mousedown', function (e) {
    if (!cellPop.hidden && !e.target.closest('#cellpop') && !e.target.closest('[data-edit]')) closeCellPop();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeCellPop(); });
  window.addEventListener('hashchange', function () { cellPop.hidden = true; });
  $('#people-list').addEventListener('change', function (e) {
    var s = e.target.closest('select[data-edit="stage"]'); if (!s) return;
    var r = rowById(s.dataset.id); if (r) cellSave(r, 'stage', s.value, true);
  });
  $('#people-list').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.matches('.prow[data-href]')) location.hash = e.target.dataset.href;
  });
  $('#people-list').addEventListener('click', function (e) {
    var ed = e.target.closest('[data-edit]');
    if (ed) { if (ed.tagName === 'BUTTON') { if (!cellPop.hidden && cellPop._btn === ed) closeCellPop(); else openCellPop(ed); } return; }
    if (e.target.closest('.pick, select, a, #cellpop')) return;
    var row = e.target.closest('.prow[data-href]');
    if (row) { location.hash = row.dataset.href; return; }
    var h = e.target.closest('[data-sort]'); if (!h) return;
    var k = h.dataset.sort, cur = peopleState.sort.split(':');
    peopleState.sort = k + ':' + (cur[0] === k && cur[1] === 'asc' ? 'desc' : cur[0] === k ? 'asc' : (k === 'name' || k === 'email' || k === 'status' ? 'asc' : 'desc'));
    peopleState.page = 1; renderPeople();
  });
  $('#ppager').addEventListener('click', function (e) {
    var b = e.target.closest('[data-pg]'); if (!b || b.disabled) return;
    peopleState.page = Number(b.dataset.pg); renderPeople(); $('#pcount').scrollIntoView({ block: 'start' });
  });
  $('#ppager').addEventListener('change', function (e) {
    if (e.target.id !== 'pper') return; peopleState.per = Number(e.target.value); store('nsjw_pper', peopleState.per); peopleState.page = 1; renderPeople();
  });
  // Sidebar: collapse to icons on desktop, remembered per browser
  function setNavMini(on) {
    document.documentElement.classList.toggle('navmini', on); store('nsjw_navmini', on ? '1' : '');
    var t = $('#navtoggle'); if (t) { t.setAttribute('aria-label', on ? 'Expand menu' : 'Collapse menu'); t.title = on ? 'Expand menu' : 'Collapse menu'; }
  }
  setNavMini(store('nsjw_navmini') === '1');
  $('#navtoggle').addEventListener('click', function () { setNavMini(!document.documentElement.classList.contains('navmini')); });
  $('#pclear').addEventListener('click', function () { peopleState.f = {}; peopleState.adv = {}; peopleState.page = 1; renderPeople(); });
  $('#psave').addEventListener('click', function () {
    var bits = [];
    Object.keys(peopleState.f).forEach(function (k) {
      var v = peopleState.f[k]; if (!v) return;
      var sel = $('#pquick [data-q="' + k + '"]'), opt = sel && Array.prototype.filter.call(sel.options, function (o) { return o.value === v; })[0];
      bits.push(k === 'status' || k === 'program' || k === 'track' ? (opt ? opt.textContent : v) : (opt ? (k === 'created' ? 'created ' : 'active ') + opt.textContent.toLowerCase() : v));
    });
    Object.keys(peopleState.adv).forEach(function (k) { if ((peopleState.adv[k] || []).length) bits.push(peopleState.adv[k].join('/')); });
    if (!bits.length) { toast('Pick some filters first, then save them as a view.'); return; }
    var v = { id: 'v' + Date.now(), name: bits.join(', ').slice(0, 40), f: peopleState.f, adv: peopleState.adv, sort: peopleState.sort, saved: true };
    store('nsjw_pviews', JSON.stringify(savedViews().concat(v))); setView(v.id); renderPeople(); toast('Saved as a view on this device');
  });
  var qTimer;
  $('#q').addEventListener('input', function (e) {
    clearTimeout(qTimer);
    qTimer = setTimeout(function () { peopleState.q = e.target.value.trim().toLowerCase(); peopleState.page = 1; renderPeople(); }, 150);
  });
  // Advanced filters: multi-select by field
  function pfGroups() {
    var rows = peopleState.rows || [], uniq = function (fn) { var o = {}; rows.forEach(function (r) { [].concat(fn(r)).forEach(function (x) { if (x) o[x] = 1; }); }); return Object.keys(o).sort(function (a, b) { return a.localeCompare(b, 'en', { numeric: true }); }); };
    return [['Status', ['Lead', 'Trial', 'Waiting', 'Active', 'Inactive']], ['Stage', LEAD.stages.concat(['Enrolled'])],
      ['Interested in', ['Ensemble', 'Private lessons', 'Classes']], ['Program', uniq(function (r) { return r.programs; })],
      ['Instrument', uniq(function (r) { return r.instruments; })], ['Source', uniq(function (r) { return r.source; })]];
  }
  function renderPf() {
    $('#pf-groups').innerHTML = pfGroups().map(function (g) {
      var have = peopleState.adv[g[0]] || [];
      return '<div class="flabel">' + esc(g[0]) + '</div><div class="optgrid">' + g[1].map(function (v) {
        return '<button type="button" class="chip' + (have.indexOf(v) >= 0 ? ' on' : '') + '" data-pk="' + esc(g[0]) + '" data-pv="' + esc(v) + '">' + esc(v === 'Classes' ? 'Class' : v) + '</button>';
      }).join('') + '</div>';
    }).join('');
  }
  $('#pfilter-btn').addEventListener('click', function () { renderPf(); $('#pf-sheet').hidden = false; });
  $('#pf-groups').addEventListener('click', function (e) {
    var b = e.target.closest('[data-pk]'); if (!b) return;
    var k = b.dataset.pk, v = b.dataset.pv, cur = peopleState.adv[k] || [];
    peopleState.adv[k] = cur.indexOf(v) >= 0 ? cur.filter(function (x) { return x !== v; }) : cur.concat(v);
    b.classList.toggle('on');
  });
  function closePf() { $('#pf-sheet').hidden = true; peopleState.page = 1; renderPeople(); }
  $('#pf-done').addEventListener('click', closePf);
  $('#pf-clear').addEventListener('click', function () { peopleState.adv = {}; renderPf(); });
  $('#pf-sheet').addEventListener('click', function (e) { if (e.target === this) closePf(); });
  $('#signout').addEventListener('click', signOut);


  // ---------- Person ----------
  var current = null;

  var pendingPlace = null;
  var personSeq = 0; // a load that finishes after a newer load or a local change is ignored
  function loadPerson(sid, fresh) {
    var main = $('#person'), mine = ++personSeq;
    if (!current || current.id !== sid) { propOpen = ''; aboutKeep = false; actF = { kind: 'all', q: '' }; }
    if (fresh) { delete billCache[sid]; try { localStorage.removeItem(ckey('person', { sid: sid })); } catch (e) {} }
    if (!fresh || !current || current.id !== sid) main.innerHTML = '<div class="loading">Loading</div>';
    $('#mms-link').hidden = true;
    swr('person', { sid: sid }, function (p) {
      if (mine !== personSeq) return;
      var same = current && current.id === p.id && $('#person .tab.on');
      current = p;
      renderPerson(p, same ? $('#person .tab.on').dataset.tab : 'timeline');
      if (pendingPlace && pendingPlace === p.id) { pendingPlace = null; openPlace(); }
    }).catch(function (e) { main.innerHTML = '<div class="empty err">' + esc(e.message) + '</div>'; });
  }

  // Lead stage, one tap to change, right under the name. Hidden once they are an active member.
  function stageStrip(p) {
    if (!p.id || p.status === 'Active') return '';
    var cur = tagStage(p.tags, p.status);
    return '<div class="pstage-h">Stage · tap to change</div><div class="stagebar pstage">' +
      LEAD.stages.map(function (s) {
        return '<button type="button" class="stagechip' + (s === cur ? ' on' : '') + '" data-stage="' + esc(s) + '"' +
          (s === cur ? ' aria-pressed="true"' : '') + '><span>' + esc(s) + '</span></button>';
      }).join('') + '</div>';
  }

  // Track: what they're here for. Saved as Interest tags in MMS (Class is the "Interest: Classes" tag).
  var TRACKS = [['Ensemble', 'Ensemble'], ['Private lessons', 'Private lessons'], ['Classes', 'Class']];
  function trackChips(have, attr) {
    return TRACKS.map(function (t) {
      return '<button type="button" class="chip' + (have.indexOf(t[0]) >= 0 ? ' on' : '') + '" ' + attr + '="' + esc(t[0]) + '">' + esc(t[1]) + '</button>';
    }).join('');
  }
  function trackRow(p) {
    if (!p.id || p.status === 'Active') return '';
    var have = (p.tags || []).filter(function (t) { return /^Interest: /.test(t); }).map(function (t) { return t.slice(10); });
    return '<div class="pstage-h">Interested in' + (have.some(function (h) { return TRACKS.some(function (t) { return t[0] === h; }); }) ? '' : ' · undecided') +
      '</div><div class="optgrid trackrow">' + trackChips(have, 'data-track') + '</div>' +
      '<div class="row2"><button type="button" class="btn' + (tagStage(p.tags, p.status) === 'Committed' ? '' : ' primary') + '" data-logcall>Log a call or text</button>' +
      '<button type="button" class="btn' + (tagStage(p.tags, p.status) === 'Committed' ? ' primary' : '') + '" data-place>Convert to member</button></div>';
  }

  // Person page, laid out like a HubSpot / Monday record: About (editable properties) on the left,
  // Overview and Activity in the middle, groups, lessons and email threads on the right.
  // On a phone the three panes stack in that order.
  var propOpen = '';            // which property row is being edited
  var aboutKeep = false;        // on a phone, About stays open once you have edited in it
  var actF = { kind: 'all', q: '' };
  var ICON = {
    email: '<path d="M3 5h14v10H3z"/><path d="M3 5l7 6 7-6"/>',
    text: '<path d="M3 4h14v9H8l-4 3v-3H3z"/>',
    call: '<path d="M6 3l3 3-2 2c1 2 3 4 5 5l2-2 3 3-2 2C9 16 4 11 4 5z"/>',
    note: '<path d="M5 3h8l3 3v11H5z"/><path d="M8 9h6M8 12h6"/>',
    next: '<circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2"/>',
    mms: '<path d="M8 4H4v12h12v-4"/><path d="M11 3h6v6M17 3l-8 8"/>'
  };
  function ico(k) { return '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">' + ICON[k] + '</svg>'; }

  function renderPerson(p, tab) {
    var main = $('#person');
    if (tab !== 'activity') tab = 'overview';
    main.innerHTML = '<div class="rec">' +
      '<aside class="rec-about">' + aboutHtml(p) + '</aside>' +
      '<section class="rec-main"><div class="tabs rec-tabs" role="tablist">' +
        '<button class="tab' + (tab === 'overview' ? ' on' : '') + '" data-tab="overview">Overview</button>' +
        '<button class="tab' + (tab === 'activity' ? ' on' : '') + '" data-tab="activity">Activity</button></div>' +
        (tab === 'activity' ? activityHtml(p) : overviewHtml(p)) + '</section>' +
      '<aside class="rec-side">' + sideHtml(p) + '</aside></div>';
    var link = $('#mms-link');
    if (p.mmsUrl) { link.href = p.mmsUrl; link.hidden = false; } else link.hidden = true;
  }

  function fmtPhone(v) {
    var d = String(v || '').replace(/\D/g, '');
    if (d.length === 11 && d[0] === '1') d = d.slice(1);
    return d.length === 10 ? d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6) : String(v || '');
  }
  // One field, edited in place, saved straight to MMS (Mms.gs studentPut_ checks it took).
  function fieldEd(field, value, type, hint) {
    return '<form class="sedit" data-sedit="' + field + '"><input name="v" type="' + type + '" value="' + esc(type === 'tel' ? fmtPhone(value) : value || '') + '" placeholder="' + esc(hint) + '"' +
      (type === 'tel' ? ' inputmode="tel" autocomplete="off"' : '') + '><button class="btn primary" type="submit">Save</button></form>' +
      '<p class="muted small">Saves to MMS.</p>';
  }

  function pickTags(p, pre) { return (p.tags || []).filter(function (t) { return t.indexOf(pre) === 0; }).map(function (t) { return t.slice(pre.length); }); }

  function aboutHtml(p) {
    var lead = p.id && p.status !== 'Active';
    var stage = tagStage(p.tags, p.status);
    var plays = p.instruments.length ? p.instruments : (p.formInstruments || []);
    var sms = p.phone ? 'sms:' + String(p.phone).replace(/[^\d+]/g, '') : '';
    function act(k, label, attrs) {
      return '<button type="button" class="ract" ' + attrs + '><span class="ri">' + ico(k) + '</span><span>' + label + '</span></button>';
    }
    var acts = '<div class="racts">' +
      act('email', 'Email', 'data-mailone' + (p.email && p.id ? '' : ' disabled')) +
      (sms ? '<a class="ract" href="' + esc(sms) + '"><span class="ri">' + ico('text') + '</span><span>Text</span></a>' : act('text', 'Text', 'disabled')) +
      act('call', 'Log call', p.id ? 'data-logcall' : 'disabled') +
      act('note', 'Note', 'data-open="note"') +
      act('next', 'Task', 'data-open="next_step"') +
      (p.mmsUrl ? '<a class="ract" target="_blank" rel="noopener" href="' + esc(p.mmsUrl) + '"><span class="ri">' + ico('mms') + '</span><span>MMS</span></a>' : '') +
      '</div>';

    // Each property: label, value, and (for MMS tags) an editor that opens in place.
    function prop(key, label, value, editor) {
      var open = editor && propOpen === key;
      return '<div class="rprop' + (editor ? ' editable' : '') + (open ? ' open' : '') + '">' +
        (editor ? '<button type="button" class="rprop-h" data-prop="' + key + '" aria-expanded="' + open + '">' : '<div class="rprop-h">') +
        '<span class="rl">' + esc(label) + '</span><span class="rv">' + (value || '<span class="faint">--</span>') + '</span>' +
        (editor ? '<span class="pen" aria-hidden="true">Edit</span></button>' : '</div>') +
        (open ? '<div class="rprop-ed">' + editor + '</div>' : '') + '</div>';
    }
    function chips(field, opts, have) {
      return '<div class="optgrid">' + opts.map(function (v) {
        return '<button type="button" class="chip' + (have.indexOf(v) >= 0 ? ' on' : '') + '" data-lt="' + field + '" data-v="' + esc(v) + '">' + esc(v) + '</button>';
      }).join('') + '</div><p class="muted small">Saves to MMS as you tap.</p>';
    }
    var interests = pickTags(p, 'Interest: '), nights = pickTags(p, 'Nights: ');
    var stageEd = '<div class="optgrid">' + LEAD.stages.map(function (s) {
      return '<button type="button" class="chip' + (s === stage ? ' on' : '') + '" data-stage="' + esc(s) + '">' + esc(s) + '</button>';
    }).join('') + '</div>';
    var other = (p.tags || []).filter(function (t) { return !/^(Stage|Interest|Nights): /.test(t); });

    return '<div class="rid"><div class="avatar">' + esc(initials(p.name)) + '</div><div style="min-width:0"><h2>' + esc(p.name) + '</h2>' +
      '<div class="sub">' + statusPill(p.status) + (lead ? ' <span class="pill accent">' + esc(stage) + '</span>' : '') + '</div></div></div>' +
      acts +
      (lead ? '<button type="button" class="btn rconv' + (stage === 'Committed' ? ' primary' : '') + '" data-place>Convert to member</button>' : '') +
      '<details class="rabout"' + (propOpen || aboutKeep || window.innerWidth >= 1000 ? ' open' : '') + '><summary class="rsec">About this person</summary>' +
      (lead ? prop('stage', 'Stage', esc(stage), stageEd) : '') +
      prop('email', 'Email', (p.email ? '<span class="sel">' + esc(p.email) + '</span>' : '') +
        (p.mmsUrl ? ' <a class="faint small" target="_blank" rel="noopener" href="' + esc(p.mmsUrl) + '">Change in MMS</a>' : '')) +
      prop('phone', 'Phone', p.phone ? '<a href="tel:' + esc(String(p.phone).replace(/[^\d+]/g, '')) + '">' + esc(fmtPhone(p.phone)) + '</a>' : '',
        p.id ? fieldEd('phone', p.phone, 'tel', '612 555 0123') : '') +
      (p.id ? prop('interest', 'Interested in', esc(interests.join(', ')), chips('interest', LEAD.interests, interests)) : '') +
      (p.id ? prop('instrument', 'Plays', esc(plays.join(', ')) + (p.instruments.length || !plays.length ? '' : ' <span class="faint">(form)</span>'), chips('instrument', LEAD.instruments, p.instruments || [])) : '') +
      (p.id ? prop('nights', 'Nights they can do', esc(nights.join(', ')), chips('nights', LEAD.nights, nights)) : '') +
      prop('skill', 'Skill', esc(p.skill), p.id ? fieldEd('skill', p.skill, 'text', 'Beginner, Intermediate, Advanced') : '') +
      prop('started', 'Signed up', esc(dayOnly(p.started))) +
      (p.id ? prop('referrer', 'Referred by', esc(p.referrer || ''), fieldEd('referrer', p.referrer, 'text', 'Who sent them our way')) : '') +
      prop('programs', 'Groups and programs', esc((p.programs || []).join(', '))) +
      (p.lastEvent || p.nextEvent ? prop('last', 'Last lesson', esc(dayOnly(p.lastEvent))) + prop('next', 'Next lesson', esc(dayOnly(p.nextEvent))) : '') +
      (other.length ? prop('tags', 'Other tags', esc(other.join(', '))) : '') + '</details>';
  }

  function lastActivity(p) {
    var t = (p.timeline || []).filter(function (x) { return x.kind !== 'email-open' && x.kind !== 'email-click'; })
      .map(function (x) { return x.at; }).filter(Boolean).sort().pop();
    return t || '';
  }
  function lastFromThem(p) {
    var t = (p.timeline || []).filter(function (x) { return x.kind === 'mail-in' || x.kind === 'email-reply'; }).map(function (x) { return x.at; }).sort().pop();
    return t || '';
  }

  function overviewHtml(p) {
    var lead = p.id && p.status !== 'Active';
    var hi = [
      [lead ? 'Stage' : 'Status', esc(lead ? tagStage(p.tags, p.status) : p.status)],
      ['Signed up', esc(dayOnly(p.started)) || '--'],
      ['Last activity', esc(when(lastActivity(p))) || '--'],
      ['Last heard from them', esc(when(lastFromThem(p))) || '--']
    ];
    var items = actItems(p);
    return '<div class="rcard"><div class="rcard-h">Highlights</div><div class="rhi">' +
      hi.map(function (h) { return '<div><div class="rl">' + h[0] + '</div><div class="rhv">' + h[1] + '</div></div>'; }).join('') + '</div></div>' +
      tasksCardHtml(p) +
      '<div class="rcard"><div class="rcard-h">Recent activity<button type="button" class="link" data-tab="activity">See all ' + items.length + '</button></div>' +
      (p.mailError ? '<p class="muted small mail-note">Emails could not load right now (Gmail limit). Notes and calls are all here.</p>' : '') +
      tlList(items.slice(0, 5), false) + '</div>';
  }

  // Activity: one kind per filter chip, newest first, grouped by month like HubSpot.
  var ACT_KINDS = [['all', 'All'], ['email', 'Emails'], ['seq', 'Sequences'], ['note', 'Notes'], ['call', 'Calls and texts'], ['next', 'Tasks'], ['signup', 'Sign-up']];
  function actKind(t) {
    return { 'mail-in': 'email', 'mail-out': 'email', 'email-reply': 'email', 'email-sent': 'seq', note: 'note', call: 'call', next_step: 'next', signup: 'signup' }[t.kind] || 'note';
  }
  function actItems(p) {
    var stats = {};
    p.timeline.forEach(function (t) {
      if (t.kind === 'email-open' || t.kind === 'email-click') {
        var k = t.sequence + '|' + t.step, s = stats[k] = stats[k] || { o: 0, c: 0 };
        if (t.kind === 'email-open') s.o++; else s.c++;
      }
    });
    return p.timeline.filter(function (t) { return t.kind !== 'email-open' && t.kind !== 'email-click'; })
      .map(function (t) { var o = Object.assign({}, t); o.stats = stats[t.sequence + '|' + t.step]; o.cat = actKind(t); return o; });
  }
  function activityHtml(p) {
    var items = actItems(p), n = {};
    items.forEach(function (t) { n[t.cat] = (n[t.cat] || 0) + 1; });
    return '<div class="ract-tools"><input type="search" id="act-q" placeholder="Search activity" value="' + esc(actF.q) + '" aria-label="Search activity">' +
      '<div class="ract-add"><button type="button" class="btn" data-logcall' + (p.id ? '' : ' disabled') + '>Log call</button>' +
      '<button type="button" class="btn" data-open="note">Note</button>' +
      '<button type="button" class="btn" data-mailone' + (p.email && p.id ? '' : ' disabled') + '>Email</button></div></div>' +
      '<div class="chips act-kinds">' + ACT_KINDS.filter(function (k) { return k[0] === 'all' || n[k[0]]; }).map(function (k) {
        return '<button type="button" class="chip' + (actF.kind === k[0] ? ' on' : '') + '" data-actk="' + k[0] + '">' + k[1] + ' <span class="cnt">' + (k[0] === 'all' ? items.length : n[k[0]]) + '</span></button>';
      }).join('') + '</div>' +
      (p.mailError ? '<p class="muted small mail-note">Emails could not load right now (Gmail limit). Notes and calls are all here.</p>' : '') +
      '<div id="act-list">' + actList(items) + '</div>';
  }
  function actList(items) {
    var q = actF.q.toLowerCase();
    var f = items.filter(function (t) {
      return (actF.kind === 'all' || t.cat === actF.kind) &&
        (!q || [t.text, t.snippet, t.sequence, t.author].join(' ').toLowerCase().indexOf(q) >= 0);
    });
    return tlList(f, true);
  }
  function tlList(items, months) {
    if (!items.length) return '<div class="empty">Nothing here yet.</div>';
    var out = '', lastM = '';
    items.forEach(function (t) {
      if (months) {
        var d = parse(t.at), m = isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
        if (m !== lastM) { out += (out ? '</ul>' : '') + '<div class="tl-month">' + esc(m) + '</div><ul class="tl">'; lastM = m; }
      }
      out += tlItem(t);
    });
    return (months ? '' : '<ul class="tl">') + out + '</ul>';
  }
  function tlItem(t) {
    var head, body = t.text || '', extra = '', s = t.stats;
    switch (t.kind) {
      case 'note': head = 'Note' + (t.author ? ' · ' + ownerName(t.author) : ''); break;
      case 'next_step': head = 'Task' + (t.due ? ' · due ' + dayOnly(t.due) : '') + (t.owner ? ' · ' + ownerName(t.owner) : ''); break;
      case 'email-sent':
        head = t.sequence + ' · step ' + t.step;
        if (s && s.o) extra += '<span class="pill">Opened' + (s.o > 1 ? ' ' + s.o + 'x' : '') + '</span>';
        if (s && s.c) extra += '<span class="pill good">Clicked</span>';
        break;
      case 'email-reply': head = 'Replied to ' + t.sequence; extra = '<span class="pill good">Replied</span>'; break;
      case 'mail-in': head = 'Email from them'; body = t.text + (t.snippet ? '\n' + t.snippet : ''); break;
      case 'mail-out': head = 'Email to them'; break;
      case 'signup': head = 'Sign-up form answers'; break;
      case 'call': head = 'Call or text' + (t.author ? ' · ' + ownerName(t.author) : ''); break;
      case 'mms': head = 'Check in MMS' + (t.author ? ' · ' + ownerName(t.author) : ''); extra = '<span class="pill warn">Not clean</span>'; break;
      default: head = t.kind;
    }
    var inner = '<div class="head">' + esc(head) + ' · ' + esc(when(t.at)) + ' ' + extra + '</div>' +
      '<div class="body' + (t.kind === 'signup' || t.kind === 'mail-in' ? ' clip' : '') + '">' + esc(body) + '</div>';
    if (t.url) inner = '<a href="' + esc(t.url) + '" target="_blank" rel="noopener" style="color:inherit">' + inner + '</a>';
    return '<li><span class="dot ' + esc(t.kind) + '"></span><div style="min-width:0;flex:1">' + inner + '</div></li>';
  }

  function sideHtml(p) {
    var progs = p.programs || [];
    var groups = '<div class="rcard"><div class="rcard-h">Groups and programs <span class="cnt">' + progs.length + '</span></div>' +
      (progs.length ? '<div class="pills">' + progs.map(function (g) {
        return /^Group \d+$/.test(g) ? '<a class="pill accent" href="#g/' + encodeURIComponent(g) + '">' + esc(g) + '</a>' : '<span class="pill accent">' + esc(g) + '</span>';
      }).join('') + '</div>' : '<p class="muted small">Not in a group or class.</p>') +
      (p.status === 'Active' ? '<button type="button" class="btn primary" data-place>Add to another group or lessons</button>' : '') +
      progs.filter(function (g) { return /^Group \d+$/.test(g); }).map(function (g) {
        return '<button type="button" class="btn" data-cal="' + esc(g) + '">Add to ' + esc(g) + ' rehearsals in MMS</button>';
      }).join('') +
      (progs.length || p.status === 'Active' ? '<button type="button" class="btn" data-leave>Take out of a group or end membership</button>' : '') + '</div>';

    var l = p.lesson;
    var lesson = '<div class="rcard"><div class="rcard-h">Private lessons' + (l ? '<button class="link" type="button" data-open-lesson>Edit</button>' : '') + '</div>' +
      (l ? '<div class="muted small">' + esc(l.Stage || '') + '</div><div><b>' + esc([l.Teacher, l.Instrument].filter(Boolean).join(' · ')) + '</b></div>' +
        '<div class="muted">' + esc([l['Day and time'], l.Frequency, money(l['Monthly cost'])].filter(Boolean).join(' · ')) + '</div>' +
        (l['Schedule notes'] ? '<div class="muted" style="margin-top:4px">' + esc(l['Schedule notes']) + '</div>' : '') + setupPills(l)
        : (p.id ? '<button class="btn" type="button" data-open-lesson>Set up private lessons</button>' : '<p class="muted small">None.</p>')) + '</div>';

    var seq = p.sequences.length ? '<div class="rcard"><div class="rcard-h">Sequences <span class="cnt">' + p.sequences.length + '</span></div>' +
      p.sequences.map(function (s) {
        return '<div class="rmini"><b>' + esc(s.sequence) + '</b> <span class="pill">' + esc(s.status) + '</span><div class="muted small">Opens ' + esc(s.opens || 0) +
          ' · Clicks ' + esc(s.clicks || 0) + (s.repliedAt ? ' · Replied ' + esc(dayOnly(s.repliedAt)) : '') + '</div></div>';
      }).join('') + '</div>' : '';

    var th = '<div class="rcard"><div class="rcard-h">Email threads <span class="cnt">' + p.threads.length + '</span></div>' +
      (p.threads.length ? p.threads.slice(0, 6).map(function (t) {
        return '<div class="rmini"><div>' + esc(t.subject || '(no subject)') + '</div><div class="muted small">' + esc(when(t.last)) + ' · ' + esc(t.count) + ' message' + (t.count === 1 ? '' : 's') +
          (t.theyWroteLast ? ' · <span class="pill accent">Waiting on us</span>' : '') + '</div></div>';
      }).join('') : '<p class="muted small">No email with them yet.</p>') + '</div>';

    return groups + billCard(p) + lesson + seq + th;
  }

  // Billing, read live from MMS: who bills them, at what rate, recent charges, and anything that looks off.
  var billCache = {};
  function billCard(p) {
    if (!p.id) return '';
    var b = billCache[p.id];
    if (!b) { loadBilling(p.id); return '<div class="rcard" id="bill-card"><div class="rcard-h">Billing in MMS</div><div class="loading">Loading</div></div>'; }
    if (b.error) return '<div class="rcard" id="bill-card"><div class="rcard-h">Billing in MMS</div><p class="muted small">' + esc(b.error) + '</p></div>';
    function rate(x) {
      if (x.mode === 'None' || !(x.rate > 0)) return 'No charge';
      return money(x.rate) + (x.mode === 'PerLesson' ? '/lesson' : x.mode === 'FixedMonthly' ? '/month' : x.mode === 'Hourly' ? '/hour' : '');
    }
    var used = b.profiles.filter(function (x) { return x.eventsThisMonth || (x.mode !== 'None' && x.rate > 0); });
    var idle = b.profiles.length - used.length;
    return '<div class="rcard" id="bill-card"><div class="rcard-h">Billing in MMS' + (b.issues.length ? ' <span class="pill warn">' + b.issues.length + ' to check</span>' : '') + '</div>' +
      b.issues.map(function (i) { return '<div class="rmini"><b>' + esc(i.problem) + '</b><div class="muted small">' + esc(i.detail) + '</div></div>'; }).join('') +
      (used.length ? used.map(function (x) {
        return '<div class="rmini"><div><b>' + esc(x.teacher) + '</b> · ' + esc(x.category) + '</div><div class="muted small">' + esc(rate(x)) +
          ' · ' + (x.eventsThisMonth ? x.eventsThisMonth + ' event' + (x.eventsThisMonth === 1 ? '' : 's') + ' this month' : 'no events this month') + '</div></div>';
      }).join('') : '<p class="muted small">No billing set up.</p>') +
      (idle ? '<p class="muted small">' + idle + ' more teacher' + (idle === 1 ? '' : 's') + ' at no charge.</p>' : '') +
      (b.charges.length ? '<div class="rcard-sub">Charges</div>' + b.charges.slice(0, 6).map(function (c) {
        return '<div class="bline"><span>' + esc(dayOnly(c.date)) + '</span><span class="bdesc">' + esc(c.desc) + '</span><span class="bamt' + (c.type === 'Charge' ? '' : ' neg') + '">' +
          (c.type === 'Charge' ? '' : '-') + esc(money(Math.abs(c.amount))) + '</span></div>';
      }).join('') : '') +
      (p.mmsUrl ? '<a class="btn" target="_blank" rel="noopener" href="' + esc(p.mmsUrl) + '">Change billing in MMS</a>' : '') + '</div>';
  }
  function loadBilling(sid) {
    if (loadBilling.busy === sid) return;
    loadBilling.busy = sid;
    swr('billing', { sid: sid }, function (b) {
      billCache[sid] = b;
      if (current && current.id === sid) { var el = $('#bill-card'); if (el) el.outerHTML = billCard(current); }
    }).catch(function (e) {
      billCache[sid] = { error: /Unknown action/.test(e.message) ? 'Shows up once the new backend is deployed.' : e.message };
      if (current && current.id === sid) { var el = $('#bill-card'); if (el) el.outerHTML = billCard(current); }
    }).then(function () { loadBilling.busy = ''; });
  }

  // ---------- Lessons ----------
  var lessonsState = { stage: 'Active', teacher: '', rows: null };

  function money(v) {
    var n = parseFloat(v);
    return isNaN(n) ? '' : '$' + (n % 1 ? n.toFixed(2) : n);
  }
  function yes(v) { return v === true || /^(yes|true|v|x|sent)$/i.test(String(v || '').trim()); }
  function setupPills(l) {
    if (!/^(Scheduling|Active)$/.test(l.Stage)) return '';
    // Setup checks only matter while someone is being scheduled; Monday rarely tracked them for active students.
    var missing = l.Stage !== 'Scheduling' ? [] : [['Contract sent', 'No contract'], ['Billed in MMS', 'Not billed'], ['Calendar invite sent', 'No invite']]
      .filter(function (c) { return !yes(l[c[0]]); })
      .map(function (c) { return '<span class="pill warn">' + c[1] + '</span>'; });
    if (!l.Teacher) missing.unshift('<span class="pill accent">Needs teacher</span>');
    return missing.length ? '<div class="pills">' + missing.join('') + '</div>' : '';
  }

  function loadLessons(force) {
    if (lessonsState.rows && !force) { renderLessons(); return; }
    $('#lesson-list').innerHTML = '<div class="loading">Loading</div>';
    swr('lessons', null, function (rows) {
      lessonsState.rows = rows;
      var teachers = rows.map(function (r) { return r.Teacher; }).filter(Boolean)
        .filter(function (t, i, a) { return a.indexOf(t) === i; }).sort();
      $('#teacher-filter').innerHTML = '<option value="">All teachers</option>' +
        teachers.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('');
      $('#teacher-filter').value = lessonsState.teacher;
      $('#teacher-names').innerHTML = teachers.map(function (t) { return '<option value="' + esc(t) + '">'; }).join('');
      renderLessons();
    }).catch(function (e) { $('#lesson-list').innerHTML = '<div class="empty err">' + esc(e.message) + '</div>'; });
  }

  function renderLessons() {
    var all = lessonsState.rows || [];
    var byTeacher = all.filter(function (r) { return !lessonsState.teacher || r.Teacher === lessonsState.teacher; });
    var active = byTeacher.filter(function (r) { return r.Stage === 'Active'; });
    var monthly = active.reduce(function (s, r) { return s + (parseFloat(r['Monthly cost']) || 0); }, 0);
    var sched = byTeacher.filter(function (r) { return r.Stage === 'Scheduling'; }).length;
    $('#lesson-stats').innerHTML =
      '<div class="stat"><div class="n">' + active.length + '</div><div class="l">Active</div></div>' +
      '<div class="stat"><div class="n">$' + Math.round(monthly).toLocaleString() + '</div><div class="l">Per month</div></div>' +
      '<div class="stat"><div class="n">' + sched + '</div><div class="l">Scheduling</div></div>' +
      '<div class="stat"><div class="n">' + byTeacher.filter(function (r) { return (r.check || []).length; }).length + '</div><div class="l">To check</div></div>';
    var rows = byTeacher.filter(function (r) { return !lessonsState.stage || r.Stage === lessonsState.stage; });
    if (!rows.length) { $('#lesson-list').innerHTML = '<div class="empty">No one here.</div>'; return; }
    $('#lesson-list').innerHTML = rows.map(function (r) {
      var href = r['MMS ID'] ? '#p/' + encodeURIComponent(r['MMS ID']) : '';
      var m = r.mms || null;
      var when = [r['Day and time'], r.Frequency, m && m.location].filter(Boolean).join(' · ');
      var cost = m && m.rate && m.mode === 'PerLesson' ? money(m.rate) + '/lesson' : m && m.rate && m.mode === 'Hourly' ? money(m.rate) + '/hour' : money(r['Monthly cost']);
      return '<' + (href ? 'a href="' + href + '"' : 'div') + ' class="card lesson-row">' +
        '<div class="line1"><span class="name">' + esc(r.Name) + '</span><span class="cost">' + esc(cost) + '</span></div>' +
        '<div class="sub">' + esc([r.Teacher || 'No teacher yet', r.Instrument].filter(Boolean).join(' · ')) + '</div>' +
        (when ? '<div class="sub">' + esc(when) + '</div>' : '') +
        (m && (m.next || m.last) ? '<div class="sub faint">' + (m.next ? 'Next lesson ' + esc(dayOnly(m.next)) : 'Last lesson ' + esc(dayOnly(m.last))) + '</div>' : '') +
        ((r.check || []).length ? '<div class="pills">' + r.check.map(function (c) { return '<span class="pill warn">' + esc(c) + '</span>'; }).join('') + '</div>' : '') +
        (r['Schedule notes'] ? '<div class="note">' + esc(r['Schedule notes']) + '</div>' : '') +
        (lessonsState.stage === '' ? '<div class="pills">' + statusPill(r.Stage) + '</div>' : '') +
        setupPills(r) + (href ? '</a>' : '</div>');
    }).join('');
  }

  $('#stage-chips').addEventListener('click', function (e) {
    var b = e.target.closest('.chip'); if (!b) return;
    $$('.chip', this).forEach(function (c) { c.classList.toggle('on', c === b); });
    lessonsState.stage = b.dataset.stage; store('nsjw_stage', lessonsState.stage);
    renderLessons();
  });
  $('#teacher-filter').addEventListener('change', function () {
    lessonsState.teacher = this.value; store('nsjw_teacher', this.value); renderLessons();
  });

  // ---------- Lesson sheet ----------
  function toDateInput(v) {
    if (!v) return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(String(v))) return String(v).slice(0, 10);
    var d = new Date(v); if (isNaN(d)) return '';
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function openLessonSheet() {
    if (!current) return;
    var l = current.lesson || { Stage: 'Scheduling', Instrument: current.instruments[0] || '', Length: '60 minutes' };
    var f = $('#lesson-form');
    $('#lesson-title').textContent = (current.lesson ? 'Lessons: ' : 'Set up lessons: ') + current.name;
    Array.prototype.forEach.call(f.elements, function (el) {
      if (!el.name) return;
      var v = l[el.name];
      if (el.type === 'checkbox') el.checked = yes(v);
      else if (el.type === 'date') el.value = toDateInput(v);
      else el.value = v == null ? '' : v;
    });
    $('#lesson-sheet').hidden = false;
  }
  $('#person').addEventListener('click', function (e) { if (e.target.closest('[data-open-lesson]')) openLessonSheet(); });
  $('#lesson-cancel').addEventListener('click', function () { $('#lesson-sheet').hidden = true; });
  $('#lesson-sheet').addEventListener('click', function (e) { if (e.target === this) this.hidden = true; });
  $('#lesson-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var fields = {}, old = current.lesson || {};
    Array.prototype.forEach.call(this.elements, function (el) {
      if (!el.name) return;
      var v = el.type === 'checkbox' ? (el.checked ? 'Yes' : '') : el.value;
      var was = el.type === 'checkbox' ? (yes(old[el.name]) ? 'Yes' : '') : (el.type === 'date' ? toDateInput(old[el.name]) : String(old[el.name] == null ? '' : old[el.name]));
      if (v !== was) fields[el.name] = v; // only send what changed
    });
    if (!Object.keys(fields).length) { $('#lesson-sheet').hidden = true; return; }
    var btn = $('#lesson-save'); btn.disabled = true; btn.textContent = 'Saving';
    api('lesson', { sid: current.id, email: current.email, fields: fields }).then(function () {
      $('#lesson-sheet').hidden = true; toast('Lessons saved');
      lessonsState.rows = null; // refresh the list next time
      loadPerson(current.id, true);
    }).catch(function (err) { toast(err.message); })
      .then(function () { btn.disabled = false; btn.textContent = 'Save'; });
  });

  function curTab() { var t = document.querySelector('#person .tab.on'); return t ? t.dataset.tab : 'overview'; }
  $('#person').addEventListener('submit', function (e) {
    var f = e.target.closest('[data-sedit]');
    if (!f || !current) return;
    e.preventDefault();
    var field = f.dataset.sedit, value = f.v.value.trim(), btn = f.querySelector('button'), sid = current.id;
    btn.disabled = true; btn.textContent = 'Saving';
    api('studentedit', { sid: sid, field: field, value: value }).then(function (r) {
      if (!current || current.id !== sid) return;
      if (r.after) { current.phone = r.after.phone; current.skill = r.after.skill; current.referrer = r.after.referrer; }
      try { localStorage.removeItem(ckey('person', { sid: sid })); localStorage.removeItem(ckey('contacts')); } catch (x) {}
      propOpen = ''; renderPerson(current, curTab());
      toast(r.changed ? 'Saved to MMS' : 'No change');
    }).catch(function (err) { toast(err.message); btn.disabled = false; btn.textContent = 'Save'; });
  });
  $('#person').addEventListener('input', function (e) {
    if (e.target.id === 'act-q' && current) { actF.q = e.target.value; $('#act-list').innerHTML = actList(actItems(current)); }
  });
  $('#person').addEventListener('click', function (e) {
    var tab = e.target.closest('[data-tab]');
    if (tab && current) { renderPerson(current, tab.dataset.tab); window.scrollTo(0, 0); return; }
    var pr = e.target.closest('[data-prop]');
    if (pr && current) { propOpen = propOpen === pr.dataset.prop ? '' : pr.dataset.prop; aboutKeep = true; renderPerson(current, curTab()); return; }
    var ak = e.target.closest('[data-actk]');
    if (ak && current) { actF.kind = ak.dataset.actk; renderPerson(current, 'activity'); return; }
    var open = e.target.closest('[data-open]');
    if (open) openSheet(open.dataset.open);
  });

  // ---------- Note sheet ----------
  var noteKind = 'note';
  function setKind(k) {
    noteKind = k;
    $$('.seg-btn').forEach(function (b) { b.classList.toggle('on', b.dataset.kind === k); });
    $('.next-only').hidden = k !== 'next_step';
    $('.note-only').hidden = k === 'next_step';
    $('#note-text').placeholder = k === 'next_step' ? 'What to do, like "Call Sam about Tuesday sit-in"' : 'What happened';
  }
  function openSheet(kind) {
    setKind(kind);
    $('#note-text').value = '';
    $('#note-due').value = duePresets()[2].value;
    $('#note-owner').innerHTML = ownerOptions(myName());
    $('.due-presets').innerHTML = duePresets().map(function (o, i) { return '<button type="button" class="chip' + (i === 2 ? ' on' : '') + '" data-due="' + o.value + '">' + esc(o.label) + '</button>'; }).join('');
    $('#note-fu').checked = false; $('#note-fu-due').innerHTML = dueOptions(null, 2);
    $('#sheet').hidden = false;
    setTimeout(function () { $('#note-text').focus(); }, 50);
  }
  function closeSheet() { $('#sheet').hidden = true; }
  $$('.seg-btn').forEach(function (b) { b.addEventListener('click', function () { setKind(b.dataset.kind); }); });
  $('#note-cancel').addEventListener('click', closeSheet);
  $('.due-presets').addEventListener('click', function (e) {
    var c = e.target.closest('[data-due]'); if (!c) return;
    $('#note-due').value = c.dataset.due;
    $$('.due-presets .chip').forEach(function (x) { x.classList.toggle('on', x === c); });
  });
  $('#note-due').addEventListener('input', function () { var v = this.value; $$('.due-presets .chip').forEach(function (x) { x.classList.toggle('on', x.dataset.due === v); }); });
  $('#sheet').addEventListener('click', function (e) { if (e.target === this) closeSheet(); });
  $('#note-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!current) return;
    var btn = $('#note-save'); btn.disabled = true; btn.textContent = 'Saving';
    api('note', {
      sid: current.id, email: current.email, kind: noteKind, text: $('#note-text').value,
      due: noteKind === 'next_step' ? $('#note-due').value : '', owner: noteKind === 'next_step' ? $('#note-owner').value : ''
    }).then(function () {
      if (noteKind === 'note' && $('#note-fu').checked) {
        return addFollowUp(current.id, current.email, 'Follow up: ' + $('#note-text').value.split('\n')[0].slice(0, 80), $('#note-fu-due').value);
      }
    }).then(function () {
      if (noteKind === 'next_step') afterTaskWrite();
      closeSheet(); toast(noteKind === 'next_step' ? 'Task saved' : 'Note saved' + ($('#note-fu').checked ? ' with a follow-up task' : ''));
      loadPerson(current.id || current.email, true);
    }).catch(function (err) { toast(err.message); })
      .then(function () { btn.disabled = false; btn.textContent = 'Save'; });
  });


  // ---------- Tasks (follow-ups): one person each, a due date and an owner ----------
  // Stored as next_step rows in the Notes tab. HubSpot's pattern: Due today / Overdue / Upcoming,
  // a "Start tasks" run through each person, and a follow-up checkbox wherever you log something.
  var OWNERS = ['Ben', 'Kelley', 'Joe', 'Chris'];
  function myName() {
    var n = me ? ownerName(me.email || '') : '';
    return n && n.indexOf('@') < 0 ? n : ((me && me.given_name) || '');
  }
  function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function addDays(n) { var d = today0(); d.setDate(d.getDate() + n); return d; }
  function addBiz(n) { var d = today0(); while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) n--; } return d; }
  function duePresets() {
    var wd = function (d) { return d.toLocaleDateString(undefined, { weekday: 'short' }); };
    var b3 = addBiz(3), w1 = addDays(7);
    return [['Today', today0()], ['Tomorrow', addDays(1)], ['In 3 business days (' + wd(b3) + ')', b3], ['In 1 week', w1], ['In 2 weeks', addDays(14)]]
      .map(function (x) { return { label: x[0], value: ymd(x[1]) }; });
  }
  function dueOptions(sel, pick) {
    return duePresets().map(function (o, i) { return '<option value="' + o.value + '"' + (i === pick ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('');
  }
  function ownerOptions(cur) {
    var list = OWNERS.slice(); if (cur && list.indexOf(cur) < 0) list.push(cur);
    return list.map(function (o) { return '<option' + (o === cur ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('');
  }
  function dueState(t) {
    if (t.done) return 'done';
    if (!t.due) return 'nodate';
    var d = ymd(today0());
    return t.due < d ? 'overdue' : t.due === d ? 'today' : 'upcoming';
  }
  function dueLabel(t) {
    if (!t.due) return 'No date';
    var st = dueState(t);
    return (st === 'overdue' ? 'Overdue · ' : '') + (st === 'today' ? 'Today' : dayOnly(t.due));
  }
  function resSelect(t) {
    return '<select class="tres" data-tres="' + t.row + '" aria-label="Reschedule"><option value="">Reschedule</option>' + dueOptions(null, -1) + '</select>';
  }
  function taskRowHtml(t, withName) {
    var st = dueState(t);
    return '<div class="trow ' + st + '" data-row="' + t.row + '">' +
      '<button type="button" class="tchk' + (t.done ? ' on' : '') + '" data-tdone="' + (t.row || '') + '" aria-label="' + (t.done ? 'Reopen' : 'Mark complete') + '"></button>' +
      '<div class="tmain"><div class="ttext">' + esc(t.text) + '</div><div class="tmeta">' +
        (withName && t.sid ? '<a href="#p/' + encodeURIComponent(t.sid) + '">' + esc(t.name || t.email) + '</a> · ' : '') +
        '<span class="tdue">' + esc(t.done ? 'Done ' + dayOnly(t.done) : dueLabel(t)) + '</span>' +
        (t.owner ? ' · ' + esc(ownerName(t.owner)) : '') + '</div></div>' +
      (t.done || !t.row ? '' : resSelect(t)) + '</div>';
  }
  // Tasks on the person page. Older backends only send the newest open one as nextStep.
  function personTasks(p) {
    if (p.tasks) return p.tasks.map(function (t) { return Object.assign({}, t, { sid: p.id, email: p.email }); });
    var ns = p.nextStep;
    return ns ? [{ row: 0, sid: p.id, email: p.email, text: ns.Text, due: ns.Due ? String(ns.Due).slice(0, 10) : '', owner: ns.Owner, done: '' }] : [];
  }
  function tasksCardHtml(p) {
    var list = personTasks(p).sort(function (a, b) { return (a.due || '9').localeCompare(b.due || '9'); });
    return '<div class="rcard"><div class="rcard-h">Tasks <span class="cnt">' + list.length + ' open</span></div>' +
      (list.length ? list.map(function (t) { return taskRowHtml(t, false); }).join('') : '<p class="muted small">No follow-up set.</p>') +
      '<button type="button" class="btn" data-open="next_step">Add a task</button></div>';
  }

  var tasksState = { rows: null, tab: store('nsjw_ttab') || 'today', who: store('nsjw_twho') == null ? 'me' : store('nsjw_twho'), err: '' };
  var run = null; // { list, i } while working through tasks
  function loadTasks(force) {
    if (tasksState.rows && !force) { renderTasks(); return; }
    if (!tasksState.rows) $('#tasks').innerHTML = '<div class="loading">Loading</div>';
    api('tasks', {}).then(function (rows) { tasksState.rows = rows; tasksState.err = ''; renderTasks(); })
      .catch(function (e) {
        tasksState.err = /unknown|action/i.test(e.message) ? 'The task list needs the newest backend. In Apps Script: Deploy, Manage deployments, edit, New version, Deploy.' : e.message;
        $('#tasks').innerHTML = '<div class="empty err">' + esc(tasksState.err) + '</div>';
      });
  }
  function taskFilter(tab) {
    var mine = myName();
    return (tasksState.rows || []).filter(function (t) {
      if (tasksState.who === 'me' && t.owner && ownerName(t.owner) !== mine) return false;
      var st = dueState(t);
      if (tab === 'done') return st === 'done';
      if (st === 'done') return false;
      if (tab === 'today') return st === 'today';
      if (tab === 'overdue') return st === 'overdue';
      if (tab === 'upcoming') return st === 'upcoming' || st === 'nodate';
      return true;
    }).sort(function (a, b) {
      return tab === 'done' ? String(b.done).localeCompare(String(a.done)) : (a.due || '9').localeCompare(b.due || '9');
    });
  }
  function renderTasks() {
    $$('#task-tabs [data-tt]').forEach(function (b) {
      var n = taskFilter(b.dataset.tt).length;
      b.classList.toggle('on', b.dataset.tt === tasksState.tab);
      b.innerHTML = esc(b.textContent.replace(/\s*\d+$/, '')) + (b.dataset.tt === 'done' ? '' : ' <span class="cnt">' + n + '</span>');
    });
    $('#task-who').value = tasksState.who;
    var list = taskFilter(tasksState.tab);
    var open = list.filter(function (t) { return !t.done && t.sid; });
    $('#task-start').disabled = !open.length;
    $('#task-start').textContent = open.length ? 'Start ' + open.length + ' task' + (open.length === 1 ? '' : 's') : 'Start tasks';
    $('#tasks').innerHTML = list.length ? '<div class="tlist">' + list.map(function (t) { return taskRowHtml(t, true); }).join('') + '</div>'
      : '<div class="empty">' + ({ today: 'Nothing due today.', overdue: 'Nothing overdue.', upcoming: 'Nothing coming up.', open: 'No open tasks.', done: 'Nothing completed in the last 30 days.' }[tasksState.tab]) + '</div>';
    taskBadge();
  }
  function taskBadge() {
    var n = tasksState.rows ? taskFilter('today').length + taskFilter('overdue').length : 0;
    $('#task-badge').hidden = !n; $('#task-badge').textContent = n;
  }
  $('#task-tabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tt]'); if (!b) return;
    tasksState.tab = b.dataset.tt; store('nsjw_ttab', tasksState.tab); renderTasks();
  });
  $('#task-who').addEventListener('change', function () { tasksState.who = this.value; store('nsjw_twho', this.value); renderTasks(); });

  function findTask(row) {
    row = Number(row);
    return (tasksState.rows || []).filter(function (t) { return t.row === row; })[0] ||
      (current ? personTasks(current).filter(function (t) { return t.row === row; })[0] : null);
  }
  function afterTaskWrite() {
    tasksState.rows = null; leadsState.rows = null; todayState.data = null;
    if (current) { try { localStorage.removeItem(ckey('person', { sid: current.id })); } catch (e) {} }
  }
  function completeTask(t, done) {
    var call = t.row ? api('taskdone', { row: t.row, sid: t.sid, email: t.email, done: done }) : api('nextdone', { sid: t.sid, email: t.email });
    return call.then(function () { afterTaskWrite(); toast(done === false ? 'Reopened' : 'Task done'); });
  }
  function rescheduleTask(t, due) {
    return api('taskedit', { row: t.row, sid: t.sid, email: t.email, due: due }).then(function () { afterTaskWrite(); toast('Due ' + dayOnly(due)); });
  }
  function onTaskClick(e) {
    var b = e.target.closest('[data-tdone]'); if (!b) return false;
    var row = b.dataset.tdone, t = row ? findTask(row) : (current ? personTasks(current)[0] : null);
    if (!t) return true;
    b.disabled = true; b.classList.add('busy');
    completeTask(t, !t.done ? true : false).then(function () {
      if (location.hash.indexOf('#p/') === 0 && current) loadPerson(current.id, true); else loadTasks(true);
    }).catch(function (err) { toast(err.message); b.disabled = false; b.classList.remove('busy'); });
    return true;
  }
  function onTaskChange(e) {
    var s = e.target.closest('[data-tres]'); if (!s || !s.value) return;
    var t = findTask(s.dataset.tres); if (!t) return;
    s.disabled = true;
    rescheduleTask(t, s.value).then(function () {
      if (location.hash.indexOf('#p/') === 0 && current) loadPerson(current.id, true); else loadTasks(true);
    }).catch(function (err) { toast(err.message); s.disabled = false; });
  }
  $('#tasks').addEventListener('click', onTaskClick);
  $('#tasks').addEventListener('change', onTaskChange);
  $('#person').addEventListener('click', function (e) { onTaskClick(e); });
  $('#person').addEventListener('change', onTaskChange);

  // Start tasks: open each person in turn with Complete / Skip / Reschedule on top.
  $('#task-start').addEventListener('click', function () {
    var list = taskFilter(tasksState.tab).filter(function (t) { return !t.done && t.sid; });
    if (!list.length) return;
    run = { list: list, i: 0, done: 0 };
    goRun();
  });
  function goRun() {
    if (!run) return;
    if (run.i >= run.list.length) {
      toast('Finished: ' + run.done + ' done, ' + (run.list.length - run.done) + ' left open');
      run = null; renderRun(); location.hash = '#tasks'; return;
    }
    var t = run.list[run.i], h = '#p/' + encodeURIComponent(t.sid);
    if (location.hash === h) renderRun(); else location.hash = h;
  }
  function renderRun() {
    var bar = $('#runbar');
    if (!run || location.hash.indexOf('#p/') !== 0) { bar.hidden = true; return; }
    var t = run.list[run.i];
    bar.hidden = false;
    bar.innerHTML = '<div class="run-n">Task ' + (run.i + 1) + ' of ' + run.list.length + '</div>' +
      '<div class="run-t"><b>' + esc(t.text) + '</b><span class="muted"> · ' + esc(dueLabel(t)) + '</span></div>' +
      '<div class="run-b"><button type="button" class="btn primary" data-run="done">Complete</button>' +
      '<select data-run-res aria-label="Reschedule"><option value="">Reschedule</option>' + dueOptions(null, -1) + '</select>' +
      '<button type="button" class="btn" data-run="skip">Skip</button>' +
      '<button type="button" class="btn" data-run="exit">Exit</button></div>';
  }
  $('#runbar').addEventListener('click', function (e) {
    var b = e.target.closest('[data-run]'); if (!b || !run) return;
    var t = run.list[run.i];
    if (b.dataset.run === 'exit') { run = null; renderRun(); return; }
    if (b.dataset.run === 'skip') { run.i++; goRun(); return; }
    b.disabled = true;
    completeTask(t, true).then(function () { run.done++; run.i++; goRun(); }).catch(function (err) { toast(err.message); b.disabled = false; });
  });
  $('#runbar').addEventListener('change', function (e) {
    var s = e.target.closest('[data-run-res]'); if (!s || !s.value || !run) return;
    s.disabled = true;
    rescheduleTask(run.list[run.i], s.value).then(function () { run.i++; goRun(); }).catch(function (err) { toast(err.message); s.disabled = false; });
  });

  // Follow-up checkbox on notes and single emails (HubSpot's "Create a To-do").
  function addFollowUp(sid, email, text, due) {
    return api('note', { sid: sid, email: email || '', kind: 'next_step', text: text, due: due, owner: myName() })
      .then(function () { afterTaskWrite(); });
  }

  // ---------- Today ----------
  var todayState = { data: null, at: 0 };
  function loadToday(force) {
    var now = new Date();
    $('#today-date').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    var h = now.getHours();
    $('#today-hello').textContent = (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening') + (me && me.given_name ? ', ' + me.given_name : '');
    if (todayState.data && !force && Date.now() - todayState.at < 30000) { renderToday(); return; }
    if (!todayState.data) $('#today').innerHTML = '<div class="loading">Loading</div>';
    swr('today', null, function (d) { todayState.data = d; todayState.at = Date.now(); renderToday(); })
      .catch(function (e) { $('#today').innerHTML = '<div class="empty err">' + esc(e.message) + '</div>'; });
    loadTeaching();
    if (!tasksState.rows) api('tasks', {}).then(function (r) { tasksState.rows = r; taskBadge(); }).catch(function () {});
  }

  // ---------- Teaching: my week and subs ----------
  var teachState = null, viewAs = '', teacherList = null;
  function loadTeaching() {
    swr('myteaching', viewAs ? { as: viewAs } : null, function (d) {
      teachState = d;
      if (d.admin && !viewAs && d.teacher) teacherList = [d.teacher].concat(d.teachers || []);
      renderTeaching();
    }).catch(function () { teachState = null; renderTeaching(); });
  }
  // Ben (hello@) can see Today the way any teacher sees it.
  function viewAsBar(d) {
    if (!teacherList || !(d.admin || viewAs)) return '';
    var meEmail = teacherList[0].email;
    var pref = ['Joe Hartnett', 'Chris Bates'];
    var list = teacherList.slice(1).sort(function (a, b) {
      var ia = pref.indexOf(a.name), ib = pref.indexOf(b.name);
      return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib) || a.name.localeCompare(b.name);
    });
    return '<div class="viewas"><span>View Today as</span>' +
      '<button type="button" class="chip' + (!viewAs ? ' on' : '') + '" data-viewas="">Me</button>' +
      list.slice(0, 2).map(function (t) { return '<button type="button" class="chip' + (viewAs === t.email ? ' on' : '') + '" data-viewas="' + esc(t.email) + '">' + esc(t.first || t.name) + '</button>'; }).join('') +
      '<select class="field inline" data-viewas-sel><option value="">Other teacher</option>' + list.slice(2).map(function (t) {
        return '<option value="' + esc(t.email) + '"' + (viewAs === t.email ? ' selected' : '') + '>' + esc(t.name) + '</option>';
      }).join('') + '</select></div>' +
      (viewAs ? '<p class="muted small viewas-note">You are seeing what ' + esc((teacherList.filter(function (t) { return t.email === viewAs; })[0] || {}).name || viewAs) + ' sees in Your teaching. Sub requests you send here go out in their name.</p>' : '');
  }
  function setViewAs(v) { viewAs = v || ''; teachState = null; renderTeaching(); loadTeaching(); }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-viewas]'); if (b) setViewAs(b.dataset.viewas);
  });
  document.addEventListener('change', function (e) {
    if (e.target.matches && e.target.matches('[data-viewas-sel]')) setViewAs(e.target.value);
  });
  function subWhen(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s.date || '')), d = m ? new Date(+m[1], m[2] - 1, +m[3]) : null;
    return (d ? d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : s.date) + (s.time ? ' · ' + s.time : '');
  }
  function subStatus(s) {
    if (s.status === 'Covered') return '<span class="pill good">Covered by ' + esc(String(s.coveredBy || '').replace(/\s*<.*$/, '')) + '</span>';
    return '<span class="pill warn">Waiting on ' + s.asked.length + (s.asked.length === 1 ? ' teacher' : ' teachers') + '</span>';
  }
  function renderTeaching() {
    var box = $('#teaching'); if (!box) return;
    var d = teachState, html = '';
    if (!d) { box.innerHTML = viewAs ? viewAsBar({ admin: true }) + '<div class="loading">Loading</div>' : ''; return; }
    html += viewAsBar(d);
    if (!d.teacher && !(d.allSubs || []).length) { box.innerHTML = html; return; }
    if (d.teacher && (d.events || []).length) html += calendarHtml(d.events, d.mine || []);
    if (d.teacher && (d.groups.length || d.lessons.length || d.mine.length || d.asked.length)) {
      var rows = d.groups.map(function (g) {
        return '<div class="card teach-row"><div class="who"><div class="line1"><a class="name" href="#g/' + encodeURIComponent(g.name) + '">' + esc(g.name) + '</a></div>' +
          '<div class="sub">' + esc([g.schedule, g.members ? g.members + ' people' : '', g.when === 'Upcoming' ? 'Starts soon' : ''].filter(Boolean).join(' · ')) + '</div></div>' +
          '<button type="button" class="btn small" data-subfor="' + esc(g.name) + '" data-subtime="' + esc(String(g.schedule || '').split(' · ')[0]) + '">Need a sub</button></div>';
      }).concat(d.lessons.map(function (l) {
        var label = 'Lesson with ' + l.name;
        return '<div class="card teach-row"><div class="who"><div class="line1"><a class="name" href="#p/' + encodeURIComponent(l.sid) + '">' + esc(label) + '</a></div>' +
          '<div class="sub">' + esc([l.when, l.instrument, l.frequency, l.stage === 'Scheduling' ? 'Scheduling' : ''].filter(Boolean).join(' · ')) + '</div></div>' +
          '<button type="button" class="btn small" data-subfor="' + esc(label) + '" data-subtime="' + esc(l.when || '') + '">Need a sub</button></div>';
      }));
      html += '<div class="sec-h"><h3>Your groups and lessons</h3></div>' + (rows.length ? '<div class="list">' + rows.join('') + '</div>' : '<div class="empty small-empty">No groups or lessons with your name on them yet.</div>');
      if (d.asked.length) {
        html += '<div class="sec-h"><h3>Can you cover?</h3></div><div class="list">' + d.asked.map(function (s) {
          var open = s.status === 'Open';
          return '<div class="card teach-row"><div class="who"><div class="line1"><span class="name">' + esc(s.cls) + '</span></div>' +
            '<div class="sub">' + esc(subWhen(s)) + ' · for ' + esc(s.teacher) + '</div>' + (s.note ? '<div class="meta">' + esc(s.note) + '</div>' : '') +
            (open ? '' : '<div class="pills">' + subStatus(s) + '</div>') + '</div>' +
            (open && !viewAs ? '<button type="button" class="btn primary small" data-subtake="' + esc(s.id) + '">I can cover it</button>' : '') + '</div>';
        }).join('') + '</div>';
      }
      if (d.mine.length) {
        html += '<div class="sec-h"><h3>Your sub requests</h3></div><div class="list">' + d.mine.map(function (s) {
          return '<div class="card teach-row"><div class="who"><div class="line1"><span class="name">' + esc(s.cls) + '</span></div>' +
            '<div class="sub">' + esc(subWhen(s)) + '</div><div class="pills">' + subStatus(s) + '</div></div>' +
            '<button type="button" class="linkish small" data-subcancel="' + esc(s.id) + '">Cancel</button></div>';
        }).join('') + '</div>';
      }
    }
    if (d.admin && (d.allSubs || []).length) {
      html += '<div class="sec-h"><h3>Subs · ' + d.allSubs.length + '</h3></div><div class="list">' + d.allSubs.map(function (s) {
        return '<div class="card teach-row"><div class="who"><div class="line1"><span class="name">' + esc(s.cls) + '</span></div>' +
          '<div class="sub">' + esc(subWhen(s)) + ' · ' + esc(s.teacher) + ' is out</div><div class="pills">' + subStatus(s) + '</div>' +
          (s.status === 'Covered' ? '<div class="meta">Change the teacher on this event in MMS</div>' : '') + '</div></div>';
      }).join('') + '</div>';
    }
    box.innerHTML = html;
  }
  // Next four weeks of the teacher's MMS calendar: a week grid on desktop, a day list on phones.
  function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function clock(d) { var h = d.getHours(), m = d.getMinutes(); return (h % 12 || 12) + (m ? ':' + ('0' + m).slice(-2) : '') + (h < 12 ? 'am' : 'pm'); }
  function calendarHtml(events, mine) {
    var byDay = {};
    events.forEach(function (e) { var d = parse(e.start); if (!d || isNaN(d)) return; (byDay[ymd(d)] = byDay[ymd(d)] || []).push(e); });
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    var html = '<div class="sec-h"><h3>Your calendar</h3><span class="muted small">Next 4 weeks, from MMS</span></div><div class="cal">';
    for (var w = 0; w < 4; w++) {
      var ws = new Date(monday); ws.setDate(monday.getDate() + w * 7);
      var label = w === 0 ? 'This week' : w === 1 ? 'Next week' : 'Week of ' + ws.toLocaleDateString([], { month: 'short', day: 'numeric' });
      html += '<div class="wk"><div class="wk-h">' + label + '</div><div class="wk-days">';
      for (var i = 0; i < 7; i++) {
        var day = new Date(ws); day.setDate(ws.getDate() + i);
        var key = ymd(day), evs = byDay[key] || [], past = day < today;
        html += '<div class="day' + (evs.length ? '' : ' noev') + (key === ymd(today) ? ' today' : '') + (past ? ' past' : '') + '">' +
          '<div class="day-h"><span>' + day.toLocaleDateString([], { weekday: 'short' }) + '</span> <b>' + day.getDate() + '</b>' +
          (day.getDate() === 1 || (w === 0 && i === 0) ? ' <span>' + day.toLocaleDateString([], { month: 'short' }) + '</span>' : '') + '</div>' +
          evs.map(function (e) {
            var st = parse(e.start), en = new Date(st.getTime() + (e.mins || 60) * 60000), time = clock(st) + ' to ' + clock(en);
            var sub = mine.filter(function (x) { return x.date === key && x.cls === e.title; })[0];
            return '<button type="button" class="ev' + (e.kind === 'Private Lesson' ? ' lesson' : '') + '"' + (past ? ' disabled' : '') +
              ' data-subfor="' + esc(e.title) + '" data-subtime="' + esc(time) + '" data-subdate="' + key + '">' +
              '<span class="ev-t">' + esc(clock(st)) + '</span><span class="ev-n">' + esc(e.title) + '</span>' +
              '<span class="ev-m">' + esc([e.people ? e.people + (e.people === 1 ? ' person' : ' people') : '', e.place].filter(Boolean).join(' · ')) + '</span>' +
              (sub ? '<span class="ev-sub' + (sub.status === 'Covered' ? ' ok' : '') + '">' + (sub.status === 'Covered' ? 'Sub: ' + esc(String(sub.coveredBy || '').replace(/\s*<.*$/, '')) : 'Sub requested') + '</span>' : '') +
              '</button>';
          }).join('') + '</div>';
      }
      html += '</div></div>';
    }
    return html + '</div><p class="muted small cal-hint">Tap a class or lesson to ask for a sub.</p>';
  }
  function openSub(cls, time, date) {
    var d = teachState; if (!d || !d.teacher) return;
    $('#sub-title').textContent = 'Need a sub: ' + cls;
    $('#sub-cls').value = cls; $('#sub-time').value = time || ''; $('#sub-date').value = date || ''; $('#sub-note').value = '';
    $('#sub-err').textContent = '';
    $('#sub-to').innerHTML = d.teachers.map(function (t) {
      return '<label class="checkline"><input type="checkbox" value="' + esc(t.email) + '"> ' + esc(t.name) + '</label>';
    }).join('');
    $('#sub-sheet').hidden = false;
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-subfor]');
    if (b) { openSub(b.dataset.subfor, b.dataset.subtime, b.dataset.subdate); return; }
    var tk = e.target.closest('[data-subtake]');
    if (tk) {
      tk.disabled = true;
      api('subtake', { id: tk.dataset.subtake }).then(function (r) { toast(r.msg); loadTeaching(); })
        .catch(function (err) { toast(err.message); tk.disabled = false; });
      return;
    }
    var cx = e.target.closest('[data-subcancel]');
    if (cx) {
      if (cx.dataset.sure !== '1') { cx.dataset.sure = '1'; cx.textContent = 'Tap again to cancel'; return; }
      api('subcancel', { id: cx.dataset.subcancel }).then(function () { toast('Cancelled. We let everyone know.'); loadTeaching(); })
        .catch(function (err) { toast(err.message); });
    }
  });
  $('#sub-cancel').addEventListener('click', function () { $('#sub-sheet').hidden = true; });
  $('#sub-sheet').addEventListener('click', function (e) { if (e.target === this) this.hidden = true; });
  $('#sub-all').addEventListener('click', function () {
    var boxes = $$('#sub-to input'), all = boxes.every(function (x) { return x.checked; });
    boxes.forEach(function (x) { x.checked = !all; });
  });
  $('#sub-send').addEventListener('click', function () {
    var to = $$('#sub-to input').filter(function (x) { return x.checked; }).map(function (x) { return x.value; });
    var date = $('#sub-date').value;
    if (!date) { $('#sub-err').textContent = 'Pick the date you need covered.'; return; }
    if (!to.length) { $('#sub-err').textContent = 'Pick at least one teacher to ask.'; return; }
    var btn = this; btn.disabled = true; btn.textContent = 'Sending';
    api('subrequest', { as: viewAs || undefined, cls: $('#sub-cls').value, date: date, time: $('#sub-time').value, note: $('#sub-note').value, to: to }).then(function (r) {
      $('#sub-sheet').hidden = true; toast('Asked ' + r.asked + (r.asked === 1 ? ' teacher' : ' teachers') + '. You will get an email when someone says yes.');
      loadTeaching();
    }).catch(function (err) { $('#sub-err').textContent = err.message; })
      .then(function () { btn.disabled = false; btn.textContent = 'Send request'; });
  });
  function todayRow(l, line) {
    var bits = [l.instruments.join(', '), l.interests.join(', ')].filter(Boolean).join(' · ');
    return '<a class="card lead-row" href="#p/' + encodeURIComponent(l.id) + '"><span class="lz ' + (l.next ? urgency(l) : 'none') + '"></span>' +
      '<div class="who"><div class="line1"><span class="name">' + esc(l.name) + '</span>' + statusPill(l.stage) + '</div>' +
      (bits ? '<div class="sub">' + esc(bits) + '</div>' : '') + line + '</div></a>';
  }
  function section(title, count, link, body) {
    return '<div class="sec-h"><h3>' + esc(title) + (count ? ' · ' + count : '') + '</h3>' + (link ? '<a href="' + link + '">All</a>' : '') + '</div>' + body;
  }
  function numbersHtml(n) {
    if (!n) return '';
    var p = n.programs, ago = n.monthAgo;
    function tile(label, v, was) {
      var delta = '';
      if (ago && was != null && was !== '') { var x = v - was; delta = '<div class="dl">' + (x > 0 ? '+' : '') + x + ' in a month</div>'; }
      return '<div class="stat"><div class="n">' + v + '</div><div class="l">' + label + '</div>' + delta + '</div>';
    }
    var tracking = n.historyFrom && (Date.now() - parse(n.historyFrom)) < 31 * 864e5;
    return '<div class="sec-h"><h3>Active students · ' + n.active + '</h3></div>' +
      '<div class="stats">' +
        tile('Ensembles', p.ensembles, ago && ago.ensembles) + tile('Private lessons', p.lessons, ago && ago.lessons) +
        tile('Classes', p.classes, ago && ago.classes) + tile('Clinics', p.clinics, ago && ago.clinics) +
      '</div>' +
      '<div class="stats inout">' +
        '<div class="stat"><div class="n">+' + n.month.joined + '</div><div class="l">Joined this month</div></div>' +
        '<div class="stat"><div class="n">' + (n.month.left ? '&minus;' : '') + n.month.left + '</div><div class="l">Left this month</div>' +
          (tracking ? '<div class="dl">Counting from ' + esc(dayOnly(n.historyFrom)) + '</div>' : '') + '</div>' +
      '</div>';
  }

  function renderToday() {
    var d = todayState.data, html = '';
    html += numbersHtml(d.numbers);
    html += section('Follow up today', d.followCount, '#leads', d.follow.length ? '<div class="list">' + d.follow.map(function (l) {
      return todayRow(l, '<div class="nx ' + urgency(l) + '">' + esc(l.next.text) + ' · ' + (urgency(l) === 'overdue' ? 'was due ' : 'due ') + esc(dayOnly(l.next.due)) + (l.next.owner ? ' · ' + esc(l.next.owner) : '') + '</div>');
    }).join('') + '</div>' : '<div class="empty small-empty">Nothing due. Set next steps on leads and they show up here.</div>');
    html += section('New sign-ups, not contacted yet', d.freshCount, '', d.fresh.length ? '<div class="list">' + d.fresh.map(function (l) {
      return todayRow(l, '<div class="meta">Signed up ' + esc(when(l.started)) + (l.source ? ' · via ' + esc(l.source) : '') + '</div>');
    }).join('') + '</div>' : '<div class="empty small-empty">No new sign-ups waiting.</div>');
    if (d.deposits.length) {
      html += section('Deposits to place', d.deposits.length, '', '<div class="list">' + d.deposits.map(function (l) {
        return todayRow(l, '<div class="meta">Paid a deposit. Find them a group.</div>');
      }).join('') + '</div>');
    }
    html += section('Open seats with people who could fill them', '', '#groups', d.seats.length ? '<div class="list">' + d.seats.map(function (g) {
      return '<a class="card group-row" href="#g/' + encodeURIComponent(g.name) + '"><div class="line1"><span class="name">' + esc(g.name) + '</span>' +
        '<span class="count">' + g.matches + (g.matches === 1 ? ' match' : ' matches') + '</span></div>' +
        '<div class="sub">' + esc([g.schedule, g.teacher].filter(Boolean).join(' · ')) + '</div>' +
        '<div class="pills"><span class="pill open">Open: ' + esc(openText(g.open)) + '</span></div>' +
        (g.bySeat ? '<div class="meta">' + esc('Could fill it: ' + Object.keys(g.bySeat).map(function (k) { return k + ' ' + g.bySeat[k]; }).join(' · ')) + '</div>' : '') + '</a>';
    }).join('') + '</div>' : '<div class="empty small-empty">Every group is full.</div>');
    if (d.billing && d.billing.length) {
      html += section('Billing to check', d.billing.length, '', '<p class="muted small">From last night\'s check of MMS. Nothing was changed.</p><div class="list">' + d.billing.slice(0, 12).map(function (b) {
        return '<a class="card" href="#p/' + encodeURIComponent(b.id) + '"><div class="line1"><span class="name">' + esc(b.name) + '</span><span class="pill warn">' + esc(b.problem) + '</span></div><div class="meta">' + esc(b.detail) + '</div></a>';
      }).join('') + '</div>');
    }
    $('#today').innerHTML = '<div id="teaching"></div>' + html;
    renderTeaching();
  }

  // ---------- Leads ----------
  var LEAD = {
    stages: ['First Contact', 'Qualified', 'Committed', 'Nurture', 'Closed'],
    interests: ['Ensemble', 'Private lessons', 'Foundations', 'Classes', 'Clinics', 'Voice'],
    nights: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    instruments: ['Sax', 'Trumpet', 'Trombone', 'Flute', 'Piano/Keys', 'Guitar', 'Bass', 'Drums', 'Voice', 'Violin', 'French Horn', 'Harmonica']
  };
  // Old tag names, read as the new stages.
  var LEGACY = { 'New Lead': 'First Contact', 'Deposit Submitted': 'Committed', 'Ready to Join': 'Committed' };
  function tagStage(tags, status) {
    var t = ((tags || []).filter(function (x) { return /^Stage: /.test(x); })[0] || '').slice(7);
    return LEGACY[t] || t || (status === 'Active' ? '' : status === 'Inactive' ? 'Closed' : 'First Contact');
  }
  var leadsState = { track: store('nsjw_ltrack') || '', mode: store('nsjw_lmode') || 'board', enrolled: [], stale: {}, boardDays: 60, rows: null, view: store('nsjw_lview') || 'action', stage: '', q: '', show: 60,
    f: (function () { try { return JSON.parse(store('nsjw_lf') || '{}'); } catch (e) { return {}; } })() };

  function today0() { return new Date(new Date().toDateString()); }
  function urgency(l) {
    if (!l.next) return 'none';
    if (!l.next.due) return 'later';
    var d = parse(l.next.due), t = today0();
    if (d < t) return 'overdue';
    if (d.getTime() === t.getTime()) return 'today';
    return 'later';
  }
  function allInterests(l) { return l.interests.length ? l.interests : l.formInterests; }
  function allInstruments(l) { return l.instruments.length ? l.instruments : l.formInstruments; }

  function loadLeads(force) {
    if (leadsState.rows && !force) { renderLeads(); return; }
    $('#lead-list').innerHTML = $('#lead-board').innerHTML = '<div class="loading">Loading</div>';
    swr('leads', null, function (d) {
      leadsState.rows = d.leads; leadsState.enrolled = d.enrolled || [];
      leadsState.stale = d.stale || {}; leadsState.boardDays = d.boardDays || 60; renderLeads();
    }).catch(function (e) { $('#lead-list').innerHTML = $('#lead-board').innerHTML = '<div class="empty err">' + esc(e.message) + '</div>'; });
  }

  function leadMatches(l) {
    var f = leadsState.f;
    function any(sel, have) { return !sel || !sel.length || sel.some(function (x) { return have.indexOf(x) >= 0; }); }
    if (!any(f.Interest, allInterests(l))) return false;
    if (!any(f.Instrument, allInstruments(l))) return false;
    if (!any(f.Nights, l.nights)) return false;
    if (f['Next step'] && f['Next step'].length) {
      var u = urgency(l), map = { Overdue: 'overdue', 'Due today': 'today', 'Scheduled': 'later', 'None': 'none' };
      if (!f['Next step'].some(function (x) { return map[x] === u; })) return false;
    }
    if (leadsState.q) {
      var hay = [l.name, l.email, l.phone, allInstruments(l).join(' '), l.form.instrument].join(' ').toLowerCase();
      if (hay.indexOf(leadsState.q) < 0) return false;
    }
    return true;
  }

  function renderLeads() {
    var board = leadsState.mode === 'board';
    $('#lead-board-wrap').hidden = !board; $('#lead-list-wrap').hidden = board;
    $$('#lead-mode .tab').forEach(function (t) { t.classList.toggle('on', t.dataset.mode === leadsState.mode); });
    if (board) { renderBoard(); return; }
    var all = (leadsState.rows || []).filter(leadMatches);
    var month = new Date(); month.setDate(1); month = new Date(month.toDateString());
    var counts = {};
    all.forEach(function (l) { counts[l.stage] = (counts[l.stage] || 0) + 1; });
    $('#stagebar').innerHTML = LEAD.stages.map(function (s) {
      return '<button type="button" class="stagechip' + (leadsState.stage === s ? ' on' : '') + '" data-stage="' + esc(s) + '">' +
        '<b>' + (counts[s] || 0) + '</b><span>' + esc(s) + '</span></button>';
    }).join('');
    var rows = all.filter(function (l) {
      if (leadsState.stage) return l.stage === leadsState.stage;
      if (l.stage === 'Closed' || l.stage === 'Enrolled') return false;
      var u = urgency(l);
      if (leadsState.view === 'action') return u === 'overdue' || u === 'today' || (u === 'none' && !l.notes && l.started && parse(l.started) >= new Date(Date.now() - 30 * 864e5)) || (l.stage === 'Committed' && u === 'none');
      if (leadsState.view === 'new') return l.started && parse(l.started) >= month;
      if (leadsState.view === 'nonext') return u === 'none' && l.stage !== 'Nurture';
      return true;
    });
    var rank = { overdue: 0, today: 1, none: 2, later: 3 };
    rows.sort(function (a, b) {
      return (rank[urgency(a)] - rank[urgency(b)]) || String(b.started).localeCompare(String(a.started));
    });
    $$('#lead-views .chip').forEach(function (c) { c.classList.toggle('on', !leadsState.stage && c.dataset.view === leadsState.view); });
    var active = [];
    Object.keys(leadsState.f).forEach(function (k) { (leadsState.f[k] || []).forEach(function (v) { active.push([k, v]); }); });
    $('#lead-active').innerHTML = active.map(function (a) {
      return '<button type="button" class="chip on" data-rm="' + esc(a[0]) + '|' + esc(a[1]) + '">' + esc(a[1]) + ' &times;</button>';
    }).join('');
    $('#lead-filter-btn').textContent = active.length ? 'Filter · ' + active.length : 'Filter';
    $('#leads-sum').textContent = rows.length + (rows.length === 1 ? ' lead' : ' leads') +
      (leadsState.stage ? ' in ' + leadsState.stage : '') + ' · ' + all.length + ' open in total';
    if (useGrid()) {
      $('#lead-more').hidden = true; $('#lead-list').classList.remove('list'); $('#lead-list').classList.add('g-host');
      NSJWGrid.leads($('#lead-list'), rows.map(function (l) {
        return { id: l.id, name: l.name, email: l.email, phone: l.phone, status: l.status, stage: l.stage, urgency: urgency(l),
          nextText: l.next ? l.next.text : '', nextDue: l.next ? l.next.due : '', interests: l.interests.slice(), formInterests: l.formInterests,
          instruments: l.instruments.slice(), formInstruments: l.formInstruments, nights: l.nights.slice(), started: l.started,
          lastContact: l.lastContact, source: l.form.source || '' };
      }), gridHooks({ colsBtn: $('#lcols'), keepLeads: true,
        source: function (id) { return (leadsState.rows || []).filter(function (x) { return x.id === id; })[0]; } }));
      return;
    }
    if (!rows.length) { $('#lead-list').innerHTML = '<div class="empty">No one here. Try another view or clear a filter.</div>'; $('#lead-more').hidden = true; return; }
    $('#lead-list').innerHTML = rows.slice(0, leadsState.show).map(function (l) {
      var u = urgency(l);
      var bits = [allInstruments(l).join(', '), allInterests(l).join(', '), l.nights.join(' ')].filter(Boolean).join(' · ');
      var nx = l.next ? '<div class="nx ' + u + '">' + esc(l.next.text) + (l.next.due ? ' · ' + (u === 'overdue' ? 'was due ' : 'due ') + esc(dayOnly(l.next.due)) : '') + (l.next.owner ? ' · ' + esc(l.next.owner) : '') + '</div>'
        : '<div class="nx none">No next step</div>';
      var meta = [l.started ? 'Signed up ' + when(l.started) : '', l.lastContact ? 'last note ' + when(l.lastContact) : 'never contacted', l.form.source ? 'via ' + l.form.source : ''].filter(Boolean).join(' · ');
      return '<a class="card lead-row" href="#p/' + encodeURIComponent(l.id) + '">' + pickBox(l.id, l.name) +
        '<span class="lz ' + u + '" aria-label="' + u + '"></span>' +
        '<div class="who"><div class="line1"><span class="name">' + esc(l.name) + '</span>' + statusPill(l.stage) + '</div>' +
        (bits ? '<div class="sub">' + esc(bits) + '</div>' : '') + nx + '<div class="meta">' + esc(meta) + '</div></div></a>';
    }).join('');
    $('#lead-more').hidden = rows.length <= leadsState.show;
  }


  // ---------- Board ----------
  var COLS = ['First Contact', 'Qualified', 'Committed', 'Enrolled'];
  var COMMIT = { Ensemble: 'Deposit', Lessons: 'Lesson package', Class: 'Registered' };
  var TRACK = { Ensemble: 'Ensemble', Lessons: 'Private lessons', Class: 'Class' };
  function daysSince(d) { return d ? Math.floor((today0() - parse(d)) / 864e5) : null; }
  function onBoard(l) {
    if (COLS.indexOf(l.stage) < 0 || l.stage === 'Enrolled') return false;
    if (l.stage !== 'First Contact' || l.next) return true;
    var fresh = [l.started, l.lastContact, l.stageAt].some(function (d) { var n = daysSince(d); return n != null && n <= leadsState.boardDays; });
    return fresh;
  }
  function stale(l) {
    var lim = leadsState.stale[l.stage]; if (!lim) return false;
    if (urgency(l) === 'overdue') return true;
    if (l.next && urgency(l) !== 'none') return false;
    var since = [l.stageAt, l.lastContact, l.started].map(daysSince).filter(function (n) { return n != null; });
    return since.length && Math.min.apply(null, since) > lim;
  }
  function card(l) {
    var u = urgency(l), st = stale(l), inStage = daysSince(l.stageAt || l.started);
    var tr = (l.tracks || []).map(function (t) { return t === 'Classes' ? 'Class' : t; }).join(' + ') || 'Undecided';
    var bits = [tr, allInstruments(l).join(', ')].filter(Boolean).join(' · ');
    var nx = l.next ? '<div class="nx ' + u + '">' + esc(l.next.text) + (l.next.due ? ' · ' + esc(dayOnly(l.next.due)) : '') + '</div>' : '<div class="nx none">No next step</div>';
    var tag = l.stage === 'Committed' && COMMIT[l.track] ? '<span class="pill">' + COMMIT[l.track] + '</span>' : '';
    return '<div class="kcard card' + (st ? ' stale' : '') + '" draggable="true" data-id="' + esc(l.id) + '" tabindex="0">' +
      '<div class="line1"><span class="name">' + esc(l.name) + '</span>' + tag + '</div>' +
      (bits ? '<div class="sub">' + esc(bits) + '</div>' : '') + nx +
      '<div class="meta">' + (inStage != null ? inStage + (inStage === 1 ? ' day' : ' days') + ' here' : '') +
      (l.lastContact ? ' · last contact ' + esc(when(l.lastContact)) : ' · not contacted') + (l.repliedAt ? ' · replied ' + esc(when(l.repliedAt)) : '') + (st ? ' · stalled' : '') + '</div></div>';
  }
  function trackOk(l) {
    var t = leadsState.track; if (!t) return true;
    var have = l.tracks || [];
    return t === 'Undecided' ? !have.length : have.indexOf(t) >= 0;
  }
  function renderBoard() {
    var all = (leadsState.rows || []).filter(leadMatches).filter(trackOk);
    $('#board-tracks').innerHTML = [['', 'All'], ['Ensemble', 'Ensemble'], ['Private lessons', 'Private lessons'], ['Classes', 'Class'], ['Undecided', 'Undecided']].map(function (t) {
      var n = (leadsState.rows || []).filter(leadMatches).filter(function (l) { var x = leadsState.track; leadsState.track = t[0]; var ok = trackOk(l) && onBoard(l); leadsState.track = x; return ok; }).length;
      return '<button type="button" class="chip' + (leadsState.track === t[0] ? ' on' : '') + '" data-trk="' + esc(t[0]) + '">' + esc(t[1]) + ' · ' + n + '</button>';
    }).join('');
    var live = all.filter(onBoard), older = all.filter(function (l) { return l.stage === 'First Contact' && !onBoard(l); });
    var by = {}; COLS.forEach(function (c) { by[c] = []; });
    live.forEach(function (l) { by[l.stage].push(l); });
    COLS.slice(0, 3).forEach(function (c) {
      by[c].sort(function (a, b) { return (stale(b) - stale(a)) || String(b.stageAt || b.started).localeCompare(String(a.stageAt || a.started)); });
    });
    var q = leadsState.q;
    var enr = leadsState.enrolled.filter(function (e) { return !q || (e.name + ' ' + e.instruments.join(' ')).toLowerCase().indexOf(q) >= 0; });
    $('#lead-board').innerHTML = COLS.map(function (c) {
      var list = c === 'Enrolled' ? enr : by[c];
      var n = list.length, red = c === 'Enrolled' ? 0 : list.filter(stale).length;
      var body = c === 'Enrolled' ? list.map(function (e) {
        return '<a class="kcard card done" href="#p/' + encodeURIComponent(e.id) + '"><div class="line1"><span class="name">' + esc(e.name) + '</span></div>' +
          '<div class="sub">' + esc(e.programs.join(', ') || e.instruments.join(', ')) + '</div><div class="meta">' + esc(when(e.at)) + '</div></a>';
      }).join('') : list.map(card).join('');
      return '<section class="kcol" data-col="' + esc(c) + '"><header class="kh"><span class="kt">' + esc(c) + '</span>' +
        (n ? '<button type="button" class="kmail" data-colmail="' + esc(c) + '" title="Email everyone in this column">Email</button>' : '') + '<span class="kn">' + n +
        (red ? ' · <em>' + red + ' stalled</em>' : '') + '</span>' + (c === 'Enrolled' ? '<span class="kx">last 30 days</span>' : c === 'Committed' ? '<span class="kx">deposit, package or registration</span>' : '') + '</header>' +
        '<div class="kbody">' + (body || '<div class="kempty">Nothing here</div>') + '</div></section>';
    }).join('');
    var nur = all.filter(function (l) { return l.stage === 'Nurture'; }).length, lost = all.filter(function (l) { return l.stage === 'Closed'; }).length;
    $('#board-foot').innerHTML = 'Not on the board: <button type="button" class="linkish" data-goto="older">' + older.length + ' older first contacts</button> (no activity in ' + leadsState.boardDays + ' days), ' +
      '<button type="button" class="linkish" data-goto="Nurture">' + nur + ' in Nurture</button>, <button type="button" class="linkish" data-goto="Closed">' + lost + ' lost</button>.';
  }
  $('#board-tracks').addEventListener('click', function (e) {
    var b = e.target.closest('[data-trk]'); if (!b) return;
    leadsState.track = b.dataset.trk; store('nsjw_ltrack', leadsState.track); renderBoard();
  });
  $('#lead-mode').addEventListener('click', function (e) {
    var b = e.target.closest('[data-mode]'); if (!b) return;
    leadsState.mode = b.dataset.mode; store('nsjw_lmode', leadsState.mode); renderLeads();
  });
  $('#board-foot').addEventListener('click', function (e) {
    var b = e.target.closest('[data-goto]'); if (!b) return;
    leadsState.mode = 'list'; leadsState.view = 'all'; leadsState.stage = b.dataset.goto === 'older' ? 'First Contact' : b.dataset.goto; leadsState.show = 60;
    store('nsjw_lmode', 'list'); renderLeads();
  });

  // Moving a card: drag on a computer, tap and pick on a phone.
  var fine = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches, dragId = null, moving = null;
  function leadById(id) { return (leadsState.rows || []).filter(function (l) { return l.id === id; })[0]; }
  function moveLead(l, to, reason) {
    if (!l || l.stage === to) return;
    if (to === 'Enrolled') { pendingPlace = l.id; location.hash = '#p/' + encodeURIComponent(l.id); return; }
    var was = { stage: l.stage, stageAt: l.stageAt };
    l.stage = to; l.stageAt = new Date().toISOString().slice(0, 10); renderLeads();
    api('leadtag', { sid: l.id, email: l.email, field: 'stage', value: to, on: true, reason: reason || '' })
      .then(function () { toast(l.name + ' moved to ' + (to === 'Closed' ? 'Lost' : to)); todayState.data = null; })
      .catch(function (err) { l.stage = was.stage; l.stageAt = was.stageAt; renderLeads(); toast(err.message); });
  }
  var board = $('#lead-board');
  board.addEventListener('dragstart', function (e) {
    var c = e.target.closest('.kcard[data-id]'); if (!c) return;
    dragId = c.dataset.id; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragId); } catch (x) {}
  });
  board.addEventListener('dragend', function () { dragId = null; $$('.kcol.over, .kcard.dragging').forEach(function (x) { x.classList.remove('over', 'dragging'); }); });
  board.addEventListener('dragover', function (e) {
    var col = e.target.closest('.kcol'); if (!col || !dragId) return;
    e.preventDefault(); $$('.kcol.over').forEach(function (x) { if (x !== col) x.classList.remove('over'); }); col.classList.add('over');
  });
  board.addEventListener('drop', function (e) {
    var col = e.target.closest('.kcol'); if (!col || !dragId) return;
    e.preventDefault(); col.classList.remove('over'); moveLead(leadById(dragId), col.dataset.col);
  });
  board.addEventListener('click', function (e) {
    var c = e.target.closest('.kcard[data-id]'); if (!c) return;
    if (fine) { location.hash = '#p/' + encodeURIComponent(c.dataset.id); return; }
    openMove(leadById(c.dataset.id));
  });
  board.addEventListener('keydown', function (e) {
    var c = e.target.closest('.kcard[data-id]'); if (c && e.key === 'Enter') openMove(leadById(c.dataset.id));
  });
  var REASONS = ['Timing', 'Price', 'Schedule', 'Level', 'No reply', 'Went elsewhere'];
  function openMove(l) {
    if (!l) return; moving = l;
    $('#move-title').textContent = l.name;
    $('#move-sub').textContent = 'Now in ' + l.stage + '. Move to:';
    $('#move-opts').innerHTML = COLS.concat(['Nurture', 'Lost']).map(function (c) {
      var v = c === 'Lost' ? 'Closed' : c;
      return '<button type="button" class="btn' + (v === l.stage ? ' on' : '') + '" data-to="' + esc(v) + '"' + (v === l.stage ? ' disabled' : '') + '>' +
        esc(c === 'Enrolled' ? 'Enrolled (convert to member)' : c) + '</button>';
    }).join('');
    $('#move-tracks').innerHTML = trackChips(l.tracks || [], 'data-mtrack');
    $('#lost-box').hidden = true; $('#move-go').hidden = true;
    $('#lost-reasons').innerHTML = REASONS.map(function (r) { return '<button type="button" class="chip" data-r="' + esc(r) + '">' + esc(r) + '</button>'; }).join('');
    $('#lost-other').value = '';
    $('#move-open').href = '#p/' + encodeURIComponent(l.id);
    $('#move-sheet').hidden = false;
  }
  function closeMove() { $('#move-sheet').hidden = true; moving = null; }
  $('#move-opts').addEventListener('click', function (e) {
    var b = e.target.closest('[data-to]'); if (!b || !moving) return;
    if (b.dataset.to === 'Closed') { $('#lost-box').hidden = false; $('#move-go').hidden = false; return; }
    var l = moving; closeMove(); moveLead(l, b.dataset.to);
  });
  $('#move-tracks').addEventListener('click', function (e) {
    var b = e.target.closest('[data-mtrack]'); if (!b || !moving) return;
    var l = moving, v = b.dataset.mtrack, on = !b.classList.contains('on');
    b.disabled = true; b.classList.toggle('on', on);
    api('leadtag', { sid: l.id, email: l.email, field: 'interest', value: v, on: on }).then(function () {
      l.tracks = on ? (l.tracks || []).concat(v) : (l.tracks || []).filter(function (x) { return x !== v; });
      l.interests = on ? l.interests.concat(v) : l.interests.filter(function (x) { return x !== v; });
      b.disabled = false; renderLeads(); toast('Saved to MMS');
    }).catch(function (err) { b.classList.toggle('on', !on); b.disabled = false; toast(err.message); });
  });
  $('#lost-reasons').addEventListener('click', function (e) { var b = e.target.closest('[data-r]'); if (b) b.classList.toggle('on'); });
  $('#move-go').addEventListener('click', function () {
    var why = $$('#lost-reasons .chip.on').map(function (b) { return b.dataset.r; }).concat($('#lost-other').value.trim() ? [$('#lost-other').value.trim()] : []).join(', ');
    var l = moving; closeMove(); moveLead(l, 'Closed', why);
  });
  $('#move-cancel').addEventListener('click', closeMove);
  $('#move-open').addEventListener('click', function () { $('#move-sheet').hidden = true; });
  $('#move-sheet').addEventListener('click', function (e) { if (e.target === this) closeMove(); });

  $('#stagebar').addEventListener('click', function (e) {
    var b = e.target.closest('[data-stage]'); if (!b) return;
    leadsState.stage = leadsState.stage === b.dataset.stage ? '' : b.dataset.stage; leadsState.show = 60; renderLeads();
  });
  $('#lead-views').addEventListener('click', function (e) {
    var b = e.target.closest('.chip'); if (!b) return;
    leadsState.view = b.dataset.view; leadsState.stage = ''; leadsState.show = 60; store('nsjw_lview', leadsState.view); renderLeads();
  });
  $('#lq').addEventListener('input', function () { leadsState.q = this.value.trim().toLowerCase(); leadsState.show = 60; renderLeads(); });
  $('#lead-more').addEventListener('click', function () { leadsState.show += 60; renderLeads(); });
  $('#lead-active').addEventListener('click', function (e) {
    var b = e.target.closest('[data-rm]'); if (!b) return;
    var kv = b.dataset.rm.split('|');
    leadsState.f[kv[0]] = (leadsState.f[kv[0]] || []).filter(function (x) { return x !== kv[1]; });
    store('nsjw_lf', JSON.stringify(leadsState.f)); renderLeads();
  });

  var LF_GROUPS = [['Interest', LEAD.interests], ['Instrument', LEAD.instruments], ['Nights', LEAD.nights], ['Next step', ['Overdue', 'Due today', 'Scheduled', 'None']]];
  function renderFilterSheet() {
    $('#lf-groups').innerHTML = LF_GROUPS.map(function (g) {
      var sel = leadsState.f[g[0]] || [];
      return '<div class="lf"><div class="flabel">' + esc(g[0]) + '</div><div class="optgrid">' + g[1].map(function (v) {
        return '<button type="button" class="chip' + (sel.indexOf(v) >= 0 ? ' on' : '') + '" data-k="' + esc(g[0]) + '" data-v="' + esc(v) + '">' + esc(v) + '</button>';
      }).join('') + '</div></div>';
    }).join('');
  }
  $('#lead-filter-btn').addEventListener('click', function () { renderFilterSheet(); $('#lf-sheet').hidden = false; });
  $('#lf-groups').addEventListener('click', function (e) {
    var b = e.target.closest('[data-k]'); if (!b) return;
    var k = b.dataset.k, v = b.dataset.v, cur = leadsState.f[k] || [];
    leadsState.f[k] = cur.indexOf(v) >= 0 ? cur.filter(function (x) { return x !== v; }) : cur.concat(v);
    b.classList.toggle('on');
  });
  function closeLf() { $('#lf-sheet').hidden = true; store('nsjw_lf', JSON.stringify(leadsState.f)); leadsState.show = 60; renderLeads(); }
  $('#lf-done').addEventListener('click', closeLf);
  $('#lf-clear').addEventListener('click', function () { leadsState.f = {}; renderFilterSheet(); });
  $('#lf-sheet').addEventListener('click', function (e) { if (e.target === this) closeLf(); });

  // Funnel editor on the person page. Each tap writes an MMS tag.
  function funnelHtml(p) {
    if (!p.id) return '';
    var tags = p.tags || [];
    var stage = tagStage(tags, p.status);
    function grp(label, field, opts, have) {
      return '<div class="flabel">' + label + '</div><div class="optgrid">' + opts.map(function (v) {
        return '<button type="button" class="chip' + (have.indexOf(v) >= 0 ? ' on' : '') + '" data-lt="' + field + '" data-v="' + esc(v) + '">' + esc(v) + '</button>';
      }).join('') + '</div>';
    }
    var pick = function (pre) { return tags.filter(function (t) { return t.indexOf(pre) === 0; }).map(function (t) { return t.slice(pre.length); }); };
    return '<div class="funnel card"><div class="section-title" style="margin-top:0">Funnel</div>' +
      grp('Interested in · pick any', 'interest', LEAD.interests, pick('Interest: ')) +
      grp('Nights they can do', 'nights', LEAD.nights, pick('Nights: ')) +
      grp('Plays', 'instrument', LEAD.instruments, p.instruments || []) +
      (p.status === 'Active' ? '<button type="button" class="btn primary" data-place style="width:100%;margin-top:4px">Add to another group or lessons</button>' : '') +
      (p.programs || []).filter(function (g) { return /^Group \d+$/.test(g); }).map(function (g) {
        return '<button type="button" class="btn" data-cal="' + esc(g) + '" style="width:100%;margin-top:8px">Add to ' + esc(g) + ' rehearsals in MMS</button>';
      }).join('') +
      ((p.programs || []).length || p.status === 'Active' ? '<button type="button" class="btn" data-leave style="width:100%;margin-top:8px">Take out of a group or end membership</button>' : '') +
      '<p class="muted small" style="margin:10px 0 0">Each choice saves to MyMusicStaff as a tag.</p></div>';
  }

  function leadTag(field, value, on, btn) {
    if (!current || !current.id) return;
    if (btn) { btn.disabled = true; btn.classList.add('busy'); }
    return api('leadtag', { sid: current.id, email: current.email, field: field, value: value, on: on }).then(function () {
      var pre = { stage: 'Stage: ', interest: 'Interest: ', nights: 'Nights: ' }[field];
      if (field === 'instrument') {
        current.instruments = on ? current.instruments.concat(value) : current.instruments.filter(function (x) { return x !== value; });
      } else if (field === 'stage') {
        current.tags = current.tags.filter(function (t) { return !/^Stage: /.test(t); }).concat(value === 'First Contact' ? [] : ['Stage: ' + value]);
      } else {
        current.tags = on ? current.tags.concat(pre + value) : current.tags.filter(function (t) { return t !== pre + value; });
      }
      leadsState.rows = null; groupsState.rows = null; personSeq++;
      try { localStorage.removeItem(ckey('person', { sid: current.id })); } catch (e) {}
      toast(field === 'stage' ? 'Stage set to ' + value : 'Saved to MMS');
      var on = document.querySelector('#person .tab.on');
      renderPerson(current, on ? on.dataset.tab : 'timeline');
    }).catch(function (err) {
      toast(err.message);
      if (btn) { btn.disabled = false; btn.classList.remove('busy'); }
    });
  }

  $('#person').addEventListener('click', function (e) {
    var tk = e.target.closest('[data-track]');
    if (tk) { leadTag('interest', tk.dataset.track, !tk.classList.contains('on'), tk); return; }
    var sc = e.target.closest('[data-stage]');
    if (sc) { if (!sc.classList.contains('on')) leadTag('stage', sc.dataset.stage, true, sc); return; }
    var b = e.target.closest('[data-lt]');
    if (b) { leadTag(b.dataset.lt, b.dataset.v, !b.classList.contains('on'), b); return; }
    if (e.target.closest('[data-next-done]') && current) {
      var d = e.target.closest('[data-next-done]'); d.disabled = true;
      api('nextdone', { sid: current.id, email: current.email }).then(function () {
        toast('Done'); leadsState.rows = null; loadPerson(current.id || current.email, true);
      }).catch(function (err) { toast(err.message); d.disabled = false; });
    }
  });
  $('#person').addEventListener('change', function (e) {
    if (e.target.id === 'lt-stage' && e.target.value) { e.target.disabled = true; leadTag('stage', e.target.value, true, null); }
  });


  // ---------- Log a call or text (Lead Intake doc, steps 4 and 5) ----------
  function openCall() {
    if (!current || !current.id) return;
    $('#call-title').textContent = 'Log a call with ' + current.name;
    $('#call-notes').value = ''; $('#call-sitin').value = ''; $('#call-follow').value = '';
    $$('#call-sheet [name="call-path"]').forEach(function (r) { r.checked = r.value === 'qualified'; });
    var groups = (groupsState.rows || []).filter(function (g) { return g.when !== 'Past'; });
    var fillG = function (rows) { $('#call-sitin-group').innerHTML = '<option value="">Which group</option>' + rows.filter(function (g) { return g.when !== 'Past' && g.kind === 'Ensemble'; }).map(function (g) { return '<option>' + esc(g.name) + '</option>'; }).join(''); };
    if (groups.length) fillG(groups); else api('groups').then(function (r) { groupsState.rows = r; fillG(r); }).catch(function () {});
    var fillT = function (list) { $('#call-teacher').innerHTML = '<option value="">No preference</option>' + list.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join(''); };
    if (placeTeachers) fillT(placeTeachers);
    else api('lessons').then(function (rows) { placeTeachers = rows.map(function (r) { return r.Teacher; }).filter(Boolean).filter(function (t, i, a) { return a.indexOf(t) === i; }).sort(); fillT(placeTeachers); }).catch(function () { fillT([]); });
    callPath(); $('#call-sheet').hidden = false;
  }
  function callPath() {
    var v = ($$('#call-sheet [name="call-path"]').filter(function (r) { return r.checked; })[0] || {}).value;
    $('#call-sitin-box').hidden = v !== 'sitin';
    $('#call-what').textContent = {
      qualified: 'Moves them to Qualified. Next step: match to a group or teacher, due in 2 days.',
      waitlist: 'Moves them to Qualified and sets MMS status to Waiting. Next step: check in, due in 3 weeks.',
      longterm: 'Moves them to Nurture (Mailchimp keeps them warm). Next step: personal check-in in about 6 weeks.',
      sitin: 'Moves them to Qualified. Next step: follow up 2 days after the sit-in.',
      note: 'Just saves the call to their timeline. Nothing else changes.' }[v] || '';
  }
  $('#call-sheet').addEventListener('change', function (e) { if (e.target.name === 'call-path') callPath(); });
  $('#call-cancel').addEventListener('click', function () { $('#call-sheet').hidden = true; });
  $('#call-sheet').addEventListener('click', function (e) { if (e.target === this) this.hidden = true; });
  $('#call-go').addEventListener('click', function () {
    var btn = this, path = ($$('#call-sheet [name="call-path"]').filter(function (r) { return r.checked; })[0] || {}).value || 'note';
    if (path === 'sitin' && !$('#call-sitin').value) { toast('Pick the sit-in date'); return; }
    btn.disabled = true; btn.textContent = 'Saving';
    api('logcall', { sid: current.id, email: current.email, path: path, channel: $('#call-channel').value, notes: $('#call-notes').value.trim(),
      interest: $('#call-interest').value, teacher: $('#call-teacher').value, sitIn: $('#call-sitin').value, sitInGroup: $('#call-sitin-group').value,
      followUp: $('#call-follow').value })
      .then(function () {
        $('#call-sheet').hidden = true; toast('Call saved'); leadsState.rows = null; todayState.data = null; if (peopleState) peopleState.rows = null;
        loadPerson(current.id, true);
      }).catch(function (err) { toast(err.message); })
      .then(function () { btn.disabled = false; btn.textContent = 'Save'; });
  });
  $('#person').addEventListener('click', function (e) { if (e.target.closest('[data-logcall]')) openCall(); });

  // ---------- Convert to member (was Place in a group) ----------
  // Follows the Member Onboarding doc: the app sets MMS status and tags; billing,
  // the calendar event and the onboarding email stay with you and are listed.
  var placeTeachers = null;
  function groupOptions(rows, exclude) {
    var mine = ((current.instruments || []).length ? current.instruments : (current.formInstruments || [])).map(function (i) { return seatOf(i); });
    var ints = (current.tags || []).filter(function (t) { return /^Interest: /.test(t); }).map(function (t) { return t.slice(10); });
    var want = ints.indexOf('Ensemble') >= 0 ? 'Ensemble' : ints.indexOf('Classes') >= 0 ? 'Class' : '';
    var cur = rows.filter(function (g) { return g.when !== 'Past' && current.programs.indexOf(g.name) < 0 && g.name !== exclude; });
    cur.sort(function (a, b) {
      var fa = a.open.some(function (s) { return mine.indexOf(s) >= 0; }) ? 0 : 1, fb = b.open.some(function (s) { return mine.indexOf(s) >= 0; }) ? 0 : 1;
      var ka = want && a.kind !== want ? 1 : 0, kb = want && b.kind !== want ? 1 : 0;
      return (ka - kb) || (fa - fb) || a.name.localeCompare(b.name, 'en', { numeric: true });
    });
    return '<option value="">None</option>' + cur.map(function (g) {
      var fit = g.open.some(function (s) { return mine.indexOf(s) >= 0; });
      return '<option value="' + esc(g.name) + '">' + esc(g.name) + (g.schedule ? ' · ' + esc(g.schedule) : '') +
        (g.open.length ? ' · open: ' + esc(openText(g.open)) : '') + (fit ? ' · fits' : '') + '</option>';
    }).join('');
  }
  function openPlace() {
    if (!current || !current.id) return;
    $('#place-title').textContent = 'Convert ' + current.name + ' to a member';
    var sel = $('#place-group');
    sel.innerHTML = '<option>Loading groups</option>'; sel.disabled = true;
    $('#place-group2-wrap').hidden = true; $('#place-add2').hidden = false; $('#place-group2').innerHTML = '';
    var ints = (current.tags || []).filter(function (t) { return /^Interest: /.test(t); }).map(function (t) { return t.slice(10); });
    $('#place-lessons').checked = ints.indexOf('Private lessons') >= 0 && ints.indexOf('Ensemble') < 0 && ints.indexOf('Classes') < 0;
    $('#place-lesson-box').hidden = !$('#place-lessons').checked;
    $('#pl-when').value = '';
    $('#place-sheet').hidden = false;
    var go = function (rows) {
      sel.innerHTML = groupOptions(rows);
      // Preselect only a group that has a seat for their instrument; otherwise leave it on None.
      if (!$('#place-lessons').checked && sel.options.length > 1 && / · fits$/.test(sel.options[1].textContent)) sel.selectedIndex = 1;
      sel.disabled = false; placeSteps();
    };
    if (groupsState.rows) go(groupsState.rows);
    else api('groups').then(function (r) { groupsState.rows = r; go(r); }).catch(function (e) { toast(e.message); });
    var fill = function (list) {
      $('#pl-teacher').innerHTML = '<option value="">Pick a teacher</option>' + list.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('');
    };
    if (placeTeachers) fill(placeTeachers);
    else api('lessons').then(function (rows) {
      placeTeachers = rows.map(function (r) { return r.Teacher; }).filter(Boolean).filter(function (t, i, a) { return a.indexOf(t) === i; }).sort();
      fill(placeTeachers);
    }).catch(function () { fill([]); });
  }
  function seatOf(i) {
    i = String(i).toLowerCase();
    if (/drum|percuss/.test(i)) return 'Drums';
    if (/voice|vocal/.test(i)) return 'Voice';
    if (/bass/.test(i)) return 'Bass';
    if (/guitar/.test(i)) return 'Guitar';
    if (/piano|keys/.test(i)) return 'Piano';
    return 'Horn';
  }
  function placeChoice() {
    var groups = [$('#place-group').value, $('#place-group2-wrap').hidden ? '' : $('#place-group2').value].filter(Boolean);
    var lessons = $('#place-lessons').checked ? { teacher: $('#pl-teacher').value, frequency: $('#pl-freq').value,
      length: $('#pl-len').value, when: $('#pl-when').value.trim(), instrument: (current.instruments || [])[0] || '' } : null;
    return { groups: groups, lessons: lessons };
  }
  function placeSteps() {
    var c = placeChoice(), steps = [], todo = [];
    c.groups.forEach(function (g) { steps.push('Add the "' + g + '" tag in MMS'); });
    if (c.groups.some(function (g) { return /^Group \d+/.test(g); })) steps.push('Add the "Ensemble Member" tag (or tell you to, if MMS has teachers on it)');
    if (c.lessons) steps.push('Add them to Lessons' + (c.lessons.teacher ? ' with ' + c.lessons.teacher : '') + ', ' + c.lessons.frequency.toLowerCase() + ', ' + c.lessons.length);
    if ((current.tags || []).some(function (t) { return /^Stage: /.test(t); })) steps.push('Clear their funnel stage');
    if (current.status !== 'Active') steps.push('Change their MMS status from ' + current.status + ' to Active');
    steps.push('Log it on their timeline');
    if (c.lessons) todo.push('Add the Private Lessons - Active tag in MMS');
    todo.push('In MMS: assign the teacher and set billing to "same amount each month"' + (c.lessons ? ' (lessons at the $80/hr member rate)' : ' at $150/mo'));
    if (c.groups.length) todo.push('In MMS: add them to the calendar event for ' + c.groups.join(' and ') + '. This starts billing.');
    if (c.groups.length + (c.lessons ? 1 : 0) > 1) todo.push('Two programs: create the second recurring charge in MMS by hand');
    todo.push('In MMS: make sure auto-invoicing and Auto-Email are on for the family (new sign-ups start with it off)');
    todo.push('Send the onboarding email');
    $('#place-steps').innerHTML = steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    $('#place-todo').innerHTML = todo.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var ok = (c.groups.length || c.lessons) && (!c.lessons || c.lessons.teacher);
    $('#place-go').disabled = !ok;
  }
  $('#place-add2').addEventListener('click', function () {
    $('#place-group2').innerHTML = groupOptions(groupsState.rows || [], $('#place-group').value);
    $('#place-group2-wrap').hidden = false; this.hidden = true; placeSteps();
  });
  $('#place-lessons').addEventListener('change', function () { $('#place-lesson-box').hidden = !this.checked; placeSteps(); });
  ['#place-group', '#place-group2', '#pl-teacher', '#pl-freq', '#pl-len'].forEach(function (id) { $(id).addEventListener('change', placeSteps); });
  $('#place-cancel').addEventListener('click', function () { $('#place-sheet').hidden = true; });
  $('#place-sheet').addEventListener('click', function (e) { if (e.target === this) this.hidden = true; });
  $('#place-go').addEventListener('click', function () {
    var btn = this, c = placeChoice(); if (!c.groups.length && !c.lessons) return;
    btn.disabled = true; btn.textContent = 'Converting';
    api('place', { sid: current.id, email: current.email, groups: c.groups, lessons: c.lessons }).then(function (r) {
      $('#place-sheet').hidden = true;
      toast(current.name + ' is a member. Your to-do list is on their timeline.');
      leadsState.rows = null; groupsState.rows = null; todayState.data = null; lessonsState.rows = null;
      loadPerson(current.id, true);
      var ens = c.groups.filter(function (g) { return /^Group \d+$/.test(g); })[0];
      if (ens) openCal(ens);
    }).catch(function (err) { toast(err.message); })
      .then(function () { btn.disabled = false; btn.textContent = 'Convert'; });
  });
  $('#person').addEventListener('click', function (e) { if (e.target.closest('[data-place]')) openPlace(); });

  // ---------- Add to the ensemble's MMS calendar (this is what starts billing) ----------
  var calState = { group: '', events: [] };
  function openCal(group) {
    if (!current || !current.id) return;
    calState = { group: group, events: [] };
    $('#cal-title').textContent = 'Add ' + current.name + ' to ' + group;
    $('#cal-list').innerHTML = '<div class="loading">Reading the ' + esc(group) + ' calendar in MMS</div>';
    $('#cal-info').innerHTML = ''; $('#cal-err').textContent = ''; $('#cal-billing').checked = false;
    $('#cal-confirm').hidden = true; $('#cal-go').disabled = true; $('#cal-go').textContent = 'Add to rehearsals';
    $('#cal-mms').href = current.mmsUrl || '#';
    $('#cal-sheet').hidden = false;
    api('calpreview', { sid: current.id, group: group }).then(function (r) {
      calState.events = r.events;
      var t = r.teachers.join(' and ') || 'the group teacher';
      $('#cal-teacher').textContent = t;
      $('#cal-info').innerHTML =
        '<li>Teacher on these events: <b>' + esc(t) + '</b></li>' +
        '<li>MMS status: ' + esc(r.status || 'unknown') + '</li>' +
        '<li>Auto-invoicing for the family: ' + (r.autoInvoicing ? 'on' : '<b>off</b>. No invoice would go out until you turn it on (and Auto-Email) in MMS.') + '</li>';
      if (!r.events.length) { $('#cal-list').innerHTML = '<div class="empty">No ' + esc(group) + ' rehearsals found in MMS in the next 6 months.</div>'; return; }
      $('#cal-list').innerHTML = r.events.map(function (e) {
        var d = parse(e.start);
        return '<label class="checkline"><input type="checkbox" data-calid="' + esc(e.id) + '"' + (e.already ? ' disabled' : ' checked') + '> ' +
          esc(d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })) + ' · ' +
          esc(d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })) + ' · ' + esc(e.title || group) +
          ' · ' + e.people + ' playing' + (e.already ? ' · already on it' : '') + '</label>';
      }).join('');
      calCheck();
    }).catch(function (e) { $('#cal-list').innerHTML = '<div class="empty err">' + esc(e.message) + '</div>'; });
  }
  function calIds() { return $$('#cal-list [data-calid]').filter(function (x) { return x.checked && !x.disabled; }).map(function (x) { return x.dataset.calid; }); }
  function calCheck() {
    var n = calIds().length;
    $('#cal-go').disabled = !n || !$('#cal-billing').checked;
    $('#cal-go').textContent = 'Add to ' + n + ' rehearsal' + (n === 1 ? '' : 's');
    $('#cal-confirm').hidden = true;
  }
  $('#cal-list').addEventListener('change', calCheck);
  $('#cal-billing').addEventListener('change', calCheck);
  $('#cal-cancel').addEventListener('click', function () { $('#cal-sheet').hidden = true; });
  $('#cal-go').addEventListener('click', function () {
    var ids = calIds(); if (!ids.length) return;
    if ($('#cal-confirm').hidden) {
      $('#cal-confirm').hidden = false;
      $('#cal-confirm').textContent = 'Tap again to add ' + current.name + ' to ' + ids.length + ' ' + calState.group + ' rehearsal' + (ids.length === 1 ? '' : 's') + ' in MMS. This starts their billing.';
      return;
    }
    var btn = this; btn.disabled = true; btn.textContent = 'Adding';
    api('caladd', { sid: current.id, email: current.email, group: calState.group, ids: ids, billingDone: true }).then(function (r) {
      $('#cal-sheet').hidden = true;
      toast('Added to ' + r.added + ' rehearsal' + (r.added === 1 ? '' : 's') + '. Check their ledger in MMS for the monthly charge.');
      loadPerson(current.id, true);
    }).catch(function (e) { $('#cal-err').textContent = e.message; btn.disabled = false; calCheck(); });
  });
  $('#person').addEventListener('click', function (e) { var b = e.target.closest('[data-cal]'); if (b) openCal(b.dataset.cal); });

  // ---------- Take out of a group / end membership ----------
  var END = '__end__';
  function openLeave() {
    if (!current || !current.id) return;
    $('#leave-title').textContent = 'Changes for ' + current.name;
    $('#leave-what').innerHTML = (current.programs || []).map(function (g) {
      return '<option value="' + esc(g) + '">Take them out of ' + esc(g) + '</option>';
    }).join('') + '<option value="' + END + '">End their membership</option>';
    $('#leave-why').value = '';
    $('#leave-sheet').hidden = false; leaveSteps();
  }
  function leaveSteps() {
    var v = $('#leave-what').value, end = v === END, progs = current.programs || [], steps = [], manual = [];
    var out = end ? progs : [v];
    out.forEach(function (g) { steps.push('Remove the "' + g + '" tag in MMS'); });
    var left = progs.filter(function (g) { return out.indexOf(g) < 0; });
    if ((current.tags || []).indexOf('Ensemble Member') >= 0 && !left.some(function (g) { return /^Group \d+/.test(g); })) {
      manual.push('Ensemble Member has teachers on it in MMS, so remove that tag there.');
    }
    if (end && current.status !== 'Inactive') steps.push('Change their MMS status from ' + current.status + ' to Inactive');
    steps.push('Log it on their timeline');
    manual.push(end ? 'Stop their recurring billing and future lessons in MyMusicStaff after.' : 'Check their billing in MyMusicStaff after.');
    $('#leave-steps').innerHTML = steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    $('#leave-manual').textContent = manual.join(' ');
    $('#leave-go').textContent = end ? 'End membership' : 'Take them out';
  }
  $('#leave-what').addEventListener('change', leaveSteps);
  $('#leave-cancel').addEventListener('click', function () { $('#leave-sheet').hidden = true; });
  $('#leave-sheet').addEventListener('click', function (e) { if (e.target === this) this.hidden = true; });
  $('#leave-go').addEventListener('click', function () {
    var btn = this, v = $('#leave-what').value, end = v === END, label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Saving';
    api('leave', { sid: current.id, email: current.email, group: end ? '' : v, end: end, reason: $('#leave-why').value })
      .then(function (r) {
        var m = ((r && r.manual) || []).filter(function (x) { return !/billing/.test(x); });
        $('#leave-sheet').hidden = true;
        toast((end ? 'Membership ended.' : 'Taken out of ' + v + '.') + (m.length ? ' ' + m[0] + '.' : ' Check billing in MMS.'));
        leadsState.rows = null; groupsState.rows = null; todayState.data = null;
        loadPerson(current.id, true);
      }).catch(function (err) { toast(err.message); })
      .then(function () { btn.disabled = false; btn.textContent = label; });
  });
  $('#person').addEventListener('click', function (e) { if (e.target.closest('[data-leave]')) openLeave(); });

  // ---------- Groups ----------
  var groupsState = { rows: null, when: store('nsjw_when') || 'Current', kind: store('nsjw_kind') || '' };

  function seatWord(n, s) { return n + ' ' + s.toLowerCase() + (n > 1 && s !== 'Bass' ? 's' : n > 1 ? 'es' : ''); }
  function openText(open) {
    var c = {};
    open.forEach(function (s) { c[s] = (c[s] || 0) + 1; });
    return Object.keys(c).map(function (s) { return seatWord(c[s], s); }).join(', ');
  }
  function fillBar(g) {
    if (!g.capacity) return '';
    var pct = Math.min(100, Math.round(100 * (g.capacity - g.open.length) / g.capacity));
    return '<div class="fill"><span style="width:' + pct + '%"></span></div>';
  }

  function loadGroups(force) {
    if (groupsState.rows && !force) { renderGroups(); return; }
    $('#group-list').innerHTML = '<div class="loading">Loading</div>';
    swr('groups', null, function (rows) { groupsState.rows = rows; renderGroups(); })
      .catch(function (e) { $('#group-list').innerHTML = '<div class="empty err">' + esc(e.message) + '</div>'; });
  }

  function renderGroups() {
    var all = groupsState.rows || [];
    $$('#when-tabs .tab').forEach(function (b) { b.classList.toggle('on', b.dataset.when === groupsState.when); });
    $$('#kind-chips .chip').forEach(function (b) { b.classList.toggle('on', b.dataset.kind === groupsState.kind); });
    var rows = all.filter(function (g) {
      if (g.when !== groupsState.when) return false;
      if (groupsState.kind === 'open') return g.open.length > 0;
      return !groupsState.kind || g.kind === groupsState.kind;
    });
    var people = rows.reduce(function (n, g) { return n + g.members; }, 0);
    var seats = rows.reduce(function (n, g) { return n + g.open.length; }, 0);
    $('#groups-sum').textContent = rows.length + (rows.length === 1 ? ' group · ' : ' groups · ') + people + ' people' +
      (seats ? ' · ' + seats + ' open seats' : '');
    if (!rows.length) { $('#group-list').innerHTML = '<div class="empty">Nothing here.</div>'; return; }
    $('#group-list').innerHTML = rows.map(function (g) {
      var sub = [g.kind, g.schedule, g.teacher].filter(Boolean).join(' · ');
      return '<a class="card group-row" href="#g/' + encodeURIComponent(g.name) + '">' +
        '<div class="line1"><span class="name">' + esc(g.name) + '</span><span class="count">' + g.members + (g.members === 1 ? ' person' : ' people') + '</span></div>' +
        (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + fillBar(g) +
        (g.open.length ? '<div class="pills"><span class="pill open">Open: ' + esc(openText(g.open)) + '</span></div>' : '') +
        (g.live ? '<div class="sub faint">Next rehearsal ' + esc(dayOnly(g.live.next)) + (g.live.when ? ' · ' + esc(g.live.when) : '') + '</div>' : '') +
        ((g.check || []).length ? '<div class="pills">' + g.check.map(function (c) { return '<span class="pill warn">' + esc(c) + '</span>'; }).join('') + '</div>' : '') +
        '</a>';
    }).join('');
  }

  $('#when-tabs').addEventListener('click', function (e) {
    var b = e.target.closest('.tab'); if (!b) return;
    groupsState.when = b.dataset.when; store('nsjw_when', groupsState.when); renderGroups();
  });
  $('#kind-chips').addEventListener('click', function (e) {
    var b = e.target.closest('.chip'); if (!b) return;
    groupsState.kind = b.dataset.kind; store('nsjw_kind', groupsState.kind); renderGroups();
  });

  function personRow(p, extra) {
    return '<a class="card person-row" href="#p/' + encodeURIComponent(p.id) + '">' +
      '<div class="avatar">' + esc(initials(p.name)) + '</div>' +
      '<div class="who"><div class="name">' + esc(p.name) + '</div><div class="sub">' +
      esc([p.instruments && String(p.instruments).replace(/;/g, ','), p.skill ? 'Skill ' + p.skill : '', extra].filter(Boolean).join(' · ')) +
      '</div></div>' + statusPill(p.status) + '</a>';
  }

  function loadGroup(name) {
    $('#group-name').textContent = name;
    $('#group-eyebrow').textContent = ''; $('#group-sched').textContent = '';
    var main = $('#group');
    main.innerHTML = '<div class="loading">Loading</div>';
    swr('group', { name: name }, function (g) {
      $('#group-eyebrow').textContent = [g.kind, g.when !== 'Current' ? g.when : '', g.level ? 'Level ' + g.level : ''].filter(Boolean).join(' · ');
      $('#group-sched').textContent = [g.schedule, g.teacher].filter(Boolean).join(' · ');
      var html = '';
      if (g.capacity) {
        var taken = {};
        g.memberList.forEach(function (m) { (taken[m.seat] = taken[m.seat] || []).push(m); });
        var tiles = [];
        ['Drums', 'Bass', 'Guitar', 'Piano', 'Horn', 'Voice'].forEach(function (s) {
          (taken[s] || []).forEach(function (m) {
            tiles.push('<a class="seat" href="#p/' + encodeURIComponent(m.id) + '"><b>' + esc(String(m.instruments).split(';')[0]) + '</b><span>' + esc(m.name) + '</span></a>');
          });
          g.open.filter(function (o) { return o === s; }).forEach(function () {
            tiles.push('<div class="seat open"><b>' + esc(s) + '</b><span>Open</span></div>');
          });
        });
        html += '<div class="section-title">Seats · ' + (g.open.length ? g.open.length + ' open' : 'full') + '</div><div class="seats">' + tiles.join('') + '</div>';
      }
      var cal = g.calendar;
      if (cal && cal.events && ((cal.notTagged || []).length || (cal.notOnCalendar || []).length)) {
        var nm = function (list) { return list.map(function (x) { return '<a href="#p/' + encodeURIComponent(x.id) + '">' + esc(x.name) + '</a>'; }).join(', '); };
        html += '<div class="card mail-note" style="margin:0 0 14px"><b>Doesn\'t match MMS.</b> The next rehearsal (' + esc(dayOnly(String(cal.date).slice(0, 10))) + ', ' + esc(cal.teacher) + ') ' +
          ((cal.notTagged || []).length ? 'has ' + nm(cal.notTagged) + ' on it without the ' + esc(g.name) + ' tag. ' : '') +
          ((cal.notOnCalendar || []).length ? nm(cal.notOnCalendar) + (cal.notOnCalendar.length === 1 ? ' is' : ' are') + ' tagged but not on the rehearsal, so not billed or reminded through it.' : '') +
          '</div>';
      } else if (cal && cal.events) {
        html += '<p class="muted small" style="margin:0 0 12px">Matches the ' + esc(cal.title || 'MMS rehearsal') + ' roster in MMS.</p>';
      }
      if (g.open.length && g.fill) {
        html += '<div class="section-title">Could fill it</div>';
        html += g.fill.map(function (f) {
          return '<div class="sub-h" style="margin:12px 0 6px"><b>' + esc(f.seat) + '</b> · ' + f.open + ' open · ' +
            (f.total ? f.total + (f.total === 1 ? ' person' : ' people') + (f.total > f.people.length ? ', best ' + f.people.length + ' shown' : '') : 'no one yet') + '</div>' +
            (f.people.length ? '<div class="list">' + f.people.map(function (p) { return personRow(p, p.why); }).join('') + '</div>' : '');
        }).join('');
      } else if (g.open.length) {
        html += '<div class="section-title">Could fill it</div>' +
          (g.matches.length ? '<div class="list">' + g.matches.map(function (p) {
            return personRow(p, p.started ? 'since ' + dayOnly(p.started) : '');
          }).join('') + '</div>' : '<div class="empty">No waiting students or recent leads play ' + esc(openText(g.open)) + '.</div>');
      }
      groupMailList = g.memberList.map(function (m) { return { id: m.id, name: m.name }; }); groupMailName = g.name;
      html += '<div class="section-title">' + (g.when === 'Past' ? 'Took part' : 'Members') + ' · ' + g.memberList.length +
        (g.memberList.length ? ' <button type="button" class="btn small" data-groupmail>Email this group</button>' : '') + '</div>' +
        (g.memberList.length ? '<div class="list">' + g.memberList.map(function (p) { return personRow(p); }).join('') + '</div>' : '<div class="empty">No one active has this tag.</div>');
      if (g.otherList.length) {
        html += '<div class="section-title">Also tagged · ' + g.otherList.length + '</div><div class="list">' +
          g.otherList.map(function (p) { return personRow(p); }).join('') + '</div>';
      }
      html += '<p class="muted small">From the "' + esc(g.name) + '" tag in MyMusicStaff. Schedule, teacher, level and seats come from the Groups tab in the Sequencer sheet.</p>';
      main.innerHTML = html;
    }).catch(function (e) { main.innerHTML = '<div class="empty err">' + esc(e.message) + '</div>'; });
  }


  // ---------- Email a group or a selection (each person gets their own copy) ----------
  var picked = {}, groupMailList = [], groupMailName = '', composeTo = [];
  function pickBox(id, name) {
    return '<span class="pick' + (picked[id] ? ' on' : '') + '" data-pick="' + esc(id) + '" data-name="' + esc(name) + '" role="checkbox" aria-checked="' + (picked[id] ? 'true' : 'false') + '" aria-label="Select ' + esc(name) + '"></span>';
  }
  function selBar() {
    var ids = Object.keys(picked), bar = $('#selbar');
    bar.hidden = !ids.length;
    $('#sel-count').textContent = ids.length + ' selected';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-pick]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var id = b.dataset.pick;
    if (picked[id]) delete picked[id]; else picked[id] = b.dataset.name;
    $$('[data-pick="' + id.replace(/"/g, '') + '"]').forEach(function (x) { x.classList.toggle('on', !!picked[id]); x.setAttribute('aria-checked', picked[id] ? 'true' : 'false'); });
    selBar();
  }, true);
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-pickpage]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var rows = $$('#people-list [data-pick]'), all = rows.every(function (x) { return picked[x.dataset.pick]; });
    rows.forEach(function (x) { if (all) delete picked[x.dataset.pick]; else picked[x.dataset.pick] = x.dataset.name; x.classList.toggle('on', !all); });
    b.classList.toggle('on', !all); selBar();
  }, true);
  $('#sel-clear').addEventListener('click', function () { picked = {}; $$('.pick.on').forEach(function (x) { x.classList.remove('on'); }); selBar(); });
  $('#sel-mail').addEventListener('click', function () {
    openCompose(Object.keys(picked).map(function (id) { return { id: id, name: picked[id] }; }), '');
  });
  function openCompose(list, label) {
    composeTo = list.filter(function (p) { return p.id; });
    $('#mail-title').textContent = 'Email ' + (label || (composeTo.length === 1 ? composeTo[0].name : composeTo.length + ' people'));
    renderTo(); $('#mail-err').textContent = '';
    $('#mail-sheet').hidden = false;
  }
  function renderTo() {
    $('#mail-to').innerHTML = composeTo.map(function (p, i) {
      return '<span class="chip on">' + esc(p.name) + ' <button type="button" class="x" data-rmto="' + i + '" aria-label="Remove ' + esc(p.name) + '">&times;</button></span>';
    }).join('');
    $('#mail-send').textContent = 'Send to ' + composeTo.length + (composeTo.length === 1 ? ' person' : ' people');
    $('#mail-send').disabled = !composeTo.length || composeTo.length > 50;
    $('#mail-cap').hidden = composeTo.length <= 50;
    $('#mail-fu-row').hidden = composeTo.length !== 1;
    if (!$('#mail-fu-due').options.length) $('#mail-fu-due').innerHTML = dueOptions(null, 2);
  }
  $('#mail-to').addEventListener('click', function (e) {
    var b = e.target.closest('[data-rmto]'); if (!b) return; composeTo.splice(Number(b.dataset.rmto), 1); renderTo();
  });
  function sendMail(test) {
    var subject = $('#mail-subject').value.trim(), body = $('#mail-body').value.trim();
    if (!subject || !body) { $('#mail-err').textContent = 'Add a subject and a message first.'; return; }
    $('#mail-err').textContent = '';
    var btn = test ? $('#mail-test') : $('#mail-send'), label = btn.textContent;
    btn.disabled = true; btn.textContent = test ? 'Sending test' : 'Sending';
    api('groupmail', { sids: composeTo.map(function (p) { return p.id; }), subject: subject, body: body, test: !!test }).then(function (r) {
      if (test) { toast('Test sent to ' + r.to); return; }
      if (composeTo.length === 1 && $('#mail-fu').checked) {
        addFollowUp(composeTo[0].id, '', 'Follow up on "' + subject + '"', $('#mail-fu-due').value).catch(function (err) { toast('Sent, but the follow-up task failed: ' + err.message); });
        $('#mail-fu').checked = false;
      }
      $('#mail-sheet').hidden = true; $('#mail-subject').value = ''; $('#mail-body').value = '';
      picked = {}; $$('.pick.on').forEach(function (x) { x.classList.remove('on'); }); selBar();
      leadsState.rows = null; peopleState.rows = null; todayState.data = null;
      if (current && composeTo.length === 1 && composeTo[0].id === current.id && location.hash.indexOf('#p/') === 0) loadPerson(current.id, true);
      toast('Sent to ' + r.sent + (r.sent === 1 ? ' person' : ' people') + (r.failed && r.failed.length ? '. Could not send to ' + r.failed.join(', ') : ''));
    }).catch(function (err) { $('#mail-err').textContent = err.message; })
      .then(function () { btn.disabled = false; btn.textContent = label; if (!test) renderTo(); });
  }
  $('#mail-test').addEventListener('click', function () { sendMail(true); });
  $('#mail-send').addEventListener('click', function () {
    if (!$('#mail-confirm').hidden) { $('#mail-confirm').hidden = true; sendMail(false); return; }
    $('#mail-confirm').hidden = false;
    $('#mail-confirm').textContent = 'Tap Send again to email ' + composeTo.length + (composeTo.length === 1 ? ' person' : ' people') + ' from your inbox.';
  });
  $('#mail-cancel').addEventListener('click', function () { $('#mail-sheet').hidden = true; $('#mail-confirm').hidden = true; });
  $('#mail-sheet').addEventListener('click', function (e) { if (e.target === this) { this.hidden = true; $('#mail-confirm').hidden = true; } });
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-groupmail]')) { openCompose(groupMailList, groupMailName); return; }
    if (e.target.closest('[data-mailone]') && current && current.id) { openCompose([{ id: current.id, name: current.name }], current.name); return; }
    var c = e.target.closest('[data-colmail]');
    if (c) {
      e.stopPropagation();
      var col = c.dataset.colmail, list;
      if (col === 'Enrolled') list = leadsState.enrolled.map(function (x) { return { id: x.id, name: x.name }; });
      else list = (leadsState.rows || []).filter(leadMatches).filter(trackOk).filter(onBoard).filter(function (l) { return l.stage === col; }).map(function (l) { return { id: l.id, name: l.name }; });
      openCompose(list, col + ' (' + list.length + ')');
    }
  });

  // ---------- routing ----------
  function nav(which) {
    // Detail screens (a person, a group) hide the tab bar on phones; wide screens keep it as a sidebar.
    $('#tabbar').hidden = !token;
    $('#tabbar').classList.toggle('detail', !which);
    $$('#tabbar a').forEach(function (a) { a.classList.toggle('active', a.dataset.nav === which); });
  }
  var backTo = '#people';
  function route() {
    if (!token) { nav(null); show('v-signin'); return; }
    var h = location.hash.replace(/^#/, '');
    if (h.indexOf('p/') === 0) { nav(null); $('#v-person .back').href = backTo; $('#v-person .back').innerHTML = '&#8249; ' + (backTo === '#tasks' ? 'Tasks' : backTo === '#lessons' ? 'Lessons' : backTo === '#groups' ? 'Groups' : backTo === '#leads' ? 'Leads' : backTo === '#today' ? 'Today' : backTo.indexOf('#g/') === 0 ? decodeURIComponent(backTo.slice(3)) : 'People'); show('v-person'); renderRun(); loadPerson(decodeURIComponent(h.slice(2))); return; }
    if (h === 'tasks') { backTo = '#tasks'; nav('tasks'); show('v-tasks'); loadTasks(); renderRun(); return; }
    if (h === 'lessons') { backTo = '#lessons'; nav('lessons'); show('v-lessons'); loadLessons(); return; }
    if (h === 'leads') { backTo = '#leads'; nav('leads'); show('v-leads'); loadLeads(); return; }
    if (h === 'groups') { backTo = '#groups'; nav('groups'); show('v-groups'); loadGroups(); return; }
    if (h.indexOf('g/') === 0) { backTo = location.hash; nav(null); show('v-group'); loadGroup(decodeURIComponent(h.slice(2))); return; }
    if (h === '' || h === 'today') { backTo = '#today'; nav('today'); show('v-today'); loadToday(); return; }
    backTo = '#people'; nav('people');
    show('v-people');
    loadPeople();
  }
  window.addEventListener('hashchange', route);

  // ---------- start ----------

  $('#q').value = peopleState.q;
  var savedStage = store('nsjw_stage');
  if (savedStage !== null) lessonsState.stage = savedStage;
  lessonsState.teacher = store('nsjw_teacher') || '';
  $$('#stage-chips .chip').forEach(function (c) { c.classList.toggle('on', c.dataset.stage === lessonsState.stage); });
  setToken(store('nsjw_tok'));
  route();
  initGoogle();

  window.NSJW = { setToken: setToken, route: route }; // for testing
})();
