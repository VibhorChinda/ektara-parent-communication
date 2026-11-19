// ========================================================================================================
// EK TARA COMMUNICATIONS: SERVER CODE, ADMIN (Admin.gs)
// users and access, permissions, and setup().
// The project needs all four server files: Shared.gs, Parent.gs, Donor.gs, Admin.gs (any order).
// If you see "Identifier 'ApiError' has already been declared", an old Code.gs is still in the project: delete it.
// ========================================================================================================
// ===== Admin.gs =====
var BUILD_Admin = '20261107-1230'; // build stamp (see Build.gs)
/**
 * Users and access, managed from the app. Nobody needs to edit a sheet.
 *
 * Roles
 *   Master        the project owner (permanent: cannot be removed or locked out) and any masters the owner appoints.
 *                 Can do everything: manage users, see the access log, check and fix file sharing, and access all divisions.
 *   Staff         works in the departments they were given.
 * Every person can also have an end date, after which their access stops by itself.
 */
var PEOPLE_FILES = ['access', 'parent', 'donor'];
var FILE_LABELS = { access: 'Access file', parent: 'Parent database', donor: 'Donor database' };

function requireAdmin_(user) {
  if (!user || (user.role !== 'master')) throw new ApiError('Only masters can do this.', null, 403);
}
function requireMaster_(user) {
  if (!user || user.role !== 'master') throw new ApiError('Only a master administrator can do this.', null, 403);
}

function emailOk_(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); }

function publicUser_(r) {
  var email = String(r.email).toLowerCase(), owner = email === ownerEmail_(), role = owner ? 'master' : roleOf_(r.role);
  var legacy = !owner && r.parent_access === null && r.donor_access === null && r.org_overview === null;
  return { email: email, full_name: r.full_name || '', active: owner || !!r.active, role: role, owner: owner,
    parent_access: owner || role === 'master' || legacy || flag_(r.parent_access), donor_access: owner || role === 'master' || flag_(r.donor_access), org_overview: owner || role === 'master' || flag_(r.org_overview),
    expires_on: r.expires_on || null, expired: !owner && !!(r.expires_on && todayStr_() > r.expires_on) };
}

function listUsers_(actor) {
  requireAdmin_(actor);
  var rows = loadTable_('Admins').filter(function (r) { return r.email; }).map(publicUser_), owner = ownerEmail_();
  if (owner && !rows.some(function (u) { return u.email === owner; })) rows.push(publicUser_({ email: owner, full_name: '', active: true }));
  return rows.sort(function (a, b) { return Number(b.owner) - Number(a.owner) || Number(b.active) - Number(a.active) || a.email.localeCompare(b.email); });
}

function logAccess_(by, action, email, details) {
  insertRows_('AccessLog', [{ id: newId_(), at: nowIso_(), by: by, action: action, email: email || '', details: details || '' }]);
}

function listAccessLog_(actor) {
  requireAdmin_(actor);
  return loadTable_('AccessLog').sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); }).slice(0, 40)
    .map(function (r) { return { at: r.at, by: r.by, action: r.action, email: r.email, details: r.details }; });
}

function describeAccess_(u) {
  if (!u) return 'none';
  var d = [u.parent_access ? 'parent' : '', u.donor_access ? 'donor' : '', u.org_overview ? 'overview' : ''].filter(Boolean).join(', ') || 'no division';
  return (u.active ? 'active' : 'inactive') + ', ' + u.role + ', ' + d + (u.expires_on ? ', until ' + u.expires_on : '');
}

