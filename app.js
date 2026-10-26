import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, initializeAuth, inMemoryPersistence, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, updatePassword, deleteUser, reauthenticateWithCredential, EmailAuthProvider }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, onSnapshot, setDoc, addDoc, updateDoc, deleteDoc, getDoc, getDocs, query, where, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js?v=20261026-160614";
import { ZASTEPY, DEFAULT_CONFIG, quarterTotals, akcjaPoints, alarmPoints, alarmProgiMin, progIndex, meldMinute, frac, streakPoints, monday, parseD, fmtD, streakInc, zbiorkaPts, sprawPts } from "./scoring.js?v=20261026-160614";

const BUILD = "20261026-160614";
const app = initializeApp(firebaseConfig), auth = getAuth(app), db = getFirestore(app);

// ---------- wersja aplikacji: sprawdzanie, czy na serwerze jest nowsza (telefony długo trzymają stare pliki)
async function checkUpdate() {
  try {
    const r = await fetch("version.json?t=" + Date.now(), { cache: "no-store" }); if (!r.ok) return;
    const { v } = await r.json();
    if (v && v !== BUILD && BUILD !== "dev") {
      const bar = document.getElementById("upd"); bar.hidden = false;
      bar.onclick = () => location.replace(location.pathname + "?v=" + encodeURIComponent(v));
    }
  } catch (e) {}
}
setInterval(checkUpdate, 60000); document.addEventListener("visibilitychange", () => { if (!document.hidden) checkUpdate(); });
setTimeout(checkUpdate, 3000);
const S = { user: null, profile: null, cfg: DEFAULT_CONFIG, zbiorki: [], akcje: [], alarmy: [], meldunki: [], korekty: [], sprawnosci: [], users: [],
  tab: "wyniki", q: 0, edit: null, view: null, photo: null, busy: false };
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Warsaw" });   // RRRR-MM-DD, czas PL
const currentQ = () => S.cfg.kwartaly.find(q => today() >= q.start && today() <= q.end);
const plDay = d => d ? d.split("-").reverse().join(".") : "–";
const PLF = { timeZone: "Europe/Warsaw", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" };
const plTs = t => { const d = t?.toDate ? t.toDate() : (t != null ? new Date(t) : null); return d && !isNaN(d) ? d.toLocaleString("pl-PL", PLF) : "–"; };
const plTime = ms => ms == null ? "–" : new Date(ms).toLocaleTimeString("pl-PL", { timeZone: "Europe/Warsaw", hour: "2-digit", minute: "2-digit" });
const rola = () => S.profile?.rola || "gosc";
// Administrator = konto kadry z włączonym przełącznikiem "admin" (rola "admin" obsługiwana dla zgodności wstecz).
const isAdm = u => !!u && ((u.rola === "kadra" && u.admin === true) || u.rola === "admin");
const isAdmin = () => isAdm(S.profile);
const isKadra = () => ["kadra", "admin"].includes(rola());                   // admin ma też uprawnienia kadry
const canZglaszac = () => isKadra() || rola() === "zastepowy";               // zbiórki zastępu
const canMeldowac = () => ["szeregowy", "zastepowy"].includes(rola());     // meldunki z alarmów
const quarter = () => S.cfg.kwartaly[S.q] || S.cfg.kwartaly[0];
const inQ = d => d >= quarter().start && d <= quarter().end;
const err = e => alert("Błąd: " + (e?.message || e));
const kto = (imie, uid) => imie || S.users.find(u => u.id === uid)?.imie || (uid ? "kadra" : "–");
const ktoKiedy = (imie, uid, ts) => `${esc(kto(imie, uid))}${ts ? `<div class="mut">${plTs(ts)}</div>` : ""}`;
const myName = () => S.profile?.imie || loginOf(S.user?.email);
const DAY_MS = 86400000;

// ---------- dane na żywo
// Podczas edycji formularza nie przerysowujemy strony (żeby nie gubić wpisywanych danych i kliknięć).
const refresh = () => { autoArchive(); if (!S.edit && !S.busy) renderKeep(); };
// Przerysowanie po zmianie danych z bazy nie kasuje tego, co ktoś właśnie wpisuje w formularzu.
function renderKeep() {
  const keep = [], act = document.activeElement, main = $("#main");
  if (S._rk === rkey()) main?.querySelectorAll("input[id], select[id], textarea[id]").forEach(el => {
    if (!el.readOnly && !["file", "checkbox", "radio", "button", "password"].includes(el.type)) keep.push([el.id, el.value]); });
  const foc = act?.id && main?.contains(act) ? { id: act.id, s: act.selectionStart, e: act.selectionEnd } : null;
  render();
  for (const [id, v] of keep) { const el = document.getElementById(id);
    if (!el || el.value === v || (el.tagName === "SELECT" && ![...el.options].some(o => o.value === v))) continue; el.value = v; }
  if (foc) { const el = document.getElementById(foc.id); if (el && el !== document.activeElement) { el.focus({ preventScroll: true }); try { if (foc.s != null) el.setSelectionRange(foc.s, foc.e); } catch (e) {} } }
}
const rkey = () => S.tab + "|" + (S.view?.kind || "") + "|" + (S.view?.id || "");
S.loaded = {};
onSnapshot(doc(db, "config", "main"), s => { S.cfg = { ...DEFAULT_CONFIG, ...(s.data() || {}) }; S.loaded.cfg = true; pickQuarter(); refresh(); });
const live = (name, key, map = x => x) => onSnapshot(collection(db, name), s => {
  S[key] = s.docs.map(d => map({ id: d.id, ...d.data() })).sort((a, b) => (b.data || "").localeCompare(a.data || "")); S.loaded[key] = true; refresh();
}, e => { console.warn(name, e); S.denied = { ...S.denied, [key]: e.code || "błąd" }; refresh(); });
live("zbiorkiZastepu", "zbiorki"); live("akcje", "akcje"); live("alarmy", "alarmy");
live("korekty", "korekty"); live("sprawnosci", "sprawnosci");
live("meldunki", "meldunki", m => ({ ...m, czasMs: m.czas?.toMillis ? m.czas.toMillis() : (m.czas == null ? Date.now() : Number(m.czas)) }));
let usersUnsub = null, profUnsub = null, secretsUnsub = null, archUnsub = null, zUnsub = null;
onAuthStateChanged(auth, async u => {
  S.user = u; S.profile = null; S.zUsersOf = null; S.secrets = {}; S.edit = null; S.view = null; S.photo = null; S.busy = false; usersUnsub?.(); usersUnsub = null; zUnsub?.(); zUnsub = null; S.zUsers = []; archUnsub?.(); archUnsub = null; S.archiwum = []; S.loaded.archiwum = false; profUnsub?.(); profUnsub = null; secretsUnsub?.(); secretsUnsub = null;
  if (u) {
    const ref = doc(db, "users", u.uid);
    profUnsub = onSnapshot(ref, d => { S.profile = d.data() || null; S.profErr = null;
      // Login zmieniony przez administratora: stary login już nie wpuszcza.
      if (S.typedLogin && S.profile?.login && S.profile.login !== S.typedLogin) { S.typedLogin = null; signOut(auth); alert("Zły login lub hasło."); return; }
      S.typedLogin = null;
      if (isAdmin() && !secretsUnsub) secretsUnsub = onSnapshot(collection(db, "sekrety"), s => { S.secrets = Object.fromEntries(s.docs.map(d => [d.id, d.data().haslo])); refresh(); }, () => {});
      if (isKadra() && !usersUnsub) usersUnsub = onSnapshot(collection(db, "users"), s => { S.users = s.docs.map(d => ({ id: d.id, ...d.data() })); refresh(); });
      if (rola() === "zastepowy" && ZASTEPY.includes(S.profile?.zastep) && S.zUsersOf !== S.profile.zastep) {   // harcerze własnego zastępu
        zUnsub?.(); S.zUsersOf = S.profile.zastep;
        zUnsub = onSnapshot(query(collection(db, "users"), where("zastep", "==", S.profile.zastep)),
          s => { S.zUsers = s.docs.map(d => ({ id: d.id, ...d.data() })); refresh(); }, e => console.warn("zastęp", e));
      }
      if (isKadra() && !archUnsub) archUnsub = onSnapshot(collection(db, "archiwum"), s => {
        S.archiwum = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.start || "").localeCompare(a.start || "")); S.loaded.archiwum = true; autoArchive(); refresh(); }, e => console.warn("archiwum", e));
      refresh(); }, e => { S.profErr = e.code || String(e); render(); });
  }
  render();
});
function pickQuarter() { const t = today(); const i = S.cfg.kwartaly.findIndex(q => t >= q.start && t <= q.end); if (i >= 0 && S._qset !== true) S.q = i; }

// ---------- nawigacja
const TABS = [["wyniki","🏆 Wyniki"],["zbiorki","🔥 Zbiórki zastępu"],["akcje","⛺ Zbiórki drużyny / biwaki"],["alarmy","🚨 Alarmy"],["sprawnosci","🎖 Sprawności"],["ja","👤 Ja"],["ustawienia","⚙️ Ustawienia"],["uzytkownicy","👥 Użytkownicy"]];
const ROLA_TXT = () => ({ admin: "kadra · administrator", kadra: isAdmin() ? "kadra · administrator" : "kadra", zastepowy: "zastępowy · " + (S.profile?.zastep || "bez zastępu"),
  szeregowy: "szeregowy · " + (S.profile?.zastep || "bez zastępu"), brak: "konto nieaktywne" }[rola()] || (S.user && !S.profile ? "konto nieaktywne" : ""));
function renderChrome() {
  $("#who").textContent = S.user ? `${S.profile?.imie || loginOf(S.user.email)} · ${ROLA_TXT()}` : "podgląd wyników";
  $("#authbox").innerHTML = S.user ? `<button id="out">Wyloguj</button>` : `<button id="in">Zaloguj</button>`;
  $("#out") && ($("#out").onclick = () => signOut(auth));
  $("#in") && ($("#in").onclick = () => { S.tab = "login"; render(); });
  const vis = TABS.filter(([k]) => ["uzytkownicy", "ustawienia"].includes(k) ? isKadra() : k === "ja" ? !!(S.user && S.profile) : true);
  $("#nav").innerHTML = vis.map(([k, l]) => `<button data-t="${k}" class="${S.tab === k ? "on" : ""}">${l}</button>`).join("");
  $("#nav").querySelectorAll("button").forEach(b => b.onclick = () => { S.tab = b.dataset.t; S.edit = null; S.view = null; S.back = null; render(); });
}
function quarterPicker() {
  return `<div class="row"><span class="mut">Kwartał:</span><select id="qsel">${S.cfg.kwartaly.map((q, i) =>
    `<option value="${i}" ${i == S.q ? "selected" : ""}>${esc(q.nazwa)} (${plDay(q.start)} – ${plDay(q.end)})</option>`).join("")}</select></div>`;
}
function bindQuarter() { $("#qsel") && ($("#qsel").onchange = e => { S.q = +e.target.value; S._qset = true; render(); }); }

function render() {
  renderChrome(); const ver = $("#ver");
  if (ver) ver.textContent = "wersja " + BUILD + (S.user ? ` · konto ${S.user.uid.slice(0, 6)} · ` + (S.profErr ? `błąd profilu: ${S.profErr}`
    : !S.profile ? "brak profilu" : `rola: ${S.profile.rola}` + (["kadra", "admin"].includes(S.profile.rola) ? ` · admin: ${S.profile.admin === true ? "tak" : S.profile.admin === undefined ? "brak pola" : JSON.stringify(S.profile.admin)}` : "")) : "") + (S.diag ? " · " + S.diag : "");
  const views = { wyniki: vWyniki, zbiorki: vZbiorki, akcje: vAkcje, alarmy: vAlarmy, sprawnosci: vSprawnosci, ustawienia: vUstawienia, uzytkownicy: vUsers, login: vLogin, ja: vJa };
  $("#main").innerHTML = (views[S.tab] || vWyniki)(); S._rk = rkey();
  bindQuarter(); (binders[S.tab] || (() => {}))();
}
const binders = {};

// ---------- logowanie
function vLogin() {
  return `<div class="card"><h2>Logowanie</h2>
  <div class="row"><input id="em" placeholder="Login" autocomplete="username" autocapitalize="none" spellcheck="false"></div>
  <div class="row"><input id="pw" type="password" placeholder="Hasło" autocomplete="current-password"></div>
  <div class="row"><button class="pri" id="li">Zaloguj</button></div>
  <p class="mut">Konta zakłada administrator — od niego dostajesz login i hasło.</p></div>`;
}
const DOMAIN = "@kniejapunkty.firebaseapp.com";
const normLogin = l => String(l || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/ł/g, "l").replace(/\s+/g, ".").replace(/[^a-z0-9._-]/g, "");
const loginOf = e => String(e || "").replace(DOMAIN, "");
const PL_ERR = { "auth/invalid-credential": "Zły login lub hasło.", "auth/invalid-login-credentials": "Zły login lub hasło.",
  "auth/wrong-password": "Zły login lub hasło.", "auth/user-not-found": "Zły login lub hasło.",
  "auth/email-already-in-use": "Takie konto już istnieje.", "auth/weak-password": "Hasło musi mieć co najmniej 6 znaków.",
  "auth/invalid-email": "Nieprawidłowy login.", "auth/too-many-requests": "Za dużo prób. Spróbuj za chwilę." };
binders.login = () => {
  $("#li").onclick = async () => {
    const login = normLogin($("#em").value); if (!login) return alert("Wpisz login");
    try {
      let email = login + DOMAIN;                                   // starsze konta: login = początek e-maila
      try { const m = await getDoc(doc(db, "loginy", login)); if (m.exists()) email = m.data().email; }
      catch (e) { console.warn("loginy:", e.code); S.diag = "brak dostępu do 'loginy' (stare reguły?)"; }
      S.typedLogin = login;
      await signInWithEmailAndPassword(auth, email, $("#pw").value);
      S.tab = "wyniki"; render();
    } catch (e) { S.typedLogin = null; alert(PL_ERR[e.code] || ("Błąd: " + e.message)); }
  };
};

// ---------- WYNIKI
function vWyniki() {
  if (S.view?.kind === "hist") return vHist(null);
  if (S.view?.kind === "chart") return vChart();
  if (S.view?.kind === "arch") return vArch();
  if (S.view?.kind === "odrz") return vOdrz();
  const t = quarterTotals(S.cfg, quarter(), S, today());
  const order = [...ZASTEPY].sort((a, b) => t[b].suma - t[a].suma);
  let pos = 0, last = null;
  const items = order.map((z, i) => { if (t[z].suma !== last) { pos = i + 1; last = t[z].suma; }
    return `<div class="it"><div class="pos">${pos}</div><div><b>${z}</b> <span class="fire">${t[z].streak ? "🔥".repeat(Math.min(t[z].streak, 5)) + " " + t[z].streak : ""}</span>
    <div class="mut">zbiórki ${frac(t[z].zbiorki)} · drużyna ${frac(t[z].akcje)} · alarmy ${frac(t[z].alarmy)} · sprawności ${frac(t[z].sprawnosci)}</div></div>
    <div class="pts">${frac(t[z].suma)}</div></div>`; }).join("");
  const det = ZASTEPY.map(z => `<details><summary><b>${z}</b> — historia streaka</summary><table><tr><th>Tydzień</th><th class="n">n</th><th class="n">Pkt</th><th></th></tr>
    ${t[z].log.map(l => `<tr><td>${plDay(l.tydzien)}</td><td class="n">${l.n}</td><td class="n">${frac(l.pkt)}</td><td class="mut">${l.info || ""}</td></tr>`).join("") || `<tr><td colspan=4 class="mut">brak</td></tr>`}</table></details>`).join("");
  return `<div class="card"><h2>Ranking</h2>${quarterPicker()}<div class="row"><button id="chart">📈 Wykres punktacji</button>${isKadra() ? `<button id="hist">📜 Historia punktów</button><button id="arch">🗄 Archiwum kwartałów</button>` : ""}${odrzBtn()}</div><div class="rank">${items}</div></div><div class="card"><h2>Szczegóły streaków</h2>${det}</div>`;
}

binders.wyniki = () => {
  if (S.view?.kind === "hist") return bindHist(null);
  if (S.view?.kind === "chart") return bindChart();
  if (S.view?.kind === "arch") return bindArch();
  if (S.view?.kind === "odrz") return bindOdrz();
  bindHistBtn(); bindOdrzBtn();
  $("#chart").onclick = () => { S.view = { kind: "chart" }; render(); };
  $("#arch") && ($("#arch").onclick = () => { S.view = { kind: "arch" }; render(); });
};

