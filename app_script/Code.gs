// ==========================================================================================================
// EK TARA COMMUNICATIONS: ALL SERVER CODE IN ONE FILE
// If you see "SyntaxError: Identifier 'ApiError' has already been declared" (or any "already been declared"),
// the project still has the old separate .gs files. Delete EVERY other .gs file and keep only this Code.gs.
// ==========================================================================================================
// ===== Admin.gs =====
var BUILD_Admin = '20261107-1230'; // build stamp (see Build.gs)
/**
 * Users and access, managed from the app. Nobody needs to edit a sheet.
 *
 * Roles
 *   Master        the project owner (permanent: cannot be removed or locked out) and any masters the owner appoints.
 *                 Can do everything below. Only the owner appoints or removes masters.
 *   Administrator manages only what a master gave it: Parent users, Donor users, and/or seeing the access log.
 *                 An administrator can only manage ordinary staff, never other administrators or masters.
 *   Staff         works in the departments they were given.
 * Every person can also have an end date, after which their access stops by itself.
 * Saving a person also changes who is shared on the three Google Sheets, so the file-level separation stays true.
 */
var PEOPLE_FILES = ['access', 'parent', 'donor'];
var FILE_LABELS = { access: 'Access file', parent: 'Parent database', donor: 'Donor database' };

function requireAdmin_(user) {
  if (!isAdminUser_(user)) throw new ApiError('Only administrators can do this.', null, 403);
}
function requireCap_(user, cap) {
  if (!user || (user.role !== 'master' && user.caps.indexOf(cap) < 0)) throw new ApiError('Your administrator role does not include this.', null, 403);
}
function requireMaster_(user) {
  if (!user || user.role !== 'master') throw new ApiError('Only a master administrator can do this.', null, 403);
}

function emailOk_(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); }

function publicUser_(r) {
  var email = String(r.email).toLowerCase(), owner = email === ownerEmail_(), role = owner ? 'master' : roleOf_(r.role);
  var legacy = !owner && r.parent_access === null && r.donor_access === null && r.org_overview === null;
  return { email: email, full_name: r.full_name || '', active: owner || !!r.active, role: role, owner: owner,
    caps: role === 'master' ? Object.keys(ADMIN_CAPS) : role === 'admin' ? parseCaps_(r.admin_caps) : [],
    parent_access: owner || role === 'master' || legacy || flag_(r.parent_access), donor_access: owner || role === 'master' || flag_(r.donor_access), org_overview: owner || role === 'master' || flag_(r.org_overview),
    expires_on: r.expires_on || null, expired: !owner && !!(r.expires_on && todayStr_() > r.expires_on) };
}

function listUsers_(actor) {
  requireAdmin_(actor);
  var rows = loadTable_('Admins').filter(function (r) { return r.email; }).map(publicUser_), owner = ownerEmail_();
  if (owner && !rows.some(function (u) { return u.email === owner; })) rows.push(publicUser_({ email: owner, full_name: '', active: true }));   // the owner always appears
  return rows.sort(function (a, b) { return Number(b.owner) - Number(a.owner) || Number(b.active) - Number(a.active) || a.email.localeCompare(b.email); });
}

function logAccess_(by, action, email, details) {
  insertRows_('AccessLog', [{ id: newId_(), at: nowIso_(), by: by, action: action, email: email || '', details: details || '' }]);
}

function listAccessLog_(actor) {
  requireCap_(actor, 'audit');
  return loadTable_('AccessLog').sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); }).slice(0, 40)
    .map(function (r) { return { at: r.at, by: r.by, action: r.action, email: r.email, details: r.details }; });
}

function describeAccess_(u) {
  if (!u) return 'none';
  var d = [u.parent_access ? 'parent' : '', u.donor_access ? 'donor' : '', u.org_overview ? 'overview' : ''].filter(Boolean).join(', ') || 'no division';
  var caps = u.role === 'admin' ? ', can manage: ' + (u.caps.join(', ') || 'nothing') : '';
  return (u.active ? 'active' : 'inactive') + ', ' + u.role + ', ' + d + caps + (u.expires_on ? ', until ' + u.expires_on : '');
}

/** Add or change a person. Returns {user, warnings} where warnings lists sharing steps that did not work. */
function saveUser_(actor, body) {
  requireAdmin_(actor);
  var email = String(body.email || '').trim().toLowerCase();
  if (!emailOk_(email)) throw new ApiError('Enter the person\'s Google account email address.');
  var wantRole = roleOf_(body.role);
  var want = { full_name: String(body.full_name || '').trim(), role: wantRole, active: body.active !== false, parent_access: !!body.parent_access,
    donor_access: !!body.donor_access, org_overview: !!body.org_overview && wantRole !== 'staff', caps: wantRole === 'admin' ? parseCaps_(body.caps) : [], expires_on: null };
  if (wantRole === 'master') { want.parent_access = want.donor_access = want.org_overview = true; } // a master has every department
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
      want.donor_access !== before.donor_access || want.org_overview !== before.org_overview || want.caps.join() !== before.caps.join() ||
      (want.expires_on || null) !== (before.expires_on || null);
    if (before.owner && !isSelf) throw new ApiError('The project owner cannot be changed by anyone else.', null, 403);
    if (isSelf && before.owner && changed && (want.role !== 'master' || !want.active)) throw new ApiError('The owner\'s access is permanent and cannot be reduced.');
    if (isSelf && !before.owner && changed) throw new ApiError('You cannot change your own role, status or access. Ask another administrator.');
    if (isSelf && before.owner) { want.role = 'master'; want.active = true; want.parent_access = want.donor_access = want.org_overview = true; want.caps = []; want.expires_on = null; }

    if (actor.role !== 'master') {
      // a delegated administrator manages ordinary staff in the departments it administers, nothing else
      if (actor.caps.indexOf('users_parent') < 0 && actor.caps.indexOf('users_donor') < 0) throw new ApiError('Your administrator role does not include managing people.', null, 403);
      if (row && before.role !== 'staff') throw new ApiError('Only a master administrator can change administrators.', null, 403);
      if (want.role !== 'staff') throw new ApiError('Only a master administrator can create administrators.', null, 403);
      if (want.org_overview !== before.org_overview) throw new ApiError('Only a master administrator can give or remove Organisation Overview access.', null, 403);
      if (want.parent_access !== before.parent_access && actor.caps.indexOf('users_parent') < 0) throw new ApiError('You can only change Parent access if you manage Parent users.', null, 403);
      if (want.donor_access !== before.donor_access && actor.caps.indexOf('users_donor') < 0) throw new ApiError('You can only change Donor access if you manage Donor users.', null, 403);
      if ((before.parent_access && actor.caps.indexOf('users_parent') < 0) || (before.donor_access && actor.caps.indexOf('users_donor') < 0))
        throw new ApiError('You can only manage people whose departments you administer.', null, 403);
    } else {
      if (before.role === 'master' && !before.owner && !actor.owner) throw new ApiError('Only the owner can change a master administrator.', null, 403);
      if ((want.role === 'master') !== (before.role === 'master') && !actor.owner) throw new ApiError('Only the owner can appoint or remove master administrators.', null, 403);
    }
    if (want.caps.indexOf('users_parent') >= 0 && !want.parent_access) throw new ApiError('To manage Parent users the person needs Parent access themselves (they share the Parent sheet).');
    if (want.caps.indexOf('users_donor') >= 0 && !want.donor_access) throw new ApiError('To manage Donor users the person needs Donor access themselves (they share the Donor sheet).');
    if (want.role === 'admin' && !want.caps.length) throw new ApiError('Choose at least one thing this administrator can manage.');
    if (!owner) { // without a recorded owner, keep at least one active master
      var masters = rows.filter(function (r) { var u = publicUser_(r); return u.active && u.role === 'master' && u.email !== email; }).length + (want.active && want.role === 'master' ? 1 : 0);
      if (!masters) throw new ApiError('At least one active master administrator must remain.');
    }
    var store = { email: email, full_name: want.full_name || (row && row.full_name) || '', active: want.active, parent_access: want.parent_access ? 'TRUE' : 'FALSE',
      donor_access: want.donor_access ? 'TRUE' : 'FALSE', org_overview: want.org_overview ? 'TRUE' : 'FALSE', role: want.role, admin_caps: want.caps.join(','), expires_on: want.expires_on };
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
  return { access: on ? (isAdminUser_(u) ? 'edit' : 'view') : null, parent: on && u.parent_access ? 'edit' : null, donor: on && u.donor_access ? 'edit' : null };
}

function lowerEmails_(users) { return users.map(function (x) { return String(x.getEmail()).toLowerCase(); }); }

function setFileAccess_(file, email, level, warnings) {
  var id = fileIdOf_(file);
  if (!id) return;
  try {
    var f = DriveApp.getFileById(id), owner = f.getOwner();
    if (owner && String(owner.getEmail()).toLowerCase() === email) return;       // the owner always has access
    var editors = lowerEmails_(f.getEditors()), viewers = lowerEmails_(f.getViewers());
    if (level === 'edit') { if (editors.indexOf(email) < 0) f.addEditor(email); }
    else if (level === 'view') { if (editors.indexOf(email) >= 0) f.removeEditor(email); if (viewers.indexOf(email) < 0) f.addViewer(email); }
    else { if (editors.indexOf(email) >= 0) f.removeEditor(email); if (viewers.indexOf(email) >= 0) f.removeViewer(email); }
  } catch (e) {
    warnings.push(FILE_LABELS[file] + ': ' + e.message);
  }
}

/** Make the Google sharing of the three files match one person's access. Returns warnings. */
function syncSharingFor_(u) {
  var warnings = [], exp = expectedLevels_(u);
  PEOPLE_FILES.forEach(function (file) {
    // someone who may not open a department must not be touched on it by an administrator without it either
    setFileAccess_(file, u.email, exp[file], warnings);
  });
  return warnings;
}

/** Re-apply everybody's sharing. strict = also remove anyone shared on a file who should not be. Owner and the caller are never removed. */
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
  requireCap_(actor, 'audit');
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

// ===== Api.gs =====
var BUILD_Api = '20261107-1230'; // build stamp (see Build.gs)
/**
 * Entry points. The same project is deployed twice (see SETUP.md):
 *  1. "Admin app"  : Execute as = User accessing the web app, Access = Anyone with Google account
 *  2. "Webhooks"   : Execute as = Me, Access = Anyone   (this URL is PUBLIC_BASE_URL, used by Twilio)
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.hook) return handleHook_(e);
  if (p.diag) return diagPage_();
  var email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  if (runsAsOwnerDeployment_(email)) {
    return HtmlService.createHtmlOutput('<div style="font-family:sans-serif;max-width:560px;margin:15vh auto;text-align:center"><h2>This address is for Twilio</h2><p>People do not use this link. Please open the <b>staff app</b> link you were given.</p></div>').setTitle('Ek Tara Communications');
  }
  var user = null, problem = '';
  try { user = email ? permissionsFor_(email) : null; } catch (err) { user = null; problem = String((err && err.message) || err); }
  if (!user) {
    var msg = !email ? 'You are not signed in to Google on this address. If you meant to open the app, use the <b>staff app address</b> (the link that asks you to sign in). This address may be the one reserved for Twilio, which people never use.'
      : problem ? 'The app could not read its Access file for <b>' + htmlEsc_(email) + '</b>:<br><i>' + htmlEsc_(problem) + '</i><br><br>If you own this project, open the Apps Script editor and run <b>diagnoseAccess</b>, then <b>repairOwnerAccess</b>. ' +
        'Everyone else: ask an administrator to check that the Access file is shared with you.'
      : 'The account <b>' + htmlEsc_(email) + '</b> has not been given access. Ask an administrator to add you under Users and access.' + requestAccessLink_(email);
    return HtmlService.createHtmlOutput('<div style="font-family:sans-serif;max-width:560px;margin:15vh auto;text-align:center"><h2>Not authorised</h2><p>' + msg + '</p></div>').setTitle('Ek Tara Communications');
  }
  var t = HtmlService.createTemplateFromFile('Index');
  t.userEmail = email;
  try { t.logo = logoDataUri_(); } catch (err) { t.logo = ''; } // the page works without it
  // A deep link such as ?division=donor only pre-selects; the server still decides what is allowed.
  t.requestedDivision = DIVISION_LABELS[String(p.division || '').toLowerCase()] ? String(p.division).toLowerCase() : '';
  return t.evaluate().setTitle('Ek Tara Communications')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  var p = (e && e.parameter) || {};
  if (p.hook) return handleHook_(e);
  return textOut_('Not found');
}

/** Plain status page for anyone who opens the app address with ?diag=1: works even when the main screen cannot start. */
function diagPage_() {
  var lines;
  try { lines = diagnoseLines_(true); } catch (e) { lines = ['The diagnosis itself failed: ' + e.message]; }
  return HtmlService.createHtmlOutput('<div style="font-family:system-ui,sans-serif;max-width:760px;margin:6vh auto;padding:0 16px"><h2>Ek Tara Communications: status</h2><pre style="white-space:pre-wrap;background:#f4f4f5;padding:14px;border-radius:8px;line-height:1.5">' +
    htmlEsc_(lines.join('\n')) + '</pre><p style="color:#52525b">Send this to the project owner if something is not working. It contains no donor or parent data.</p></div>').setTitle('Ek Tara status');
}

/** A "Request access" email to the owner (the one contact every install has), with the person's address filled in. */
function requestAccessLink_(email) {
  var owner = ownerEmail_();
  if (!owner) return '';
  var href = 'mailto:' + owner + '?subject=' + encodeURIComponent('Please give me access to Ek Tara Communications') +
    '&body=' + encodeURIComponent('Hello,\n\nPlease give this Google account access to Ek Tara Communications: ' + email + '\n\nThank you');
  return '<p><a href="' + htmlEsc_(href) + '" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#0e5e55;color:#fff;text-decoration:none;font-weight:600">Email an administrator to request access</a></p>';
}

function htmlEsc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * A deployment set to "Execute as: Me" runs with the owner's rights, so Google would not keep the parent and donor sheets apart for the people using it.
 * That is the Twilio address. If someone other than the owner reaches the app through it, refuse.
 */
function runsAsOwnerDeployment_(email) {
  var eff = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  return !!(eff && email && eff !== email);
}

function currentUser_() {
  var email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email) throw new ApiError('Not signed in.', null, 401);
  if (runsAsOwnerDeployment_(email)) throw new ApiError('This address is only for Twilio. Use the staff app link.', null, 403);
  var user = null, problem = '';
  try { user = permissionsFor_(email); } catch (e) { problem = String((e && e.message) || e); } // e.g. no longer shared on the Access file
  // (read fresh on every request: revocations apply immediately)
  if (!user) throw new ApiError(problem ? 'The app could not read its Access file (' + problem + '). Ask an administrator to check your access.' : 'Your account has not been given access, or has been deactivated.', null, 403);
  return user;
}

var API = {
  'session': function (u) { return sessionInfo_(u); },
  'prefs.setDivision': function (u, division) { return setPreferredDivision_(u, division); },
  'overview.summary': function (u) { return overviewSummary_(); },
  'info': function (u) {
    var c = cfg_();
    return { call_fallback_hours: c.CALL_FALLBACK_HOURS, call_window_start: c.CALL_WINDOW_START, call_window_end: c.CALL_WINDOW_END,
      timezone: c.APP_TIMEZONE, cost_per_whatsapp: c.COST_PER_WHATSAPP, cost_per_call: c.COST_PER_CALL,
      currency: c.COST_CURRENCY, voice_enabled: !!c.TWILIO_VOICE_FROM, user: u.email };
  },
  'parents.list': function (u, f) { return listParents_(u, f); },
  'parents.groups': function (u) { return listGroups_(); },
  'parents.upload': function (u, csv) { return uploadParents_(u, csv); },
  'parents.update': function (u, id, body) { return updateParent_(u, id, body); },
  'parents.delete': function (u, id) { return deleteParent_(u, id); },
  'parents.move': function (u, body) { return moveGroup_(u, body); },
  'parents.deleteGroup': function (u, body) { return deleteGroup_(u, body); },
  'parents.history': function (u, id) { return parentHistory_(u, id); },
  'templates.list': function (u, status) { return listTemplates_(u, status); },
  'templates.create': function (u, body) { return createTemplate_(u, body); },
  'templates.retrySubmit': function (u, id) { return retrySubmit_(u, id); },
  'templates.resubmit': function (u, id, body) { return resubmitTemplate_(u, id, body); },
  'templates.import': function (u) { return importTwilioTemplates_(u); },
  'templates.sync': function (u) { return syncPendingTemplates_(); },
  'templates.notifications': function (u) { return templateNotifications_(u); },
  'templates.seen': function (u, id) { return markTemplateSeen_(u, id); },
  'campaigns.list': function (u, f) { return listCampaigns_(u, f); },
  'campaigns.get': function (u, id, status) { return getCampaign_(u, id, status); },
  'campaigns.create': function (u, body) { return createCampaign_(u, body); },
  'campaigns.sendBatch': function (u, id) { return sendCampaignBatch_(id, 40000); },
  'campaigns.export': function (u, id) { return exportCampaign_(id); },
  'campaigns.cancel': function (u, id) { return cancelCampaign_(u, id); },
  'campaigns.retryFailed': function (u, id) { return retryFailed_(u, id); },
  'messages.resolve': function (u, id, outcome) { return resolveMessage_(u, id, outcome); },
  'messages.events': function (u, id) { return eventsForMessage_(id); }
};

/** Single entry point for google.script.run. Always returns {ok, data} or {ok:false, error, errors}. */
function api(method, args) {
  try {
    var user = currentUser_();
    var fn = API[method] || (typeof DONOR_API !== 'undefined' ? DONOR_API[method] : null) || (typeof ADMIN_API !== 'undefined' ? ADMIN_API[method] : null);
    if (!fn) throw new ApiError('Unknown method ' + method, null, 404);
    var division = divisionFor_(method);
    if (division) requireDivision_(user, division); // the server enforces access; hiding UI is not security
    return { ok: true, data: fn.apply(null, [user].concat(args || [])) };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: e.message, errors: e.errors, status: e.status };
    console.error(method + ': ' + (e && e.stack || e));
    return { ok: false, error: 'Unexpected error: ' + (e && e.message || e) };
  }
}

// ===== Archive.gs =====
var BUILD_Archive = '20261107-1230'; // build stamp (see Build.gs)
/**
 * Campaign archive: after a campaign is finished, copy its data and logs into a NEW Google Sheet in Drive.
 *   Tab "Summary"    campaign, template, values used, who sent it, totals
 *   Tab "Recipients" one row per parent with status, how/when they answered, call result, typed reply
 *   Tab "Timeline"   every webhook / call / admin event for those messages
 * File name: "Campaign 2026-11-04 1030 – Sunrise Public School · Class 7 – ptm_reminder (a1b2c3d4)"
 * Files go to the Drive folder ARCHIVE_FOLDER_ID (created automatically on first use).
 * The cron tick archives finished campaigns by itself; the campaign page also has an "Export to Drive" button.
 */
var ARCHIVE_AFTER_MS = 49 * 3600 * 1000; // the IVR fallback stops acting after 48 h, so nothing more will change

function archiveFolder_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('ARCHIVE_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); }
    catch (e) { throw new ApiError('Cannot open the Drive archive folder (ARCHIVE_FOLDER_ID). Share it with every admin as Editor.'); }
  }
  var f = DriveApp.createFolder('Parent Communication – Campaign Archive');
  props.setProperty('ARCHIVE_FOLDER_ID', f.getId());
  return f;
}

