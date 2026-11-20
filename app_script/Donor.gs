// ========================================================================================================
// EK TARA COMMUNICATIONS: SERVER CODE, DONOR (Donor.gs)
// Donor Communication: contacts, donations, campaigns, templates, broadcasts, queue, sending rules.
// The project needs all four server files: Shared.gs, Parent.gs, Donor.gs, Admin.gs (any order).
// If you see "Identifier 'ApiError' has already been declared", an old Code.gs is still in the project: delete it.
// ========================================================================================================
// ===== DonorApi.gs =====
var BUILD_DonorApi = '20261107-1230'; // build stamp (see Build.gs)
/** API methods of the Donor workspace. Every name starts with "donor." so the permission service requires donor access. */
function donorOverview_() {
  var donors = loadTable_('Donors'), seg = {}, optedIn = 0;
  SEGMENT_CODES.forEach(function (s) { seg[s] = 0; });
  donors.forEach(function (d) {
    seg[d.segment] = (seg[d.segment] || 0) + 1;
    if (d.whatsapp_opt_in && !d.opted_out) optedIn++;
  });
  var q = { queued: 0, held: 0, awaiting_confirmation: 0, failed: 0, sent_7d: 0 }, weekAgo = Date.now() - 7 * 86400000;
  loadTable_('DonorMessages').forEach(function (m) {
    if (q[m.status] !== undefined) q[m.status]++;
    if (m.wa_sent_at && Date.parse(m.wa_sent_at) >= weekAgo) q.sent_7d++;
  });
  var tpls = loadTable_('DonorTemplates').filter(function (t) { return t.status === 'approved' && !t.archived_at; });
  var haveType = {}; tpls.forEach(function (t) { haveType[t.message_type] = true; });
  return {
    ready: true, total: donors.length, opted_in: optedIn, segments: seg, queue: q,
    drafts: loadTable_('DonorBroadcasts').filter(function (b) { return b.status === 'draft'; })
      .map(function (b) { return { id: b.id, name: b.name, trigger: b.trigger, send_on: b.send_on }; }),
    missing_templates: Object.keys(MESSAGE_TYPES).filter(function (t) { return !haveType[t]; }).map(function (t) { return MESSAGE_TYPES[t]; })
  };
}

function donorMeta_() {
  return { segments: SEGMENTS, message_types: MESSAGE_TYPES, auto_labels: AUTO_LABELS, kinds: { general_update: 'General update (T8)', special_update: 'Special update (T11)',
    festive_greeting: 'Festive greeting (T12)' }, manual_modes: MANUAL_MODES };
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
  'donor.home': function (u) {
    if (!donorReady_()) return { ready: false, message: 'The donor workspace needs a one-time setup.', problem: donorSetupProblem_(), build_problem: buildProblems_(), can_setup: !!u.owner, planned: [] };
    var layout = donorLayoutProblems_();   // columns are read by position: nothing is read or saved until they are in order
    if (layout.length) return { ready: false, layout: true, message: 'The donor Google Sheet’s columns are not in the order the app expects.', problem: layout.join(' '), expected: donorExpectedColumns_(), planned: [] };
    return Object.assign(donorOverview_(), { is_owner: !!u.owner });
  },
  'donor.meta': function (u) { return donorMeta_(); },
  'donor.tags': function (u) { return donorTags_(); },
  'donor.donors.list': function (u, f) { return listDonors_(u, f); },
  'donor.donors.get': function (u, id) { return donorDetail_(u, id); },
  'donor.donors.save': function (u, id, body) { var r = saveDonor_(u, id, body); runDonorTriggers_(); return r; },
  'donor.donors.import': function (u, csv) { var r = importDonors_(u, csv); runDonorTriggers_(); return r; },
  'donor.donors.setOptIn': function (u, id, v) { return setOptIn_(u, id, v); },
  'donor.donors.setOptedOut': function (u, id, v) { return setOptedOut_(u, id, v); },
  'donor.donors.changeSegment': function (u, id, to, reason) { var r = changeSegment_(u, id, to, reason); runDonorTriggers_(); return r; },
  'donor.donors.setActive': function (u, id, on) { return setContactActive_(u, id, !!on); },
  'donor.donors.logContact': function (u, id, body) { return logContact_(u, id, body); },
  'donor.donors.deleteLog': function (u, msgId) { return deleteContactLog_(u, msgId); },
  'donor.donations.record': function (u, id, body) { return recordDonation_(u, id, body); },
  'donor.donations.update': function (u, id, body) { return updateDonation_(u, id, body); },
  'donor.donations.delete': function (u, id) { return deleteDonation_(u, id); },
  'donor.campaigns.list': function (u) { return listDonorCampaigns_(); },
  'donor.campaigns.save': function (u, id, body) { var r = saveDonorCampaign_(u, id, body); runDonorTriggers_(); return r; },
  'donor.campaigns.resultsReady': function (u, id) { return markResultsReady_(u, id); },
  'donor.campaigns.archive': function (u, id) { return setDonorArchived_(u, 'DonorCampaigns', id, true); },
  'donor.campaigns.restore': function (u, id) { return setDonorArchived_(u, 'DonorCampaigns', id, false); },
  'donor.campaigns.delete': function (u, id) { return deleteDonorCampaign_(u, id); },
  'donor.templates.list': function (u) { return listDonorTemplates_(); },
  'donor.templates.create': function (u, body) { return createDonorTemplate_(u, body); },
  'donor.templates.update': function (u, id, body) { return updateDonorTemplate_(u, id, body); },
  'donor.templates.retrySubmit': function (u, id) { return retryDonorTemplate_(u, id); },
  'donor.templates.sync': function (u) { return syncPendingTemplates_(['DonorTemplates']); },
  'donor.templates.import': function (u) { return importDonorTemplates_(u); },
  'donor.templates.archive': function (u, id) { return setDonorArchived_(u, 'DonorTemplates', id, true); },
  'donor.templates.restore': function (u, id) { return setDonorArchived_(u, 'DonorTemplates', id, false); },
  'donor.templates.delete': function (u, id) { return deleteDonorTemplate_(u, id); },
  'donor.broadcasts.list': function (u) { return listBroadcasts_(); },
  'donor.broadcasts.save': function (u, id, body) { return saveBroadcast_(u, id, body); },
  'donor.broadcasts.preview': function (u, id) { return previewBroadcast_(u, id); },
  'donor.broadcasts.previewDraft': function (u, body) { return previewDraftBroadcast_(u, body); },   // preview without saving
  'donor.broadcasts.approve': function (u, id, opts) { return approveBroadcast_(u, id, opts); },
  'donor.broadcasts.cancel': function (u, id) { return cancelBroadcast_(u, id); },
  'donor.broadcasts.delete': function (u, id) { return deleteDraftBroadcast_(u, id); },
  'donor.broadcasts.archive': function (u, id) { return setDonorArchived_(u, 'DonorBroadcasts', id, true); },
  'donor.broadcasts.restore': function (u, id) { return setDonorArchived_(u, 'DonorBroadcasts', id, false); },
  'donor.messages.list': function (u, f) { return listDonorMessages_(u, f); },
  'donor.messages.cancel': function (u, id) { return cancelDonorMessage_(u, id); },
  'donor.messages.retry': function (u, id) { return retryDonorMessage_(u, id); },
  /** The screen calls this repeatedly after an approval or donation; the 10-minute cron does the same. */
  'donor.dispatch': function (u) {
    runDonorTriggers_();
    var r = dispatchDonorBatch_(40000);
    if (!r.remaining && r.email_waiting) {   // emails go only from the owner's account
      var k = kickOwnerDonorDispatch_();
      if (k === 'background') r.email_by = 'background';
      else { r.email_sent = k.sent; r.email_waiting = k.email_waiting; r.email_by = 'owner'; }
    }
    r.owner = ownerEmail_();
    return r;
  }
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

// ---------- tags ----------
/** A broadcast's tag filter uses this for "donors with no tag". */
var NO_TAG = '__untagged__';
var MAX_TAGS = 20, MAX_TAG_LENGTH = 40;

/** Tags from the form (an array) or a CSV cell ("csr; education" or "csr, education"): trimmed, without duplicates (case does not matter). */
function cleanTags_(v, allowNoTag) {
  var list = Array.isArray(v) ? v : String(v === null || v === undefined ? '' : v).split(/[;,]/), seen = {}, out = [];
  list.forEach(function (t) {
    t = String(t === null || t === undefined ? '' : t).replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH);
    var k = t.toLowerCase();
    if (!t || seen[k] || (t === NO_TAG && !allowNoTag)) return;
    seen[k] = true; out.push(t);
  });
  return out.slice(0, allowNoTag ? 500 : MAX_TAGS);
}

/** A contact is active unless its contact_status says INACTIVE (blank counts as active, so older rows stay active). */
function isActive_(d) { return String((d && d.contact_status) || 'ACTIVE').toUpperCase() !== 'INACTIVE'; }

/** ACTIVE / INACTIVE from a CSV cell: true / false, null when blank, undefined when not understood. */
function parseActive_(raw) {
  var v = String(raw === null || raw === undefined ? '' : raw).trim().toLowerCase();
  if (!v) return null;
  if (['active', 'yes', 'y', 'true', '1'].indexOf(v) >= 0) return true;
  if (['inactive', 'no', 'n', 'false', '0', 'deactivated'].indexOf(v) >= 0) return false;
  return undefined;
}

/** Can get WhatsApp: opted in, has not replied STOP, and has a phone number. */
function waReady_(d) { return !!(d && d.whatsapp_opt_in && !d.opted_out && d.phone_e164); }

function donorTagList_(d) { return Array.isArray(d && d.tags) ? d.tags : []; }