// ---------- ZBIÓRKI ZASTĘPU
function vZbiorki() {
  if (S.view?.kind === "hist") return vHist("zbiorki");
  const mine = rola() === "zastepowy" ? S.profile.zastep : null;
  const noZ = rola() === "zastepowy" && !ZASTEPY.includes(mine);
  const cq = currentQ();
  const form = !canZglaszac() ? "" : !cq ? `<div class="card"><h2>Zgłoś zbiórkę zastępu</h2><p class="err">Dzisiejsza data nie należy do żadnego kwartału. Kadra musi dodać bieżący kwartał w Ustawieniach.</p></div>`
    : noZ ? `<div class="card"><h2>Zgłoś zbiórkę zastępu</h2><p class="err">Nie masz przypisanego zastępu. Poproś kadrę, żeby przypisała Ci zastęp w zakładce Użytkownicy.</p></div>`
    : `<div class="card"><h2>Zgłoś zbiórkę zastępu</h2><div class="row">
    <select id="zz" ${mine ? "disabled" : ""}>${ZASTEPY.map(z => `<option ${z === (mine || S.zzZ) ? "selected" : ""}>${z}</option>`).join("")}</select>
    <input id="zd" type="date" value="${today()}" min="${cq.start}" max="${cq.end}"><input id="zo" placeholder="krótki opis (opcjonalnie)"></div>
    <div class="row"><label class="sw"><input type="checkbox" id="zs_on" ${S.zsOn ? "checked" : ""}><span></span> Cały zastęp był na zbiórce i robił sprawność</label></div>
    <div id="zs_box" class="za" ${S.zsOn ? "" : "hidden"}>
      <div class="row"><label style="flex:1">Nazwa sprawności<br><input id="zs_n" list="sp_names" placeholder="np. Kucharz" autocomplete="off" style="width:100%"></label></div>${namesList()}
      <div class="row"><span class="mut">Gwiazdki:</span>${starBtns("zg", S.zsG || 1)}</div>
      <div id="zs_list"></div>
      <p class="mut">${isKadra() ? "Sprawność od razu zostanie przyznana (zakładka 🎖 Sprawności)." : "Sprawność i punkty za nią zostaną przyznane dopiero po zatwierdzeniu przez kadrę (osobno, w zakładce 🎖 Sprawności). Do tego czasu nikt jej nie ma i punkty się nie liczą."}</p></div>
    <div class="row"><button class="pri" id="zadd">Zgłoś</button></div>
    <p class="mut">Można zgłaszać tylko zbiórki z bieżącego kwartału: <b>${esc(cq.nazwa)}</b> (${plDay(cq.start)} – ${plDay(cq.end)}).<br>
    Zbiórka liczy się do punktacji dopiero po zatwierdzeniu przez kadrę. Liczy się jedna zbiórka na tydzień (pon–nd).</p></div>`;
  const zCell = z => isKadra() ? `<select data-zs="${z.id}">${ZASTEPY.includes(z.zastep) ? "" : `<option value="">⚠ wybierz</option>`}${ZASTEPY.map(x => `<option ${x === z.zastep ? "selected" : ""}>${x}</option>`).join("")}</select>`
      : (ZASTEPY.includes(z.zastep) ? z.zastep : `<span class="err">brak zastępu</span>`);
  const row = (z, who) => `<tr><td><b>${plDay(z.data)}</b></td><td class="mut">${plTs(z.utworzono)}</td><td>${zCell(z)}</td><td>${esc(z.opis)}${(sp => sp ? `<div class="mut">🎖 ${esc(sp.nazwa)} <span class="gw">${gw(sp.gwiazdki)}</span> · cały zastęp · ${SSTAT[sp.status]?.[1] || esc(sp.status)}</div>` : "")(S.sprawnosci.find(s => s.zbiorkaId === z.id))}${z.status === "odrzucona" ? powodTxt(z.powod) : ""}</td>
    ${who ? `<td>${ktoKiedy(z.zatwierdzilImie, z.zatwierdzil, z.zatwierdzono)}</td>` : ""}<td class="act">
    ${isKadra() && z.status !== "zatwierdzona" ? `<button data-ok="${z.id}">✔ Zatwierdź</button>` : ""}
    ${isKadra() && z.status === "oczekuje" ? `<button data-no="${z.id}" title="Odrzuć">✖</button>` : ""}
    ${(isKadra() || (z.zastep === mine && z.status === "oczekuje")) ? `<button class="del" data-del="${z.id}">Usuń</button>` : ""}</td></tr>`;
  const table = (list, empty, who) => `<div class="scroll"><table><tr><th>Data zbiórki</th><th>Zgłoszono</th><th>Zastęp</th><th>Opis</th>${who ? `<th>${who}</th>` : ""}<th></th></tr>
    ${list.map(z => row(z, who)).join("") || `<tr><td colspan=6 class="mut">${empty}</td></tr>`}</table></div>`;
  // Szeregowy widzi tylko zatwierdzone zbiórki własnego zastępu.
  if (rola() === "szeregowy") {
    const mz = S.profile?.zastep;
    if (!ZASTEPY.includes(mz)) return `<div class="card"><p class="err">Nie masz przypisanego zastępu. Poproś kadrę o przypisanie.</p></div>`;
    const accMine = S.zbiorki.filter(z => z.status === "zatwierdzona" && z.zastep === mz && inQ(z.data));
    return `<div class="card"><h2>✅ Zbiórki zastępu ${esc(mz)} <span class="badge ok">${accMine.length}</span></h2>${quarterPicker()}${table(accMine, "Brak zatwierdzonych zbiórek w tym kwartale", "Zatwierdził")}</div>`;
  }
  const pend = S.zbiorki.filter(z => z.status === "oczekuje");
  const acc = S.zbiorki.filter(z => z.status === "zatwierdzona" && inQ(z.data));
  const rej = S.zbiorki.filter(z => z.status === "odrzucona" && inQ(z.data));
  return (isKadra() ? `<div class="card">${histBtn()}</div>` : "") + form
    + `<div class="card"><h2>⏳ Oczekujące na zatwierdzenie <span class="badge w">${pend.length}</span></h2>${table(pend, "Brak oczekujących zgłoszeń")}</div>`
    + `<div class="card"><h2>✅ Zatwierdzone <span class="badge ok">${acc.length}</span></h2>${quarterPicker()}${table(acc, "Brak zatwierdzonych zbiórek w tym kwartale", "Zatwierdził")}
      ${rej.length ? `<details><summary class="mut">Odrzucone w tym kwartale (${rej.length})</summary>${table(rej, "", "Odrzucił")}</details>` : ""}
      <div class="row">${odrzBtn("❌ Wszystkie odrzucone prośby")}</div></div>`;
}
binders.zbiorki = () => {
  if (S.view?.kind === "hist") return bindHist("zbiorki");
  bindHistBtn();
  const zZ = () => rola() === "zastepowy" ? S.profile.zastep : (S.zzZ || $("#zz")?.value);
  const zInfo = bindCaly("zs", () => ({ z: zZ(), g: S.zsG || 1, nazwa: calyName("zs") }));
  $("#zz") && ($("#zz").onchange = e => { S.zzZ = e.target.value; zInfo(); });
  $("#zs_on") && ($("#zs_on").onchange = e => { S.zsOn = e.target.checked; $("#zs_box").hidden = !S.zsOn; });
  $$("[data-zg]").forEach(b => b.onclick = () => { S.zsG = +b.dataset.zg; $$("[data-zg]").forEach(x => x.classList.toggle("on", x === b)); zInfo(); });
  $("#zadd") && ($("#zadd").onclick = async () => {
    const zastep = rola() === "zastepowy" ? S.profile.zastep : $("#zz").value, data = $("#zd").value;
    if (!ZASTEPY.includes(zastep)) return alert("Wybierz zastęp");
    if (!data) return alert("Wybierz datę");
    const cq = currentQ();
    if (!cq || data < cq.start || data > cq.end) return alert(`Można zgłaszać tylko zbiórki z bieżącego kwartału (${plDay(cq?.start)} – ${plDay(cq?.end)}).`);
    const sp = S.zsOn ? { nazwa: calyName("zs"), g: S.zsG || 1 } : null;
    if (sp && sp.nazwa.length < 2) return alert("Wpisz nazwę sprawności zdobytej przez zastęp (albo wyłącz tę opcję)");
    const target = sp ? calyTarget(zastep, sp.g, sp.nazwa) : null;
    if (sp && !target.uczestnicy.length && !target.mieli.length) return alert(`W zastępie ${zastep} nie ma jeszcze kont harcerzy, więc nie da się dodać sprawności całego zastępu.`);
    if (sp && !target.uczestnicy.length) return alert("Zaznacz, kto zdobył sprawność (nikt nie ma „✔ zdobył(a)”).");
    const btn = $("#zadd"); btn.disabled = true; let ref = null;
    try {
      ref = await addDoc(collection(db, "zbiorkiZastepu"), { zastep, data, opis: $("#zo").value, status: "oczekuje", autor: S.user.uid, utworzono: serverTimestamp() });
      if (sp) await addDoc(collection(db, "sprawnosci"), sprawDoc({ nazwa: sp.nazwa, g: sp.g, data, target, zbiorkaId: ref.id }));
      S.zsOn = false; S.cm = {}; S.cn = {}; ["#zo", "#zs_n"].forEach(k => { const o = $(k); if (o) o.value = ""; }); render();
    } catch (e) { err(ref ? "Zbiórka została zgłoszona, ale sprawności nie udało się zapisać" + (e.code === "permission-denied" ? " (kadra musi wkleić nowe reguły w Firebase)." : ": " + (e.message || e)) : e); }
    const b2 = $("#zadd"); if (b2) b2.disabled = false;
  });
  $$("[data-zs]").forEach(el => el.onchange = () => el.value &&
    updateDoc(doc(db, "zbiorkiZastepu", el.dataset.zs), { zastep: el.value }).catch(err));
  $$("[data-ok]").forEach(b => b.onclick = () => updateDoc(doc(db, "zbiorkiZastepu", b.dataset.ok), { status: "zatwierdzona", zatwierdzil: S.user.uid, zatwierdzilImie: myName(), zatwierdzono: serverTimestamp() }).catch(err));
  $$("[data-no]").forEach(b => b.onclick = async () => { const powod = await askReason("Odrzucić zgłoszenie zbiórki?"); if (powod === null) return;
    updateDoc(doc(db, "zbiorkiZastepu", b.dataset.no), { status: "odrzucona", powod, zatwierdzil: S.user.uid, zatwierdzilImie: myName(), zatwierdzono: serverTimestamp() }).catch(err); });
  bindOdrzBtn();
  $$("[data-del]").forEach(b => b.onclick = () => { const id = b.dataset.del, sp = S.sprawnosci.filter(s => s.zbiorkaId === id && s.status === "oczekuje");
    if (!confirm("Usunąć zgłoszenie?" + (sp.length ? " Czekająca sprawność z tej zbiórki też zostanie usunięta." : ""))) return;
    Promise.all([deleteDoc(doc(db, "zbiorkiZastepu", id)), ...sp.map(s => deleteDoc(doc(db, "sprawnosci", s.id)))]).catch(err); });
};

// ---------- wspólne dla edytorów
const head = () => `<tr><th></th>${ZASTEPY.map(z => `<th class="n">${z}</th>`).join("")}</tr>`;
const numRow = (label, get, path, ph = "") => `<tr><td>${label}</td>${ZASTEPY.map(z =>
  `<td class="n"><input type="number" inputmode="numeric" step="1" data-p="${path(z)}" value="${esc(get(z) ?? "")}" placeholder="${esc(typeof ph === "function" ? ph(z) : ph)}"></td>`).join("")}</tr>`;
function setPath(o, path, v) { const k = path.split("."); let c = o;
  k.slice(0, -1).forEach((p, i) => { if (c[p] == null) c[p] = /^\d+$/.test(k[i + 1]) ? [] : {}; c = c[p]; }); c[k.at(-1)] = v; }
// Wpisywanie aktualizuje dane i tylko podgląd punktów — bez przerysowywania całego formularza.
function bindEditor(preview) {
  $$("[data-p]").forEach(el => { const h = () => {
      const v = el.type === "number" ? (el.value === "" ? null : Number(el.value)) : el.value;
      setPath(S.edit.d, el.dataset.p, v); const pv = $("#pv"); if (pv) pv.innerHTML = preview(); };
    el.oninput = h; el.onchange = h; });
  $$("[data-rm]").forEach(b => b.onclick = () => { const [k, i] = b.dataset.rm.split("."); S.edit.d[k].splice(+i, 1); render(); });
  $("#cancel").onclick = () => doneEdit();
}
// po zapisie/anulowaniu wróć tam, skąd otwarto edycję (np. z historii punktów)
function doneEdit() { S.edit = null; if (S.back) { S.tab = S.back.tab; S.view = S.back.view; S.back = null; } render(); }
const clean = o => JSON.parse(JSON.stringify(o));   // usuwa undefined i dziury w tablicach (Firestore ich nie przyjmuje)
async function saveDoc(col, prep = d => d) {
  const btn = $("#save"); if (btn) { btn.disabled = true; btn.textContent = "Zapisuję…"; }
  const { id, ...data } = S.edit.d;
  const out = clean(prep({ ...data, zmienil: S.user.uid }));
  try { S.edit.id ? await setDoc(doc(db, col, S.edit.id), out) : await addDoc(collection(db, col), out); doneEdit(); }
  catch (e) { err(e); if (btn) { btn.disabled = false; btn.textContent = "Zapisz"; } }
}

// ---------- AKCJE DRUŻYNY
const emptyAkcja = () => ({ typ: "zbiorka", nazwa: "", data: today(), wyniki: {}, gry: [], mundury: [] });
function vAkcje() {
  if (S.edit?.kind === "akcja") return vAkcjaEdit();
  if (S.view?.kind === "hist") return vHist("akcje");
  const list = S.akcje.filter(a => inQ(a.data));
  const rows = list.map(a => { const r = akcjaPoints(S.cfg, a);
    return `<tr><td>${plDay(a.data)}</td><td>${a.typ === "biwak" ? "Biwak" : "Zbiórka"}: ${esc(a.nazwa)}</td>${ZASTEPY.map(z => `<td class="n">${frac(r[z].total)}</td>`).join("")}
    <td>${isKadra() ? `<button data-e="${a.id}">Edytuj</button>` : ""}</td></tr>`; }).join("");
  return `<div class="card"><h2>Zbiórki drużyny i biwaki</h2>${quarterPicker()}
    ${isKadra() ? `<div class="row"><button class="pri" id="anew">+ Nowa zbiórka drużyny / biwak</button><button id="hist">📜 Historia punktów</button></div>` : ""}
    <div class="scroll"><table><tr><th>Data</th><th>Akcja</th>${ZASTEPY.map(z => `<th class="n">${z}</th>`).join("")}<th></th></tr>
    ${rows || `<tr><td colspan=9 class="mut">Brak akcji w tym kwartale</td></tr>`}</table></div>
    <p class="mut">Punkty = (gry + umundurowanie) × obecni / liczebność zastępu.</p></div>`;
}
binders.akcje = () => {
  if (S.edit?.kind === "akcja") return bindAkcjaEdit();
  if (S.view?.kind === "hist") return bindHist("akcje");
  bindHistBtn();
  $("#anew") && ($("#anew").onclick = () => { S.edit = { kind: "akcja", d: emptyAkcja() }; render(); });
  $$("[data-e]").forEach(b => b.onclick = () => {
    const a = S.akcje.find(x => x.id === b.dataset.e); S.edit = { kind: "akcja", id: a.id, d: structuredClone(a) }; render(); });
};
function akcjaPreview() {
  const r = akcjaPoints(S.cfg, S.edit.d);
  return `<table>${head()}
   <tr><td>Gry</td>${ZASTEPY.map(z => `<td class="n">${frac(r[z].gry)}</td>`).join("")}</tr>
   <tr><td>Mundur</td>${ZASTEPY.map(z => `<td class="n">${frac(r[z].mund)}</td>`).join("")}</tr>
   <tr><td>Suma</td>${ZASTEPY.map(z => `<td class="n">${frac(r[z].suma)}</td>`).join("")}</tr>
   <tr><td>× obecni / liczebność</td>${ZASTEPY.map(z => `<td class="n">${r[z].h > 0 ? `${r[z].hob}/${r[z].h}` : "–"}</td>`).join("")}</tr>
   <tr><td><b>Razem</b></td>${ZASTEPY.map(z => `<td class="n"><b>${frac(r[z].total)}</b></td>`).join("")}</tr></table>`;
}
function vAkcjaEdit() {
  if (!isKadra()) { S.edit = null; return vAkcje(); }
  const a = S.edit.d;
  const gry = a.gry.map((g, i) => `<h3><input data-p="gry.${i}.nazwa" value="${esc(g.nazwa)}" placeholder="Nazwa gry">
    <select data-p="gry.${i}.rodzaj"><option value="duza" ${g.rodzaj === "duza" ? "selected" : ""}>duża</option><option value="mala" ${g.rodzaj === "mala" ? "selected" : ""}>mała</option></select>
    <button class="del" data-rm="gry.${i}">Usuń grę</button></h3>
    <div class="scroll"><table>${head()}${numRow("Miejsce (remis = to samo)", z => g.miejsca?.[z], z => `gry.${i}.miejsca.${z}`, "–")}</table></div>`).join("");
  const mund = a.mundury.map((m, i) => `<h3><input data-p="mundury.${i}.nazwa" value="${esc(m.nazwa)}" placeholder="Sprawdzanie munduru ${i + 1}">
    <button class="del" data-rm="mundury.${i}">Usuń</button></h3>
    <div class="scroll"><table>${head()}
    ${numRow("Obecni przy sprawdzaniu", z => m.dane?.[z]?.h, z => `mundury.${i}.dane.${z}.h`, z => a.wyniki?.[z]?.hob ?? "")}
    ${numRow("Liczba błędów", z => m.dane?.[z]?.b, z => `mundury.${i}.dane.${z}.b`)}</table></div>`).join("");
  return `<div class="card"><h2>${S.edit.id ? "Edycja akcji" : "Nowa zbiórka drużyny / biwak"}</h2>
   <div class="row"><select data-p="typ"><option value="zbiorka" ${a.typ === "zbiorka" ? "selected" : ""}>Zbiórka drużyny</option><option value="biwak" ${a.typ === "biwak" ? "selected" : ""}>Biwak</option></select>
   <input type="date" data-p="data" value="${a.data}"><input data-p="nazwa" value="${esc(a.nazwa)}" placeholder="Nazwa"></div>
   <h3>Obecność</h3><div class="scroll"><table>${head()}
   ${numRow("Liczebność zastępu (h)", z => a.wyniki?.[z]?.h, z => `wyniki.${z}.h`, z => String(S.cfg.liczebnosc[z] ?? ""))}
   ${numRow("Obecni (hob)", z => a.wyniki?.[z]?.hob, z => `wyniki.${z}.hob`)}</table></div>
   <p class="mut">Puste h = liczebność z ustawień.</p>
   <h3>Gry</h3>${gry}<div class="row"><button id="gAdd">+ Gra duża</button><button id="mAdd">+ Gra mała</button></div>
   <h3>Umundurowanie</h3><p class="mut">Punkty = ${S.cfg.mundur} × obecni przy sprawdzaniu − błędy (bez dzielenia). Dodają się do punktów z gier i razem z nimi są mnożone przez obecni / liczebność. Liczba obecnych przy sprawdzaniu jest domyślnie taka jak obecnych na zbiórce (szara podpowiedź) — wpisz inną, jeśli się różni; wyczyść pole, żeby wrócić do domyślnej.</p>${mund}<div class="row"><button id="uAdd">+ Sprawdzanie munduru</button></div>
   <h3>Podgląd punktów</h3><div class="scroll" id="pv">${akcjaPreview()}</div>
   <div class="row"><button class="pri" id="save">Zapisz</button><button id="cancel">Anuluj</button>${S.edit.id ? `<button class="del" id="remove">Usuń akcję</button>` : ""}</div></div>`;
}
function bindAkcjaEdit() {
  bindEditor(akcjaPreview); const a = S.edit.d;
  // zmiana obecnych na zbiórce od razu zmienia podpowiedź w sprawdzaniu munduru
  ZASTEPY.forEach(z => { const el = document.querySelector(`[data-p="wyniki.${z}.hob"]`);
    el && el.addEventListener("input", () => $$(`[data-p^="mundury."][data-p$=".dane.${z}.h"]`).forEach(x => x.placeholder = el.value)); });
  $("#gAdd").onclick = () => { a.gry.push({ nazwa: "", rodzaj: "duza", miejsca: {} }); render(); };
  $("#mAdd").onclick = () => { a.gry.push({ nazwa: "", rodzaj: "mala", miejsca: {} }); render(); };
  $("#uAdd").onclick = () => { a.mundury.push({ nazwa: "", dane: {} }); render(); };
  $("#save").onclick = () => { if (!S.edit.d.data) return alert("Wybierz datę"); saveDoc("akcje"); };
  $("#remove") && ($("#remove").onclick = () => confirm("Usunąć akcję?") && deleteDoc(doc(db, "akcje", S.edit.id)).then(() => doneEdit()).catch(err));
}

// ---------- ALARMY
const nP = () => S.cfg.alarmProgi.length;
const progLabels = pm => pm.map((t, i) => `${i ? pm[i - 1] : 0}–${t} min`).concat(`${pm.at(-1) ?? 0}+ min`).slice(0, nP());
const emptyAlarm = () => ({ nazwa: "", data: today(), start: "12:00", progiMin: [...(S.cfg.alarmProgiMin || [20, 40, 60])], dane: {} });
const myMeld = al => S.meldunki.find(m => m.alarmId === al.id && m.uid === S.user?.uid);
const meldOf = al => S.meldunki.filter(m => m.alarmId === al.id);
const MSTAT = { oczekuje: ["w", "✅ Wykonane · czeka na akceptację"], zaakceptowany: ["ok", "✅ Wykonane · zaakceptowane"], odrzucony: ["no", "❌ Odrzucone"] };
function alarmState(al) {
  const now = Date.now();
  if (al.startMs == null) return "brak";
  if (now < al.startMs) return "przed";
  if (now < al.startMs + DAY_MS) return "trwa";
  return "po";
}
function vAlarmy() {
  if (S.edit?.kind === "alarm") return vAlarmEdit();
  if (S.view?.kind === "alarm") return vAlarmDetail();
  if (S.view?.kind === "photos") return vPhotos();
  if (S.view?.kind === "hist") return vHist("alarmy");
  let my = "";
  if (canMeldowac()) {
    const mine = S.profile?.zastep;
    const items = S.alarmy.filter(a => alarmState(a) !== "po" || myMeld(a)).filter(a => inQ(a.data)).map(a => {
      const m = myMeld(a), st = alarmState(a), P = S.photo?.alarmId === a.id ? S.photo : null;
      const status = x => `<span class="badge ${MSTAT[x.status]?.[0]}">${MSTAT[x.status]?.[1] || x.status}</span> <span class="mut">zgłoszono ${plTime(x.czasMs)}${x.zglosil && x.zglosil !== S.user.uid ? ` · zgłosił(a) ${esc(x.zglosilImie || "zastępowy")}` : ""}${x.status !== "oczekuje" && (x.sprawdzilImie || x.sprawdzil) ? ` · ${x.status === "odrzucony" ? "odrzucił" : "zaakceptował"}: ${esc(kto(x.sprawdzilImie, x.sprawdzil))}` : ""}</span>${x.status === "odrzucony" ? powodTxt(x.powod) : ""}`;
      let body;
      if (P && st === "trwa") body = `${P.za ? `<p>Meldunek za: <b>${esc(P.za.imie)}</b></p>` : ""}<img class="ph" src="${P.data}" alt="zdjęcie">
        <div class="row"><button class="pri" data-send="${a.id}">📨 Wyślij meldunek${P.za ? " za " + esc(P.za.imie.split(" ")[0]) : ""}</button><button data-retake="${a.id}">📸 Inne zdjęcie</button><button data-gal="${a.id}" data-keep="1">🖼 Z galerii</button><button data-cancelph>Anuluj</button></div>`;
      else {
        if (m) body = `${status(m)} ${m.status === "oczekuje" && (m.uid === S.user.uid && (!m.zglosil || m.zglosil === S.user.uid)) ? `<button class="del" data-undo="${m.id}">Cofnij</button>` : ""}`;
        else if (!ZASTEPY.includes(mine)) body = `<span class="err">Nie masz przypisanego zastępu — poproś kadrę.</span>`;
        else if (st === "przed") body = `<span class="mut">Start: ${plTs(a.startMs)}</span>`;
        else if (st === "trwa") body = `<div class="row"><button class="pri big" data-meld="${a.id}">📸 Zrób zdjęcie i zamelduj</button></div>
          <div class="row"><button class="big" data-gal="${a.id}">🖼 Wybierz zdjęcie z galerii</button></div>`;
        else body = `<span class="mut">Alarm zakończony</span>`;
        // zastępowy: meldowanie za harcerzy swojego zastępu
        if (rola() === "zastepowy" && ZASTEPY.includes(mine) && st !== "przed") {
          const ms = meldOf(a), done = new Set(ms.map(x => x.uid));
          const mojeZa = ms.filter(x => x.zglosil === S.user.uid && x.uid !== S.user.uid);
          const kand = (S.zUsers || []).filter(u => u.id !== S.user.uid && !done.has(u.id) && u.zastep === mine)
            .sort((x, y) => (x.imie || "").localeCompare(y.imie || "", "pl"));
          body += `<div class="za"><b>👥 Za harcerzy z zastępu</b>
            ${mojeZa.map(x => `<div class="row">${esc(x.imie)} — ${status(x)} ${x.status === "oczekuje" ? `<button class="del" data-undo="${x.id}">Cofnij</button>` : ""}</div>`).join("")}
            ${st === "trwa" ? (kand.length ? `<div class="row"><select id="za_${a.id}"><option value="">– wybierz harcerza –</option>${kand.map(u => `<option value="${u.id}">${esc(u.imie)}</option>`).join("")}</select></div>
              <div class="row"><button data-zcam="${a.id}">📸 Zdjęcie</button><button data-zgal="${a.id}">🖼 Z galerii</button></div>`
              : `<p class="mut">Wszyscy z Twojego zastępu mają już meldunek.</p>`) : ""}</div>`;
        }
      }
      return `<div class="it2"><div><b>${esc(a.nazwa) || "Alarm"}</b> <span class="mut">${plDay(a.data)}${a.start ? ", start " + a.start : ""}</span></div>${body}</div>`;
    }).join("");
    my = `<div class="card"><h2>📣 Meldowanie alarmów</h2>${items || `<p class="mut">Brak trwających alarmów.</p>`}
      <p class="mut">Po wykonaniu alarmu zrób zdjęcie (albo wybierz je z galerii) i wyślij meldunek. Liczy się godzina wysłania. Punkty naliczają się po akceptacji przez kadrę.${rola() === "zastepowy" ? " Jako zastępowy możesz też zameldować harcerza ze swojego zastępu, który nie ma telefonu." : ""}</p></div>`;
  }
  const list = S.alarmy.filter(a => inQ(a.data));
  const rows = list.map(a => { const r = alarmPoints(S.cfg, a, S.meldunki), ms = meldOf(a);
    const cnt = z => ms.filter(m => m.zastep === z && m.status !== "odrzucony").length;
    const pend = ms.filter(m => m.status === "oczekuje").length;
    return `<tr><td>${plDay(a.data)}${a.start ? `<div class="mut">${a.start}</div>` : ""}</td><td>${esc(a.nazwa)}</td>${ZASTEPY.map(z => `<td class="n">${frac(r[z].total)}${cnt(z) ? `<div class="mut">✔ ${cnt(z)}</div>` : ""}</td>`).join("")}
    <td class="act"><button data-v="${a.id}">Meldunki${pend && isKadra() ? ` <span class="badge w">${pend}</span>` : ""}</button>${isKadra() ? `<button data-e="${a.id}">Edytuj</button>` : ""}</td></tr>`; }).join("");
  return my + `<div class="card"><h2>Alarmy</h2>${quarterPicker()}${isKadra() ? `<div class="row"><button class="pri" id="anew">+ Nowy alarm</button><button id="photos">🖼 Zdjęcia z alarmów</button><button id="hist">📜 Historia punktów</button>${odrzBtn("❌ Odrzucone")}</div>` : ""}
    <div class="scroll"><table><tr><th>Data</th><th>Alarm</th>${ZASTEPY.map(z => `<th class="n">${z}</th>`).join("")}<th></th></tr>
    ${rows || `<tr><td colspan=9 class="mut">Brak alarmów w tym kwartale</td></tr>`}</table></div>
    <p class="mut">Punkty liczą tylko zaakceptowane meldunki. „✔ n” = liczba meldunków (także czekających na akceptację).</p></div>`;
}
binders.alarmy = () => {
  if (S.edit?.kind === "alarm") return bindAlarmEdit();
  if (S.view?.kind === "alarm") return bindAlarmDetail();
  if (S.view?.kind === "photos") return bindPhotos();
  if (S.view?.kind === "hist") return bindHist("alarmy");
  bindHistBtn();
  $("#photos") && ($("#photos").onclick = () => { S.view = { kind: "photos" }; render(); }); bindOdrzBtn();
  $("#anew") && ($("#anew").onclick = () => { S.edit = { kind: "alarm", d: emptyAlarm() }; render(); });
  $$("[data-e]").forEach(b => b.onclick = () => {
    const a = S.alarmy.find(x => x.id === b.dataset.e); const d = structuredClone(a);
    d.progiMin = alarmProgiMin(S.cfg, a); S.edit = { kind: "alarm", id: a.id, d }; render(); });
  $$("[data-v]").forEach(b => b.onclick = () => { S.view = { kind: "alarm", id: b.dataset.v }; render(); });
  $$("[data-meld]").forEach(b => b.onclick = () => pickPhoto(b.dataset.meld, false));
  $$("[data-retake]").forEach(b => b.onclick = () => pickPhoto(b.dataset.retake, false, S.photo?.za));
  $$("[data-gal]").forEach(b => b.onclick = () => pickPhoto(b.dataset.gal, true, b.dataset.keep ? S.photo?.za : null));
  const zaWho = aid => { const sel = $("#za_" + aid), u = (S.zUsers || []).find(x => x.id === sel?.value); if (!u) alert("Wybierz harcerza z listy"); return u ? { uid: u.id, imie: u.imie || loginOfUser(u) } : null; };
  $$("[data-zcam]").forEach(b => b.onclick = () => { const za = zaWho(b.dataset.zcam); if (za) pickPhoto(b.dataset.zcam, false, za); });
  $$("[data-zgal]").forEach(b => b.onclick = () => { const za = zaWho(b.dataset.zgal); if (za) pickPhoto(b.dataset.zgal, true, za); });
  $$("[data-cancelph]").forEach(b => b.onclick = () => { S.photo = null; render(); });
  $$("[data-send]").forEach(b => b.onclick = () => sendMeld(b.dataset.send, b));
  $$("[data-undo]").forEach(b => b.onclick = () => confirm("Cofnąć meldunek? Przy ponownym meldunku liczy się nowa godzina.") &&
    Promise.all([deleteDoc(doc(db, "meldunki", b.dataset.undo)), deleteDoc(doc(db, "zdjecia", b.dataset.undo)).catch(() => {})]).catch(err));
};