function localTime_(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : Utilities.formatDate(d, cfg_().APP_TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

function cleanFileName_(s) { return String(s).replace(/[\\\/:*?"<>|\[\]#]/g, '-').replace(/\s+/g, ' ').trim(); }

function archiveName_(c, t) {
  var when = Utilities.formatDate(new Date(c.created_at), cfg_().APP_TIMEZONE, 'yyyy-MM-dd HHmm');
  return cleanFileName_('Campaign ' + when + ' – ' + c.audience + ' – ' + (t.name || 'template') + ' (' + String(c.id).slice(0, 8) + ')').slice(0, 150);
}

function eventSummary_(e) {
  var p = e.payload || {};
  switch (e.source) {
    case 'whatsapp_status': return 'WhatsApp: ' + (p.MessageStatus || '?') + (p.ErrorCode ? ' (error ' + p.ErrorCode + ')' : '');
    case 'whatsapp_inbound': return (p.ButtonPayload ? 'Tapped' : 'Replied') + ' "' + (p.Body || '') + '"' + (p.recovered ? ' (recovered)' : '');
    case 'voice_gather': return 'Pressed ' + (p.Digits || 'nothing');
    case 'voice_status': return 'Call ' + (p.CallStatus || '?') + (p.CallDuration ? ', ' + p.CallDuration + ' s' : '');
    case 'admin': return 'Marked ' + p.outcome + ' by ' + p.by;
    case 'cron': return p.error ? 'Error: ' + p.error : p.recheck_status ? 'Status re-checked with Twilio: ' + p.recheck_status : 'Background job';
    default: return e.source;
  }
}

var STATUS_LABELS_ = { queued: 'Queued (not sent)', sent: 'Sent', delivered: 'Delivered', read: 'Read, no answer', confirmed: 'Confirmed',
  declined: 'Declined', flagged: 'Needs follow-up', failed: 'Failed', cancelled: 'Cancelled' };

function buildArchive_(c, t) {
  var parents = {}; loadTable_('Parents').forEach(function (p) { parents[p.id] = p; });
  var tpls = {}; loadTable_('Templates').forEach(function (x) { tpls[x.id] = x; });
  var msgs = loadTable_('Messages').filter(function (m) { return m.campaign_id === c.id; });
  var byMsg = {}; msgs.forEach(function (m) { byMsg[m.id] = m; });
  var gone = { parent_name: '(deleted)', phone_e164: '', institution: '', class_or_year: '', section: '', language: '', has_whatsapp: false };

  var recipients = msgs.map(function (m) {
    var p = parents[m.parent_id] || gone, v = tpls[m.template_id] || {};
    return { sort: [p.institution, p.class_or_year, p.section || '', p.parent_name], row: [
      p.parent_name, p.child_name || '', p.phone_e164, p.institution, p.class_or_year, p.section || '', p.language,
      p.has_whatsapp ? 'yes' : 'no', v.name ? v.name + ' (' + v.language + ')' : '',
      STATUS_LABELS_[m.status] || m.status, m.confirmed_via || '', localTime_(m.wa_sent_at), m.wa_error || '',
      localTime_(m.call_requested_at), m.call_status || '', m.call_digit || '', m.reply_text || '', localTime_(m.replied_at),
      m.resolved_by || '', localTime_(m.updated_at)] };
  }).sort(function (a, b) {
    for (var i = 0; i < 4; i++) { var r = String(a.sort[i]).localeCompare(String(b.sort[i]), undefined, { numeric: true, sensitivity: 'base' }); if (r) return r; }
    return 0;
  }).map(function (x) { return x.row; });

  var timeline = loadTable_('Events').filter(function (e) { return e.message_id && byMsg[e.message_id]; })
    .sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); })
    .map(function (e) {
      var p = parents[byMsg[e.message_id].parent_id] || gone;
      return [localTime_(e.created_at), p.parent_name, p.phone_e164, e.source, eventSummary_(e), JSON.stringify(e.payload || {})];
    });

  var counts = countByStatus_(msgs), vars = c.variables || {};
  var text = t.body || '';
  Object.keys(vars).forEach(function (k) { text = text.split('{{' + k + '}}').join(vars[k]); });
  var via = { whatsapp: 0, voice: 0, admin: 0 }, typed = 0, calls = 0;
  msgs.forEach(function (m) {
    if ((m.status === 'confirmed' || m.status === 'declined') && via[m.confirmed_via] !== undefined) via[m.confirmed_via]++;
    if (m.reply_text) typed++;
    if (m.call_requested_at) calls++;
  });
  var answered = counts.confirmed + counts.declined;
  var summary = [
    ['Campaign', archiveName_(c, t)], ['Campaign ID', c.id], ['Audience', c.audience], ['School / college', c.institution],
    ['Class / year', c.class_or_year || 'All'], ['Section', c.section || 'All'],
    ['Template', (t.name || '') + ' (' + (t.language || '') + ')'], ['Message text sent', text], ['Template body (raw)', t.body || ''],
    ['Values used', Object.keys(vars).sort(function (a, b) { return a - b; }).map(function (k) { return '{{' + k + '}} = ' + vars[k]; }).join('; ')],
    ['Sent by', senderName_(c.created_by) || ''], ['Created', localTime_(c.created_at)], ['Campaign status', c.status],
    ['Exported', localTime_(nowIso_())], ['', ''], ['Recipients', counts.total]
  ];
  STATUSES.forEach(function (s) { if (counts[s]) summary.push([STATUS_LABELS_[s], counts[s]]); });
  summary.push(['Answered (confirmed + declined)', answered + (counts.total ? ' (' + Math.round(answered / counts.total * 100) + '%)' : '')],
    ['  answered on WhatsApp', via.whatsapp], ['  answered on the phone call', via.voice], ['  recorded by an admin', via.admin],
    ['Typed WhatsApp replies', typed], ['Fallback calls placed', calls]);
  return {
    Summary: { header: ['Item', 'Value'], rows: summary },
    Recipients: { header: ['Parent', 'Child', 'Phone', 'School / college', 'Class / year', 'Section', 'Language', 'Has WhatsApp',
      'Template version sent', 'Status', 'Answered via', 'WhatsApp sent at', 'WhatsApp error', 'Call requested at', 'Call status',
      'Key pressed', 'Typed reply', 'Replied at', 'Recorded by', 'Last update'], rows: recipients },
    Timeline: { header: ['Time', 'Parent', 'Phone', 'Source', 'What happened', 'Raw payload'], rows: timeline }
  };
}

function writeArchiveSheet_(sh, tab) {
  sh.clear();
  var all = [tab.header].concat(tab.rows.map(function (r) { return r.map(function (v) { return v === null || v === undefined ? '' : String(v); }); }));
  var rng = sh.getRange(1, 1, all.length, tab.header.length);
  rng.setNumberFormat('@'); // plain text: phone numbers stay intact and nothing is run as a formula
  rng.setValues(all);
  sh.getRange(1, 1, 1, tab.header.length).setFontWeight('bold');
  sh.setFrozenRows(1);
  try { sh.autoResizeColumns(1, tab.header.length); } catch (e) { /* cosmetic */ }
}

/** Create (or refresh) the Drive sheet for one campaign. Returns {url, name}. */
function exportCampaign_(campaignId) {
  var c = findOne_('Campaigns', 'id', campaignId);
  if (!c) throw new ApiError('Campaign not found', null, 404);
  var t = findOne_('Templates', 'id', c.template_id) || {};
  var data = buildArchive_(c, t), name = archiveName_(c, t), ss;

  if (c.archive_url) {
    try { ss = SpreadsheetApp.openByUrl(c.archive_url); } catch (e) { ss = null; } // deleted or no access: make a new one
  }
  if (!ss) {
    var folder = archiveFolder_();
    ss = SpreadsheetApp.create(name);
    DriveApp.getFileById(ss.getId()).moveTo(folder);
    ss.getSheets()[0].setName('Summary');
  }
  Object.keys(data).forEach(function (tab) {
    writeArchiveSheet_(ss.getSheetByName(tab) || ss.insertSheet(tab), data[tab]);
  });

  var url = ss.getUrl();
  withLock_(function () {
    var fresh = findOne_('Campaigns', 'id', campaignId);
    fresh.archive_url = url; fresh.archived_at = nowIso_();
    saveRows_('Campaigns', [fresh]);
  });
  return { url: url, name: ss.getName() };
}

/** A campaign is finished when it was sent (or stopped) and nobody is still waiting, or it is old enough that nothing will change. */
function campaignFinished_(c, msgs, nowMs) {
  if (c.status !== 'sent' && c.status !== 'cancelled') return false;
  var waiting = msgs.some(function (m) { return ['queued', 'sent', 'delivered', 'read'].indexOf(m.status) >= 0; });
  return !waiting || nowMs - Date.parse(c.created_at) > ARCHIVE_AFTER_MS;
}

/** Cron: archive every finished campaign that has not been archived yet. */
function archiveFinishedCampaigns_(deadline) {
  var camps = loadTable_('Campaigns').filter(function (c) { return !c.archive_url && (c.status === 'sent' || c.status === 'cancelled'); });
  if (!camps.length) return { archived: 0 };
  var byCamp = {}; camps.forEach(function (c) { byCamp[c.id] = []; });
  loadTable_('Messages').forEach(function (m) { if (byCamp[m.campaign_id]) byCamp[m.campaign_id].push(m); });
  var now = Date.now(), done = 0, errors = 0;
  for (var i = 0; i < camps.length && Date.now() < deadline - 60000; i++) {
    if (!campaignFinished_(camps[i], byCamp[camps[i].id], now)) continue;
    try { exportCampaign_(camps[i].id); done++; }
    catch (e) { errors++; console.error('Archiving campaign ' + camps[i].id + ' failed: ' + e.message); }
  }
  return { archived: done, errors: errors };
}

// ===== Branding.gs =====
var BUILD_Branding = '20261107-1230'; // build stamp (see Build.gs)
/**
 * Logo. The logo file lives in the project owner's Google Drive. The owner runs importLogo() once;
 * it copies the image into Script Properties, so every teammate sees it without needing access to the Drive file.
 * Limit: 300 KB (a PNG, JPG, WebP, GIF or SVG; an SVG or a PNG under 100 KB is ideal).
 */
var DEFAULT_LOGO_FILE_ID = '1Qk1sC6kX2Zc5CRUcDi2ybQLJg1579rAE';
var LOGO_MAX_BYTES = 300 * 1024;
var LOGO_CHUNK = 8000; // one Script Property holds at most 9 KB

/** Accepts a plain Drive file ID or a full Drive link. */
function fileIdFrom_(v) {
  var m = /[-\w]{25,}/.exec(String(v || ''));
  return m ? m[0] : '';
}

function clearLogo_(props) {
  var n = Number(props.getProperty('LOGO_CHUNKS') || 0);
  for (var i = 0; i < n; i++) props.deleteProperty('LOGO_' + i);
  props.deleteProperty('LOGO_CHUNKS'); props.deleteProperty('LOGO_MIME');
  try { CacheService.getScriptCache().remove('logo'); } catch (e) { /* cache is optional */ }
}

/** Run once from the editor as the project owner. Reads the file named by LOGO_FILE_ID (ID or link), or the default below. */
function importLogo() {
  var props = PropertiesService.getScriptProperties();
  var id = fileIdFrom_(props.getProperty('LOGO_FILE_ID')) || DEFAULT_LOGO_FILE_ID, file;
  try { file = DriveApp.getFileById(id); }
  catch (e) {
    if (/permissions are not sufficient|required permissions/i.test(e.message)) {
      throw new Error('This project is not allowed to use Drive yet. Open Project Settings, tick "Show appsscript.json manifest file in editor", ' +
        'add "https://www.googleapis.com/auth/drive" to the oauthScopes list (see SETUP.md, "Permissions"), save, run importLogo again and approve the new permission.');
    }
    throw new Error('Cannot open the logo in Drive (file ID ' + id + '). Run this while signed in as the Google account that owns the file, or share the file with the account you are using. ' + e.message);
  }
  var blob = file.getBlob(), mime = String(blob.getContentType() || '');
  if (!/^image\/(png|jpeg|jpg|gif|webp|svg\+xml)$/.test(mime)) throw new Error('The file is "' + mime + '", not an image. Use a PNG, JPG, WebP, GIF or SVG.');
  var bytes = blob.getBytes();
  if (bytes.length > LOGO_MAX_BYTES) throw new Error('The logo is ' + Math.round(bytes.length / 1024) + ' KB; the limit is ' + (LOGO_MAX_BYTES / 1024) + ' KB. Export a smaller version (for example a 400 pixel wide PNG, or an SVG).');
  var b64 = Utilities.base64Encode(bytes), n = Math.ceil(b64.length / LOGO_CHUNK);
  clearLogo_(props);
  for (var i = 0; i < n; i++) props.setProperty('LOGO_' + i, b64.slice(i * LOGO_CHUNK, (i + 1) * LOGO_CHUNK));
  props.setProperty('LOGO_MIME', mime); props.setProperty('LOGO_CHUNKS', String(n));
  var msg = 'Logo imported (' + Math.max(1, Math.round(bytes.length / 1024)) + ' KB, ' + mime + '). Deploy a new version of the admin app to show it.';
  console.log(msg); toast_(msg);
  return msg;
}

function removeLogo() {
  clearLogo_(PropertiesService.getScriptProperties());
  var msg = 'Logo removed. The built-in Ek Tara mark is used again.';
  console.log(msg); toast_(msg);
  return msg;
}

/** data: URI for the page, or '' when no logo has been imported. */
function logoDataUri_() {
  var cache = null, hit = null;
  try { cache = CacheService.getScriptCache(); hit = cache.get('logo'); } catch (e) { cache = null; }
  if (hit) return hit;
  var props = PropertiesService.getScriptProperties(), n = Number(props.getProperty('LOGO_CHUNKS') || 0), mime = props.getProperty('LOGO_MIME');
  if (!n || !mime) return '';
  var b64 = '';
  for (var i = 0; i < n; i++) b64 += props.getProperty('LOGO_' + i) || '';
  var uri = 'data:' + mime + ';base64,' + b64;
  if (cache && uri.length < 90000) { try { cache.put('logo', uri, 3600); } catch (e) { /* too large to cache: fine */ } }
  return uri;
}

// ===== Build.gs =====
var BUILD_Build = '20261107-1230'; // build stamp
/**
 * Version check. Every .gs file starts with the same build stamp. If someone replaces only some of the files, or the web page and the
 * server code come from different versions, the app shows which file is stale instead of failing in confusing ways.
 */
function buildReport_() {
  var files = [
    ['Admin', typeof BUILD_Admin === 'undefined' ? null : BUILD_Admin],
    ['Api', typeof BUILD_Api === 'undefined' ? null : BUILD_Api],
    ['Archive', typeof BUILD_Archive === 'undefined' ? null : BUILD_Archive],
    ['Branding', typeof BUILD_Branding === 'undefined' ? null : BUILD_Branding],
    ['Build', typeof BUILD_Build === 'undefined' ? null : BUILD_Build],
    ['Campaigns', typeof BUILD_Campaigns === 'undefined' ? null : BUILD_Campaigns],
    ['Config', typeof BUILD_Config === 'undefined' ? null : BUILD_Config],
    ['Cron', typeof BUILD_Cron === 'undefined' ? null : BUILD_Cron],
    ['Db', typeof BUILD_Db === 'undefined' ? null : BUILD_Db],
    ['DonorApi', typeof BUILD_DonorApi === 'undefined' ? null : BUILD_DonorApi],
    ['DonorCore', typeof BUILD_DonorCore === 'undefined' ? null : BUILD_DonorCore],
    ['DonorEngine', typeof BUILD_DonorEngine === 'undefined' ? null : BUILD_DonorEngine],
    ['DonorRules', typeof BUILD_DonorRules === 'undefined' ? null : BUILD_DonorRules],
    ['Fallback', typeof BUILD_Fallback === 'undefined' ? null : BUILD_Fallback],
    ['Parents', typeof BUILD_Parents === 'undefined' ? null : BUILD_Parents],
    ['Permissions', typeof BUILD_Permissions === 'undefined' ? null : BUILD_Permissions],
    ['Replies', typeof BUILD_Replies === 'undefined' ? null : BUILD_Replies],
    ['Sender', typeof BUILD_Sender === 'undefined' ? null : BUILD_Sender],
    ['Setup', typeof BUILD_Setup === 'undefined' ? null : BUILD_Setup],
    ['Status', typeof BUILD_Status === 'undefined' ? null : BUILD_Status],
    ['Templates', typeof BUILD_Templates === 'undefined' ? null : BUILD_Templates],
    ['Twilio', typeof BUILD_Twilio === 'undefined' ? null : BUILD_Twilio],
    ['VoiceScripts', typeof BUILD_VoiceScripts === 'undefined' ? null : BUILD_VoiceScripts],
    ['Webhooks', typeof BUILD_Webhooks === 'undefined' ? null : BUILD_Webhooks]
  ];
  var present = files.filter(function (f) { return f[1]; }).map(function (f) { return f[1]; }).sort();
  var newest = present.length ? present[present.length - 1] : null, problems = [];
  files.forEach(function (f) {
    if (!f[1]) problems.push(f[0] + '.gs is missing or out of date');
    else if (f[1] !== newest) problems.push(f[0] + '.gs is from an older build (' + f[1] + ')');
  });
  return { newest: newest, problems: problems };
}

function buildProblems_() { var r = buildReport_(); return r.problems.join('; '); }

// ===== Campaigns.gs =====
var BUILD_Campaigns = '20261107-1230'; // build stamp (see Build.gs)
/** Campaigns: create, list, detail, cancel, retry. */
var CAMPAIGN_PAGE_SIZE = 50;

function countByStatus_(msgs) {
  var out = { total: msgs.length };
  STATUSES.forEach(function (s) { out[s] = 0; });
  msgs.forEach(function (m) { out[m.status] = (out[m.status] || 0) + 1; });
  return out;
}

function audienceLabel_(institution, type, classOrYear, section) {
  var parts = [institution];
  if (classOrYear) parts.push((type === 'college' ? 'Year ' : 'Class ') + classOrYear);
  if (section) parts.push('Section ' + section);
  return parts.join(' · ');
}

/** Approved templates with the same name (ignoring _v2...) and placeholders; newest per language. */
function languageVersions_(template, all) {
  var base = stripVersion_(template.name), nums = placeholderNumbers_(template.body).join(',');
  var cands = all.filter(function (t) {
    return t.status === 'approved' && stripVersion_(t.name) === base && placeholderNumbers_(t.body).join(',') === nums;
  }).sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  var versions = {};
  cands.forEach(function (t) { if (!versions[t.language]) versions[t.language] = t; });
  versions[template.language] = template;
  return versions;
}

function senderName_(email) {
  if (!email) return null;
  var a = findOne_('Admins', 'email', email);
  return (a && a.full_name) || email;
}

function createCampaign_(user, body) {
  return withLock_(function () {
    var tpls = loadTable_('Templates');
    var template = tpls.filter(function (t) { return t.id === body.template_id; })[0];
    if (!template) throw new ApiError('Template not found', null, 404);
    if (template.status !== 'approved') throw new ApiError('This template is not approved by WhatsApp yet.');

    var variables = {};
    placeholderNumbers_(template.body).forEach(function (n) {
      var v = String((body.variables || {})[String(n)] || '').trim();
      if (!v) throw new ApiError('Please fill in a value for {{' + n + '}}.');
      if (v.indexOf('\n') >= 0) throw new ApiError('The value for {{' + n + '}} must not contain line breaks.');
      variables[String(n)] = v;
    });

    var institution = String(body.institution || '').trim();
    if (!institution) throw new ApiError('Choose a school or college.');
    var cy = String(body.class_or_year || '').trim() || null;
    var section = cy ? (String(body.section || '').trim() || null) : null; // a section only makes sense inside a class
    var parents = loadTable_('Parents').filter(function (p) {
      return !p.opted_out && inGroup_(p, institution, cy, section);
    });
    if (!parents.length) throw new ApiError('No parents found in this group.');

    var cid = newId_(), now = nowIso_();
    insertRows_('Campaigns', [{
      id: cid, template_id: template.id, audience: audienceLabel_(institution, parents[0].institution_type, cy, section),
      institution: institution, class_or_year: cy, section: section, variables: variables,
      created_by: user.email, status: 'sending', created_at: now
    }]);
    var versions = languageVersions_(template, tpls);
    insertRows_('Messages', parents.map(function (p) {
      return { id: newId_(), campaign_id: cid, parent_id: p.id, template_id: (versions[p.language] || template).id,
        status: 'queued', updated_at: now };
    }));
    return { id: cid, message_count: parents.length };
  });
}

function listCampaigns_(user, f) {
  f = f || {};
  var offset = Number(f.offset) || 0;
  var rows = loadTable_('Campaigns').filter(function (c) {
    if (f.institution && c.institution !== f.institution) return false;
    // A filter also matches campaigns sent to a wider group (class 7 shows whole-school sends).
    if (f.class_or_year && c.class_or_year && c.class_or_year !== f.class_or_year) return false;
    if (f.section && c.section && c.section !== f.section) return false;
    return true;
  }).sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  var page = rows.slice(offset, offset + CAMPAIGN_PAGE_SIZE);
  if (!page.length) return [];
  var ids = {}; page.forEach(function (c) { ids[c.id] = []; });
  loadTable_('Messages').forEach(function (m) { if (ids[m.campaign_id]) ids[m.campaign_id].push(m); });
  var tpls = {}; loadTable_('Templates').forEach(function (t) { tpls[t.id] = t; });
  var admins = {}; loadTable_('Admins').forEach(function (a) { admins[a.email] = a; });
  return page.map(function (c) {
    delete c._row;
    c.template_name = (tpls[c.template_id] || {}).name;
    c.sender = ((admins[c.created_by] || {}).full_name) || c.created_by;
    c.counts = countByStatus_(ids[c.id]);
    return c;
  });
}

function getCampaign_(user, id, status) {
  var c = findOne_('Campaigns', 'id', id);
  if (!c) throw new ApiError('Campaign not found', null, 404);
  var t = findOne_('Templates', 'id', c.template_id) || {};
  var parents = {}; loadTable_('Parents').forEach(function (p) { parents[p.id] = p; });
  var all = loadTable_('Messages').filter(function (m) { return m.campaign_id === id; });
  var counts = countByStatus_(all);
  var msgs = status ? all.filter(function (m) { return m.status === status; }) : all;
  var now = Date.now();
  msgs = msgs.map(function (m) {
    var p = parents[m.parent_id] || { parent_name: '(deleted)', phone_e164: '', has_whatsapp: false, opted_out: false, language: 'en' };
    m.parents = { parent_name: p.parent_name, child_name: p.child_name, phone_e164: p.phone_e164,
      has_whatsapp: p.has_whatsapp, opted_out: p.opted_out, language: p.language };
    m.call_due_at = nextCallTime_(m, p, c.status, now);
    delete m._row;
    return m;
  });
  msgs.sort(function (a, b) { return a.parents.parent_name.localeCompare(b.parents.parent_name); });
  delete c._row;
  c.template_name = t.name; c.template_body = t.body; c.template_has_buttons = t.has_confirm_buttons;
  c.sender = senderName_(c.created_by); c.counts = counts; c.messages = msgs;
  return c;
}

/** Stop: unsent messages are cancelled and no more fallback calls are placed. */
function cancelCampaign_(user, id) {
  return withLock_(function () {
    var c = findOne_('Campaigns', 'id', id);
    if (!c) throw new ApiError('Campaign not found', null, 404);
    c.status = 'cancelled'; saveRows_('Campaigns', [c]);
    var stopped = loadTable_('Messages').filter(function (m) { return m.campaign_id === id && m.status === 'queued'; });
    stopped.forEach(function (m) { m.status = 'cancelled'; m.updated_at = nowIso_(); });
    saveRows_('Messages', stopped);
    return { stopped: stopped.length };
  });
}

/** Resend WhatsApp to failed messages that have not been called yet. */
function retryFailed_(user, id) {
  return withLock_(function () {
    var c = findOne_('Campaigns', 'id', id);
    if (!c) throw new ApiError('Campaign not found', null, 404);
    if (c.status === 'cancelled') throw new ApiError('This campaign was stopped.');
    var failed = loadTable_('Messages').filter(function (m) {
      return m.campaign_id === id && m.status === 'failed' && !m.call_requested_at;
    });
    failed.forEach(function (m) {
      m.status = 'queued'; m.wa_sid = null; m.wa_sent_at = null; m.wa_error = null; m.send_claimed_at = null; m.updated_at = nowIso_();
    });
    saveRows_('Messages', failed);
    if (failed.length) { c.status = 'sending'; saveRows_('Campaigns', [c]); }
    return { retried: failed.length };
  });
}

function resolveMessage_(user, messageId, outcome) {
  if (outcome !== 'confirmed' && outcome !== 'declined') throw new ApiError('Outcome must be confirmed or declined.');
  var ok = withLock_(function () { return setAdminOutcome_(messageId, outcome, user.email); });
  if (!ok) throw new ApiError("This message can't be changed (it was cancelled or doesn't exist).");
  logEvent_(messageId, 'admin', { outcome: outcome, by: user.email });
  return { ok: true };
}

// ===== Config.gs =====
var BUILD_Config = '20261107-1230'; // build stamp (see Build.gs)
/**
 * Configuration lives in Script Properties (Project Settings -> Script properties).
 * Never put the Twilio token in the code or in the spreadsheet.
 */
var DEFAULTS = {
  TWILIO_MESSAGING_SERVICE_SID: '',
  CALL_FALLBACK_HOURS: '6',
  CALL_WINDOW_START: '09:00',
  CALL_WINDOW_END: '19:00',
  APP_TIMEZONE: 'Asia/Kolkata',
  SEND_CONCURRENCY: '10',
  COST_PER_WHATSAPP: '0',
  COST_PER_CALL: '0',
  COST_CURRENCY: 'INR',
  DONOR_SEND_START: '09:00',
  DONOR_SEND_END: '19:00'
};

var cfgCache_ = null;

function cfg_() {
  if (cfgCache_) return cfgCache_;
  var p = PropertiesService.getScriptProperties().getProperties();
  function get(k) { return p[k] !== undefined && p[k] !== '' ? p[k] : (DEFAULTS[k] !== undefined ? DEFAULTS[k] : ''); }
  function hhmm(v) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(v).trim());
    return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : '09:00';
  }
  cfgCache_ = {
    TWILIO_ACCOUNT_SID: get('TWILIO_ACCOUNT_SID'),
    TWILIO_AUTH_TOKEN: get('TWILIO_AUTH_TOKEN'),
    TWILIO_WHATSAPP_FROM: get('TWILIO_WHATSAPP_FROM'),
    TWILIO_VOICE_FROM: get('TWILIO_VOICE_FROM'),
    TWILIO_MESSAGING_SERVICE_SID: get('TWILIO_MESSAGING_SERVICE_SID'),
    // URL of the *webhook* deployment (Execute as: Me, Access: Anyone), no trailing slash.
    PUBLIC_BASE_URL: String(get('PUBLIC_BASE_URL')).replace(/\/+$/, ''),
    WEBHOOK_SECRET: get('WEBHOOK_SECRET'),
    CALL_FALLBACK_HOURS: Number(get('CALL_FALLBACK_HOURS')) || 6,
    CALL_WINDOW_START: hhmm(get('CALL_WINDOW_START')),
    CALL_WINDOW_END: hhmm(get('CALL_WINDOW_END')),
    APP_TIMEZONE: get('APP_TIMEZONE'),
    SEND_CONCURRENCY: Math.max(1, Number(get('SEND_CONCURRENCY')) || 10),
    COST_PER_WHATSAPP: Number(get('COST_PER_WHATSAPP')) || 0,
    COST_PER_CALL: Number(get('COST_PER_CALL')) || 0,
    COST_CURRENCY: get('COST_CURRENCY'),
    DONOR_SEND_START: hhmm(get('DONOR_SEND_START')),
    DONOR_SEND_END: hhmm(get('DONOR_SEND_END'))
  };
  return cfgCache_;
}

function requireConfig_(keys) {
  var c = cfg_();
  var missing = keys.filter(function (k) { return !c[k]; });
  if (missing.length) throw new ApiError('Missing script properties: ' + missing.join(', ') + '. See SETUP.md.');
}

class ApiError extends Error {
  constructor(message, errors, status) {
    super(message);
    this.name = 'ApiError';
    this.errors = errors || null;
    this.status = status || 400;
  }
}

function nowIso_() { return new Date().toISOString(); }

// ===== Cron.gs =====
var BUILD_Cron = '20261107-1230'; // build stamp (see Build.gs)
/** Scheduler. Install with installTriggers() (menu: Parent Comm -> Install triggers). */
var TICK_BUDGET_MS = 4.5 * 60 * 1000;
var REPLAY_SOURCES = ['whatsapp_status', 'whatsapp_inbound', 'voice_gather', 'voice_status'];

/** Replay events that arrived while the lock was busy (last 24 h). */
function replayEvents_() {
  var cutoff = Date.now() - 24 * 3600 * 1000, done = 0;
  (donorReady_() ? ['Events', 'DonorEvents'] : ['Events']).forEach(function (tbl) {
    lastEvents_(500, tbl).filter(function (ev) {
      return !ev.processed && REPLAY_SOURCES.indexOf(ev.source) >= 0 && Date.parse(ev.created_at) > cutoff;
    }).forEach(function (ev) {
      if (processEvent_(ev.id, ev.source, ev.payload || {}, ev.message_id)) done++;
    });
  });
  return { replayed: done };
}

function cronTick() { return tick_(); }

function tick_() {
  var cache = CacheService.getScriptCache();
  if (cache.get('tick_running')) return { skipped: 'previous tick still running' };
  cache.put('tick_running', '1', 330);
  var deadline = Date.now() + TICK_BUDGET_MS;
  var result = {};
  // Replays first, then resends and re-checks so new failures get their fallback call in the same tick,
  // and recovered replies come before the fallback so a parent who answered is not called.
  var jobs = [
    ['replay_events', function () { return replayEvents_(); }],
    ['resume_campaigns', function () { return resumeStuckCampaigns_(deadline - 90000); }],
    ['whatsapp_recheck', function () { return recheckStuckMessages_(deadline - 60000); }],
    ['poll_status', function () { return instantUpdates_() ? { skipped: 'Twilio calls the app back (webhooks on)' } : pollMessageStatuses_(); }],
    ['recover_replies', function () { return recoverMissedReplies_(); }],
    ['fallback', function () { return runFallback_(deadline); }],
    ['donor_triggers', function () { return runDonorTriggers_(); }],
    ['donor_dispatch', function () { return dispatchDonorBatch_(Math.max(10000, deadline - Date.now() - 60000)); }],
    ['access_expiry', function () { return expireAccess_(); }],
    ['overview', function () { return refreshOverviewSnapshot_(); }],
    ['archive', function () { return archiveFinishedCampaigns_(deadline); }],
    ['templates', function () { return syncPendingTemplates_(donorReady_() ? ['Templates', 'DonorTemplates'] : ['Templates']); }]
  ];
  try {
    jobs.forEach(function (j) {
      try { result[j[0]] = j[1](); }
      catch (e) { console.error('Cron job ' + j[0] + ' failed: ' + e.message); result[j[0]] = { error: e.message }; }
    });
  } finally { cache.remove('tick_running'); }
  return result;
}

/** Every 5 minutes when the app has to ask Twilio for news (no Twilio address), otherwise every 10. */
function defaultTriggerMinutes_() { return instantUpdates_() ? 10 : 5; }

function installTriggers(minutes) {
  removeTriggers();
  var m = [1, 5, 10, 15, 30].indexOf(minutes) >= 0 ? minutes : defaultTriggerMinutes_();
  ScriptApp.newTrigger('cronTick').timeBased().everyMinutes(m).create();
  return 'Installed: cronTick every ' + m + ' minutes.';
}

function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'cronTick') ScriptApp.deleteTrigger(t);
  });
}

// ===== Db.gs =====
var BUILD_Db = '20261107-1230'; // build stamp (see Build.gs)
/**
 * Google Sheets as the database. One tab per table, row 1 = headers.
 * Types: s=string, b=boolean, j=json, n=number. Everything is stored as plain text
 * so phone numbers like +9198... are never turned into numbers by Sheets.
 *
 * Functions ending in "_" that change data must run inside withLock_().
 */
var SCHEMA = {
  Admins: [['email', 's'], ['full_name', 's'], ['active', 'b'], ['parent_access', 's'], ['donor_access', 's'],
    ['org_overview', 's'], ['role', 's'], ['admin_caps', 's'], ['expires_on', 's']],
  Parents: [['id', 's'], ['parent_name', 's'], ['phone_e164', 's'], ['child_name', 's'], ['institution', 's'],
    ['institution_type', 's'], ['class_or_year', 's'], ['section', 's'], ['language', 's'],
    ['has_whatsapp', 'b'], ['opted_out', 'b'], ['created_at', 's']],
  Templates: [['id', 's'], ['name', 's'], ['language', 's'], ['category', 's'], ['body', 's'],
    ['variable_names', 'j'], ['sample_values', 'j'], ['has_confirm_buttons', 'b'], ['status', 's'],
    ['twilio_content_sid', 's'], ['rejection_reason', 's'], ['requested_by', 's'], ['decision_seen', 'b'],
    ['created_at', 's'], ['updated_at', 's'], ['division', 's'], ['message_type', 's'], ['source_code', 's'],
    ['meta_status', 's'], ['meta_checked_at', 's']],
  Campaigns: [['id', 's'], ['template_id', 's'], ['audience', 's'], ['institution', 's'], ['class_or_year', 's'],
    ['section', 's'], ['variables', 'j'], ['created_by', 's'], ['status', 's'], ['created_at', 's'],
    ['archive_url', 's'], ['archived_at', 's']],
  Messages: [['id', 's'], ['campaign_id', 's'], ['parent_id', 's'], ['template_id', 's'], ['status', 's'],
    ['wa_sid', 's'], ['wa_sent_at', 's'], ['wa_error', 's'], ['call_sid', 's'], ['call_requested_at', 's'],
    ['call_status', 's'], ['call_digit', 's'], ['confirmed_via', 's'], ['send_claimed_at', 's'],
    ['reply_text', 's'], ['replied_at', 's'], ['resolved_by', 's'], ['updated_at', 's']],
  Events: [['id', 's'], ['message_id', 's'], ['source', 's'], ['payload', 'j'], ['created_at', 's'],
    ['processed', 'b']],

  // ---- Donor Communication ----
  Donors: [['id', 's'], ['name', 's'], ['contact_type', 's'], ['phone_e164', 's'], ['email', 's'], ['city', 's'], ['language', 's'],
    ['segment', 's'], ['source_note', 's'], ['whatsapp_opt_in', 'b'], ['opt_in_at', 's'], ['opt_in_source', 's'], ['opted_out', 'b'],
    ['status', 's'], ['project', 's'], ['core_programme', 's'], ['timeline_start', 's'], ['timeline_end', 's'],
    ['prior_year_amount', 's'], ['current_status', 's'], ['reporting_frequency', 's'], ['next_report_due', 's'], ['report_link', 's'],
    ['owner_name', 's'], ['owner_email', 's'], ['trustee_confirmed', 'b'], ['last_donation_date', 's'], ['last_donation_amount', 's'],
    ['last_update_at', 's'], ['last_message_at', 's'], ['last_message_type', 's'], ['last_message_trigger', 's'],
    ['notes', 's'], ['created_at', 's'], ['updated_at', 's']],
  SegmentHistory: [['id', 's'], ['donor_id', 's'], ['from_segment', 's'], ['to_segment', 's'], ['reason', 's'], ['changed_by', 's'], ['changed_at', 's']],
  Donations: [['id', 's'], ['donor_id', 's'], ['campaign_id', 's'], ['amount', 's'], ['donated_on', 's'], ['note', 's'],
    ['recorded_by', 's'], ['recorded_at', 's']],
  DonorCampaigns: [['id', 's'], ['name', 's'], ['start_date', 's'], ['midpoint_date', 's'], ['end_date', 's'], ['status', 's'],
    ['progress_text', 's'], ['results_text', 's'], ['results_ready_at', 's'], ['notes', 's'], ['created_at', 's']],
  DonorBroadcasts: [['id', 's'], ['trigger', 's'], ['kind', 's'], ['name', 's'], ['template_id', 's'], ['campaign_id', 's'],
    ['segments', 'j'], ['include_ids', 'j'], ['exclude_ids', 'j'], ['values', 'j'], ['send_on', 's'], ['event_date', 's'],
    ['status', 's'], ['dedupe_key', 's'], ['created_by', 's'], ['approved_by', 's'], ['approved_at', 's'], ['message_count', 'n'],
    ['created_at', 's']],
  DonorMessages: [['id', 's'], ['donor_id', 's'], ['channel', 's'], ['to_email', 's'], ['template_id', 's'], ['message_type', 's'],
    ['trigger', 's'], ['broadcast_id', 's'], ['campaign_id', 's'], ['donation_id', 's'], ['ref', 's'], ['variables', 'j'],
    ['priority', 'n'], ['dedupe_key', 's'], ['status', 's'], ['hold_reason', 's'], ['not_before', 's'], ['expires_at', 's'],
    ['send_claimed_at', 's'], ['wa_sid', 's'], ['wa_sent_at', 's'], ['wa_error', 's'], ['reply_text', 's'], ['replied_at', 's'],
    ['created_at', 's'], ['updated_at', 's']],
  Cities: [['city', 's'], ['timezone', 's'], ['start', 's'], ['end', 's']],

  // ---- Access file: who may use the app (readable by every staff member) ----
  AccessLog: [['id', 's'], ['at', 's'], ['by', 's'], ['action', 's'], ['email', 's'], ['details', 's']],
  Overview: [['key', 's'], ['value', 'j'], ['updated_at', 's']]
};
// Donor templates and donor events have the same shape as the parent ones, but live in the donor file.
SCHEMA.DonorTemplates = SCHEMA.Templates.slice();
SCHEMA.DonorEvents = SCHEMA.Events.slice();

