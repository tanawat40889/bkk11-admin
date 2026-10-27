// หน้า "จัดการพื้นที่" ของ Admin: แก้โครงสร้าง รวมภาค > ภาค > เขต > ตำบล > หมู่ (ตาราง public.areas ที่ทุกโปรเจกต์ใช้ร่วมกัน)
// สิทธิ์จริงอยู่ที่ฐานข้อมูล (ฟังก์ชัน area_* ตรวจ is_ymd_rwp_leader()); หน้านี้แค่แสดงผลและเรียกฟังก์ชัน
// สร้างหน้าด้วย textContent / DOM เท่านั้น (ไม่ประกอบ HTML เป็นข้อความ) เหมือน access.js
(function () {
  "use strict";
  const URL_ = "https://cqdzfsucpivsgznfpjxl.supabase.co";
  const KEY = "sb_publishable_XkUBjE3M7HUiuDv7YwsbKA_mSu0ToEc";
  const SESSION_KEY = "tokan_session_v1";   // shared with โทกัง / Admin / แผนที่ (same origin)

const LEVELS = ['rwp', 'phak', 'khet', 'tambon', 'moo'];
const LEVEL_TH = { rwp: 'รวมภาค', phak: 'ภาค', khet: 'เขต', tambon: 'ตำบล', moo: 'หมู่' };
const NO_RENAME = new Set(['rwp', 'phak']); // ตรงกับฟังก์ชัน area_rename

const $ = id => document.getElementById(id);
const OPEN_KEY = 'areas_open_v1';

let areas = [];      // แถวจาก areas
let aliases = [];    // แถวจาก area_aliases
let stats = new Map(); // area_id -> จำนวนสมาชิก
let mismatches = [];
let open = new Set(); // id ของ node ที่ขยายอยู่
let query = '';       // คำค้นหา
let sheetId = null;   // พื้นที่ที่เปิดแผงแก้ไขอยู่ (null = ไม่มี/เพิ่มรวมภาค)

// ---------- session (same rules as access.js: a refresh token is single use and the other apps share it) ----------
const load = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; } };
const save = s => { try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {} };
const clear = () => { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} };
const fresh = s => !!(s && s.access_token && s.expires_at && s.expires_at * 1000 > Date.now() + 60000);
let refreshing = null;
function refresh(s) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const cur = load();
    if (cur && s && cur.refresh_token !== s.refresh_token && fresh(cur)) return cur;
    const base = cur && cur.refresh_token ? { ...s, ...cur } : s;
    let r;
    try { r = await fetch(`${URL_}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify({ refresh_token: base.refresh_token }) }); } catch (e) { return null; }
    if (!r.ok) { const again = load(); return again && fresh(again) ? again : null; }
    const d = await r.json();
    const next = { ...base, access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at };
    save(next);
    return next;
  })().finally(() => { refreshing = null; });
  return refreshing;
}
async function call(path, init = {}) {
  let s = load();
  if (!s) throw Object.assign(new Error("signed out"), { status: 401 });
  const go = tok => fetch(`${URL_}/rest/v1/${path}`, { method: init.method || "GET", headers: { apikey: KEY, Authorization: "Bearer " + tok, "content-type": "application/json" }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  let r = await go(s.access_token);
  if (r.status === 401) {
    s = await refresh(s);
    if (!s) throw Object.assign(new Error("expired"), { status: 401 });
    r = await go(s.access_token);
  }
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
  if (!r.ok) throw Object.assign(new Error((data && data.message) || `HTTP ${r.status}`), { status: r.status, code: data && data.code });
  return data;
}
const api = path => call(path);
const rpc = (name, args = {}) => call(`rpc/${name}`, { method: "POST", body: args });

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const SVG = 'http://www.w3.org/2000/svg';
function icon(kind) {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 16 16');
  s.setAttribute('class', `ico ico-${kind}`);
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', kind === 'chev' ? 'M6 3.5 10.5 8 6 12.5' : 'M4 4l8 8M12 4l-8 8');
  s.append(p);
  return s;
}
const fmt = n => Number(n).toLocaleString('th');

function showMsg(text) { $('msg').textContent = text; $('msg').hidden = !text; }

// ---------- โหลดข้อมูล ----------
async function loadAll() {
  const [a, al, st, mm] = await Promise.all([
    api('areas?select=*&order=sort_order,id&limit=5000'),
    api('area_aliases?select=*&order=alias&limit=5000'),
    rpc('area_stats'),
    rpc('area_mismatches'),
  ]);
  areas = a; aliases = al; mismatches = mm;
  stats = new Map(st.map(r => [r.area_id, Number(r.members)]));
}

const childrenOf = id => areas.filter(a => a.parent_id === id);
const byId = id => areas.find(a => a.id === id);
const aliasesOf = id => aliases.filter(x => x.area_id === id);
const nextLevel = a => LEVELS[LEVELS.indexOf(a.level) + 1];
function pathOf(a) {
  const p = [];
  for (let x = a; x; x = x.parent_id == null ? null : byId(x.parent_id)) p.unshift(x.name);
  return p;
}

// ---------- ต้นไม้ ----------
// ค้นหา: แสดงพื้นที่ที่ชื่อ/ชื่อสำรองตรง + ต้นสังกัดทั้งสาย + พื้นที่ย่อยของมัน
function shownSet() {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const hit = areas.filter(a => a.name.toLowerCase().includes(q) || aliasesOf(a.id).some(x => x.alias.toLowerCase().includes(q)));
  const out = new Set();
  const down = a => { out.add(a.id); childrenOf(a.id).forEach(down); };
  hit.forEach(a => {
    down(a);
    for (let x = a; x && x.parent_id != null; x = byId(x.parent_id)) out.add(x.parent_id);
  });
  return out;
}

function renderSummary() {
  const n = lv => areas.filter(a => a.level === lv).length;
  const total = areas.filter(a => a.level === 'rwp').reduce((t, a) => t + (stats.get(a.id) ?? 0), 0);
  $('summary').textContent = `${n('phak')} ภาค · ${n('khet')} เขต · ${n('tambon')} ตำบล · ${n('moo')} หมู่ · สมาชิก ${fmt(total)} คน`;
}

function renderTree() {
  renderSummary();
  const shown = shownSet();
  const root = $('tree');
  root.replaceChildren();
  const ul = el('ul', 'tree-ul');
  areas.filter(a => a.parent_id == null && (!shown || shown.has(a.id))).forEach(a => ul.append(renderNode(a, shown)));
  root.append(ul);
  $('noHit').hidden = !shown || shown.size > 0;
  const allOpen = areas.filter(a => childrenOf(a.id).length).every(a => open.has(a.id));
  $('toggleAll').textContent = allOpen ? 'ยุบทั้งหมด' : 'ขยายทั้งหมด';
  $('toggleAll').hidden = !!shown;
  if (!shown) {
    const add = el('button', 'link', 'เพิ่มรวมภาคใหม่');
    add.type = 'button';
    add.addEventListener('click', () => openSheet(null));
    root.append(add);
  }
}

function renderNode(a, shown) {
  const kids = childrenOf(a.id).filter(k => !shown || shown.has(k.id));
  const expandable = childrenOf(a.id).length > 0;
  const isOpen = shown ? true : open.has(a.id);
  const li = el('li', `node lv-${a.level}`);
  const row = el('div', 'row');

  const main = el('button', 'main');
  main.type = 'button';
  if (expandable) {
    main.setAttribute('aria-expanded', String(isOpen));
    main.addEventListener('click', () => {
      if (shown) return;
      isOpen ? open.delete(a.id) : open.add(a.id);
      try { localStorage.setItem(OPEN_KEY, JSON.stringify([...open])); } catch { /* ignore */ }
      renderTree();
    });
  } else {
    main.addEventListener('click', () => openSheet(a.id));
  }
  main.append(expandable ? icon('chev') : el('span', 'ico-gap'), el('span', 'name', a.name), el('span', 'count', `${fmt(stats.get(a.id) ?? 0)} คน`));
  const edit = el('button', 'edit', 'แก้ไข');
  edit.type = 'button';
  edit.setAttribute('aria-label', `แก้ไข ${LEVEL_TH[a.level]}${a.name}`);
  edit.addEventListener('click', () => openSheet(a.id));
  row.append(main, edit);
  li.append(row);

  const al = aliasesOf(a.id);
  if (al.length) li.append(el('p', 'aliases', `ชื่อสำรอง: ${al.map(x => x.alias).join(', ')}`));
  if (kids.length && isOpen) {
    const ul = el('ul', 'tree-ul');
    kids.forEach(k => ul.append(renderNode(k, shown)));
    li.append(ul);
  }
  return li;
}

// ---------- แผงแก้ไข ----------
function setStatus(text, kind) {
  const s = $('sheetStatus');
  s.textContent = text || '';
  s.className = `status ${kind || ''}`;
  s.hidden = !text;
}

function openSheet(id) {
  sheetId = id;
  renderSheet();
  setStatus('');
  if (!$('sheet').open) $('sheet').showModal();
}

// ทำงานหนึ่งอย่าง แล้วโหลดใหม่และวาดแผงเดิมซ้ำ (แผงไม่ปิด จะได้แก้ต่อได้)
async function act(fn, okText) {
  setStatus('กำลังบันทึก…', 'busy');
  try {
    await fn();
    await loadAll();
    renderAll();
    if (sheetId != null && !byId(sheetId)) { $('sheet').close(); return; }
    renderSheet();
    setStatus(okText, 'ok');
  } catch (e) {
    setStatus(e.code === '42501' ? 'ไม่มีสิทธิ์จัดการพื้นที่' : e.message, 'err');
  }
}

function section(title, ...kids) {
  const s = el('section', 'sec');
  s.append(el('h3', '', title), ...kids);
  return s;
}

function textForm(label, placeholder, value, btnLabel, onSubmit) {
  const f = el('form', 'inline-form');
  const l = el('label');
  l.append(el('span', 'sr', label));
  const i = el('input');
  i.type = 'text'; i.maxLength = 100; i.required = true; i.autocomplete = 'off'; i.placeholder = placeholder; i.value = value;
  l.append(i);
  const b = el('button', 'btn-solid', btnLabel);
  b.type = 'submit';
  f.append(l, b);
  f.addEventListener('submit', e => { e.preventDefault(); onSubmit(i.value.trim()); });
  return f;
}

function renderSheet() {
  const body = $('sheetBody');
  body.replaceChildren();
  // sheetId null = เพิ่มรวมภาคใหม่
  if (sheetId == null) {
    $('sheetPath').textContent = '';
    $('sheetTitle').textContent = 'เพิ่มรวมภาคใหม่';
    $('sheetMeta').textContent = '';
    body.append(section('ชื่อรวมภาค', textForm('ชื่อรวมภาค', 'เช่น กรุงเทพ 12', '', 'เพิ่ม', name => act(() => rpc('area_add', { p_parent: null, p_name: name }), 'เพิ่มแล้ว'))));
    return;
  }
  const a = byId(sheetId);
  if (!a) return;
  const n = stats.get(a.id) ?? 0, kids = childrenOf(a.id), nl = nextLevel(a);
  $('sheetPath').textContent = pathOf(a).slice(0, -1).join(' › ');
  $('sheetTitle').textContent = a.name;
  $('sheetMeta').textContent = `${LEVEL_TH[a.level]} · สมาชิก ${fmt(n)} คน${kids.length ? ` · ${kids.length} ${LEVEL_TH[nl]}` : ''}`;

  // ชื่อ
  if (NO_RENAME.has(a.level)) {
    body.append(section('ชื่อ', el('p', 'dim', `ยังเปลี่ยนชื่อ${LEVEL_TH[a.level]}ไม่ได้ เพราะโปรเจกต์อื่นยังใช้ชื่อนี้อยู่`)));
  } else {
    const f = textForm('ชื่อ', 'ชื่อพื้นที่', a.name, 'บันทึกชื่อ', name => {
      if (name === a.name) return setStatus('ชื่อเหมือนเดิม', 'err');
      act(() => rpc('area_rename', { p_id: a.id, p_name: name }), 'เปลี่ยนชื่อแล้ว');
    });
    body.append(section('ชื่อ', f, el('p', 'dim', n ? `จะแก้ชื่อในข้อมูลสมาชิก ${fmt(n)} คนให้ด้วย และเก็บชื่อเดิมเป็นชื่อสำรอง` : 'ยังไม่มีสมาชิกในพื้นที่นี้')));
  }

  // เพิ่มพื้นที่ย่อย
  if (nl) {
    body.append(section(`เพิ่ม${LEVEL_TH[nl]}ใน ${a.name}`,
      textForm(`ชื่อ${LEVEL_TH[nl]}ใหม่`, `ชื่อ${LEVEL_TH[nl]}ใหม่`, '', 'เพิ่ม', name => {
        open.add(a.id);
        act(() => rpc('area_add', { p_parent: a.id, p_name: name }), `เพิ่ม${LEVEL_TH[nl]} "${name}" แล้ว`);
      })));
  }

  // ชื่อสำรอง
  const al = aliasesOf(a.id);
  const chips = el('div', 'chips');
  al.forEach(x => {
    const c = el('span', 'alias', x.alias);
    const rm = el('button', 'alias-x');
    rm.type = 'button';
    rm.setAttribute('aria-label', `ลบชื่อสำรอง ${x.alias}`);
    rm.append(icon('x'));
    rm.addEventListener('click', () => act(() => rpc('area_alias_delete', { p_alias_id: x.id }), 'ลบชื่อสำรองแล้ว'));
    c.append(rm);
    chips.append(c);
  });
  body.append(section('ชื่อสำรอง',
    el('p', 'dim', 'ชื่อที่โปรเจกต์หรือไฟล์อื่นสะกดต่างออกไป ระบบจะรู้ว่าเป็นพื้นที่เดียวกัน'),
    al.length ? chips : el('p', 'dim', 'ยังไม่มี'),
    textForm('ชื่อสำรองใหม่', 'เพิ่มชื่อสำรอง', '', 'เพิ่ม', alias => act(() => rpc('area_alias_add', { p_id: a.id, p_alias: alias }), 'เพิ่มชื่อสำรองแล้ว'))));

  // ลำดับ
  const sibs = areas.filter(x => (x.parent_id ?? 0) === (a.parent_id ?? 0));
  if (sibs.length > 1) {
    const i = sibs.findIndex(x => x.id === a.id);
    const go = d => {
      const ids = sibs.map(x => x.id);
      [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
      act(() => rpc('area_reorder', { p_ids: ids }), 'จัดลำดับแล้ว');
    };
    const up = el('button', 'btn-outline', 'เลื่อนขึ้น'), down = el('button', 'btn-outline', 'เลื่อนลง');
    up.type = down.type = 'button';
    up.disabled = i === 0; down.disabled = i === sibs.length - 1;
    up.addEventListener('click', () => go(-1)); down.addEventListener('click', () => go(1));
    const r = el('div', 'btn-row');
    r.append(up, down);
    body.append(section('ลำดับ', el('p', 'dim', `ลำดับที่ ${i + 1} จาก ${sibs.length} ในกลุ่มเดียวกัน`), r));
  }

  // ลบ
  const del = el('button', 'btn-danger', `ลบ${LEVEL_TH[a.level]}นี้`);
  del.type = 'button';
  const why = kids.length ? `ลบไม่ได้ ยังมี${LEVEL_TH[nl]}อยู่ข้างใน ${kids.length} แห่ง ต้องลบข้างในก่อน`
    : n ? `ลบไม่ได้ ยังมีสมาชิก ${fmt(n)} คนอยู่ในพื้นที่นี้` : '';
  del.disabled = !!why;
  del.addEventListener('click', () => {
    if (!confirm(`ลบ${LEVEL_TH[a.level]} "${a.name}" ?`)) return;
    act(() => rpc('area_delete', { p_id: a.id }), 'ลบแล้ว');
  });
  body.append(section('ลบ', del, why ? el('p', 'dim', why) : el('p', 'dim', 'ลบแล้วย้อนกลับไม่ได้')));
}

// ---------- ชื่อที่ไม่ตรง ----------
function renderMismatch() {
  const list = $('mmList');
  list.replaceChildren();
  const badge = $('mmCount');
  badge.hidden = !mismatches.length;
  badge.textContent = mismatches.length;
  if (!mismatches.length) return list.append(el('p', 'ok-note', 'ชื่อพื้นที่ทุกแห่งในข้อมูลสมาชิก ตรงกับโครงสร้างแล้ว'));
  mismatches.forEach(m => {
    const names = [m.rwp_nt, m.phak_nt, m.sh_nt, m.ch_nt, m.ha_nt];
    const bad = LEVELS.indexOf(m.bad_level);
    const card = el('div', 'mm');
    card.append(el('p', 'mm-title', `${LEVEL_TH[m.bad_level]} "${names[bad]}" ยังไม่มีในโครงสร้าง`));
    card.append(el('p', 'dim', `${names.filter(n => n != null).join(' › ')} · สมาชิก ${fmt(m.members)} คน`));
    const parent = bad === 0 ? null : areas.find(a => a.level === LEVELS[bad - 1] && pathOf(a).join('\u0001') === names.slice(0, bad).join('\u0001'));
    if (bad === 0 || parent) {
      const b = el('button', 'btn-solid', `เพิ่ม${LEVEL_TH[m.bad_level]}นี้เข้าโครงสร้าง`);
      b.type = 'button';
      b.addEventListener('click', async () => {
        b.disabled = true;
        try { await rpc('area_add', { p_parent: parent ? parent.id : null, p_name: names[bad] }); await loadAll(); renderAll(); }
        catch (e) { b.disabled = false; alert(e.message); }
      });
      card.append(b);
    } else card.append(el('p', 'dim', `ต้องเพิ่ม${LEVEL_TH[LEVELS[bad - 1]]}ที่อยู่ข้างบนก่อน`));
    list.append(card);
  });
}

// ---------- ประวัติ ----------
const ACTION_TH = { add: 'เพิ่ม', rename: 'เปลี่ยนชื่อ', delete: 'ลบ', alias_add: 'เพิ่มชื่อสำรอง', alias_delete: 'ลบชื่อสำรอง' };
async function renderLog() {
  const list = $('logList');
  list.replaceChildren(el('p', 'dim', 'กำลังโหลด…'));
  try {
    const rows = await rpc('area_changes_list', { p_limit: 100 });
    list.replaceChildren();
    if (!rows.length) return list.append(el('p', 'dim', 'ยังไม่มีการแก้ไข'));
    rows.forEach(r => {
      const d = r.detail || {};
      const extra = r.action === 'rename' ? ` (ชื่อเดิม "${d.from}" · สมาชิก ${d.members} คน)` : d.alias ? ` "${d.alias}"` : '';
      const li = el('div', 'log');
      li.append(el('p', 'log-title', `${ACTION_TH[r.action] || r.action}${r.level ? LEVEL_TH[r.level] : ''}${extra}`),
        el('p', '', r.path || ''),
        el('p', 'dim', `${new Date(r.at).toLocaleString('th-TH')} · ${r.by_name || '-'}`));
      list.append(li);
    });
  } catch (e) { list.replaceChildren(el('p', 'err-note', e.message)); }
}

function renderAll() { renderTree(); renderMismatch(); }

// ---------- เริ่มต้น ----------
function applyTheme() {
  try { const th = localStorage.getItem("bkk11-theme"); if (th === "light" || th === "dark") document.documentElement.dataset.theme = th; } catch (e) {}
}

function initUi() {
  $('search').addEventListener('input', e => { query = e.target.value; renderTree(); });
  $('toggleAll').addEventListener('click', () => {
    const parents = areas.filter(a => childrenOf(a.id).length);
    const allOpen = parents.every(a => open.has(a.id));
    open = new Set(allOpen ? [] : parents.map(a => a.id));
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...open])); } catch { /* ignore */ }
    renderTree();
  });
  $('sheetClose').addEventListener('click', () => $('sheet').close());
  // แตะนอกแผงเพื่อปิด
  $('sheet').addEventListener('click', e => { if (e.target === $('sheet')) $('sheet').close(); });
  $('sheet').addEventListener('close', () => { sheetId = null; });
}

function initTabs() {
  document.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]').forEach(x => x.setAttribute('aria-selected', String(x === t)));
    $('paneTree').hidden = t.dataset.tab !== 'tree';
    $('paneMismatch').hidden = t.dataset.tab !== 'mismatch';
    $('paneLog').hidden = t.dataset.tab !== 'log';
    if (t.dataset.tab === 'log') renderLog();
  }));
}

async function init() {
  applyTheme();
  initTabs();
  initUi();
  let s = load();
  const until = s && s.profile && s.profile.session_until;
  if (!s || (until && Date.now() >= Date.parse(until))) { $('signin-hint').hidden = false; return showMsg('ยังไม่ได้เข้าสู่ระบบ'); }
  if (!fresh(s)) {
    s = await refresh(s);
    if (!s) { clear(); $('signin-hint').hidden = false; return showMsg('หมดเวลาเข้าสู่ระบบ'); }
  }
  $('who').textContent = (s.profile && s.profile.name) || '';
  try {
    try { open = new Set(JSON.parse(localStorage.getItem(OPEN_KEY)) || []); } catch (e) { open = new Set(); }
    await loadAll();
  } catch (e) {
    if (e.status === 401) { $('signin-hint').hidden = false; return showMsg('หมดเวลาเข้าสู่ระบบ'); }
    return showMsg(e.code === '42501' || e.status === 403
      ? 'หน้านี้เปิดได้เฉพาะหัวหน้ายุวชนชาย ระดับรวมภาค'
      : `โหลดข้อมูลไม่สำเร็จ (${e.message})`);
  }
  if (!open.size) areas.filter(a => a.level === 'rwp' || a.level === 'phak').forEach(a => open.add(a.id));
  showMsg('');
  $('content').hidden = false;
  renderAll();
}

init();
})();
