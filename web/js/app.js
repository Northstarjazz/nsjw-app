/* North Star Student Journey app. Plain JS, no build step. */
(function () {
  'use strict';

  var CONFIG = {
    api: 'https://script.google.com/macros/s/AKfycbw0t_2tYuBAnwDyagUzHIVIAIe4yWrpRzv2gjneNE0XH248dh6oCOOYc5Ek9wKKCVE3/exec',
    clientId: '1003602730249-2nnt3n1isqov67aiiv2rppb2o76ju50v.apps.googleusercontent.com',
    domain: 'northstarjazzworkshops.com'
  };
  window.NSJW_CONFIG = CONFIG; // tests may override api before load

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

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function initials(name) {
    var p = String(name || '?').trim().split(/\s+/);
    return ((p[0] || '')[0] + ((p.length > 1 ? p[p.length - 1] : '')[0] || '')).toUpperCase();
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
    api('contacts').then(function (rows) { peopleState.rows = rows; renderPeople(); })
      .catch(function (e) { $('#people-list').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
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
  var PCOLS = [['name', 'Name'], ['email', 'Email'], ['status', 'Status'], ['programs', 'Programs'], ['tracks', 'Interested in'], ['created', 'Created'], ['lastActivity', 'Last activity']];
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
    var sp = peopleState.sort.split(':');
    var head = '<div class="prow phead">' + PCOLS.map(function (c) {
      var on = sp[0] === c[0], sortable = c[0] !== 'programs' && c[0] !== 'tracks';
      return '<span class="pc pc-' + c[0] + (sortable ? ' sortable' : '') + (on ? ' on' : '') + '"' + (sortable ? ' data-sort="' + c[0] + '"' : '') + '>' + c[1] +
        (on ? (sp[1] === 'desc' ? ' &darr;' : ' &uarr;') : '') + '</span>';
    }).join('') + '</div>';
    $('#people-list').innerHTML = pg.length ? head + pg.map(function (r) {
      var tr = r.tracks.map(function (t) { return t === 'Classes' ? 'Class' : t; }).join(', ');
      return '<a class="card prow" href="#p/' + encodeURIComponent(r.id) + '">' +
        '<span class="pc pc-name"><span class="avatar sm">' + esc(initials(r.name)) + '</span><span class="nm">' + esc(r.name) + '</span></span>' +
        '<span class="pc pc-email">' + esc(r.email) + '</span>' +
        '<span class="pc pc-status">' + statusPill(r.status === 'Active' || r.status === 'Inactive' ? r.status : (r.stage || r.status)) + '</span>' +
        '<span class="pc pc-programs">' + esc(r.programs.join(', ') || r.instruments.join(', ')) + '</span>' +
        '<span class="pc pc-tracks">' + esc(tr) + '</span>' +
        '<span class="pc pc-created">' + esc(r.created ? dayOnly(r.created) : '') + '</span>' +
        '<span class="pc pc-lastActivity">' + esc(actText(r.lastActivity) || 'None yet') + '</span></a>';
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
  $('#people-list').addEventListener('click', function (e) {
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
  function loadPerson(sid) {
    var main = $('#person');
    main.innerHTML = '<div class="loading">Loading</div>';
    $('#mms-link').hidden = true;
    api('person', { sid: sid }).then(function (p) {
      current = p;
      renderPerson(p, 'timeline');
      if (pendingPlace && pendingPlace === p.id) { pendingPlace = null; openPlace(); }
    }).catch(function (e) { main.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
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

  function renderPerson(p, tab) {
    var main = $('#person');
    var plays = p.instruments.length ? p.instruments : (p.formInstruments || []);
    var subBits = [plays.join(', ') + (p.instruments.length || !plays.length ? '' : ' (from form)'), p.skill ? 'Skill ' + p.skill : '', p.started ? 'Since ' + dayOnly(p.started) : ''].filter(Boolean);
    var pills = [statusPill(p.status)]
      .concat(p.programs.map(function (t) { return '<span class="pill accent">' + esc(t) + '</span>'; }))
      .concat(p.tags.filter(function (t) { return /^Stage: /.test(t); }).map(function (t) { return '<span class="pill accent">' + esc(LEGACY[t.slice(7)] || t.slice(7)) + '</span>'; }))
      .concat(p.tags.filter(function (t) { return !/^(Stage|Interest|Nights): /.test(t); }).map(function (t) { return '<span class="pill">' + esc(t) + '</span>'; }))
      .concat(p.sequences.filter(function (s) { return s.status === 'Active'; })
        .map(function (s) { return '<span class="pill">' + esc(s.sequence) + ' seq.</span>'; }));

    var ns = p.nextStep, nextHtml;
    if (ns) {
      var overdue = ns.Due && parse(ns.Due) < new Date(new Date().toDateString());
      nextHtml = '<div class="card next' + (overdue ? ' overdue' : '') + '"><div><div class="label">Next step' +
        (ns.Due ? ' · due ' + esc(dayOnly(ns.Due)) : '') + '</div><div class="text">' + esc(ns.Text) + '</div></div>' +
        '<div class="next-side">' + (ns.Owner ? '<span class="pill">' + esc(ns.Owner) + '</span>' : '') +
        '<button class="btn" type="button" data-next-done>Done</button></div></div>';
    } else {
      nextHtml = '<button class="card next none" data-open="next_step" type="button" style="width:100%;text-align:left;font:inherit;cursor:pointer"><div><div class="label">No next step</div><div class="text">Add one</div></div></button>';
    }

    var mail = p.email ? 'mailto:' + encodeURIComponent(p.email) : '';
    var sms = p.phone ? 'sms:' + String(p.phone).replace(/[^\d+]/g, '') : '';

    main.innerHTML =
      '<div class="hero"><div class="avatar">' + esc(initials(p.name)) + '</div><div><h2>' + esc(p.name) + '</h2>' +
      '<div class="sub">' + esc(subBits.join(' · ')) + '</div></div></div>' +
      '<div class="pills">' + pills.join('') + '</div>' +
      stageStrip(p) + trackRow(p) +
      nextHtml +
      '<div class="actions">' +
        '<a class="btn" href="' + esc(mail) + '"' + (mail ? '' : ' aria-disabled="true"') + '>Email</a>' +
        '<a class="btn" href="' + esc(sms) + '"' + (sms ? '' : ' aria-disabled="true"') + '>Text</a>' +
        '<a class="btn" target="_blank" rel="noopener" href="' + esc(p.mmsUrl) + '"' + (p.mmsUrl ? '' : ' aria-disabled="true"') + '>MMS</a>' +
        '<button class="btn" type="button" data-open="note">Note</button>' +
        '<button class="btn dark" type="button" data-open="next_step">Next step</button>' +
      '</div>' +
      '<div class="tabs" role="tablist"><button class="tab' + (tab === 'timeline' ? ' on' : '') + '" data-tab="timeline">Timeline</button>' +
      '<button class="tab' + (tab === 'details' ? ' on' : '') + '" data-tab="details">Details</button></div>' +
      (tab === 'details' ? detailsHtml(p) : timelineHtml(p));

    var link = $('#mms-link');
    if (p.mmsUrl) { link.href = p.mmsUrl; link.hidden = false; } else link.hidden = true;

    // Lesson card sits right under the next step.
    var l = p.lesson;
    var cardHtml = l
      ? '<div class="card lesson-card"><div class="line1"><div class="label">Private lessons · ' + esc(l.Stage || '') + '</div>' +
        '<button class="link" type="button" data-open-lesson>Edit</button></div>' +
        '<div><b>' + esc([l.Teacher, l.Instrument].filter(Boolean).join(' · ')) + '</b></div>' +
        '<div class="muted">' + esc([l['Day and time'], l.Frequency, money(l['Monthly cost'])].filter(Boolean).join(' · ')) + '</div>' +
        (l['Schedule notes'] ? '<div class="muted" style="margin-top:4px">' + esc(l['Schedule notes']) + '</div>' : '') +
        setupPills(l) + '</div>'
      : '';
    if (cardHtml) $('.actions', main).insertAdjacentHTML('beforebegin', cardHtml);
    if (!l && p.id && tab === 'details') {
      main.insertAdjacentHTML('beforeend', '<button class="btn" type="button" data-open-lesson style="width:100%;margin-bottom:24px">Set up private lessons</button>');
    }
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
    api('lessons').then(function (rows) {
      lessonsState.rows = rows;
      var teachers = rows.map(function (r) { return r.Teacher; }).filter(Boolean)
        .filter(function (t, i, a) { return a.indexOf(t) === i; }).sort();
      $('#teacher-filter').innerHTML = '<option value="">All teachers</option>' +
        teachers.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('');
      $('#teacher-filter').value = lessonsState.teacher;
      $('#teacher-names').innerHTML = teachers.map(function (t) { return '<option value="' + esc(t) + '">'; }).join('');
      renderLessons();
    }).catch(function (e) { $('#lesson-list').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
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
      '<div class="stat"><div class="n">' + sched + '</div><div class="l">Scheduling</div></div>';
    var rows = byTeacher.filter(function (r) { return !lessonsState.stage || r.Stage === lessonsState.stage; });
    if (!rows.length) { $('#lesson-list').innerHTML = '<div class="empty">No one here.</div>'; return; }
    $('#lesson-list').innerHTML = rows.map(function (r) {
      var href = r['MMS ID'] ? '#p/' + encodeURIComponent(r['MMS ID']) : '';
      var when = [r['Day and time'], r.Frequency].filter(Boolean).join(' · ');
      return '<' + (href ? 'a href="' + href + '"' : 'div') + ' class="card lesson-row">' +
        '<div class="line1"><span class="name">' + esc(r.Name) + '</span><span class="cost">' + esc(money(r['Monthly cost'])) + '</span></div>' +
        '<div class="sub">' + esc([r.Teacher || 'No teacher yet', r.Instrument].filter(Boolean).join(' · ')) + '</div>' +
        (when ? '<div class="sub">' + esc(when) + '</div>' : '') +
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
      loadPerson(current.id);
    }).catch(function (err) { toast(err.message); })
      .then(function () { btn.disabled = false; btn.textContent = 'Save'; });
  });

  function timelineHtml(p) {
    // Fold opens and clicks into the email they belong to.
    var stats = {};
    p.timeline.forEach(function (t) {
      if (t.kind === 'email-open' || t.kind === 'email-click') {
        var k = t.sequence + '|' + t.step, s = stats[k] = stats[k] || { o: 0, c: 0 };
        if (t.kind === 'email-open') s.o++; else s.c++;
      }
    });
    var items = p.timeline.filter(function (t) { return t.kind !== 'email-open' && t.kind !== 'email-click'; });
    if (!items.length) return '<div class="empty">Nothing here yet.</div>';
    return '<ul class="tl">' + items.map(function (t) {
      var head, body = t.text || '', extra = '';
      switch (t.kind) {
        case 'note': head = 'Note' + (t.author ? ' · ' + t.author.split('@')[0] : ''); break;
        case 'next_step': head = 'Next step set' + (t.due ? ' · due ' + dayOnly(t.due) : '') + (t.owner ? ' · ' + t.owner : ''); break;
        case 'email-sent':
          head = t.sequence + ' · step ' + t.step;
          var s = stats[t.sequence + '|' + t.step];
          if (s && s.o) extra += '<span class="pill">Opened' + (s.o > 1 ? ' ' + s.o + 'x' : '') + '</span>';
          if (s && s.c) extra += '<span class="pill good">Clicked</span>';
          break;
        case 'email-reply': head = 'Replied to ' + t.sequence; extra = '<span class="pill good">Replied</span>'; break;
        case 'mail-in': head = 'Email from them'; body = t.text + (t.snippet ? '\n' + t.snippet : ''); break;
        case 'mail-out': head = 'Email to them'; break;
        case 'signup': head = 'Sign-up form answers'; break;
        case 'call': head = 'Call or text' + (t.author ? ' · ' + String(t.author).split('@')[0] : ''); break;
        default: head = t.kind;
      }
      var inner = '<div class="head">' + esc(head) + ' · ' + esc(when(t.at)) + ' ' + extra + '</div>' +
        '<div class="body' + (t.kind === 'signup' || t.kind === 'mail-in' ? ' clip' : '') + '">' + esc(body) + '</div>';
      if (t.url) inner = '<a href="' + esc(t.url) + '" target="_blank" rel="noopener" style="color:inherit">' + inner + '</a>';
      return '<li><span class="dot ' + esc(t.kind) + '"></span><div style="min-width:0;flex:1">' + inner + '</div></li>';
    }).join('') + '</ul>';
  }

  function detailsHtml(p) {
    var f = [
      ['Email', p.email ? '<a href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a>' : ''],
      ['Phone', p.phone ? '<a href="tel:' + esc(String(p.phone).replace(/[^\d+]/g, '')) + '">' + esc(p.phone) + '</a>' : ''],
      ['Status', esc(p.status)],
      ['Started', esc(dayOnly(p.started))],
      ['Last lesson', esc(dayOnly(p.lastEvent))],
      ['Next lesson', esc(dayOnly(p.nextEvent))],
      ['Skill', esc(p.skill)],
      ['Instruments', esc(p.instruments.join(', '))],
      ['Programs', esc(p.programs.join(', '))],
      ['Other tags', esc(p.tags.join(', '))]
    ].filter(function (r) { return r[1]; });
    var html = funnelHtml(p) + '<dl class="facts">' + f.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('') + '</dl>';
    if (p.sequences.length) {
      html += '<div class="section-title">Sequences</div><ul class="tl">' + p.sequences.map(function (s) {
        return '<li><span class="dot email-sent"></span><div><div class="head">' + esc(s.sequence) + ' · ' + esc(s.status) + '</div>' +
          '<div class="body">Opens ' + esc(s.opens || 0) + ' · Clicks ' + esc(s.clicks || 0) +
          (s.repliedAt ? ' · Replied ' + esc(dayOnly(s.repliedAt)) : '') + '</div></div></li>';
      }).join('') + '</ul>';
    }
    if (p.threads.length) {
      html += '<div class="section-title">Email threads</div><ul class="tl">' + p.threads.map(function (t) {
        return '<li><span class="dot ' + (t.theyWroteLast ? 'mail-in' : 'mail-out') + '"></span><div><div class="head">' +
          esc(when(t.last)) + ' · ' + esc(t.count) + ' message' + (t.count === 1 ? '' : 's') +
          (t.theyWroteLast ? ' · <span class="pill accent">Waiting on us</span>' : '') + '</div><div class="body">' + esc(t.subject) + '</div></div></li>';
      }).join('') + '</ul>';
    }
    return html;
  }

  $('#person').addEventListener('click', function (e) {
    var tab = e.target.closest('[data-tab]');
    if (tab && current) { renderPerson(current, tab.dataset.tab); return; }
    var open = e.target.closest('[data-open]');
    if (open) openSheet(open.dataset.open);
  });

  // ---------- Note sheet ----------
  var noteKind = 'note';
  function setKind(k) {
    noteKind = k;
    $$('.seg-btn').forEach(function (b) { b.classList.toggle('on', b.dataset.kind === k); });
    $('.next-only').hidden = k !== 'next_step';
    $('#note-text').placeholder = k === 'next_step' ? 'What should happen next' : 'What happened';
  }
  function openSheet(kind) {
    setKind(kind);
    $('#note-text').value = '';
    $('#note-due').value = '';
    $('#note-owner').value = me && me.given_name ? me.given_name : '';
    $('#sheet').hidden = false;
    setTimeout(function () { $('#note-text').focus(); }, 50);
  }
  function closeSheet() { $('#sheet').hidden = true; }
  $$('.seg-btn').forEach(function (b) { b.addEventListener('click', function () { setKind(b.dataset.kind); }); });
  $('#note-cancel').addEventListener('click', closeSheet);
  $('#sheet').addEventListener('click', function (e) { if (e.target === this) closeSheet(); });
  $('#note-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!current) return;
    var btn = $('#note-save'); btn.disabled = true; btn.textContent = 'Saving';
    api('note', {
      sid: current.id, email: current.email, kind: noteKind, text: $('#note-text').value,
      due: noteKind === 'next_step' ? $('#note-due').value : '', owner: noteKind === 'next_step' ? $('#note-owner').value : ''
    }).then(function () {
      closeSheet(); toast(noteKind === 'next_step' ? 'Next step saved' : 'Note saved');
      loadPerson(current.id || current.email);
    }).catch(function (err) { toast(err.message); })
      .then(function () { btn.disabled = false; btn.textContent = 'Save'; });
  });

  // ---------- Today ----------
  var todayState = { data: null, at: 0 };
  function loadToday(force) {
    var now = new Date();
    $('#today-date').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    var h = now.getHours();
    $('#today-hello').textContent = (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening') + (me && me.given_name ? ', ' + me.given_name : '');
    if (todayState.data && !force && Date.now() - todayState.at < 120000) { renderToday(); return; }
    if (!todayState.data) $('#today').innerHTML = '<div class="loading">Loading</div>';
    api('today').then(function (d) { todayState.data = d; todayState.at = Date.now(); renderToday(); })
      .catch(function (e) { $('#today').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }
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
        '<div class="pills"><span class="pill open">Open: ' + esc(openText(g.open)) + '</span></div></a>';
    }).join('') + '</div>' : '<div class="empty small-empty">Every group is full.</div>');
    $('#today').innerHTML = html;
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
    api('leads').then(function (d) {
      leadsState.rows = d.leads; leadsState.enrolled = d.enrolled || [];
      leadsState.stale = d.stale || {}; leadsState.boardDays = d.boardDays || 60; renderLeads();
    }).catch(function (e) { $('#lead-list').innerHTML = $('#lead-board').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
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
    if (!rows.length) { $('#lead-list').innerHTML = '<div class="empty">No one here. Try another view or clear a filter.</div>'; $('#lead-more').hidden = true; return; }
    $('#lead-list').innerHTML = rows.slice(0, leadsState.show).map(function (l) {
      var u = urgency(l);
      var bits = [allInstruments(l).join(', '), allInterests(l).join(', '), l.nights.join(' ')].filter(Boolean).join(' · ');
      var nx = l.next ? '<div class="nx ' + u + '">' + esc(l.next.text) + (l.next.due ? ' · ' + (u === 'overdue' ? 'was due ' : 'due ') + esc(dayOnly(l.next.due)) : '') + (l.next.owner ? ' · ' + esc(l.next.owner) : '') + '</div>'
        : '<div class="nx none">No next step</div>';
      var meta = [l.started ? 'Signed up ' + when(l.started) : '', l.lastContact ? 'last note ' + when(l.lastContact) : 'never contacted', l.form.source ? 'via ' + l.form.source : ''].filter(Boolean).join(' · ');
      return '<a class="card lead-row" href="#p/' + encodeURIComponent(l.id) + '">' +
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
      return '<section class="kcol" data-col="' + esc(c) + '"><header class="kh"><span class="kt">' + esc(c) + '</span><span class="kn">' + n +
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
      '<label class="flabel">Stage<select class="field" id="lt-stage">' +
      (stage ? '' : '<option value="">Enrolled (from MMS status)</option>') +
      LEAD.stages.map(function (s) { return '<option' + (s === stage ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select></label>' +
      grp('Interested in · pick any', 'interest', LEAD.interests, pick('Interest: ')) +
      grp('Nights they can do', 'nights', LEAD.nights, pick('Nights: ')) +
      grp('Plays', 'instrument', LEAD.instruments, p.instruments || []) +
      '<button type="button" class="btn primary" data-place style="width:100%;margin-top:4px">Convert to member</button>' +
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
      leadsState.rows = null; groupsState.rows = null;
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
        toast('Done'); leadsState.rows = null; loadPerson(current.id || current.email);
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
        loadPerson(current.id);
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
      loadPerson(current.id);
    }).catch(function (err) { toast(err.message); })
      .then(function () { btn.disabled = false; btn.textContent = 'Convert'; });
  });
  $('#person').addEventListener('click', function (e) { if (e.target.closest('[data-place]')) openPlace(); });

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
        loadPerson(current.id);
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
    api('groups').then(function (rows) { groupsState.rows = rows; renderGroups(); })
      .catch(function (e) { $('#group-list').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
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
    api('group', { name: name }).then(function (g) {
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
      if (g.open.length) {
        html += '<div class="section-title">Could fill it</div>' +
          (g.matches.length ? '<div class="list">' + g.matches.map(function (p) {
            return personRow(p, p.started ? 'since ' + dayOnly(p.started) : '');
          }).join('') + '</div>' : '<div class="empty">No waiting students or recent leads play ' + esc(openText(g.open)) + '.</div>');
      }
      html += '<div class="section-title">' + (g.when === 'Past' ? 'Took part' : 'Members') + ' · ' + g.memberList.length + '</div>' +
        (g.memberList.length ? '<div class="list">' + g.memberList.map(function (p) { return personRow(p); }).join('') + '</div>' : '<div class="empty">No one active has this tag.</div>');
      if (g.otherList.length) {
        html += '<div class="section-title">Also tagged · ' + g.otherList.length + '</div><div class="list">' +
          g.otherList.map(function (p) { return personRow(p); }).join('') + '</div>';
      }
      html += '<p class="muted small">From the "' + esc(g.name) + '" tag in MyMusicStaff. Schedule, teacher, level and seats come from the Groups tab in the Sequencer sheet.</p>';
      main.innerHTML = html;
    }).catch(function (e) { main.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }

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
    if (h.indexOf('p/') === 0) { nav(null); $('#v-person .back').href = backTo; $('#v-person .back').innerHTML = '&#8249; ' + (backTo === '#lessons' ? 'Lessons' : backTo === '#groups' ? 'Groups' : backTo === '#leads' ? 'Leads' : backTo === '#today' ? 'Today' : backTo.indexOf('#g/') === 0 ? decodeURIComponent(backTo.slice(3)) : 'People'); show('v-person'); loadPerson(decodeURIComponent(h.slice(2))); return; }
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
