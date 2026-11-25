(function () {
  "use strict";
  const URL_ = "https://cqdzfsucpivsgznfpjxl.supabase.co";
  const PUBLISHABLE_KEY = "sb_publishable_XkUBjE3M7HUiuDv7YwsbKA_mSu0ToEc";
  const SESSION_KEY = "tokan_session_v1";
  const FEATURES = [["items", "ต้องส่ง"], ["maps", "แผนที่"], ["access", "จัดการสิทธิ์"]];
  const LABEL = { ...Object.fromEntries(FEATURES), signin: "เข้าระบบ" };

  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  try { const savedTheme = localStorage.getItem("bkk11-theme"); if (savedTheme === "light" || savedTheme === "dark") document.documentElement.dataset.theme = savedTheme; } catch (e) {}

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
      try { r = await fetch(`${URL_}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { apikey: PUBLISHABLE_KEY, "content-type": "application/json" }, body: JSON.stringify({ refresh_token: base.refresh_token }) }); } catch (e) { return null; }
      if (!r.ok) { const again = load(); return again && fresh(again) ? again : null; }
      const d = await r.json();
      const next = { ...base, access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at };
      save(next);
      return next;
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  async function rpc(fn, body) {
    let s = load();
    if (!s) throw Object.assign(new Error("signed out"), { status: 401 });
    const fetchWithToken = token => fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: PUBLISHABLE_KEY, Authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify(body || {}) });
    let r = await fetchWithToken(s.access_token);
    if (r.status === 401) {
      s = await refresh(s);
      if (!s) throw Object.assign(new Error("expired"), { status: 401 });
      r = await fetchWithToken(s.access_token);
    }
    const responseText = await r.text();
    if (!r.ok) { let detail = ""; try { detail = JSON.parse(responseText).message || ""; } catch (e) {} throw Object.assign(new Error(fn + " " + r.status), { status: r.status, detail }); }
    return responseText ? JSON.parse(responseText) : null;
  }

  function show(view) {
    for (const id of ["loading", "login", "denied", "app"]) $(id).hidden = id !== view;
    $("logout").hidden = !(view === "app" || view === "denied");
    if (view !== "app") $("who").textContent = "";
  }
  function showLogin(msg) {
    show("login");
    $("login-err").textContent = msg || "";
    $("login-err").hidden = !msg;
    (($("login-name").value ? $("login-code") : $("login-name"))).focus();
  }

  let isOwner = false;
  let people = [], mode = "all", query = "", faFilter = "", sortKey = "name", sortDir = 1;
  const norm = s => String(s == null ? "" : s).toLowerCase().replace(/\s+/g, "");
  const has = (p, f) => p.is_owner || (p.features || []).includes(f);
  const canSignIn = p => p.signin !== false;
  const fmtDate = v => { if (!v) return "–"; const d = new Date(v); return isNaN(d) ? "–" : d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" }); };

  function setStatus(msg, bad) { const s = $("status"); s.textContent = msg || ""; s.classList.toggle("bad", !!bad); }

  function renderStats() {
    const countFor = f => people.filter(p => has(p, f)).length;
    $("stats").replaceChildren(
      ...[["ลงทะเบียนแล้ว", people.length], ["เข้าระบบได้", people.filter(canSignIn).length], ...FEATURES.map(([k, l]) => ["ใช้ " + l + " ได้", countFor(k)])].map(([label, v]) => { const d = el("div", "stat"); d.append(el("b", null, String(v)), el("span", null, label)); return d; }));
    for (const [k] of FEATURES) $("cnt-" + k).textContent = countFor(k) + " คน";
    $("cnt-signin").textContent = people.filter(canSignIn).length + " คน";
  }

  const compareThai = (a, b) => String(a || "").localeCompare(String(b || ""), "th");
  const SORTS = {
    name: (a, b) => compareThai(a.name, b.name),
    po: (a, b) => compareThai(a.po, b.po),
    fa: (a, b) => compareThai(a.fa, b.fa),
    area: (a, b) => compareThai(a.phak, b.phak) || compareThai(a.khet, b.khet),
    when: (a, b) => (Date.parse(a.last_login) || 0) - (Date.parse(b.last_login) || 0),
    signin: (a, b) => Number(canSignIn(a)) - Number(canSignIn(b)),
    items: (a, b) => Number(has(a, "items")) - Number(has(b, "items")),
    maps: (a, b) => Number(has(a, "maps")) - Number(has(b, "maps")),
    access: (a, b) => Number(has(a, "access")) - Number(has(b, "access"))
  };
  const sorted = list => list.map((p, i) => [p, i]).sort((x, y) => sortDir * SORTS[sortKey](x[0], y[0]) || compareThai(x[0].name, y[0].name) || x[1] - y[1]).map(x => x[0]);

  function renderFaOptions() {
    const sel = $("fa"), faList = [...new Set(people.map(p => p.fa).filter(Boolean))].sort(compareThai);
    sel.replaceChildren(new Option("ทุกฝ่าย", ""), ...faList.map(f => new Option(f, f)));
    if (!faList.includes(faFilter)) faFilter = "";
    sel.value = faFilter;
  }
  function renderSort() {
    for (const header of document.querySelectorAll("#tbl thead th[data-sort]")) header.setAttribute("aria-sort", header.dataset.sort === sortKey ? (sortDir === 1 ? "ascending" : "descending") : "none");
    $("sortkey").value = sortKey;
    $("sortdir").textContent = sortDir === 1 ? "↑" : "↓";
  }

  function visible() {
    const q = norm(query);
    return people.filter(p => {
      if (faFilter && p.fa !== faFilter) return false;
      if (mode === "some" && !(p.is_owner || (p.features || []).length)) return false;
      if (mode === "none" && (p.is_owner || (p.features || []).length)) return false;
      return !q || norm([p.name, p.po, p.fa, p.phak, p.khet].join(" ")).includes(q);
    });
  }

  function renderRows() {
    const list = sorted(visible());
    renderSort();
    $("rows").replaceChildren(...list.map(p => {
      const row = el("tr");
      row.dataset.ref = p.ref;
      const nameCell = el("td", "nm"), name = el("span", "name", p.name || "-");
      nameCell.append(name);
      if (p.is_owner) nameCell.append(el("span", "badge", "เจ้าของ"));
      row.append(nameCell, el("td", "po sub", p.po || ""), el("td", "fa sub", p.fa || ""), el("td", "ar sub", [p.phak && "ภาค" + p.phak, p.khet && "เขต" + p.khet].filter(Boolean).join(" · ")), el("td", "when", fmtDate(p.last_login)));
      for (const [key, label] of [["signin", "เข้าระบบ"], ...FEATURES]) {
        const cell = el("td", "chk"), labelEl = el("label"), checkboxEl = el("input");
        checkboxEl.type = "checkbox";
        checkboxEl.dataset.feature = key;
        checkboxEl.checked = key === "signin" ? canSignIn(p) : has(p, key);
        checkboxEl.disabled = !!p.is_owner || (key === "access" && !isOwner);
        checkboxEl.title = p.is_owner ? "เจ้าของใช้ได้ทุกอย่างเสมอ" : key === "access" && !isOwner ? "เฉพาะเจ้าของที่ติ๊กช่องนี้ได้" : key === "signin" && !canSignIn(p) ? "ถูกปลดสิทธิ์: ติ๊กเพื่อคืนสิทธิ์ (ต้องออกลิงก์ใหม่ให้เขา)" : "";
        checkboxEl.setAttribute("aria-label", `${label}: ${p.name}`);
        checkboxEl.addEventListener("change", () => toggle(p, key, checkboxEl, row));
        labelEl.append(checkboxEl, el("span", "sr", label));
        cell.append(labelEl);
        row.append(cell);
      }
      return row;
    }));
    $("empty").hidden = list.length > 0;
    $("tbl").hidden = list.length === 0;
  }

  async function toggle(p, key, checkboxEl, row) {
    const want = checkboxEl.checked;
    checkboxEl.disabled = true;
    row.classList.add("saving");
    setStatus("กำลังบันทึก…");
    try {
      let on;
      if (key === "signin") {
        on = await rpc("access_signin_set", { p_ref: p.ref, p_on: want });
        p.signin = !!on;
      } else {
        on = await rpc("access_set", { p_ref: p.ref, p_feature: key, p_on: want });
        p.features = (p.features || []).filter(f => f !== key);
        if (on) p.features.push(key);
      }
      checkboxEl.checked = !!on;
      renderStats();
      setStatus(key === "signin"
        ? `บันทึกแล้ว: ${p.name} · ${on ? "คืนสิทธิ์เข้าระบบ (ต้องออกลิงก์ใหม่ให้เขา)" : "ปลดสิทธิ์แล้ว ออกจากระบบทุกเครื่อง"}`
        : `บันทึกแล้ว: ${p.name} · ${LABEL[key]} ${on ? "ใช้ได้" : "ใช้ไม่ได้"}`);
      loadLog();
    } catch (e) {
      checkboxEl.checked = !want;
      setStatus(e.status === 403 || e.status === 401 ? "ไม่มีสิทธิ์ทำรายการนี้ (เฉพาะเจ้าของระบบ)" : e.status === 400 && e.detail ? e.detail : "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง", true);
    } finally {
      checkboxEl.disabled = !!p.is_owner || (key === "access" && !isOwner);
      row.classList.remove("saving");
    }
  }

  async function loadLog() {
    try {
      const changes = await rpc("access_changes_list", { p_limit: 30 });
      $("log").replaceChildren(...(changes.length ? changes : [{ target_name: "ยังไม่มีการเปลี่ยนแปลง" }]).map(c => el("li", null,
        (c.at ? new Date(c.at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) + " · " : "") +
        (c.action ? (c.action === "grant" ? "ติ๊ก " : "เอาติ๊กออก ") + (LABEL[c.feature] || c.feature) + " · " : "") + (c.target_name || ""))));
    } catch (e) {  }
  }

  async function loadPeople() {
    setStatus("");
    try {
      people = await rpc("access_people");
    } catch (e) {
      if (e.status === 401) return start();
      show("denied");
      $("denied-text").textContent = e.status === 403 ? "หน้านี้เปิดได้เฉพาะเจ้าของระบบและคนที่ได้รับสิทธิ์จัดการสิทธิ์" : "โหลดรายชื่อไม่สำเร็จ ลองรีเฟรชหน้านี้อีกครั้ง";
      return;
    }
    renderStats();
    renderFaOptions();
    renderRows();
    loadLog();
  }

  async function start() {
    show("loading");
    let s = load();
    if (!s) return showLogin();
    if (!fresh(s)) { s = await refresh(s); if (!s) { clear(); return showLogin("หมดเวลาเข้าสู่ระบบ กรุณาเข้าใหม่"); } }
    let me;
    try { me = await rpc("access_my"); } catch (e) {
      if (e.status === 401) { clear(); return showLogin("หมดเวลาเข้าสู่ระบบ กรุณาเข้าใหม่"); }
      show("denied"); $("denied-text").textContent = "ตรวจสอบสิทธิ์ไม่ได้ ลองรีเฟรชหน้านี้อีกครั้ง"; return;
    }
    const prof = (load() || {}).profile || {};
    if (!me || !(me.owner || (Array.isArray(me.features) && me.features.includes("access")))) {
      show("denied");
      $("who").textContent = prof.name || "";
      $("denied-text").textContent = "บัญชีนี้ยังไม่ได้รับสิทธิ์จัดการสิทธิ์ (เปิดได้เฉพาะเจ้าของระบบและคนที่เจ้าของติ๊กให้) · ถ้าเข้าด้วยบัญชีอื่น กด ออกจากระบบ แล้วเข้าใหม่";
      return;
    }
    isOwner = !!me.owner;
    show("app");
    $("who").textContent = (prof.name || "") + (isOwner ? " · เจ้าของ" : "");
    await loadPeople();
    rpc("is_ymd_rwp_leader").then(ok => { $("open-areas").hidden = ok !== true; }).catch(() => {});
  }

  $("login-form").addEventListener("submit", async e => {
    e.preventDefault();
    $("login-go").disabled = true;
    $("login-err").hidden = true;
    try {
      const r = await fetch(`${URL_}/functions/v1/login`, { method: "POST", headers: { apikey: PUBLISHABLE_KEY, "content-type": "application/json" }, body: JSON.stringify({ name: $("login-name").value, code: $("login-code").value }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.session) { showLogin(d.error && d.error !== "server" ? d.error : "เข้าสู่ระบบไม่สำเร็จ ลองใหม่อีกครั้ง"); return; }
      save({ ...d.session, profile: d.profile });
      $("login-code").value = "";
      await start();
    } catch (err) {
      showLogin("เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง");
    } finally {
      $("login-go").disabled = false;
    }
  });
  $("logout").addEventListener("click", () => { clear(); showLogin(); });
  $("reload").addEventListener("click", loadPeople);
  $("q").addEventListener("input", e => { query = e.target.value; renderRows(); });
  $("mode").addEventListener("change", e => { mode = e.target.value; renderRows(); });
  $("fa").addEventListener("change", e => { faFilter = e.target.value; renderRows(); });
  for (const header of document.querySelectorAll("#tbl thead th[data-sort]")) header.querySelector("button").addEventListener("click", () => {
    sortDir = sortKey === header.dataset.sort ? -sortDir : 1;
    sortKey = header.dataset.sort;
    renderRows();
  });
  $("sortkey").addEventListener("change", e => { sortKey = e.target.value; renderRows(); });
  $("sortdir").addEventListener("click", () => { sortDir = -sortDir; renderRows(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && !$("app").hidden) loadPeople(); });

  start();
})();