/**
 * Three Google Sheets keep the departments apart at the file level:
 *   access  Admins (who may do what), AccessLog, Overview totals. Everyone signed in can read it.
 *   parent  parents, parent templates, parent campaigns and messages.
 *   donor   donors, donations, donor campaigns, broadcasts, messages, templates, cities.
 * A person who is not shared on a file cannot open it, in the app or in Google Drive.
 */
var FILE_OF = {
  Admins: 'access', AccessLog: 'access', Overview: 'access',
  Parents: 'parent', Templates: 'parent', Campaigns: 'parent', Messages: 'parent', Events: 'parent',
  Donors: 'donor', SegmentHistory: 'donor', Donations: 'donor', DonorCampaigns: 'donor', DonorBroadcasts: 'donor',
  DonorMessages: 'donor', DonorTemplates: 'donor', DonorEvents: 'donor', Cities: 'donor'
};
var FILE_TITLES = { parent: 'Ek Tara \u2013 Parent Database', donor: 'Ek Tara \u2013 Donor Database', access: 'Ek Tara \u2013 Access' };
var FILE_PROP = { parent: 'SPREADSHEET_ID', donor: 'DONOR_SPREADSHEET_ID', access: 'ACCESS_SPREADSHEET_ID' };

var sheetCache_ = {};

function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  var active = SpreadsheetApp.getActiveSpreadsheet(); // only set when the script is attached to a sheet
  if (active) return active;
  throw new Error('No database sheet yet. Run setup() once from the Apps Script editor.');
}

/** The spreadsheet that holds a file. Until setup() has created the donor and access files, everything is in the original one. */
function ssFor_(file) {
  if (file === 'parent') return ss_();
  var id = PropertiesService.getScriptProperties().getProperty(FILE_PROP[file]);
  return id ? SpreadsheetApp.openById(id) : ss_();
}

function fileIdOf_(file) {
  var id = PropertiesService.getScriptProperties().getProperty(FILE_PROP[file]);
  if (id) return id;
  try { return ss_().getId(); } catch (e) { return null; }   // before setup(): the one original file
}

function sheet_(name) {
  if (!sheetCache_[name]) {
    var s = ssFor_(FILE_OF[name] || 'parent').getSheetByName(name);
    if (!s) throw new Error('Sheet "' + name + '" is missing. Run Setup (see SETUP.md).');
    sheetCache_[name] = s;
  }
  return sheetCache_[name];
}

function newId_() { return Utilities.getUuid(); }

function fromCell_(v, type) {
  if (type === 'b') return v === true || String(v).toUpperCase() === 'TRUE';
  if (v === '' || v === null || v === undefined) return null;
  if (type === 'j') { try { return JSON.parse(v); } catch (e) { return null; } }
  if (type === 'n') return Number(v);
  return String(v);
}

function toCell_(v, type) {
  if (type === 'b') return v ? 'TRUE' : 'FALSE';
  if (v === null || v === undefined) return '';
  if (type === 'j') return JSON.stringify(v);
  return String(v);
}

function fieldNames_(name) { return SCHEMA[name].map(function (c) { return c[0]; }); }

function rowFromValues_(name, vals, rowNumber) {
  var cols = SCHEMA[name], o = { _row: rowNumber };
  for (var j = 0; j < cols.length; j++) o[cols[j][0]] = fromCell_(vals[j], cols[j][1]);
  return o;
}

function loadTable_(name) {
  var sh = sheet_(name), last = sh.getLastRow(), n = SCHEMA[name].length, rows = [];
  if (last < 2) return rows;
  var vals = sh.getRange(2, 1, last - 1, n).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (vals[i][0] === '' || vals[i][0] === null) continue;
    rows.push(rowFromValues_(name, vals[i], i + 2));
  }
  return rows;
}

function loadRowAt_(name, rowNumber) {
  var vals = sheet_(name).getRange(rowNumber, 1, 1, SCHEMA[name].length).getValues()[0];
  return rowFromValues_(name, vals, rowNumber);
}

/** Exact-match lookup on one column using the Sheets text finder (fast, no full load). */
function findBy_(name, field, value) {
  if (value === null || value === undefined || value === '') return [];
  var sh = sheet_(name), last = sh.getLastRow();
  if (last < 2) return [];
  var idx = fieldNames_(name).indexOf(field);
  var cells = sh.getRange(2, idx + 1, last - 1, 1).createTextFinder(String(value))
    .matchEntireCell(true).matchCase(true).findAll();
  return cells.map(function (c) { return loadRowAt_(name, c.getRow()); });
}

function findOne_(name, field, value) {
  var r = findBy_(name, field, value);
  return r.length ? r[0] : null;
}

function rowToValues_(name, obj) {
  return SCHEMA[name].map(function (c) { return toCell_(obj[c[0]], c[1]); });
}

/** Write changed rows back (rows must carry _row). Contiguous rows go in one call. */
function saveRows_(name, rows) {
  if (!rows.length) return;
  var sh = sheet_(name), n = SCHEMA[name].length;
  var sorted = rows.slice().sort(function (a, b) { return a._row - b._row; });
  var i = 0;
  while (i < sorted.length) {
    var j = i;
    while (j + 1 < sorted.length && sorted[j + 1]._row === sorted[j]._row + 1) j++;
    var block = sorted.slice(i, j + 1).map(function (r) { return rowToValues_(name, r); });
    sh.getRange(sorted[i]._row, 1, block.length, n).setValues(block);
    i = j + 1;
  }
}

function insertRows_(name, objs) {
  if (!objs.length) return;
  var sh = sheet_(name), n = SCHEMA[name].length, CHUNK = 2000;
  for (var i = 0; i < objs.length; i += CHUNK) {
    var chunk = objs.slice(i, i + CHUNK).map(function (o) { return rowToValues_(name, o); });
    var start = sh.getLastRow() + 1, end = start + chunk.length - 1;
    if (end > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), end - sh.getMaxRows() + 100);
    var rng = sh.getRange(start, 1, chunk.length, n);
    rng.setNumberFormat('@');
    rng.setValues(chunk);
  }
}

/** Replace all data rows (used for bulk deletes). */
function replaceTable_(name, objs) {
  var sh = sheet_(name), last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, SCHEMA[name].length).clearContent();
  insertRows_(name, objs);
}

function deleteRow_(name, row) { sheet_(name).deleteRow(row._row); }

function withLock_(fn, waitMs) {
  var lock = LockService.getScriptLock();
  lock.waitLock(waitMs || 30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---------- Events (raw webhook / cron / admin log) ----------

/** Donor events live in the donor file and their ids start with "d-". */
function evTable_(id) { return String(id).indexOf('d-') === 0 ? 'DonorEvents' : 'Events'; }
function isDonorId_(id) { return String(id || '').indexOf('d-') === 0; }

/** Append-only; safe without the lock. Returns the event id. division: 'donor' writes to the donor file, anything else to the parent file. */
function logEvent_(messageId, source, payload, division) {
  var donor = division === 'donor', id = (donor ? 'd-' : '') + newId_();
  sheet_(donor ? 'DonorEvents' : 'Events').appendRow([id, messageId || '', source, JSON.stringify(payload || {}), nowIso_(), 'FALSE']);
  return id;
}

function eventRowNumber_(id) {
  var sh = sheet_(evTable_(id)), last = sh.getLastRow();
  if (last < 2) return null;
  var c = sh.getRange(2, 1, last - 1, 1).createTextFinder(id).matchEntireCell(true).matchCase(true).findNext();
  return c ? c.getRow() : null;
}

function markEventProcessed_(id) {
  var r = eventRowNumber_(id);
  if (r) sheet_(evTable_(id)).getRange(r, 6).setValue('TRUE');
}

function isEventProcessed_(id) {
  var r = eventRowNumber_(id);
  return r ? String(sheet_(evTable_(id)).getRange(r, 6).getValue()).toUpperCase() === 'TRUE' : true;
}

function setEventMessageId_(id, messageId) {
  var r = eventRowNumber_(id);
  if (r) sheet_(evTable_(id)).getRange(r, 2).setValue(messageId);
}

/** The newest `n` events of a table ('Events' or 'DonorEvents'). */
function lastEvents_(n, table) {
  table = table || 'Events';
  var sh = sheet_(table), last = sh.getLastRow();
  if (last < 2) return [];
  var first = Math.max(2, last - n + 1);
  var vals = sh.getRange(first, 1, last - first + 1, 6).getValues();
  return vals.map(function (v, i) { return rowFromValues_(table, v, first + i); });
}

function eventsForMessage_(messageId) {
  var rows = findBy_('Events', 'message_id', messageId);
  rows.sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
  return rows.slice(0, 200).map(function (e) {
    return { id: e.id, source: e.source, payload: e.payload || {}, created_at: e.created_at };
  });
}

/** Which department a message belongs to (donor message ids start with "d-"; older ones are looked up). */
function divisionOfMessageId_(id) {
  if (!id) return 'parent';
  if (isDonorId_(id)) return 'donor';
  if (findOne_('Messages', 'id', id)) return 'parent';
  return donorReady_() && findOne_('DonorMessages', 'id', id) ? 'donor' : 'parent';
}

/** Which department a phone number belongs to (parent wins if it is in both). */
function divisionOfPhone_(phone) {
  if (findBy_('Parents', 'phone_e164', phone).length) return 'parent';
  return donorReady_() && findBy_('Donors', 'phone_e164', phone).length ? 'donor' : 'parent';
}

// ===== DonorApi.gs =====
var BUILD_DonorApi = '20261107-1230'; // build stamp (see Build.gs)
/** API methods of the Donor workspace. Every name starts with "donor." so the permission service requires donor access. */
function donorOverview_() {
  var today = todayStr_(), donors = loadTable_('Donors'), seg = {}, optedIn = 0, awaitingTrustee = 0;
  SEGMENT_CODES.forEach(function (s) { seg[s] = 0; });
  donors.forEach(function (d) {
    seg[d.segment] = (seg[d.segment] || 0) + 1;
    if (d.whatsapp_opt_in && !d.opted_out) optedIn++;
    if (d.segment === 'P1' && !d.trustee_confirmed && !d.opted_out) awaitingTrustee++;
  });
  var q = { queued: 0, held: 0, awaiting_confirmation: 0, failed: 0, sent_7d: 0 }, weekAgo = Date.now() - 7 * 86400000;
  loadTable_('DonorMessages').forEach(function (m) {
    if (q[m.status] !== undefined) q[m.status]++;
    if (m.wa_sent_at && Date.parse(m.wa_sent_at) >= weekAgo) q.sent_7d++;
  });
  var tpls = loadTable_('DonorTemplates').filter(function (t) { return t.status === 'approved'; });
  var haveType = {}; tpls.forEach(function (t) { haveType[t.message_type] = true; });
  return {
    ready: true, total: donors.length, opted_in: optedIn, awaiting_trustee: awaitingTrustee, segments: seg, queue: q,
    drafts: loadTable_('DonorBroadcasts').filter(function (b) { return b.status === 'draft'; })
      .map(function (b) { return { id: b.id, name: b.name, trigger: b.trigger, send_on: b.send_on }; }),
    reports_due: donors.filter(function (d) { return d.segment === 'D1' && d.next_report_due && d.next_report_due <= addDaysStr_(today, 14); })
      .sort(function (a, b) { return String(a.next_report_due).localeCompare(String(b.next_report_due)); })
      .map(function (d) { return { id: d.id, name: d.name, next_report_due: d.next_report_due, has_link: !!d.report_link, has_owner_email: !!d.owner_email }; }),
    missing_templates: Object.keys(MESSAGE_TYPES).filter(function (t) { return !haveType[t]; }).map(function (t) { return MESSAGE_TYPES[t]; })
  };
}

function donorMeta_() {
  return { segments: SEGMENTS, message_types: MESSAGE_TYPES, auto_labels: AUTO_LABELS, kinds: { general_update: 'General update (T8)', special_update: 'Special update (T11)',
    festive_greeting: 'Festive greeting (T12)', campaign_update: 'Campaign update (T4 / T5)' }, exempt: EXEMPT_TYPES, cap_days: UPDATE_CAP_DAYS,
    cities: loadTable_('Cities').map(function (c) { return { city: c.city, timezone: c.timezone, start: c.start, end: c.end }; }) };
}

/** Why the donor workspace is not ready, in plain words ('' when it is). */
function donorSetupProblem_() {
  if (!PropertiesService.getScriptProperties().getProperty(FILE_PROP.donor)) return 'The donor Google Sheet has not been created yet.';
  try {
    var have = ssFor_('donor').getSheets().map(function (t) { return t.getName(); });
    var missing = Object.keys(FILE_OF).filter(function (n) { return FILE_OF[n] === 'donor' && have.indexOf(n) < 0; });
    return missing.length ? 'The donor Google Sheet is missing these tabs: ' + missing.join(', ') + '.' : '';
  } catch (e) { return 'The donor Google Sheet could not be opened: ' + e.message; }
}

function retryDonorTemplate_(user, id) {
  var t = findOne_('DonorTemplates', 'id', id);
  if (!t) throw new ApiError('Template not found', null, 404);
  if (t.status !== 'draft') throw new ApiError('Only draft templates can be submitted.');
  return submitToMeta_(id, 'DonorTemplates');
}

var DONOR_API = {
  'donor.home': function (u) { return donorReady_() ? donorOverview_() : { ready: false, message: 'The donor workspace needs a one-time setup.', problem: donorSetupProblem_(), build_problem: buildProblems_(), can_setup: !!u.owner, planned: [] }; },
  'donor.meta': function (u) { return donorMeta_(); },
  'donor.donors.list': function (u, f) { return listDonors_(u, f); },
  'donor.donors.get': function (u, id) { return donorDetail_(u, id); },
  'donor.donors.save': function (u, id, body) { var r = saveDonor_(u, id, body); runDonorTriggers_(); return r; },
  'donor.donors.import': function (u, csv) { var r = importDonors_(u, csv); runDonorTriggers_(); return r; },
  'donor.donors.setOptIn': function (u, id, v) { return setOptIn_(u, id, v); },
  'donor.donors.setOptedOut': function (u, id, v) { return setOptedOut_(u, id, v); },
  'donor.donors.confirmTrustee': function (u, id) { return confirmTrustee_(u, id); },
  'donor.donors.changeSegment': function (u, id, to, reason) { var r = changeSegment_(u, id, to, reason); runDonorTriggers_(); return r; },
  'donor.donors.delete': function (u, id) { return deleteDonor_(u, id); },
  'donor.donations.record': function (u, id, body) { return recordDonation_(u, id, body); },
  'donor.donations.update': function (u, id, body) { return updateDonation_(u, id, body); },
  'donor.donations.delete': function (u, id) { return deleteDonation_(u, id); },
  'donor.cities.save': function (u, rows) { var r = saveCities_(u, rows); return r; },
  'donor.campaigns.list': function (u) { return listDonorCampaigns_(); },
  'donor.campaigns.save': function (u, id, body) { var r = saveDonorCampaign_(u, id, body); runDonorTriggers_(); return r; },
  'donor.campaigns.resultsReady': function (u, id) { return markResultsReady_(u, id); },
  'donor.templates.list': function (u) { return listDonorTemplates_(); },
  'donor.templates.create': function (u, body) { return createDonorTemplate_(u, body); },
  'donor.templates.update': function (u, id, body) { return updateDonorTemplate_(u, id, body); },
  'donor.templates.retrySubmit': function (u, id) { return retryDonorTemplate_(u, id); },
  'donor.templates.sync': function (u) { return syncPendingTemplates_(['DonorTemplates']); },
  'donor.templates.import': function (u) { return importDonorTemplates_(u); },
  'donor.broadcasts.list': function (u) { return listBroadcasts_(); },
  'donor.broadcasts.save': function (u, id, body) { return saveBroadcast_(u, id, body); },
  'donor.broadcasts.preview': function (u, id) { return previewBroadcast_(u, id); },
  'donor.broadcasts.approve': function (u, id) { return approveBroadcast_(u, id); },
  'donor.broadcasts.cancel': function (u, id) { return cancelBroadcast_(u, id); },
  'donor.broadcasts.delete': function (u, id) { return deleteDraftBroadcast_(u, id); },
  'donor.messages.list': function (u, f) { return listDonorMessages_(u, f); },
  'donor.messages.cancel': function (u, id) { return cancelDonorMessage_(u, id); },
  'donor.messages.retry': function (u, id) { return retryDonorMessage_(u, id); },
  /** The screen calls this repeatedly after an approval or donation; the 10-minute cron does the same. */
  'donor.dispatch': function (u) { runDonorTriggers_(); return dispatchDonorBatch_(40000); }
};

// ===== DonorCore.gs =====
var BUILD_DonorCore = '20261107-1230'; // build stamp (see Build.gs)
/** Donor Communication: donors, segments, donations, campaigns, templates and broadcasts (the data side). */
var DONOR_STATUS_OPEN = ['queued', 'held', 'awaiting_confirmation'];

function cleanDonorRow_(d) { var c = {}; Object.keys(d).forEach(function (k) { if (k !== '_row') c[k] = d[k]; }); return c; }

function strOrNull_(v) { var s = String(v === null || v === undefined ? '' : v).trim(); return s || null; }

function parseYesNo_(raw) {
  var v = String(raw === null || raw === undefined ? '' : raw).trim().toLowerCase();
  if (v === '') return null;
  if (['yes', 'y', 'true', '1'].indexOf(v) >= 0) return true;
  if (['no', 'n', 'false', '0'].indexOf(v) >= 0) return false;
  return undefined; // not understood
}

/** Change a donor's segment in memory and return the history row to insert. Callers save both. */
function moveSegment_(donor, to, reason, by) {
  var from = donor.segment || null;
  if (from === to) return null;
  donor.segment = to; donor.updated_at = nowIso_();
  return { id: newId_(), donor_id: donor.id, from_segment: from, to_segment: to, reason: reason || '', changed_by: by || 'system', changed_at: nowIso_() };
}

/** Moving from potential donor to donor (T3) ends the potential-donor schedule: drop their unsent welcome / general updates. */
function cancelPotentialDonorMessages_(donorId, msgs) {
  var changed = [];
  msgs.forEach(function (m) {
    if (m.donor_id === donorId && DONOR_STATUS_OPEN.indexOf(m.status) >= 0 && (m.message_type === 'welcome' || m.message_type === 'general_update')) {
      m.status = 'cancelled'; m.hold_reason = 'Became a donor: potential-donor updates stopped'; m.updated_at = nowIso_(); changed.push(m);
    }
  });
  return changed;
}

// ---------- validating one donor ----------
function cleanDonor_(f) {
  var name = strOrNull_(f.name);
  if (!name) return { error: 'name is empty' };
  var phoneRaw = strOrNull_(f.phone);
  if (!phoneRaw) return { error: 'phone is empty' };
  var phone = normalizePhone_(phoneRaw);
  if (!phone) return { error: "invalid phone number '" + phoneRaw + "'" };
  var seg = String(f.segment || '').trim().toUpperCase();
  if (SEGMENT_CODES.indexOf(seg) < 0) return { error: "segment must be one of " + SEGMENT_CODES.join(', ') + ", got '" + (f.segment || '') + "'" };
  var email = strOrNull_(f.email);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "invalid email '" + email + "'" };
  var ownerEmail = strOrNull_(f.owner_email);
  if (ownerEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail)) return { error: "invalid owner_email '" + ownerEmail + "'" };
  var dates = {};
  var bad = null;
  ['next_report_due', 'last_donation_date', 'timeline_start', 'timeline_end'].forEach(function (k) {
    if (strOrNull_(f[k]) === null) { dates[k] = null; return; }
    var d = parseDateInput_(f[k]);
    if (!d) bad = k + " is not a valid date ('" + f[k] + "')"; else dates[k] = d;
  });
  if (bad) return { error: bad };
  var freq = strOrNull_(f.reporting_frequency);
  return { row: {
    name: name, contact_type: strOrNull_(f.contact_type), phone_e164: phone, email: email, city: strOrNull_(f.city),
    language: (strOrNull_(f.language) || 'en').toLowerCase(), segment: seg, source_note: strOrNull_(f.source_note),
    status: strOrNull_(f.status), project: strOrNull_(f.project), core_programme: strOrNull_(f.core_programme),
    timeline_start: dates.timeline_start, timeline_end: dates.timeline_end, prior_year_amount: strOrNull_(f.prior_year_amount),
    current_status: strOrNull_(f.current_status), reporting_frequency: freq, next_report_due: dates.next_report_due,
    report_link: strOrNull_(f.report_link), owner_name: strOrNull_(f.owner_name), owner_email: ownerEmail,
    last_donation_date: dates.last_donation_date, notes: strOrNull_(f.notes)
  } };
}

// ---------- CSV import ----------
var DONOR_CSV_ALIASES = {
  name: ['name', 'donor_name', 'donor'], phone: ['phone', 'contact_number', 'contact', 'mobile', 'phone_number', 'whatsapp'],
  email: ['email'], segment: ['segment'], contact_type: ['contact_type', 'type', 'donor_type'], city: ['city'], language: ['language'],
  source_note: ['source_note', 'reference', 'source'], status: ['status', 'donor_status'], project: ['project'],
  core_programme: ['core_programme', 'programme', 'core_program'], timeline_start: ['timeline_start', 'timeline_-_start'],
  timeline_end: ['timeline_end', 'timeline_-_end'], prior_year_amount: ['prior_year_amount', 'adv_donation_2025-26', 'adv_donation_2025_26'],
  current_status: ['current_status', 'status_2026-27', 'status_2026_27'], reporting_frequency: ['reporting_frequency', 'reportng_frequency'],
  next_report_due: ['next_report_due'], report_link: ['report_link'], owner_name: ['owner_name', 'owner'], owner_email: ['owner_email'],
  last_donation_date: ['last_donation_date'], notes: ['notes', 'note'], whatsapp_opt_in: ['whatsapp_opt_in', 'opt_in', 'optin']
};

function headerIndex_(header) {
  var idx = {}, used = {};
  header.forEach(function (h, i) {
    var k = String(h).trim().toLowerCase().replace(/\s+/g, '_');
    Object.keys(DONOR_CSV_ALIASES).forEach(function (field) {
      if (!used[field] && DONOR_CSV_ALIASES[field].indexOf(k) >= 0) { idx[field] = i; used[field] = true; }
    });
  });
  return idx;
}

function importDonors_(user, csvText) {
  var table;
  try { table = Utilities.parseCsv(String(csvText || '').replace(/^\uFEFF/, '')); } catch (e) { throw new ApiError('File must be a UTF-8 CSV'); }
  if (!table.length) throw new ApiError('The file is empty.');
  var idx = headerIndex_(table[0]);
  var missing = ['name', 'phone', 'segment'].filter(function (c) { return idx[c] === undefined; });
  if (missing.length) throw new ApiError('Missing columns: ' + missing.join(', ') + '. Each row needs name, phone and segment (P1 to P5, D1, D2).');
  var rows = [], rejected = [], seen = {};
  for (var i = 1; i < table.length; i++) {
    var cells = table[i], rowNumber = i + 1;
    if (cells.length === 1 && String(cells[0]).trim() === '') continue;
    var rec = {};
    Object.keys(idx).forEach(function (f) { rec[f] = cells[idx[f]] === undefined ? '' : String(cells[idx[f]]); });
    var res = cleanDonor_(rec);
    if (res.error) { rejected.push({ row: rowNumber, phone: rec.phone || null, reason: res.error }); continue; }
    var optIn = parseYesNo_(rec.whatsapp_opt_in);
    if (optIn === undefined) { rejected.push({ row: rowNumber, phone: rec.phone || null, reason: "whatsapp_opt_in must be yes/no, got '" + rec.whatsapp_opt_in + "'" }); continue; }
    if (seen[res.row.phone_e164]) { rejected.push({ row: rowNumber, phone: rec.phone || null, reason: 'duplicate phone, already in row ' + seen[res.row.phone_e164] }); continue; }
    seen[res.row.phone_e164] = rowNumber;
    rows.push({ data: res.row, optIn: optIn });
  }
  return withLock_(function () {
    var byPhone = {}; loadTable_('Donors').forEach(function (d) { byPhone[d.phone_e164] = d; });
    var msgs = loadTable_('DonorMessages'), upd = [], ins = [], hist = [], msgsChanged = [], now = nowIso_();
    rows.forEach(function (r) {
      var old = byPhone[r.data.phone_e164];
      if (old) {
        var keep = { segment: old.segment };
        Object.keys(r.data).forEach(function (k) { if (r.data[k] !== null || ['segment'].indexOf(k) >= 0) old[k] = r.data[k]; });
        old.segment = keep.segment;
        if (r.data.segment !== keep.segment) {
          var h = moveSegment_(old, r.data.segment, 'CSV import', user.email); if (h) hist.push(h);
          if (POTENTIAL_SEGMENTS.indexOf(keep.segment) >= 0 && POTENTIAL_SEGMENTS.indexOf(r.data.segment) < 0)
            cancelPotentialDonorMessages_(old.id, msgs).forEach(function (m) { msgsChanged.push(m); });
        }
        if (r.optIn === true && !old.whatsapp_opt_in) { old.whatsapp_opt_in = true; old.opt_in_at = now; old.opt_in_source = 'csv import'; }
        if (r.optIn === false) { old.whatsapp_opt_in = false; }
        old.updated_at = now; upd.push(old);
      } else {
        var d = r.data; d.id = newId_(); d.whatsapp_opt_in = r.optIn === true; d.opt_in_at = r.optIn === true ? now : null;
        d.opt_in_source = r.optIn === true ? 'csv import' : null; d.opted_out = false; d.trustee_confirmed = false;
        d.created_at = now; d.updated_at = now;
        ins.push(d); hist.push({ id: newId_(), donor_id: d.id, from_segment: null, to_segment: d.segment, reason: 'Added by CSV import', changed_by: user.email, changed_at: now });
      }
    });
    saveRows_('Donors', upd); saveRows_('DonorMessages', msgsChanged); insertRows_('Donors', ins); insertRows_('SegmentHistory', hist);
    return { inserted: ins.length, updated: upd.length, rejected: rejected.length, errors: rejected };
  });
}