/** Add or change a person. Returns {user, warnings} where warnings lists sharing steps that did not work. */
function saveUser_(actor, body) {
  requireAdmin_(actor);
  var email = String(body.email || '').trim().toLowerCase();
  if (!emailOk_(email)) throw new ApiError('Enter the person\'s Google account email address.');
  var wantRole = roleOf_(body.role);
  var want = { full_name: String(body.full_name || '').trim(), role: wantRole, active: body.active !== false, parent_access: !!body.parent_access,
    donor_access: !!body.donor_access, org_overview: !!body.org_overview && wantRole !== 'staff', expires_on: null };
  if (wantRole === 'master') { want.parent_access = want.donor_access = want.org_overview = true; }
  if (String(body.expires_on || '').trim()) {
    want.expires_on = parseDateInput_(body.expires_on);
    if (!want.expires_on) throw new ApiError('The end date is not valid.');
  }
  var owner = ownerEmail_();
  var result = withLock_(function () {
    var rows = loadTable_('Admins'), row = null;
    rows.forEach(function (r) { if (String(r.email).toLowerCase() === email) row = row || r; });
    var before = row ? publicUser_(row) : publicUser_({ email: email, active: false, role: 'staff', parent_access: 'FALSE', donor_access: 'FALSE', org_overview: 'FALSE' });
    var isSelf = email === actor.email, changed = want.role !== before.role || want.active !== before.active || want.parent_access !== before.parent_access ||
      want.donor_access !== before.donor_access || want.org_overview !== before.org_overview || (want.expires_on || null) !== (before.expires_on || null);
    if (before.owner && !isSelf) throw new ApiError('The project owner cannot be changed by anyone else.', null, 403);
    if (isSelf && before.owner && changed && (want.role !== 'master' || !want.active)) throw new ApiError('The owner\'s access is permanent and cannot be reduced.');
    if (isSelf && !before.owner && changed) throw new ApiError('You cannot change your own role, status or access. Ask another administrator.');
    if (isSelf && before.owner) { want.role = 'master'; want.active = true; want.parent_access = want.donor_access = want.org_overview = true; want.expires_on = null; }

    if (actor.role !== 'master') {
      throw new ApiError('Only a master can manage users.', null, 403);
    } else {
      if (before.role === 'master' && !before.owner && !actor.owner) throw new ApiError('Only the owner can change a master administrator.', null, 403);
      if ((want.role === 'master') !== (before.role === 'master') && !actor.owner) throw new ApiError('Only the owner can appoint or remove master administrators.', null, 403);
    }
    if (!owner) {
      var masters = rows.filter(function (r) { var u = publicUser_(r); return u.active && u.role === 'master' && u.email !== email; }).length + (want.active && want.role === 'master' ? 1 : 0);
      if (!masters) throw new ApiError('At least one active master administrator must remain.');
    }
    var store = { email: email, full_name: want.full_name || (row && row.full_name) || '', active: want.active, parent_access: want.parent_access ? 'TRUE' : 'FALSE',
      donor_access: want.donor_access ? 'TRUE' : 'FALSE', org_overview: want.org_overview ? 'TRUE' : 'FALSE', role: want.role, expires_on: want.expires_on };
    if (row) { Object.keys(store).forEach(function (k) { row[k] = store[k]; }); saveRows_('Admins', [row]); }
    else insertRows_('Admins', [store]);
    var after = publicUser_(store);
    logAccess_(actor.email, row ? 'user.update' : 'user.add', email, describeAccess_(before) + ' -> ' + describeAccess_(after));
    return { user: after };
  });
  result.warnings = syncSharingFor_(result.user);
  return result;
}

/** Cron: people whose end date has passed are switched off and unshared. Runs as the owner. */
function expireAccess_() {
  var today = todayStr_(), owner = ownerEmail_(), ended = [];
  withLock_(function () {
    loadTable_('Admins').forEach(function (r) {
      if (r.active && r.expires_on && today > r.expires_on && String(r.email).toLowerCase() !== owner) { r.active = false; ended.push(r); }
    });
    saveRows_('Admins', ended);
    ended.forEach(function (r) { logAccess_('system', 'user.expired', r.email, 'Access ended on ' + r.expires_on); });
  });
  var warnings = [];
  ended.forEach(function (r) { syncSharingFor_(publicUser_(r)).forEach(function (w) { warnings.push(w); }); });
  return { expired: ended.length, warnings: warnings };
}

// ---------------------------------------------------------------- sharing
/** What a person should have on each file. */
function expectedLevels_(u) {
  var on = u.active && !u.expired;
  return { access: on ? (u.role === 'master' ? 'edit' : 'view') : null, parent: on && u.parent_access ? 'edit' : null, donor: on && u.donor_access ? 'edit' : null };
}

function lowerEmails_(users) { return users.map(function (x) { return String(x.getEmail()).toLowerCase(); }); }

function setFileAccess_(file, email, level, warnings) {
  var id = fileIdOf_(file);
  if (!id) return;
  try {
    var f = DriveApp.getFileById(id), owner = f.getOwner();
    if (owner && String(owner.getEmail()).toLowerCase() === email) return;
    var editors = lowerEmails_(f.getEditors()), viewers = lowerEmails_(f.getViewers());
    if (level === 'edit') { if (editors.indexOf(email) < 0) f.addEditor(email); }
    else if (level === 'view') { if (editors.indexOf(email) >= 0) f.removeEditor(email); if (viewers.indexOf(email) < 0) f.addViewer(email); }
    else { if (editors.indexOf(email) >= 0) f.removeEditor(email); if (viewers.indexOf(email) >= 0) f.removeViewer(email); }
  } catch (e) {
    warnings.push(FILE_LABELS[file] + ': ' + e.message);
  }
}

/** Make the Google sharing of the three files match one person\'s access. Returns warnings. */
function syncSharingFor_(u) {
  var warnings = [], exp = expectedLevels_(u);
  PEOPLE_FILES.forEach(function (file) {
    setFileAccess_(file, u.email, exp[file], warnings);
  });
  return warnings;
}