/** Every tag in use, per segment, with how many donors carry it; also how many donors in each segment have no tag. */
function donorTags_() {
  var segs = {}, names = {};
  loadTable_('Donors').forEach(function (d) {
    if (!isActive_(d)) return;   // inactive contacts get no broadcasts
    var s = segs[d.segment] || (segs[d.segment] = { tags: {}, untagged: 0 }), t = donorTagList_(d);
    if (!t.length) s.untagged++;
    t.forEach(function (x) { var k = String(x).toLowerCase(); names[k] = names[k] || String(x); s.tags[names[k]] = (s.tags[names[k]] || 0) + 1; });
  });
  return { segments: segs, all: Object.keys(names).map(function (k) { return names[k]; }).sort(function (a, b) { return a.localeCompare(b); }), no_tag: NO_TAG };
}

// ---------- validating one donor ----------
function cleanDonor_(f) {
  var name = strOrNull_(f.name);
  if (!name) return { error: 'name is empty' };
  var phoneRaw = strOrNull_(f.phone), phone = null;   // optional: a contact may be reachable by email only
  if (phoneRaw) { phone = normalizePhone_(phoneRaw); if (!phone) return { error: "invalid phone number '" + phoneRaw + "'" }; }
  var seg = String(f.segment || '').trim().toUpperCase();
  if (SEGMENT_CODES.indexOf(seg) < 0) return { error: "segment must be one of " + SEGMENT_CODES.join(', ') + ", got '" + (f.segment || '') + "'" };
  var email = strOrNull_(f.email);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "invalid email '" + email + "'" };
  var ownerEmail = strOrNull_(f.owner_email);
  if (ownerEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail)) return { error: "invalid owner_email '" + ownerEmail + "'" };
  var dates = {};
  var bad = null;
  ['last_donation_date'].forEach(function (k) {
    if (strOrNull_(f[k]) === null) { dates[k] = null; return; }
    var d = parseDateInput_(f[k]);
    if (!d) bad = k + " is not a valid date ('" + f[k] + "')"; else dates[k] = d;
  });
  if (bad) return { error: bad };
  return { row: {
    name: name, contact_type: strOrNull_(f.contact_type), phone_e164: phone, email: email, city: strOrNull_(f.city),
    language: (strOrNull_(f.language) || 'en').toLowerCase(), segment: seg, source_note: strOrNull_(f.source_note),
    status: strOrNull_(f.status), project: strOrNull_(f.project), core_programme: strOrNull_(f.core_programme),
    owner_name: strOrNull_(f.owner_name), owner_email: ownerEmail,
    last_donation_date: dates.last_donation_date, notes: strOrNull_(f.notes),
    org: strOrNull_(f.org), reference: strOrNull_(f.reference),
    tags: (function (t) { return t.length ? t : null; })(cleanTags_(f.tags))
  } };
}

// ---------- CSV import ----------
var DONOR_CSV_ALIASES = {
  name: ['name', 'donor_name', 'donor'], phone: ['phone', 'contact_number', 'contact', 'mobile', 'phone_number', 'whatsapp'],
  email: ['email'], segment: ['segment'], contact_type: ['contact_type', 'type', 'donor_type'], city: ['city'], language: ['language'],
  source_note: ['source_note', 'source', 'how_they_came_to_us'], status: ['status', 'donor_status'], project: ['project'],
  core_programme: ['core_programme', 'programme', 'core_program'],
  owner_name: ['owner_name', 'owner'], owner_email: ['owner_email'],
  last_donation_date: ['last_donation_date'], notes: ['notes', 'note'], whatsapp_opt_in: ['whatsapp_opt_in', 'whatsapp_opt-in', 'opt_in', 'optin'],
  org: ['org', 'organisation', 'organization', 'company'], reference: ['reference', 'referred_by', 'referral'],
  email_opt_in: ['email_opt_in', 'email_opt-in', 'email_optin'], tags: ['tags', 'tag', 'labels'],
  contact_status: ['contact_status', 'contact_active', 'active']
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
  var missing = ['name', 'segment'].filter(function (c) { return idx[c] === undefined; });
  if (missing.length) throw new ApiError('Missing columns: ' + missing.join(', ') + '. Each row needs a name and a segment (P0 testing, P1 to P5, D1, D2); the phone is optional.');
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
    var emailOptIn = parseYesNo_(rec.email_opt_in);
    if (emailOptIn === undefined) { rejected.push({ row: rowNumber, phone: rec.phone || null, reason: "email_opt_in must be yes/no, got '" + rec.email_opt_in + "'" }); continue; }
    var active = parseActive_(rec.contact_status);
    if (active === undefined) { rejected.push({ row: rowNumber, phone: rec.phone || null, reason: "contact_status must be active or inactive, got '" + rec.contact_status + "'" }); continue; }
    // a contact is matched by phone, or by email when it has no phone
    var key = res.row.phone_e164 || (res.row.email ? 'email:' + res.row.email.toLowerCase() : null);
    if (key && seen[key]) { rejected.push({ row: rowNumber, phone: rec.phone || null, reason: 'duplicate ' + (res.row.phone_e164 ? 'phone' : 'email') + ', already in row ' + seen[key] }); continue; }
    if (key) seen[key] = rowNumber;
    rows.push({ data: res.row, optIn: optIn, emailOptIn: emailOptIn, active: active, rowNumber: rowNumber, phone: rec.phone || null });
  }
  return withLock_(function () {
    var byPhone = {}, byEmail = {};
    loadTable_('Donors').forEach(function (d) { if (d.phone_e164) byPhone[d.phone_e164] = d; if (d.email) byEmail[String(d.email).toLowerCase()] = byEmail[String(d.email).toLowerCase()] || d; });
    var msgs = loadTable_('DonorMessages'), upd = [], ins = [], hist = [], msgsChanged = [], now = nowIso_();
    rows.forEach(function (r) {
      var old = r.data.phone_e164 ? byPhone[r.data.phone_e164] : (r.data.email ? byEmail[r.data.email.toLowerCase()] : null);
      if (r.emailOptIn === true && !r.data.email && !(old && old.email)) { rejected.push({ row: r.rowNumber, phone: r.phone, reason: 'email_opt_in is yes but there is no email address' }); return; }
      if (r.optIn === true && !r.data.phone_e164 && !(old && old.phone_e164)) { rejected.push({ row: r.rowNumber, phone: r.phone, reason: 'whatsapp_opt_in is yes but there is no phone number' }); return; }
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
        if (r.emailOptIn !== null) setEmailOptIn_(old, r.emailOptIn, 'csv import');
        if (r.active !== null) old.contact_status = r.active ? 'ACTIVE' : 'INACTIVE';
        old.updated_at = now; upd.push(old);
      } else {
        var d = r.data; d.id = newId_(); d.whatsapp_opt_in = r.optIn === true; d.opt_in_at = r.optIn === true ? now : null;
        d.opt_in_source = r.optIn === true ? 'csv import' : null; d.opted_out = false;
        d.email_opt_in = false; if (r.emailOptIn === true) setEmailOptIn_(d, true, 'csv import');
        d.contact_status = r.active === false ? 'INACTIVE' : 'ACTIVE';
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
    if (f.email_optin === 'yes' && !d.email_opt_in) return false;
    if (f.email_optin === 'no' && d.email_opt_in) return false;
    if (q && (d.name + ' ' + (d.phone_e164 || '') + ' ' + (d.email || '') + ' ' + (d.city || '') + ' ' + (d.org || '') + ' ' + donorTagList_(d).join(' ')).toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); }).map(cleanDonorRow_);
}

/** Email opt-in in memory (the caller saves). Records when and how it changed; does nothing if the value is the same. */
function setEmailOptIn_(d, on, source) {
  on = !!on;
  if (!!d.email_opt_in === on && d.email_opt_in_at) return;
  d.email_opt_in = on; d.email_opt_in_at = nowIso_(); d.email_opt_in_source = source;
}

/** WhatsApp opt-in from the donor form. Switching it on also clears an earlier STOP (the team has a fresh opt-in); off just removes the opt-in. */
function setWhatsAppOptIn_(d, on, source) {
  if (on) { d.whatsapp_opt_in = true; d.opted_out = false; d.opt_in_at = nowIso_(); d.opt_in_source = source; }
  else { d.whatsapp_opt_in = false; d.opt_in_source = source.replace(/^(recorded|changed)/, 'removed'); }
}

function saveDonor_(user, id, body) {
  var res = cleanDonor_(body);
  if (res.error) throw new ApiError(res.error);
  var emailOptIn = body.email_opt_in === undefined ? undefined : !!body.email_opt_in;
  if (emailOptIn && !res.row.email) throw new ApiError('Add an email address to record email opt-in.');
  var waOptIn = body.whatsapp_opt_in === undefined ? undefined : !!body.whatsapp_opt_in;
  if (waOptIn && !res.row.phone_e164) throw new ApiError('Add a phone number to record WhatsApp opt-in.');
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
      if (emailOptIn !== undefined && emailOptIn !== !!donor.email_opt_in) setEmailOptIn_(donor, emailOptIn, 'changed by ' + user.email);
      if (waOptIn !== undefined && waOptIn !== (!!donor.whatsapp_opt_in && !donor.opted_out)) setWhatsAppOptIn_(donor, waOptIn, 'recorded by ' + user.email);
      donor.updated_at = now;
      saveRows_('Donors', [donor]);
    } else {
      donor = res.row; donor.id = newId_(); donor.whatsapp_opt_in = false; donor.opted_out = false; donor.contact_status = 'ACTIVE';
      donor.email_opt_in = false; if (emailOptIn) setEmailOptIn_(donor, true, 'recorded by ' + user.email);
      if (waOptIn) setWhatsAppOptIn_(donor, true, 'recorded by ' + user.email);
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

/** Deactivate (or reactivate) a contact. Nothing is deleted: an inactive contact keeps its history but gets no messages; its waiting ones are cancelled. */
function setContactActive_(user, id, active) {
  return withLock_(function () {
    var d = findOne_('Donors', 'id', id);
    if (!d) throw new ApiError('Contact not found', null, 404);
    d.contact_status = active ? 'ACTIVE' : 'INACTIVE'; d.updated_at = nowIso_();
    saveRows_('Donors', [d]);
    var cancelled = 0;
    if (!active) {
      var open = findBy_('DonorMessages', 'donor_id', id).filter(function (m) { return DONOR_STATUS_OPEN.indexOf(m.status) >= 0; });
      open.forEach(function (m) { m.status = 'cancelled'; m.hold_reason = 'Contact deactivated by ' + user.email; m.updated_at = nowIso_(); });
      saveRows_('DonorMessages', open); cancelled = open.length;
    }
    return { donor: cleanDonorRow_(d), cancelled: cancelled };
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
  var allMsgs = findBy_('DonorMessages', 'donor_id', id).filter(function (m) { return m.status; });   // a row without a status is a cleared leftover
  var messages = allMsgs.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); }).slice(0, 10).map(function (m) {
    var c = cleanDonorRow_(m); c.template_name = m.template_id && tpls[m.template_id] ? tpls[m.template_id].name : null; return c;
  });
  return { donor: cleanDonorRow_(d), history: history, donations: donations, messages: messages, message_count: allMsgs.length };   // newest 10 + the total
}

// ---------- manual log: calls and conversations the team had with a contact ----------
/**
 * Kept in DonorMessages with channel 'manual' and status 'logged', so the contact's Messages list shows them with everything else.
 * The sender never picks them up (it only takes queued and held messages) and the Queue page leaves them out.
 * They do move the contact's "last communicated" time.
 * created_at = when the conversation happened; ref = how; variables = { note, by }.
 */
var MANUAL_MODES = { call: 'Phone call', meeting: 'In-person meeting', whatsapp_chat: 'WhatsApp chat', email: 'Email', other: 'Other' };
var MAX_LOG_NOTE = 2000;

/** The latest communication of a contact: a message that went out, or a logged conversation. Sets last_message_* in memory. */
function recomputeLastContact_(d, msgs) {
  var best = null, at = '';
  msgs.forEach(function (m) {
    if (m.donor_id !== d.id) return;
    var t = m.channel === 'manual' ? (m.status === 'logged' ? m.created_at : '') : m.wa_sent_at;
    if (t && String(t) > at) { at = String(t); best = m; }
  });
  d.last_message_at = best ? at : null;
  d.last_message_type = best ? (best.channel === 'manual' ? MANUAL_MODES[best.ref] || 'Logged conversation' : best.message_type) : null;
}

function logContact_(user, id, body) {
  body = body || {};
  var mode = String(body.mode || '');
  if (!MANUAL_MODES[mode]) throw new ApiError('Choose how you were in touch.');
  var when = Date.parse(body.at || '');
  if (!isFinite(when)) throw new ApiError('Enter when it happened.');
  if (when > Date.now() + 5 * 60000) throw new ApiError('The time cannot be in the future.');
  var note = String(body.note || '').trim().slice(0, MAX_LOG_NOTE);
  return withLock_(function () {
    var d = findOne_('Donors', 'id', id);
    if (!d) throw new ApiError('Contact not found', null, 404);
    var at = new Date(when).toISOString(), now = nowIso_();
    var m = newDonorMessage_({ donor_id: id, channel: 'manual', message_type: 'manual_log', ref: mode, status: 'logged', expires_at: null,
      variables: { note: note, by: user.email }, created_at: at, updated_at: now });
    insertRows_('DonorMessages', [m]);
    if (!d.last_message_at || at > String(d.last_message_at)) {
      d.last_message_at = at; d.last_message_type = MANUAL_MODES[mode]; d.updated_at = now;
      saveRows_('Donors', [d]);
    }
    return cleanDonorRow_(m);
  });
}

function deleteContactLog_(user, msgId) {
  return withLock_(function () {
    var m = findOne_('DonorMessages', 'id', msgId);
    if (!m || m.channel !== 'manual') throw new ApiError('Only logged conversations can be deleted.', null, 404);
    deleteRow_('DonorMessages', m);
    var d = findOne_('Donors', 'id', m.donor_id);
    if (d) { recomputeLastContact_(d, findBy_('DonorMessages', 'donor_id', d.id)); d.updated_at = nowIso_(); saveRows_('Donors', [d]); }
    return { deleted: 1 };
  });
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
    d.updated_at = now; saveRows_('Donors', [d]);   // no automatic thank-you and no segment change (T2 / T3 removed)
    return { donation: cleanDonorRow_(don), segment: d.segment, moved: false };
  });
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