// ---------- donors ----------
function listDonors_(user, f) {
  f = f || {};
  var q = String(f.q || '').toLowerCase();
  return loadTable_('Donors').filter(function (d) {
    if (f.segment && d.segment !== f.segment) return false;
    if (f.optin === 'yes' && !(d.whatsapp_opt_in && !d.opted_out)) return false;
    if (f.optin === 'no' && d.whatsapp_opt_in && !d.opted_out) return false;
    if (q && (d.name + ' ' + (d.phone_e164 || '') + ' ' + (d.email || '') + ' ' + (d.city || '')).toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); }).map(cleanDonorRow_);
}

function saveDonor_(user, id, body) {
  var res = cleanDonor_(body);
  if (res.error) throw new ApiError(res.error);
  return withLock_(function () {
    var clash = findBy_('Donors', 'phone_e164', res.row.phone_e164).filter(function (d) { return d.id !== id; });
    if (clash.length) throw new ApiError('Another donor already has this phone number.');
    var now = nowIso_(), donor, hist = [];
    if (id) {
      donor = findOne_('Donors', 'id', id);
      if (!donor) throw new ApiError('Donor not found', null, 404);
      var oldSeg = donor.segment;
      Object.keys(res.row).forEach(function (k) { donor[k] = res.row[k]; });
      donor.segment = oldSeg;
      if (res.row.segment !== oldSeg) {
        var h = moveSegment_(donor, res.row.segment, strOrNull_(body.segment_reason) || 'Edited by team', user.email); if (h) hist.push(h);
        if (POTENTIAL_SEGMENTS.indexOf(oldSeg) >= 0 && POTENTIAL_SEGMENTS.indexOf(res.row.segment) < 0)
          saveRows_('DonorMessages', cancelPotentialDonorMessages_(donor.id, loadTable_('DonorMessages')));
      }
      donor.updated_at = now;
      saveRows_('Donors', [donor]);
    } else {
      donor = res.row; donor.id = newId_(); donor.whatsapp_opt_in = false; donor.opted_out = false; donor.trustee_confirmed = false;
      donor.created_at = now; donor.updated_at = now;
      insertRows_('Donors', [donor]);
      hist.push({ id: newId_(), donor_id: donor.id, from_segment: null, to_segment: donor.segment, reason: 'Added by team', changed_by: user.email, changed_at: now });
    }
    insertRows_('SegmentHistory', hist);
    return cleanDonorRow_(donor);
  });
}

function setOptIn_(user, id, optIn) {
  return withLock_(function () {
    var d = findOne_('Donors', 'id', id);
    if (!d) throw new ApiError('Donor not found', null, 404);
    if (optIn) { d.whatsapp_opt_in = true; d.opted_out = false; d.opt_in_at = nowIso_(); d.opt_in_source = 'recorded by ' + user.email; }
    else { d.whatsapp_opt_in = false; d.opt_in_source = 'removed by ' + user.email; }
    d.updated_at = nowIso_();
    saveRows_('Donors', [d]);
    return cleanDonorRow_(d);
  });
}

function setOptedOut_(user, id, optedOut) {
  return withLock_(function () {
    var d = findOne_('Donors', 'id', id);
    if (!d) throw new ApiError('Donor not found', null, 404);
    d.opted_out = !!optedOut; d.updated_at = nowIso_();
    saveRows_('Donors', [d]);
    if (optedOut) {
      var open = loadTable_('DonorMessages').filter(function (m) { return m.donor_id === id && DONOR_STATUS_OPEN.indexOf(m.status) >= 0 && m.channel === 'whatsapp'; });
      open.forEach(function (m) { m.status = 'cancelled'; m.hold_reason = 'Donor opted out'; m.updated_at = nowIso_(); });
      saveRows_('DonorMessages', open);
    }
    return cleanDonorRow_(d);
  });
}

/** P1 leads get their welcome only after the trustee confirms (T1). */
function confirmTrustee_(user, id) {
  return withLock_(function () {
    var d = findOne_('Donors', 'id', id);
    if (!d) throw new ApiError('Donor not found', null, 404);
    d.trustee_confirmed = true; d.updated_at = nowIso_();
    saveRows_('Donors', [d]);
    var waiting = loadTable_('DonorMessages').filter(function (m) { return m.donor_id === id && m.status === 'awaiting_confirmation'; });
    waiting.forEach(function (m) { m.status = 'queued'; m.hold_reason = null; m.updated_at = nowIso_(); });
    saveRows_('DonorMessages', waiting);
    return cleanDonorRow_(d);
  });
}

function changeSegment_(user, id, to, reason) {
  if (SEGMENT_CODES.indexOf(to) < 0) throw new ApiError('Unknown segment.');
  return withLock_(function () {
    var d = findOne_('Donors', 'id', id);
    if (!d) throw new ApiError('Donor not found', null, 404);
    var from = d.segment, h = moveSegment_(d, to, strOrNull_(reason) || 'Changed by team', user.email);
    if (h) {
      saveRows_('Donors', [d]); insertRows_('SegmentHistory', [h]);
      if (POTENTIAL_SEGMENTS.indexOf(from) >= 0 && POTENTIAL_SEGMENTS.indexOf(to) < 0) saveRows_('DonorMessages', cancelPotentialDonorMessages_(id, loadTable_('DonorMessages')));
    }
    return cleanDonorRow_(d);
  });
}

function deleteDonor_(user, id) {
  return withLock_(function () {
    var d = findOne_('Donors', 'id', id);
    if (!d) throw new ApiError('Donor not found', null, 404);
    [['Donors', 'id'], ['SegmentHistory', 'donor_id'], ['Donations', 'donor_id'], ['DonorMessages', 'donor_id']].forEach(function (p) {
      var rows = loadTable_(p[0]), keep = rows.filter(function (r) { return r[p[1]] !== id; });
      if (keep.length !== rows.length) replaceTable_(p[0], keep);
    });
    return { deleted: 1 };
  });
}

function donorDetail_(user, id) {
  var d = findOne_('Donors', 'id', id);
  if (!d) throw new ApiError('Donor not found', null, 404);
  var camps = {}; loadTable_('DonorCampaigns').forEach(function (c) { camps[c.id] = c; });
  var tpls = {}; loadTable_('DonorTemplates').forEach(function (t) { tpls[t.id] = t; });
  var history = findBy_('SegmentHistory', 'donor_id', id).sort(function (a, b) { return String(b.changed_at).localeCompare(String(a.changed_at)); }).map(cleanDonorRow_);
  var donations = findBy_('Donations', 'donor_id', id).sort(function (a, b) { return String(b.donated_on).localeCompare(String(a.donated_on)); }).map(function (x) {
    var c = cleanDonorRow_(x); c.campaign_name = x.campaign_id && camps[x.campaign_id] ? camps[x.campaign_id].name : null; return c;
  });
  var messages = findBy_('DonorMessages', 'donor_id', id).sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); }).slice(0, 40).map(function (m) {
    var c = cleanDonorRow_(m); c.template_name = m.template_id && tpls[m.template_id] ? tpls[m.template_id].name : null; return c;
  });
  return { donor: cleanDonorRow_(d), history: history, donations: donations, messages: messages };
}

// ---------- donations (T2 thank-you, T3 potential donor becomes donor) ----------
function recordDonation_(user, donorId, body) {
  var amount = parseAmount_(body.amount);
  if (!amount) throw new ApiError('Enter the donation amount as a number greater than zero.');
  var date = strOrNull_(body.donated_on) ? parseDateInput_(body.donated_on) : todayStr_();
  if (!date) throw new ApiError('The donation date is not valid.');
  var result = withLock_(function () {
    var d = findOne_('Donors', 'id', donorId);
    if (!d) throw new ApiError('Donor not found', null, 404);
    var campaignId = strOrNull_(body.campaign_id);
    if (campaignId && !findOne_('DonorCampaigns', 'id', campaignId)) throw new ApiError('Campaign not found', null, 404);
    var now = nowIso_(), don = { id: newId_(), donor_id: donorId, campaign_id: campaignId, amount: String(amount), donated_on: date,
      note: strOrNull_(body.note), recorded_by: user.email, recorded_at: now };
    insertRows_('Donations', [don]);
    if (!d.last_donation_date || date >= d.last_donation_date) { d.last_donation_date = date; d.last_donation_amount = String(amount); }
    var moved = null;
    if (POTENTIAL_SEGMENTS.indexOf(d.segment) >= 0) {
      moved = moveSegment_(d, campaignId ? 'D2' : 'D1', 'T3: first donation recorded', user.email);
      insertRows_('SegmentHistory', [moved]);
      saveRows_('DonorMessages', cancelPotentialDonorMessages_(donorId, loadTable_('DonorMessages')));
    }
    d.updated_at = now; saveRows_('Donors', [d]);
    return { donation: cleanDonorRow_(don), segment: d.segment, moved: !!moved };
  });
  runDonorTriggers_(); // outside the lock: creates the thank-you message
  return result;
}

/** Last donation date and amount follow the donations that remain (inside the lock). */
function recomputeLastDonation_(donor) {
  var list = findBy_('Donations', 'donor_id', donor.id).sort(function (a, b) { return String(b.donated_on).localeCompare(String(a.donated_on)) || String(b.recorded_at).localeCompare(String(a.recorded_at)); });
  donor.last_donation_date = list.length ? list[0].donated_on : null;
  donor.last_donation_amount = list.length ? list[0].amount : null;
  donor.updated_at = nowIso_();
}

function updateDonation_(user, id, body) {
  var amount = parseAmount_(body.amount);
  if (!amount) throw new ApiError('Enter the donation amount as a number greater than zero.');
  var date = strOrNull_(body.donated_on) ? parseDateInput_(body.donated_on) : null;
  if (!date) throw new ApiError('The donation date is not valid.');
  return withLock_(function () {
    var don = findOne_('Donations', 'id', id);
    if (!don) throw new ApiError('Donation not found', null, 404);
    var campaignId = strOrNull_(body.campaign_id);
    if (campaignId && !findOne_('DonorCampaigns', 'id', campaignId)) throw new ApiError('Campaign not found', null, 404);
    don.amount = String(amount); don.donated_on = date; don.campaign_id = campaignId; don.note = strOrNull_(body.note);
    saveRows_('Donations', [don]);
    var d = findOne_('Donors', 'id', don.donor_id);
    if (d) { recomputeLastDonation_(d); saveRows_('Donors', [d]); }
    return cleanDonorRow_(don);
  });
}

/** Removes a donation. An unsent thank-you for it is cancelled; one already sent cannot be taken back. The donor's segment is not changed. */
function deleteDonation_(user, id) {
  return withLock_(function () {
    var don = findOne_('Donations', 'id', id);
    if (!don) throw new ApiError('Donation not found', null, 404);
    var msgs = findBy_('DonorMessages', 'donation_id', id), cancelled = 0, alreadySent = false;
    msgs.forEach(function (m) {
      if (DONOR_STATUS_OPEN.indexOf(m.status) >= 0) { m.status = 'cancelled'; m.hold_reason = 'Donation removed'; m.updated_at = nowIso_(); cancelled++; }
      else if (m.wa_sent_at) alreadySent = true;
    });
    saveRows_('DonorMessages', msgs);
    deleteRow_('Donations', don);
    var d = findOne_('Donors', 'id', don.donor_id);
    if (d) { recomputeLastDonation_(d); saveRows_('Donors', [d]); }
    return { deleted: 1, thank_you_cancelled: cancelled, thank_you_already_sent: alreadySent };
  });
}

// ---------- working hours by city ----------
function saveCities_(user, rows) {
  var seen = {}, out = [];
  (rows || []).forEach(function (r, i) {
    var city = strOrNull_(r.city), tz = strOrNull_(r.timezone), start = hhmmOf_(r.start, null), end = hhmmOf_(r.end, null);
    if (!city && !tz && !r.start && !r.end) return; // an empty line
    if (!city) throw new ApiError('Line ' + (i + 1) + ': the city is empty.');
    if (seen[city.toLowerCase()]) throw new ApiError('Line ' + (i + 1) + ': "' + city + '" appears twice.');
    seen[city.toLowerCase()] = true;
    if (!tz) throw new ApiError('Line ' + (i + 1) + ': choose a time zone for ' + city + ' (for example Asia/Kolkata).');
    try { Utilities.formatDate(new Date(), tz, 'HH:mm'); } catch (e) { throw new ApiError('Line ' + (i + 1) + ': "' + tz + '" is not a time zone (use names like Asia/Kolkata or Europe/London).'); }
    if (!start || !end) throw new ApiError('Line ' + (i + 1) + ': give start and end times like 09:00 and 19:00.');
    if (start >= end) throw new ApiError('Line ' + (i + 1) + ': the start time must be before the end time.');
    out.push({ city: city, timezone: tz, start: start, end: end });
  });
  return withLock_(function () { replaceTable_('Cities', out); return { saved: out.length }; });
}

// ---------- donor campaigns ----------
function saveDonorCampaign_(user, id, body) {
  var name = strOrNull_(body.name);
  if (!name) throw new ApiError('Give the campaign a name.');
  var dates = {};
  ['start_date', 'midpoint_date', 'end_date'].forEach(function (k) {
    if (strOrNull_(body[k]) === null) { dates[k] = null; return; }
    var d = parseDateInput_(body[k]);
    if (!d) throw new ApiError(k.replace('_', ' ') + ' is not a valid date.');
    dates[k] = d;
  });
  var status = ['planned', 'running', 'closed', 'results_ready'].indexOf(body.status) >= 0 ? body.status : 'planned';
  return withLock_(function () {
    var c = id ? findOne_('DonorCampaigns', 'id', id) : null;
    if (id && !c) throw new ApiError('Campaign not found', null, 404);
    if (!c) c = { id: newId_(), created_at: nowIso_(), results_ready_at: null };
    c.name = name; c.start_date = dates.start_date; c.midpoint_date = dates.midpoint_date; c.end_date = dates.end_date;
    c.progress_text = strOrNull_(body.progress_text); c.results_text = strOrNull_(body.results_text); c.notes = strOrNull_(body.notes);
    c.status = status === 'results_ready' && !c.results_ready_at ? 'closed' : status; // results_ready is set only by markResultsReady_
    if (id) saveRows_('DonorCampaigns', [c]); else insertRows_('DonorCampaigns', [c]);
    return cleanDonorRow_(c);
  });
}

/** T5: the team says results are ready. The evaluator then drafts the result update for everyone who gave. */
function markResultsReady_(user, id) {
  var out = withLock_(function () {
    var c = findOne_('DonorCampaigns', 'id', id);
    if (!c) throw new ApiError('Campaign not found', null, 404);
    if (!strOrNull_(c.results_text)) throw new ApiError('Add the results text first. It is what donors will be told.');
    c.status = 'results_ready'; c.results_ready_at = nowIso_();
    saveRows_('DonorCampaigns', [c]);
    return cleanDonorRow_(c);
  });
  runDonorTriggers_();
  return out;
}

function listDonorCampaigns_() {
  var donations = loadTable_('Donations'), total = {}, donors = {};
  donations.forEach(function (x) {
    if (!x.campaign_id) return;
    total[x.campaign_id] = (total[x.campaign_id] || 0) + (Number(x.amount) || 0);
    (donors[x.campaign_id] = donors[x.campaign_id] || {})[x.donor_id] = true;
  });
  return loadTable_('DonorCampaigns').sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); }).map(function (c) {
    var o = cleanDonorRow_(c); o.donor_count = Object.keys(donors[c.id] || {}).length; o.total_raised = total[c.id] || 0; return o;
  });
}

// ---------- donor templates (reuse the Templates sheet with division = donor) ----------
function validateDonorTemplateMeta_(b) {
  var errors = [];
  if (!MESSAGE_TYPES[b.message_type]) errors.push('Choose a message type.');
  if (b.source_code && b.source_code !== 'ALL' && ['P1', 'P2', 'P3'].indexOf(b.source_code) < 0) errors.push('Source must be P1, P2, P3 or empty.');
  return errors;
}

function listDonorTemplates_() {
  return loadTable_('DonorTemplates')
    .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); }).map(publicTemplate_);
}

function createDonorTemplate_(user, body) {
  var name = String(body.name || '').trim();
  var errors = validateName_(name, body.language || 'en').concat(validateContent_(body)).concat(validateDonorTemplateMeta_(body));
  if (!/^donor_/.test(name)) errors.unshift('Donor template names must start with donor_ (this keeps them apart from parent templates at WhatsApp).');
  if (errors.length) throw new ApiError(errors[0], errors);
  var id = withLock_(function () {
    if (nameTaken_(name, body.language || 'en', 'DonorTemplates')) throw new ApiError("A template named '" + name + "' already exists for this language.");
    var tid = insertTemplate_(user, { name: name, language: body.language || 'en', category: body.category, body: body.body,
      variable_names: body.variable_names, sample_values: body.sample_values, has_confirm_buttons: false }, 'DonorTemplates');
    var t = findOne_('DonorTemplates', 'id', tid);
    t.division = 'donor'; t.message_type = body.message_type; t.source_code = strOrNull_(body.source_code);
    saveRows_('DonorTemplates', [t]);
    return tid;
  });
  return submitToMeta_(id, 'DonorTemplates');
}

/** Local labels and type only (nothing is sent to Twilio), so approved and imported templates can be tagged. */
function updateDonorTemplate_(user, id, body) {
  var errors = validateDonorTemplateMeta_(body);
  if (errors.length) throw new ApiError(errors[0], errors);
  return withLock_(function () {
    var t = findOne_('DonorTemplates', 'id', id);
    if (!t) throw new ApiError('Template not found', null, 404);
    var n = placeholderNumbers_(t.body).length, names = (body.variable_names || []).map(function (x) { return String(x || '').trim(); });
    if (names.length !== n || names.some(function (x) { return !x; })) throw new ApiError('Give a label for each of the ' + n + ' placeholders.');
    t.message_type = body.message_type; t.source_code = strOrNull_(body.source_code); t.variable_names = names; t.updated_at = nowIso_();
    saveRows_('DonorTemplates', [t]);
    return publicTemplate_(t);
  });
}

function importDonorTemplates_(user) {
  var r = importTwilioTemplates_(user, { table: 'DonorTemplates' });
  return r;
}

// ---------- broadcasts (T8 quarterly, T11 special, T12 festive, T4/T5 campaign updates) ----------
var BROADCAST_KINDS = { general_update: 'T8', special_update: 'T11', festive_greeting: 'T12', campaign_update: 'T4' };

function cleanBroadcast_(b) {
  if (!BROADCAST_KINDS[b.kind]) throw new ApiError('Choose what kind of message this is.');
  var name = strOrNull_(b.name); if (!name) throw new ApiError('Give it a name.');
  var segs = (b.segments || []).filter(function (s) { return SEGMENT_CODES.indexOf(s) >= 0; });
  var sendOn = strOrNull_(b.send_on) ? parseDateInput_(b.send_on) : null;
  if (strOrNull_(b.send_on) && !sendOn) throw new ApiError('The send date is not valid.');
  var eventDate = strOrNull_(b.event_date) ? parseDateInput_(b.event_date) : null;
  if (strOrNull_(b.event_date) && !eventDate) throw new ApiError('The festival date is not valid.');
  var values = {}; Object.keys(b.values || {}).forEach(function (k) { var v = String(b.values[k] || '').trim(); if (v) values[labelKey_(k)] = v; });
  return { name: name, kind: b.kind, template_id: strOrNull_(b.template_id), campaign_id: strOrNull_(b.campaign_id), segments: segs,
    include_ids: b.include_ids || [], exclude_ids: b.exclude_ids || [], values: values, send_on: sendOn, event_date: eventDate };
}

function saveBroadcast_(user, id, body) {
  var c = cleanBroadcast_(body);
  return withLock_(function () {
    var b = id ? findOne_('DonorBroadcasts', 'id', id) : null;
    if (id && !b) throw new ApiError('Not found', null, 404);
    if (b && b.status !== 'draft') throw new ApiError('Only drafts can be edited.');
    // A field the caller did not send keeps its value (system drafts arrive with a date and campaign already set).
    if (b) ['send_on', 'event_date', 'campaign_id'].forEach(function (k) { if (body[k] === undefined) c[k] = b[k]; });
    if (!b) b = { id: newId_(), trigger: BROADCAST_KINDS[c.kind], status: 'draft',
      dedupe_key: null, created_by: user.email, approved_by: null, approved_at: null, message_count: 0, created_at: nowIso_() };
    Object.keys(c).forEach(function (k) { b[k] = c[k]; });
    if (id) saveRows_('DonorBroadcasts', [b]); else insertRows_('DonorBroadcasts', [b]);
    return cleanDonorRow_(b);
  });
}

function listBroadcasts_() {
  var tpls = {}; loadTable_('DonorTemplates').forEach(function (t) { tpls[t.id] = t; });
  var camps = {}; loadTable_('DonorCampaigns').forEach(function (c) { camps[c.id] = c; });
  var counts = {};
  loadTable_('DonorMessages').forEach(function (m) {
    if (!m.broadcast_id) return;
    var c = counts[m.broadcast_id] || (counts[m.broadcast_id] = { total: 0, sent: 0, waiting: 0, failed: 0 });
    c.total++;
    if (['sent', 'delivered', 'read'].indexOf(m.status) >= 0) c.sent++; else if (m.status === 'failed') c.failed++; else if (DONOR_STATUS_OPEN.indexOf(m.status) >= 0) c.waiting++;
  });
  return loadTable_('DonorBroadcasts').sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); }).map(function (b) {
    var o = cleanDonorRow_(b);
    o.template_name = b.template_id && tpls[b.template_id] ? tpls[b.template_id].name : null;
    o.campaign_name = b.campaign_id && camps[b.campaign_id] ? camps[b.campaign_id].name : null;
    o.counts = counts[b.id] || { total: 0, sent: 0, waiting: 0, failed: 0 };
    return o;
  });
}

/** Everyone a broadcast would go to: segments + chosen donors + (for campaign updates) campaign donors, minus exclusions and opt-outs. */
function broadcastAudience_(b, donors, donations) {
  var ex = {}; (b.exclude_ids || []).forEach(function (x) { ex[x] = true; });
  var ids = {};
  (b.segments || []).forEach(function (s) { donors.forEach(function (d) { if (d.segment === s) ids[d.id] = true; }); });
  (b.include_ids || []).forEach(function (x) { ids[x] = true; });
  if (b.campaign_id) donations.forEach(function (x) { if (x.campaign_id === b.campaign_id) ids[x.donor_id] = true; });
  var out = [];
  donors.forEach(function (d) { if (ids[d.id] && !ex[d.id] && !d.opted_out) out.push(d); });
  return out;
}

function broadcastContext_() {
  var ctx = { donations: loadTable_('Donations'), campaignsById: {}, donationsById: {} };
  loadTable_('DonorCampaigns').forEach(function (c) { ctx.campaignsById[c.id] = c; });
  ctx.donations.forEach(function (x) { ctx.donationsById[x.id] = x; });
  return ctx;
}

/** What the team must check before approving: audience size, sample text, and anything that cannot be filled. */
function previewBroadcast_(user, id) {
  var b = findOne_('DonorBroadcasts', 'id', id);
  if (!b) throw new ApiError('Not found', null, 404);
  var ctx = broadcastContext_(), donors = loadTable_('Donors');
  var aud = broadcastAudience_(b, donors, ctx.donations);
  var tpl = b.template_id ? findOne_('DonorTemplates', 'id', b.template_id) : null;
  var out = { count: aud.length, template: tpl ? { name: tpl.name, status: tpl.status, message_type: tpl.message_type } : null,
    no_optin: aud.filter(function (d) { return !d.whatsapp_opt_in; }).length, sample: null, missing: [],
    recipients: aud.slice(0, 40).map(function (d) { return { id: d.id, name: d.name, segment: d.segment, opt_in: !!d.whatsapp_opt_in }; }) };
  if (tpl && aud.length) {
    var msg = { variables: b.values, campaign_id: b.campaign_id };
    var missing = {};
    aud.forEach(function (d) { resolveVars_(tpl, d, msg, ctx).missing.forEach(function (m) { missing[m] = (missing[m] || 0) + 1; }); });
    out.missing = Object.keys(missing).map(function (k) { return k + ' is empty for ' + missing[k] + ' donor(s)'; });
    var r = resolveVars_(tpl, aud[0], msg, ctx);
    out.sample = { donor: aud[0].name, text: renderBody_(tpl, r.vars) };
  }
  return out;
}

function approveBroadcast_(user, id) {
  var result = withLock_(function () {
    var b = findOne_('DonorBroadcasts', 'id', id);
    if (!b) throw new ApiError('Not found', null, 404);
    if (b.status !== 'draft') throw new ApiError('This was already approved or cancelled.');
    var tpl = b.template_id ? findOne_('DonorTemplates', 'id', b.template_id) : null;
    if (!tpl) throw new ApiError('Choose a template first.');
    if (tpl.status !== 'approved') throw new ApiError('That template is not approved by WhatsApp yet.');
    if (tpl.message_type !== b.kind) throw new ApiError('That template is a "' + (MESSAGE_TYPES[tpl.message_type] || 'untyped') + '" template, not a "' + MESSAGE_TYPES[b.kind] + '".');
    var ctx = broadcastContext_(), donors = loadTable_('Donors'), aud = broadcastAudience_(b, donors, ctx.donations);
    if (!aud.length) throw new ApiError('Nobody is in the audience.');
    var now = new Date(), notBefore = b.send_on && b.send_on > todayStr_(now) ? startOfDayLocal_(b.send_on).toISOString() : null;
    var expires = b.kind === 'festive_greeting' && (b.event_date || b.send_on) ? startOfDayLocal_(addDaysStr_(b.event_date || b.send_on, 2)).toISOString() : null;
    var existing = {}; loadTable_('DonorMessages').forEach(function (m) { if (m.dedupe_key) existing[m.dedupe_key] = true; });
    var rows = [];
    aud.forEach(function (d) {
      var key = 'B:' + b.id + ':' + d.id;
      if (existing[key]) return;
      rows.push(newDonorMessage_({ donor_id: d.id, template_id: tpl.id, message_type: b.kind, trigger: b.trigger, broadcast_id: b.id, campaign_id: b.campaign_id,
        variables: b.values, dedupe_key: key, not_before: notBefore, expires_at: expires || undefined }));
    });
    insertRows_('DonorMessages', rows);
    b.status = 'approved'; b.approved_by = user.email; b.approved_at = nowIso_(); b.message_count = rows.length;
    saveRows_('DonorBroadcasts', [b]);
    return { queued: rows.length };
  });
  return result;
}