// --- zdjęcie i meldunek
function pickPhoto(alarmId, gallery, za = null) {
  const inp = $(gallery ? "#galleryInput" : "#photoInput"); inp.value = "";
  inp.onchange = async () => {
    const f = inp.files?.[0]; if (!f) return;
    S.busy = true;
    try { S.photo = { alarmId, data: await compressImage(f), za }; } catch (e) { err("Nie udało się wczytać zdjęcia"); }
    S.busy = false; render();
  };
  inp.click();
}
async function compressImage(file, max = 1280) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    for (let q = 0.75; q >= 0.3; q -= 0.15) { const d = c.toDataURL("image/jpeg", q); if (d.length < 700000) return d; }
    return c.toDataURL("image/jpeg", 0.25);
  } finally { URL.revokeObjectURL(url); }
}
async function sendMeld(alarmId, btn) {
  if (!S.photo || S.photo.alarmId !== alarmId) return alert("Najpierw zrób zdjęcie");
  btn.disabled = true; btn.textContent = "Wysyłam…"; S.busy = true;
  const za = S.photo.za, uid = za ? za.uid : S.user.uid, id = `${alarmId}_${uid}`;
  const zgl = za ? { zglosil: S.user.uid, zglosilImie: myName() } : {};
  try {
    await setDoc(doc(db, "zdjecia", id), { uid, alarmId, img: S.photo.data, ...zgl });
    await setDoc(doc(db, "meldunki", id), { alarmId, uid, imie: za ? za.imie : myName(),
      zastep: S.profile.zastep, status: "oczekuje", czas: serverTimestamp(), ...zgl });
    S.photo = null;
  } catch (e) { err(e.code === "permission-denied" ? "Nie można teraz zameldować (alarm się nie zaczął, już się skończył albo nie masz roli)." : e); }
  S.busy = false; render();
}
async function showPhoto(id) {
  const m = $("#modal"); m.innerHTML = `<div class="box"><p>Ładowanie zdjęcia…</p></div>`; m.hidden = false;
  try { const s = await getDoc(doc(db, "zdjecia", id));
    m.innerHTML = `<div class="box">${s.exists() ? `<img src="${s.data().img}" alt="zdjęcie z meldunku">` : `<p>Brak zdjęcia.</p>`}<button id="mclose">Zamknij</button></div>`;
  } catch (e) { m.innerHTML = `<div class="box"><p class="err">Nie można wczytać zdjęcia.</p><button id="mclose">Zamknij</button></div>`; }
  $("#mclose").onclick = () => { m.hidden = true; m.innerHTML = ""; };
}
document.addEventListener("click", e => { const m = $("#modal"); if (e.target === m) { m.hidden = true; m.innerHTML = ""; } });

// --- wszystkie zdjęcia z alarmów (kadra): podgląd i pobieranie
const plural = (n, one, few, many) => n === 1 ? one : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) ? few : many;
S.photoCache = {};
const safe = t => String(t || "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 60);
const STAT_PL = { oczekuje: "oczekuje", zaakceptowany: "zaakceptowany", odrzucony: "odrzucony" };
const photoName = (m) => `${safe(m.zastep)} - ${safe(m.imie)} - ${plTime(m.czasMs).replace(":", ".")} (${STAT_PL[m.status] || m.status}).jpg`;
const alarmFolder = a => safe(`${a.data} ${a.nazwa || "Alarm"}`);
async function loadPhotos(alarmId) {
  if (S.photoCache[alarmId]) return S.photoCache[alarmId];
  const snap = await getDocs(query(collection(db, "zdjecia"), where("alarmId", "==", alarmId)));
  const ms = Object.fromEntries(meldOf({ id: alarmId }).map(m => [m.id, m]));
  const list = snap.docs.map(d => ({ id: d.id, img: d.data().img, m: ms[d.id] || { imie: "?", zastep: "?", status: "usunięty", czasMs: null } }))
    .sort((x, y) => (x.m.czasMs || 0) - (y.m.czasMs || 0));
  return (S.photoCache[alarmId] = list);
}
let _jszip = null;
const loadJSZip = () => _jszip || (_jszip = new Promise((res, rej) => { const sc = document.createElement("script");
  sc.src = "vendor/jszip.min.js"; sc.onload = () => res(window.JSZip); sc.onerror = () => { _jszip = null; rej(new Error("Nie udało się wczytać modułu ZIP")); }; document.head.appendChild(sc); }));
const inApp = () => typeof window.KniejaApp !== "undefined";
function saveBlob(blob, name) {
  if (inApp()) { const r = new FileReader(); r.onload = () => window.KniejaApp.saveFile(String(r.result).split(",")[1], name, blob.type || "application/octet-stream"); r.readAsDataURL(blob); return; }
  const u = URL.createObjectURL(blob), a = document.createElement("a"); a.href = u; a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 10000); }
async function zipAlarms(alarms, name, btn) {
  const t = btn.textContent; btn.disabled = true; S.busy = true;
  try {
    const JSZip = await loadJSZip(); const zip = new JSZip(); let n = 0;
    for (const a of alarms) { btn.textContent = `Pobieram… ${alarmFolder(a)}`;
      const f = alarms.length > 1 ? zip.folder(alarmFolder(a)) : zip;
      for (const p of await loadPhotos(a.id)) { f.file(photoName(p.m), p.img.split(",")[1], { base64: true }); n++; } }
    if (!n) throw new Error("Brak zdjęć do pobrania");
    btn.textContent = "Pakuję…";
    saveBlob(await zip.generateAsync({ type: "blob" }), name);
  } catch (e) { err(e); }
  btn.disabled = false; btn.textContent = t; S.busy = false; render();
}
function vPhotos() {
  if (!isKadra()) { S.view = null; return vAlarmy(); }
  const list = S.alarmy.filter(a => inQ(a.data)).sort((x, y) => (y.startMs || 0) - (x.startMs || 0));
  const cards = list.map(a => { const ms = meldOf(a), ph = S.photoCache[a.id];
    return `<div class="card"><h3 style="margin-top:0">${esc(a.nazwa) || "Alarm"} <span class="mut">${plDay(a.data)}${a.start ? ", " + a.start : ""}</span></h3>
      <div class="row"><span class="badge">${ms.length} ${plural(ms.length, "meldunek", "meldunki", "meldunków")}</span>
      ${ph ? "" : `<button data-load="${a.id}">Pokaż zdjęcia</button>`}<button data-zip="${a.id}">⬇ Pobierz ZIP</button></div>
      ${ph ? (ph.length ? `<div class="grid">${ph.map(p => `<figure data-big="${a.id}|${p.id}"><img src="${p.img}" alt="" loading="lazy">
        <figcaption><b>${esc(p.m.imie)}</b> · ${esc(p.m.zastep)}<br>${plTime(p.m.czasMs)} · <span class="badge ${MSTAT[p.m.status]?.[0] || ""}">${esc(STAT_PL[p.m.status] || p.m.status)}</span></figcaption></figure>`).join("")}</div>`
        : `<p class="mut">Brak zdjęć.</p>`) : ""}</div>`; }).join("");
  return `<div class="card"><div class="row"><button id="back">← Alarmy</button></div><h2>🖼 Zdjęcia z alarmów</h2>${quarterPicker()}
    <div class="row"><button class="pri" id="zipall" ${list.length ? "" : "disabled"}>⬇ Pobierz wszystkie z kwartału (ZIP)</button></div>
    <p class="mut">W paczce ZIP każdy alarm ma osobny folder, a pliki nazywają się: zastęp – imię i nazwisko – godzina (status).</p></div>
    ${cards || `<div class="card"><p class="mut">Brak alarmów w tym kwartale.</p></div>`}`;
}
function bindPhotos() {
  $("#back").onclick = () => { S.view = null; render(); };
  $$("[data-load]").forEach(b => b.onclick = async () => { b.disabled = true; b.textContent = "Ładuję…"; try { await loadPhotos(b.dataset.load); } catch (e) { err(e); } render(); });
  $$("[data-zip]").forEach(b => b.onclick = () => { const a = S.alarmy.find(x => x.id === b.dataset.zip); zipAlarms([a], `zdjecia ${alarmFolder(a)}.zip`, b); });
  $("#zipall") && ($("#zipall").onclick = () => zipAlarms(S.alarmy.filter(a => inQ(a.data)), `zdjecia ${safe(quarter().nazwa)}.zip`, $("#zipall")));
  $$("[data-big]").forEach(f => f.onclick = () => { const [aid, pid] = f.dataset.big.split("|"); const p = S.photoCache[aid].find(x => x.id === pid);
    const m = $("#modal"); m.hidden = false;
    m.innerHTML = `<div class="box"><img src="${p.img}" alt=""><div class="mut">${esc(p.m.imie)} · ${esc(p.m.zastep)} · ${plTime(p.m.czasMs)}</div>
      <div class="row"><a class="btn pri" id="mdl" href="${p.img}" download="${esc(photoName(p.m))}">⬇ Pobierz</a><button id="mclose">Zamknij</button></div></div>`;
    $("#mclose").onclick = () => { m.hidden = true; m.innerHTML = ""; };
    $("#mdl").onclick = e => { if (!inApp()) return; e.preventDefault(); window.KniejaApp.saveFile(p.img.split(",")[1], photoName(p.m), "image/jpeg"); }; });
}

// --- szczegóły alarmu (meldunki)
function vAlarmDetail() {
  const a = S.alarmy.find(x => x.id === S.view.id); if (!a) { S.view = null; return vAlarmy(); }
  const r = alarmPoints(S.cfg, a, S.meldunki), ms = meldOf(a).sort((x, y) => x.czasMs - y.czasMs), labels = progLabels(alarmProgiMin(S.cfg, a));
  const row = (m, who) => { const min = meldMinute(a, m), pi = min == null ? null : progIndex(S.cfg, a, min);
    return `<tr><td>${plTime(m.czasMs)}<div class="mut">${min == null ? "" : Math.floor(min) + " min"}</div></td><td>${esc(m.imie)}${m.zglosil && m.zglosil !== m.uid ? `<div class="mut">zgłosił(a) ${esc(m.zglosilImie || "zastępowy")}</div>` : ""}${m.status === "odrzucony" ? powodTxt(m.powod) : ""}</td><td>${esc(m.zastep)}</td>
    <td>${pi == null ? "–" : `${pi + 1}. próg<div class="mut">${S.cfg.alarmProgi[pi] ?? 0} pkt</div>`}</td>
    ${who ? `<td>${ktoKiedy(m.sprawdzilImie, m.sprawdzil, m.sprawdzono)}</td>` : ""}<td class="act">${isKadra() || m.uid === S.user?.uid ? `<button data-ph="${m.id}">📷</button>` : ""}
    ${isKadra() && m.status !== "zaakceptowany" ? `<button data-acc="${m.id}">✔ Akceptuj</button>` : ""}
    ${isKadra() && m.status !== "odrzucony" ? `<button data-rej="${m.id}" title="Odrzuć">✖</button>` : ""}</td></tr>`; };
  const tbl = (list, empty, who) => `<div class="scroll"><table><tr><th>Godz.</th><th>Kto</th><th>Zastęp</th><th>Próg</th>${who ? `<th>${who}</th>` : ""}<th></th></tr>
    ${list.map(m => row(m, who)).join("") || `<tr><td colspan=6 class="mut">${empty}</td></tr>`}</table></div>`;
  const pend = ms.filter(m => m.status === "oczekuje"), acc = ms.filter(m => m.status === "zaakceptowany"), rej = ms.filter(m => m.status === "odrzucony");
  return `<div class="card"><div class="row"><button id="back">← Alarmy</button></div>
    <h2>${esc(a.nazwa) || "Alarm"}</h2><p class="mut">${plDay(a.data)}${a.start ? ", start " + a.start : ""} · progi: ${labels.join(" · ")}</p>
    <div class="scroll"><table>${head()}
    <tr><td>Meldunki (zaakc.)</td>${ZASTEPY.map(z => `<td class="n">${r[z].meld}</td>`).join("")}</tr>
    <tr><td>Za osoby</td>${ZASTEPY.map(z => `<td class="n">${frac(r[z].osoby)}</td>`).join("")}</tr>
    <tr><td>Miejsce / bonus</td>${ZASTEPY.map(z => `<td class="n">${r[z].miejsce ? r[z].miejsce + ". / " + r[z].bonus : "–"}</td>`).join("")}</tr>
    <tr><td><b>Razem</b></td>${ZASTEPY.map(z => `<td class="n"><b>${frac(r[z].total)}</b></td>`).join("")}</tr></table></div></div>
    <div class="card"><h2>⏳ Czekają na akceptację <span class="badge w">${pend.length}</span></h2>
    ${isKadra() && pend.length ? `<div class="row"><button class="pri" id="accall">✔ Akceptuj wszystkie (${pend.length})</button></div>` : ""}${tbl(pend, "Brak")}</div>
    <div class="card"><h2>✅ Zaakceptowane <span class="badge ok">${acc.length}</span></h2>${tbl(acc, "Brak", "Zaakceptował")}
    ${rej.length ? `<details><summary class="mut">Odrzucone (${rej.length})</summary>${tbl(rej, "", "Odrzucił")}</details>` : ""}</div>`;
}
function bindAlarmDetail() {
  $("#back").onclick = () => { S.view = null; render(); };
  const set = (id, status) => updateDoc(doc(db, "meldunki", id), { status, sprawdzil: S.user.uid, sprawdzilImie: myName(), sprawdzono: serverTimestamp() }).catch(err);
  $$("[data-acc]").forEach(b => b.onclick = () => set(b.dataset.acc, "zaakceptowany"));
  $$("[data-rej]").forEach(b => b.onclick = async () => { const powod = await askReason("Odrzucić meldunek?"); if (powod === null) return;
    updateDoc(doc(db, "meldunki", b.dataset.rej), { status: "odrzucony", powod, sprawdzil: S.user.uid, sprawdzilImie: myName(), sprawdzono: serverTimestamp() }).catch(err); });
  $$("[data-ph]").forEach(b => b.onclick = () => showPhoto(b.dataset.ph));
  $("#accall") && ($("#accall").onclick = () => confirm("Zaakceptować wszystkie oczekujące meldunki?") &&
    meldOf({ id: S.view.id }).filter(m => m.status === "oczekuje").forEach(m => set(m.id, "zaakceptowany")));
}

// --- edycja alarmu (kadra)
function alarmPreview() {
  const a = S.edit.d, r = alarmPoints(S.cfg, { ...a, id: S.edit.id, startMs: alarmStartMs(a) }, S.meldunki);
  return `<table>${head()}
   <tr><td>Za osoby</td>${ZASTEPY.map(z => `<td class="n">${frac(r[z].osoby)}</td>`).join("")}</tr>
   <tr><td>Miejsce / bonus</td>${ZASTEPY.map(z => `<td class="n">${r[z].miejsce ? r[z].miejsce + ". / " + r[z].bonus : "–"}</td>`).join("")}</tr>
   <tr><td><b>Razem</b></td>${ZASTEPY.map(z => `<td class="n"><b>${frac(r[z].total)}</b></td>`).join("")}</tr></table>
   <p class="mut">Podgląd uwzględnia już zaakceptowane meldunki z aplikacji.</p>`;
}
const alarmStartMs = a => { const t = new Date(`${a.data}T${a.start || "00:00"}`).getTime(); return isNaN(t) ? null : t; };
function vAlarmEdit() {
  if (!isKadra()) { S.edit = null; return vAlarmy(); }
  const a = S.edit.d, labels = progLabels(a.progiMin);
  const rows = labels.map((p, i) => `<tr><td>${p} <span class="mut">(${S.cfg.alarmProgi[i] ?? 0} pkt/os.)</span></td>
    ${ZASTEPY.map(z => `<td class="n"><input type="number" inputmode="numeric" min="0" data-p="dane.${z}.liczby.${i}" value="${a.dane?.[z]?.liczby?.[i] ?? ""}"></td>`).join("")}</tr>`).join("");
  return `<div class="card"><h2>${S.edit.id ? "Edycja alarmu" : "Nowy alarm"}</h2>
   <div class="row"><input data-p="nazwa" value="${esc(a.nazwa)}" placeholder="Nazwa alarmu"></div>
   <div class="row"><label>Dzień <input type="date" data-p="data" value="${a.data}"></label><label>Start <input type="time" data-p="start" value="${a.start || ""}"></label></div>
   <div class="row"><label>Progi czasowe (min) <input id="pmin" value="${a.progiMin.join(", ")}" style="width:120px"></label></div>
   <p class="mut">Np. „20, 40, 60” daje przedziały: ${labels.join(" · ")}. Meldować można od startu przez 24 godziny.</p>
   <details ${rows && Object.keys(a.dane || {}).length ? "open" : ""}><summary><b>Osoby dopisane ręcznie</b> <span class="mut">(bez meldunku w aplikacji)</span></summary>
   <div class="scroll"><table>${head()}${rows}
   <tr><td>Minuta zameldowania <b>pierwszej</b> osoby</td>${ZASTEPY.map(z => `<td class="n"><input type="number" inputmode="numeric" min="0" data-p="dane.${z}.pierwszy" value="${a.dane?.[z]?.pierwszy ?? ""}"></td>`).join("")}</tr>
   </table></div></details>
   <h3>Podgląd</h3><div class="scroll" id="pv">${alarmPreview()}</div>
   <div class="row"><button class="pri" id="save">Zapisz</button><button id="cancel">Anuluj</button>${S.edit.id ? `<button class="del" id="remove">Usuń alarm</button>` : ""}</div></div>`;
}
function bindAlarmEdit() {
  bindEditor(alarmPreview);
  $("#pmin").onchange = () => { const v = $("#pmin").value.split(/[,; ]+/).filter(Boolean).map(Number).filter(n => n > 0).sort((x, y) => x - y);
    if (v.length) S.edit.d.progiMin = v.slice(0, nP() - 1); render(); };
  $("#save").onclick = () => {
    const a = S.edit.d; if (!a.data || !a.start) return alert("Ustaw dzień i godzinę startu");
    saveDoc("alarmy", d => { d.startMs = alarmStartMs(d); delete d.progi;
      for (const z of Object.keys(d.dane || {})) { const x = d.dane[z]; x.liczby = Array.from({ length: nP() }, (_, i) => Number(x.liczby?.[i] || 0)); }
      return d; });
  };
  $("#remove") && ($("#remove").onclick = () => confirm("Usunąć alarm? Meldunki do niego przestaną się liczyć.") && deleteDoc(doc(db, "alarmy", S.edit.id)).then(() => doneEdit()).catch(err));
}

