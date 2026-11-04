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

  // ---------- People ----------
  var peopleState = { q: '', status: '', seq: 0 };

  function loadPeople() {
    var mySeq = ++peopleState.seq, list = $('#people-list');
    list.innerHTML = '<div class="loading">Loading</div>';
    api('people', { q: peopleState.q, status: peopleState.status }).then(function (rows) {
      if (mySeq !== peopleState.seq) return;
      if (!rows.length) { list.innerHTML = '<div class="empty">No one matches that.</div>'; return; }
      list.innerHTML = rows.map(function (r) {
        var sub = [r.instruments, r.programs].filter(Boolean).join(' · ') || r.email || '';
        return '<a class="card person-row" href="#p/' + encodeURIComponent(r.id) + '">' +
          '<div class="avatar">' + esc(initials(r.name)) + '</div>' +
          '<div class="who"><div class="name">' + esc(r.name) + '</div><div class="sub">' + esc(sub.replace(/;/g, ',')) + '</div></div>' +
          statusPill(r.status) + '</a>';
      }).join('');
    }).catch(function (e) {
      if (mySeq === peopleState.seq) list.innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
    });
  }

  var qTimer;
  $('#q').addEventListener('input', function (e) {
    clearTimeout(qTimer);
    qTimer = setTimeout(function () { peopleState.q = e.target.value.trim(); store('nsjw_q', peopleState.q); loadPeople(); }, 250);
  });
  $('#status-chips').addEventListener('click', function (e) {
    var b = e.target.closest('.chip'); if (!b) return;
    $$('.chip', this).forEach(function (c) { c.classList.toggle('on', c === b); });
    peopleState.status = b.dataset.status; store('nsjw_status', peopleState.status);
    loadPeople();
  });
  $('#signout').addEventListener('click', signOut);

  // ---------- Person ----------
  var current = null;

  function loadPerson(sid) {
    var main = $('#person');
    main.innerHTML = '<div class="loading">Loading</div>';
    $('#mms-link').hidden = true;
    api('person', { sid: sid }).then(function (p) {
      current = p;
      renderPerson(p, 'timeline');
    }).catch(function (e) { main.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }

  // Lead stage, one tap to change, right under the name. Hidden once they are an active member.
  function stageStrip(p) {
    if (!p.id || p.status === 'Active') return '';
    var cur = ((p.tags || []).filter(function (t) { return /^Stage: /.test(t); })[0] || '').slice(7) ||
      (p.status === 'Inactive' ? 'Closed' : 'New Lead');
    return '<div class="pstage-h">Stage · tap to change</div><div class="stagebar pstage">' +
      LEAD.stages.map(function (s) {
        return '<button type="button" class="stagechip' + (s === cur ? ' on' : '') + '" data-stage="' + esc(s) + '"' +
          (s === cur ? ' aria-pressed="true"' : '') + '><span>' + esc(s === 'Deposit Submitted' ? 'Deposit' : s) + '</span></button>';
      }).join('') + '</div>';
  }

  function renderPerson(p, tab) {
    var main = $('#person');
    var subBits = [p.instruments.join(', '), p.skill ? 'Skill ' + p.skill : '', p.started ? 'Since ' + dayOnly(p.started) : ''].filter(Boolean);
    var pills = [statusPill(p.status)]
      .concat(p.programs.map(function (t) { return '<span class="pill accent">' + esc(t) + '</span>'; }))
      .concat(p.tags.filter(function (t) { return /^Stage: /.test(t); }).map(function (t) { return '<span class="pill accent">' + esc(t.slice(7)) + '</span>'; }))
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
      stageStrip(p) +
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
  function renderToday() {
    var d = todayState.data, s = d.stats, html = '';
    html += '<div class="stats">' +
      '<div class="stat"><div class="n">' + s.active + '</div><div class="l">Active</div></div>' +
      '<div class="stat"><div class="n">+' + s.joined + '</div><div class="l">Joined this month</div></div>' +
      '<div class="stat"><div class="n">' + s.leads + '</div><div class="l">Open leads</div></div>' +
      '<div class="stat"><div class="n">' + s.seats + '</div><div class="l">Open seats</div></div></div>';
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
    stages: ['New Lead', 'Qualified', 'Deposit Submitted', 'Nurture', 'Closed'],
    interests: ['Ensemble', 'Private lessons', 'Foundations', 'Classes', 'Clinics', 'Voice'],
    nights: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    instruments: ['Sax', 'Trumpet', 'Trombone', 'Flute', 'Piano/Keys', 'Guitar', 'Bass', 'Drums', 'Voice', 'Violin', 'French Horn', 'Harmonica']
  };
  var leadsState = { rows: null, view: store('nsjw_lview') || 'action', stage: '', q: '', show: 60,
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
    $('#lead-list').innerHTML = '<div class="loading">Loading</div>';
    api('leads').then(function (d) { leadsState.rows = d.leads; renderLeads(); })
      .catch(function (e) { $('#lead-list').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
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
    var all = (leadsState.rows || []).filter(leadMatches);
    var month = new Date(); month.setDate(1); month = new Date(month.toDateString());
    var counts = {};
    all.forEach(function (l) { counts[l.stage] = (counts[l.stage] || 0) + 1; });
    $('#stagebar').innerHTML = LEAD.stages.map(function (s) {
      return '<button type="button" class="stagechip' + (leadsState.stage === s ? ' on' : '') + '" data-stage="' + esc(s) + '">' +
        '<b>' + (counts[s] || 0) + '</b><span>' + esc(s === 'Deposit Submitted' ? 'Deposit' : s) + '</span></button>';
    }).join('');
    var rows = all.filter(function (l) {
      if (leadsState.stage) return l.stage === leadsState.stage;
      if (l.stage === 'Closed' || l.stage === 'Enrolled') return false;
      var u = urgency(l);
      if (leadsState.view === 'action') return u === 'overdue' || u === 'today' || (u === 'none' && !l.notes && l.started && parse(l.started) >= new Date(Date.now() - 30 * 864e5)) || (l.stage === 'Deposit Submitted' && u === 'none');
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
    var stage = (tags.filter(function (t) { return /^Stage: /.test(t); })[0] || '').slice(7) || (p.status === 'Active' ? '' : 'New Lead');
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
      '<button type="button" class="btn primary" data-place style="width:100%;margin-top:4px">Place in a group</button>' +
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
        current.tags = current.tags.filter(function (t) { return !/^Stage: /.test(t); }).concat(value === 'New Lead' ? [] : ['Stage: ' + value]);
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

  // ---------- Place in a group ----------
  function openPlace() {
    if (!current || !current.id) return;
    $('#place-title').textContent = 'Place ' + current.name;
    var sel = $('#place-group');
    sel.innerHTML = '<option>Loading groups</option>'; sel.disabled = true;
    $('#place-sheet').hidden = false;
    var go = function (rows) {
      var mine = (current.instruments || []).map(function (i) { return seatOf(i); });
      var cur = rows.filter(function (g) { return g.when !== 'Past' && current.programs.indexOf(g.name) < 0; });
      cur.sort(function (a, b) {
        var fa = a.open.some(function (s) { return mine.indexOf(s) >= 0; }) ? 0 : 1, fb = b.open.some(function (s) { return mine.indexOf(s) >= 0; }) ? 0 : 1;
        return (fa - fb) || a.name.localeCompare(b.name, 'en', { numeric: true });
      });
      sel.innerHTML = cur.map(function (g) {
        var fit = g.open.some(function (s) { return mine.indexOf(s) >= 0; });
        return '<option value="' + esc(g.name) + '">' + esc(g.name) + (g.schedule ? ' · ' + esc(g.schedule) : '') +
          (g.open.length ? ' · open: ' + esc(openText(g.open)) : '') + (fit ? ' · fits' : '') + '</option>';
      }).join('');
      sel.disabled = false; placeSteps();
    };
    if (groupsState.rows) go(groupsState.rows);
    else api('groups').then(function (r) { groupsState.rows = r; go(r); }).catch(function (e) { toast(e.message); });
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
  function placeSteps() {
    var g = $('#place-group').value, steps = ['Add the "' + g + '" tag in MMS'];
    if (/^Group \d+/.test(g)) steps.push('Add the "Ensemble Member" tag (or tell you to, if MMS has teachers on it)');
    if ((current.tags || []).some(function (t) { return /^Stage: /.test(t); })) steps.push('Clear their funnel stage');
    if (current.status !== 'Active') steps.push('Change their MMS status from ' + current.status + ' to Active');
    steps.push('Log it on their timeline');
    $('#place-steps').innerHTML = steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
  }
  $('#place-group').addEventListener('change', placeSteps);
  $('#place-cancel').addEventListener('click', function () { $('#place-sheet').hidden = true; });
  $('#place-sheet').addEventListener('click', function (e) { if (e.target === this) this.hidden = true; });
  $('#place-go').addEventListener('click', function () {
    var btn = this, g = $('#place-group').value; if (!g) return;
    btn.disabled = true; btn.textContent = 'Placing';
    api('place', { sid: current.id, email: current.email, group: g }).then(function (r) {
      var manual = ((r && r.done) || []).filter(function (d) { return /^Add the/.test(d); });
      $('#place-sheet').hidden = true; toast(manual.length ? 'Placed. ' + manual[0] + '.' : 'Placed in ' + g);
      leadsState.rows = null; groupsState.rows = null; todayState.data = null;
      loadPerson(current.id);
    }).catch(function (err) { toast(err.message); })
      .then(function () { btn.disabled = false; btn.textContent = 'Place them'; });
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
    if (!$('#people-list').children.length) loadPeople();
  }
  window.addEventListener('hashchange', route);

  // ---------- start ----------
  peopleState.q = store('nsjw_q') || '';
  peopleState.status = store('nsjw_status') || '';
  $('#q').value = peopleState.q;
  $$('#status-chips .chip').forEach(function (c) { c.classList.toggle('on', c.dataset.status === peopleState.status); });
  var savedStage = store('nsjw_stage');
  if (savedStage !== null) lessonsState.stage = savedStage;
  lessonsState.teacher = store('nsjw_teacher') || '';
  $$('#stage-chips .chip').forEach(function (c) { c.classList.toggle('on', c.dataset.stage === lessonsState.stage); });
  setToken(store('nsjw_tok'));
  route();
  initGoogle();

  window.NSJW = { setToken: setToken, route: route }; // for testing
})();