/** Re-apply everybody\'s sharing. strict = also remove anyone shared on a file who should not be. Owner and the caller are never removed. */
function syncAllSharing_(strict, keepEmail) {
  var warnings = [], users = loadTable_('Admins').filter(function (r) { return r.email; }).map(publicUser_), removed = 0;
  var expected = { access: {}, parent: {}, donor: {} };
  users.forEach(function (u) {
    var exp = expectedLevels_(u);
    PEOPLE_FILES.forEach(function (file) { if (exp[file]) expected[file][u.email] = exp[file]; setFileAccess_(file, u.email, exp[file], warnings); });
  });
  if (strict) PEOPLE_FILES.forEach(function (file) {
    var id = fileIdOf_(file); if (!id) return;
    try {
      var f = DriveApp.getFileById(id), owner = f.getOwner() ? String(f.getOwner().getEmail()).toLowerCase() : '';
      lowerEmails_(f.getEditors()).concat(lowerEmails_(f.getViewers())).forEach(function (em) {
        if (em === owner || em === keepEmail || expected[file][em]) return;
        setFileAccess_(file, em, null, warnings); removed++;
      });
    } catch (e) { warnings.push(FILE_LABELS[file] + ': ' + e.message); }
  });
  return { warnings: warnings, removed: removed };
}

/** Who can open each file in Drive, compared with what the Admins tab says. */
function auditAccess_(actor) {
  requireAdmin_(actor);
  var users = loadTable_('Admins').filter(function (r) { return r.email; }).map(publicUser_), expected = { access: {}, parent: {}, donor: {} };
  users.forEach(function (u) { var e = expectedLevels_(u); PEOPLE_FILES.forEach(function (f) { if (e[f]) expected[f][u.email] = e[f]; }); });
  return PEOPLE_FILES.map(function (file) {
    var id = fileIdOf_(file), out = { file: file, label: FILE_LABELS[file], people: [], problems: 0, error: null };
    if (!id) { out.error = 'Not created yet. Run setup.'; return out; }
    try {
      var f = DriveApp.getFileById(id), seen = {}, owner = f.getOwner() ? String(f.getOwner().getEmail()).toLowerCase() : '';
      if (owner) { seen[owner] = 'owner'; out.people.push({ email: owner, has: 'owner', should: 'owner', ok: true }); }
      lowerEmails_(f.getEditors()).forEach(function (em) { if (!seen[em]) { seen[em] = 'edit'; } });
      lowerEmails_(f.getViewers()).forEach(function (em) { if (!seen[em]) { seen[em] = 'view'; } });
      Object.keys(seen).forEach(function (em) {
        if (seen[em] === 'owner') return;
        var should = expected[file][em] || null, ok = should === seen[em];
        out.people.push({ email: em, has: seen[em], should: should, ok: ok }); if (!ok) out.problems++;
      });
      Object.keys(expected[file]).forEach(function (em) {
        if (!seen[em]) { out.people.push({ email: em, has: null, should: expected[file][em], ok: false }); out.problems++; }
      });
      out.url = f.getUrl(); out.name = f.getName();
    } catch (e) { out.error = e.message; }
    return out;
  });
}

function fixAccess_(actor) {
  requireMaster_(actor);
  var r = syncAllSharing_(true, actor.email);
  logAccess_(actor.email, 'access.fix', '', 'Re-applied sharing; removed ' + r.removed + ' unexpected share(s)');
  return r;
}

function filesInfo_(actor) {
  requireAdmin_(actor);
  return PEOPLE_FILES.map(function (file) {
    var id = fileIdOf_(file), o = { file: file, label: FILE_LABELS[file], name: FILE_TITLES[file], url: null };
    try { if (id) { var f = DriveApp.getFileById(id); o.name = f.getName(); o.url = f.getUrl(); } } catch (e) { o.error = 'You do not have access to this file.'; }
    return o;
  });
}

/** One-time (safe to repeat) creation of the three sheets and tabs, run from the app by the project owner. */
function runSetupFromApp_(actor) {
  if (!actor || !actor.owner) throw new ApiError('Only the project owner can run setup.', null, 403);
  setup();
  sheetCache_ = {};
  return { ok: true, donor_ready: donorReady_() };
}

/** The Twilio address saved in settings (no secret in it). The staff address is simply the link people open. */
function addresses_(actor) {
  requireAdmin_(actor);
  var c = cfg_();
  return { twilio: c.PUBLIC_BASE_URL || null, secret_set: !!c.WEBHOOK_SECRET, instant: instantUpdates_() };
}

var ADMIN_API = {
  'admin.addresses': function (u) { return addresses_(u); },
  'admin.setup': function (u) { return runSetupFromApp_(u); },
  'admin.users.list': function (u) { return listUsers_(u); },
  'admin.users.save': function (u, body) { return saveUser_(u, body); },
  'admin.files': function (u) { return filesInfo_(u); },
  'admin.audit': function (u) { return auditAccess_(u); },
  'admin.fixAccess': function (u) { return fixAccess_(u); },
  'admin.log': function (u) { return listAccessLog_(u); }
};

// ===== Permissions.gs =====
var BUILD_Permissions = '20261107-1230'; // build stamp (see Build.gs)
/**
 * Permission service: the single source of truth for who may open which division.
 * Permissions live on the Admins tab of the Access file (explicit TRUE/FALSE per person, never inferred from role), edited from the app (Users and access):
 *   parent_access  Parent Communication
 *   donor_access   Donor Communication
 *   org_overview   Organisation Overview (only honoured when role = master)
 *   role           master | staff   (informational)
 * Every API call re-reads this sheet, so a revoked permission takes effect on the very next request.
 * The browser UI only mirrors this; it is never trusted.
 */