// ---------- donor campaigns ----------
function saveDonorCampaign_(user, id, body) {
  var name = strOrNull_(body.name);
  if (!name) throw new ApiError('Give the campaign a name.');
  var dates = {};
  ['start_date', 'end_date'].forEach(function (k) {
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
    c.name = name; c.start_date = dates.start_date; c.end_date = dates.end_date;
    c.progress_text = strOrNull_(body.progress_text); c.results_text = strOrNull_(body.results_text); c.notes = strOrNull_(body.notes);
    c.status = status === 'results_ready' && !c.results_ready_at ? 'closed' : status; // results_ready is set only by markResultsReady_
    if (id) saveRows_('DonorCampaigns', [c]); else insertRows_('DonorCampaigns', [c]);
    return cleanDonorRow_(c);
  });
}

/** The team says results are ready: the results text then fills the campaign_result placeholder of a broadcast linked to the campaign. */
function markResultsReady_(user, id) {
  var out = withLock_(function () {
    var c = findOne_('DonorCampaigns', 'id', id);
    if (!c) throw new ApiError('Campaign not found', null, 404);
    if (!strOrNull_(c.results_text)) throw new ApiError('Add the results text first. It is what donors will be told.');
    c.status = 'results_ready'; c.results_ready_at = nowIso_();
    saveRows_('DonorCampaigns', [c]);
    return cleanDonorRow_(c);
  });
  return out;
}

function listDonorCampaigns_() {
  var donations = loadTable_('Donations'), total = {}, donors = {};
  donations.forEach(function (x) {
    if (!x.campaign_id) return;
    total[x.campaign_id] = (total[x.campaign_id] || 0) + (Number(x.amount) || 0);
    (donors[x.campaign_id] = donors[x.campaign_id] || {})[x.donor_id] = true;
  });
  var use = donorUsage_([], loadTable_('DonorBroadcasts'), donations);   // donations and broadcasts per campaign
  return loadTable_('DonorCampaigns').sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); }).map(function (c) {
    var o = cleanDonorRow_(c); o.donor_count = Object.keys(donors[c.id] || {}).length; o.total_raised = total[c.id] || 0;
    o.delete_block = campaignDeleteBlock_(c, use); o.can_delete = !o.delete_block;
    if (!o.status) o.status = 'planned';   // a blank status cell (e.g. typed into the sheet by hand) counts as planned
    return o;
  });
}

// ---------- donor templates (reuse the Templates sheet with division = donor) ----------
function validateDonorTemplateMeta_(b) {
  var errors = [];
  if (!MESSAGE_TYPES[b.message_type]) errors.push('Choose a message type.');
  if (b.source_code && b.source_code !== 'ALL' && ['P1', 'P2', 'P3'].indexOf(b.source_code) < 0) errors.push('Source must be P1, P2, P3 or empty.');
  return errors;
}

// ---------- media templates (an image or PDF sent with the message) ----------
/**
 * A media template's file comes from Google Drive: the template's media address is DRIVE_MEDIA_URL + {{n}}, and each send fills
 * {{n}} with a Drive file id, so one approved template can carry a different file every time. The file must be shared as
 * "Anyone with the link". {{n}} is the number after the body's last placeholder, labelled media_file.
 */
var DRIVE_MEDIA_URL = 'https://drive.usercontent.google.com/download?export=download&id=';
var MEDIA_TYPES = {
  image: { label: 'Image', mimes: ['image/jpeg', 'image/png'], max: 5 * 1024 * 1024, what: 'a PNG or JPG image' },
  document: { label: 'PDF', mimes: ['application/pdf'], max: 16 * 1024 * 1024, what: 'a PDF' }
};
var MEDIA_LABEL = 'media_file';

/** The placeholder number of a media template's file (0 for a text template). */
function mediaVarNumber_(tpl) { return tpl && MEDIA_TYPES[tpl.media_type] ? placeholderNumbers_(tpl.body).length + 1 : 0; }
/** Every placeholder number a template needs filled: the body's, plus the file's for a media template. */
function templateVarNumbers_(tpl) { var n = placeholderNumbers_(tpl.body), m = mediaVarNumber_(tpl); return m ? n.concat([m]) : n; }

/** Checks a Drive share link (or file id) the way WhatsApp will fetch it. Returns the file id; throws an ApiError saying what is wrong. */
function checkDriveMedia_(value, mediaType) {
  var kind = MEDIA_TYPES[mediaType];
  if (!kind) throw new ApiError('Choose Image or PDF for the attachment.');
  var id = fileIdFrom_(value);
  if (!id) throw new ApiError('Paste the Google Drive share link of the ' + kind.label + ' (in Drive: Share, Copy link).');
  var r;
  try { r = UrlFetchApp.fetch(DRIVE_MEDIA_URL + encodeURIComponent(id), { muteHttpExceptions: true, followRedirects: true }); }
  catch (e) { throw new ApiError('Could not open the file from Google Drive: ' + e.message); }
  var h = {}, raw = r.getHeaders() || {}; Object.keys(raw).forEach(function (k) { h[k.toLowerCase()] = raw[k]; });
  var type = String(h['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (r.getResponseCode() !== 200 || type === 'text/html') throw new ApiError('WhatsApp cannot open this file. In Drive, set Share to "Anyone with the link" (Viewer), then try again.');
  if (kind.mimes.indexOf(type) < 0) throw new ApiError('The file must be ' + kind.what + ' (this one is ' + (type || 'of an unknown type') + ').');
  var size = Number(h['content-length']) || r.getBlob().getBytes().length;
  if (size > kind.max) throw new ApiError('The file is ' + (Math.round(size / 104857.6) / 10) + ' MB; WhatsApp allows up to ' + (kind.max / 1048576) + ' MB for ' + (mediaType === 'image' ? 'an image' : 'a PDF') + '.');
  return id;
}

function listDonorTemplates_() {
  var use = loadDonorUsage_();
  return loadTable_('DonorTemplates')
    .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); }).map(function (t) {
      var o = publicTemplate_(t); o.delete_block = templateDeleteBlock_(t, use); o.can_delete = !o.delete_block; return o;
    });
}

