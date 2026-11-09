/*
 * Spreadsheet-style tables for People and the Leads list, on Tabulator (tabulator.info,
 * MIT, loaded pinned from jsDelivr). Columns can be resized, dragged into a new order and
 * shown or hidden; each browser remembers its layout. Status, interests, instruments and
 * nights edit in place and save to MyMusicStaff as the same tags the person page writes.
 *
 * app.js calls NSJWGrid.people(...) / NSJWGrid.leads(...) when window.Tabulator exists and
 * falls back to its own simple table when it does not.
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function initials(name) {
    var p = String(name || '?').replace(/\([^)]*\)/g, ' ').replace(/[^\p{L}\s'-]/gu, ' ').trim().split(/\s+/);
    return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }
  function day(v) {
    if (!v) return '';
    var d = new Date(String(v).slice(0, 10) + 'T12:00:00');
    return isNaN(d) ? String(v) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function pill(s) {
    if (!s) return '';
    return '<span class="pill ' + esc(String(s).toLowerCase().replace(/\s+/g, '-')) + '">' + esc(s) + '</span>';
  }
  function joinList(v) { return (v || []).map(function (t) { return t === 'Classes' ? 'Class' : t; }).join(', '); }

  var STAGE_DOT = { 'First Contact': '#5B7A99', 'Qualified': '#C8913F', 'Committed': '#204E46', 'Enrolled': '#2F5B3E', 'Closed': '#8C8B80', 'Nurture': '#9A86B8' };

  // ---- editors ----
  var editingStage = function (cell) {
    var s = cell.getRow().getData().status;
    return s !== 'Active' && s !== 'Inactive';
  };
  function stageFormatter(cell) {
    var d = cell.getRow().getData();
    if (d.status === 'Active' || d.status === 'Inactive') return pill(d.status);
    var v = d.stage || 'First Contact';
    return '<span class="g-dd"><span class="kdot" style="background:' + (STAGE_DOT[v] || '#8C8B80') + '"></span>' + esc(v) + '<svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></span>' +
      (d.status === 'Waiting' || d.status === 'Trial' ? '<span class="g-note">' + esc(d.status) + '</span>' : '');
  }
  function listFormatter(fallbackField) {
    return function (cell) {
      var v = cell.getValue() || [];
      if (v.length) return '<span class="g-list">' + esc(joinList(v)) + '</span>';
      var fb = fallbackField ? cell.getRow().getData()[fallbackField] : null;
      if (fb && fb.length) return '<span class="g-list g-form" title="From their sign-up form. Edit to save it as a tag.">' + esc(joinList(fb)) + '</span>';
      return '<span class="g-add">Add</span>';
    };
  }
  var tagsKnown = function (cell) { return cell.getRow().getData().tagsKnown !== false; };
  function multi(values) {
    return { values: values, multiselect: true, clearable: false };
  }

  // Each tick or untick becomes one MMS tag write; on a failure the cell goes back.
  function tagEdits(hooks, field) {
    return function (cell) {
      var row = cell.getRow().getData();
      var before = cell.getOldValue() || [], after = cell.getValue() || [];
      if (!Array.isArray(after)) after = after ? [after] : [];
      var adds = after.filter(function (x) { return before.indexOf(x) < 0; });
      var dels = before.filter(function (x) { return after.indexOf(x) < 0; });
      var jobs = adds.map(function (v) { return [v, true]; }).concat(dels.map(function (v) { return [v, false]; }));
      if (!jobs.length) return;
      cell.getElement().classList.add('g-saving');
      jobs.reduce(function (p, j) { return p.then(function () { return hooks.save(row, field, j[0], j[1]); }); }, Promise.resolve())
        .then(function () { cell.getElement().classList.remove('g-saving'); hooks.saved(row, field); })
        .catch(function (e) { cell.getElement().classList.remove('g-saving'); cell.restoreOldValue(); hooks.failed(e); });
    };
  }
  function stageEdited(hooks) {
    return function (cell) {
      var row = cell.getRow().getData(), v = cell.getValue();
      if (!v || v === cell.getOldValue()) return;
      // Closed needs a reason: put the old stage back and let the app ask why first.
      if (v === 'Closed' && hooks.askClose) { cell.restoreOldValue(); hooks.askClose(row); return; }
      if (v === 'Enrolled' && hooks.askEnroll) { cell.restoreOldValue(); hooks.askEnroll(row); return; }
      var el = cell.getElement(); if (el) el.classList.add('g-saving');
      function unmark() { try { var x = cell.getElement(); if (x) x.classList.remove('g-saving'); } catch (e) {} }
      hooks.save(row, 'stage', v, true, cell.getOldValue())
        .then(function () { unmark(); hooks.saved(row, 'stage', v); })
        .catch(function (e) { unmark(); try { cell.restoreOldValue(); } catch (x) {} hooks.failed(e); });
    };
  }

  function nameCol(extra) {
    return Object.assign({
      title: 'Name', field: 'name', minWidth: 160, widthGrow: 2,
      formatter: function (cell) {
        var d = cell.getRow().getData();
        return (d.urgency ? '<span class="lz ' + esc(d.urgency) + '"></span>' : '') +
          '<span class="avatar sm">' + esc(initials(d.name)) + '</span><span class="g-name">' + esc(d.name) + '</span>';
      },
      cellClick: function (e, cell) { location.hash = '#p/' + encodeURIComponent(cell.getRow().getData().id); }
    }, extra || {});
  }
  var selectCol = {
    formatter: 'rowSelection', titleFormatter: 'rowSelection', hozAlign: 'center', headerSort: false,
    width: 44, minWidth: 44, widthGrow: 0, resizable: false, headerHozAlign: 'center', field: '_sel', titleFormatterParams: { rowRange: 'active' }
  };

  function build(el, cfg) {
    if (el._grid) return el._grid;
    var t = new Tabulator(el, {
      data: [], index: 'id', layout: 'fitColumns', height: false,
      movableColumns: true, resizableColumnFit: false,
      persistence: { columns: ['width', 'visible'], sort: false, filter: false },
      persistenceID: cfg.id + '-v2', persistenceMode: 'local',
      pagination: cfg.paginate ? true : false, paginationSize: cfg.per || 25, paginationSizeSelector: cfg.paginate ? [25, 50, 100] : false,
      paginationCounter: cfg.paginate ? 'rows' : false,
      selectableRows: 'highlight', selectableRowsPersistence: false,
      placeholder: cfg.empty || 'No one matches.',
      columnDefaults: { headerSortTristate: false, vertAlign: 'middle', tooltip: false, variableHeight: true },
      initialSort: cfg.sort ? [cfg.sort] : [],
      columns: cfg.columns
    });
    t.on('rowSelectionChanged', function (data) { if (cfg.onSelect) cfg.onSelect(data); });
    t.on('rowClick', function (e, row) {
      if (e.target.closest('.tabulator-cell[tabulator-field="_sel"], .tabulator-editable, input, select')) return;
      location.hash = cfg.href ? cfg.href(row.getData()) : '#p/' + encodeURIComponent(row.getData().id);
    });
    t.on('cellEditing', function (cell) {
      el.classList.add('g-editing');
      var single = cell.getField() === 'stage';
      setTimeout(function () { var l = document.querySelector('.tabulator-edit-list'); if (l) l.classList.toggle('g-single', single); }, 0);
    });
    t.on('cellEditCancelled', function () { el.classList.remove('g-editing'); });
    t.on('cellEdited', function () { el.classList.remove('g-editing'); });
    el._grid = t;
    el._ready = new Promise(function (res) { t.on('tableBuilt', res); });
    return t;
  }

  // Column chooser: a small checklist next to the table
  function columnsButton(btn, grid) {
    if (btn._wired) return; btn._wired = true;
    var pop = document.createElement('div'); pop.className = 'g-colpop'; pop.hidden = true; document.body.appendChild(pop);
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!pop.hidden) { pop.hidden = true; return; }
      pop.innerHTML = '<div class="cp-h">Show columns</div>' + grid.getColumns().filter(function (c) {
        var d = c.getDefinition(); return d.title && !d.frozen;
      }).map(function (c) {
        return '<label class="cp-row"><input type="checkbox" data-col="' + esc(c.getField()) + '"' + (c.isVisible() ? ' checked' : '') + '> ' + esc(c.getDefinition().title) + '</label>';
      }).join('') + '<p class="cp-note">Drag a column header to move it. Drag its edge to resize.</p>';
      var r = btn.getBoundingClientRect();
      pop.hidden = false;
      pop.style.top = (r.bottom + 4) + 'px';
      pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth)) + 'px';
    });
    pop.addEventListener('change', function (e) {
      var c = e.target.dataset.col; if (!c) return;
      if (e.target.checked) grid.showColumn(c); else grid.hideColumn(c);
    });
    document.addEventListener('mousedown', function (e) { if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) pop.hidden = true; });
  }

  function setRows(grid, el, rows, picked, sort) {
    return el._ready.then(function () {
      var y = window.scrollY;
      return grid.replaceData(rows).then(function () {
        if (sort && el._sortKey !== sort.column + sort.dir) { el._sortKey = sort.column + sort.dir; grid.setSort(sort.column, sort.dir); }
        var ids = Object.keys(picked || {}).filter(function (id) { return grid.getRow(id); });
        el._quiet = true; if (ids.length) grid.selectRow(ids); el._quiet = false;
        window.scrollTo(0, y);
      });
    });
  }

  var LIST = function (h) { return h.LEAD; };

  window.NSJWGrid = {
    groups: function (el, rows, h) {
      var grid = build(el, {
        id: 'nsjw-groups', empty: 'No groups match. Try another filter.',
        href: function (d) { return '#g/' + encodeURIComponent(d.id); },
        sort: { column: 'order', dir: 'asc' },
        columns: [
          { title: 'Group', field: 'order', minWidth: 120, widthGrow: 2, sorter: 'number', formatter: function (c) {
            var d = c.getRow().getData(); return '<span class="g-name">' + esc(d.id) + '</span>' + (d.kind !== 'Ensemble' ? '<span class="g-note">' + esc(d.kind) + '</span>' : ''); } },
          { title: 'When', field: 'when', minWidth: 140, widthGrow: 2, formatter: function (c) {
            var v = String(c.getValue() || ''), i = v.indexOf(' · ');
            return '<span class="g-list" title="' + esc(v) + '">' + esc(i > 0 ? v.slice(0, i) : v) + (i > 0 ? '<span class="g-note">' + esc(v.slice(i + 3).replace(/^weeks? /, 'wk ')) + '</span>' : '') + '</span>'; } },
          { title: 'Teacher', field: 'teacher', minWidth: 110, widthGrow: 1 },
          { title: 'Level', field: 'level', minWidth: 64, widthGrow: 0, sorter: 'number' },
          { title: 'Filled', field: 'fill', minWidth: 116, widthGrow: 1, sorter: 'number', formatter: function (c) {
            var d = c.getRow().getData();
            if (!d.capacity) return '<span class="num">' + d.members + '</span><span class="g-note">people</span>';
            return '<span class="g-fill"><span class="g-bar"><span style="width:' + Math.round(100 * d.fill) + '%"></span></span><span class="num">' + (d.capacity - d.openN) + '/' + d.capacity + '</span></span>'; } },
          { title: 'Open seats', field: 'openN', minWidth: 150, widthGrow: 2, sorter: 'number', formatter: function (c) {
            var d = c.getRow().getData(), L = d.openList;
            return L.length ? '<span class="g-tags" title="' + esc(L.join(', ')) + '">' + L.slice(0, 2).map(function (o) { return '<span class="tag open">' + esc(o) + '</span>'; }).join('') + (L.length > 2 ? '<span class="g-more">+' + (L.length - 2) + '</span>' : '') + '</span>' : (d.capacity ? '<span class="g-add">Full</span>' : ''); } },
          { title: 'Next rehearsal', field: 'next', minWidth: 100, widthGrow: 1, formatter: function (c) { return esc(c.getRow().getData().nextText || ''); } },
          { title: 'Needs a look', field: 'checkN', minWidth: 130, widthGrow: 2, sorter: 'number', formatter: function (c) {
            var d = c.getRow().getData(); return d.checks.length ? '<span class="g-chk" title="' + esc(d.checks.join('. ')) + '">' + esc(d.checks[0]) + (d.checks.length > 1 ? ' +' + (d.checks.length - 1) : '') + '</span>' : ''; } },
          { title: 'People', field: 'members', minWidth: 80, widthGrow: 1, sorter: 'number', visible: false }
        ]
      });
      columnsButton(h.colsBtn, grid);
      return setRows(grid, el, rows, {}, null);
    },
    people: function (el, rows, h) {
      var L = LIST(h);
      var grid = build(el, {
        id: 'nsjw-people-v1', paginate: true, per: h.per, empty: 'No one matches. Try another view or clear a filter.',
        onSelect: function (data) { if (!el._quiet) h.onSelect(data); },
        columns: [
          selectCol,
          nameCol(),
          { title: 'Contact', field: 'email', minWidth: 160, widthGrow: 2, formatter: function (cell) {
            var d = cell.getRow().getData();
            return '<span class="g-ln" title="' + esc(d.email) + '">' + esc(d.email) + '</span>' + (d.phone ? '<span class="g-ln g-sub">' + esc(d.phone) + '</span>' : '');
          } },
          { title: 'Status', field: 'stage', minWidth: 150, widthGrow: 1, editor: 'list', editable: editingStage,
            editorParams: { values: L.stages, listOnEmpty: true }, formatter: stageFormatter, cellEdited: stageEdited(h),
            sorter: function (a, b, ra, rb) { var x = ra.getData(), y = rb.getData(); return String(x.status === 'Lead' ? x.stage : x.status).localeCompare(String(y.status === 'Lead' ? y.stage : y.status)); } },
          { title: 'Programs', field: 'programsText', minWidth: 110, widthGrow: 1, formatter: function (c) { return '<span class="g-list">' + esc(c.getValue()) + '</span>'; } },
          { title: 'Interested in', field: 'interests', minWidth: 130, widthGrow: 1, editor: 'list', editorParams: multi(L.interests), editable: tagsKnown,
            formatter: listFormatter('tracks'), cellEdited: tagEdits(h, 'interest'), sorter: function (a, b) { return joinList(a).localeCompare(joinList(b)); } },
          { title: 'Plays', field: 'instruments', minWidth: 110, widthGrow: 1, editor: 'list', editorParams: multi(L.instruments),
            formatter: listFormatter('formInstruments'), cellEdited: tagEdits(h, 'instrument'), sorter: function (a, b) { return joinList(a).localeCompare(joinList(b)); } },
          { title: 'Nights', field: 'nights', minWidth: 110, widthGrow: 1, visible: false, editor: 'list', editorParams: multi(L.nights), editable: tagsKnown,
            formatter: listFormatter(), cellEdited: tagEdits(h, 'nights') },
          { title: 'Source', field: 'source', minWidth: 140, widthGrow: 1, visible: false },
          { title: 'Created', field: 'created', minWidth: 105, widthGrow: 1, formatter: function (c) { return esc(day(c.getValue())); } },
          { title: 'Last activity', field: 'lastActivity', minWidth: 115, widthGrow: 1, formatter: function (c) { return esc(h.actText(c.getValue()) || 'None yet'); } }
        ]
      });
      columnsButton(h.colsBtn, grid);
      return setRows(grid, el, rows, h.picked, h.sort);
    },

    leads: function (el, rows, h) {
      var L = LIST(h);
      var grid = build(el, {
        id: 'nsjw-leads-v2', paginate: true, per: 50, empty: 'No one here. Try another view or clear a filter.',
        onSelect: function (data) { if (!el._quiet) h.onSelect(data); },
        columns: [
          selectCol,
          { title: 'Name', field: 'name', minWidth: 160, widthGrow: 2, formatter: function (cell) { return '<span class="g-name b">' + esc(cell.getValue()) + '</span>'; },
            cellClick: function (e, cell) { location.hash = '#p/' + encodeURIComponent(cell.getRow().getData().id); } },
          { title: 'Stage', field: 'stage', minWidth: 170, widthGrow: 1, editor: 'list', editable: editingStage,
            editorParams: { values: ['First Contact', 'Qualified', 'Committed', 'Enrolled', 'Nurture', 'Closed'], itemFormatter: function (label, value) {
              var note = value === 'Closed' ? 'Asks why' : value === 'Enrolled' ? 'Convert to member' : h.stageNote ? h.stageNote(value) : '';
              return '<span class="g-opt"><span class="kdot" style="background:' + (STAGE_DOT[value] || '#8C8B80') + '"></span>' + esc(label) + (note ? '<span class="g-optnote">' + esc(note) + '</span>' : '') + '</span>';
            } },
            formatter: function (cell) { var v = cell.getValue() || 'First Contact'; return '<span class="g-dd"><span class="kdot" style="background:' + (STAGE_DOT[v] || '#8C8B80') + '"></span>' + esc(v) + '<svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></span>'; },
            cellEdited: stageEdited(h) },
          { title: 'Interested in', field: 'interests', minWidth: 150, widthGrow: 2, editor: 'list', editorParams: multi(L.interests),
            formatter: function (cell) {
              var d = cell.getRow().getData(), v = d.interests && d.interests.length ? d.interests : d.formInterests || [];
              return v.length ? '<span class="g-tags" title="' + esc(v.join(', ')) + '">' + v.slice(0, 2).map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') + (v.length > 2 ? '<span class="g-more">+' + (v.length - 2) + '</span>' : '') + '</span>' : '<span class="g-add">Add</span>';
            }, cellEdited: tagEdits(h, 'interest') },
          { title: 'Plays', field: 'instruments', minWidth: 110, widthGrow: 1, editor: 'list', editorParams: multi(L.instruments),
            formatter: listFormatter('formInstruments'), cellEdited: tagEdits(h, 'instrument') },
          { title: 'Value', field: 'value', minWidth: 90, widthGrow: 1, cssClass: 'g-nowrap', sorter: 'number', formatter: function (cell) { var t = cell.getRow().getData().valueText; return t ? '<b class="num">' + esc(t) + '</b>' : '<span class="g-add">--</span>'; } },
          { title: 'Next task', field: 'nextDue', minWidth: 220, widthGrow: 3, sorter: function (a, b, ra, rb) { var x = ra.getData(), y = rb.getData(); return String(x.nextDue || '9999').localeCompare(String(y.nextDue || '9999')); },
            formatter: function (cell) {
              var d = cell.getRow().getData(), late = d.urgency === 'overdue' || (!d.nextText && d.stale);
              if (!d.nextText) return '<span class="g-task"><span class="ring' + (late ? ' late' : '') + '"></span><span class="g-none' + (late ? ' late' : '') + '">No task set</span></span>';
              return '<span class="g-task"><span class="ring' + (late ? ' late' : '') + '"></span><span class="g-tt">' + esc(d.nextText) + '</span>' + (d.dueText ? '<b class="' + (late ? 'late' : '') + '">' + esc(d.dueText) + '</b>' : '') + '</span>';
            } },
          { title: 'Last heard', field: 'lastContact', minWidth: 100, widthGrow: 1, formatter: function (c) { return esc(c.getRow().getData().heard); } },
          { title: 'In stage', field: 'inStage', minWidth: 80, widthGrow: 1, sorter: 'number', formatter: function (c) {
            var n = c.getValue(), d = c.getRow().getData(); return n == null ? '' : '<span class="num' + (d.stale ? ' late' : '') + '">' + n + 'd</span>'; } },
          { title: 'Nights', field: 'nights', minWidth: 110, widthGrow: 1, visible: false, editor: 'list', editorParams: multi(L.nights),
            formatter: listFormatter(), cellEdited: tagEdits(h, 'nights') },
          { title: 'Signed up', field: 'started', minWidth: 105, widthGrow: 1, visible: false, formatter: function (c) { return esc(day(c.getValue())); } },
          { title: 'Source', field: 'source', minWidth: 140, widthGrow: 1, visible: false },
          { title: 'Contact', field: 'email', minWidth: 140, widthGrow: 2, visible: false, formatter: function (cell) {
            var d = cell.getRow().getData();
            return '<span class="g-ln">' + esc(d.email) + '</span>' + (d.phone ? '<span class="g-ln g-sub">' + esc(d.phone) + '</span>' : '');
          } }
        ]
      });
      columnsButton(h.colsBtn, grid);
      return setRows(grid, el, rows, h.picked, null);
    }
  };
})();