// ---------- SPRAWNOŚCI: wniosek (harcerz albo jego zastępowy) → kadra przyznaje → punkty dla zastępu
const SSTAT = { oczekuje: ["w", "⏳ czeka"], przyznana: ["ok", "✅ przyznana"], odrzucona: ["no", "❌ odrzucona"] };
const gw = n => "★".repeat(Math.max(0, Math.min(3, Number(n) || 0)));
const sprPk = n => frac(sprawPts(S.cfg, { gwiazdki: n }));
const byName = (x, y) => (x.imie || "").localeCompare(y.imie || "", "pl");
// członkowie zastępu, którzy mają konto w aplikacji (szeregowi i zastępowy)
const czlonkowie = z => (isKadra() ? S.users : (S.zUsers || [])).filter(u => u.zastep === z && ["szeregowy", "zastepowy"].includes(u.rola))
  .sort(byName).map(u => ({ uid: u.id, imie: u.imie || loginOfUser(u) }));
const isMineSpr = (s, uid) => s.caly ? (s.uczestnicy || []).some(u => u.uid === uid) : s.uid === uid;
// Sprawność całego zastępu: zastępowy oznacza każdego harcerza — „zdobył(a)” albo „już ma (był(a) na zbiórce)”.
S.cm = {}; S.cn = {};
const names = l => (l || []).map(u => esc(u.imie)).join(", ");
const hasSpr = (uid, nazwa, g) => !!nazwa && S.sprawnosci.some(s => s.status === "przyznana" && (s.nazwa || "").toLowerCase() === nazwa.toLowerCase()
  && Number(s.gwiazdki) >= g && isMineSpr(s, uid));                          // ma już przyznaną (tyle samo albo więcej gwiazdek)
const calyStan = (z, g, nazwa) => czlonkowie(z).map(u => { const ma = hasSpr(u.uid, nazwa, g); return { ...u, ma, st: S.cm[u.uid] || (ma ? "m" : "z") }; });
function calyList(z, g, nazwa) {
  const c = calyStan(z, g, nazwa);
  if (!c.length) return `<p class="err">W zastępie ${esc(z)} nie ma jeszcze kont harcerzy — administrator musi je założyć.</p>`;
  const earn = c.filter(u => u.st === "z").length, one = sprawPts(S.cfg, { gwiazdki: g });
  return `<p class="mut">Zaznacz przy każdym harcerzu: zdobył(a) sprawność na tej zbiórce, czy już ją miał(a), ale był(a) na zbiórce.</p>
    <div class="clist">${c.map(u => `<div class="crow"><span>${esc(u.imie)}${u.ma ? ` <span class="mut">· ma już w aplikacji</span>` : ""}</span>
    <span class="seg"><button data-cm="${u.uid}|z" class="${u.st === "z" ? "on" : ""}">✔ zdobył(a)</button><button data-cm="${u.uid}|m" class="${u.st === "m" ? "on" : ""}">już ma</button></span></div>`).join("")}</div>
    <p class="mut">${earn ? `Zdobyło: <b>${earn}</b> os.${c.length - earn ? ` · już miało: ${c.length - earn} os.` : ""} → ${isKadra() ? "zastęp dostanie" : "po zatwierdzeniu przez kadrę zastęp dostanie"} <b>${earn} × 2 × ${frac(one)} = ${frac(earn * 2 * one)} pkt</b> (jakby każdy, kto zdobył, zdobył ją 2 razy).`
      : `<span class="err">Nikt nie jest zaznaczony jako „zdobył(a)”.</span>`}</p>`;
}
const calySplit = (z, g, nazwa) => { const c = calyStan(z, g, nazwa), pick = st => c.filter(u => u.st === st).map(({ uid, imie }) => ({ uid, imie }));
  return { uczestnicy: pick("z"), mieli: pick("m") }; };
// podłącza listę w kontenerze #<px>_list; ctx() zwraca { z, g, nazwa } albo null (lista ukryta)
function bindCaly(px, ctx) {
  const box = $("#" + px + "_list"); if (!box) return () => {};
  const draw = () => { const c = ctx(); box.hidden = !c; box.innerHTML = c ? calyList(c.z, c.g, c.nazwa) : "";
    box.querySelectorAll("[data-cm]").forEach(b => b.onclick = () => { const [uid, st] = b.dataset.cm.split("|"); S.cm[uid] = st; draw(); }); };
  const inp = $("#" + px + "_n"); inp && inp.addEventListener("input", () => { S.cn[px] = inp.value; draw(); });
  draw(); return draw;
}
const calyName = px => (($("#" + px + "_n")?.value || S.cn[px] || "").trim().replace(/\s+/g, " "));
const sprPtsTxt = s => s.caly ? `${(s.uczestnicy || []).length} × 2 × ${sprPk(s.gwiazdki)} = ${frac(sprawPts(S.cfg, s))} pkt` : `${frac(sprawPts(S.cfg, s))} pkt`;
const sprKto = s => s.caly ? `<details><summary>👥 Cały zastęp · ${(s.uczestnicy || []).length} zdobyło${(s.mieli || []).length ? ` · ${s.mieli.length} już miało` : ""}</summary>
  <div class="mut">Zdobyli: ${names(s.uczestnicy) || "–"}${(s.mieli || []).length ? `<br>Już mieli (byli na zbiórce): ${names(s.mieli)}` : ""}</div></details>` : esc(s.imie);