function createDonorTemplate_(user, body) {
  var name = String(body.name || '').trim(), mediaType = MEDIA_TYPES[body.media_type] ? body.media_type : '';
  var errors = validateName_(name, body.language || 'en').concat(validateContent_(body)).concat(validateDonorTemplateMeta_(body));   // the body's own placeholders
  if (!/^donor_/.test(name)) errors.unshift('Donor template names must start with donor_ (this keeps them apart from parent templates at WhatsApp).');
  if (errors.length) throw new ApiError(errors[0], errors);
  var names = (body.variable_names || []).slice(), samples = {};
  Object.keys(body.sample_values || {}).forEach(function (k) { samples[k] = body.sample_values[k]; });
  if (mediaType) {   // the file is one more placeholder, after the body's; Meta reviews the sample file
    var fileId = checkDriveMedia_(body.media_sample, mediaType);
    names.push(MEDIA_LABEL); samples[String(placeholderNumbers_(body.body).length + 1)] = fileId;
  }
  var id = withLock_(function () {
    if (nameTaken_(name, body.language || 'en', 'DonorTemplates')) throw new ApiError("A template named '" + name + "' already exists for this language.");
    var tid = insertTemplate_(user, { name: name, language: body.language || 'en', category: body.category, body: body.body,
      variable_names: names, sample_values: samples, has_confirm_buttons: false }, 'DonorTemplates');
    var t = findOne_('DonorTemplates', 'id', tid);
    t.division = 'donor'; t.message_type = body.message_type; t.source_code = strOrNull_(body.source_code); t.media_type = mediaType || null;
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
    var n = placeholderNumbers_(t.body).length, names = (body.variable_names || []).slice(0, n).map(function (x) { return String(x || '').trim(); });
    if (names.length !== n || names.some(function (x) { return !x; })) throw new ApiError('Give a label for each of the ' + n + ' placeholders.');
    if (MEDIA_TYPES[t.media_type] && MEDIA_TYPES[body.media_type]) t.media_type = body.media_type;   // Image <-> PDF (an imported template is guessed)
    if (MEDIA_TYPES[t.media_type]) names.push(MEDIA_LABEL);   // the file's placeholder keeps its fixed label
    t.message_type = body.message_type; t.variable_names = names; t.updated_at = nowIso_();
    if (body.source_code !== undefined) t.source_code = strOrNull_(body.source_code);   // the screens no longer send it (Source was removed); a stored value is kept
    saveRows_('DonorTemplates', [t]);
    return publicTemplate_(t);
  });
}

function importDonorTemplates_(user) {
  var r = importTwilioTemplates_(user, { table: 'DonorTemplates' });
  return r;
}

// ---------- broadcasts (T8 general, T11 special, T12 festive). T4 campaign updates were removed. ----------
var BROADCAST_KINDS = { general_update: 'T8', special_update: 'T11', festive_greeting: 'T12' };

/**
 * A broadcast's kind comes from its template's type: General update (T8), Special update (T11) or Festive greeting (T12).
 * A template of another type ("A year ago you helped", Welcome, Thank-you, or no type) is sent as a Special update.
 */
function broadcastKindOf_(tpl) { return tpl && BROADCAST_KINDS[tpl.message_type] ? tpl.message_type : 'special_update'; }

function cleanBroadcast_(b) {
  var tplId = strOrNull_(b.template_id), tpl = tplId ? findOne_('DonorTemplates', 'id', tplId) : null;
  var kind = tpl ? broadcastKindOf_(tpl) : (BROADCAST_KINDS[b.kind] ? b.kind : 'special_update');   // no template chosen yet: keep what was there
  var name = strOrNull_(b.name); if (!name) throw new ApiError('Give it a name.');
  var segs = (b.segments || []).filter(function (s) { return SEGMENT_CODES.indexOf(s) >= 0; });
  var sendOn = strOrNull_(b.send_on) ? parseDateInput_(b.send_on) : null;
  if (strOrNull_(b.send_on) && !sendOn) throw new ApiError('The send date is not valid.');
  var eventDate = strOrNull_(b.event_date) ? parseDateInput_(b.event_date) : null;
  if (strOrNull_(b.event_date) && !eventDate) throw new ApiError('The festival date is not valid.');
  var values = {}; Object.keys(b.values || {}).forEach(function (k) { var v = String(b.values[k] || '').trim(); if (v) values[labelKey_(k)] = v; });
  if (values[MEDIA_LABEL]) values[MEDIA_LABEL] = fileIdFrom_(values[MEDIA_LABEL]) || values[MEDIA_LABEL];   // a Drive share link -> its file id
  return { name: name, kind: kind, template_id: tplId, campaign_id: strOrNull_(b.campaign_id), segments: segs,
    values: values, send_on: sendOn, event_date: eventDate,
    excluded_tags: cleanTags_(b.excluded_tags, true) };
}

function saveBroadcast_(user, id, body) {
  var c = cleanBroadcast_(body);
  return withLock_(function () {
    var b = id ? findOne_('DonorBroadcasts', 'id', id) : null;
    if (id && !b) throw new ApiError('Not found', null, 404);
    if (b && b.status !== 'draft') throw new ApiError('Only drafts can be edited.');
    // A field the caller did not send keeps its value (system drafts arrive with a date and campaign already set).
    if (b) ['send_on', 'event_date', 'campaign_id', 'excluded_tags'].forEach(function (k) { if (body[k] === undefined) c[k] = b[k]; });
    if (!b) b = { id: newId_(), trigger: BROADCAST_KINDS[c.kind], status: 'draft',
      created_by: user.email, approved_by: null, approved_at: null, message_count: 0, created_at: nowIso_() };
    Object.keys(c).forEach(function (k) { b[k] = c[k]; });
    b.trigger = BROADCAST_KINDS[b.kind];   // the kind follows the template, so the rule code does too
    if (id) saveRows_('DonorBroadcasts', [b]); else insertRows_('DonorBroadcasts', [b]);
    return cleanDonorRow_(b);
  });
}

function listBroadcasts_() {
  var tpls = {}; loadTable_('DonorTemplates').forEach(function (t) { tpls[t.id] = t; });
  var camps = {}; loadTable_('DonorCampaigns').forEach(function (c) { camps[c.id] = c; });
  var counts = {}, sentBy = {}, waitingBy = {};   // sentBy / waitingBy: for the delete rule
  loadTable_('DonorMessages').forEach(function (m) {
    if (!m.broadcast_id) return;
    if (m.wa_sent_at) sentBy[m.broadcast_id] = true;
    if (DONOR_STATUS_OPEN.indexOf(m.status) >= 0) waitingBy[m.broadcast_id] = true;
    var c = counts[m.broadcast_id] || (counts[m.broadcast_id] = { total: 0, sent: 0, waiting: 0, failed: 0, replies: 0 });
    if (m.status === 'received') { c.replies++; return; }   // a donor's reply: not a message we sent
    c.total++;
    if (['sent', 'delivered', 'read'].indexOf(m.status) >= 0) c.sent++; else if (m.status === 'failed') c.failed++; else if (DONOR_STATUS_OPEN.indexOf(m.status) >= 0) c.waiting++;
  });
  return loadTable_('DonorBroadcasts').sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); }).map(function (b) {
    var o = cleanDonorRow_(b);
    o.template_name = b.template_id && tpls[b.template_id] ? tpls[b.template_id].name : null;
    o.campaign_name = b.campaign_id && camps[b.campaign_id] ? camps[b.campaign_id].name : null;
    o.counts = counts[b.id] || { total: 0, sent: 0, waiting: 0, failed: 0, replies: 0 };
    o.delete_block = broadcastDeleteBlock_(b, { bcSent: sentBy, bcWaiting: waitingBy }); o.can_delete = !o.delete_block;
    return o;
  });
}

/** Who a broadcast goes to (the chosen segments, after the tag filter): only donors it can reach (WhatsApp opt-in and no STOP, or email opt-in with an address). withUnreachable also returns the rest. */
function broadcastAudience_(b, donors, donations, withUnreachable) {
  var ids = {}, tagOk = broadcastTagOk_(b);   // segments (with the tag filter) only; a linked campaign adds no donors
  (b.segments || []).forEach(function (s) { donors.forEach(function (d) { if (d.segment === s && tagOk(d)) ids[d.id] = true; }); });
  var out = [];
  donors.forEach(function (d) { if (ids[d.id] && isActive_(d) && (withUnreachable || reachable_(d))) out.push(d); });
  return out;
}

/**
 * The broadcast's tag filter for segment members: a donor stays in while at least one of their tags was not removed.
 * A donor with no tag stays in unless "No tag" was removed. Nothing removed = everyone in the segments.
 */
function broadcastTagOk_(b) {
  var off = {}; (b.excluded_tags || []).forEach(function (t) { off[String(t).toLowerCase()] = true; });
  if (!Object.keys(off).length) return function () { return true; };
  return function (d) {
    var t = donorTagList_(d);
    if (!t.length) return !off[NO_TAG];
    return t.some(function (x) { return !off[String(x).toLowerCase()]; });
  };
}

function reachable_(d) { return waReady_(d) || emailReady_(d); }

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
  return previewBroadcastObj_(b);
}

/** The same preview for a broadcast that has not been saved: built from the form (checked like a save), nothing is written. */
function previewDraftBroadcast_(user, body) {
  body = Object.assign({}, body || {});
  if (!strOrNull_(body.name)) body.name = 'Preview';   // a name is needed to save, not to look
  return previewBroadcastObj_(cleanBroadcast_(body));
}