function cancelBroadcast_(user, id) {
  return withLock_(function () {
    var b = findOne_('DonorBroadcasts', 'id', id);
    if (!b) throw new ApiError('Not found', null, 404);
    if (b.status === 'cancelled') return { cancelled: 0 };
    b.status = 'cancelled'; saveRows_('DonorBroadcasts', [b]);
    var open = loadTable_('DonorMessages').filter(function (m) { return m.broadcast_id === id && DONOR_STATUS_OPEN.indexOf(m.status) >= 0; });
    open.forEach(function (m) { m.status = 'cancelled'; m.hold_reason = 'Broadcast cancelled'; m.updated_at = nowIso_(); });
    saveRows_('DonorMessages', open);
    return { cancelled: open.length };
  });
}

function deleteDraftBroadcast_(user, id) {
  return withLock_(function () {
    var b = findOne_('DonorBroadcasts', 'id', id);
    if (!b) throw new ApiError('Not found', null, 404);
    if (b.status !== 'draft') throw new ApiError('Only drafts can be deleted. Cancel an approved one instead.');
    deleteRow_('DonorBroadcasts', b);
    return { deleted: 1 };
  });
}

// ---------- the message queue ----------
function listDonorMessages_(user, f) {
  f = f || {};
  var donors = {}; loadTable_('Donors').forEach(function (d) { donors[d.id] = d; });
  var tpls = {}; loadTable_('DonorTemplates').forEach(function (t) { tpls[t.id] = t; });
  var rows = loadTable_('DonorMessages').filter(function (m) { return !f.status || m.status === f.status; })
    .sort(function (a, b) { return String(b.updated_at).localeCompare(String(a.updated_at)); }).slice(0, 300);
  return rows.map(function (m) {
    var o = cleanDonorRow_(m), d = donors[m.donor_id] || {};
    o.donor_name = d.name || '(deleted)'; o.donor_segment = d.segment || ''; o.template_name = m.template_id && tpls[m.template_id] ? tpls[m.template_id].name : null;
    return o;
  });
}

function cancelDonorMessage_(user, id) {
  return withLock_(function () {
    var m = findOne_('DonorMessages', 'id', id);
    if (!m) throw new ApiError('Not found', null, 404);
    if (DONOR_STATUS_OPEN.indexOf(m.status) < 0) throw new ApiError('Only waiting messages can be cancelled.');
    m.status = 'cancelled'; m.hold_reason = 'Cancelled by ' + user.email; m.updated_at = nowIso_();
    saveRows_('DonorMessages', [m]);
    return { ok: true };
  });
}

function retryDonorMessage_(user, id) {
  return withLock_(function () {
    var m = findOne_('DonorMessages', 'id', id);
    if (!m || m.status !== 'failed') throw new ApiError('Only failed messages can be retried.');
    m.status = 'queued'; m.wa_error = null; m.wa_sid = null; m.send_claimed_at = null; m.hold_reason = null; m.updated_at = nowIso_();
    saveRows_('DonorMessages', [m]);
    return { ok: true };
  });
}

// ===== DonorEngine.gs =====
var BUILD_DonorEngine = '20261107-1230'; // build stamp (see Build.gs)
/**
 * Donor Communication engine.
 *   runDonorTriggers_()      reads the donor records and creates the messages the rules call for (T1 to T10).
 *                            It is safe to run any number of times: every message has a dedupe key.
 *   dispatchDonorBatch_()    decides what may be sent right now (opt-in, 7-day cap, working hours) and sends it.
 * Both run from the 10-minute cron tick; the donor screens also call them right after an approval or a donation.
 */
var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var QUARTER_MONTHS = [1, 4, 7, 10];

function newDonorMessage_(f) {
  var type = f.message_type, now = nowIso_();
  var m = { id: 'd-' + newId_(), donor_id: null, channel: 'whatsapp', to_email: null, template_id: null, message_type: type, trigger: null,
    broadcast_id: null, campaign_id: null, donation_id: null, ref: null, variables: null, priority: PRIORITY[type] || 50, dedupe_key: null,
    status: 'queued', hold_reason: null, not_before: null,
    expires_at: new Date(Date.now() + (type === 'thank_you' ? THANKS_HOLD_DAYS : HOLD_DAYS) * 86400000).toISOString(),
    send_claimed_at: null, wa_sid: null, wa_sent_at: null, wa_error: null, reply_text: null, replied_at: null, created_at: now, updated_at: now };
  Object.keys(f).forEach(function (k) { if (f[k] !== undefined) m[k] = f[k]; });
  return m;
}

function byId_(rows) { var o = {}; rows.forEach(function (r) { o[r.id] = r; }); return o; }
function values_(o) { return Object.keys(o).map(function (k) { return o[k]; }); }

// ---------------------------------------------------------------- triggers
function loadEngineCtx_() {
  var ctx = { today: todayStr_(), nowMs: Date.now(), donors: loadTable_('Donors'), donations: loadTable_('Donations'),
    campaigns: loadTable_('DonorCampaigns'), broadcasts: loadTable_('DonorBroadcasts'), msgs: loadTable_('DonorMessages'),
    keys: {}, newMsgs: [], newBroadcasts: [], newHistory: [], dirtyDonors: {}, dirtyMsgs: {}, stats: {} };
  ctx.donorsById = byId_(ctx.donors); ctx.campaignsById = byId_(ctx.campaigns);
  ctx.msgs.forEach(function (m) { if (m.dedupe_key) ctx.keys[m.dedupe_key] = true; });
  ctx.broadcasts.forEach(function (b) { if (b.dedupe_key) ctx.keys[b.dedupe_key] = true; });
  return ctx;
}

function addMsg_(ctx, f) {
  if (f.dedupe_key && ctx.keys[f.dedupe_key]) return null;
  var m = newDonorMessage_(f);
  if (m.dedupe_key) ctx.keys[m.dedupe_key] = true;
  ctx.newMsgs.push(m); ctx.msgs.push(m);
  return m;
}

function addBroadcastDraft_(ctx, f) {
  if (ctx.keys[f.dedupe_key]) return null;
  var b = Object.assign({ id: newId_(), template_id: null, campaign_id: null, segments: [], include_ids: [], exclude_ids: [], values: {}, event_date: null,
    status: 'draft', created_by: 'system', approved_by: null, approved_at: null, message_count: 0, created_at: nowIso_() }, f);
  ctx.keys[b.dedupe_key] = true; ctx.newBroadcasts.push(b); ctx.broadcasts.push(b);
  return b;
}

function count_(ctx, k) { ctx.stats[k] = (ctx.stats[k] || 0) + 1; }

/** T1: a new potential donor from a trustee, the website or a referral gets a welcome (P1 waits for the trustee to confirm). */
function triggerT1_(ctx) {
  ctx.donors.forEach(function (d) {
    if (['P1', 'P2', 'P3'].indexOf(d.segment) < 0 || d.opted_out) return;
    var wait = d.segment === 'P1' && !d.trustee_confirmed;
    if (addMsg_(ctx, { donor_id: d.id, message_type: 'welcome', trigger: 'T1', dedupe_key: 'T1:' + d.id,
      status: wait ? 'awaiting_confirmation' : 'queued', hold_reason: wait ? 'Waiting for the trustee to confirm' : null })) count_(ctx, 'T1');
  });
  ctx.msgs.forEach(function (m) {
    if (m.status !== 'awaiting_confirmation') return;
    var d = ctx.donorsById[m.donor_id];
    if (d && d.trustee_confirmed) { m.status = 'queued'; m.hold_reason = null; m.updated_at = nowIso_(); if (m._row) ctx.dirtyMsgs[m.id] = m; }
  });
}

/** T2: every recorded donation gets a thank-you (sent even if another message went recently). */
function triggerT2_(ctx) {
  ctx.donations.forEach(function (x) {
    if (!ctx.donorsById[x.donor_id]) return;
    if (addMsg_(ctx, { donor_id: x.donor_id, message_type: 'thank_you', trigger: 'T2', donation_id: x.id, campaign_id: x.campaign_id, dedupe_key: 'T2:' + x.id })) count_(ctx, 'T2');
  });
}

/** T4 / T5: a campaign update is drafted for the team to approve. T4 at the midpoint date, T5 once results are marked ready. */
function triggerT4T5_(ctx) {
  ctx.campaigns.forEach(function (c) {
    if (['planned', 'running'].indexOf(c.status) >= 0 && c.midpoint_date && ctx.today >= c.midpoint_date) {
      if (addBroadcastDraft_(ctx, { trigger: 'T4', kind: 'campaign_update', name: 'Midpoint update: ' + c.name, campaign_id: c.id, send_on: c.midpoint_date, dedupe_key: 'T4:' + c.id })) count_(ctx, 'T4');
    }
    if (c.results_ready_at) {
      if (addBroadcastDraft_(ctx, { trigger: 'T5', kind: 'campaign_update', name: 'Results update: ' + c.name, campaign_id: c.id, send_on: todayStr_(), dedupe_key: 'T5:' + c.id })) count_(ctx, 'T5');
    }
  });
}

/** T6: after the campaign result update, campaign donors who have not given again move to P5 (quarterly updates). */
function triggerT6_(ctx) {
  ctx.campaigns.forEach(function (c) {
    if (!c.results_ready_at) return;
    var bc = ctx.broadcasts.filter(function (b) { return b.dedupe_key === 'T5:' + c.id; })[0];
    if (!bc) return;
    var ready = Date.parse(c.results_ready_at);
    ctx.msgs.forEach(function (m) {
      if (m.broadcast_id !== bc.id) return;
      var d = ctx.donorsById[m.donor_id];
      if (!d || d.segment !== 'D2') return;
      var ref;
      if (m.wa_sent_at) ref = Date.parse(m.wa_sent_at);
      else if (['skipped', 'cancelled', 'failed'].indexOf(m.status) >= 0) ref = ready;
      else return; // the result update has not gone out yet
      if (ctx.nowMs < ref + P5_MOVE_DELAY_DAYS * 86400000) return;
      var gaveAgain = ctx.donations.some(function (x) { return x.donor_id === d.id && Date.parse(x.recorded_at) > ready; });
      if (gaveAgain) return;
      var h = moveSegment_(d, 'P5', 'T6: no further donation after "' + c.name + '" results', 'system');
      if (h) { ctx.newHistory.push(h); ctx.dirtyDonors[d.id] = d; count_(ctx, 'T6'); }
    });
  });
}

/** T7: 11 months after the last donation, last year's donors (P4) get an "a year ago you helped" update unless they gave again. */
function triggerT7_(ctx) {
  ctx.donors.forEach(function (d) {
    if (d.segment !== 'P4' || d.opted_out || !d.last_donation_date) return;
    if (ctx.today < addMonthsStr_(d.last_donation_date, 11)) return;
    if (ctx.donations.some(function (x) { return x.donor_id === d.id && x.donated_on > d.last_donation_date; })) return;
    if (addMsg_(ctx, { donor_id: d.id, message_type: 'year_ago_update', trigger: 'T7', dedupe_key: 'T7:' + d.id + ':' + d.last_donation_date })) count_(ctx, 'T7');
  });
}

/** T8: a quarterly general update is drafted three weeks before the first week of Jan / Apr / Jul / Oct. The team approves it. */
function triggerT8_(ctx) {
  var y = Number(ctx.today.slice(0, 4));
  [y, y + 1].forEach(function (yr) {
    QUARTER_MONTHS.forEach(function (mo) {
      var start = yr + '-' + ('0' + mo).slice(-2) + '-01';
      if (ctx.today < addDaysStr_(start, -21) || ctx.today > addDaysStr_(start, 30)) return;
      if (addBroadcastDraft_(ctx, { trigger: 'T8', kind: 'general_update', name: 'General update: ' + MONTH_NAMES[mo - 1] + ' ' + yr,
        segments: ['P1', 'P2', 'P3', 'P4', 'P5', 'D1'], send_on: start, dedupe_key: 'T8:' + start.slice(0, 7) })) count_(ctx, 'T8');
    });
  });
}

/** T9: 7 days before a programme report is due, remind the Ek Tara contact owner (an email, never the donor). */
function triggerT9_(ctx) {
  ctx.donors.forEach(function (d) {
    if (d.segment !== 'D1' || !d.next_report_due || !d.owner_email) return;
    if (ctx.today < addDaysStr_(d.next_report_due, -7) || ctx.today > d.next_report_due) return;
    if (addMsg_(ctx, { donor_id: d.id, channel: 'email', to_email: d.owner_email, message_type: 'report_reminder', trigger: 'T9', ref: d.next_report_due,
      dedupe_key: 'T9:' + d.id + ':' + d.next_report_due })) count_(ctx, 'T9');
  });
}

/** T10: on the due date the programme report goes to the programme donor (D1). The next due date is set after it is sent. */
function triggerT10_(ctx) {
  ctx.donors.forEach(function (d) {
    if (d.segment !== 'D1' || !d.next_report_due || d.opted_out || ctx.today < d.next_report_due) return;
    if (addMsg_(ctx, { donor_id: d.id, message_type: 'programme_report', trigger: 'T10', ref: d.next_report_due,
      dedupe_key: 'T10:' + d.id + ':' + d.next_report_due })) count_(ctx, 'T10');
  });
}

function runDonorTriggers_() {
  if (!donorReady_()) return { skipped: 'donor sheets not set up' };
  return withLock_(function () {
    var ctx = loadEngineCtx_();
    triggerT1_(ctx); triggerT2_(ctx); triggerT4T5_(ctx); triggerT6_(ctx); triggerT7_(ctx); triggerT8_(ctx); triggerT9_(ctx); triggerT10_(ctx);
    saveRows_('Donors', values_(ctx.dirtyDonors));
    saveRows_('DonorMessages', values_(ctx.dirtyMsgs));
    insertRows_('DonorMessages', ctx.newMsgs);
    insertRows_('DonorBroadcasts', ctx.newBroadcasts);
    insertRows_('SegmentHistory', ctx.newHistory);
    return ctx.stats;
  }, 25000);
}

// ---------------------------------------------------------------- dispatch
function nextReportDue_(due, freq, today) {
  var n = FREQ_MONTHS[String(freq || '').trim().toLowerCase()];
  if (!n) return null;
  var next = due;
  for (var k = 1; k <= 120 && next <= today; k++) next = addMonthsStr_(due, n * k); // from the original date, so 31 Jan does not drift
  return next;
}

/** Under the lock: decide what may go out now. Applies opt-in, template, values, working hours, then the 7-day cap and priority. */
function claimDonorBatch_(max) {
  return withLock_(function () {
    var now = new Date(), nowMs = now.getTime();
    var donors = byId_(loadTable_('Donors')), tpls = byId_(loadTable_('DonorTemplates')), cities = citiesMap_();
    var ctx = { campaignsById: byId_(loadTable_('DonorCampaigns')), donationsById: byId_(loadTable_('Donations')) };
    var dirty = {}, elig = [];
    function touch(m) { dirty[m.id] = m; }
    function hold(m, reason, notBefore) {
      var changed = m.status !== 'held' || m.hold_reason !== reason || (notBefore !== undefined && m.not_before !== notBefore);
      m.status = 'held'; m.hold_reason = reason; if (notBefore !== undefined) m.not_before = notBefore;
      if (changed) { m.updated_at = nowIso_(); touch(m); }
    }
    function end(m, status, reason) { m.status = status; m.hold_reason = reason; m.updated_at = nowIso_(); touch(m); }

    loadTable_('DonorMessages').forEach(function (m) {
      if (m.status !== 'queued' && m.status !== 'held') return;
      var claimed = m.send_claimed_at ? Date.parse(m.send_claimed_at) : 0;
      if (claimed && nowMs - claimed < DONOR_CLAIM_MS) return;
      if (m.not_before && Date.parse(m.not_before) > nowMs) return;
      if (m.expires_at && Date.parse(m.expires_at) < nowMs) { end(m, 'skipped', 'Expired before it could be sent' + (m.hold_reason ? ' (' + m.hold_reason + ')' : '')); return; }
      var d = donors[m.donor_id];
      if (!d) { end(m, 'cancelled', 'Donor deleted'); return; }
      if (m.channel === 'email') {
        if (!m.to_email) end(m, 'failed', 'No contact-owner email on the donor record'); else elig.push({ m: m, d: d, email: true, go: true });
        return;
      }
      if (d.opted_out) { end(m, 'cancelled', 'Donor opted out'); return; }                       // rule 1
      if (!d.whatsapp_opt_in) { hold(m, 'No WhatsApp opt-in recorded'); return; }                // rule 1
      var tpl = pickTemplate_(m, d, tpls);
      if (!tpl) { hold(m, 'No approved ' + (MESSAGE_TYPES[m.message_type] || m.message_type) + ' template'); return; }
      var r = resolveVars_(tpl, d, m, ctx);
      if (r.missing.length) { hold(m, 'Missing ' + r.missing.join(', ')); return; }
      var win = windowFor_(d, cities);                                                            // rule 3
      if (!inWindow_(win, now)) { hold(m, 'Outside sending hours', nextWindowStart_(win, now).toISOString()); return; }
      elig.push({ m: m, d: d, tpl: tpl, vars: r.vars });
    });

    // rule 2: one update per donor per UPDATE_CAP_DAYS; exempt types always go; on a clash the higher priority wins
    var perDonor = {};
    elig.forEach(function (e) {
      if (e.go) return;
      if (EXEMPT_TYPES.indexOf(e.m.message_type) >= 0) { e.go = true; return; }
      (perDonor[e.d.id] = perDonor[e.d.id] || []).push(e);
    });
    Object.keys(perDonor).forEach(function (id) {
      var list = perDonor[id].sort(function (a, b) { return (b.m.priority || 0) - (a.m.priority || 0) || String(a.m.created_at).localeCompare(String(b.m.created_at)); });
      var last = list[0].d.last_update_at ? Date.parse(list[0].d.last_update_at) : 0;
      var capped = last && nowMs - last < UPDATE_CAP_DAYS * 86400000;
      list.forEach(function (e, i) {
        if (capped) hold(e.m, 'Frequency cap: one update per ' + UPDATE_CAP_DAYS + ' days (next allowed ' + new Date(last + UPDATE_CAP_DAYS * 86400000).toISOString().slice(0, 10) + ')');
        else if (i > 0) hold(e.m, 'Held: a more important message goes to this donor first');
        else e.go = true;
      });
    });

    var go = elig.filter(function (e) { return e.go; }), take = go.slice(0, max), items = [];
    take.forEach(function (e) {
      e.m.send_claimed_at = nowIso_(); touch(e.m);
      items.push({ id: e.m.id, donor_id: e.d.id, email: !!e.email, to_email: e.m.to_email, type: e.m.message_type, trigger: e.m.trigger, ref: e.m.ref,
        donor_name: e.d.name, report_link: e.d.report_link, phone: e.d.phone_e164, contentSid: e.tpl && e.tpl.twilio_content_sid, vars: e.vars, owner_name: e.d.owner_name });
    });
    saveRows_('DonorMessages', values_(dirty));
    return { items: items, remaining: go.length - take.length };
  });
}

function sendDonorItems_(items) {
  var c = cfg_(), results = {}, wa = items.filter(function (i) { return !i.email; });
  for (var i = 0; i < wa.length; i += c.SEND_CONCURRENCY) {
    var chunk = wa.slice(i, i + c.SEND_CONCURRENCY), out;
    try {
      out = sendWhatsappMany_(chunk.map(function (it) { return { phone: it.phone, contentSid: it.contentSid, variables: it.vars, messageId: it.id }; }));
    } catch (e) { out = chunk.map(function () { return { error: 'Unexpected error while sending: ' + e.message }; }); }
    chunk.forEach(function (it, j) { results[it.id] = out[j]; });
  }
  items.filter(function (i) { return i.email; }).forEach(function (it) {
    try {
      MailApp.sendEmail(it.to_email, 'Programme report due ' + it.ref + ': ' + it.donor_name,
        'Hello' + (it.owner_name ? ' ' + it.owner_name : '') + ',\n\nThe programme report for ' + it.donor_name + ' is due on ' + it.ref + ' (in about 7 days).\n' +
        (it.report_link ? 'Report link on file: ' + it.report_link + '\n' : 'No report link is on the donor record yet. Please add it so the WhatsApp message can go out on the due date.\n') +
        '\nThis is an automatic reminder from the Ek Tara communications app.');
      results[it.id] = { sid: 'email' };
    } catch (e) { results[it.id] = { error: 'Email failed: ' + e.message }; }
  });
  return results;
}

function saveDonorResults_(items, results) {
  withLock_(function () {
    var msgs = byId_(loadTable_('DonorMessages')), donors = byId_(loadTable_('Donors')), dm = {}, dd = {}, now = nowIso_(), today = todayStr_();
    items.forEach(function (it) {
      var m = msgs[it.id], res = results[it.id];
      if (!m || !res) return;
      m.send_claimed_at = null; m.updated_at = now; dm[m.id] = m;
      if (!res.sid) { m.status = 'failed'; m.wa_error = res.error; return; }
      m.hold_reason = null; m.wa_error = null;
      if (it.email) { m.status = 'sent'; m.wa_sent_at = now; return; }
      m.wa_sid = res.sid; m.wa_sent_at = now;
      if (['queued', 'held'].indexOf(m.status) >= 0) m.status = 'sent'; // a callback may already have moved it on
      var d = donors[m.donor_id]; if (!d) return;
      d.last_message_at = now; d.last_message_type = m.message_type; d.last_message_trigger = m.trigger; d.updated_at = now;   // rule 4
      if (EXEMPT_TYPES.indexOf(m.message_type) < 0) d.last_update_at = now;
      if (m.message_type === 'programme_report' && m.ref) {
        d.next_report_due = nextReportDue_(m.ref, d.reporting_frequency, today) || d.next_report_due; // T10: set the next due date
        d.report_link = null;
      }
      dd[d.id] = d;
    });
    saveRows_('DonorMessages', values_(dm)); saveRows_('Donors', values_(dd));
  });
}

/** Send for up to budgetMs. Returns {sent, remaining}. Safe to call repeatedly. */
function dispatchDonorBatch_(budgetMs) {
  if (!donorReady_()) return { sent: 0, remaining: 0, skipped: 'donor sheets not set up' };
  var started = Date.now(), sent = 0, remaining = 0;
  while (true) {
    var claim = claimDonorBatch_(DONOR_BATCH);
    remaining = claim.remaining;
    if (!claim.items.length) break;
    if (claim.items.some(function (i) { return !i.email; })) requireConfig_(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']);
    saveDonorResults_(claim.items, sendDonorItems_(claim.items));
    sent += claim.items.length;
    if (Date.now() - started > budgetMs) break;
  }
  return { sent: sent, remaining: remaining };
}

// ---------------------------------------------------------------- status callbacks and replies
var DONOR_STATUS_ALLOWED = { sent: ['queued', 'held'], delivered: ['queued', 'held', 'sent'], read: ['queued', 'held', 'sent', 'delivered'], failed: ['queued', 'held', 'sent', 'delivered'] };

function applyDonorStatus_(messageId, ns, extra) {
  var m = findOne_('DonorMessages', 'id', messageId);
  if (!m || (DONOR_STATUS_ALLOWED[ns] || []).indexOf(m.status) < 0) return false;
  Object.keys(extra || {}).forEach(function (k) { m[k] = extra[k]; });
  m.status = ns; m.updated_at = nowIso_();
  saveRows_('DonorMessages', [m]);
  return true;
}

/** STOP / START from a donor. Returns true if the number belongs to a donor. */
function donorOptOutChoice_(params, optOut) {
  var donors = findBy_('Donors', 'phone_e164', phoneOf_(params));
  donors.forEach(function (d) {
    d.opted_out = optOut; d.updated_at = nowIso_();
    if (!optOut) { d.whatsapp_opt_in = true; d.opt_in_at = nowIso_(); d.opt_in_source = 'WhatsApp START reply'; }
    saveRows_('Donors', [d]);
    if (optOut) {
      var open = findBy_('DonorMessages', 'donor_id', d.id).filter(function (m) { return DONOR_STATUS_OPEN.indexOf(m.status) >= 0 && m.channel === 'whatsapp'; });
      open.forEach(function (m) { m.status = 'cancelled'; m.hold_reason = 'Donor replied STOP'; m.updated_at = nowIso_(); });
      saveRows_('DonorMessages', open);
    }
  });
  return donors.length > 0;
}

/** A free-text reply from a donor: attach it to the message it answers. Returns true if handled. */
function handleDonorReply_(params, eventId) {
  var m = null;
  if (params.OriginalRepliedMessageSid) m = findOne_('DonorMessages', 'wa_sid', params.OriginalRepliedMessageSid);
  if (!m) {
    var donor = findOne_('Donors', 'phone_e164', phoneOf_(params));
    if (!donor) return false;
    var since = Date.now() - REPLY_WINDOW_MS;
    var open = findBy_('DonorMessages', 'donor_id', donor.id).filter(function (x) { return x.wa_sent_at && Date.parse(x.wa_sent_at) >= since && x.channel === 'whatsapp'; })
      .sort(function (a, b) { return String(b.wa_sent_at).localeCompare(String(a.wa_sent_at)); });
    m = open[0] || null;
  }
  if (!m) return !!findOne_('Donors', 'phone_e164', phoneOf_(params));
  if (eventId) setEventMessageId_(eventId, m.id);
  var text = String(params.Body || '').trim();
  if (text) { m.reply_text = text.slice(0, MAX_REPLY_LENGTH); m.replied_at = nowIso_(); m.updated_at = nowIso_(); saveRows_('DonorMessages', [m]); }
  return true;
}

// ===== DonorRules.gs =====
var BUILD_DonorRules = '20261107-1230'; // build stamp (see Build.gs)
/**
 * Donor Communication: constants, date helpers, sending hours and variable filling.
 * All "dates" are plain 'yyyy-MM-dd' strings in APP_TIMEZONE; timestamps are ISO strings.
 * Rules come from the "Ek Tara Donor Communications Metadata" sheet (sections 4 to 7).
 */
var SEGMENTS = { P1: 'Trustee / employee lead', P2: 'Website lead', P3: 'Donor / partner referral lead', P4: "Last year's donor",
  P5: 'Past campaign donor', D1: 'Programme donor', D2: 'Campaign donor' };
var POTENTIAL_SEGMENTS = ['P1', 'P2', 'P3', 'P4', 'P5'];
var SEGMENT_CODES = Object.keys(SEGMENTS);

/** The six message types from the metadata sheet, plus two that triggers need (T7 and T10). */
var MESSAGE_TYPES = { welcome: 'Welcome', general_update: 'General update', special_update: 'Special update',
  campaign_update: 'Campaign update', thank_you: 'Thank-you', festive_greeting: 'Festive greeting',
  year_ago_update: '"A year ago you helped" update (T7)', programme_report: 'Programme report (T10)' };

/** Not counted against, and never blocked by, the one-update-per-7-days cap (rule 2). */
var EXEMPT_TYPES = ['thank_you', 'programme_report', 'report_reminder'];
/** If two updates clash for one person the higher number is sent and the other is held (rule 2). Edit to change. */
var PRIORITY = { thank_you: 100, programme_report: 95, report_reminder: 90, campaign_update: 80, special_update: 70,
  year_ago_update: 65, welcome: 60, general_update: 40, festive_greeting: 30 };
var UPDATE_CAP_DAYS = 7;
var HOLD_DAYS = 14;            // an update held longer than this is dropped (a stale update is worse than none)
var THANKS_HOLD_DAYS = 30;
var P5_MOVE_DELAY_DAYS = 2;    // T6: after the campaign result update
var DONOR_CLAIM_MS = 10 * 60 * 1000;
var DONOR_BATCH = 50;
var FREQ_MONTHS = { monthly: 1, quarterly: 3, 'half-yearly': 6, 'half yearly': 6, halfyearly: 6, 'six-monthly': 6, annual: 12, annually: 12, yearly: 12 };
/** Placeholder labels that fill themselves from the donor record. Any other label is typed in per send. */
var AUTO_LABELS = ['donor_name', 'first_name', 'project', 'core_programme', 'city', 'owner_name', 'report_link', 'last_donation_date',
  'amount', 'donation_date', 'campaign_name', 'campaign_progress', 'campaign_result'];

function donorReady_() {
  var ss = ssFor_('donor');
  return !!ss.getSheetByName('Donors') && !!ss.getSheetByName('DonorMessages') && !!ss.getSheetByName('DonorTemplates');
}

// ---------- dates ----------
function todayStr_(d) { return Utilities.formatDate(d || new Date(), cfg_().APP_TIMEZONE, 'yyyy-MM-dd'); }

function addDaysStr_(s, n) { var d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

function addMonthsStr_(s, n) {
  var p = s.split('-').map(Number), m = p[1] - 1 + n;
  var y = p[0] + Math.floor(m / 12), mo = ((m % 12) + 12) % 12;
  var last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, mo, Math.min(p[2], last))).toISOString().slice(0, 10);
}