var DIVISION_LABELS = { parent: 'Parent Communication', donor: 'Donor Communication', overview: 'Organisation Overview' };
var DIVISION_BY_PREFIX = { parents: 'parent', templates: 'parent', campaigns: 'parent', messages: 'parent', donor: 'donor', overview: 'overview', admin: 'admin' };

function flag_(v) { return String(v === null || v === undefined ? '' : v).trim().toUpperCase() === 'TRUE'; }

/**
 * Roles: master (the project owner is always one, and cannot be locked out), or staff.
 */
function ownerEmail_() { return String(PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL') || '').toLowerCase(); }
function roleOf_(v) { var r = String(v || '').toLowerCase(); return r === 'master' ? 'master' : 'staff'; }
function isAdminUser_(u) { return !!u && u.role === 'master'; }

/** Fresh permissions for an email, or null if the person has no access (not listed, inactive, or past their end date). */
function permissionsFor_(email) {
  email = String(email || '').toLowerCase();
  if (!email) return null;
  var owner = email === ownerEmail_();
  var all = loadTable_('Admins').filter(function (r) { return String(r.email).toLowerCase() === email; });
  var r = all.filter(function (x) { return x.active; })[0] || (owner ? all[0] : null);
  if (!r && !owner) return null;
  r = r || {};
  if (!owner && r.expires_on && todayStr_() > r.expires_on) return null;
  var legacy = !owner && r.parent_access === null && r.donor_access === null && r.org_overview === null;
  var role = owner ? 'master' : roleOf_(r.role);
  return {
    email: email, full_name: r.full_name || '', role: role, owner: owner, expires_on: r.expires_on || null,
    divisions: { parent: owner || role === 'master' || (legacy ? true : flag_(r.parent_access)), donor: owner || role === 'master' || flag_(r.donor_access), overview: owner || role === 'master' || flag_(r.org_overview) }
  };
}

function entriesOf_(user) {
  return ['parent', 'donor', 'overview'].filter(function (d) { return user.divisions[d]; });
}

/** Which division an API method belongs to. null = needs sign-in only. Unknown prefixes are denied. */
function divisionFor_(method) {
  if (String(method).indexOf('.') < 0 || String(method).split('.')[0] === 'prefs') return null;
  var d = DIVISION_BY_PREFIX[String(method).split('.')[0]];
  if (!d) throw new ApiError('Not allowed.', null, 403);
  return d;
}

function requireDivision_(user, division) {
  if (division === 'admin') { requireAdmin_(user); return; }
  if (!user.divisions[division]) throw new ApiError('You do not have access to ' + DIVISION_LABELS[division] + '.', null, 403);
}

/** What the landing screen needs. mode: denied | single | select. */
function sessionInfo_(user) {
  var entries = entriesOf_(user), last = null;
  try { last = PropertiesService.getUserProperties().getProperty('last_division'); } catch (e) { last = null; }
  return {
    user: { email: user.email, full_name: user.full_name, role: user.role, owner: user.owner },
    can_admin: isAdminUser_(user), contact: ownerEmail_(), server_build: buildReport_().newest, build_problem: buildProblems_(),
    entries: entries,
    mode: !entries.length ? 'denied' : entries.length === 1 ? 'single' : 'select',
    last_division: entries.indexOf(last) >= 0 ? last : null
  };
}

/** Remember the last division. Stored per user, separate from permissions; refuses divisions the user cannot open. */
function setPreferredDivision_(user, division) {
  if (!DIVISION_LABELS[division]) throw new ApiError('Unknown division.', null, 400);
  requireDivision_(user, division);
  PropertiesService.getUserProperties().setProperty('last_division', division);
  return { ok: true };
}

// ---------- Donor workspace (placeholder) and Organisation Overview ----------

function donorHome_() { return donorReady_() ? donorOverview_() : { ready: false, message: 'Run setup() once to create the donor sheets.', planned: [] }; }

/**
 * Organisation Overview: totals only, read from a snapshot that the background job writes into the Access file.
 * People with Overview access therefore never need access to the parent or donor files themselves.
 */
function overviewSummary_() {
  var out = { parent: null, donor: null, updated_at: null };
  loadTable_('Overview').forEach(function (r) {
    if (r.key !== 'parent' && r.key !== 'donor') return;
    out[r.key] = r.value; if (!out.updated_at || String(r.updated_at) > String(out.updated_at)) out.updated_at = r.updated_at;
  });
  return out;
}

function writeOverview_(key, value) {
  var rows = loadTable_('Overview').filter(function (r) { return r.key === key; });
  if (rows.length) { rows[0].value = value; rows[0].updated_at = nowIso_(); saveRows_('Overview', [rows[0]]); }
  else insertRows_('Overview', [{ key: key, value: value, updated_at: nowIso_() }]);
}

/** Needs access to the files it counts, so it runs from the background job (the owner) and from setup. */
function refreshOverviewSnapshot_() {
  var done = {};
  try {
    var msgs = loadTable_('Messages'), answered = 0;
    msgs.forEach(function (m) { if (m.status === 'confirmed' || m.status === 'declined') answered++; });
    var snap = { parents: loadTable_('Parents').length, campaigns: loadTable_('Campaigns').length, messages: msgs.length, answered: answered };
    withLock_(function () { writeOverview_('parent', snap); });
    done.parent = true;
  } catch (e) { done.parent = e.message; }
  if (donorReady_()) {
    try {
      var donors = loadTable_('Donors'), seg = {}, optedIn = 0;
      SEGMENT_CODES.forEach(function (c) { seg[c] = 0; });
      donors.forEach(function (d) { seg[d.segment] = (seg[d.segment] || 0) + 1; if (d.whatsapp_opt_in && !d.opted_out) optedIn++; });
      var dm = loadTable_('DonorMessages'), week = Date.now() - 7 * 86400000, sent7 = 0, held = 0, failed = 0;
      dm.forEach(function (m) { if (m.wa_sent_at && Date.parse(m.wa_sent_at) >= week) sent7++; if (m.status === 'held') held++; if (m.status === 'failed') failed++; });
      var don = loadTable_('Donations'), total = 0; don.forEach(function (x) { total += Number(x.amount) || 0; });
      var snapD = { donors: donors.length, opted_in: optedIn, segments: seg, campaigns: loadTable_('DonorCampaigns').length, donations: don.length, donated_total: total,
        messages_sent_7d: sent7, held: held, failed: failed };
      withLock_(function () { writeOverview_('donor', snapD); });
      done.donor = true;
    } catch (e) { done.donor = e.message; }
  }
  return done;
}

// ===== Setup.gs =====
var BUILD_Setup = '20261107-1230'; // build stamp (see Build.gs)
/** One-time setup helpers. Run setup() once from the editor (or the spreadsheet menu). */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('Parent Comm')
      .addItem('1. Set up sheets', 'setup')
      .addItem('2. Install triggers', 'installTriggersMenu_')
      .addItem('Import logo from Drive', 'importLogo')
      .addItem('Diagnose access problems', 'diagnoseAccess')
      .addItem('Repair owner access', 'repairOwnerAccess')
      .addItem('Show Twilio webhook URLs', 'showWebhookUrls')
      .addItem('Check configuration', 'checkConfig')
      .addItem('Run cron tick now', 'cronTick')
      .addToUi();
  } catch (e) { }
}