/** Audience, sample text and missing values of a broadcast (saved or not). */
function previewBroadcastObj_(b) {
  var ctx = broadcastContext_(), donors = loadTable_('Donors');
  var all = broadcastAudience_(b, donors, ctx.donations, true), aud = all.filter(reachable_);
  var tpl = b.template_id ? findOne_('DonorTemplates', 'id', b.template_id) : null;
  var out = { count: aud.length, template: tpl ? { name: tpl.name, status: tpl.status, message_type: tpl.message_type } : null,
    no_optin: aud.filter(function (d) { return !d.whatsapp_opt_in; }).length, sample: null, missing: [],
    by_whatsapp: aud.filter(waReady_).length,
    by_email: aud.filter(emailReady_).length,
    unreachable: all.length - aud.length,   // in the chosen segments but with neither opt-in: left out, no message is created
    by_tags: (function (ok) { return donors.filter(function (d) { return isActive_(d) && (b.segments || []).indexOf(d.segment) >= 0 && !ok(d); }).length; })(broadcastTagOk_(b)),
    // every recipient (the screen groups them by segment) and how many donors each segment has in total
    recipients: aud.map(function (d) { return { id: d.id, name: d.name, segment: d.segment, phone: d.phone_e164, email_address: d.email, opt_in: waReady_(d), email: emailReady_(d) }; }),
    segment_totals: donors.reduce(function (o, d) { if (isActive_(d)) o[d.segment] = (o[d.segment] || 0) + 1; return o; }, {}) };   // active contacts
  if (tpl && aud.length) {
    var msg = { variables: b.values, campaign_id: b.campaign_id };
    var missing = {};
    aud.forEach(function (d) { resolveVars_(tpl, d, msg, ctx).missing.forEach(function (m) { missing[m] = (missing[m] || 0) + 1; }); });
    out.missing = Object.keys(missing).map(function (k) { return k + ' is empty for ' + missing[k] + ' donor(s). Type it under "Values for this send", then Save & preview again.'; });
    var r = resolveVars_(tpl, aud[0], msg, ctx);
    out.sample = { donor: aud[0].name, text: renderBody_(tpl, r.vars) };
    if (MEDIA_TYPES[tpl.media_type]) {   // a media template: the file must be there and public
      var fileVal = (b.values || {})[MEDIA_LABEL];
      out.missing = out.missing.filter(function (x) { return x.indexOf('(' + MEDIA_LABEL + ')') < 0; });
      if (!fileVal) out.missing.unshift('Add the attachment: paste the Google Drive share link of the ' + MEDIA_TYPES[tpl.media_type].label + ' under "Attachment".');
      else {
        try {
          var fid = checkDriveMedia_(fileVal, tpl.media_type);
          out.media = { type: tpl.media_type, file_id: fid, view_url: 'https://drive.google.com/file/d/' + fid + '/view', thumb_url: 'https://drive.google.com/thumbnail?id=' + fid + '&sz=w400' };
        } catch (e) { out.missing.unshift('Attachment: ' + e.message); }
      }
      out.email_note = tpl.media_type === 'image' ? 'Emails show the image above the text, as on WhatsApp.' : 'Emails carry the PDF as an attachment.';
    }
  }
  return out;
}

/** The channels chosen when approving: { whatsapp, email } (both when not given). At least one is needed. */
function broadcastChannels_(opts) {
  opts = opts || {};
  var ch = [];
  if (opts.whatsapp !== false) ch.push('whatsapp');
  if (opts.email !== false) ch.push('email');
  if (!ch.length) throw new ApiError('Choose WhatsApp, email or both.');
  return ch;
}

/** A broadcast approved with email turned off gets no email copies, even if a donor opts in to email later. */
function broadcastSkipsEmail_(b) { return !!(b && b.channels && b.channels.indexOf('email') < 0); }