/** Accepts 2026-04-01, 2026-04-01 00:00:00, 1/4/2026, 01-04-2026, 1.4.2026. Returns yyyy-MM-dd or null. */
function parseDateInput_(v) {
  var s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return null;
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s), y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(s))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else return null;
  var dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

function startOfDayLocal_(dateStr) { return Utilities.parseDate(dateStr + ' 00:00', cfg_().APP_TIMEZONE, 'yyyy-MM-dd HH:mm'); }

/** Positive number from "₹12,00,000" / "5000.50" or null. */
function parseAmount_(v) {
  var n = parseFloat(String(v === null || v === undefined ? '' : v).replace(/[^0-9.]/g, ''));
  return isFinite(n) && n > 0 ? n : null;
}

function inr_(n) {
  var s = String(Math.round(Number(n))), last3 = s.slice(-3), rest = s.slice(0, -3);
  return '\u20b9' + (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : '') + last3;
}

// ---------- sending hours per city (rule 3) ----------
function citiesMap_() {
  var m = {};
  loadTable_('Cities').forEach(function (c) { m[String(c.city).trim().toLowerCase()] = c; });
  return m;
}

function hhmmOf_(v, dflt) {
  var m = /^(\d{1,2}):(\d{2})/.exec(String(v || '').trim());
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : dflt;
}

/** The donor's working hours: their city's row on the Cities sheet, else the defaults. */
function windowFor_(donor, cities) {
  var c = cfg_(), row = donor.city ? cities[String(donor.city).trim().toLowerCase()] : null;
  return { tz: (row && row.timezone) || c.APP_TIMEZONE, start: hhmmOf_(row && row.start, c.DONOR_SEND_START), end: hhmmOf_(row && row.end, c.DONOR_SEND_END) };
}

function hmIn_(d, tz) { return Utilities.formatDate(d, tz, 'HH:mm'); }

function inWindow_(win, now) { var hm = hmIn_(now, win.tz); return win.start <= hm && hm < win.end; }

/** Next moment the window opens (this morning if it has not opened yet, otherwise tomorrow morning). */
function nextWindowStart_(win, now) {
  var day = Utilities.formatDate(now, win.tz, 'yyyy-MM-dd');
  if (hmIn_(now, win.tz) < win.start) return Utilities.parseDate(day + ' ' + win.start, win.tz, 'yyyy-MM-dd HH:mm');
  var next = Utilities.formatDate(new Date(now.getTime() + 24 * 3600 * 1000), win.tz, 'yyyy-MM-dd');
  return Utilities.parseDate(next + ' ' + win.start, win.tz, 'yyyy-MM-dd HH:mm');
}

// ---------- filling template placeholders ----------
function labelKey_(label) { return String(label || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }

function autoValue_(key, donor, msg, ctx) {
  var camp = msg.campaign_id && ctx.campaignsById ? ctx.campaignsById[msg.campaign_id] : null;
  var don = msg.donation_id && ctx.donationsById ? ctx.donationsById[msg.donation_id] : null;
  switch (key) {
    case 'donor_name': return donor.name;
    case 'first_name': return String(donor.name || '').split(' ')[0];
    case 'project': return donor.project;
    case 'core_programme': return donor.core_programme;
    case 'city': return donor.city;
    case 'owner_name': return donor.owner_name;
    case 'report_link': return donor.report_link;
    case 'last_donation_date': return donor.last_donation_date;
    case 'amount': { var a = don ? don.amount : donor.last_donation_amount; return parseAmount_(a) ? inr_(parseAmount_(a)) : null; }
    case 'donation_date': return don ? don.donated_on : donor.last_donation_date;
    case 'campaign_name': return camp ? camp.name : null;
    case 'campaign_progress': return camp ? camp.progress_text : null;
    case 'campaign_result': return camp ? camp.results_text : null;
    default: return undefined; // a custom label: typed in per send
  }
}

/** {vars: {"1": "...", ...}, missing: ["{{2}} (label)"]} for one donor and message. */
function resolveVars_(tpl, donor, msg, ctx) {
  var names = tpl.variable_names || [], typed = msg.variables || {}, vars = {}, missing = [];
  placeholderNumbers_(tpl.body).forEach(function (n) {
    var label = names[n - 1] || ('value ' + n), key = labelKey_(label);
    var v = autoValue_(key, donor, msg, ctx);
    if (v === undefined || v === null || String(v).trim() === '') {
      var t = typed[key] !== undefined ? typed[key] : typed[String(n)];
      v = (v === undefined || v === null || String(v).trim() === '') ? t : v;
    }
    v = v === undefined || v === null ? '' : String(v).replace(/\s*\n+\s*/g, ' ').trim();
    if (!v) missing.push('{{' + n + '}} (' + label + ')');
    vars[String(n)] = v;
  });
  return { vars: vars, missing: missing };
}

function renderBody_(tpl, vars) {
  var b = tpl.body || '';
  Object.keys(vars).forEach(function (k) { b = b.split('{{' + k + '}}').join(vars[k]); });
  return b;
}

/** Best approved donor template for a message: type must match; prefer the donor's language and, for welcome, their source code. */
function pickTemplate_(msg, donor, templates) {
  var explicit = msg.template_id ? templates[msg.template_id] : null;
  if (explicit) return explicit.status === 'approved' ? explicit : null;
  var best = null, bestScore = -1, lang = String(donor.language || 'en').toLowerCase();
  Object.keys(templates).forEach(function (id) {
    var t = templates[id];
    if (t.status !== 'approved' || t.message_type !== msg.message_type) return;
    var score = 0;
    if (String(t.language).toLowerCase().slice(0, 2) === lang.slice(0, 2)) score += 2;
    if (msg.message_type === 'welcome') {
      if (t.source_code === donor.segment) score += 3;
      else if (t.source_code && t.source_code !== 'ALL') return;   // written for a different source
      else score += 1;
    }
    if (score > bestScore) { best = t; bestScore = score; }
  });
  return best;
}

// ===== Fallback.gs =====
var BUILD_Fallback = '20261107-1230'; // build stamp (see Build.gs)
/** The IVR fallback: call parents who have not confirmed. Run by the cron tick. */
var MAX_AGE_MS = 48 * 3600 * 1000;
var CALL_BATCH = 20;

/** Voice fallback is optional: it only runs when TWILIO_VOICE_FROM is set. */
function voiceEnabled_() { return !!cfg_().TWILIO_VOICE_FROM; }

function hmNow_(d) { return Utilities.formatDate(d || new Date(), cfg_().APP_TIMEZONE, 'HH:mm'); }

function inCallWindow_() {
  var c = cfg_(), hm = hmNow_();
  return c.CALL_WINDOW_START <= hm && hm < c.CALL_WINDOW_END;
}

/** First moment at or after `d` that is inside the call window (in APP_TIMEZONE). */
function intoCallWindow_(d) {
  var c = cfg_(), tz = c.APP_TIMEZONE;
  var day = Utilities.formatDate(d, tz, 'yyyy-MM-dd'), hm = Utilities.formatDate(d, tz, 'HH:mm');
  if (hm < c.CALL_WINDOW_START) return Utilities.parseDate(day + ' ' + c.CALL_WINDOW_START, tz, 'yyyy-MM-dd HH:mm');
  if (hm >= c.CALL_WINDOW_END) {
    var next = Utilities.formatDate(new Date(d.getTime() + 24 * 3600 * 1000), tz, 'yyyy-MM-dd');
    return Utilities.parseDate(next + ' ' + c.CALL_WINDOW_START, tz, 'yyyy-MM-dd HH:mm');
  }
  return d;
}

/** Roughly when the fallback will call this parent (for the UI). null if no call is planned. */
function nextCallTime_(m, parent, campaignStatus, nowMs) {
  if (!voiceEnabled_()) return null; // WhatsApp-only mode: no calls are planned
  if (campaignStatus === 'cancelled' || parent.opted_out || m.call_requested_at) return null;
  var due;
  if (['sent', 'delivered', 'read'].indexOf(m.status) >= 0 && m.wa_sent_at) {
    var sent = Date.parse(m.wa_sent_at);
    if (nowMs - sent > MAX_AGE_MS) return null;
    due = sent + cfg_().CALL_FALLBACK_HOURS * 3600 * 1000;
  } else if (m.status === 'failed' || (m.status === 'queued' && !parent.has_whatsapp)) {
    due = nowMs;
  } else return null;
  return intoCallWindow_(new Date(Math.max(due, nowMs))).toISOString();
}

function findCandidates_() {
  var now = Date.now(), cutoff = now - cfg_().CALL_FALLBACK_HOURS * 3600 * 1000, oldest = now - MAX_AGE_MS;
  var parents = {}; loadTable_('Parents').forEach(function (p) { parents[p.id] = p; });
  var camps = {}; loadTable_('Campaigns').forEach(function (c) { camps[c.id] = c; });
  return loadTable_('Messages').filter(function (m) {
    if (m.call_requested_at) return false;
    var p = parents[m.parent_id], c = camps[m.campaign_id];
    if (!p || !c || p.opted_out || c.status === 'cancelled') return false;
    if (['sent', 'delivered', 'read'].indexOf(m.status) >= 0) {
      var t = m.wa_sent_at ? Date.parse(m.wa_sent_at) : NaN;
      return t < cutoff && t > oldest; // WhatsApp delivered but no answer after CALL_FALLBACK_HOURS
    }
    if (m.status === 'queued' || m.status === 'failed') {
      var u = Date.parse(m.updated_at);
      return u > oldest && (m.status === 'failed' || !p.has_whatsapp); // no WhatsApp / WhatsApp failed: call now
    }
    return false;
  }).map(function (m) { return { id: m.id, phone: parents[m.parent_id].phone_e164 }; });
}

/** Under lock: claim up to `max` candidates that nobody else claimed first. */
function claimCalls_(candidates, max) {
  return withLock_(function () {
    var ids = {}; candidates.forEach(function (c) { ids[c.id] = c; });
    var picked = [], dirty = [];
    loadTable_('Messages').forEach(function (m) {
      if (!ids[m.id] || m.call_requested_at || picked.length >= max) return;
      m.call_requested_at = nowIso_(); dirty.push(m); picked.push(ids[m.id]);
    });
    saveRows_('Messages', dirty);
    return picked;
  });
}

function runFallback_(deadline) {
  if (!voiceEnabled_()) return { skipped: 'voice not configured (WhatsApp only)' };
  if (!inCallWindow_()) return { skipped: 'outside call window' };
  if (!instantUpdates_()) return { skipped: 'phone calls need the Twilio address (PUBLIC_BASE_URL)' };
  requireConfig_(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'PUBLIC_BASE_URL', 'WEBHOOK_SECRET']);
  var candidates = findCandidates_(), called = 0, failed = 0;
  while (candidates.length && Date.now() < deadline) {
    var batch = claimCalls_(candidates, CALL_BATCH);
    if (!batch.length) break;
    var taken = {}; batch.forEach(function (b) { taken[b.id] = true; });
    candidates = candidates.filter(function (c) { return !taken[c.id]; });
    var results = batch.map(function (b) {
      try { return { id: b.id, sid: placeCall_(b.phone, b.id) }; }
      catch (e) { console.warn('Call for message ' + b.id + ' failed: ' + e.message); return { id: b.id, error: e.message }; }
    });
    withLock_(function () {
      results.forEach(function (r) {
        if (r.sid) {
          // call_status is left to the status webhook, which may already have run.
          var m = findOne_('Messages', 'id', r.id);
          if (m) { m.call_sid = r.sid; m.updated_at = nowIso_(); saveRows_('Messages', [m]); }
          called++;
        } else {
          applyStatus_(r.id, 'flagged', { call_status: 'failed: ' + r.error });
          failed++;
        }
      });
    });
    results.forEach(function (r) { if (r.error) logEvent_(r.id, 'cron', { action: 'place_call', error: r.error }); });
  }
  return { called: called, call_failed: failed };
}

// ===== Parents.gs =====
var BUILD_Parents = '20261107-1230'; // build stamp (see Build.gs)
/** Parents: CSV upload, directory, edit, move, delete. */
var REQUIRED_COLUMNS = ['parent_name', 'phone', 'institution', 'class_or_year'];
var TRUE_VALUES = ['true', 'yes', 'y', '1'];
var FALSE_VALUES = ['false', 'no', 'n', '0'];
var COLLEGE_YEARS = ['1', '2', '3', '4'];

/** E.164 (default region India). Returns null if invalid. */
function normalizePhone_(raw) {
  var s = String(raw || '').trim();
  var plus = s.charAt(0) === '+';
  var d = s.replace(/\D/g, '');
  if (!d) return null;
  if (plus) {
    if (d.length < 8 || d.length > 15 || d.charAt(0) === '0') return null;
    if (d.indexOf('91') === 0) return /^91[2-9]\d{9}$/.test(d) ? '+' + d : null;
    return '+' + d;
  }
  if (/^[2-9]\d{9}$/.test(d)) return '+91' + d;
  if (/^0[2-9]\d{9}$/.test(d)) return '+91' + d.slice(1);
  if (/^91[2-9]\d{9}$/.test(d)) return '+' + d;
  return null;
}

function parseBool_(raw) {
  var v = String(raw || '').trim().toLowerCase();
  if (v === '') return true;
  if (TRUE_VALUES.indexOf(v) >= 0) return true;
  if (FALSE_VALUES.indexOf(v) >= 0) return false;
  return null;
}

/** Returns {level, section, error}. */
function cleanLevel_(type, classOrYear, section) {
  if (type === 'college') {
    var digits = (classOrYear.match(/\d/g) || []).join('');
    if (COLLEGE_YEARS.indexOf(digits) < 0) return { error: "college year must be 1, 2, 3 or 4, got '" + classOrYear + "'" };
    if (section) return { error: 'colleges have no section; leave section empty' };
    return { level: digits, section: null };
  }
  var value = classOrYear.replace(/^(class|std|grade)\s*/i, '').trim();
  if (!value) return { error: 'class_or_year is empty' };
  return { level: value, section: section ? section.toUpperCase() : null };
}

/** Validate and normalise one parent. Returns {row} or {error}. */
function cleanParent_(f) {
  var name = String(f.parent_name || '').trim();
  var institution = String(f.institution || '').trim().split(/\s+/).join(' ');
  var type = (String(f.institution_type || '').trim().toLowerCase()) || 'school';
  var cy = String(f.class_or_year || '').trim();
  if (!name) return { error: 'parent_name is empty' };
  if (!institution) return { error: 'institution is empty (the school or college name)' };
  if (type !== 'school' && type !== 'college') return { error: "institution_type must be school or college, got '" + type + "'" };
  if (!cy) return { error: 'class_or_year is empty' };
  var lv = cleanLevel_(type, cy, String(f.section || '').trim());
  if (lv.error) return { error: lv.error };
  var phoneRaw = String(f.phone || '').trim();
  if (!phoneRaw) return { error: 'phone is empty' };
  var phone = normalizePhone_(phoneRaw);
  if (!phone) return { error: "invalid phone number '" + phoneRaw + "'" };
  return {
    row: {
      parent_name: name, phone_e164: phone, child_name: String(f.child_name || '').trim() || null,
      institution: institution, institution_type: type, class_or_year: lv.level, section: lv.section,
      language: String(f.language || '').trim().toLowerCase() || 'en'
    }
  };
}

function inGroup_(r, institution, classOrYear, section) {
  if (institution && r.institution !== institution) return false;
  if (classOrYear && r.class_or_year !== classOrYear) return false;
  if (section && r.section !== section) return false;
  return true;
}

function sortBy_(rows, keys) {
  return rows.sort(function (a, b) {
    for (var i = 0; i < keys.length; i++) {
      var x = String(a[keys[i]] || ''), y = String(b[keys[i]] || '');
      var c = x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
      if (c) return c;
    }
    return 0;
  });
}