function installTriggersMenu_() { toast_(installTriggers()); }

function toast_(msg) {
  try { SpreadsheetApp.getActive().toast(msg, 'Parent Comm', 8); } catch (e) { console.log(msg); }
}

/** Creates the database Google Sheet if the script is not attached to one (standalone project). */
function ensureDatabaseSheet_() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SPREADSHEET_ID') && !SpreadsheetApp.getActiveSpreadsheet()) {
    var created = SpreadsheetApp.create('Parent Communication – Database');
    props.setProperty('SPREADSHEET_ID', created.getId());
    console.log('Created the database sheet: ' + created.getUrl() + ' (share it with every admin as Editor)');
  }
  sheetCache_ = {};
  return ss_();
}

/** Creates the donor or access file if it does not exist yet. */
function ensureFile_(file) {
  var props = PropertiesService.getScriptProperties();
  if (file === 'parent') return ensureDatabaseSheet_();
  if (!props.getProperty(FILE_PROP[file])) {
    var created = SpreadsheetApp.create(FILE_TITLES[file]);
    props.setProperty(FILE_PROP[file], created.getId());
    console.log('Created ' + FILE_TITLES[file] + ': ' + created.getUrl());
  }
  sheetCache_ = {};
  return ssFor_(file);
}

/**
 * A donor tab whose columns are not in SCHEMA order (for example one made by an older version that had more columns):
 * rewrites it in SCHEMA order, matching columns by header name. Nothing is lost: columns the app no longer uses go to the
 * right of the app\'s columns with their data, and a copy of the tab is kept first as a backup. Returns a note for the log.
 */
function reorderDonorTab_(ss, sh, name) {
  return withLock_(function () {
    var lastCol = sh.getLastColumn(), lastRow = sh.getLastRow();
    if (!lastCol || lastRow < 1) return null;
    var range = sh.getRange(1, 1, lastRow, lastCol), vals = range.getValues(), shown = range.getDisplayValues();
    var keys = vals[0].map(donorHeaderKey_), seen = {};
    for (var k = 0; k < keys.length; k++) {
      if (!keys[k]) continue;
      if (seen[keys[k]]) return 'The "' + name + '" tab has the column "' + vals[0][k] + '" twice, so it was not reordered. Remove one, then run setup again.';
      seen[keys[k]] = true;
    }
    var want = fieldNames_(name), from = want.map(function (f) { return keys.indexOf(f); });
    var extras = [];
    keys.forEach(function (key, j) {
      if (want.indexOf(key) >= 0) return;
      var hasData = vals.some(function (r, i) { return i > 0 && r[j] !== '' && r[j] !== null; });
      if (key || hasData) extras.push(j);
    });
    var order = from.concat(extras), width = order.length;
    var out = vals.map(function (r, i) {
      return order.map(function (j, c) {
        if (i === 0) return c < want.length ? want[c] : r[j];
        if (j < 0) return '';
        return r[j] instanceof Date ? shown[i][j] : r[j];
      });
    });
    var backup = sh.copyTo(ss).setName(name + ' (before reorder ' + Utilities.formatDate(new Date(), cfg_().APP_TIMEZONE, 'yyyy-MM-dd HHmm') + ')');
    sh.clearContents();
    if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
    sh.getRange(1, 1, sh.getMaxRows(), width).setNumberFormat('@');
    sh.getRange(1, 1, out.length, width).setValues(out);
    sheetCache_ = {};
    var kept = extras.map(function (j) { return String(vals[0][j] || '(no header)'); });
    return 'The "' + name + '" tab was put into the app\'s column order (a copy is kept as "' + backup.getName() + '").' +
      (kept.length ? ' Columns the app no longer uses were kept on the right: ' + kept.join(', ') + '.' : '');
  });
}