const starBtns = (attr, g) => [1, 2, 3].map(n => `<button data-${attr}="${n}" class="${g === n ? "on" : ""}"><span class="gw">${gw(n)}</span> <span class="mut">${sprPk(n)} pkt</span></button>`).join("");
const namesList = () => `<datalist id="sp_names">${[...new Set(S.sprawnosci.map(x => x.nazwa).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pl")).map(n => `<option value="${esc(n)}">`).join("")}</datalist>`;
const calyTarget = (z, g, nazwa) => ({ caly: true, uid: S.user.uid, imie: `Cały zastęp ${z}`, zastep: z, ...calySplit(z, g, nazwa) });
function sprawDoc({ nazwa, g, data, target, zbiorkaId }) {
  const kadra = isKadra();
  return { ...target, nazwa, gwiazdki: g, data, status: kadra ? "przyznana" : "oczekuje", autor: S.user.uid, autorImie: myName(), utworzono: serverTimestamp(),
    ...(zbiorkaId ? { zbiorkaId } : {}), ...(kadra ? { sprawdzil: S.user.uid, sprawdzilImie: myName(), sprawdzono: serverTimestamp() } : {}) };
}
function vSprawnosci() {
  if (S.edit?.kind === "sprawnosc") return vSprawEdit();
  if (S.view?.kind === "hist") return vHist("sprawnosci");
  const r = rola(), mine = S.profile?.zastep, cq = currentQ(), me = S.user?.uid;
  const denied = S.denied?.sprawnosci ? `<div class="card"><p class="err">Brak dostępu do sprawności w bazie — kadra musi wkleić nowe reguły w Firebase (Firestore → Rules).</p></div>` : "";
  // --- formularz wniosku / przyznania
  let form = "";
  if (S.user && (isKadra() || canMeldowac())) {
    const title = isKadra() ? "🎖 Przyznaj sprawność" : "🎖 Wniosek o sprawność";
    if (!cq) form = `<div class="card"><h2>${title}</h2><p class="err">Dzisiejsza data nie należy do żadnego kwartału. Kadra musi dodać bieżący kwartał w Ustawieniach.</p></div>`;
    else if (!isKadra() && !ZASTEPY.includes(mine)) form = `<div class="card"><h2>${title}</h2><p class="err">Nie masz przypisanego zastępu — poproś kadrę.</p></div>`;
    else {
      let whoSel = "";
      const sel = v => S.spU === v ? "selected" : "", caly = z => `<option value="__caly:${z}" ${sel("__caly:" + z)}>👥 Cały zastęp ${z} (zbiórka całego zastępu)</option>`;
      if (isKadra()) {
        const c = S.users.filter(u => ["szeregowy", "zastepowy"].includes(u.rola) && ZASTEPY.includes(u.zastep));
        whoSel = `<select id="sp_u"><option value="">– wybierz harcerza –</option>${ZASTEPY.map(z => { const g = c.filter(u => u.zastep === z).sort(byName);
          return g.length ? `<optgroup label="${z}">${caly(z)}${g.map(u => `<option value="${u.id}" ${sel(u.id)}>${esc(u.imie || loginOfUser(u))}</option>`).join("")}</optgroup>` : ""; }).join("")}</select>`;
      } else if (r === "zastepowy") {
        const c = (S.zUsers || []).filter(u => u.id !== me && u.zastep === mine).sort(byName);
        whoSel = `<select id="sp_u"><option value="${me}">Ja (${esc(myName())})</option>${c.map(u => `<option value="${u.id}" ${sel(u.id)}>${esc(u.imie || loginOfUser(u))}</option>`).join("")}${caly(mine)}</select>`;
      }
      const g = S.spG || 1;
      form = `<div class="card"><h2>${title}</h2>
        ${whoSel ? `<div class="row"><label>Dla kogo<br>${whoSel}</label></div>` : ""}
        <div class="row"><label style="flex:1">Nazwa sprawności<br><input id="sp_n" list="sp_names" placeholder="np. Kucharz" autocomplete="off" style="width:100%"></label></div>
        ${namesList()}
        <div class="row"><span class="mut">Gwiazdki:</span>${starBtns("g", g)}</div>
        <div id="sp_list" class="za" hidden></div>
        <div class="row"><button class="pri" id="sp_add">${isKadra() ? "✔ Przyznaj sprawność" : "📨 Wyślij wniosek"}</button></div>
        <p class="mut">${isKadra() ? "Sprawność dodana przez kadrę jest od razu przyznana." : "Punkty dla zastępu naliczają się po zatwierdzeniu przez kadrę."}
        Liczy się do kwartału, w którym złożono wniosek (teraz: <b>${esc(cq.nazwa)}</b>).${r === "zastepowy" ? " Jako zastępowy możesz złożyć wniosek także za harcerza ze swojego zastępu." : ""}</p></div>`;
    }
  }
  // --- listy
  const status = s => `<span class="badge ${SSTAT[s.status]?.[0] || ""}">${SSTAT[s.status]?.[1] || esc(s.status)}</span>`;
  const row = (s, o) => `<tr><td><b>${esc(s.nazwa)}</b> <span class="gw">${gw(s.gwiazdki)}</span><div class="mut">${sprPtsTxt(s)}</div></td>
    <td>${sprKto(s)}${s.autor && (s.caly || s.autor !== s.uid) && s.autor !== s.sprawdzil ? `<div class="mut">zgłosił(a) ${esc(s.autorImie || "")}</div>` : ""}</td><td>${esc(s.zastep)}</td>
    <td>${plDay(s.data)}${s.zbiorkaId ? `<div class="mut">na zbiórce</div>` : ""}</td>${o.st ? `<td>${status(s)}${s.status === "odrzucona" ? powodTxt(s.powod) : ""}</td>` : ""}${o.who ? `<td>${ktoKiedy(s.sprawdzilImie, s.sprawdzil, s.sprawdzono)}${s.status === "odrzucona" ? powodTxt(s.powod) : ""}</td>` : ""}
    <td class="act">${isKadra() && s.status !== "przyznana" ? `<button data-sok="${s.id}">✔ Przyznaj</button>` : ""}${isKadra() && s.status === "oczekuje" ? `<button data-sno="${s.id}" title="Odrzuć">✖</button>` : ""}${isKadra() ? `<button data-sed="${s.id}" title="Edytuj" aria-label="Edytuj">✎</button>` : ""}${!isKadra() && me && s.status === "oczekuje" && (s.uid === me || s.autor === me) ? `<button class="del" data-sdel="${s.id}">Wycofaj</button>` : ""}</td></tr>`;
  const table = (list, empty, o = {}) => `<div class="scroll"><table><tr><th>Sprawność</th><th>Kto</th><th>Zastęp</th><th>Wniosek</th>${o.st ? "<th>Status</th>" : ""}${o.who ? `<th>${o.who}</th>` : ""}<th></th></tr>
    ${list.map(s => row(s, o)).join("") || `<tr><td colspan=7 class="mut">${empty}</td></tr>`}</table></div>`;
  const accQ = S.sprawnosci.filter(s => s.status === "przyznana" && inQ(s.data));
  const pts = z => accQ.filter(s => s.zastep === z).reduce((a, s) => a + sprawPts(S.cfg, s), 0);
  const summary = `<div class="scroll"><table>${head()}<tr><td>Przyznane</td>${ZASTEPY.map(z => `<td class="n">${accQ.filter(s => s.zastep === z).length}</td>`).join("")}</tr>
    <tr><td><b>Punkty</b></td>${ZASTEPY.map(z => `<td class="n"><b>${frac(pts(z))}</b></td>`).join("")}</tr></table></div>`;
  const pktTxt = `<p class="mut">Za przyznaną sprawność zastęp dostaje: ${[1, 2, 3].map(n => `<span class="gw">${gw(n)}</span> ${sprPk(n)} pkt`).join(" · ")}.</p>`;
  // szeregowy: własne wnioski + przyznane w swoim zastępie
  if (r === "szeregowy") {
    if (!ZASTEPY.includes(mine)) return denied + form;
    const own = S.sprawnosci.filter(s => isMineSpr(s, me) && (s.status === "oczekuje" || inQ(s.data)));
    const accMine = accQ.filter(s => s.zastep === mine);
    return denied + form + `<div class="card"><h2>📋 Moje sprawności <span class="badge">${own.length}</span></h2>${quarterPicker()}${table(own, "Brak wniosków w tym kwartale", { st: 1 })}</div>
      <div class="card"><h2>✅ Przyznane w zastępie ${esc(mine)} <span class="badge ok">${accMine.length}</span></h2>${table(accMine, "Brak przyznanych sprawności w tym kwartale", { who: "Przyznał" })}${pktTxt}
      <div class="row">${odrzBtn("❌ Moje odrzucone prośby")}</div></div>`;
  }
  const pend = S.sprawnosci.filter(s => s.status === "oczekuje" && (isKadra() || s.zastep === mine));
  const rej = S.sprawnosci.filter(s => s.status === "odrzucona" && inQ(s.data) && (isKadra() || (r === "zastepowy" && s.zastep === mine)));
  return denied + (isKadra() ? `<div class="card">${histBtn()}</div>` : "") + form
    + (isKadra() || r === "zastepowy" ? `<div class="card"><h2>⏳ Czekają na zatwierdzenie <span class="badge w">${pend.length}</span></h2>${table(pend, "Brak wniosków")}</div>` : "")
    + `<div class="card"><h2>✅ Przyznane <span class="badge ok">${accQ.length}</span></h2>${quarterPicker()}${summary}${table(accQ, "Brak przyznanych sprawności w tym kwartale", { who: "Przyznał" })}
      ${rej.length ? `<details><summary class="mut">Odrzucone w tym kwartale (${rej.length})</summary>${table(rej, "", { who: "Odrzucił" })}</details>` : ""}${pktTxt}
      ${S.user ? `<div class="row">${odrzBtn("❌ Wszystkie odrzucone prośby")}</div>` : ""}</div>`;
}
binders.sprawnosci = () => {
  if (S.edit?.kind === "sprawnosc") return bindSprawEdit();
  if (S.view?.kind === "hist") return bindHist("sprawnosci");
  bindHistBtn();
  const info = bindCaly("sp", () => (S.spU || "").startsWith("__caly:") ? { z: S.spU.slice(7), g: S.spG || 1, nazwa: calyName("sp") } : null);
  $$("[data-g]").forEach(b => b.onclick = () => { S.spG = +b.dataset.g; $$("[data-g]").forEach(x => x.classList.toggle("on", x === b)); info(); });
  $("#sp_u") && ($("#sp_u").onchange = e => { S.spU = e.target.value; info(); });
  $("#sp_add") && ($("#sp_add").onclick = () => addSpraw($("#sp_add")));
  const set = (id, status) => updateDoc(doc(db, "sprawnosci", id), { status, sprawdzil: S.user.uid, sprawdzilImie: myName(), sprawdzono: serverTimestamp() }).catch(err);
  $$("[data-sok]").forEach(b => b.onclick = () => set(b.dataset.sok, "przyznana"));
  $$("[data-sno]").forEach(b => b.onclick = async () => { const powod = await askReason("Odrzucić wniosek o sprawność?"); if (powod === null) return;
    updateDoc(doc(db, "sprawnosci", b.dataset.sno), { status: "odrzucona", powod, sprawdzil: S.user.uid, sprawdzilImie: myName(), sprawdzono: serverTimestamp() }).catch(err); });
  bindOdrzBtn();
  $$("[data-sed]").forEach(b => b.onclick = () => { S.edit = { kind: "sprawnosc", id: b.dataset.sed, d: { ...S.sprawnosci.find(x => x.id === b.dataset.sed) } }; render(); });
  $$("[data-sdel]").forEach(b => b.onclick = () => confirm("Wycofać wniosek o sprawność?") && deleteDoc(doc(db, "sprawnosci", b.dataset.sdel)).catch(err));
};
async function addSpraw(btn) {
  const nazwa = $("#sp_n").value.trim().replace(/\s+/g, " "), g = S.spG || 1, sel = $("#sp_u")?.value, kadra = isKadra();
  if (nazwa.length < 2) return alert("Wpisz nazwę sprawności");
  if (!currentQ()) return alert("Dzisiejsza data nie należy do żadnego kwartału.");
  let who;
  if (sel?.startsWith("__caly:")) {                      // cały zastęp zdobył sprawność
    const z = sel.slice(7); if (!kadra && z !== S.profile.zastep) return alert("Możesz zgłosić tylko swój zastęp");
    who = calyTarget(z, g, nazwa);
    if (!who.uczestnicy.length && !who.mieli.length) return alert(`W zastępie ${z} nie ma jeszcze kont harcerzy.`);
    if (!who.uczestnicy.length) return alert("Zaznacz, kto zdobył sprawność (nikt nie ma „✔ zdobył(a)”).");
    const dup = S.sprawnosci.find(s => s.caly && s.zastep === z && s.status !== "odrzucona" && Number(s.gwiazdki) === g && (s.nazwa || "").toLowerCase() === nazwa.toLowerCase());
    if (dup && !confirm(`Zastęp ${z} ma już ${dup.status === "przyznana" ? "przyznaną" : "zgłoszoną"} sprawność „${dup.nazwa}” ${gw(g)}. Dodać mimo to?`)) return;
    btn.disabled = true;
    try { await addDoc(collection(db, "sprawnosci"), sprawDoc({ nazwa, g, data: today(), target: who })); S.cm = {}; S.cn = {}; const o = $("#sp_n"); if (o) o.value = ""; render(); }
    catch (e) { err(e.code === "permission-denied" ? "Brak uprawnień do zapisania sprawności (kadra musi wkleić nowe reguły w Firebase)." : e); }
    const b2 = $("#sp_add"); if (b2) b2.disabled = false; return;
  }
  if (kadra) { const u = S.users.find(x => x.id === sel); if (!u) return alert("Wybierz harcerza"); who = { uid: u.id, imie: u.imie || loginOfUser(u), zastep: u.zastep }; }
  else if (rola() === "zastepowy" && sel && sel !== S.user.uid) { const u = (S.zUsers || []).find(x => x.id === sel); if (!u) return alert("Wybierz harcerza");
    who = { uid: u.id, imie: u.imie || loginOfUser(u), zastep: S.profile.zastep }; }
  else who = { uid: S.user.uid, imie: myName(), zastep: S.profile.zastep };
  if (!ZASTEPY.includes(who.zastep)) return alert("Ta osoba nie ma przypisanego zastępu");
  const dup = S.sprawnosci.find(s => s.uid === who.uid && s.status !== "odrzucona" && Number(s.gwiazdki) === g && (s.nazwa || "").toLowerCase() === nazwa.toLowerCase());
  if (dup && !confirm(`${who.imie} ma już ${dup.status === "przyznana" ? "przyznaną" : "zgłoszoną"} sprawność „${dup.nazwa}” ${gw(g)}. Dodać mimo to?`)) return;
  const d = sprawDoc({ nazwa, g, data: today(), target: { uid: who.uid, imie: who.imie, zastep: who.zastep } });
  btn.disabled = true;
  try { await addDoc(collection(db, "sprawnosci"), d); const o = $("#sp_n"); if (o) o.value = ""; }
  catch (e) { err(e.code === "permission-denied" ? "Brak uprawnień do zapisania sprawności (kadra musi wkleić nowe reguły w Firebase)." : e); }
  const b2 = $("#sp_add"); if (b2) b2.disabled = false;
}
// --- edycja sprawności (kadra)
function vSprawEdit() {
  if (!isKadra()) { S.edit = null; return vSprawnosci(); }
  const s = S.edit.d;
  return `<div class="card"><h2>Edycja sprawności</h2>
   <p><b>${esc(s.imie)}</b> <span class="mut">· ${esc(s.zastep)} · wniosek ${plTs(s.utworzono)}${s.autorImie ? " · złożył(a) " + esc(s.autorImie) : ""}</span></p>
   <div class="row"><label style="flex:1">Nazwa sprawności<br><input id="se_n" value="${esc(s.nazwa)}" style="width:100%"></label></div>
   <div class="row"><label>Gwiazdki<br><select id="se_g">${[1, 2, 3].map(n => `<option value="${n}" ${Number(s.gwiazdki) === n ? "selected" : ""}>${gw(n)} (${sprPk(n)} pkt)</option>`).join("")}</select></label>
   <label>Data wniosku<br><input type="date" id="se_d" value="${s.data || ""}"></label>
   <label>Status<br><select id="se_s">${["przyznana", "oczekuje", "odrzucona"].map(v => `<option value="${v}" ${s.status === v ? "selected" : ""}>${v}</option>`).join("")}</select></label></div>
   <div class="row"><label style="flex:1">Powód odrzucenia <span class="mut">(gdy status „odrzucona”)</span><br><input id="se_p" value="${esc(s.powod)}" style="width:100%"></label></div>
   <p class="mut">Data wniosku decyduje, do którego kwartału liczą się punkty.</p>
   ${s.caly ? (() => { const cand = [...(s.uczestnicy || []), ...(s.mieli || [])]; czlonkowie(s.zastep).forEach(u => { if (!cand.some(x => x.uid === u.uid)) cand.push(u); });
     const st = uid => (s.uczestnicy || []).some(u => u.uid === uid) ? "z" : (s.mieli || []).some(u => u.uid === uid) ? "m" : "";
     return `<h3>👥 Cały zastęp — kto zdobył</h3><div class="clist">${cand.map(u => `<div class="crow"><span>${esc(u.imie)}</span>
       <select data-ue2="${u.uid}" data-ui="${esc(u.imie)}">${[["z", "✔ zdobył(a)"], ["m", "już ma (był(a))"], ["", "— nie liczy się"]].map(([v, l]) => `<option value="${v}" ${st(u.uid) === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>`).join("")}</div>
       <p class="mut">Punkty = liczba osób „zdobył(a)” × 2 × punkty za gwiazdki.</p>`; })() : ""}
   <div class="row"><button class="pri" id="sesave">Zapisz</button><button id="secancel">Anuluj</button><button class="del" id="sedel">Usuń</button></div></div>`;
}
function bindSprawEdit() {
  $("#secancel").onclick = () => doneEdit();
  $("#sedel").onclick = () => confirm("Usunąć tę sprawność?") && deleteDoc(doc(db, "sprawnosci", S.edit.id)).then(() => doneEdit()).catch(err);
  $("#sesave").onclick = async () => {
    const s = S.edit.d, nazwa = $("#se_n").value.trim().replace(/\s+/g, " "), status = $("#se_s").value, data = $("#se_d").value;
    if (nazwa.length < 2) return alert("Wpisz nazwę sprawności");
    if (!data) return alert("Wybierz datę");
    const upd = { nazwa, gwiazdki: Number($("#se_g").value), data, status, powod: $("#se_p").value.trim(), zmienil: S.user.uid, zmienilImie: myName() };
    if (s.caly) { const pick = v => [...$$("[data-ue2]")].filter(x => x.value === v).map(x => ({ uid: x.dataset.ue2, imie: x.dataset.ui }));
      upd.uczestnicy = pick("z"); upd.mieli = pick("m");
      if (!upd.uczestnicy.length) return alert("Co najmniej jedna osoba musi mieć „✔ zdobył(a)”"); }
    if (status !== s.status && status !== "oczekuje") Object.assign(upd, { sprawdzil: S.user.uid, sprawdzilImie: myName(), sprawdzono: serverTimestamp() });
    try { await updateDoc(doc(db, "sprawnosci", S.edit.id), upd); doneEdit(); } catch (e) { err(e); }
  };
}

// ---------- ODRZUCONE PROŚBY: zbiórki zastępu, meldunki z alarmów, sprawności — w jednym miejscu
// Okienko z powodem odrzucenia (zwraca tekst albo null, gdy anulowano).
function askReason(title, value = "", ok = "✖ Odrzuć") {
  return new Promise(res => {
    const m = $("#modal"); m.hidden = false;
    m.innerHTML = `<div class="box"><b>${esc(title)}</b><label>Powód <span class="mut">(opcjonalnie — zobaczy go osoba, która zgłaszała)</span><br>
      <textarea id="rsn" rows="3" style="width:100%" placeholder="np. brak zdjęcia, zbiórka trwała za krótko…">${esc(value)}</textarea></label>
      <div class="row"><button class="pri" id="rok">${ok}</button><button id="rno">Anuluj</button></div></div>`;
    const done = v => { m.hidden = true; m.innerHTML = ""; res(v); };
    $("#rok").onclick = () => done($("#rsn").value.trim()); $("#rno").onclick = () => done(null);
    setTimeout(() => $("#rsn")?.focus(), 50);
  });
}
const powodTxt = p => p ? `<div class="powod">Powód: ${esc(p)}</div>` : "";
const OKAT = { zbiorki: "🔥 Zbiórka zastępu", meldunki: "🚨 Meldunek z alarmu", sprawnosci: "🎖 Sprawność" };
// wpisy widoczne dla zalogowanego: kadra — wszystkie; zastępowy — swojego zastępu; szeregowy — własne
function odrzEntries() {
  const me = S.user?.uid, r = rola(), mine = S.profile?.zastep, out = [];
  S.zbiorki.filter(z => z.status === "odrzucona").forEach(z => out.push({ kat: "zbiorki", col: "zbiorkiZastepu", id: z.id, data: z.data, zastep: z.zastep,
    co: "Zbiórka zastępu" + (z.opis ? ": " + z.opis : ""), kto: z.zastep, zgl: z.utworzono, autorImie: kto(null, z.autor),
    odrz: z.zatwierdzilImie || kto(null, z.zatwierdzil), odrzTs: z.zatwierdzono, powod: z.powod, osoby: [z.autor] }));
  S.meldunki.filter(m => m.status === "odrzucony").forEach(m => { const a = S.alarmy.find(x => x.id === m.alarmId);
    out.push({ kat: "meldunki", col: "meldunki", id: m.id, data: a?.data || "", zastep: m.zastep, co: "Meldunek z alarmu: " + (a?.nazwa || "Alarm"),
      kto: m.imie, zgl: m.czasMs, autorImie: m.zglosil && m.zglosil !== m.uid ? m.zglosilImie : "", odrz: m.sprawdzilImie, odrzTs: m.sprawdzono,
      powod: m.powod, osoby: [m.uid, m.zglosil] }); });
  S.sprawnosci.filter(s => s.status === "odrzucona").forEach(s => out.push({ kat: "sprawnosci", col: "sprawnosci", id: s.id, data: s.data, zastep: s.zastep,
    co: `Sprawność${s.caly ? " (cały zastęp)" : ""}: ${s.nazwa} ${gw(s.gwiazdki)}`, kto: s.caly ? `Cały zastęp · ${names(s.uczestnicy)}` : s.imie,
    zgl: s.utworzono, autorImie: s.autor !== s.uid || s.caly ? s.autorImie : "", odrz: s.sprawdzilImie, odrzTs: s.sprawdzono, powod: s.powod,
    osoby: [s.uid, s.autor, ...(s.uczestnicy || []).map(u => u.uid), ...(s.mieli || []).map(u => u.uid)] }));
  return out.filter(e => isKadra() || (r === "zastepowy" && e.zastep === mine) || e.osoby.includes(me))
    .sort((a, b) => (b.data || "").localeCompare(a.data || ""));
}
const ACCEPT = { zbiorki: ["zatwierdzona", "zatwierdzil"], meldunki: ["zaakceptowany", "sprawdzil"], sprawnosci: ["przyznana", "sprawdzil"] };
function vOdrz() {
  if (!S.user || !S.profile) { S.view = null; return vWyniki(); }
  const fk = S.oKat || "", fz = S.oZ || "", fq = S.oQ ?? "", q = fq === "" ? null : S.cfg.kwartaly[+fq];
  const all = odrzEntries(), list = all.filter(e => (!fk || e.kat === fk) && (!fz || e.zastep === fz) && (!q || (e.data >= q.start && e.data <= q.end)));
  const items = list.map(e => `<div class="hl"><div class="hl-top"><span>${plDay(e.data)} · <b>${esc(e.zastep || "–")}</b> · <span class="mut">${OKAT[e.kat]}</span></span>
    <span class="badge no">❌ odrzucone</span></div>
    <div><b>${esc(e.co)}</b></div><div class="mut">${esc(e.kto)}${e.autorImie ? ` · zgłosił(a) ${esc(e.autorImie)}` : ""} · zgłoszono ${plTs(e.zgl)}</div>
    <div class="mut">Odrzucił(a): ${esc(e.odrz || "kadra")}${e.odrzTs ? " · " + plTs(e.odrzTs) : ""}</div>${powodTxt(e.powod)}
    ${isKadra() ? `<div class="row"><button data-oacc="${e.kat}|${e.id}">✔ ${e.kat === "sprawnosci" ? "Przyznaj" : e.kat === "zbiorki" ? "Zatwierdź" : "Akceptuj"}</button>
      <button data-oback="${e.kat}|${e.id}">↩ Do oczekujących</button><button data-opow="${e.kat}|${e.id}">✎ Powód</button>
      <button class="del" data-odel="${e.kat}|${e.id}">Usuń</button></div>` : ""}</div>`).join("");
  const sel = (id, opts, v) => `<select id="${id}">${opts.map(([k, l]) => `<option value="${k}" ${String(v) === String(k) ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  return `<div class="card"><div class="row"><button id="back">← Wróć</button></div>
    <h2>❌ Odrzucone prośby <span class="badge">${all.length}</span></h2>
    <p class="mut">${isKadra() ? "Wszystkie odrzucone zgłoszenia zbiórek zastępu, meldunki z alarmów i wnioski o sprawności. Możesz je przywrócić do oczekujących albo od razu zaakceptować."
      : rola() === "zastepowy" ? "Odrzucone zgłoszenia Twojego zastępu." : "Twoje odrzucone zgłoszenia."} Odrzucone nie liczą się do punktacji.</p>
    <div class="row">${sel("o_kat", [["", "Wszystko"], ...Object.entries(OKAT)], fk)}
    ${isKadra() ? sel("o_z", [["", "Wszystkie zastępy"], ...ZASTEPY.map(z => [z, z])], fz) : ""}
    ${sel("o_q", [["", "Wszystkie kwartały"], ...S.cfg.kwartaly.map((x, i) => [i, x.nazwa])], fq)}</div>
    <div class="hlist">${items || `<p class="mut">Brak odrzuconych próśb${fk || fz || q ? " dla wybranych filtrów" : ""}.</p>`}</div></div>`;
}
function bindOdrz() {
  $("#back").onclick = () => { const f = S.view?.from; S.view = null; if (f) S.tab = f; render(); };
  $("#o_kat").onchange = e => { S.oKat = e.target.value; render(); };
  $("#o_z") && ($("#o_z").onchange = e => { S.oZ = e.target.value; render(); });
  $("#o_q").onchange = e => { S.oQ = e.target.value; render(); };
  const ref = v => { const [kat, id] = v.split("|"); return { kat, id, col: { zbiorki: "zbiorkiZastepu", meldunki: "meldunki", sprawnosci: "sprawnosci" }[kat] }; };
  const who = pre => ({ [pre]: S.user.uid, [pre + "Imie"]: myName(), [pre === "zatwierdzil" ? "zatwierdzono" : "sprawdzono"]: serverTimestamp() });
  $$("[data-oacc]").forEach(b => b.onclick = () => { const r = ref(b.dataset.oacc), [st, pre] = ACCEPT[r.kat];
    confirm("Zaakceptować to zgłoszenie? Zacznie liczyć się do punktacji.") && updateDoc(doc(db, r.col, r.id), { status: st, ...who(pre) }).catch(err); });
  $$("[data-oback]").forEach(b => b.onclick = () => { const r = ref(b.dataset.oback);
    confirm("Przywrócić do oczekujących na akceptację?") && updateDoc(doc(db, r.col, r.id), { status: "oczekuje" }).catch(err); });
  $$("[data-opow]").forEach(b => b.onclick = async () => { const r = ref(b.dataset.opow), e = odrzEntries().find(x => x.id === r.id);
    const p = await askReason("Powód odrzucenia", e?.powod || "", "Zapisz"); if (p !== null) updateDoc(doc(db, r.col, r.id), { powod: p }).catch(err); });
  $$("[data-odel]").forEach(b => b.onclick = () => { const r = ref(b.dataset.odel);
    if (!confirm("Usunąć na stałe? Tego nie da się cofnąć.")) return;
    Promise.all([deleteDoc(doc(db, r.col, r.id)), ...(r.kat === "meldunki" ? [deleteDoc(doc(db, "zdjecia", r.id)).catch(() => {})] : [])]).catch(err); });
}
const odrzBtn = (label = "❌ Odrzucone prośby") => S.user && S.profile ? `<button id="odrz">${label}</button>` : "";
const bindOdrzBtn = () => { const b = $("#odrz"); if (b) b.onclick = () => { S.view = { kind: "odrz", from: S.tab === "wyniki" ? null : S.tab }; S.tab = "wyniki"; render(); }; };

// ---------- HISTORIA PUNKTÓW (kadra) + ręczne korekty
const KAT = { zbiorki: "Zbiórki zastępu", akcje: "Zbiórki drużyny / biwaki", alarmy: "Alarmy", sprawnosci: "Sprawności" };
const sgn = x => (x > 0 ? "+" : "") + frac(x);
const histBtn = () => isKadra() ? `<div class="row"><button id="hist">📜 Historia punktów</button></div>` : "";
const bindHistBtn = () => { const b = $("#hist"); if (b) b.onclick = () => { S.view = { kind: "hist" }; render(); }; };
function histEntries(kat, q = quarter()) {
  const out = [], inQ = d => d >= q.start && d <= q.end;
  if (!kat || kat === "zbiorki") {
    const st = streakPoints(S.cfg, q, S.zbiorki, S.akcje, today()), used = new Set();
    S.zbiorki.filter(z => z.status === "zatwierdzona" && inQ(z.data) && ZASTEPY.includes(z.zastep))
      .sort((a, b) => a.data.localeCompare(b.data) || a.id.localeCompare(b.id)).forEach(z => {
        const wk = fmtD(monday(parseD(z.data))), key = z.zastep + wk, first = !used.has(key); used.add(key);
        const l = first ? st[z.zastep].log.find(x => x.tydzien === wk && x.pkt > 0) : null;
        out.push({ kat: "zbiorki", data: z.data, zastep: z.zastep, pkt: l ? l.pkt : 0, opis: "Zbiórka zastępu" + (z.opis ? ": " + z.opis : ""),
          info: l ? `streak ${l.n} 🔥` + (z.zatwierdzilImie ? ` · zatwierdził(a) ${z.zatwierdzilImie}` : "")
                  : first ? "tydzień jeszcze trwa albo poza kwartałem" : "kolejna zbiórka w tym tygodniu — nie liczy się",
          ref: ["zbiorka", z.id] });
      });
  }
  if (!kat || kat === "akcje") S.akcje.filter(a => inQ(a.data)).forEach(a => { const r = akcjaPoints(S.cfg, a);
    ZASTEPY.forEach(z => { if (!r[z].total && !r[z].hob) return;
      out.push({ kat: "akcje", data: a.data, zastep: z, pkt: r[z].total, opis: (a.typ === "biwak" ? "Biwak" : "Zbiórka drużyny") + (a.nazwa ? ": " + a.nazwa : ""),
        info: `(gry ${frac(r[z].gry)} + mundur ${frac(r[z].mund)}) × obecni ${r[z].hob}/${r[z].h}`, ref: ["akcja", a.id] }); }); });
  if (!kat || kat === "alarmy") S.alarmy.filter(a => inQ(a.data)).forEach(a => { const r = alarmPoints(S.cfg, a, S.meldunki);
    ZASTEPY.forEach(z => { if (!r[z].total) return;
      out.push({ kat: "alarmy", data: a.data, zastep: z, pkt: r[z].total, opis: "Alarm" + (a.nazwa ? ": " + a.nazwa : ""),
        info: `${frac(r[z].osoby)} za osoby` + (r[z].miejsce ? ` + ${r[z].bonus} bonus (${r[z].miejsce}. miejsce)` : ""), ref: ["alarm", a.id] }); }); });
  if (!kat || kat === "sprawnosci") S.sprawnosci.filter(s => s.status === "przyznana" && inQ(s.data) && ZASTEPY.includes(s.zastep)).forEach(s =>
    out.push({ kat: "sprawnosci", data: s.data, zastep: s.zastep, pkt: sprawPts(S.cfg, s), opis: `Sprawność${s.caly ? " (cały zastęp)" : ""}: ${s.nazwa} ${gw(s.gwiazdki)}`,
      info: (s.caly ? sprPtsTxt(s) : (s.imie || "")) + (s.sprawdzilImie ? ` · przyznał(a) ${s.sprawdzilImie}` : ""), ref: ["sprawnosc", s.id] }));
  S.korekty.filter(k => (!kat || k.kategoria === kat) && inQ(k.data)).forEach(k => out.push({ kat: k.kategoria, data: k.data, zastep: k.zastep,
    pkt: Number(k.pkt) || 0, opis: "✏️ Korekta: " + (k.powod || "—"), info: `dodał(a) ${k.autorImie || "kadra"}` + (k.zmienilImie ? ` · zmienił(a) ${k.zmienilImie}` : ""),
    ref: ["korekta", k.id], kor: true }));
  return out.sort((a, b) => b.data.localeCompare(a.data));
}
function vHist(kat) {
  if (!isKadra()) { S.view = null; return ""; }
  if (S.edit?.kind === "korekta") return vKorektaEdit();
  if (S.edit?.kind === "zbiorka") return vZbiorkaEdit();
  const f = S.histZ || "", all = histEntries(kat), list = all.filter(e => !f || e.zastep === f);
  const rows = list.map(e => `<div class="hl ${e.kor ? "kor" : ""}"><div class="hl-top"><span>${plDay(e.data)} · <b>${esc(e.zastep)}</b>${kat ? "" : ` · <span class="mut">${KAT[e.kat]}</span>`}</span>
    <span class="hl-pts ${e.pkt < 0 ? "neg" : ""}">${sgn(e.pkt)}</span></div>
    <div>${esc(e.opis)}</div><div class="mut">${esc(e.info)}</div>
    <div class="row"><button data-he="${e.ref.join("|")}">✎ Edytuj</button>${e.kor ? `<button class="del" data-hdel="${e.ref[1]}">Usuń</button>` : ""}</div></div>`).join("");
  const sum = z => all.filter(e => e.zastep === z).reduce((s, e) => s + e.pkt, 0);
  return `<div class="card"><div class="row"><button id="back">← Wróć</button></div>
    <h2>📜 Historia punktów${kat ? " — " + KAT[kat] : ""}</h2>${quarterPicker()}
    <div class="row"><select id="hz"><option value="">Wszystkie zastępy</option>${ZASTEPY.map(z => `<option ${f === z ? "selected" : ""}>${z}</option>`).join("")}</select>
    <button class="pri" id="kadd">+ Korekta punktów</button></div>
    <div class="hlist">${rows || `<p class="mut">Brak punktów w tym kwartale</p>`}</div>
    <h3>Suma w kwartale${kat ? "" : " (wszystkie kategorie)"}</h3><div class="scroll"><table>${head()}
    <tr><td>Razem</td>${ZASTEPY.map(z => `<td class="n"><b>${frac(sum(z))}</b></td>`).join("")}</tr></table></div>
    <p class="mut">„Edytuj” otwiera dane, z których wyliczono punkty — po zmianie punkty przeliczą się same. Korekta to ręczne dodanie lub odjęcie punktów z podaniem powodu.</p></div>`;
}
function bindHist(kat) {
  if (S.edit?.kind === "korekta") return bindKorektaEdit();
  if (S.edit?.kind === "zbiorka") return bindZbiorkaEdit();
  if (!$("#back")) return;
  $("#back").onclick = () => { S.view = null; render(); };
  $("#hz").onchange = e => { S.histZ = e.target.value; render(); };
  $("#kadd").onclick = () => { S.edit = { kind: "korekta", d: { kategoria: kat || "zbiorki", zastep: S.histZ || "", data: today(), pkt: 0, powod: "" } }; render(); };
  $$("[data-he]").forEach(b => b.onclick = () => openRef(...b.dataset.he.split("|")));
  $$("[data-hdel]").forEach(b => b.onclick = () => confirm("Usunąć tę korektę?") && deleteDoc(doc(db, "korekty", b.dataset.hdel)).catch(err));
}
function openRef(type, id) {
  const back = { tab: S.tab, view: S.view };
  if (type === "korekta") S.edit = { kind: "korekta", id, d: { ...S.korekty.find(x => x.id === id) } };
  else if (type === "zbiorka") S.edit = { kind: "zbiorka", id, d: { ...S.zbiorki.find(x => x.id === id) } };
  else if (type === "akcja") { S.back = back; S.tab = "akcje"; S.view = null; S.edit = { kind: "akcja", id, d: structuredClone(S.akcje.find(x => x.id === id)) }; }
  else if (type === "alarm") { const a = S.alarmy.find(x => x.id === id), d = structuredClone(a); d.progiMin = alarmProgiMin(S.cfg, a);
    S.back = back; S.tab = "alarmy"; S.view = null; S.edit = { kind: "alarm", id, d }; }
  else if (type === "sprawnosc") { S.back = back; S.tab = "sprawnosci"; S.view = null; S.edit = { kind: "sprawnosc", id, d: { ...S.sprawnosci.find(x => x.id === id) } }; }
  render();
}
// --- korekta punktów
function vKorektaEdit() {
  const k = S.edit.d, p = Number(k.pkt) || 0;
  return `<div class="card"><h2>${S.edit.id ? "Edycja korekty" : "Nowa korekta punktów"}</h2>
   <div class="row"><label>Kategoria<br><select id="k_kat">${Object.entries(KAT).map(([v, l]) => `<option value="${v}" ${k.kategoria === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
   <label>Zastęp<br><select id="k_z"><option value="">– wybierz –</option>${ZASTEPY.map(z => `<option ${k.zastep === z ? "selected" : ""}>${z}</option>`).join("")}</select></label>
   <label>Data<br><input type="date" id="k_d" value="${k.data}"></label></div>
   <div class="row"><label>Punkty<br><select id="k_s"><option value="1" ${p >= 0 ? "selected" : ""}>+ dodaj</option><option value="-1" ${p < 0 ? "selected" : ""}>− odejmij</option></select>
   <input id="k_p" inputmode="decimal" value="${p ? String(Math.abs(p)).replace(".", ",") : ""}" placeholder="np. 5" style="width:90px"></label></div>
   <div class="row"><label style="flex:1">Powód<br><input id="k_r" value="${esc(k.powod)}" placeholder="np. pomoc przy organizacji biwaku" style="width:100%"></label></div>
   <div class="row"><button class="pri" id="ksave">Zapisz</button><button id="kcancel">Anuluj</button>${S.edit.id ? `<button class="del" id="kdel">Usuń korektę</button>` : ""}</div></div>`;
}
function bindKorektaEdit() {
  $("#kcancel").onclick = () => { S.edit = null; render(); };
  $("#kdel") && ($("#kdel").onclick = () => confirm("Usunąć tę korektę?") && deleteDoc(doc(db, "korekty", S.edit.id)).then(() => { S.edit = null; render(); }).catch(err));
  $("#ksave").onclick = async () => {
    const zastep = $("#k_z").value, data = $("#k_d").value, powod = $("#k_r").value.trim();
    const pkt = Number($("#k_s").value) * parseFloat($("#k_p").value.replace(",", "."));
    if (!ZASTEPY.includes(zastep)) return alert("Wybierz zastęp");
    if (!data) return alert("Wybierz datę");
    if (!isFinite(pkt) || pkt === 0) return alert("Wpisz liczbę punktów");
    if (!powod) return alert("Wpisz powód korekty");
    const d = { kategoria: $("#k_kat").value, zastep, data, pkt, powod };
    const btn = $("#ksave"); btn.disabled = true;
    try {
      if (S.edit.id) await updateDoc(doc(db, "korekty", S.edit.id), { ...d, zmienil: S.user.uid, zmienilImie: myName(), zmieniono: serverTimestamp() });
      else await addDoc(collection(db, "korekty"), { ...d, autor: S.user.uid, autorImie: myName(), utworzono: serverTimestamp() });
      S.edit = null; render();
    } catch (e) { btn.disabled = false; err(e); }
  };
}
// --- edycja zbiórki zastępu (kadra)
function vZbiorkaEdit() {
  const z = S.edit.d;
  return `<div class="card"><h2>Edycja zbiórki zastępu</h2>
   <div class="row"><label>Data<br><input type="date" id="e_d" value="${z.data}"></label>
   <label>Zastęp<br><select id="e_z">${ZASTEPY.map(x => `<option ${z.zastep === x ? "selected" : ""}>${x}</option>`).join("")}</select></label></div>
   <div class="row"><label style="flex:1">Opis<br><input id="e_o" value="${esc(z.opis)}" style="width:100%"></label></div>
   <div class="row"><label>Status<br><select id="e_s">${[["zatwierdzona", "zatwierdzona"], ["oczekuje", "oczekuje"], ["odrzucona", "odrzucona"]].map(([v, l]) => `<option value="${v}" ${z.status === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
   <label style="flex:1">Powód odrzucenia <span class="mut">(gdy „odrzucona”)</span><br><input id="e_p" value="${esc(z.powod)}" style="width:100%"></label></div>
   <p class="mut">Punkty za zbiórkę (ze streakiem) przeliczą się same po zapisaniu.</p>
   <div class="row"><button class="pri" id="esave">Zapisz</button><button id="ecancel">Anuluj</button><button class="del" id="edel">Usuń zbiórkę</button></div></div>`;
}
function bindZbiorkaEdit() {
  $("#ecancel").onclick = () => { S.edit = null; render(); };
  $("#edel").onclick = () => confirm("Usunąć tę zbiórkę?") && deleteDoc(doc(db, "zbiorkiZastepu", S.edit.id)).then(() => { S.edit = null; render(); }).catch(err);
  $("#esave").onclick = async () => {
    const z = S.edit.d, status = $("#e_s").value, data = $("#e_d").value; if (!data) return alert("Wybierz datę");
    const upd = { data, zastep: $("#e_z").value, opis: $("#e_o").value, status, powod: $("#e_p").value.trim() };
    if (status !== z.status && status !== "oczekuje") Object.assign(upd, { zatwierdzil: S.user.uid, zatwierdzilImie: myName(), zatwierdzono: serverTimestamp() });
    try { await updateDoc(doc(db, "zbiorkiZastepu", S.edit.id), upd); S.edit = null; render(); } catch (e) { err(e); }
  };
}

// ---------- JA (każdy zalogowany)
const who = r => `<span class="perm">${{ kadra: "🔒 zmienia kadra", admin: "🔒 zmienia administrator", ty: "✏️ zmieniasz Ty" }[r]}</span>`;
const field = (label, value, r) => `<div class="fld"><div class="mut">${label}</div><div class="fv">${value}</div>${r ? who(r) : ""}</div>`;
const tile = (label, value, sub = "") => `<div class="tile"><div class="mut">${label}</div><b>${value}</b>${sub ? `<div class="mut">${sub}</div>` : ""}</div>`;
function vJa() {
  if (!S.user || !S.profile) return `<div class="card"><p>Zaloguj się, żeby zobaczyć swoje dane.</p></div>`;
  const p = S.profile, z = p.zastep, uid = S.user.uid, q = currentQ() || quarter();
  const inQq = d => d >= q.start && d <= q.end;
  // --- sekcja: zastęp
  let zast;
  if (!ZASTEPY.includes(z)) zast = `<p class="mut">Nie należysz do żadnego zastępu.</p>`;
  else {
    const t = quarterTotals(S.cfg, q, S, today());
    const order = [...ZASTEPY].sort((a, b) => t[b].suma - t[a].suma);
    const place = 1 + order.filter(x => t[x].suma > t[z].suma).length;
    const zb = S.zbiorki.filter(x => x.zastep === z && x.status === "zatwierdzona" && inQq(x.data));
    const wk = fmtD(monday(parseD(today())));
    const doneThisWeek = zb.some(x => fmtD(monday(parseD(x.data))) === wk);
    const pendThisWeek = S.zbiorki.some(x => x.zastep === z && x.status === "oczekuje" && fmtD(monday(parseD(x.data))) === wk);
    const n = t[z].streak, next = zbiorkaPts(S.cfg, n + 1);
    const al = S.alarmy.filter(a => inQq(a.data));
    const alDone = al.filter(a => S.meldunki.some(m => m.alarmId === a.id && m.zastep === z && m.status === "zaakceptowany")).length;
    const meldOk = S.meldunki.filter(m => m.zastep === z && m.status === "zaakceptowany" && al.some(a => a.id === m.alarmId)).length;
    zast = `<div class="tiles">
      ${tile("Miejsce w rankingu", `${place}. <span class="mut">/ ${ZASTEPY.length}</span>`)}
      ${tile("Punkty zastępu", frac(t[z].suma))}
      ${tile("Zatwierdzone zbiórki", zb.length)}
      ${tile("Streak", n ? "🔥 " + n : "0", n ? `${n} ${plural(n, "tydzień", "tygodnie", "tygodni")} z rzędu` : "")}
      ${tile("Następna zbiórka", "+" + frac(next) + " pkt", doneThisWeek ? "w przyszłym tygodniu" : "w tym tygodniu" + (pendThisWeek ? " (zgłoszona, czeka na zatwierdzenie)" : ""))}
      ${tile("Wykonane alarmy", alDone, `${meldOk} ${plural(meldOk, "zaakceptowany meldunek", "zaakceptowane meldunki", "zaakceptowanych meldunków")}`)}
      ${tile("Sprawności", S.sprawnosci.filter(s => s.zastep === z && s.status === "przyznana" && inQq(s.data)).length, `przyznane · ${frac(t[z].sprawnosci)} pkt`)}
    </div>`;
  }
  // --- sekcja: dane użytkownika
  const dane = `${field("Imię i nazwisko", esc(p.imie || "–"), "admin")}
    ${field("Login", esc(p.login || loginOf(S.user.email)), "admin")}
    ${field("Funkcja", ROLE_PL[p.rola] || esc(p.rola || "–"), "kadra")}
    ${field("Zastęp", ZASTEPY.includes(z) ? z : "–", "kadra")}
    ${["kadra", "admin"].includes(p.rola) ? field("Administrator", isAdmin() ? "tak 🛡" : "nie", "admin") : ""}
    <div class="fld"><div class="mut">Hasło</div>${who("ty")}
      <div class="row"><input id="pw_cur" type="password" placeholder="Obecne hasło" autocomplete="current-password"></div>
      <div class="row"><input id="pw_new" type="password" placeholder="Nowe hasło (min. 6 znaków)" autocomplete="new-password"></div>
      <div class="row"><input id="pw_new2" type="password" placeholder="Powtórz nowe hasło" autocomplete="new-password"></div>
      <div class="row"><button class="pri" id="pwsave">Zmień hasło</button></div>
      <p class="mut">Hasło jest zapisane w aplikacji, żeby administrator mógł Ci je zresetować, gdy zapomnisz. Nie używaj hasła, którego używasz gdzie indziej.</p></div>`;
  // --- sekcja: inne
  const my = S.meldunki.filter(m => m.uid === uid && S.alarmy.some(a => a.id === m.alarmId && inQq(a.data)));
  const cnt = st => my.filter(m => m.status === st).length;
  const myZb = S.zbiorki.filter(x => x.autor === uid && inQq(x.data));
  const mySp = S.sprawnosci.filter(s => isMineSpr(s, uid) && (s.status === "oczekuje" || inQq(s.data)));
  const inne = `<div class="tiles">
      ${canMeldowac() || my.length ? tile("Twoje alarmy", cnt("zaakceptowany"), `zaakceptowane · ${cnt("oczekuje")} czeka · ${cnt("odrzucony")} odrzucone`) : ""}
      ${canMeldowac() || mySp.length ? tile("Twoje sprawności", mySp.filter(s => s.status === "przyznana").length, `przyznane w kwartale · ${mySp.filter(s => s.status === "oczekuje").length} czeka`) : ""}
      ${rola() === "zastepowy" || myZb.length ? tile("Zgłoszone przez Ciebie zbiórki", myZb.filter(x => x.status === "zatwierdzona").length, `zatwierdzone · ${myZb.filter(x => x.status === "oczekuje").length} czeka`) : ""}
    </div>
    ${!inApp() && /Android/i.test(navigator.userAgent) ? `<div class="row"><a class="btn pri" href="https://github.com/panbadek/Knieja-punkty/releases/latest/download/Kniejapunkty.apk">📱 Pobierz aplikację na Androida (APK)</a></div>
      <p class="mut">Po pobraniu otwórz plik i zezwól na instalację z tego źródła. Aplikacja otwiera Kniejapunkty w pełnym oknie, z logo na ekranie głównym.</p>` : ""}
    ${(n => n ? `<div class="row"><button id="odrz">❌ Odrzucone prośby <span class="badge no">${n}</span></button></div>` : "")(odrzEntries().length)}
    <p class="mut">Adres aplikacji: <b>panbadek.github.io/Knieja-punkty</b> · wersja ${BUILD}${inApp() ? " · aplikacja Android" : ""}</p>
    <div class="row"><button id="jaout">Wyloguj się</button></div>`;
  return `<div class="card"><h2>🏕 Zastęp${ZASTEPY.includes(z) ? ": " + z : ""}</h2><p class="mut">Kwartał: ${esc(q.nazwa)} (${plDay(q.start)} – ${plDay(q.end)})</p>${zast}</div>
    <div class="card"><h2>👤 Dane użytkownika</h2>${dane}</div>
    <div class="card"><h2>📌 Inne</h2>${inne}</div>`;
}
binders.ja = () => {
  bindOdrzBtn();
  $("#jaout") && ($("#jaout").onclick = () => signOut(auth));
  $("#pwsave") && ($("#pwsave").onclick = async () => {
    const cur = $("#pw_cur").value, n1 = $("#pw_new").value, n2 = $("#pw_new2").value, btn = $("#pwsave");
    if (!cur) return alert("Wpisz obecne hasło");
    if (n1.length < 6) return alert("Nowe hasło musi mieć co najmniej 6 znaków");
    if (n1 !== n2) return alert("Nowe hasła nie są takie same");
    if (n1 === cur) return alert("Nowe hasło musi być inne niż obecne");
    btn.disabled = true; btn.textContent = "Zmieniam…"; S.busy = true;
    try {
      try { await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(auth.currentUser.email, cur)); }
      catch (e) { throw new Error("Obecne hasło jest nieprawidłowe"); }
      await updatePassword(auth.currentUser, n1);
      await setDoc(doc(db, "sekrety", S.user.uid), { haslo: n1 }).catch(() => {});
      alert("Hasło zostało zmienione.");
    } catch (e) { alert(e.message || e); }
    S.busy = false; render();
  });
};

// ---------- WYKRES PUNKTACJI (narastająco w kwartale)
const SERIES = ["s1", "s2", "s3", "s4", "s5", "s6"];          // kolory zastępów: stała kolejność (CSS --s1…--s6)
const zColor = z => `var(--${SERIES[ZASTEPY.indexOf(z)]})`;
function chartData(q) {
  const ev = histEntries(null, q), end = today() < q.end ? today() : q.end;
  const days = []; for (let t = parseD(q.start); t <= parseD(end); t += DAY_MS) days.push(fmtD(t));
  const series = ZASTEPY.map(z => { let acc = 0; const byDay = {};
    ev.filter(e => e.zastep === z).forEach(e => { byDay[e.data] = (byDay[e.data] || 0) + e.pkt; });
    return { z, vals: days.map(d => (acc += byDay[d] || 0)) }; });
  return { days, series };
}
const niceStep = max => { const raw = max / 5, p = Math.pow(10, Math.floor(Math.log10(raw || 1))); return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw) || p * 10; };
function chartSvg(q, W) {
  const { days, series } = chartData(q); if (!days.length) return `<p class="mut">Kwartał jeszcze się nie zaczął.</p>`;
  const H = 260, L = 40, R = 14, T = 12, B = 28, w = W - L - R, h = H - T - B;
  const maxV = Math.max(10, ...series.flatMap(s => s.vals)), minV = Math.min(0, ...series.flatMap(s => s.vals));
  const step = niceStep(maxV - minV), top = Math.ceil(maxV / step) * step, bot = Math.floor(minV / step) * step;
  const x = i => L + (days.length === 1 ? w / 2 : i * w / (days.length - 1)), y = v => T + h - (v - bot) / (top - bot || 1) * h;
  let grid = ""; for (let v = bot; v <= top + 1e-9; v += step) grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="gl${v === 0 ? " g0" : ""}"/><text x="${L - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${Math.round(v)}</text>`;
  let xt = ""; days.forEach((d, i) => { if (parseD(d) === monday(parseD(d)) || i === 0) { const lbl = d.slice(8, 10) + "." + d.slice(5, 7);
    if (i === 0 || x(i) - x(0) > 34) xt += `<line x1="${x(i)}" x2="${x(i)}" y1="${T + h}" y2="${T + h + 4}" class="gl"/><text x="${x(i)}" y="${H - 8}" class="ax" text-anchor="middle">${lbl}</text>`; } });
  const path = vals => vals.map((v, i) => (i ? `H${x(i).toFixed(1)}V${y(v).toFixed(1)}` : `M${x(0).toFixed(1)},${y(v).toFixed(1)}`)).join("");
  const lines = series.map(s => `<path d="${path(s.vals)}" fill="none" stroke="${zColor(s.z)}" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${x(days.length - 1)}" cy="${y(s.vals.at(-1))}" r="4.5" fill="${zColor(s.z)}" class="dot"/>`).join("");
  return `<svg id="chsvg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Punkty zastępów narastająco w kwartale">
    ${grid}${xt}${lines}<line id="chx" x1="0" x2="0" y1="${T}" y2="${T + h}" class="cross" visibility="hidden"/>
    <rect x="${L}" y="${T}" width="${w}" height="${h}" fill="transparent" id="chhit"/></svg>`;
}
function vChart() {
  const q = quarter(), { days, series } = chartData(q);
  const last = series.map(s => ({ z: s.z, v: s.vals.at(-1) || 0 })).sort((a, b) => b.v - a.v);
  const legend = ZASTEPY.map(z => `<span class="lg"><i style="background:${zColor(z)}"></i>${z} <b>${frac(series.find(s => s.z === z).vals.at(-1) || 0)}</b></span>`).join("");
  const weeks = days.filter((d, i) => i === days.length - 1 || parseD(d) === monday(parseD(d)) + 6 * DAY_MS);
  const table = `<details><summary class="mut">Pokaż dane w tabeli (stan na koniec każdego tygodnia)</summary><div class="scroll"><table>
    <tr><th>Do dnia</th>${ZASTEPY.map(z => `<th class="n">${z}</th>`).join("")}</tr>
    ${weeks.map(d => { const i = days.indexOf(d); return `<tr><td>${plDay(d)}</td>${series.map(s => `<td class="n">${frac(s.vals[i])}</td>`).join("")}</tr>`; }).join("")}</table></div></details>`;
  return `<div class="card viz"><div class="row"><button id="back">← Ranking</button></div><h2>📈 Punkty zastępów w kwartale</h2>${quarterPicker()}
    <div class="legend">${legend}</div><div id="chwrap" style="position:relative"><div id="chsvgbox"></div><div id="chtip" class="tip" hidden></div></div>
    <p class="mut">Punkty narastająco — linia wznosi się w dniu, w którym zastęp zdobył punkty (zbiórka, akcja, alarm, sprawność, korekta). Dotknij wykresu, żeby zobaczyć stan w danym dniu.</p>
    ${table}<p class="mut">Prowadzi: <b>${last[0]?.z || "–"}</b> (${frac(last[0]?.v || 0)} pkt)</p></div>`;
}
function bindChart() {
  $("#back").onclick = () => { S.view = null; render(); };
  const box = $("#chsvgbox"), q = quarter();
  const draw = () => {
    box.innerHTML = chartSvg(q, Math.max(280, Math.floor(box.clientWidth)));
    const svg = $("#chsvg"), hit = $("#chhit"), cx = $("#chx"), tip = $("#chtip"); if (!svg || !hit) return;
    const { days, series } = chartData(q);
    const show = ev => {
      const r = svg.getBoundingClientRect(), W = +svg.getAttribute("width"), px = (ev.clientX - r.left) * W / r.width;
      const L = 40, w = W - 40 - 14, i = Math.max(0, Math.min(days.length - 1, Math.round((px - L) / (w || 1) * (days.length - 1))));
      const X = days.length === 1 ? L + w / 2 : L + i * w / (days.length - 1);
      cx.setAttribute("x1", X); cx.setAttribute("x2", X); cx.setAttribute("visibility", "visible");
      const rows = series.map(s => ({ z: s.z, v: s.vals[i] })).sort((a, b) => b.v - a.v);
      tip.innerHTML = `<b>${plDay(days[i])}</b>` + rows.map(o => `<div><i style="background:${zColor(o.z)}"></i>${o.z}<span>${frac(o.v)}</span></div>`).join("");
      tip.hidden = false; const tx = X * r.width / W; tip.style.left = Math.min(Math.max(0, tx + 12), r.width - tip.offsetWidth) + "px";
      if (tx + 12 + tip.offsetWidth > r.width) tip.style.left = Math.max(0, tx - 12 - tip.offsetWidth) + "px";
    };
    hit.addEventListener("pointermove", show); hit.addEventListener("pointerdown", show);
    hit.addEventListener("pointerleave", () => { tip.hidden = true; cx.setAttribute("visibility", "hidden"); });
  };
  draw(); clearTimeout(S._rz); window.onresize = () => { clearTimeout(S._rz); S._rz = setTimeout(() => { if (S.view?.kind === "chart") draw(); }, 200); };
}

// ---------- ARCHIWUM KWARTAŁÓW (kadra): zapis wyników po zakończeniu kwartału + eksport
const qKey = q => `${q.start}_${q.end}`;
const archAttempted = new Set();
function autoArchive() {
  if (!isKadra() || S.busy) return;
  const need = ["cfg", "zbiorki", "akcje", "alarmy", "meldunki", "korekty", "sprawnosci", "archiwum"];
  if (!need.every(k => S.loaded[k])) return;                 // dopiero gdy wszystkie dane są wczytane
  for (const q of S.cfg.kwartaly) {
    const k = qKey(q);
    if (q.end < today() && !S.archiwum.some(a => a.id === k) && !archAttempted.has(k)) { archAttempted.add(k); saveArchive(q, true).catch(e => console.warn("archiwum", e)); }
  }
}
function archiveData(q) {
  const t = quarterTotals(S.cfg, q, S, today()), order = [...ZASTEPY].sort((a, b) => t[b].suma - t[a].suma);
  const ranking = order.map(z => ({ zastep: z, miejsce: 1 + order.filter(x => t[x].suma > t[z].suma).length,
    zbiorki: t[z].zbiorki, akcje: t[z].akcje, alarmy: t[z].alarmy, sprawnosci: t[z].sprawnosci, suma: t[z].suma, streak: t[z].streak }));
  const historia = histEntries(null, q).map(e => ({ data: e.data, kat: e.kat, zastep: e.zastep, pkt: e.pkt, opis: e.opis, info: e.info }));
  const c = S.cfg, punktacja = { base: c.base, przyrost: streakInc(c), mundur: c.mundur, duze: c.duze, male: c.male, alarmProgi: c.alarmProgi, alarmBonus: c.alarmBonus, sprawPkt: c.sprawPkt };
  return { nazwa: q.nazwa, start: q.start, end: q.end, ranking, historia, punktacja, koncowy: q.end < today() };
}
async function saveArchive(q, auto) {
  const d = archiveData(q);
  await setDoc(doc(db, "archiwum", qKey(q)), clean({ ...d, auto: !!auto, zapisalImie: auto ? "automatycznie" : myName(), zapisal: S.user.uid })
    ).then(() => updateDoc(doc(db, "archiwum", qKey(q)), { zapisano: serverTimestamp() }));
}
function vArch() {
  if (!isKadra()) { S.view = null; return vWyniki(); }
  const known = S.cfg.kwartaly.map(q => ({ q, a: S.archiwum.find(a => a.id === qKey(q)) }));
  const extra = S.archiwum.filter(a => !S.cfg.kwartaly.some(q => qKey(q) === a.id));
  const card = a => `<div class="card"><h3 style="margin-top:0">${esc(a.nazwa)} <span class="mut">${plDay(a.start)} – ${plDay(a.end)}</span></h3>
    <p class="mut">${a.koncowy ? "Wyniki końcowe" : "⚠ Stan na dzień zapisu (kwartał jeszcze trwał)"} · zapisano ${plTs(a.zapisano)} · ${esc(a.zapisalImie || "")}</p>
    <div class="scroll"><table><tr><th>#</th><th>Zastęp</th><th class="n">Razem</th><th class="n">Zbiórki</th><th class="n">Drużyna</th><th class="n">Alarmy</th><th class="n">Sprawności</th></tr>
    ${(a.ranking || []).map(r => `<tr><td>${r.miejsce}.</td><td><b>${esc(r.zastep)}</b></td><td class="n"><b>${frac(r.suma)}</b></td><td class="n">${frac(r.zbiorki)}</td><td class="n">${frac(r.akcje)}</td><td class="n">${frac(r.alarmy)}</td><td class="n">${r.sprawnosci == null ? "–" : frac(r.sprawnosci)}</td></tr>`).join("")}</table></div>
    <details><summary class="mut">Historia punktów (${(a.historia || []).length} wpisów)</summary><div class="hlist">${(a.historia || []).map(e => `<div class="hl"><div class="hl-top"><span>${plDay(e.data)} · <b>${esc(e.zastep)}</b> · <span class="mut">${KAT[e.kat] || ""}</span></span><span class="hl-pts ${e.pkt < 0 ? "neg" : ""}">${sgn(e.pkt)}</span></div><div>${esc(e.opis)}</div><div class="mut">${esc(e.info)}</div></div>`).join("")}</div></details>
    <div class="row"><button class="pri" data-xlsx="${a.id}">⬇ Excel</button><button data-print="${a.id}">🖨 Drukuj / PDF</button>
    <button data-resave="${a.id}">🔄 Zapisz ponownie</button>${isAdmin() ? `<button class="del" data-adel="${a.id}">Usuń</button>` : ""}</div></div>`;
  return `<div class="card"><div class="row"><button id="back">← Ranking</button></div><h2>🗄 Archiwum kwartałów</h2>
    <p class="mut">Po zakończeniu kwartału jego wyniki zapisują się tu automatycznie (przy pierwszym otwarciu aplikacji przez kogoś z kadry). Zapis to „zdjęcie” wyników — późniejsze zmiany danych go nie zmieniają, chyba że klikniesz „Zapisz ponownie”.</p>
    <div class="row"><select id="aq">${S.cfg.kwartaly.map((q, i) => `<option value="${i}">${esc(q.nazwa)}</option>`).join("")}</select><button id="asave">💾 Zapisz teraz wybrany kwartał</button></div></div>
    ${known.filter(x => x.a).map(x => card(x.a)).join("")}${extra.map(card).join("")}
    ${!S.archiwum.length ? `<div class="card"><p class="mut">Archiwum jest puste — pierwszy wpis pojawi się po zakończeniu kwartału.</p></div>` : ""}`;
}
function bindArch() {
  $("#back").onclick = () => { S.view = null; render(); };
  const find = id => S.archiwum.find(a => a.id === id);
  $("#asave").onclick = async () => { const q = S.cfg.kwartaly[+$("#aq").value];
    if (S.archiwum.some(a => a.id === qKey(q)) && !confirm(`Nadpisać zapisane wyniki „${q.nazwa}” obecnymi danymi?`)) return;
    try { await saveArchive(q, false); } catch (e) { err(e); } };
  $$("[data-resave]").forEach(b => b.onclick = async () => { const a = find(b.dataset.resave), q = { nazwa: a.nazwa, start: a.start, end: a.end };
    if (!confirm(`Zapisać „${a.nazwa}” ponownie z obecnych danych? Poprzedni zapis zostanie zastąpiony.`)) return;
    try { await saveArchive(q, false); } catch (e) { err(e); } });
  $$("[data-adel]").forEach(b => b.onclick = () => confirm("Usunąć ten zapis z archiwum?") && deleteDoc(doc(db, "archiwum", b.dataset.adel)).catch(err));
  $$("[data-xlsx]").forEach(b => b.onclick = async () => { const a = find(b.dataset.xlsx); b.disabled = true;
    try { saveBlob(await archXlsx(a), `Punktacja ${safe(a.nazwa)}.xlsx`); } catch (e) { err(e); } b.disabled = false; });
  $$("[data-print]").forEach(b => b.onclick = () => printArch(find(b.dataset.print)));
}
// --- eksport do Excela (.xlsx budowany ręcznie, pakowany JSZip)
const xe = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function sheetXml(rows, widths) {
  const col = i => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const cell = (v, r, c, head) => { const ref = col(c) + (r + 1), st = head ? ' s="1"' : (typeof v === "number" ? ' s="2"' : "");
    return typeof v === "number" && isFinite(v) ? `<c r="${ref}"${st}><v>${Math.round(v * 1e6) / 1e6}</v></c>` : `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${xe(v)}</t></is></c>`; };
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
    <cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>
    <sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, r, c, r === 0)).join("")}</row>`).join("")}</sheetData></worksheet>`;
}
async function archXlsx(a) {
  const JSZip = await loadJSZip(), zip = new JSZip();
  const sheets = [
    ["Ranking", [["Miejsce", "Zastęp", "Zbiórki zastępu", "Zbiórki drużyny / biwaki", "Alarmy", "Sprawności", "Razem", "Streak (tyg.)"],
      ...(a.ranking || []).map(r => [r.miejsce, r.zastep, r.zbiorki, r.akcje, r.alarmy, r.sprawnosci ?? 0, r.suma, r.streak])], [9, 16, 16, 24, 10, 12, 10, 12]],
    ["Historia", [["Data", "Kategoria", "Zastęp", "Punkty", "Za co", "Szczegóły"],
      ...(a.historia || []).slice().sort((x, y) => x.data.localeCompare(y.data)).map(e => [plDay(e.data), KAT[e.kat] || e.kat, e.zastep, e.pkt, e.opis, e.info])], [12, 24, 14, 9, 40, 50]],
    ["Informacje", [["Pole", "Wartość"], ["Kwartał", a.nazwa], ["Od", plDay(a.start)], ["Do", plDay(a.end)], ["Status", a.koncowy ? "wyniki końcowe" : "stan na dzień zapisu"],
      ["Zapisano", plTs(a.zapisano)], ["Zapisał(a)", a.zapisalImie || ""], ["Pkt bazowe za zbiórkę", a.punktacja?.base], ["Przyrost streaka (pkt za kolejną zbiórkę)", a.punktacja?.przyrost ?? (a.punktacja?.base * a.punktacja?.step)], ["Pkt za mundur", a.punktacja?.mundur], ["Pkt za sprawność 1★ / 2★ / 3★", (a.punktacja?.sprawPkt || []).join(" / ")]], [24, 30]]];
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map(([n], i) => `<sheet name="${xe(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.##"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9E1D2"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`);
  sheets.forEach(([, rows, widths], i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(rows, widths)));
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
// --- wydruk / PDF
function printArch(a) {
  const html = archHtml(a);
  if (inApp()) return window.KniejaApp.printHtml(html, "Punktacja " + a.nazwa);
  const w = window.open("", "_blank"); if (!w) return alert("Przeglądarka zablokowała nowe okno — zezwól na wyskakujące okna.");
  w.document.write(html.replace("</body>", "<script>window.onload=()=>setTimeout(()=>print(),300)<\/script></body>")); w.document.close();
}
function archHtml(a) {
  return (`<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>Punktacja ${xe(a.nazwa)}</title><style>
    body{font:14px/1.4 Arial,sans-serif;margin:24px;color:#111}h1{font-size:20px;margin:0 0 4px}p{color:#555;margin:0 0 14px}
    table{border-collapse:collapse;width:100%;margin-bottom:22px}th,td{border:1px solid #ccc;padding:5px 7px;text-align:left}th{background:#eef2ea}td.n{text-align:right}
    h2{font-size:16px;margin:18px 0 6px}</style></head><body>
    <h1>Punktacja zastępów — ${xe(a.nazwa)}</h1><p>${plDay(a.start)} – ${plDay(a.end)} · ${a.koncowy ? "wyniki końcowe" : "stan na dzień zapisu"} · zapisano ${xe(plTs(a.zapisano))}</p>
    <h2>Ranking</h2><table><tr><th>Miejsce</th><th>Zastęp</th><th>Zbiórki zastępu</th><th>Zbiórki drużyny / biwaki</th><th>Alarmy</th><th>Sprawności</th><th>Razem</th></tr>
    ${(a.ranking || []).map(r => `<tr><td>${r.miejsce}.</td><td><b>${xe(r.zastep)}</b></td><td class="n">${frac(r.zbiorki)}</td><td class="n">${frac(r.akcje)}</td><td class="n">${frac(r.alarmy)}</td><td class="n">${frac(r.sprawnosci ?? 0)}</td><td class="n"><b>${frac(r.suma)}</b></td></tr>`).join("")}</table>
    <h2>Historia punktów</h2><table><tr><th>Data</th><th>Zastęp</th><th>Kategoria</th><th>Za co</th><th>Pkt</th></tr>
    ${(a.historia || []).slice().sort((x, y) => x.data.localeCompare(y.data)).map(e => `<tr><td>${plDay(e.data)}</td><td>${xe(e.zastep)}</td><td>${xe(KAT[e.kat] || "")}</td><td>${xe(e.opis)}<br><small>${xe(e.info)}</small></td><td class="n">${xe(sgn(e.pkt))}</td></tr>`).join("")}</table>
    </body></html>`);
}

// ---------- USTAWIENIA (kadra)
const APP_URL = "https://panbadek.github.io/Knieja-punkty/";
const APK_URL = "https://github.com/panbadek/Knieja-punkty/releases/latest/download/Kniejapunkty.apk";
const linkRow = (id, url) => `<div class="row"><input id="${id}" value="${url}" readonly style="flex:1;min-width:0" onfocus="this.select()">
  <button class="pri" data-copy="${id}">📋 Kopiuj</button>${navigator.share ? `<button data-share="${id}">📤 Udostępnij</button>` : ""}</div>`;
async function copyText(text, btn) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
    const t = document.createElement("textarea"); t.value = text; t.style.position = "fixed"; t.style.opacity = "0"; document.body.appendChild(t);
    t.select(); try { ok = document.execCommand("copy"); } catch (e2) {} t.remove(); }
  const old = btn.textContent; btn.textContent = ok ? "✔ Skopiowano" : "Zaznacz i skopiuj ręcznie"; setTimeout(() => btn.textContent = old, 2000);
}
function vUstawienia() {
  const c = S.cfg, list = (k, n) => `<input data-c="${k}" value="${(c[k] || []).join(", ")}" style="width:100%" title="${n}">`;
  return `<div class="card"><h2>🔗 Link do aplikacji</h2>
   <p class="mut">Wyślij go szeregowym, zastępowym i kadrze. Działa na każdym telefonie i komputerze.</p>
   ${linkRow("lnk_web", APP_URL)}
   <h3>Aplikacja na Androida (APK)</h3>
   ${linkRow("lnk_apk", APK_URL)}
   <p class="mut">Po pobraniu pliku trzeba zezwolić na instalację z tego źródła.</p></div>
   <div class="card"><h2>Ustawienia punktacji</h2>
   <div class="row">Pkt bazowe za zbiórkę zastępu <input type="number" data-c="base" value="${c.base}"></div>
   <div class="row">Przyrost streaka: + <input type="number" step="0.5" inputmode="decimal" data-c="przyrost" value="${streakInc(c)}"> pkt za każdą kolejną zbiórkę</div>
   <p class="mut" id="sex">${streakExample(c)}</p>
   <div class="row">Pkt za mundur na osobę <input type="number" data-c="mundur" value="${c.mundur}"></div>
   <h3>Sprawność — punkty za 1★, 2★, 3★</h3>${list("sprawPkt")}
   <h3>Gra duża (1.–6. miejsce)</h3>${list("duze")}<h3>Gra mała</h3>${list("male")}
   <h3>Alarm — punkty za osobę w progach</h3>${list("alarmProgi")}<h3>Alarm — bonus za kolejność zastępów</h3>${list("alarmBonus")}
   <h3>Alarm — domyślne progi czasowe (min)</h3>${list("alarmProgiMin")}
   <h3>Liczebność zastępów (h)</h3><div class="row">${ZASTEPY.map(z => `<label>${z} <input type="number" data-l="${z}" value="${c.liczebnosc[z] ?? ""}"></label>`).join("")}</div>
   <h3>Kwartały</h3><div id="kw">${c.kwartaly.map((q, i) => `<div class="row"><input data-k="${i}.nazwa" value="${esc(q.nazwa)}">
     <input type="date" data-k="${i}.start" value="${q.start}"><input type="date" data-k="${i}.end" value="${q.end}"><button class="del" data-kdel="${i}">✖</button></div>`).join("")}</div>
   <button id="kadd">+ Kwartał</button>
   <div class="row" style="margin-top:14px"><button class="pri" id="csave">Zapisz ustawienia</button></div>
   <p class="mut">Zmiana ustawień przelicza wszystkie wyniki od nowa. Streak zeruje się na początku każdego kwartału.</p></div>`;
}
const streakExample = c => "Np.: " + [1, 2, 3, 4, 5].map(n => `${n}. zbiórka ${frac(zbiorkaPts(c, n))}`).join(" · ") + " pkt";
binders.ustawienia = () => {
  const ex = () => { const b = Number($('[data-c="base"]').value), x = Number($('[data-c="przyrost"]').value); $("#sex").textContent = streakExample({ base: b, przyrost: x }); };
  $('[data-c="base"]').addEventListener("input", ex); $('[data-c="przyrost"]').addEventListener("input", ex);
  $$("[data-copy]").forEach(b => b.onclick = () => copyText($("#" + b.dataset.copy).value, b));
  $$("[data-share]").forEach(b => b.onclick = () => navigator.share({ title: "Kniejapunkty", text: "Punktacja zastępów", url: $("#" + b.dataset.share).value }).catch(() => {}));
  const c = structuredClone(S.cfg);
  const read = () => {
    $$("[data-c]").forEach(el => { const k = el.dataset.c;
      c[k] = Array.isArray(DEFAULT_CONFIG[k]) ? el.value.split(/[,; ]+/).filter(Boolean).map(Number) : Number(el.value); });
    $$("[data-l]").forEach(el => c.liczebnosc[el.dataset.l] = Number(el.value));
    $$("[data-k]").forEach(el => { const [i, f] = el.dataset.k.split("."); c.kwartaly[i][f] = el.value; });
  };
  $("#kadd").onclick = () => { read(); c.kwartaly.push({ nazwa: "Nowy kwartał", start: today(), end: today() }); S.cfg = c; render(); };
  $$("[data-kdel]").forEach(b => b.onclick = () => { read(); c.kwartaly.splice(+b.dataset.kdel, 1); S.cfg = c; render(); });
  $("#csave").onclick = () => { read(); c.step = c.base ? c.przyrost / c.base : 0; setDoc(doc(db, "config", "main"), c).then(() => alert("Zapisano")).catch(err); };
};

// ---------- UŻYTKOWNICY (tylko administrator)
// Firebase (plan darmowy) nie pozwala administratorowi zmienić hasła ani usunąć cudzego konta bezpośrednio,
// więc robimy to, logując się na chwilę na to konto w osobnej, niewidocznej sesji (hasło trzymamy w kolekcji
// "sekrety", którą może czytać tylko administrator).
const ROLE = [["szeregowy", "Szeregowy"], ["zastepowy", "Zastępowy"], ["kadra", "Kadra"]];
const ROLE_PL = { ...Object.fromEntries(ROLE), admin: "Kadra" };
let _sec = null;
const secAuth = () => _sec || (_sec = initializeAuth(initializeApp(firebaseConfig, "admin-helper"), { persistence: inMemoryPersistence }));
async function asUser(email, pass, fn) {
  const a = secAuth(); const c = await signInWithEmailAndPassword(a, email, pass);
  try { return await fn(c.user); } finally { await signOut(a).catch(() => {}); }
}
const loginOfUser = u => u.login || loginOf(u.email);
const loginTaken = async (login, exceptId) => {
  const m = await getDoc(doc(db, "loginy", login));
  if (m.exists() && m.data().uid !== exceptId) return true;
  return S.users.some(u => u.id !== exceptId && loginOfUser(u) === login);
};
const genPass = () => { const a = "abcdefghjkmnpqrstuvwxyz23456789"; return Array.from({ length: 8 }, () => a[Math.floor(Math.random() * a.length)]).join(""); };
const emptyUser = () => ({ imie: "", login: "", haslo: genPass(), rola: "szeregowy", zastep: "" });

// Sortowanie kont: funkcja (kadra → zastępowi → szeregowi), zastęp (kolejność zastępów, w środku zastępowy pierwszy), imię
try { S.uSort = localStorage.getItem("uSort") || "funkcja"; } catch (e) { S.uSort = "funkcja"; }
const ROLE_ORDER = { admin: 0, kadra: 0, zastepowy: 1, szeregowy: 2 };
function sortUsers(list, by) {
  const r = u => ROLE_ORDER[u.rola] ?? 9, z = u => ZASTEPY.includes(u.zastep) ? ZASTEPY.indexOf(u.zastep) : 99;
  const name = (a, b) => (a.imie || "").localeCompare(b.imie || "", "pl");
  const cmp = { funkcja: (a, b) => r(a) - r(b) || (isAdm(b) - isAdm(a)) || z(a) - z(b) || name(a, b),
                zastep: (a, b) => z(a) - z(b) || r(a) - r(b) || name(a, b),
                imie: name }[by] || name;
  return [...list].sort(cmp);
}
// ---------- WIELE KONT NARAZ (administrator) + pakiety loginów i haseł zastępami
// Lista: wiersz z nazwą zastępu, pod nim osoby „Imię Nazwisko; login; hasło” (login i hasło można pominąć — zostaną wygenerowane).
// Dopiski w nawiasach (np. stopnie) są pomijane. Osoby, które mają już konto (to samo imię i nazwisko), są pomijane.
const normName = n => normLogin(n).split(/[._-]+/).filter(Boolean).sort().join(" ");
function parseImport(text) {
  const rows = [], bad = []; let z = "";
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    const zz = ZASTEPY.find(x => x.toLowerCase() === line.replace(/[:\-–—\s\d()]+$/, "").trim().toLowerCase());
    if (zz) { z = zz; continue; }
    const [imieRaw, login = "", haslo = ""] = line.split(/\s*[;\t]\s*/);
    const imie = imieRaw.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
    if (!imie) continue;
    if (!z) { bad.push(line); continue; }
    rows.push({ zastep: z, imie, login: normLogin(login) || normLogin(imie), haslo: haslo.trim() });
  }
  return { rows, bad };
}
function prepImport(rows) {
  const taken = new Set(S.users.map(loginOfUser));
  return rows.map(r => {
    const ex = S.users.find(u => normName(u.imie || "") === normName(r.imie));
    let login = r.login, n = 2;
    if (!ex) { while (taken.has(login)) login = r.login + n++; taken.add(login); }
    return { ...r, login, zm: login !== r.login, haslo: r.haslo.length >= 6 ? r.haslo : genPass(), nowe: r.haslo.length < 6,
      ex: ex ? { login: loginOfUser(ex), zastep: ex.zastep || "" } : null, take: !ex };
  });
}
function vImport() {
  const v = S.view;
  if (!v.rows) return `<div class="card"><div class="row"><button id="back">← Konta</button></div><h2>📥 Dodaj wiele kont</h2>
    <p class="mut">Wklej listę: najpierw wiersz z nazwą zastępu, pod nim osoby — każda w osobnym wierszu: <b>Imię Nazwisko; login; hasło</b>.
    Login i hasło możesz pominąć (zostaną wygenerowane). Dopiski w nawiasach, np. stopnie, są pomijane. Wszyscy dostają funkcję „szeregowy” — zastępowych zmienisz potem na liście kont.</p>
    <textarea id="imp_t" rows="14" style="width:100%" placeholder="Lisy&#10;Jan Kowalski; jan.kowalski; haslo123&#10;Adam Nowak&#10;&#10;Łosie&#10;…"></textarea>
    <div class="row"><button class="pri" id="imp_chk">Sprawdź listę →</button></div></div>`;
  const take = v.rows.filter(r => r.take).length, cnt = {}; v.rows.forEach(r => cnt[r.zastep] = (cnt[r.zastep] || 0) + 1);
  const rows = ZASTEPY.filter(z => cnt[z]).map(z => `<h3>${z} <span class="mut">(${cnt[z]} na liście)</span></h3><div class="clist">${v.rows.map((r, i) => r.zastep !== z ? "" :
    `<div class="crow"><label class="chk" style="flex:1"><input type="checkbox" data-it="${i}" ${r.take ? "checked" : ""}> <span><b>${esc(r.imie)}</b><br>
      <span class="mut">${r.ex ? `ma już konto: ${esc(r.ex.login)}${r.ex.zastep !== z ? ` · <span class="err">w aplikacji: ${esc(r.ex.zastep || "bez zastępu")}</span>` : ""}`
        : `login: ${esc(r.login)}${r.zm ? " (zajęty — dodano numer)" : ""} · hasło: ${esc(r.haslo)}${r.nowe ? " (wygenerowane)" : ""}`}</span></span></label></div>`).join("")}</div>`).join("");
  return `<div class="card"><div class="row"><button id="back">← Konta</button></div><h2>📥 Dodaj wiele kont — sprawdzenie</h2>
    <p class="mut">Zaznaczone osoby dostaną nowe konta. Osoby, które mają już konto (to samo imię i nazwisko), są odznaczone.</p>
    ${v.bad?.length ? `<p class="err">Pominięto wiersze bez zastępu nad nimi: ${v.bad.map(esc).join(" · ")}</p>` : ""}
    ${rows}
    <div class="row"><label class="chk"><input type="checkbox" id="imp_l"> Ustaw liczebność zastępów według tej listy (${ZASTEPY.filter(z => cnt[z]).map(z => `${z} ${cnt[z]}`).join(", ")})</label></div>
    <div class="row"><button class="pri" id="imp_go" ${take ? "" : "disabled"}>Utwórz konta (${take})</button><button id="imp_edit">← Popraw listę</button></div>
    <p class="mut" id="imp_log"></p></div>`;
}
function bindImport() {
  $("#back").onclick = () => { S.view = null; render(); };
  if (!S.view.rows) { $("#imp_t").value = S.view.text || "";
    $("#imp_chk").onclick = () => { const text = $("#imp_t").value, { rows, bad } = parseImport(text);
      if (!rows.length) return alert("Nie znalazłem żadnej osoby pod nazwą zastępu. Pierwszy wiersz to nazwa zastępu, np. „Lisy”.");
      S.view = { kind: "import", text, rows: prepImport(rows), bad }; render(); };
    return; }
  $$("[data-it]").forEach(c => c.onchange = () => { S.view.rows[+c.dataset.it].take = c.checked;
    const n = S.view.rows.filter(r => r.take).length, b = $("#imp_go"); b.textContent = `Utwórz konta (${n})`; b.disabled = !n; });
  $("#imp_edit").onclick = () => { S.view = { kind: "import", text: S.view.text }; render(); };
  $("#imp_go").onclick = () => runImport($("#imp_go"));
}
async function runImport(btn) {
  const v = S.view, rows = v.rows.filter(r => r.take), setL = $("#imp_l")?.checked;
  if (!confirm(`Utworzyć ${rows.length} ${plural(rows.length, "konto", "konta", "kont")}?`)) return;
  S.busy = true; btn.disabled = true; $("#imp_edit").disabled = true; const log = $("#imp_log"), done = [], errs = [];
  for (const [i, r] of rows.entries()) {
    btn.textContent = `Tworzę ${i + 1} z ${rows.length}…`;
    try {
      let login = r.login, n = 2; while (await loginTaken(login)) login = r.login + n++;
      const email = "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + DOMAIN;
      const c = await createUserWithEmailAndPassword(secAuth(), email, r.haslo); await signOut(secAuth()).catch(() => {});
      const uid = c.user.uid;
      await setDoc(doc(db, "users", uid), { email, login, imie: r.imie, rola: "szeregowy", admin: false, zastep: r.zastep });
      await setDoc(doc(db, "loginy", login), { email, uid });
      await setDoc(doc(db, "sekrety", uid), { haslo: r.haslo });
      S.secrets = { ...S.secrets, [uid]: r.haslo }; done.push(uid);
    } catch (e) { errs.push(`${r.imie}: ${PL_ERR[e.code] || e.message || e}`); }
    if (log) log.textContent = `Utworzono ${done.length}${errs.length ? ` · błędy: ${errs.length}` : ""}`;
  }
  if (setL) { const cnt = {}; v.rows.forEach(r => cnt[r.zastep] = (cnt[r.zastep] || 0) + 1);
    try { await setDoc(doc(db, "config", "main"), { ...S.cfg, liczebnosc: { ...S.cfg.liczebnosc, ...cnt } }); } catch (e) { errs.push("Liczebność zastępów: " + (e.message || e)); } }
  S.busy = false; S.view = { kind: "pakiety", nowe: done, errs, tylkoNowe: done.length > 0 }; render();
}
// --- pakiety: loginy i hasła zastępami, do skopiowania i wysłania
function pakietTxt(z, list) {
  return `Kniejapunkty — konta zastępu ${z}\n${APP_URL}\n\n` + list.map(u => `${u.imie || loginOfUser(u)}\n  login: ${loginOfUser(u)}\n  hasło: ${S.secrets?.[u.id] || "(nieznane — administrator może ustawić nowe)"}`).join("\n\n")
    + `\n\nHasło każdy może zmienić sam w zakładce „👤 Ja”.`;
}
function vPakiety() {
  if (!isAdmin()) { S.view = null; return vUsers(); }
  const v = S.view, nowe = new Set(v.nowe || []), only = v.tylkoNowe && nowe.size;
  const groups = ZASTEPY.map(z => ({ z, list: sortUsers(S.users.filter(u => u.zastep === z && (!only || nowe.has(u.id))), "funkcja") })).filter(g => g.list.length);
  return `<div class="card"><div class="row"><button id="back">← Konta</button></div><h2>📦 Loginy i hasła zastępami</h2>
    ${nowe.size ? `<p>✅ Utworzono <b>${nowe.size}</b> ${plural(nowe.size, "konto", "konta", "kont")}.</p>` : ""}
    ${v.errs?.length ? `<p class="err">Nie udało się: ${v.errs.map(esc).join(" · ")}</p>` : ""}
    ${nowe.size ? `<div class="row"><label class="chk"><input type="checkbox" id="pk_only" ${only ? "checked" : ""}> Pokaż tylko nowo utworzone konta</label></div>` : ""}
    <p class="mut">Każdy pakiet możesz skopiować i wysłać zastępowemu albo harcerzom (np. na Messengerze).</p>
    <div class="row"><button id="pk_all">📋 Kopiuj wszystkie</button></div></div>
    ${groups.map((g, i) => `<div class="card"><h3 style="margin-top:0">${g.z} <span class="mut">(${g.list.length})</span></h3>
      <pre class="pak" id="pk_${i}">${esc(pakietTxt(g.z, g.list))}</pre>
      <div class="row"><button class="pri" data-pk="${i}">📋 Kopiuj</button>${navigator.share ? `<button data-pks="${i}">📤 Udostępnij</button>` : ""}</div></div>`).join("")
      || `<div class="card"><p class="mut">Brak kont przypisanych do zastępów.</p></div>`}`;
}
function bindPakiety() {
  $("#back").onclick = () => { S.view = null; render(); };
  $("#pk_only") && ($("#pk_only").onchange = e => { S.view.tylkoNowe = e.target.checked; render(); });
  $$("[data-pk]").forEach(b => b.onclick = () => copyText($("#pk_" + b.dataset.pk).textContent, b));
  $$("[data-pks]").forEach(b => b.onclick = () => navigator.share({ text: $("#pk_" + b.dataset.pks).textContent }).catch(() => {}));
  $("#pk_all").onclick = () => copyText([...$$(".pak")].map(p => p.textContent).join("\n\n— — —\n\n"), $("#pk_all"));
}