function approveBroadcast_(user, id, opts) {
  var channels = broadcastChannels_(opts), byWa = channels.indexOf('whatsapp') >= 0, byEmail = channels.indexOf('email') >= 0;
  var result = withLock_(function () {
    var b = findOne_('DonorBroadcasts', 'id', id);
    if (!b) throw new ApiError('Not found', null, 404);
    if (b.status !== 'draft') throw new ApiError('This was already approved or cancelled.');
    if (!BROADCAST_KINDS[b.kind]) throw new ApiError('Campaign updates (T4) are no longer sent. Delete this draft, or write a General or Special update instead.');
    var tpl = b.template_id ? findOne_('DonorTemplates', 'id', b.template_id) : null;
    if (!tpl) throw new ApiError('Choose a template first.');
    if (tpl.status !== 'approved') throw new ApiError('That template is not approved by WhatsApp yet.');
    if (tpl.archived_at) throw new ApiError('That template is archived. Restore it on the Templates page, or choose another.');
    // any approved template may be used, whatever its message type; the broadcast's kind still sets its rule code, email subject and (festive) expiry
    if (MEDIA_TYPES[tpl.media_type] && !(b.values || {})[MEDIA_LABEL]) throw new ApiError('This template sends a file. Add the attachment (a Google Drive share link) first.');
    var ctx = broadcastContext_(), donors = loadTable_('Donors'), aud = broadcastAudience_(b, donors, ctx.donations);
    if (!aud.length) throw new ApiError(broadcastAudience_(b, donors, ctx.donations, true).length ? 'Nobody in the audience has a WhatsApp or email opt-in.' : 'Nobody is in the audience.');
    aud = aud.filter(function (d) { return (byWa && waReady_(d)) || (byEmail && emailReady_(d)); });   // only the chosen channels
    if (!aud.length) throw new ApiError(byWa && byEmail ? 'Nobody in the audience can be reached.' : 'Nobody in the audience has ' + (byWa ? 'a WhatsApp' : 'an email') + ' opt-in.');
    var now = new Date(), notBefore = b.send_on && b.send_on > todayStr_(now) ? startOfDayLocal_(b.send_on).toISOString() : null;
    var expires = b.kind === 'festive_greeting' && (b.event_date || b.send_on) ? startOfDayLocal_(addDaysStr_(b.event_date || b.send_on, 2)).toISOString() : null;
    var existing = {}; loadTable_('DonorMessages').forEach(function (m) { if (m.dedupe_key) existing[m.dedupe_key] = true; });
    var rows = [], nWa = 0, nEmail = 0;
    aud.forEach(function (d) {
      var key = 'B:' + b.id + ':' + d.id;
      // the message carries the template's own type, so the email subject and "Last communicated" match the message (e.g. "A year ago, you helped")
      var f = { donor_id: d.id, template_id: tpl.id, message_type: tpl.message_type || b.kind, trigger: b.trigger, broadcast_id: b.id, campaign_id: b.campaign_id,
        variables: b.values, not_before: notBefore, expires_at: expires || undefined };
      // one message per chosen channel; the email's key is the WhatsApp key + ':email'
      if (byWa && waReady_(d) && !existing[key]) { rows.push(newDonorMessage_(Object.assign({}, f, { dedupe_key: key }))); nWa++; }
      if (byEmail && emailReady_(d) && !existing[key + ':email']) { rows.push(newDonorMessage_(Object.assign({}, f, { channel: 'email', to_email: d.email, dedupe_key: key + ':email' }))); nEmail++; }
    });
    insertRows_('DonorMessages', rows);
    b.status = 'approved'; b.approved_by = user.email; b.approved_at = nowIso_(); b.message_count = rows.length; b.channels = channels;
    saveRows_('DonorBroadcasts', [b]);
    return { queued: rows.length, queued_whatsapp: nWa, queued_email: nEmail, channels: channels, scheduled_for: notBefore ? b.send_on : null };   // a later date waits in the queue; otherwise it sends now
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

// ---------- archive and delete (campaigns, broadcasts, templates) ----------
/**
 * Something with history (donations, messages that went out) is archived, never deleted: it leaves the lists and pickers but
 * the Queue, contact Messages and campaign totals still show it. Only something without history can be deleted.
 */
function donorUsage_(msgs, broadcasts, donations) {
  var u = { campDonations: {}, campBroadcasts: {}, bcSent: {}, bcWaiting: {}, tplUses: {}, tplWaiting: {} };
  var inc = function (o, k) { if (k) o[k] = (o[k] || 0) + 1; };
  (donations || []).forEach(function (x) { inc(u.campDonations, x.campaign_id); });
  (broadcasts || []).forEach(function (b) { inc(u.campBroadcasts, b.campaign_id); inc(u.tplUses, b.template_id); });
  (msgs || []).forEach(function (m) {
    if (m.channel === 'manual') return;
    var open = DONOR_STATUS_OPEN.indexOf(m.status) >= 0;
    if (m.broadcast_id) { if (m.wa_sent_at) inc(u.bcSent, m.broadcast_id); if (open) inc(u.bcWaiting, m.broadcast_id); }
    inc(u.tplUses, m.template_id); if (open) inc(u.tplWaiting, m.template_id);
  });
  return u;
}
function loadDonorUsage_() { return donorUsage_(loadTable_('DonorMessages'), loadTable_('DonorBroadcasts'), loadTable_('Donations')); }

/** '' when it may be deleted, otherwise why not (in plain words). */
function campaignDeleteBlock_(c, u) {
  var d = u.campDonations[c.id] || 0, b = u.campBroadcasts[c.id] || 0;
  if (!d && !b) return '';
  return 'It has ' + [d ? d + ' donation' + (d === 1 ? '' : 's') : '', b ? b + ' broadcast' + (b === 1 ? '' : 's') : ''].filter(String).join(' and ') + '. Archive it instead.';
}
function broadcastDeleteBlock_(b, u) {
  if (b.status === 'draft') return '';
  if (u.bcSent[b.id]) return 'Some of its messages were already sent. Archive it instead.';
  if (u.bcWaiting[b.id]) return 'It still has messages waiting to go. Cancel the unsent ones first.';
  return '';
}
function templateDeleteBlock_(t, u) {
  var n = u.tplUses[t.id] || 0;
  return n ? 'It is used by ' + n + ' message' + (n === 1 ? '' : 's') + ' or broadcast' + (n === 1 ? '' : 's') + '. Archive it instead.' : '';
}

var DONOR_ARCHIVE_WHAT = { DonorCampaigns: 'Campaign', DonorBroadcasts: 'Broadcast', DonorTemplates: 'Template' };

function setDonorArchived_(user, table, id, on) {
  if (!DONOR_ARCHIVE_WHAT[table]) throw new ApiError('Not supported.');
  return withLock_(function () {
    var row = findOne_(table, 'id', id);
    if (!row) throw new ApiError(DONOR_ARCHIVE_WHAT[table] + ' not found', null, 404);
    if (on) {
      var u = loadDonorUsage_();
      if (table === 'DonorBroadcasts' && u.bcWaiting[id]) throw new ApiError('This broadcast still has messages waiting to go. Cancel the unsent ones first, then archive it.');
      if (table === 'DonorTemplates' && u.tplWaiting[id]) throw new ApiError('Messages waiting to go still use this template. Let them go or cancel them first, then archive it.');
    }
    row.archived_at = on ? nowIso_() : null;
    saveRows_(table, [row]);
    return cleanDonorRow_(row);
  });
}

function deleteDonorCampaign_(user, id) {
  return withLock_(function () {
    var c = findOne_('DonorCampaigns', 'id', id);
    if (!c) throw new ApiError('Campaign not found', null, 404);
    var why = campaignDeleteBlock_(c, loadDonorUsage_());
    if (why) throw new ApiError('This campaign cannot be deleted. ' + why);
    deleteRow_('DonorCampaigns', c);
    return { deleted: 1 };
  });
}

/** A draft, or a broadcast none of whose messages ever went out. Its never-sent messages (cancelled, failed, skipped) go with it. */
function deleteDraftBroadcast_(user, id) {
  return withLock_(function () {
    var b = findOne_('DonorBroadcasts', 'id', id);
    if (!b) throw new ApiError('Not found', null, 404);
    var why = broadcastDeleteBlock_(b, loadDonorUsage_());
    if (why) throw new ApiError('This broadcast cannot be deleted. ' + why);
    var removed = deleteDonorMessageRows_(function (m) { return m.broadcast_id === id && !m.wa_sent_at; });
    deleteRow_('DonorBroadcasts', b);   // another tab: deleting message rows does not move this row
    return { deleted: 1, messages_removed: removed };
  });
}

/** Inside the lock: delete the DonorMessages rows that match (bottom up, runs of rows in one call). */
function deleteDonorMessageRows_(pred) {
  var rows = loadTable_('DonorMessages').filter(pred).map(function (m) { return m._row; }).sort(function (a, b) { return b - a; });
  var sh = sheet_('DonorMessages');
  for (var i = 0; i < rows.length;) {
    var j = i;
    while (j + 1 < rows.length && rows[j + 1] === rows[j] - 1) j++;
    sh.deleteRows(rows[j], j - i + 1);
    i = j + 1;
  }
  return rows.length;
}

/** An unused template: deleted in Twilio (so WhatsApp drops it too), then here. Same order as the parent Templates page. */
function deleteDonorTemplate_(user, id) {
  var t = findOne_('DonorTemplates', 'id', id);
  if (!t) throw new ApiError('Template not found', null, 404);
  var why = templateDeleteBlock_(t, loadDonorUsage_());
  if (why) throw new ApiError('This template cannot be deleted. ' + why);
  if (t.twilio_content_sid) {
    requireConfig_(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']);
    try { deleteContent_(t.twilio_content_sid); }
    catch (e) { throw new ApiError('Could not delete it in Twilio: ' + e.message + '. Nothing was deleted; try again.', null, 502); }
  }
  withLock_(function () {
    var fresh = findOne_('DonorTemplates', 'id', id);
    if (fresh) deleteRow_('DonorTemplates', fresh);
  });
  return { deleted: 1 };
}

// ---------- the message queue ----------
function listDonorMessages_(user, f) {
  f = f || {};
  var donors = {}; loadTable_('Donors').forEach(function (d) { donors[d.id] = d; });
  var tpls = {}; loadTable_('DonorTemplates').forEach(function (t) { tpls[t.id] = t; });
  var camps = {}; loadTable_('DonorCampaigns').forEach(function (c) { camps[c.id] = c; });
  var bcs = {}; loadTable_('DonorBroadcasts').forEach(function (b) { bcs[b.id] = b; });
  var rows = loadTable_('DonorMessages').filter(function (m) {   // logged conversations are not in the queue; a row without a status is a cleared leftover
    return m.status && m.channel !== 'manual' && (!f.status || m.status === f.status) && (!f.broadcast_id || m.broadcast_id === f.broadcast_id);
  }).sort(function (a, b) { return String(b.updated_at).localeCompare(String(a.updated_at)); });
  if (!f.broadcast_id) rows = rows.slice(0, 1000);   // the Queue: the newest 1000 (shown in pages). One broadcast's messages: all of them
  return rows.map(function (m) {
    var o = cleanDonorRow_(m), d = donors[m.donor_id] || {};
    o.donor_name = d.name || '(deleted)'; o.donor_segment = d.segment || ''; o.template_name = m.template_id && tpls[m.template_id] ? tpls[m.template_id].name : null;
    // the broadcast it came from, and its campaign (the message's own campaign, else the broadcast's)
    var bc = m.broadcast_id ? bcs[m.broadcast_id] : null, campId = m.campaign_id || (bc && bc.campaign_id);
    o.broadcast_name = bc ? (bc.name || '(unnamed broadcast)') : null;
    o.campaign_name = campId && camps[campId] ? camps[campId].name : null;
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
 *   runDonorTriggers_()      makes the email copies of waiting messages (there is no automatic rule any more; T7 was turned off).
 *                            It is safe to run any number of times: every message has a dedupe key.
 *   dispatchDonorBatch_()    decides what may be sent right now (opt-in, template, values) and sends it.
 * Both run from the 10-minute cron tick; the donor screens also call them right after an approval or a donation.
 */
var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var QUARTER_MONTHS = [1, 4, 7, 10];

function newDonorMessage_(f) {
  var type = f.message_type, now = nowIso_();
  var m = { id: 'd-' + newId_(), donor_id: null, channel: 'whatsapp', to_email: null, template_id: null, message_type: type, trigger: null,
    broadcast_id: null, campaign_id: null, donation_id: null, ref: null, variables: null, dedupe_key: null,
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
  return ctx;
}

function addMsg_(ctx, f) {
  if (f.dedupe_key && ctx.keys[f.dedupe_key]) return null;
  if (f.donor_id && ctx.donorsById && ctx.donorsById[f.donor_id] && !isActive_(ctx.donorsById[f.donor_id])) return null;   // inactive contact
  var m = newDonorMessage_(f);
  if (m.dedupe_key) ctx.keys[m.dedupe_key] = true;
  ctx.newMsgs.push(m); ctx.msgs.push(m);
  return m;
}

function count_(ctx, k) { ctx.stats[k] = (ctx.stats[k] || 0) + 1; }

/** T7 (turned off, no longer called): 11 months after the last donation, last year's donors (P4) got an "a year ago you helped" update unless they gave again. */
function triggerT7_(ctx) {
  ctx.donors.forEach(function (d) {
    if (d.segment !== 'P4' || (d.opted_out && !emailReady_(d)) || !d.last_donation_date) return;
    if (ctx.today < addMonthsStr_(d.last_donation_date, 11)) return;
    if (ctx.donations.some(function (x) { return x.donor_id === d.id && x.donated_on > d.last_donation_date; })) return;
    if (addMsg_(ctx, { donor_id: d.id, message_type: 'year_ago_update', trigger: 'T7', dedupe_key: 'T7:' + d.id + ':' + d.last_donation_date })) count_(ctx, 'T7');
  });
}

/**
 * Messages from rules that no longer exist: T1 welcome, T2 thank-you, T4 campaign update, T9/T10 programme reports.
 * One that never went out is deleted (it would only clutter the Queue); one that was sent stays as history.
 */
var RETIRED_TRIGGERS = ['T1', 'T2', 'T4', 'T7'], RETIRED_TYPES = ['campaign_update', 'report_reminder', 'programme_report'];
function retiredUnsent_(m) {
  return m.channel !== 'manual' && !m.wa_sent_at && (RETIRED_TRIGGERS.indexOf(m.trigger) >= 0 || RETIRED_TYPES.indexOf(m.message_type) >= 0);
}

/** Inside the lock, before anything else reads row numbers: delete the retired, never-sent messages (bottom up, runs of rows in one call). */
function purgeRetiredDonorMessages_() {
  var rows = loadTable_('DonorMessages').filter(retiredUnsent_).map(function (m) { return m._row; }).sort(function (a, b) { return b - a; });
  var sh = sheet_('DonorMessages');
  for (var i = 0; i < rows.length;) {
    var j = i;
    while (j + 1 < rows.length && rows[j + 1] === rows[j] - 1) j++;
    sh.deleteRows(rows[j], j - i + 1);
    i = j + 1;
  }
  return rows.length;
}

function runDonorTriggers_() {
  if (!donorReady_()) return { skipped: 'donor sheets not set up' };
  return withLock_(function () {
    var purged = purgeRetiredDonorMessages_();   // first, so the row numbers loaded below are current
    var ctx = loadEngineCtx_();
    if (purged) ctx.stats.retired_removed = purged;
    // T7 ("a year ago you helped") was turned off: it is now sent by hand as a broadcast. No rule creates messages on its own any more.
    triggerEmailTwins_(ctx);
    saveRows_('Donors', values_(ctx.dirtyDonors));
    saveRows_('DonorMessages', values_(ctx.dirtyMsgs));
    insertRows_('DonorMessages', ctx.newMsgs);
    insertRows_('DonorBroadcasts', ctx.newBroadcasts);
    insertRows_('SegmentHistory', ctx.newHistory);
    return ctx.stats;
  }, 25000);
}

// ---------------------------------------------------------------- email (donors who opted in to email)
/** Donor can be reached by email: opted in and has an address. */
function emailReady_(d) { return !!(d && d.email_opt_in && d.email); }

/** An email copy and its WhatsApp message share this key (the email's dedupe key is the WhatsApp one + ':email'). */
function baseKey_(m) { return String(m.dedupe_key || m.id).replace(/:email$/, ''); }

/** The account that runs this code. Donor emails go only from the project owner's account. */
function sendsAsOwner_() {
  var owner = ownerEmail_();
  if (!owner) return true;   // no owner recorded: whoever runs it (older installs)
  try { return String(Session.getEffectiveUser().getEmail() || '').toLowerCase() === owner; } catch (e) { return false; }
}

/**
 * Every waiting WhatsApp message to a donor who opted in to email gets an email copy (channel 'email', same template and values).
 * Runs on every trigger pass, so a donor who opts in to email later also gets the copies of messages still waiting.
 */
function triggerEmailTwins_(ctx) {
  var bcs = byId_(ctx.broadcasts || []);
  ctx.msgs.slice().forEach(function (m) {
    if (m.channel !== 'whatsapp' || DONOR_STATUS_OPEN.indexOf(m.status) < 0 || !m.dedupe_key) return;
    if (m.broadcast_id && broadcastSkipsEmail_(bcs[m.broadcast_id])) return;   // approved as WhatsApp only
    var d = ctx.donorsById[m.donor_id];
    if (!emailReady_(d)) return;
    var f = {};
    ['donor_id', 'template_id', 'message_type', 'trigger', 'broadcast_id', 'campaign_id', 'donation_id', 'ref', 'variables',
      'status', 'hold_reason', 'not_before', 'expires_at'].forEach(function (k) { f[k] = m[k]; });
    if (f.status === 'held') { f.status = 'queued'; f.hold_reason = null; }   // a WhatsApp hold (e.g. no WhatsApp opt-in) does not apply to email
    f.channel = 'email'; f.to_email = d.email; f.dedupe_key = m.dedupe_key + ':email';
    if (addMsg_(ctx, f)) count_(ctx, 'email_copies');
  });
}

var DONOR_EMAIL_FROM_NAME = 'Ek Tara';
var DONOR_EMAIL_SUBJECTS = { welcome: 'Welcome to Ek Tara', general_update: 'An update from Ek Tara', special_update: 'A special update from Ek Tara',
  campaign_update: 'Campaign update from Ek Tara', thank_you: 'Thank you from Ek Tara', festive_greeting: 'Warm wishes from Ek Tara',
  year_ago_update: 'A year ago, you helped' };

function donorEmailSubject_(m, ctx) {
  var camp = m.campaign_id && ctx.campaignsById ? ctx.campaignsById[m.campaign_id] : null;
  if (m.message_type === 'campaign_update' && camp) return 'Update on ' + camp.name;
  return DONOR_EMAIL_SUBJECTS[m.message_type] || 'A message from Ek Tara';
}

/** The WhatsApp text as an email: *bold* and _italic_ kept, line breaks kept, links clickable. withImage: the template's image above the text (as on WhatsApp). */
function donorEmailHtml_(text, withImage) {
  var h = htmlEsc_(text)
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/(^|\s)_([^_\n]+)_/g, '$1<i>$2</i>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>');
  return '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#1f2a27;max-width:600px">' +
    (withImage ? '<img src="cid:' + DONOR_EMAIL_IMAGE_CID + '" alt="" style="display:block;max-width:100%;height:auto;border-radius:8px;margin:0 0 16px">' : '') + h +
    '<p style="margin-top:28px;font-size:12px;color:#6b7a75">You are receiving this because you agreed to hear from Ek Tara by email. Reply to this email if you would like us to stop.</p></div>';
}

// ---------------------------------------------------------------- dispatch
/**
 * Under the lock: decide what may go out now. Applies opt-in per channel, template and values. There is no frequency cap:
 * every approved broadcast goes out, however recently the contact got the last one.
 * Emails are claimed only when this runs as the project owner, so they always go from the owner's account; otherwise they wait (email_waiting).
 */
function claimDonorBatch_(max) {
  return withLock_(function () {
    var now = new Date(), nowMs = now.getTime(), asOwner = sendsAsOwner_();
    var donors = byId_(loadTable_('Donors')), tpls = byId_(loadTable_('DonorTemplates'));
    var ctx = { campaignsById: byId_(loadTable_('DonorCampaigns')), donationsById: byId_(loadTable_('Donations')) };
    var all = loadTable_('DonorMessages'), dirty = {}, elig = [], hasEmailCopy = {};
    all.forEach(function (m) {
      if (m.channel === 'email' && /:email$/.test(m.dedupe_key || '') && ['cancelled', 'skipped'].indexOf(m.status) < 0) hasEmailCopy[baseKey_(m)] = true;
    });
    function touch(m) { dirty[m.id] = m; }
    function hold(m, reason, notBefore) {
      var changed = m.status !== 'held' || m.hold_reason !== reason || (notBefore !== undefined && m.not_before !== notBefore);
      m.status = 'held'; m.hold_reason = reason; if (notBefore !== undefined) m.not_before = notBefore;
      if (changed) { m.updated_at = nowIso_(); touch(m); }
    }
    function end(m, status, reason) { m.status = status; m.hold_reason = reason; m.updated_at = nowIso_(); touch(m); }
    function templateAndValues(m, d) {
      var tpl = pickTemplate_(m, d, tpls);
      if (!tpl) { hold(m, 'No approved ' + (MESSAGE_TYPES[m.message_type] || m.message_type) + ' template'); return null; }
      var r = resolveVars_(tpl, d, m, ctx);
      if (r.missing.length) { hold(m, 'Missing ' + r.missing.join(', ')); return null; }
      return { tpl: tpl, vars: r.vars };
    }

    all.forEach(function (m) {
      if (retiredUnsent_(m)) return;   // T1 / T2 / T4 / report leftovers: never sent, deleted by the next trigger run
      if (m.status !== 'queued' && m.status !== 'held') return;
      var claimed = m.send_claimed_at ? Date.parse(m.send_claimed_at) : 0;
      if (claimed && nowMs - claimed < DONOR_CLAIM_MS) return;
      // messages held by the old working-hours rule (now removed) go at once instead of waiting for "the next morning"
      if (m.status === 'held' && String(m.hold_reason || '').indexOf('Outside sending hours') === 0) { m.not_before = null; touch(m); }
      if (m.not_before && Date.parse(m.not_before) > nowMs) return;
      if (m.expires_at && Date.parse(m.expires_at) < nowMs) { end(m, 'skipped', 'Expired before it could be sent' + (m.hold_reason ? ' (' + m.hold_reason + ')' : '')); return; }
      var d = donors[m.donor_id];
      if (!d) { end(m, 'cancelled', 'Donor deleted'); return; }
      if (!isActive_(d)) { end(m, 'cancelled', 'Contact is inactive'); return; }
      if (m.channel === 'email') {                                           // the donor's email copy
        if (!d.email_opt_in) { end(m, 'cancelled', 'Email opt-in removed'); return; }
        if (!d.email) { end(m, 'cancelled', 'No email address on the donor record'); return; }
        var te = templateAndValues(m, d); if (!te) return;
        elig.push({ m: m, d: d, email: true, tpl: te.tpl, vars: te.vars });
        return;
      }
      if (d.opted_out) { end(m, 'cancelled', 'Donor opted out of WhatsApp'); return; }       // rule 1
      if (!d.whatsapp_opt_in || !d.phone_e164) {                                           // rule 1 (and a phone number to send to)
        var why = !d.phone_e164 ? 'No phone number' : 'No WhatsApp opt-in';
        if (hasEmailCopy[baseKey_(m)]) end(m, 'skipped', why + ': sent by email only');
        else hold(m, !d.phone_e164 ? 'No phone number on the contact' : 'No WhatsApp opt-in recorded');
        return;
      }
      var tw = templateAndValues(m, d); if (!tw) return;
      elig.push({ m: m, d: d, tpl: tw.tpl, vars: tw.vars });
    });

    elig.forEach(function (e) { e.go = true; });   // no frequency cap (the 7-day rule was removed): every approved message goes

    var quota = 0;
    if (asOwner && elig.some(function (e) { return e.go && e.email; })) { try { quota = MailApp.getRemainingDailyQuota(); } catch (err) { quota = 0; } }
    var items = [], remaining = 0, emailWaiting = 0;
    elig.forEach(function (e) {
      if (!e.go) return;
      if (e.email && !asOwner) { emailWaiting++; return; }                    // left for the owner's run
      if (e.email && quota <= 0) { hold(e.m, 'Daily email limit of this Google account reached; tries again later'); return; }
      if (items.length >= max) { remaining++; return; }
      if (e.email) quota--;
      e.m.send_claimed_at = nowIso_(); touch(e.m);
      items.push({ id: e.m.id, donor_id: e.d.id, email: !!e.email, owner: !!e.owner, to_email: e.owner ? e.m.to_email : e.d.email, type: e.m.message_type, trigger: e.m.trigger, ref: e.m.ref,
        donor_name: e.d.name, phone: e.d.phone_e164, contentSid: e.tpl && e.tpl.twilio_content_sid, vars: e.vars, owner_name: e.d.owner_name,
        subject: e.email && !e.owner ? donorEmailSubject_(e.m, ctx) : null, text: e.email && !e.owner ? renderBody_(e.tpl, e.vars) : null,
        // a media template's file (image or PDF) goes with the email too: the Drive file id is the value of its placeholder
        media_type: e.email && e.tpl && MEDIA_TYPES[e.tpl.media_type] ? e.tpl.media_type : null,
        media_id: e.email && e.tpl && MEDIA_TYPES[e.tpl.media_type] ? (e.vars || {})[String(mediaVarNumber_(e.tpl))] || null : null });
    });
    saveRows_('DonorMessages', values_(dirty));
    return { items: items, remaining: remaining, email_waiting: emailWaiting };
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
  var files = {};   // each Drive file is downloaded once per batch, however many emails carry it
  items.filter(function (i) { return i.email; }).forEach(function (it) {
    try {
      var mail = { to: it.to_email, subject: it.subject, name: DONOR_EMAIL_FROM_NAME, body: it.text, htmlBody: donorEmailHtml_(it.text) };
      if (it.media_type) {   // a media template: the image shows above the text, a PDF is attached
        if (!it.media_id) throw new Error('the broadcast has no attachment file');
        var f = files[it.media_id] || (files[it.media_id] = driveMediaBlob_(it.media_id, it.media_type));
        if (it.media_type === 'image') { mail.htmlBody = donorEmailHtml_(it.text, true); mail.inlineImages = {}; mail.inlineImages[DONOR_EMAIL_IMAGE_CID] = f; }
        else mail.attachments = [f];
      }
      MailApp.sendEmail(mail);
      results[it.id] = { sid: 'email' };
    } catch (e) { results[it.id] = { error: 'Email failed: ' + e.message }; }
  });
  return results;
}

/** The content id of the image shown inside a donor email. */
var DONOR_EMAIL_IMAGE_CID = 'ektaraimage';

/**
 * A media template's file, downloaded from Google Drive the same way WhatsApp gets it (the file must be shared as "Anyone with the link").
 * Returns a blob with a sensible file name; throws an Error saying what is wrong, so the email shows as failed (and can be retried).
 */
function driveMediaBlob_(id, mediaType) {
  var kind = MEDIA_TYPES[mediaType];
  var r = UrlFetchApp.fetch(DRIVE_MEDIA_URL + encodeURIComponent(id), { muteHttpExceptions: true, followRedirects: true });
  var h = {}, raw = r.getHeaders() || {}; Object.keys(raw).forEach(function (k) { h[k.toLowerCase()] = raw[k]; });
  var type = String(h['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (r.getResponseCode() !== 200 || type === 'text/html') throw new Error('the ' + kind.label + ' could not be downloaded from Google Drive (is it still shared as "Anyone with the link"?)');
  if (kind.mimes.indexOf(type) < 0) throw new Error('the attachment must be ' + kind.what + ', this one is ' + (type || 'of an unknown type'));
  var m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(String(h['content-disposition'] || ''));
  var name = m ? decodeURIComponent(m[1]) : (mediaType === 'image' ? 'image.' + (type === 'image/png' ? 'png' : 'jpg') : 'attachment.pdf');
  return r.getBlob().setName(name);
}

function saveDonorResults_(items, results) {
  withLock_(function () {
    var msgs = byId_(loadTable_('DonorMessages')), donors = byId_(loadTable_('Donors')), dm = {}, dd = {}, now = nowIso_(), today = todayStr_();
    items.forEach(function (it) {
      var m = msgs[it.id], res = results[it.id];
      if (!m || !res) return;
      m.send_claimed_at = null; m.updated_at = now; dm[m.id] = m;
      if (!res.sid) { m.status = 'failed'; m.wa_error = res.error; return; }
      m.hold_reason = null; m.wa_error = null; m.wa_sent_at = now;
      if (it.email) { m.status = 'sent'; m.to_email = it.to_email; }
      else { m.wa_sid = res.sid; if (['queued', 'held'].indexOf(m.status) >= 0) m.status = 'sent'; } // a callback may already have moved it on
      var d = donors[m.donor_id]; if (!d) return;
      d.last_message_at = now; d.last_message_type = m.message_type; d.updated_at = now;   // shown as Last communicated
      dd[d.id] = d;
    });
    saveRows_('DonorMessages', values_(dm)); saveRows_('Donors', values_(dd));
  });
}

/** Send for up to budgetMs. Returns {sent, remaining, email_waiting}. Safe to call repeatedly. */
function dispatchDonorBatch_(budgetMs) {
  if (!donorReady_()) return { sent: 0, remaining: 0, email_waiting: 0, skipped: 'donor sheets not set up' };
  var started = Date.now(), sent = 0, remaining = 0, emailWaiting = 0;
  while (true) {
    var claim = claimDonorBatch_(DONOR_BATCH);
    remaining = claim.remaining; emailWaiting = claim.email_waiting;
    if (!claim.items.length) break;
    if (claim.items.some(function (i) { return !i.email; })) requireConfig_(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']);
    saveDonorResults_(claim.items, sendDonorItems_(claim.items));
    sent += claim.items.length;
    if (Date.now() - started > budgetMs) break;
  }
  return { sent: sent, remaining: remaining, email_waiting: emailWaiting };
}

/**
 * A staff member's send cannot send email from the owner's account, so ask the owner deployment (the Twilio address,
 * which runs as the owner) to send now. Without that address the 5-minute background job sends them.
 */
function kickOwnerDonorDispatch_() {
  if (!instantUpdates_()) return 'background';
  try {
    var r = UrlFetchApp.fetch(webhookUrl_('donor_dispatch', {}), { muteHttpExceptions: true, followRedirects: true });
    var j = JSON.parse(r.getContentText() || '{}');
    return typeof j.sent === 'number' ? { sent: j.sent, email_waiting: j.email_waiting || 0 } : 'background';
  } catch (e) { console.warn('Owner donor dispatch failed: ' + e.message); return 'background'; }
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

/**
 * A free-text reply from a donor: saved as its own row (status 'received', type 'reply'), linked to the message it answers
 * (ref = that message's id; same broadcast, campaign and template). The message that was sent is left as it is.
 * Each reply is kept, and the same WhatsApp message (MessageSid) is saved only once, as this can run twice (webhook, then recovery).
 * A received row is never picked up by the sender, never counts as "sent", and does not change "Last communicated".
 * Returns true if handled.
 */
function handleDonorReply_(params, eventId) {
  var m = null, donor = null;
  if (params.OriginalRepliedMessageSid) m = findOne_('DonorMessages', 'wa_sid', params.OriginalRepliedMessageSid);
  if (m) donor = findOne_('Donors', 'id', m.donor_id);
  if (!donor) donor = findOne_('Donors', 'phone_e164', phoneOf_(params));
  if (!donor) return false;
  if (!m) {
    var since = Date.now() - REPLY_WINDOW_MS;
    var open = findBy_('DonorMessages', 'donor_id', donor.id).filter(function (x) { return x.wa_sent_at && Date.parse(x.wa_sent_at) >= since && x.channel === 'whatsapp'; })
      .sort(function (a, b) { return String(b.wa_sent_at).localeCompare(String(a.wa_sent_at)); });
    m = open[0] || null;   // none: still kept, as a reply that answers no message in particular
  }
  if (eventId && m) setEventMessageId_(eventId, m.id);
  var text = String(params.Body || '').trim();
  if (!text) return true;
  var key = params.MessageSid ? 'R:' + params.MessageSid : null;
  if (key && findOne_('DonorMessages', 'dedupe_key', key)) return true;   // already saved
  var now = nowIso_();
  insertRows_('DonorMessages', [newDonorMessage_({ donor_id: donor.id, channel: 'whatsapp', status: 'received', message_type: 'reply', trigger: null,
    broadcast_id: m ? m.broadcast_id : null, campaign_id: m ? m.campaign_id : null, template_id: m ? m.template_id : null, ref: m ? m.id : null,
    reply_text: text.slice(0, MAX_REPLY_LENGTH), replied_at: now, dedupe_key: key, expires_at: null, created_at: now, updated_at: now })]);
  return true;
}

// ===== DonorRules.gs =====
var BUILD_DonorRules = '20261107-1230'; // build stamp (see Build.gs)
/**
 * Donor Communication: constants, date helpers and variable filling.
 * All "dates" are plain 'yyyy-MM-dd' strings in APP_TIMEZONE; timestamps are ISO strings.
 * Rules come from the "Ek Tara Donor Communications Metadata" sheet (sections 4 to 7).
 */
var SEGMENTS = { P0: 'Testing group', P1: 'Trustee / employee lead', P2: 'Website lead', P3: 'Donor / partner referral lead', P4: "Last year's donor",
  P5: 'Past campaign donor', D1: 'Programme donor', D2: 'Campaign donor' };
var POTENTIAL_SEGMENTS = ['P1', 'P2', 'P3', 'P4', 'P5'];
/**
 * P0 is the team's own test contacts: pick it in a broadcast to check the real message before sending to donors.
 * It is in no automatic trigger or quarterly list, a donation does not move it to D1/D2.
 */
var TEST_SEGMENT = 'P0';
var SEGMENT_CODES = Object.keys(SEGMENTS);

/** The six message types from the metadata sheet, plus "a year ago you helped" (sent as a broadcast). */
var MESSAGE_TYPES = { welcome: 'Welcome', general_update: 'General update', special_update: 'Special update',
  thank_you: 'Thank-you', festive_greeting: 'Festive greeting',
  year_ago_update: '"A year ago you helped" update' };

var HOLD_DAYS = 14;            // an update held longer than this is dropped (a stale update is worse than none)
var THANKS_HOLD_DAYS = 30;
var P5_MOVE_DELAY_DAYS = 2;    // T6: after the campaign result update
var DONOR_CLAIM_MS = 10 * 60 * 1000;
var DONOR_BATCH = 50;
/** Placeholder labels that fill themselves from the donor record. Any other label is typed in per send. */
var AUTO_LABELS = ['donor_name', 'first_name', 'project', 'core_programme', 'city', 'owner_name', 'last_donation_date',
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
  templateVarNumbers_(tpl).forEach(function (n) {   // the body's placeholders, plus the file's for a media template
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
    if (t.status !== 'approved' || t.archived_at || t.message_type !== msg.message_type) return;
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