/**
 * Run once (and again after updates). Creates the three Google Sheets (parent, donor, access), their tabs, the first administrator,
 * and moves anything left in the old single file into the right file. Safe to run again.
 */
function setup() {
  var files = { parent: ensureDatabaseSheet_(), donor: ensureFile_('donor'), access: ensureFile_('access') };
  var parentsNote = retireOldParentsSheet_(files.parent);
  var layoutNotes = [];
  Object.keys(SCHEMA).forEach(function (name) {
    var ss = files[FILE_OF[name]], cols = SCHEMA[name], sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (FILE_OF[name] === 'donor' && sh.getLastRow() > 1) {
      var bad = donorLayoutProblem_(sh, name, true);
      if (bad) {
        var moved = reorderDonorTab_(ss, sh, name);
        if (moved) layoutNotes.push(moved);
        bad = donorLayoutProblem_(sh, name, true);
      }
      if (bad) { layoutNotes.push(bad + ' Left as it is. Move its columns back into the app\'s order, then run setup again.'); return; }
    }
    if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, cols.length).setValues([cols.map(function (c) { return c[0]; })]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  Object.keys(files).forEach(function (k) {
    var sheets = files[k].getSheets(), first = sheets[0];
    if (sheets.length > 1 && first.getName().match(/^(Sheet1|Sheet 1)$/) && first.getLastRow() === 0) files[k].deleteSheet(first);
  });
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('WEBHOOK_SECRET')) props.setProperty('WEBHOOK_SECRET', (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
  sheetCache_ = {};

  var notes = layoutNotes.concat(migrateToSeparateFiles_(files));
  if (parentsNote) notes.push(parentsNote);
  var me = (Session.getEffectiveUser().getEmail() || Session.getActiveUser().getEmail() || '').toLowerCase();
  if (me && !props.getProperty('OWNER_EMAIL')) props.setProperty('OWNER_EMAIL', me);
  if (!loadTable_('Admins').length && me) insertRows_('Admins', [{ email: me, full_name: '', active: true, parent_access: 'TRUE', donor_access: 'TRUE', org_overview: 'TRUE', role: 'master' }]);
  migrateAdmins_();
  var sharing = { warnings: [] };
  try { sharing = syncAllSharing_(false); } catch (e) { sharing.warnings.push(e.message); }
  try { refreshOverviewSnapshot_(); } catch (e) { notes.push('Overview totals: ' + e.message); }
  notes = notes.concat(sharing.warnings);
  Object.keys(files).forEach(function (k) { console.log(FILE_TITLES[k] + ': ' + files[k].getUrl()); });
  if (notes.length) console.log('Notes:\n- ' + notes.join('\n- '));
  toast_('Three files are ready (parent, donor, access). Next: set Script properties, deploy twice, install triggers (see SETUP.md).');
  return checkConfig();
}

/**
 * The Parents tab changed to Ek Tara\'s columns (one row per child, keyed on New Child ID). Old rows can\'t be converted,
 * so an old-style tab is renamed and kept as a backup, and setup creates a fresh one. Returns a note for the log, or null.
 */
function retireOldParentsSheet_(ss) {
  var sh = ss.getSheetByName('Parents');
  if (!sh || parentsHeaderOk_(sh)) return null;
  var name = 'Parents (old ' + Utilities.formatDate(new Date(), cfg_().APP_TIMEZONE, 'yyyy-MM-dd HHmm') + ')';
  sh.setName(name);
  return 'The old Parents tab was renamed to "' + name + '" and kept as a backup. Upload Ek Tara\'s file on the Parent Info page to fill the new one. Old campaigns still show who they went to.';
}

/**
 * Before the files were separated everything was in one sheet. Copy any rows left in the wrong file to the right one, check the
 * counts, then remove the old tab so no donor data stays in the parent file (or the reverse). Returns notes for the log.
 */
function migrateToSeparateFiles_(files) {
  var notes = [], parent = files.parent, backedUp = false;
  function backup() {
    if (backedUp) return; backedUp = true;
    try { DriveApp.getFileById(parent.getId()).makeCopy('Ek Tara backup before separating files ' + todayStr_()); notes.push('A backup copy of the old single file was made in your Drive. Delete it once you have checked the data (it still holds everything in one file).'); }
    catch (e) { notes.push('Could not make a backup copy first: ' + e.message); }
  }
  Object.keys(SCHEMA).forEach(function (name) {
    var file = FILE_OF[name]; if (file === 'parent') return;
    var legacy = parent.getSheetByName(name); if (!legacy) return;
    var last = legacy.getLastRow(), cols = SCHEMA[name].length;
    if (last > 1) {
      var target = files[file].getSheetByName(name);
      if (target.getLastRow() > 1) { notes.push('"' + name + '" has rows in both the old and the new file; nothing was moved. Check it by hand.'); return; }
      backup();
      var vals = legacy.getRange(2, 1, last - 1, cols).getValues(), rng = target.getRange(2, 1, vals.length, cols);
      rng.setNumberFormat('@'); rng.setValues(vals);
      if (target.getLastRow() !== last) { notes.push('"' + name + '": the copy did not match, the old tab was kept.'); return; }
      notes.push('Moved ' + (last - 1) + ' row(s) of "' + name + '" to ' + FILE_TITLES[file] + '.');
    }
    parent.deleteSheet(legacy);
  });
  try {
    var tpls = loadTable_('Templates'), donorTpls = tpls.filter(function (t) { return t.division === 'donor'; });
    if (donorTpls.length && !loadTable_('DonorTemplates').length) {
      backup();
      insertRows_('DonorTemplates', donorTpls.map(function (t) { var c = {}; Object.keys(t).forEach(function (k) { if (k !== '_row') c[k] = t[k]; }); return c; }));
      replaceTable_('Templates', tpls.filter(function (t) { return t.division !== 'donor'; }));
      notes.push('Moved ' + donorTpls.length + ' donor template(s) to the donor file.');
    }
  } catch (e) { notes.push('Donor templates: ' + e.message); }
  try {
    var ids = {}; loadTable_('DonorMessages').forEach(function (m) { ids[m.id] = true; });
    var evs = loadTable_('Events'), mine = evs.filter(function (e) { return e.message_id && ids[e.message_id]; });
    if (mine.length && !loadTable_('DonorEvents').length) {
      insertRows_('DonorEvents', mine.map(function (e) { return { id: 'd-' + e.id, message_id: e.message_id, source: e.source, payload: e.payload, created_at: e.created_at, processed: e.processed }; }));
      replaceTable_('Events', evs.filter(function (e) { return !(e.message_id && ids[e.message_id]); }));
      notes.push('Moved ' + mine.length + ' donor event(s) to the donor file.');
    }
  } catch (e) { notes.push('Donor events: ' + e.message); }
  return notes;
}

function checkConfig() {
  cfgCache_ = null;
  var c = cfg_(), missing = [];
  ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'].forEach(function (k) { if (!c[k]) missing.push(k); });
  if (!c.TWILIO_WHATSAPP_FROM && !c.TWILIO_MESSAGING_SERVICE_SID) missing.push('TWILIO_WHATSAPP_FROM (or TWILIO_MESSAGING_SERVICE_SID)');
  var msg = missing.length ? 'Missing script properties: ' + missing.join(', ') : 'Configuration looks complete.';
  msg += instantUpdates_() ? ' Instant updates from Twilio: ON (Twilio address set).' : ' Instant updates from Twilio: OFF. One-address mode: statuses and replies are checked every few minutes (add PUBLIC_BASE_URL later for instant updates).';
  msg += c.TWILIO_VOICE_FROM ? ' Voice fallback: ON.' : ' Voice fallback: OFF (WhatsApp only; set TWILIO_VOICE_FROM to enable).';
  console.log(msg);
  toast_(msg);
  return msg;
}

function showWebhookUrls() {
  var c = cfg_();
  var base = c.PUBLIC_BASE_URL || '(set PUBLIC_BASE_URL first)';
  var inbound = base + '?hook=whatsapp_inbound&k=' + c.WEBHOOK_SECRET;
  var cron = base + '?hook=cron&k=' + c.WEBHOOK_SECRET;
  var text = 'Twilio -> WhatsApp sender -> "When a message comes in" (POST):\n' + inbound +
    '\n\nOptional external scheduler (POST):\n' + cron;
  console.log(text);
  try { SpreadsheetApp.getUi().alert('Webhook URLs', text, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) { }
  return text;
}

/** Run once from the editor: makes one small Twilio call and reports whether the SID and token work. */
function testTwilioConnection() {
  cfgCache_ = null;
  requireConfig_(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']);
  var a = twFormRequest_('get', TW_API.replace(/\/Accounts\/$/, '') + '/Accounts/' + cfg_().TWILIO_ACCOUNT_SID + '.json');
  var msg = 'Twilio connected: account "' + a.friendly_name + '", status ' + a.status + ', type ' + a.type + '.';
  console.log(msg);
  toast_(msg);
  return msg;
}

/** Give Admins rows that predate divisions explicit permissions (Parent access as before; the owner gets everything). */
function migrateAdmins_() {
  var me = ownerEmail_() || (Session.getEffectiveUser().getEmail() || '').toLowerCase(), dirty = [];
  loadTable_('Admins').forEach(function (r) {
    var changed = false, owner = String(r.email).toLowerCase() === me;
    if (r.parent_access === null && r.donor_access === null && r.org_overview === null) {
      r.parent_access = 'TRUE'; r.donor_access = owner ? 'TRUE' : 'FALSE'; r.org_overview = owner ? 'TRUE' : 'FALSE'; changed = true;
    }
    if (owner && roleOf_(r.role) !== 'master') { r.role = 'master'; changed = true; }
    else if (!r.role) { r.role = 'staff'; changed = true; }
    if (changed) dirty.push(r);
  });
  saveRows_('Admins', dirty);
}

/** Run from the editor when someone (usually you) is told they have no access. Prints what the app can and cannot see. */
function diagnoseAccess() {
  var out = diagnoseLines_(false).join('\n'); console.log(out); toast_('Diagnosis written to the log (View, Logs).');
  return out;
}

/** The diagnosis as lines. forPage = shown to whoever opens ?diag=1, so no file links. */
function diagnoseLines_(forPage) {
  var lines = [], props = PropertiesService.getScriptProperties();
  var me = String(Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || '').toLowerCase();
  lines.push('Running as: ' + (me || '(unknown: sign in with a Google account)'));
  var br = buildReport_();
  lines.push('Code build: ' + (br.newest || '(none)') + (br.problems.length ? '. PROBLEM, files out of date or missing: ' + br.problems.join('; ') + '. Replace every file from the latest zip.' : '. All files match.'));
  lines.push('Owner recorded: ' + (ownerEmail_() || 'NO (run setup as the project owner)'));
  ['parent', 'donor', 'access'].forEach(function (file) {
    var set = !!props.getProperty(FILE_PROP[file]);
    lines.push(FILE_TITLES[file] + ': ' + (set ? 'file ID saved' : (file === 'parent' ? 'using the sheet the script is attached to' : 'NOT CREATED YET (still using the old single file). Run setup.')));
    try {
      var ss = ssFor_(file), have = ss.getSheets().map(function (t) { return t.getName(); });
      var want = Object.keys(FILE_OF).filter(function (n) { return FILE_OF[n] === file; });
      var missing = want.filter(function (n) { return have.indexOf(n) < 0; });
      lines.push('   opens: yes' + (missing.length ? '; MISSING TABS: ' + missing.join(', ') + ' (run setup)' : '; all tabs present') + (forPage ? '' : ' (' + ss.getUrl() + ')'));
    } catch (e) { lines.push('   CANNOT OPEN: ' + e.message); }
  });
  try {
    var rows = loadTable_('Admins');
    lines.push('Users on the Admins list: ' + rows.length);
    var mine = rows.filter(function (r) { return String(r.email).toLowerCase() === me; })[0];
    if (!mine) lines.push('YOUR ACCOUNT IS NOT ON THE LIST' + (me && me === ownerEmail_() ? ' (you are the owner, so the app still lets you in; run repairOwnerAccess to add your row).' : '. If you own the project, run repairOwnerAccess.'));
    else {
      var u = publicUser_(mine);
      lines.push('Your row: ' + (u.active ? 'active' : 'INACTIVE') + ', role ' + u.role + ', parent ' + u.parent_access + ', donor ' + u.donor_access + ', overview ' + u.org_overview);
      if (!u.active) lines.push('Your row is inactive. Run repairOwnerAccess if you own the project.');
    }
  } catch (e) { lines.push('CANNOT READ THE ADMINS LIST: ' + e.message + '. Run setup (or repairOwnerAccess).'); }
  return lines;
}

/**
 * Owner recovery. Run from the editor while signed in as the project owner. Creates anything missing (same as setup), then makes
 * your account an active administrator with every access and shares the three files properly.
 */
function repairOwnerAccess() {
  var me = String(Session.getEffectiveUser().getEmail() || Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!me) throw new Error('Could not tell which Google account is running this.');
  setup();
  PropertiesService.getScriptProperties().setProperty('OWNER_EMAIL', me);
  withLock_(function () {
    var row = loadTable_('Admins').filter(function (r) { return String(r.email).toLowerCase() === me; })[0];
    var fields = { email: me, active: true, parent_access: 'TRUE', donor_access: 'TRUE', org_overview: 'TRUE', role: 'master', expires_on: null };
    if (row) { Object.keys(fields).forEach(function (k) { row[k] = fields[k]; }); saveRows_('Admins', [row]); }
    else { fields.full_name = ''; insertRows_('Admins', [fields]); }
    try { logAccess_(me, 'owner.repair', me, 'Owner restored as administrator with all access'); } catch (e) { }
  });
  var r = syncAllSharing_(false);
  var msg = me + ' is now a master administrator with Parent, Donor and Overview access.' + (r.warnings.length ? ' Sharing notes: ' + r.warnings.join('; ') : '') + ' Open the app again (hard refresh).';
  console.log(msg); toast_(msg);
  return msg;
}