function vUsers() {
  if (!isKadra()) return `<div class="card"><p class="err">Tylko kadra ma dostęp do kont.</p></div>`;
  if (S.edit?.kind === "user") return vUserEdit();
  if (S.view?.kind === "import" && isAdmin()) return vImport();
  if (S.view?.kind === "pakiety") return vPakiety();
  const adm = isAdmin();
  const users = sortUsers(S.users, S.uSort);
  return `<div class="card"><h2>Konta <span class="badge">${users.length}</span></h2>${adm ? `<div class="row"><button class="pri" id="unew">+ Nowe konto</button><button id="uimp">📥 Dodaj wiele kont</button><button id="upak">📦 Loginy i hasła zastępami</button></div>` : ""}
   <div class="row"><span class="mut">Sortuj:</span>${[["funkcja", "funkcja"], ["zastep", "zastęp"], ["imie", "imię i nazwisko"]].map(([v, l]) =>
     `<button data-usort="${v}" class="${S.uSort === v ? "on" : ""}">${l}</button>`).join("")}</div>
   <div class="scroll"><table><tr><th>Imię i nazwisko</th><th>Login</th>${adm ? "<th>Hasło</th>" : ""}<th>Funkcja</th><th>Zastęp</th><th></th></tr>
   ${users.map(u => `<tr><td>${esc(u.imie)}${u.id === S.user.uid ? ` <span class="badge">Ty</span>` : ""}</td><td>${esc(loginOfUser(u))}</td>
   ${adm ? `<td>${S.secrets?.[u.id] ? `<button data-show="${u.id}" class="mut">pokaż</button>` : `<span class="mut">nieznane</span>`}</td>` : ""}
   <td>${ROLE_PL[u.rola] || `<span class="err">${esc(u.rola || "brak")}</span>`}${isAdm(u) ? `<div><span class="badge ok adm">🛡️ admin</span></div>` : ""}</td>
   <td>${ZASTEPY.includes(u.zastep) ? u.zastep : (["zastepowy", "szeregowy"].includes(u.rola) ? `<span class="err">⚠ brak</span>` : "–")}</td>
   <td><button data-ue="${u.id}" title="Edytuj" aria-label="Edytuj">✎</button></td></tr>`).join("")}</table></div>
   <p class="mut">Kadra zmienia funkcję i zastęp. Administrator dodatkowo zakłada i usuwa konta, zmienia imię i nazwisko, login, hasło i uprawnienia administratora. Hasło każdy może też zmienić sam w zakładce „👤 Ja”.</p></div>`;
}
function vUserEdit() {
  const u = S.edit.d, isNew = !S.edit.id, self = S.edit.id === S.user.uid, known = !!S.secrets?.[S.edit.id];
  if (!isAdmin()) {                                   // kadra bez uprawnień administratora: tylko funkcja i zastęp
    const lock = self || u.admin;
    return `<div class="card"><h2>Edycja konta</h2>
     <p><b>${esc(u.imie)}</b> <span class="mut">· login: ${esc(u.login)}</span></p>
     <div class="row"><label>Funkcja<br><select id="f_rola" ${lock ? "disabled" : ""}>${ROLE.map(([v, l]) => `<option value="${v}" ${u.rola === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
     <label>Zastęp<br><select id="f_zastep" ${lock ? "disabled" : ""}><option value="">–</option>${ZASTEPY.map(z => `<option ${u.zastep === z ? "selected" : ""}>${z}</option>`).join("")}</select></label></div>
     ${lock ? `<p class="mut">${self ? "Własnej funkcji i zastępu nie zmieniasz sam — poproś innego członka kadry." : "To konto administratora — zmienia je inny administrator."}</p>` : ""}
     <p class="mut">Imię i nazwisko, login, hasło i uprawnienia administratora zmienia administrator.</p>
     <div class="row">${lock ? "" : `<button class="pri" id="usave">Zapisz</button>`}<button id="cancel">Anuluj</button></div></div>`;
  }
  return `<div class="card"><h2>${isNew ? "Nowe konto" : "Edycja konta"}</h2>
   <div class="row"><label>Imię i nazwisko<br><input id="f_imie" value="${esc(u.imie)}" autocapitalize="words"></label></div>
   <div class="row"><label>Login<br><input id="f_login" value="${esc(u.login)}" autocapitalize="none" spellcheck="false"></label></div>
   <div class="row"><label>Hasło${isNew ? "" : " (puste = bez zmian)"}<br><input id="f_haslo" value="${esc(isNew ? u.haslo : "")}" autocapitalize="none" spellcheck="false" placeholder="${isNew ? "" : (known ? "••••••" : "")}"></label></div>
   ${!isNew ? `<div class="row"><label>Twoje hasło administratora <span class="mut">(potwierdzenie przy zmianie hasła lub usuwaniu konta)</span><br><input id="f_adm" type="password" autocomplete="current-password"></label></div>
   ${!known && !self ? `<p class="mut">⚠ Hasło tego konta nie jest zapisane. Przy zmianie hasła aplikacja odtworzy konto z tym samym loginem, imieniem, funkcją i zastępem.</p>` : ""}` : ""}
   <div class="row"><label>Funkcja<br><select id="f_rola" ${self ? "disabled" : ""}>${ROLE.map(([v, l]) => `<option value="${v}" ${u.rola === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
   <label>Zastęp<br><select id="f_zastep"><option value="">–</option>${ZASTEPY.map(z => `<option ${u.zastep === z ? "selected" : ""}>${z}</option>`).join("")}</select></label></div>
   <div class="row" id="adminRow" ${u.rola === "kadra" ? "" : "hidden"}><label class="sw"><input type="checkbox" id="f_admin" ${u.admin ? "checked" : ""} ${self ? "disabled" : ""}><span></span> Administrator</label>
   <span class="mut">${self ? "Twoje uprawnienia administratora może zmienić tylko inny administrator." : "Może zarządzać kontami (tylko dla kadry)."}</span></div>
   <p class="mut">Login: małe litery bez polskich znaków, cyfry, kropka, myślnik. Hasło: min. 6 znaków.</p>
   <div class="row"><button class="pri" id="usave">${isNew ? "Utwórz konto" : "Zapisz"}</button><button id="cancel">Anuluj</button>
   ${!isNew && !self ? `<button class="del" id="udel">Usuń konto</button>` : ""}</div></div>`;
}
binders.uzytkownicy = () => {
  if (!isKadra()) return;
  if (S.edit?.kind === "user") return bindUserEdit();
  if (S.view?.kind === "import" && isAdmin()) return bindImport();
  if (S.view?.kind === "pakiety") return bindPakiety();
  $("#uimp") && ($("#uimp").onclick = () => { S.view = { kind: "import" }; render(); });
  $("#upak") && ($("#upak").onclick = () => { S.view = { kind: "pakiety" }; render(); });
  $$("[data-usort]").forEach(b => b.onclick = () => { S.uSort = b.dataset.usort; try { localStorage.setItem("uSort", S.uSort); } catch (e) {} render(); });
  $("#unew") && ($("#unew").onclick = () => { S.edit = { kind: "user", d: emptyUser() }; render(); });
  $$("[data-ue]").forEach(b => b.onclick = () => { const u = S.users.find(x => x.id === b.dataset.ue);
    S.edit = { kind: "user", id: u.id, d: { ...u, login: loginOfUser(u), rola: u.rola === "admin" ? "kadra" : u.rola, admin: isAdm(u) } }; render(); });
  $$("[data-show]").forEach(b => b.onclick = () => { b.textContent = S.secrets[b.dataset.show]; b.classList.remove("mut"); });
};
function bindUserEdit() {
  if (!isAdmin()) {
    $("#cancel").onclick = () => { S.edit = null; render(); };
    $("#usave") && ($("#usave").onclick = () => { const rola = $("#f_rola").value, zastep = $("#f_zastep").value;
      if (["szeregowy", "zastepowy"].includes(rola) && !zastep) return alert("Wybierz zastęp");
      busy($("#usave"), "Zapisuję…", () => updateDoc(doc(db, "users", S.edit.id), { rola, zastep })); });
    return;
  }
  $("#f_imie").oninput = () => { if (!S.edit.id && !S.edit.loginTouched) $("#f_login").value = normLogin($("#f_imie").value); };
  $("#f_login").oninput = () => { S.edit.loginTouched = true; };
  $("#f_rola").onchange = () => { $("#adminRow").hidden = $("#f_rola").value !== "kadra"; };
  $("#cancel").onclick = () => { S.edit = null; render(); };
  $("#usave").onclick = () => saveUser($("#usave"));
  $("#udel") && ($("#udel").onclick = () => removeUser($("#udel")));
}
async function busy(btn, label, fn) {
  const t = btn.textContent; btn.disabled = true; btn.textContent = label; S.busy = true;
  try { await fn(); S.edit = null; S.busy = false; render(); }
  catch (e) { S.busy = false; btn.disabled = false; btn.textContent = t; if (e.message !== "Anulowano") alert(PL_ERR[e.code] || ("Błąd: " + (e.message || e))); }
}
function saveUser(btn) {
  const id = S.edit.id, old = S.edit.d;
  const imie = $("#f_imie").value.trim().replace(/\s+/g, " "), login = normLogin($("#f_login").value), haslo = $("#f_haslo").value;
  const rolaV = $("#f_rola").value, adminV = rolaV === "kadra" && $("#f_admin").checked, zastep = $("#f_zastep").value, admPass = $("#f_adm")?.value || "";
  if (imie.length < 2) return alert("Wpisz imię i nazwisko");
  if (login.length < 2) return alert("Wpisz login");
  if ((!id || haslo) && haslo.length < 6) return alert("Hasło musi mieć co najmniej 6 znaków");
  if (["szeregowy", "zastepowy"].includes(rolaV) && !zastep) return alert("Wybierz zastęp");
  if (id && haslo && !admPass) return alert("Wpisz swoje hasło administratora, żeby potwierdzić zmianę hasła");
  busy(btn, "Zapisuję…", async () => {
    if (await loginTaken(login, id)) throw new Error("Ten login jest już zajęty");
    if (!id) {                                   // nowe konto
      const email = "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + DOMAIN;
      const c = await createUserWithEmailAndPassword(secAuth(), email, haslo); await signOut(secAuth()).catch(() => {});
      const uid = c.user.uid;
      await setDoc(doc(db, "users", uid), { email, login, imie, rola: rolaV, admin: adminV, zastep });
      await setDoc(doc(db, "loginy", login), { email, uid });
      await setDoc(doc(db, "sekrety", uid), { haslo });
      alert(`Konto utworzone.\nLogin: ${login}\nHasło: ${haslo}`);
      return;
    }
    if (haslo) {                                 // zmiana hasła (potwierdzona hasłem administratora)
      await confirmAdmin(admPass);
      if (id === S.user.uid) await updatePassword(auth.currentUser, haslo);          // własne hasło
      else {
        let cur = S.secrets?.[id];
        if (!cur) {
          try { cur = (await getDoc(doc(db, "sekrety", id))).data()?.haslo; }
          catch (e) { throw new Error("Brak dostępu do zapisanych haseł — sprawdź, czy reguły w Firebase są aktualne."); }
        }
        if (!cur) {                                // hasło nieznane → odtworzenie konta z nowym hasłem
          if (!confirm(`Hasło konta „${imie}” nie jest zapisane, więc nie da się go zmienić bezpośrednio.\n\nUtworzyć to konto na nowo z tym samym loginem, imieniem, funkcją i zastępem oraz nowym hasłem?`)) throw new Error("Anulowano");
          await recreateUser(id, old, { imie, login, rola: id === S.user.uid ? old.rola : rolaV, admin: adminV, zastep, haslo });
          alert(`Konto odtworzone.\nLogin: ${login}\nHasło: ${haslo}`);
          return;
        }
        await asUser(old.email, cur, u => updatePassword(u, haslo));
      }
      await setDoc(doc(db, "sekrety", id), { haslo });
    }
    const oldLogin = loginOfUser(old);
    if (login !== oldLogin || !old.login) {      // zmiana loginu (albo pierwsze przypisanie u starszych kont)
      await setDoc(doc(db, "loginy", login), { email: old.email, uid: id });
      if (login !== oldLogin) await deleteDoc(doc(db, "loginy", oldLogin)).catch(() => {});
    }
    const upd = { imie, login, zastep }; if (id !== S.user.uid) { upd.rola = rolaV; upd.admin = adminV; }
    await updateDoc(doc(db, "users", id), upd);
  });
}
// Odtworzenie konta bez zapisanego hasła: nowe konto logowania, ten sam login i dane; stare przestaje działać.
async function recreateUser(oldId, old, d) {
  const email = "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + DOMAIN;
  const c = await createUserWithEmailAndPassword(secAuth(), email, d.haslo); await signOut(secAuth()).catch(() => {});
  const uid = c.user.uid;
  await setDoc(doc(db, "users", uid), { email, login: d.login, imie: d.imie, rola: d.rola, admin: !!d.admin, zastep: d.zastep, poprzednieId: oldId });
  await setDoc(doc(db, "loginy", d.login), { email, uid });
  if (loginOfUser(old) !== d.login) await deleteDoc(doc(db, "loginy", loginOfUser(old))).catch(() => {});
  await setDoc(doc(db, "sekrety", uid), { haslo: d.haslo });
  await deleteDoc(doc(db, "sekrety", oldId)).catch(() => {});
  await deleteDoc(doc(db, "users", oldId));
}
// Potwierdzenie hasłem zalogowanego administratora (ponowne uwierzytelnienie w Firebase).
async function confirmAdmin(pass) {
  try { await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(auth.currentUser.email, pass)); }
  catch (e) { throw new Error("Złe hasło administratora"); }
}
function removeUser(btn) {
  const id = S.edit.id, u = S.edit.d, pass = S.secrets?.[id], admPass = $("#f_adm")?.value || "";
  if (!admPass) return alert("Wpisz swoje hasło administratora, żeby potwierdzić usunięcie");
  if (!confirm(`Usunąć konto ${u.imie}? Tej operacji nie da się cofnąć.`)) return;
  busy(btn, "Usuwam…", async () => {
    await confirmAdmin(admPass);
    let authNote = "";
    if (pass) await asUser(u.email, pass, x => deleteUser(x));
    else authNote = "\n\nTo konto założono przed zmianami, więc jego dane logowania zostały w Firebase (Authentication → Users), ale nie da się już na nim nic zrobić.";
    await deleteDoc(doc(db, "loginy", loginOfUser(u))).catch(() => {});
    await deleteDoc(doc(db, "sekrety", id)).catch(() => {});
    await deleteDoc(doc(db, "users", id));
    alert("Konto usunięte." + authNote);
  });
}