function uploadParents_(user, csvText) {
  var text = String(csvText || '').replace(/^\uFEFF/, '');
  var table;
  try { table = Utilities.parseCsv(text); } catch (e) { throw new ApiError('File must be a UTF-8 CSV'); }
  if (!table.length) throw new ApiError('The file is empty.');
  var header = table[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var missing = REQUIRED_COLUMNS.filter(function (c) { return header.indexOf(c) < 0; });
  if (missing.length) throw new ApiError('Missing columns: ' + missing.join(', '));

  var byPhone = {}, firstRow = {}, typeOf = {}, rejected = [];
  for (var i = 1; i < table.length; i++) {
    var cells = table[i], rowNumber = i + 1;
    if (cells.length === 1 && String(cells[0]).trim() === '') continue; // blank line
    var rec = {};
    header.forEach(function (h, j) { rec[h] = cells[j] === undefined ? '' : String(cells[j]); });
    var res = cleanParent_(rec);
    if (res.error) { rejected.push({ row: rowNumber, phone: rec.phone || null, reason: res.error }); continue; }
    var wa = parseBool_(rec.has_whatsapp);
    if (wa === null) { rejected.push({ row: rowNumber, phone: rec.phone || null, reason: "has_whatsapp must be yes/no/true/false, got '" + rec.has_whatsapp + "'" }); continue; }
    var p = res.row; p.has_whatsapp = wa;
    var known = typeOf[p.institution];
    if (known && known.type !== p.institution_type) {
      rejected.push({ row: rowNumber, phone: rec.phone || null, reason: "'" + p.institution + "' is a " + known.type + ' in row ' + known.row });
      continue;
    }
    if (byPhone[p.phone_e164]) {
      rejected.push({ row: rowNumber, phone: rec.phone || null, reason: 'duplicate phone, already in row ' + firstRow[p.phone_e164] });
      continue;
    }
    byPhone[p.phone_e164] = p; firstRow[p.phone_e164] = rowNumber;
    if (!typeOf[p.institution]) typeOf[p.institution] = { type: p.institution_type, row: rowNumber };
  }

  return withLock_(function () {
    var existing = {};
    loadTable_('Parents').forEach(function (r) { existing[r.phone_e164] = r; });
    var toUpdate = [], toInsert = [];
    Object.keys(byPhone).forEach(function (phone) {
      var p = byPhone[phone], old = existing[phone];
      if (old) {
        // opted_out is never reset by a re-upload.
        Object.keys(p).forEach(function (k) { old[k] = p[k]; });
        toUpdate.push(old);
      } else {
        p.id = newId_(); p.opted_out = false; p.created_at = nowIso_();
        toInsert.push(p);
      }
    });
    saveRows_('Parents', toUpdate);
    insertRows_('Parents', toInsert);
    return { inserted: toInsert.length, updated: toUpdate.length, rejected: rejected.length, errors: rejected };
  });
}

function listGroups_() {
  var groups = {};
  loadTable_('Parents').forEach(function (r) {
    if (r.opted_out) return;
    var key = [r.institution, r.class_or_year, r.section || ''].join('\u0001');
    var g = groups[key] || (groups[key] = {
      institution: r.institution, institution_type: r.institution_type, class_or_year: r.class_or_year,
      section: r.section, parent_count: 0, whatsapp_count: 0, languages: {}
    });
    g.parent_count++;
    if (r.has_whatsapp) g.whatsapp_count++;
    g.languages[r.language] = (g.languages[r.language] || 0) + 1;
  });
  return sortBy_(Object.keys(groups).map(function (k) { return groups[k]; }), ['institution', 'class_or_year', 'section']);
}

function listParents_(user, f) {
  f = f || {};
  var parents = loadTable_('Parents').filter(function (r) { return inGroup_(r, f.institution, f.class_or_year, f.section); });
  var stats = {};
  loadTable_('Messages').forEach(function (m) {
    var s = stats[m.parent_id] || (stats[m.parent_id] = { total: 0, responded: 0, flagged: 0 });
    if (m.status !== 'cancelled') s.total++;
    if (m.status === 'confirmed' || m.status === 'declined') s.responded++;
    if (m.status === 'flagged') s.flagged++;
  });
  sortBy_(parents, ['institution', 'class_or_year', 'parent_name', 'id']);
  return parents.map(function (p) {
    p.stats = stats[p.id] || { total: 0, responded: 0, flagged: 0 };
    delete p._row;
    return p;
  });
}

function updateParent_(user, id, body) {
  var res = cleanParent_(body);
  if (res.error) throw new ApiError(res.error);
  return withLock_(function () {
    var parent = findOne_('Parents', 'id', id);
    if (!parent) throw new ApiError('Parent not found', null, 404);
    var clash = findBy_('Parents', 'phone_e164', res.row.phone_e164).filter(function (r) { return r.id !== id; });
    if (clash.length) throw new ApiError('Another parent already has this phone number.');
    Object.keys(res.row).forEach(function (k) { parent[k] = res.row[k]; });
    parent.has_whatsapp = !!body.has_whatsapp;
    parent.opted_out = !!body.opted_out;
    saveRows_('Parents', [parent]);
    delete parent._row;
    return parent;
  });
}

/** Removes parents and their message history (like ON DELETE CASCADE). */
function deleteParentsWhere_(pred) {
  var parents = loadTable_('Parents');
  var doomed = {}, keep = [], n = 0;
  parents.forEach(function (p) { if (pred(p)) { doomed[p.id] = true; n++; } else keep.push(p); });
  if (!n) return 0;
  replaceTable_('Parents', keep);
  var msgs = loadTable_('Messages');
  var keepMsgs = msgs.filter(function (m) { return !doomed[m.parent_id]; });
  if (keepMsgs.length !== msgs.length) replaceTable_('Messages', keepMsgs);
  return n;
}

function deleteParent_(user, id) {
  return withLock_(function () {
    var n = deleteParentsWhere_(function (p) { return p.id === id; });
    if (!n) throw new ApiError('Parent not found', null, 404);
    return { deleted: 1 };
  });
}

function moveGroup_(user, body) {
  var s = body.source || {};
  if (!String(s.institution || '').trim()) throw new ApiError('Choose a school or college.');
  if (!s.class_or_year) throw new ApiError('Choose the class or year to move.');
  return withLock_(function () {
    var rows = loadTable_('Parents').filter(function (r) { return inGroup_(r, s.institution, s.class_or_year, s.section); });
    if (!rows.length) throw new ApiError('No parents in this group.', null, 404);
    var lv = cleanLevel_(rows[0].institution_type, String(body.class_or_year || '').trim(), String(body.section || '').trim());
    if (lv.error) throw new ApiError(lv.error);
    rows.forEach(function (r) {
      r.class_or_year = lv.level;
      if (s.section) r.section = lv.section; // a whole class keeps each parent's section
    });
    saveRows_('Parents', rows);
    return { moved: rows.length };
  });
}

function deleteGroup_(user, body) {
  if (!String(body.institution || '').trim()) throw new ApiError('Choose a school or college.');
  return withLock_(function () {
    return { deleted: deleteParentsWhere_(function (p) { return inGroup_(p, body.institution, body.class_or_year, body.section); }) };
  });
}

function parentHistory_(user, id) {
  var camps = {}, tpls = {};
  loadTable_('Campaigns').forEach(function (c) { camps[c.id] = c; });
  loadTable_('Templates').forEach(function (t) { tpls[t.id] = t; });
  var rows = findBy_('Messages', 'parent_id', id);
  rows.sort(function (a, b) { return String(b.updated_at).localeCompare(String(a.updated_at)); });
  return rows.slice(0, 50).map(function (m) {
    var c = camps[m.campaign_id] || {}, t = tpls[c.template_id] || {};
    return {
      id: m.id, status: m.status, confirmed_via: m.confirmed_via, reply_text: m.reply_text, updated_at: m.updated_at,
      campaigns: { id: c.id, audience: c.audience, created_at: c.created_at, templates: { name: t.name } }
    };
  });
}

// ===== Permissions.gs =====
var BUILD_Permissions = '20261107-1230'; // build stamp (see Build.gs)
/**
 * Permission service: the single source of truth for who may open which division.
 * Permissions live on the Admins tab of the Access file (explicit TRUE/FALSE per person, never inferred from role), edited from the app (Users and access):
 *   parent_access  Parent Communication
 *   donor_access   Donor Communication
 *   org_overview   Organisation Overview (only honoured when role = admin)
 *   role           admin | staff   (informational; an admin does NOT automatically see any division)
 * Every API call re-reads this sheet, so a revoked permission takes effect on the very next request.
 * The browser UI only mirrors this; it is never trusted.
 */
var DIVISION_LABELS = { parent: 'Parent Communication', donor: 'Donor Communication', overview: 'Organisation Overview' };
var DIVISION_BY_PREFIX = { parents: 'parent', templates: 'parent', campaigns: 'parent', messages: 'parent', donor: 'donor', overview: 'overview', admin: 'admin' };

function flag_(v) { return String(v === null || v === undefined ? '' : v).trim().toUpperCase() === 'TRUE'; }

/**
 * Roles: master (the project owner is always one, and cannot be locked out), admin (manages only what it was given), staff.
 * An administrator's capabilities say what it may manage. A master has all of them.
 */
var ADMIN_CAPS = { users_parent: 'Manage Parent users', users_donor: 'Manage Donor users', audit: 'See the access log and check access' };

function ownerEmail_() { return String(PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL') || '').toLowerCase(); }
function roleOf_(v) { var r = String(v || '').toLowerCase(); return r === 'master' ? 'master' : r === 'admin' ? 'admin' : 'staff'; }
function parseCaps_(v) {
  var list = Array.isArray(v) ? v : String(v || '').split(','), out = [];
  list.forEach(function (c) { c = String(c).trim(); if (ADMIN_CAPS[c] && out.indexOf(c) < 0) out.push(c); });
  return out;
}
function isAdminUser_(u) { return !!u && (u.role === 'master' || (u.role === 'admin' && u.caps.length > 0)); }

/** Fresh permissions for an email, or null if the person has no access (not listed, inactive, or past their end date). */
function permissionsFor_(email) {
  email = String(email || '').toLowerCase();
  if (!email) return null;
  var owner = email === ownerEmail_();
  var all = loadTable_('Admins').filter(function (r) { return String(r.email).toLowerCase() === email; });
  var r = all.filter(function (x) { return x.active; })[0] || (owner ? all[0] : null); // the owner is never locked out
  if (!r && !owner) return null;
  r = r || {};
  if (!owner && r.expires_on && todayStr_() > r.expires_on) return null;                 // access has ended
  // Rows created before divisions existed have all three columns blank: they keep their old Parent access.
  var legacy = !owner && r.parent_access === null && r.donor_access === null && r.org_overview === null;
  var role = owner ? 'master' : roleOf_(r.role), elevated = role !== 'staff';
  var caps = role === 'master' ? Object.keys(ADMIN_CAPS) : role === 'admin' ? parseCaps_(r.admin_caps) : [];
  return {
    email: email, full_name: r.full_name || '', role: role, owner: owner, caps: caps, expires_on: r.expires_on || null,
    divisions: { parent: owner || role === 'master' || (legacy ? true : flag_(r.parent_access)), donor: owner || role === 'master' || flag_(r.donor_access), overview: owner || role === 'master' || (elevated && flag_(r.org_overview)) }
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
    user: { email: user.email, full_name: user.full_name, role: user.role, caps: user.caps, owner: user.owner },
    can_admin: isAdminUser_(user), contact: ownerEmail_(), server_build: buildReport_().newest, build_problem: buildProblems_(),
    entries: entries,
    mode: !entries.length ? 'denied' : entries.length === 1 ? 'single' : 'select',
    last_division: entries.indexOf(last) >= 0 ? last : null // a remembered division never grants access
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

// ===== Replies.gs =====
var BUILD_Replies = '20261107-1230'; // build stamp (see Build.gs)
/** What to do when a parent writes to us on WhatsApp: confirm/decline, opt out, or keep the text. */
var CONFIRM_WORDS = ['yes', 'confirm', '1'];
var DECLINE_WORDS = ['no', 'decline', '2', "can't attend", 'can\u2019t attend', 'cant attend'];
var STOP_WORDS = ['stop', 'stop all', 'stopall', 'unsubscribe', 'opt out', 'optout'];
var START_WORDS = ['start', 'unstop', 'subscribe'];
var REPLY_WINDOW_MS = 7 * 24 * 3600 * 1000;
var RECOVER_WINDOW_MS = 3 * 3600 * 1000;
var MAX_REPLY_LENGTH = 1000;

function normalizeText_(t) { return String(t || '').trim().toLowerCase().replace(/[.!]+$/, ''); }

/** 'confirmed', 'declined' or null (any other text). */
function parseReply_(params) {
  var button = String(params.ButtonPayload || '').trim().toLowerCase();
  var text = normalizeText_(params.Body);
  if (button === 'confirm' || CONFIRM_WORDS.indexOf(text) >= 0) return 'confirmed';
  if (button === 'decline' || DECLINE_WORDS.indexOf(text) >= 0) return 'declined';
  return null;
}

/** true for STOP, false for START, null for anything else. */
function optOutChoice_(params) {
  var text = normalizeText_(params.Body);
  if (STOP_WORDS.indexOf(text) >= 0) return true;
  if (START_WORDS.indexOf(text) >= 0) return false;
  return null;
}

function phoneOf_(params) { return String(params.From || '').replace(/^whatsapp:/, ''); }

function findRepliedMessageId_(params) {
  // Best match: the message the parent replied to (Twilio sends this for replies within 7 days).
  if (params.OriginalRepliedMessageSid) {
    var m = findOne_('Messages', 'wa_sid', params.OriginalRepliedMessageSid);
    if (m) return m.id;
  }
  // Otherwise: the parent's most recent open message from the last 7 days.
  var parent = findOne_('Parents', 'phone_e164', phoneOf_(params));
  if (!parent) return null;
  var since = Date.now() - REPLY_WINDOW_MS;
  var open = findBy_('Messages', 'parent_id', parent.id).filter(function (m) {
    return ['sent', 'delivered', 'read', 'flagged'].indexOf(m.status) >= 0 && m.wa_sent_at && Date.parse(m.wa_sent_at) >= since;
  }).sort(function (a, b) { return String(b.wa_sent_at).localeCompare(String(a.wa_sent_at)); });
  return open.length ? open[0].id : null;
}

/** Apply one inbound WhatsApp message (inside the lock). Safe to run twice for the same message. */
function handleInbound_(params, eventId) {
  var optOut = optOutChoice_(params);
  if (optOut !== null) {
    // Opted-out parents get no WhatsApp and no calls (sender and fallback check this).
    findBy_('Parents', 'phone_e164', phoneOf_(params)).forEach(function (p) {
      p.opted_out = optOut; saveRows_('Parents', [p]);
    });
    if (donorReady_()) donorOptOutChoice_(params, optOut);
    return;
  }
  var messageId = findRepliedMessageId_(params);
  if (!messageId) { if (donorReady_()) handleDonorReply_(params, eventId); return; }
  if (eventId) setEventMessageId_(eventId, messageId);

  var decision = parseReply_(params);
  if (decision) { applyStatus_(messageId, decision, { confirmed_via: 'whatsapp' }); return; }

  var text = String(params.Body || '').trim(); // any other text: keep it for the campaign page
  if (text) updateMessage_(messageId, { reply_text: text.slice(0, MAX_REPLY_LENGTH), replied_at: nowIso_() });
}

/** Cron: handle inbound messages whose webhook never arrived. */
function recoverMissedReplies_() {
  var inbound;
  try { inbound = listInboundWhatsapp_(new Date(Date.now() - RECOVER_WINDOW_MS)); }
  catch (e) { console.warn('Could not list inbound WhatsApp messages: ' + e.message); return { error: e.message }; }
  var handled = {};
  (donorReady_() ? ['Events', 'DonorEvents'] : ['Events']).forEach(function (tbl) {
    lastEvents_(3000, tbl).forEach(function (ev) {
      if (ev.source === 'whatsapp_inbound' && ev.payload && ev.payload.MessageSid) handled[ev.payload.MessageSid] = true;
    });
  });
  var recovered = 0;
  inbound.forEach(function (params) {
    if (handled[params.MessageSid]) return;
    var payload = {}; Object.keys(params).forEach(function (k) { payload[k] = params[k]; }); payload.recovered = 'true';
    var eventId = logEvent_(null, 'whatsapp_inbound', payload, divisionOfPhone_(phoneOf_(params)));
    withLock_(function () { handleInbound_(params, eventId); markEventProcessed_(eventId); });
    recovered++;
  });
  return { checked: inbound.length, recovered: recovered };
}

// ===== Sender.gs =====
var BUILD_Sender = '20261107-1230'; // build stamp (see Build.gs)
/**
 * Fan out a campaign: one WhatsApp message per parent.
 * Apps Script has no background tasks, so the web app calls sendCampaignBatch_ repeatedly until nothing
 * is left, and the cron tick finishes any campaign whose browser was closed. A message is "claimed" (under
 * the lock) before it is sent, so two runs never send the same message twice.
 */
var CLAIM_EXPIRES_MS = 10 * 60 * 1000;
var RESUME_AFTER_MS = 10 * 60 * 1000;
var RESUME_MAX_AGE_MS = 48 * 3600 * 1000;
var STUCK_AFTER_MS = 30 * 60 * 1000;
var RECHECK_MAX_AGE_MS = 24 * 3600 * 1000;
var BATCH_SIZE = 50;

function eligibleToSend_(m, parentsById, nowMs) {
  var p = parentsById[m.parent_id];
  if (m.status !== 'queued' || !p) return false;
  if (!p.opted_out && !p.has_whatsapp) return false; // stays queued; the fallback call handles them
  var claimed = m.send_claimed_at ? Date.parse(m.send_claimed_at) : 0;
  return !claimed || nowMs - claimed > CLAIM_EXPIRES_MS;
}

/** Under lock: pick up to `max` messages, cancel opted-out ones, mark the rest claimed. */
function claimBatch_(campaignId, max) {
  return withLock_(function () {
    var campaign = findOne_('Campaigns', 'id', campaignId);
    if (!campaign || campaign.status === 'cancelled') return { campaign: campaign, items: [], remaining: 0 };
    var parents = {}; loadTable_('Parents').forEach(function (p) { parents[p.id] = p; });
    var now = Date.now(), dirty = [], items = [], remaining = 0;
    loadTable_('Messages').forEach(function (m) {
      if (m.campaign_id !== campaignId || m.status !== 'queued') return;
      var p = parents[m.parent_id];
      if (p && p.opted_out) { transition_(m, 'cancelled'); dirty.push(m); return; }
      if (!eligibleToSend_(m, parents, now)) return;
      if (items.length >= max) { remaining++; return; }
      m.send_claimed_at = nowIso_();
      dirty.push(m);
      items.push({ id: m.id, template_id: m.template_id || campaign.template_id, phone: p.phone_e164 });
    });
    saveRows_('Messages', dirty);
    return { campaign: campaign, items: items, remaining: remaining };
  });
}

function sendItems_(campaign, items) {
  var c = cfg_();
  var sids = {};
  loadTable_('Templates').forEach(function (t) { sids[t.id] = t.twilio_content_sid; });
  var results = [];
  for (var i = 0; i < items.length; i += c.SEND_CONCURRENCY) {
    var chunk = items.slice(i, i + c.SEND_CONCURRENCY);
    var out;
    try {
      out = sendWhatsappMany_(chunk.map(function (it) {
        return { phone: it.phone, contentSid: sids[it.template_id], variables: campaign.variables, messageId: it.id };
      }));
    } catch (e) {
      out = chunk.map(function () { return { error: 'Unexpected error while sending: ' + e.message }; });
    }
    chunk.forEach(function (it, j) { results.push({ id: it.id, res: out[j] }); });
  }
  return results;
}

function saveSendResults_(results) {
  withLock_(function () {
    var byId = {}; results.forEach(function (r) { byId[r.id] = r.res; });
    var dirty = [];
    loadTable_('Messages').forEach(function (m) {
      var res = byId[m.id]; if (!res) return;
      if (res.sid) {
        m.wa_sid = res.sid; m.wa_sent_at = nowIso_(); m.updated_at = nowIso_();
        transition_(m, 'sent'); // no-op if a status callback already moved it further
      } else {
        transition_(m, 'failed', { wa_error: res.error });
      }
      dirty.push(m);
    });
    saveRows_('Messages', dirty);
  });
}

function finishCampaignIfDone_(campaignId, remaining) {
  if (remaining > 0) return 'sending';
  return withLock_(function () {
    var c = findOne_('Campaigns', 'id', campaignId);
    if (!c) return null;
    if (c.status === 'sending' || c.status === 'failed') { c.status = 'sent'; saveRows_('Campaigns', [c]); }
    return c.status;
  });
}

/** Send for up to budgetMs. Returns {status, remaining}. Safe to call repeatedly and concurrently. */
function sendCampaignBatch_(campaignId, budgetMs) {
  requireConfig_(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']);   // the Twilio address is optional (see instantUpdates_)
  if (!cfg_().TWILIO_WHATSAPP_FROM && !cfg_().TWILIO_MESSAGING_SERVICE_SID)
    throw new ApiError('Set TWILIO_WHATSAPP_FROM (or TWILIO_MESSAGING_SERVICE_SID) in Script properties.');
  var started = Date.now(), remaining = 0, campaign = null;
  while (true) {
    var claim = claimBatch_(campaignId, BATCH_SIZE);
    campaign = claim.campaign;
    remaining = claim.remaining;
    if (!claim.items.length) break;
    saveSendResults_(sendItems_(claim.campaign, claim.items));
    if (Date.now() - started > budgetMs) break;
  }
  if (!campaign) throw new ApiError('Campaign not found', null, 404);
  if (campaign.status === 'cancelled') return { status: 'cancelled', remaining: 0 };
  return { status: finishCampaignIfDone_(campaignId, remaining), remaining: remaining };
}

/** Cron: finish campaigns whose send was interrupted (browser closed, quota hit). */
function resumeStuckCampaigns_(deadline) {
  var now = Date.now(), resumed = 0;
  var camps = loadTable_('Campaigns').filter(function (c) {
    var age = now - Date.parse(c.created_at);
    return (c.status === 'sending' || c.status === 'failed') && age > RESUME_AFTER_MS && age < RESUME_MAX_AGE_MS;
  });
  for (var i = 0; i < camps.length && Date.now() < deadline; i++) {
    try { sendCampaignBatch_(camps[i].id, Math.max(10000, deadline - Date.now() - 20000)); resumed++; }
    catch (e) { console.error('Campaign ' + camps[i].id + ' failed: ' + e.message); }
  }
  return { resumed: resumed };
}

/** Cron: Twilio does not retry lost status callbacks, so ask Twilio about messages still on 'sent'. */
function recheckStuckMessages_(deadline) {
  var now = Date.now();
  var stuck = loadTable_('Messages').filter(function (m) {
    if (m.status !== 'sent' || !m.wa_sid || !m.wa_sent_at) return false;
    var age = now - Date.parse(m.wa_sent_at);
    return age > STUCK_AFTER_MS && age < RECHECK_MAX_AGE_MS;
  }).slice(0, 150);
  var updates = [];
  for (var i = 0; i < stuck.length && Date.now() < deadline; i++) {
    var m = stuck[i];
    try {
      var s = fetchWhatsappStatus_(m.wa_sid);
      var ns = WHATSAPP_STATUS_MAP[s.status];
      if (ns && ns !== 'sent') updates.push({ id: m.id, status: ns, error: s.error, twilio: s.status });
    } catch (e) { console.warn('Could not fetch status of ' + m.wa_sid + ': ' + e.message); }
  }
  var changed = 0;
  if (updates.length) {
    withLock_(function () {
      updates.forEach(function (u) {
        if (applyStatus_(u.id, u.status, u.status === 'failed' ? { wa_error: u.error } : {})) changed++;
      });
    });
    updates.forEach(function (u) { logEvent_(u.id, 'cron', { recheck_status: u.twilio, error: u.error }); });
  }
  return { checked: stuck.length, updated: changed };
}

/**
 * Single-address mode: no Twilio callbacks, so ask Twilio how our recent messages are doing (delivered, read, failed) and update
 * the parent and donor message rows in one pass. Statuses still only move forward.
 */
function pollMessageStatuses_() {
  var cutoff = Date.now() - 3 * 86400000, wanted = {}, any = false;
  function consider(table) {
    loadTable_(table).forEach(function (m) {
      if (m.wa_sid && (m.status === 'sent' || m.status === 'delivered') && m.wa_sent_at && Date.parse(m.wa_sent_at) > cutoff) { wanted[m.wa_sid] = true; any = true; }
    });
  }
  consider('Messages'); if (donorReady_()) consider('DonorMessages');
  if (!any) return { checked: 0, updated: 0 };
  var list = listOutboundStatuses_(new Date(cutoff)), status = {};
  list.forEach(function (x) { if (wanted[x.sid]) status[x.sid] = x; });
  var updated = 0;
  withLock_(function () {
    var dirty = [];
    loadTable_('Messages').forEach(function (m) {
      var x = m.wa_sid && status[m.wa_sid]; if (!x) return;
      var ns = WHATSAPP_STATUS_MAP[x.status];
      if (ns && transition_(m, ns, ns === 'failed' ? { wa_error: x.error || 'WhatsApp could not deliver the message' } : {})) dirty.push(m);
    });
    saveRows_('Messages', dirty); updated += dirty.length;
    if (donorReady_()) {
      var dd = [];
      loadTable_('DonorMessages').forEach(function (m) {
        var x = m.wa_sid && status[m.wa_sid]; if (!x) return;
        var ns = WHATSAPP_STATUS_MAP[x.status];
        if (ns && (DONOR_STATUS_ALLOWED[ns] || []).indexOf(m.status) >= 0) { m.status = ns; if (ns === 'failed') m.wa_error = x.error || 'WhatsApp could not deliver the message'; m.updated_at = nowIso_(); dd.push(m); }
      });
      saveRows_('DonorMessages', dd); updated += dd.length;
    }
  });
  return { checked: Object.keys(wanted).length, updated: updated };
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
  } catch (e) { /* not bound to a spreadsheet */ }
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
 * Run once (and again after updates). Creates the three Google Sheets (parent, donor, access), their tabs, the first administrator,
 * and moves anything left in the old single file into the right file. Safe to run again.
 */
function setup() {
  var files = { parent: ensureDatabaseSheet_(), donor: ensureFile_('donor'), access: ensureFile_('access') };
  Object.keys(SCHEMA).forEach(function (name) {
    var ss = files[FILE_OF[name]], cols = SCHEMA[name], sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@'); // plain text everywhere
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

  var notes = migrateToSeparateFiles_(files);
  // The person who runs setup is the project owner: permanently the master administrator (kept in a Script property, not a sheet).
  var me = (Session.getEffectiveUser().getEmail() || Session.getActiveUser().getEmail() || '').toLowerCase();
  if (me && !props.getProperty('OWNER_EMAIL')) props.setProperty('OWNER_EMAIL', me);
  if (!loadTable_('Admins').length && me) insertRows_('Admins', [{ email: me, full_name: '', active: true, parent_access: 'TRUE', donor_access: 'TRUE', org_overview: 'TRUE', role: 'master' }]);
  migrateAdmins_();
  seedCities_();
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
  // donor templates that were kept in the parent Templates tab
  try {
    var tpls = loadTable_('Templates'), donorTpls = tpls.filter(function (t) { return t.division === 'donor'; });
    if (donorTpls.length && !loadTable_('DonorTemplates').length) {
      backup();
      insertRows_('DonorTemplates', donorTpls.map(function (t) { var c = {}; Object.keys(t).forEach(function (k) { if (k !== '_row') c[k] = t[k]; }); return c; }));
      replaceTable_('Templates', tpls.filter(function (t) { return t.division !== 'donor'; }));
      notes.push('Moved ' + donorTpls.length + ' donor template(s) to the donor file.');
    }
  } catch (e) { notes.push('Donor templates: ' + e.message); }
  // donor events that were logged in the parent Events tab
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
  try { SpreadsheetApp.getUi().alert('Webhook URLs', text, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) { /* editor run */ }
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
    // administrators from before scoped roles keep what they could do: manage the departments they hold, and see the log
    if (roleOf_(r.role) === 'admin' && !r.admin_caps) {
      r.admin_caps = [flag_(r.parent_access) ? 'users_parent' : '', flag_(r.donor_access) ? 'users_donor' : '', 'audit'].filter(Boolean).join(','); changed = true;
    }
    if (changed) dirty.push(r);
  });
  saveRows_('Admins', dirty);
}

/** Working hours per city for donor messages (rule 3). Edit the Cities sheet any time; unlisted cities use the defaults. */
function seedCities_() {
  if (loadTable_('Cities').length) return;
  var rows = [['Kolkata', 'Asia/Kolkata', '09:00', '19:00'], ['Mumbai', 'Asia/Kolkata', '09:00', '19:00'], ['Delhi', 'Asia/Kolkata', '09:00', '19:00'],
    ['Bengaluru', 'Asia/Kolkata', '09:00', '19:00'], ['Chennai', 'Asia/Kolkata', '09:00', '19:00'], ['Hyderabad', 'Asia/Kolkata', '09:00', '19:00'],
    ['Pune', 'Asia/Kolkata', '09:00', '19:00'], ['London', 'Europe/London', '09:00', '18:00'], ['New York', 'America/New_York', '09:00', '18:00'],
    ['Dubai', 'Asia/Dubai', '09:00', '18:00'], ['Singapore', 'Asia/Singapore', '09:00', '18:00']];
  insertRows_('Cities', rows.map(function (r) { return { city: r[0], timezone: r[1], start: r[2], end: r[3] }; }));
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
    var fields = { email: me, active: true, parent_access: 'TRUE', donor_access: 'TRUE', org_overview: 'TRUE', role: 'master', admin_caps: '', expires_on: null };
    if (row) { Object.keys(fields).forEach(function (k) { row[k] = fields[k]; }); saveRows_('Admins', [row]); }
    else { fields.full_name = ''; insertRows_('Admins', [fields]); }
    try { logAccess_(me, 'owner.repair', me, 'Owner restored as administrator with all access'); } catch (e) { /* the log is optional here */ }
  });
  var r = syncAllSharing_(false);
  var msg = me + ' is now the master administrator with Parent, Donor and Overview access.' + (r.warnings.length ? ' Sharing notes: ' + r.warnings.join('; ') : '') + ' Open the app again (hard refresh).';
  console.log(msg); toast_(msg);
  return msg;
}

// ===== Status.gs =====
var BUILD_Status = '20261107-1230'; // build stamp (see Build.gs)
/**
 * Message status rules. Statuses only move forward: queued < sent < delivered < read < confirmed/declined.
 * failed and flagged are side states that a later confirm/decline still overrides. cancelled is final.
 */
var ALLOWED_FROM = {
  sent: ['queued'],
  delivered: ['queued', 'sent'],
  read: ['queued', 'sent', 'delivered'],
  failed: ['queued', 'sent', 'delivered'],
  confirmed: ['queued', 'sent', 'delivered', 'read', 'failed', 'flagged'],
  declined: ['queued', 'sent', 'delivered', 'read', 'failed', 'flagged'],
  flagged: ['queued', 'sent', 'delivered', 'read', 'failed'],
  cancelled: ['queued']
};
var ADMIN_OUTCOME_FROM = ['queued', 'sent', 'delivered', 'read', 'failed', 'flagged', 'confirmed', 'declined'];
var WHATSAPP_STATUS_MAP = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed', undelivered: 'failed' };
var STATUSES = ['queued', 'sent', 'delivered', 'read', 'confirmed', 'declined', 'flagged', 'failed', 'cancelled'];

/** In-memory transition on a loaded row. Returns true if it changed (caller saves). */
function transition_(msg, newStatus, extra) {
  if (ALLOWED_FROM[newStatus].indexOf(msg.status) < 0) return false;
  Object.keys(extra || {}).forEach(function (k) { msg[k] = extra[k]; });
  msg.status = newStatus;
  msg.updated_at = nowIso_();
  return true;
}

/** Load one message, apply the transition, save. Run inside the lock. */
function applyStatus_(messageId, newStatus, extra) {
  var msg = findOne_('Messages', 'id', messageId);
  if (!msg) return false;
  if (!transition_(msg, newStatus, extra)) return false;
  saveRows_('Messages', [msg]);
  return true;
}

function updateMessage_(messageId, fields) {
  var msg = findOne_('Messages', 'id', messageId);
  if (!msg) return null;
  Object.keys(fields).forEach(function (k) { msg[k] = fields[k]; });
  msg.updated_at = nowIso_();
  saveRows_('Messages', [msg]);
  return msg;
}

function setAdminOutcome_(messageId, outcome, userEmail) {
  var msg = findOne_('Messages', 'id', messageId);
  if (!msg || ADMIN_OUTCOME_FROM.indexOf(msg.status) < 0) return false;
  msg.status = outcome;
  msg.confirmed_via = 'admin';
  msg.resolved_by = userEmail;
  msg.updated_at = nowIso_();
  saveRows_('Messages', [msg]);
  return true;
}

// ===== Templates.gs =====
var BUILD_Templates = '20261107-1230'; // build stamp (see Build.gs)
/** WhatsApp templates: validate, submit to Meta via Twilio, sync decisions. */
var MAX_BODY_LENGTH = 1024;

function placeholderNumbers_(body) {
  var seen = {}, out = [], m, re = /\{\{(\d+)\}\}/g;
  while ((m = re.exec(body)) !== null) { var n = parseInt(m[1], 10); if (!seen[n]) { seen[n] = true; out.push(n); } }
  return out.sort(function (a, b) { return a - b; });
}

function stripVersion_(name) { return String(name).replace(/_v\d+$/, ''); }

function validateName_(name, language) {
  var errors = [];
  if (!/^[a-z0-9_]+$/.test(name || '')) errors.push('Name may only contain lowercase letters, digits and underscores.');
  if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(language || '')) errors.push("Language must be a code like 'en', 'hi' or 'en_US'.");
  return errors;
}

function validateContent_(t) {
  var errors = [], body = String(t.body || '').trim();
  if (!body) return ['Body is required.'];
  if (body.length > MAX_BODY_LENGTH) errors.push('Body must be at most ' + MAX_BODY_LENGTH + ' characters.');
  var found = body.match(/\{\{(\d+)\}\}/g) || [];
  var numbers = placeholderNumbers_(body);
  if ((body.match(/\{\{/g) || []).length !== found.length) errors.push('Placeholders must look exactly like {{1}}, {{2}} ...');
  var gaps = numbers.some(function (n, i) { return n !== i + 1; });
  if (gaps) errors.push('Placeholders must be numbered {{1}}, {{2}} ... with no gaps.');
  if (/^\s*\{\{\d+\}\}/.test(body)) errors.push('Body must not start with a placeholder.');
  if (/\{\{\d+\}\}[\s.,!?:;]*$/.test(body)) errors.push('Body must not end with a placeholder.');
  if (/\}\}\s*\{\{/.test(body)) errors.push('Two placeholders must not be next to each other; put words between them.');
  var count = numbers.length, names = t.variable_names || [], samples = t.sample_values || {};
  if (names.length !== count || names.some(function (v) { return !String(v).trim(); }))
    errors.push('Give a label for each of the ' + count + ' placeholders.');
  for (var i = 1; i <= count; i++) {
    var s = String(samples[String(i)] || '').trim();
    if (!s) errors.push('A sample value is required for {{' + i + '}}.');
    else if (s.indexOf('\n') >= 0) errors.push('The sample value for {{' + i + '}} must not contain line breaks.');
  }
  if (t.category === 'UTILITY' && /\b(offer|offers|discount|discounts|sale|sales)\b/i.test(body))
    errors.push('UTILITY templates must not contain promotional words like offer, discount or sale.');
  if (t.category !== 'UTILITY' && t.category !== 'MARKETING') errors.push('Category must be UTILITY or MARKETING.');
  return errors;
}

function nameTaken_(name, language, tbl) {
  return findBy_(tbl || 'Templates', 'name', name).some(function (t) { return t.language === language; });
}

function publicTemplate_(t) { var c = {}; Object.keys(t).forEach(function (k) { if (k !== '_row') c[k] = t[k]; }); return c; }

/** Create the content in Twilio (once) and submit it for approval. On failure the template stays 'draft'. */
function submitToMeta_(templateId, tbl) {
  tbl = tbl || 'Templates';
  var t = findOne_(tbl, 'id', templateId);
  if (!t) throw new ApiError('Template not found', null, 404);
  requireConfig_(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']);
  try {
    var sid = t.twilio_content_sid;
    if (!sid) {
      sid = createContent_(t);
      // Save at once so a retry reuses this content instead of creating another.
      withLock_(function () {
        var fresh = findOne_(tbl, 'id', templateId);
        fresh.twilio_content_sid = sid; fresh.updated_at = nowIso_();
        saveRows_(tbl, [fresh]);
      });
    }
    submitWhatsappApproval_(sid, t.name, t.category);
  } catch (e) {
    throw new ApiError('Saved as draft, but submitting to WhatsApp failed: ' + e.message + '. Use Retry submit.', null, 502);
  }
  return withLock_(function () {
    var fresh = findOne_(tbl, 'id', templateId);
    fresh.status = 'pending_meta'; fresh.rejection_reason = null; fresh.updated_at = nowIso_();
    saveRows_(tbl, [fresh]);
    return publicTemplate_(fresh);
  });
}

function insertTemplate_(user, f, tbl) {
  var id = newId_(), now = nowIso_();
  insertRows_(tbl || 'Templates', [{
    id: id, name: f.name, language: f.language, category: f.category, body: String(f.body).trim(),
    variable_names: f.variable_names, sample_values: f.sample_values, has_confirm_buttons: f.has_confirm_buttons !== false,
    status: 'draft', twilio_content_sid: null, rejection_reason: null, requested_by: user.email,
    decision_seen: true, created_at: now, updated_at: now
  }]);
  return id;
}

function listTemplates_(user, status) {
  var rows = loadTable_('Templates').filter(function (t) { return !status || t.status === status; });
  rows.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  return rows.map(publicTemplate_);
}

function createTemplate_(user, body) {
  if (/^donor_/.test(String(body.name || ''))) throw new ApiError('Names starting with donor_ are reserved for the donor department.');
  var errors = validateName_(body.name, body.language || 'en').concat(validateContent_(body));
  if (errors.length) throw new ApiError(errors[0], errors);
  var id = withLock_(function () {
    if (nameTaken_(body.name, body.language || 'en'))
      throw new ApiError("A template named '" + body.name + "' already exists for this language.", ["A template named '" + body.name + "' already exists for this language."]);
    return insertTemplate_(user, { name: body.name, language: body.language || 'en', category: body.category, body: body.body,
      variable_names: body.variable_names, sample_values: body.sample_values, has_confirm_buttons: body.has_confirm_buttons });
  });
  return submitToMeta_(id);
}

function retrySubmit_(user, id) {
  var t = findOne_('Templates', 'id', id);
  if (!t) throw new ApiError('Template not found', null, 404);
  if (t.status !== 'draft') throw new ApiError('Only draft templates can be submitted.');
  return submitToMeta_(id);
}

/** Submitted templates cannot be edited in WhatsApp, so create a new version (_v2, _v3 ...). */
function resubmitTemplate_(user, id, body) {
  var old = findOne_('Templates', 'id', id);
  if (!old) throw new ApiError('Template not found', null, 404);
  if (old.status !== 'approved' && old.status !== 'rejected') throw new ApiError('Only approved or rejected templates can be resubmitted.');
  var errors = validateContent_(body);
  if (errors.length) throw new ApiError(errors[0], errors);
  var newId = withLock_(function () {
    var base = stripVersion_(old.name), v = 2;
    while (nameTaken_(base + '_v' + v, old.language)) v++;
    return insertTemplate_(user, { name: base + '_v' + v, language: old.language, category: body.category, body: body.body,
      variable_names: body.variable_names, sample_values: body.sample_values, has_confirm_buttons: body.has_confirm_buttons });
  });
  return submitToMeta_(newId);
}

/** Cron + "Check status now": ask Twilio for Meta's decision on every pending template. */
function syncPendingTemplates_(tables) {
  var total = { checked: 0, approved: 0, rejected: 0, waiting: [] };
  (tables || ['Templates']).forEach(function (tbl) {
    var pending = loadTable_(tbl).filter(function (t) { return t.status === 'pending_meta' && t.twilio_content_sid; });
    total.checked += pending.length;
    pending.forEach(function (t) {
      var wa;
      try { wa = fetchWhatsappApproval_(t.twilio_content_sid); }
      catch (e) { console.warn('Checking template ' + t.name + ' failed: ' + e.message); total.waiting.push({ name: t.name, status: 'could not check: ' + e.message }); return; }
      var status = String(wa.status || '').toLowerCase(), update = null;
      if (status === 'approved') { update = { status: 'approved', rejection_reason: null }; total.approved++; }
      else if (status === 'rejected') { update = { status: 'rejected', rejection_reason: wa.rejection_reason || 'Rejected by WhatsApp' }; total.rejected++; }
      else total.waiting.push({ name: t.name, status: status || 'unknown' }); // received (Twilio has it), pending (WhatsApp is reviewing), paused ...
      withLock_(function () {
        var fresh = findOne_(tbl, 'id', t.id);
        if (!fresh || fresh.status !== 'pending_meta') return;
        fresh.meta_status = status || null; fresh.meta_checked_at = nowIso_();
        if (update) { Object.keys(update).forEach(function (k) { fresh[k] = update[k]; }); fresh.decision_seen = false; fresh.updated_at = nowIso_(); }
        saveRows_(tbl, [fresh]);
      });
    });
  });
  return total;
}

function templateNotifications_(user) {
  return loadTable_('Templates')
    .filter(function (t) { return t.requested_by === user.email && t.decision_seen === false; })
    .sort(function (a, b) { return String(b.updated_at).localeCompare(String(a.updated_at)); })
    .map(function (t) { return { id: t.id, name: t.name, language: t.language, status: t.status, rejection_reason: t.rejection_reason }; });
}

function markTemplateSeen_(user, id) {
  withLock_(function () {
    var t = findOne_('Templates', 'id', id);
    if (t) { t.decision_seen = true; saveRows_('Templates', [t]); }
  });
  return { ok: true };
}

/**
 * Import templates that already exist in the Twilio account (created in the console or elsewhere).
 * Only text and quick-reply templates are imported. Labels for the placeholders default to "value 1", "value 2"...
 * Templates already in the app (same Content SID) are left alone; "Check status now" keeps their status current.
 */
function importTwilioTemplates_(user, opts) {
  opts = opts || {};
  var tbl = opts.table || 'Templates';
  requireConfig_(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']);
  var contents;
  try { contents = listContentAndApprovals_(); } catch (e) { throw new ApiError('Could not read templates from Twilio: ' + e.message, null, 502); }
  return withLock_(function () {
    var existing = loadTable_(tbl), bySid = {}, taken = {};
    existing.forEach(function (t) { if (t.twilio_content_sid) bySid[t.twilio_content_sid] = true; taken[t.name + '|' + t.language] = true; });
    var toInsert = [], skipped = [], now = nowIso_();
    contents.forEach(function (c) {
      var ar = c.approval_requests || {}, label = ar.name || c.friendly_name || c.sid;
      if (bySid[c.sid]) { skipped.push({ name: label, reason: 'already in the app' }); return; }
      var types = c.types || {}, kind = types['twilio/text'] ? 'twilio/text' : types['twilio/quick-reply'] ? 'twilio/quick-reply' : null;
      if (!kind || !types[kind].body) { skipped.push({ name: label, reason: 'unsupported type (only text and quick-reply templates are imported)' }); return; }
      var name = String(ar.name || c.friendly_name || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
      var language = c.language || '';
      if (!name) { skipped.push({ name: label, reason: 'no usable name' }); return; }
      // The Twilio account is shared, so names keep the two departments apart: donor templates start with donor_.
      if (tbl === 'DonorTemplates' && !/^donor_/.test(name)) { skipped.push({ name: label, reason: 'not a donor template (donor template names start with donor_)' }); return; }
      if (tbl === 'Templates' && /^donor_/.test(name)) { skipped.push({ name: label, reason: 'belongs to the donor department' }); return; }
      if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(language)) { skipped.push({ name: label, reason: "unsupported language code '" + language + "'" }); return; }
      if (taken[name + '|' + language]) { skipped.push({ name: label, reason: 'a template named ' + name + ' (' + language + ') already exists' }); return; }
      var cat = String(ar.category || 'UTILITY').toUpperCase();
      if (cat === 'TRANSACTIONAL') cat = 'UTILITY';
      if (cat !== 'UTILITY' && cat !== 'MARKETING') { skipped.push({ name: label, reason: 'category ' + cat + ' is not supported' }); return; }
      var st = String(ar.status || 'unsubmitted').toLowerCase(), status;
      if (st === 'approved') status = 'approved';
      else if (st === 'rejected') status = 'rejected';
      else if (st === 'pending' || st === 'received') status = 'pending_meta';
      else if (st === 'unsubmitted') status = 'draft';
      else { skipped.push({ name: label, reason: 'WhatsApp status is ' + st }); return; }

      var body = String(types[kind].body), nums = placeholderNumbers_(body), vars = c.variables || {};
      var names = nums.map(function (n) { return 'value ' + n; }), samples = {};
      nums.forEach(function (n) { samples[String(n)] = String(vars[String(n)] || 'sample'); });
      var ids = (types[kind].actions || []).map(function (a) { return String(a.id || '').toLowerCase(); });
      var confirmButtons = kind === 'twilio/quick-reply' && ids.indexOf('confirm') >= 0 && ids.indexOf('decline') >= 0;
      taken[name + '|' + language] = true;
      toInsert.push({ id: newId_(), name: name, language: language, category: cat, body: body, variable_names: names, sample_values: samples,
        has_confirm_buttons: confirmButtons, status: status, twilio_content_sid: c.sid,
        rejection_reason: status === 'rejected' ? (ar.rejection_reason || 'Rejected by WhatsApp') : null,
        requested_by: user.email, decision_seen: true, created_at: now, updated_at: now, division: tbl === 'DonorTemplates' ? 'donor' : 'parent' });
      if (kind === 'twilio/quick-reply' && !confirmButtons)
        skipped.push({ name: label, reason: 'imported, but its buttons are not Confirm/Decline (ids "confirm" and "decline"), so taps will not be recorded as answers' });
    });
    insertRows_(tbl, toInsert);
    return { imported: toInsert.length, found: contents.length, skipped: skipped };
  });
}

// ===== Twilio.gs =====
var BUILD_Twilio = '20261107-1230'; // build stamp (see Build.gs)
/** All Twilio calls (Messaging, Voice, Content API). Swap this file to change provider. */
var TW_API = 'https://api.twilio.com/2010-04-01/Accounts/';
var TW_CONTENT = 'https://content.twilio.com/v1';

function twAuth_() {
  var c = cfg_();
  return 'Basic ' + Utilities.base64Encode(c.TWILIO_ACCOUNT_SID + ':' + c.TWILIO_AUTH_TOKEN);
}

function twError_(resp) {
  var text = resp.getContentText();
  try { var j = JSON.parse(text); return (j.code ? j.code + ': ' : '') + (j.message || text); }
  catch (e) { return text.slice(0, 200); }
}

/** fetch with back-off on 429 (1s, 2s, 4s). */
function httpRetry_(url, params) {
  params.muteHttpExceptions = true;
  for (var a = 0; a <= 3; a++) {
    var r = UrlFetchApp.fetch(url, params);
    if (r.getResponseCode() === 429 && a < 3) { Utilities.sleep(1000 * Math.pow(2, a)); continue; }
    return r;
  }
}

function twFormRequest_(method, url, form) {
  var p = { method: method, headers: { Authorization: twAuth_() } };
  if (form) p.payload = form;
  var r = httpRetry_(url, p);
  if (r.getResponseCode() >= 400) throw new Error(twError_(r));
  return JSON.parse(r.getContentText());
}

/** True when the Twilio address (PUBLIC_BASE_URL and its secret) is set, so Twilio can call the app back instantly.
 *  Without it the app asks Twilio for news every few minutes (single-address mode). */
function instantUpdates_() { var c = cfg_(); return !!(c.PUBLIC_BASE_URL && c.WEBHOOK_SECRET); }

/** Outbound WhatsApp messages sent since a date, with their current status. Used when there is no Twilio address. */
function listOutboundStatuses_(since) {
  var c = cfg_(), out = [];
  var url = TW_API + c.TWILIO_ACCOUNT_SID + '/Messages.json?PageSize=1000&DateSent%3E=' + Utilities.formatDate(since, 'UTC', 'yyyy-MM-dd') +
    (c.TWILIO_WHATSAPP_FROM ? '&From=' + encodeURIComponent(c.TWILIO_WHATSAPP_FROM) : '');
  for (var page = 0; page < 6 && url; page++) {
    var data = twFormRequest_('get', url);
    (data.messages || []).forEach(function (m) {
      if (String(m.direction || '').indexOf('outbound') !== 0) return;
      out.push({ sid: m.sid, status: m.status, error: m.error_code ? m.error_code + ': ' + (m.error_message || 'WhatsApp could not deliver the message') : '' });
    });
    url = data.next_page_uri ? 'https://api.twilio.com' + data.next_page_uri : null;
  }
  return out;
}

/** Public URL Twilio calls back. Apps Script cannot read headers, so a secret in the URL replaces the signature. */
function webhookUrl_(hook, params) {
  var c = cfg_();
  var q = ['hook=' + encodeURIComponent(hook), 'k=' + encodeURIComponent(c.WEBHOOK_SECRET)];
  Object.keys(params || {}).forEach(function (k) { q.push(k + '=' + encodeURIComponent(params[k])); });
  return c.PUBLIC_BASE_URL + '?' + q.join('&');
}

// ---------- WhatsApp ----------

function whatsappRequest_(phone, contentSid, variables, messageId) {
  var c = cfg_();
  var form = {
    To: 'whatsapp:' + phone,
    ContentSid: contentSid,
    ContentVariables: JSON.stringify(variables),
  };
  if (instantUpdates_()) form.StatusCallback = webhookUrl_('whatsapp_status', { message_id: messageId }); // without the Twilio address, statuses are fetched instead
  if (c.TWILIO_MESSAGING_SERVICE_SID) form.MessagingServiceSid = c.TWILIO_MESSAGING_SERVICE_SID;
  else form.From = c.TWILIO_WHATSAPP_FROM;
  return {
    url: TW_API + c.TWILIO_ACCOUNT_SID + '/Messages.json',
    method: 'post', headers: { Authorization: twAuth_() }, payload: form, muteHttpExceptions: true
  };
}

/** Parse a send response into {sid} or {error, rateLimited}. */
function parseSendResponse_(resp) {
  var code = resp.getResponseCode();
  if (code >= 200 && code < 300) return { sid: JSON.parse(resp.getContentText()).sid };
  return { error: twError_(resp), rateLimited: code === 429 };
}

/** Send many messages in parallel. items: [{phone, contentSid, variables, messageId}] -> results in order. */
function sendWhatsappMany_(items) {
  if (!items.length) return [];
  var reqs = items.map(function (it) { return whatsappRequest_(it.phone, it.contentSid, it.variables, it.messageId); });
  var resps = UrlFetchApp.fetchAll(reqs);
  return resps.map(function (resp, i) {
    var res = parseSendResponse_(resp);
    // Rate limited: retry this one message alone with back-off.
    for (var a = 0; res.rateLimited && a < 3; a++) {
      Utilities.sleep(1000 * Math.pow(2, a));
      res = parseSendResponse_(UrlFetchApp.fetch(reqs[i].url, reqs[i]));
    }
    return res;
  });
}

function fetchWhatsappStatus_(sid) {
  var c = cfg_();
  var m = twFormRequest_('get', TW_API + c.TWILIO_ACCOUNT_SID + '/Messages/' + sid + '.json');
  var error = '';
  if (m.error_code) error = m.error_code + ': ' + (m.error_message || 'WhatsApp could not deliver the message');
  return { status: m.status, error: error };
}

/** Inbound WhatsApp messages since `since`, shaped like the inbound webhook params. */
function listInboundWhatsapp_(since) {
  var c = cfg_();
  var url = TW_API + c.TWILIO_ACCOUNT_SID + '/Messages.json?PageSize=500&To=' + encodeURIComponent(c.TWILIO_WHATSAPP_FROM) +
    '&DateSent%3E=' + Utilities.formatDate(since, 'UTC', 'yyyy-MM-dd');
  var data = twFormRequest_('get', url);
  return (data.messages || []).filter(function (m) {
    return m.direction === 'inbound' && Date.parse(m.date_sent) >= since.getTime();
  }).map(function (m) { return { MessageSid: m.sid, From: m.from || '', Body: m.body || '' }; });
}

// ---------- Voice ----------

function placeCall_(phone, messageId) {
  var c = cfg_();
  var r = twFormRequest_('post', TW_API + c.TWILIO_ACCOUNT_SID + '/Calls.json', {
    To: phone,
    From: c.TWILIO_VOICE_FROM,
    Url: webhookUrl_('voice_twiml', { message_id: messageId }),
    StatusCallback: webhookUrl_('voice_status', { message_id: messageId }),
    StatusCallbackEvent: 'completed',
    Timeout: '25'
  });
  return r.sid;
}

// ---------- Content API (templates) ----------

function contentRequest_(method, path, json) {
  var c = cfg_();
  var p = { method: method, headers: { Authorization: twAuth_() }, contentType: 'application/json' };
  if (json) p.payload = JSON.stringify(json);
  var r = httpRetry_(TW_CONTENT + path, p);
  if (r.getResponseCode() >= 400) throw new Error('Twilio error ' + r.getResponseCode() + ': ' + twError_(r));
  return JSON.parse(r.getContentText());
}

function createContent_(t) {
  var types = t.has_confirm_buttons
    ? { 'twilio/quick-reply': { body: t.body, actions: [{ title: 'Confirm', id: 'confirm' }, { title: "Can't attend", id: 'decline' }] } }
    : { 'twilio/text': { body: t.body } };
  return contentRequest_('post', '/Content', {
    friendly_name: t.name, language: t.language, variables: t.sample_values, types: types
  }).sid;
}

function submitWhatsappApproval_(contentSid, name, category) {
  contentRequest_('post', '/Content/' + contentSid + '/ApprovalRequests/whatsapp', { name: name, category: category });
}

/** Every Content template in the account with its approval status (follows pagination, max 20 pages). */
function listContentAndApprovals_() {
  var out = [], path = '/ContentAndApprovals?PageSize=100';
  for (var i = 0; i < 20 && path; i++) {
    var d = contentRequest_('get', path);
    out = out.concat(d.contents || []);
    var next = d.meta && d.meta.next_page_url;
    path = next ? String(next).replace(/^https:\/\/content\.twilio\.com\/v1/, '') : null;
  }
  return out;
}

function fetchWhatsappApproval_(contentSid) {
  var d = contentRequest_('get', '/Content/' + contentSid + '/ApprovalRequests');
  return d.whatsapp || {};
}

// ===== VoiceScripts.gs =====
var BUILD_VoiceScripts = '20261107-1230'; // build stamp (see Build.gs)
/** IVR call scripts per parent language. {details} = campaign values in order. */
var VOICE_SCRIPTS = {
  en: {
    voice: 'Google.en-IN-Standard-A', language: 'en-IN',
    prompt: "Hello, this is a message from your child's school about {details}. Press 1 to confirm. Press 2 if you cannot attend.",
    invalid: 'Sorry, that is not a valid choice.',
    confirmed: 'Thank you. Your attendance is confirmed. Goodbye.',
    declined: 'Thank you. We have noted that you cannot attend. Goodbye.',
    goodbye: 'We did not receive your response. Goodbye.'
  },
  hi: {
    voice: 'Google.hi-IN-Standard-A', language: 'hi-IN',
    prompt: 'नमस्ते, यह आपके बच्चे के स्कूल से संदेश है: {details}. पुष्टि करने के लिए 1 दबाएँ। अगर आप नहीं आ सकते, तो 2 दबाएँ।',
    invalid: 'माफ़ कीजिए, यह सही विकल्प नहीं है।',
    confirmed: 'धन्यवाद। आपकी उपस्थिति की पुष्टि हो गई है।',
    declined: 'धन्यवाद। हमने नोट कर लिया है कि आप नहीं आ पाएँगे।',
    goodbye: 'हमें आपका जवाब नहीं मिला। धन्यवाद।'
  },
  ta: {
    voice: 'Google.ta-IN-Standard-C', language: 'ta-IN',
    prompt: 'வணக்கம், இது உங்கள் குழந்தையின் பள்ளியிலிருந்து வரும் செய்தி: {details}. உறுதிப்படுத்த 1 ஐ அழுத்தவும். வர முடியாவிட்டால் 2 ஐ அழுத்தவும்.',
    invalid: 'மன்னிக்கவும், அது சரியான தேர்வு அல்ல.',
    confirmed: 'நன்றி. உங்கள் வருகை உறுதிசெய்யப்பட்டது.',
    declined: 'நன்றி. நீங்கள் வர முடியாது என்பதை குறித்துக்கொண்டோம்.',
    goodbye: 'உங்கள் பதில் கிடைக்கவில்லை. நன்றி.'
  }
};

function getVoiceScript_(language) { return VOICE_SCRIPTS[language] || VOICE_SCRIPTS.en; }

// ===== Webhooks.gs =====
var BUILD_Webhooks = '20261107-1230'; // build stamp (see Build.gs)
/**
 * Twilio webhooks. Apps Script cannot read request headers, so Twilio's X-Twilio-Signature cannot be
 * checked. Instead every URL we give Twilio carries a secret (?k=WEBHOOK_SECRET) that is verified here.
 * Each webhook: check secret, log the payload, apply it. If the lock is busy the event stays unprocessed
 * and the cron tick replays it, so nothing is lost.
 */
var CALL_ENDED = ['completed', 'busy', 'no-answer', 'failed', 'canceled'];
var RESERVED_PARAMS = ['hook', 'k', 'message_id', 'attempt'];

function safeEqual_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function textOut_(s) { return ContentService.createTextOutput(s || ''); }

function twiml_(inner) {
  return ContentService.createTextOutput('<?xml version="1.0" encoding="UTF-8"?><Response>' + inner + '</Response>')
    .setMimeType(ContentService.MimeType.XML);
}

function xmlEsc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function say_(script, text) {
  return '<Say voice="' + xmlEsc_(script.voice) + '" language="' + xmlEsc_(script.language) + '">' + xmlEsc_(text) + '</Say>';
}

/** Apply one logged event (inside the lock). Used by webhooks and by the cron replay. */
function applyEvent_(source, params, messageId, eventId) {
  if (source === 'whatsapp_status') {
    if (!messageId) return;
    var ns = WHATSAPP_STATUS_MAP[params.MessageStatus || ''];
    if (!ns) return; // queued, sending, accepted ...
    var extra = {};
    if (ns === 'failed') extra.wa_error = (params.ErrorCode || '') + ': ' + (params.ChannelStatusMessage || 'WhatsApp could not deliver the message');
    if (isDonorId_(messageId)) applyDonorStatus_(messageId, ns, extra);
    else if (!applyStatus_(messageId, ns, extra) && donorReady_()) applyDonorStatus_(messageId, ns, extra);   // older donor messages have plain ids
  } else if (source === 'whatsapp_inbound') {
    handleInbound_(params, eventId);
  } else if (source === 'voice_gather') {
    if (!messageId) return;
    var digit = params.Digits || '';
    updateMessage_(messageId, { call_digit: digit });
    if (digit === '1') applyStatus_(messageId, 'confirmed', { confirmed_via: 'voice' });
    else if (digit === '2') applyStatus_(messageId, 'declined', { confirmed_via: 'voice' });
  } else if (source === 'voice_status') {
    if (!messageId) return;
    var f = { call_status: params.CallStatus || '' };
    if (params.CallSid) f.call_sid = params.CallSid;
    updateMessage_(messageId, f);
    // Ended without a 1 or 2: flag for personal follow-up (never overwrites confirmed/declined).
    if (CALL_ENDED.indexOf(params.CallStatus) >= 0) applyStatus_(messageId, 'flagged', {});
  }
}

/** Try to apply an event now; if the lock is busy, leave it for the cron replay. */
function processEvent_(eventId, source, params, messageId) {
  try {
    withLock_(function () {
      if (isEventProcessed_(eventId)) return;
      applyEvent_(source, params, messageId, eventId);
      markEventProcessed_(eventId);
    }, 20000);
    return true;
  } catch (e) {
    console.warn('Event ' + eventId + ' left for the cron replay: ' + e.message);
    return false;
  }
}

function loadCallContext_(messageId) {
  var m = messageId ? findOne_('Messages', 'id', messageId) : null;
  if (!m) return { script: getVoiceScript_('en'), details: '' };
  var parent = findOne_('Parents', 'id', m.parent_id), camp = findOne_('Campaigns', 'id', m.campaign_id);
  var vars = (camp && camp.variables) || {};
  var details = Object.keys(vars).sort(function (a, b) { return Number(a) - Number(b); }).map(function (k) { return vars[k]; }).join(', ');
  return { script: getVoiceScript_(parent ? parent.language : 'en'), details: details };
}

function gatherTwiml_(messageId, script, details, attempt, prefix) {
  var action = webhookUrl_('voice_gather', { message_id: messageId, attempt: attempt });
  var prompt = (prefix ? prefix + ' ' : '') + script.prompt.replace('{details}', details);
  return twiml_('<Gather input="dtmf" numDigits="1" timeout="8" action="' + xmlEsc_(action) + '" method="POST">' +
    say_(script, prompt) + '</Gather>' + say_(script, script.goodbye));
}

function handleHook_(e) {
  var p = e.parameter || {}, c = cfg_();
  if (p.hook === 'ping') { var br = buildReport_(); return textOut_('webhook ok, build ' + (br.newest || '?') + (br.problems.length ? ', PROBLEM: ' + br.problems.join('; ') : '') + '. (This check answers on both of your addresses; it only proves the code is running.)'); } // health check: no secret, no data
  if (!c.WEBHOOK_SECRET || !safeEqual_(p.k || '', c.WEBHOOK_SECRET)) return textOut_('Forbidden');
  var hook = p.hook, messageId = p.message_id || null;
  var params = {};
  Object.keys(p).forEach(function (k) { if (RESERVED_PARAMS.indexOf(k) < 0) params[k] = String(p[k]); });

  if (hook === 'cron') return textOut_(JSON.stringify(tick_())).setMimeType(ContentService.MimeType.JSON);

  if (hook === 'whatsapp_status') {
    if (!messageId && params.MessageSid) {
      var m = findOne_('Messages', 'wa_sid', params.MessageSid);
      if (!m && donorReady_()) m = findOne_('DonorMessages', 'wa_sid', params.MessageSid);
      messageId = m ? m.id : null;
    }
    var id1 = logEvent_(messageId, 'whatsapp_status', params, divisionOfMessageId_(messageId));
    processEvent_(id1, 'whatsapp_status', params, messageId);
    return textOut_('');
  }
  if (hook === 'whatsapp_inbound') {
    var id2 = logEvent_(null, 'whatsapp_inbound', params, divisionOfPhone_(phoneOf_(params)));
    processEvent_(id2, 'whatsapp_inbound', params, null);
    return twiml_(''); // empty TwiML: never auto-reply with free text
  }
  if (hook === 'voice_twiml') {
    var ctx = loadCallContext_(messageId);
    return gatherTwiml_(messageId, ctx.script, ctx.details, 1, '');
  }
  if (hook === 'voice_gather') {
    var attempt = Number(p.attempt) || 1, digit = params.Digits || '';
    var id3 = logEvent_(messageId, 'voice_gather', params);
    processEvent_(id3, 'voice_gather', params, messageId);
    var cx = loadCallContext_(messageId);
    if (digit === '1') return twiml_(say_(cx.script, cx.script.confirmed));
    if (digit === '2') return twiml_(say_(cx.script, cx.script.declined));
    // Wrong key: replay once, then leave it to the status callback (-> flagged).
    if (attempt < 2) return gatherTwiml_(messageId, cx.script, cx.details, 2, cx.script.invalid);
    return twiml_(say_(cx.script, cx.script.goodbye));
  }
  if (hook === 'voice_status') {
    var id4 = logEvent_(messageId, 'voice_status', params);
    processEvent_(id4, 'voice_status', params, messageId);
    return textOut_('');
  }
  return textOut_('Unknown hook');
}

