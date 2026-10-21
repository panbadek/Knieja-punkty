import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, onSnapshot, setDoc, addDoc, updateDoc, deleteDoc, getDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { ZASTEPY, DEFAULT_CONFIG, quarterTotals, akcjaPoints, alarmPoints, frac, fmtD } from "./scoring.js";

const app = initializeApp(firebaseConfig), auth = getAuth(app), db = getFirestore(app);
const S = { user: null, profile: null, cfg: DEFAULT_CONFIG, zbiorki: [], akcje: [], alarmy: [], users: [], tab: "wyniki", q: 0, edit: null };
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
const today = () => fmtD(Date.now() + 2*3600e3);   // ok. czas PL
const rola = () => S.profile?.rola || "gosc";
const isKadra = () => rola() === "kadra", canEdit = () => ["kadra","zastepowy"].includes(rola());
const quarter = () => S.cfg.kwartaly[S.q] || S.cfg.kwartaly[0];
const inQ = d => d >= quarter().start && d <= quarter().end;
const err = e => alert("Błąd: " + (e.message || e));

// ---------- dane na żywo
onSnapshot(doc(db, "config", "main"), s => { S.cfg = { ...DEFAULT_CONFIG, ...(s.data() || {}) }; pickQuarter(); render(); });
const live = (name, key, sort) => onSnapshot(collection(db, name), s => {
  S[key] = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.data || "").localeCompare(a.data || "")); render();
});
live("zbiorkiZastepu", "zbiorki"); live("akcje", "akcje"); live("alarmy", "alarmy");
let usersUnsub = null;
onAuthStateChanged(auth, async u => {
  S.user = u; S.profile = null; usersUnsub?.(); usersUnsub = null;
  if (u) {
    const ref = doc(db, "users", u.uid); let s = await getDoc(ref);
    if (!s.exists()) { await setDoc(ref, { email: u.email, imie: loginOf(u.email), rola: "brak", zastep: "" }); s = await getDoc(ref); }
    onSnapshot(ref, d => { S.profile = d.data(); if (isKadra() && !usersUnsub) usersUnsub = onSnapshot(collection(db, "users"),
      s => { S.users = s.docs.map(d => ({ id: d.id, ...d.data() })); render(); }); render(); });
  }
  render();
});
function pickQuarter() { const t = today(); const i = S.cfg.kwartaly.findIndex(q => t >= q.start && t <= q.end); if (i >= 0 && S._qset !== true) S.q = i; }

// ---------- nawigacja i logowanie
const TABS = [["wyniki","🏆 Wyniki"],["zbiorki","🔥 Zbiórki zastępu"],["akcje","⛺ Zbiórki drużyny / biwaki"],["alarmy","🚨 Alarmy"],["ustawienia","⚙️ Ustawienia"],["uzytkownicy","👥 Użytkownicy"]];
function renderChrome() {
  $("#who").textContent = S.user ? `${S.profile?.imie || loginOf(S.user.email)} · ${{ kadra: "kadra", zastepowy: "zastępowy " + (S.profile?.zastep || ""), brak: "czeka na nadanie roli" }[rola()] || ""}` : "podgląd wyników";
  $("#authbox").innerHTML = S.user ? `<button id="out">Wyloguj</button>` : `<button id="in">Zaloguj</button>`;
  $("#out") && ($("#out").onclick = () => signOut(auth));
  $("#in") && ($("#in").onclick = () => { S.tab = "login"; render(); });
  const vis = TABS.filter(([k]) => k === "wyniki" || (["zbiorki","akcje","alarmy"].includes(k)) || (["ustawienia","uzytkownicy"].includes(k) && isKadra()));
  $("#nav").innerHTML = vis.map(([k, l]) => `<button data-t="${k}" class="${S.tab === k ? "on" : ""}">${l}</button>`).join("");
  $("#nav").querySelectorAll("button").forEach(b => b.onclick = () => { S.tab = b.dataset.t; S.edit = null; render(); });
}
function quarterPicker() {
  return `<div class="row"><span class="mut">Kwartał:</span><select id="qsel">${S.cfg.kwartaly.map((q, i) =>
    `<option value="${i}" ${i == S.q ? "selected" : ""}>${esc(q.nazwa)} (${q.start} – ${q.end})</option>`).join("")}</select></div>`;
}
function bindQuarter() { $("#qsel") && ($("#qsel").onchange = e => { S.q = +e.target.value; S._qset = true; render(); }); }

function render() {
  renderChrome();
  const m = $("#main");
  const views = { wyniki: vWyniki, zbiorki: vZbiorki, akcje: vAkcje, alarmy: vAlarmy, ustawienia: vUstawienia, uzytkownicy: vUsers, login: vLogin };
  m.innerHTML = (views[S.tab] || vWyniki)();
  bindQuarter(); (binders[S.tab] || (() => {}))();
}
const binders = {};

// ---------- logowanie
function vLogin() {
  return `<div class="card"><h2>Logowanie</h2>
  <div class="row"><input id="em" placeholder="login" autocomplete="username" autocapitalize="none" spellcheck="false"></div>
  <div class="row"><input id="pw" type="password" placeholder="hasło (min. 6 znaków)" autocomplete="current-password"></div>
  <div class="row"><button class="pri" id="li">Zaloguj</button><button id="reg">Załóż konto</button></div>
  <p class="mut">Login: małe litery bez polskich znaków, cyfry, kropka, myślnik (np. <b>jan.kowalski</b>).<br>
  Po założeniu konta kadra musi nadać Ci rolę (kadra albo zastępowy danego zastępu).</p></div>`;
}
const DOMAIN = "@kniejapunkty.firebaseapp.com";
function loginToEmail(l) {
  l = l.trim().toLowerCase();
  if (l.includes("@")) return l;
  l = l.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/\s+/g, ".").replace(/[^a-z0-9._-]/g, "");
  return l + DOMAIN;
}
const loginOf = e => String(e || "").replace(DOMAIN, "");
const PL_ERR = { "auth/invalid-credential": "Zły login lub hasło.", "auth/invalid-login-credentials": "Zły login lub hasło.",
  "auth/wrong-password": "Zły login lub hasło.", "auth/user-not-found": "Nie ma takiego loginu.",
  "auth/email-already-in-use": "Ten login jest już zajęty.", "auth/weak-password": "Hasło musi mieć co najmniej 6 znaków.",
  "auth/invalid-email": "Nieprawidłowy login.", "auth/too-many-requests": "Za dużo prób. Spróbuj za chwilę." };
binders.login = () => {
  const go = f => { const l = $("#em").value; if (!l.trim()) return alert("Wpisz login");
    f(auth, loginToEmail(l), $("#pw").value).then(() => { S.tab = "wyniki"; render(); })
      .catch(e => alert(PL_ERR[e.code] || ("Błąd: " + e.message))); };
  $("#li").onclick = () => go(signInWithEmailAndPassword); $("#reg").onclick = () => go(createUserWithEmailAndPassword);
};

// ---------- WYNIKI
function vWyniki() {
  const t = quarterTotals(S.cfg, quarter(), S, today());
  const order = [...ZASTEPY].sort((a, b) => t[b].suma - t[a].suma);
  let pos = 0, last = null;
  const items = order.map((z, i) => { if (t[z].suma !== last) { pos = i + 1; last = t[z].suma; }
    return `<div class="it"><div class="pos">${pos}</div><div><b>${z}</b> <span class="fire">${t[z].streak ? "🔥".repeat(Math.min(t[z].streak, 5)) + " " + t[z].streak : ""}</span>
    <div class="mut">zbiórki ${frac(t[z].zbiorki)} · drużyna ${frac(t[z].akcje)} · alarmy ${frac(t[z].alarmy)}</div></div>
    <div class="pts">${frac(t[z].suma)}</div></div>`; }).join("");
  const det = ZASTEPY.map(z => `<details><summary><b>${z}</b> — historia streaka</summary><table><tr><th>Tydzień</th><th class="n">n</th><th class="n">Pkt</th><th></th></tr>
    ${t[z].log.map(l => `<tr><td>${l.tydzien}</td><td class="n">${l.n}</td><td class="n">${frac(l.pkt)}</td><td class="mut">${l.info || ""}</td></tr>`).join("") || `<tr><td colspan=4 class="mut">brak</td></tr>`}</table></details>`).join("");
  return `<div class="card"><h2>Ranking</h2>${quarterPicker()}<div class="rank">${items}</div></div><div class="card"><h2>Szczegóły streaków</h2>${det}</div>`;
}

// ---------- ZBIÓRKI ZASTĘPU
function vZbiorki() {
  const list = S.zbiorki.filter(z => inQ(z.data));
  const mine = rola() === "zastepowy" ? S.profile.zastep : null;
  const noZ = rola() === "zastepowy" && !ZASTEPY.includes(mine);
  const form = noZ ? `<div class="card"><h2>Zgłoś zbiórkę zastępu</h2><p class="err">Nie masz przypisanego zastępu. Poproś kadrę, żeby przypisała Ci zastęp w zakładce Użytkownicy.</p></div>`
    : canEdit() ? `<div class="card"><h2>Zgłoś zbiórkę zastępu</h2><div class="row">
    <select id="zz" ${mine ? "disabled" : ""}>${ZASTEPY.map(z => `<option ${z === mine ? "selected" : ""}>${z}</option>`).join("")}</select>
    <input id="zd" type="date" value="${today()}"><input id="zo" placeholder="krótki opis (opcjonalnie)">
    <button class="pri" id="zadd">Zgłoś</button></div>
    <p class="mut">Zbiórka liczy się do punktacji dopiero po zatwierdzeniu przez kadrę. Liczy się jedna zbiórka na tydzień (pon–nd).</p></div>` : "";
  const badge = s => `<span class="badge ${s === "zatwierdzona" ? "ok" : s === "odrzucona" ? "no" : "w"}">${s}</span>`;
  const rows = list.map(z => `<tr><td>${z.data}</td><td>${isKadra() ? `<select data-zs="${z.id}">${ZASTEPY.includes(z.zastep) ? "" : `<option value="">⚠ wybierz</option>`}${ZASTEPY.map(x => `<option ${x === z.zastep ? "selected" : ""}>${x}</option>`).join("")}</select>`
      : (ZASTEPY.includes(z.zastep) ? z.zastep : `<span class="err">brak zastępu</span>`)}</td><td>${esc(z.opis)}</td><td>${badge(z.status)}</td><td>
    ${isKadra() && z.status !== "zatwierdzona" ? `<button data-ok="${z.id}">✔ Zatwierdź</button>` : ""}
    ${isKadra() && z.status === "oczekuje" ? `<button data-no="${z.id}">✖</button>` : ""}
    ${(isKadra() || (z.zastep === mine && z.status === "oczekuje")) ? `<button class="del" data-del="${z.id}">Usuń</button>` : ""}</td></tr>`).join("");
  return form + `<div class="card"><h2>Zbiórki zastępów</h2>${quarterPicker()}<div class="scroll"><table>
    <tr><th>Data</th><th>Zastęp</th><th>Opis</th><th>Status</th><th></th></tr>${rows || `<tr><td colspan=5 class="mut">Brak zbiórek w tym kwartale</td></tr>`}</table></div></div>`;
}
binders.zbiorki = () => {
  $("#zadd") && ($("#zadd").onclick = () => {
    const zastep = rola() === "zastepowy" ? S.profile.zastep : $("#zz").value, data = $("#zd").value;
    if (!ZASTEPY.includes(zastep)) return alert("Wybierz zastęp");
    if (!data) return alert("Wybierz datę");
    addDoc(collection(db, "zbiorkiZastepu"), { zastep, data, opis: $("#zo").value,
      status: "oczekuje", autor: S.user.uid, utworzono: serverTimestamp() }).then(() => { $("#zo").value = ""; }).catch(err); });
  document.querySelectorAll("[data-zs]").forEach(el => el.onchange = () => el.value &&
    updateDoc(doc(db, "zbiorkiZastepu", el.dataset.zs), { zastep: el.value }).catch(err));
  document.querySelectorAll("[data-ok]").forEach(b => b.onclick = () => updateDoc(doc(db, "zbiorkiZastepu", b.dataset.ok), { status: "zatwierdzona", zatwierdzil: S.user.uid }).catch(err));
  document.querySelectorAll("[data-no]").forEach(b => b.onclick = () => updateDoc(doc(db, "zbiorkiZastepu", b.dataset.no), { status: "odrzucona" }).catch(err));
  document.querySelectorAll("[data-del]").forEach(b => b.onclick = () => confirm("Usunąć?") && deleteDoc(doc(db, "zbiorkiZastepu", b.dataset.del)).catch(err));
};

// ---------- AKCJE DRUŻYNY
const emptyAkcja = () => ({ typ: "zbiorka", nazwa: "", data: today(), wyniki: {}, gry: [], mundury: [] });
function vAkcje() {
  if (S.edit?.kind === "akcja") return vAkcjaEdit();
  const list = S.akcje.filter(a => inQ(a.data));
  const rows = list.map(a => { const r = akcjaPoints(S.cfg, a);
    return `<tr><td>${a.data}</td><td>${a.typ === "biwak" ? "Biwak" : "Zbiórka"}: ${esc(a.nazwa)}</td>${ZASTEPY.map(z => `<td class="n">${frac(r[z].total)}</td>`).join("")}
    <td>${isKadra() ? `<button data-e="${a.id}">Edytuj</button>` : ""}</td></tr>`; }).join("");
  return `<div class="card"><h2>Zbiórki drużyny i biwaki</h2>${quarterPicker()}
    ${isKadra() ? `<button class="pri" id="anew">+ Nowa akcja</button>` : ""}
    <div class="scroll"><table><tr><th>Data</th><th>Akcja</th>${ZASTEPY.map(z => `<th class="n">${z}</th>`).join("")}<th></th></tr>
    ${rows || `<tr><td colspan=9 class="mut">Brak akcji w tym kwartale</td></tr>`}</table></div>
    <p class="mut">Punkty = gry × obecni/liczebność + umundurowanie (bez przeliczania).</p></div>`;
}
binders.akcje = () => {
  if (S.edit?.kind === "akcja") return bindAkcjaEdit();
  $("#anew") && ($("#anew").onclick = () => { S.edit = { kind: "akcja", d: emptyAkcja() }; render(); });
  document.querySelectorAll("[data-e]").forEach(b => b.onclick = () => {
    const a = S.akcje.find(x => x.id === b.dataset.e); S.edit = { kind: "akcja", id: a.id, d: structuredClone(a) }; render(); });
};
function vAkcjaEdit() {
  if (!isKadra()) { S.edit = null; return vAkcje(); }
  const a = S.edit.d, r = akcjaPoints(S.cfg, a);
  const head = `<tr><th></th>${ZASTEPY.map(z => `<th class="n">${z}</th>`).join("")}</tr>`;
  const numRow = (label, get, path, ph = "") => `<tr><td>${label}</td>${ZASTEPY.map(z =>
    `<td class="n"><input type="number" step="1" data-p="${path(z)}" value="${esc(get(z) ?? "")}" placeholder="${ph}"></td>`).join("")}</tr>`;
  const gry = a.gry.map((g, i) => `<h3><input data-p="gry.${i}.nazwa" value="${esc(g.nazwa)}" placeholder="Nazwa gry">
    <select data-p="gry.${i}.rodzaj"><option value="duza" ${g.rodzaj === "duza" ? "selected" : ""}>duża</option><option value="mala" ${g.rodzaj === "mala" ? "selected" : ""}>mała</option></select>
    <button class="del" data-rm="gry.${i}">Usuń grę</button></h3>
    <div class="scroll"><table>${head}${numRow("Miejsce (remis = to samo)", z => g.miejsca?.[z], z => `gry.${i}.miejsca.${z}`, "–")}</table></div>`).join("");
  const mund = a.mundury.map((m, i) => `<h3><input data-p="mundury.${i}.nazwa" value="${esc(m.nazwa)}" placeholder="Sprawdzanie munduru ${i + 1}">
    <button class="del" data-rm="mundury.${i}">Usuń</button></h3><div class="scroll"><table>${head}
    ${numRow("Obecni przy sprawdzaniu", z => m.dane?.[z]?.h, z => `mundury.${i}.dane.${z}.h`)}
    ${numRow("Liczba błędów", z => m.dane?.[z]?.b, z => `mundury.${i}.dane.${z}.b`)}</table></div>`).join("");
  return `<div class="card"><h2>${S.edit.id ? "Edycja akcji" : "Nowa akcja"}</h2>
   <div class="row"><select data-p="typ"><option value="zbiorka" ${a.typ === "zbiorka" ? "selected" : ""}>Zbiórka drużyny</option><option value="biwak" ${a.typ === "biwak" ? "selected" : ""}>Biwak</option></select>
   <input type="date" data-p="data" value="${a.data}"><input data-p="nazwa" value="${esc(a.nazwa)}" placeholder="Nazwa"></div>
   <h3>Obecność</h3><div class="scroll"><table>${head}
   ${numRow("Liczebność zastępu (h)", z => a.wyniki?.[z]?.h, z => `wyniki.${z}.h`, String(S.cfg.liczebnosc[z] ?? ""))}
   ${numRow("Obecni (hob)", z => a.wyniki?.[z]?.hob, z => `wyniki.${z}.hob`)}</table></div>
   <p class="mut">Puste h = liczebność z ustawień.</p>
   <h3>Gry</h3>${gry}<div class="row"><button id="g+">+ Gra duża</button><button id="m+">+ Gra mała</button></div>
   <h3>Umundurowanie</h3>${mund}<div class="row"><button id="u+">+ Sprawdzanie munduru</button></div>
   <h3>Podgląd punktów</h3><div class="scroll"><table>${head}
   <tr><td>Gry (surowe)</td>${ZASTEPY.map(z => `<td class="n">${frac(r[z].gry)}</td>`).join("")}</tr>
   <tr><td>Gry × hob/h</td>${ZASTEPY.map(z => `<td class="n">${frac(r[z].gryPrzel)}</td>`).join("")}</tr>
   <tr><td>Mundur</td>${ZASTEPY.map(z => `<td class="n">${frac(r[z].mund)}</td>`).join("")}</tr>
   <tr><td><b>Razem</b></td>${ZASTEPY.map(z => `<td class="n"><b>${frac(r[z].total)}</b></td>`).join("")}</tr></table></div>
   <div class="row"><button class="pri" id="save">Zapisz</button><button id="cancel">Anuluj</button>${S.edit.id ? `<button class="del" id="remove">Usuń akcję</button>` : ""}</div></div>`;
}
// zapis wartości po ścieżce "a.b.c"
function setPath(o, path, v) { const k = path.split("."); let c = o;
  k.slice(0, -1).forEach((p, i) => { if (c[p] == null) c[p] = /^\d+$/.test(k[i + 1]) ? [] : {}; c = c[p]; }); c[k.at(-1)] = v; }
function bindEditorInputs() {
  document.querySelectorAll("[data-p]").forEach(el => el.onchange = () => {
    const v = el.type === "number" ? (el.value === "" ? null : Number(el.value)) : el.value;
    setPath(S.edit.d, el.dataset.p, v); render(); });
  document.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { const [k, i] = b.dataset.rm.split("."); S.edit.d[k].splice(+i, 1); render(); });
  $("#cancel").onclick = () => { S.edit = null; render(); };
}
function bindAkcjaEdit() {
  bindEditorInputs(); const a = S.edit.d;
  $("#g+").onclick = () => { a.gry.push({ nazwa: "", rodzaj: "duza", miejsca: {} }); render(); };
  $("#m+").onclick = () => { a.gry.push({ nazwa: "", rodzaj: "mala", miejsca: {} }); render(); };
  $("#u+").onclick = () => { a.mundury.push({ nazwa: "", dane: {} }); render(); };
  $("#save").onclick = () => saveDoc("akcje");
  $("#remove") && ($("#remove").onclick = () => confirm("Usunąć akcję?") && deleteDoc(doc(db, "akcje", S.edit.id)).then(() => { S.edit = null; render(); }).catch(err));
}
async function saveDoc(col) {
  const { id, ...data } = S.edit.d; data.zmienil = S.user.uid;
  try { S.edit.id ? await setDoc(doc(db, col, S.edit.id), data) : await addDoc(collection(db, col), data); S.edit = null; render(); } catch (e) { err(e); }
}

// ---------- ALARMY
const emptyAlarm = () => ({ nazwa: "", data: today(), progi: ["0–20 min", "20–40 min", "40–60 min", "60+ min"], dane: {} });
function vAlarmy() {
  if (S.edit?.kind === "alarm") return vAlarmEdit();
  const list = S.alarmy.filter(a => inQ(a.data));
  const rows = list.map(a => { const r = alarmPoints(S.cfg, a);
    return `<tr><td>${a.data}</td><td>${esc(a.nazwa)}</td>${ZASTEPY.map(z => `<td class="n">${frac(r[z].total)}</td>`).join("")}
    <td>${isKadra() ? `<button data-e="${a.id}">Edytuj</button>` : ""}</td></tr>`; }).join("");
  return `<div class="card"><h2>Alarmy</h2>${quarterPicker()}${isKadra() ? `<button class="pri" id="anew">+ Nowy alarm</button>` : ""}
    <div class="scroll"><table><tr><th>Data</th><th>Alarm</th>${ZASTEPY.map(z => `<th class="n">${z}</th>`).join("")}<th></th></tr>
    ${rows || `<tr><td colspan=9 class="mut">Brak alarmów w tym kwartale</td></tr>`}</table></div></div>`;
}
binders.alarmy = () => {
  if (S.edit?.kind === "alarm") return bindAlarmEdit();
  $("#anew") && ($("#anew").onclick = () => { S.edit = { kind: "alarm", d: emptyAlarm() }; render(); });
  document.querySelectorAll("[data-e]").forEach(b => b.onclick = () => {
    const a = S.alarmy.find(x => x.id === b.dataset.e); S.edit = { kind: "alarm", id: a.id, d: structuredClone(a) }; render(); });
};
function vAlarmEdit() {
  if (!isKadra()) { S.edit = null; return vAlarmy(); }
  const a = S.edit.d, r = alarmPoints(S.cfg, a);
  const head = `<tr><th></th>${ZASTEPY.map(z => `<th class="n">${z}</th>`).join("")}</tr>`;
  const progi = a.progi.map((p, i) => `<tr><td><input data-p="progi.${i}" value="${esc(p)}" style="width:110px"> <span class="mut">${S.cfg.alarmProgi[i] ?? 0} pkt/os.</span></td>
    ${ZASTEPY.map(z => `<td class="n"><input type="number" min="0" data-p="dane.${z}.liczby.${i}" value="${a.dane?.[z]?.liczby?.[i] ?? ""}"></td>`).join("")}</tr>`).join("");
  return `<div class="card"><h2>${S.edit.id ? "Edycja alarmu" : "Nowy alarm"}</h2>
   <div class="row"><input type="date" data-p="data" value="${a.data}"><input data-p="nazwa" value="${esc(a.nazwa)}" placeholder="Nazwa alarmu"></div>
   <h3>Liczba osób zameldowanych w progach</h3><div class="scroll"><table>${head}${progi}
   <tr><td>Minuta zameldowania <b>pierwszej</b> osoby</td>${ZASTEPY.map(z => `<td class="n"><input type="number" min="0" data-p="dane.${z}.pierwszy" value="${a.dane?.[z]?.pierwszy ?? ""}"></td>`).join("")}</tr>
   </table></div><p class="mut">Kolejność zastępów (bonus) liczy się z minuty pierwszej osoby; remis = to samo miejsce.</p>
   <h3>Podgląd</h3><div class="scroll"><table>${head}
   <tr><td>Za osoby</td>${ZASTEPY.map(z => `<td class="n">${frac(r[z].osoby)}</td>`).join("")}</tr>
   <tr><td>Miejsce / bonus</td>${ZASTEPY.map(z => `<td class="n">${r[z].miejsce ? r[z].miejsce + ". / " + r[z].bonus : "–"}</td>`).join("")}</tr>
   <tr><td><b>Razem</b></td>${ZASTEPY.map(z => `<td class="n"><b>${frac(r[z].total)}</b></td>`).join("")}</tr></table></div>
   <div class="row"><button class="pri" id="save">Zapisz</button><button id="cancel">Anuluj</button>${S.edit.id ? `<button class="del" id="remove">Usuń alarm</button>` : ""}</div></div>`;
}
function bindAlarmEdit() {
  bindEditorInputs(); $("#save").onclick = () => saveDoc("alarmy");
  $("#remove") && ($("#remove").onclick = () => confirm("Usunąć alarm?") && deleteDoc(doc(db, "alarmy", S.edit.id)).then(() => { S.edit = null; render(); }).catch(err));
}

// ---------- USTAWIENIA (kadra)
function vUstawienia() {
  const c = S.cfg, list = (k, n) => `<input data-c="${k}" value="${c[k].join(", ")}" style="width:100%" title="${n}">`;
  return `<div class="card"><h2>Ustawienia punktacji</h2>
   <div class="row">Pkt bazowe za zbiórkę zastępu <input type="number" data-c="base" value="${c.base}"></div>
   <div class="row">Przyrost streaka <input type="number" step="0.05" data-c="step" value="${c.step}"></div>
   <div class="row">Pkt za mundur na osobę <input type="number" data-c="mundur" value="${c.mundur}"></div>
   <h3>Gra duża (1.–6. miejsce)</h3>${list("duze")}<h3>Gra mała</h3>${list("male")}
   <h3>Alarm — punkty za osobę w progach</h3>${list("alarmProgi")}<h3>Alarm — bonus za kolejność zastępów</h3>${list("alarmBonus")}
   <h3>Liczebność zastępów (h)</h3><div class="row">${ZASTEPY.map(z => `<label>${z} <input type="number" data-l="${z}" value="${c.liczebnosc[z] ?? ""}"></label>`).join("")}</div>
   <h3>Kwartały</h3><div id="kw">${c.kwartaly.map((q, i) => `<div class="row"><input data-k="${i}.nazwa" value="${esc(q.nazwa)}">
     <input type="date" data-k="${i}.start" value="${q.start}"><input type="date" data-k="${i}.end" value="${q.end}"><button class="del" data-kdel="${i}">✖</button></div>`).join("")}</div>
   <button id="kadd">+ Kwartał</button>
   <div class="row" style="margin-top:14px"><button class="pri" id="csave">Zapisz ustawienia</button></div>
   <p class="mut">Zmiana ustawień przelicza wszystkie wyniki od nowa. Streak zeruje się na początku każdego kwartału.</p></div>`;
}
binders.ustawienia = () => {
  const c = structuredClone(S.cfg);
  const read = () => {
    document.querySelectorAll("[data-c]").forEach(el => { const k = el.dataset.c;
      c[k] = Array.isArray(c[k]) ? el.value.split(/[,; ]+/).filter(Boolean).map(Number) : Number(el.value); });
    document.querySelectorAll("[data-l]").forEach(el => c.liczebnosc[el.dataset.l] = Number(el.value));
    document.querySelectorAll("[data-k]").forEach(el => { const [i, f] = el.dataset.k.split("."); c.kwartaly[i][f] = el.value; });
  };
  $("#kadd").onclick = () => { read(); c.kwartaly.push({ nazwa: "Nowy kwartał", start: today(), end: today() }); S.cfg = c; render(); };
  document.querySelectorAll("[data-kdel]").forEach(b => b.onclick = () => { read(); c.kwartaly.splice(+b.dataset.kdel, 1); S.cfg = c; render(); });
  $("#csave").onclick = () => { read(); setDoc(doc(db, "config", "main"), c).then(() => alert("Zapisano")).catch(err); };
};

// ---------- UŻYTKOWNICY (kadra)
function vUsers() {
  return `<div class="card"><h2>Użytkownicy</h2><p class="mut">Nowe osoby zakładają konto same, a tu nadajesz im rolę.</p><div class="scroll"><table>
   <tr><th>Login</th><th>Imię</th><th>Rola</th><th>Zastęp</th></tr>
   ${S.users.map(u => `<tr><td>${esc(loginOf(u.email))}</td><td><input data-u="${u.id}" data-f="imie" value="${esc(u.imie)}"></td>
   <td><select data-u="${u.id}" data-f="rola">${["brak","zastepowy","kadra"].map(r => `<option ${u.rola === r ? "selected" : ""}>${r}</option>`).join("")}</select></td>
   <td>${u.rola === "zastepowy" && !ZASTEPY.includes(u.zastep) ? `<span class="err">⚠ </span>` : ""}<select data-u="${u.id}" data-f="zastep"><option value="">–</option>${ZASTEPY.map(z => `<option ${u.zastep === z ? "selected" : ""}>${z}</option>`).join("")}</select></td></tr>`).join("")}
   </table></div></div>`;
}
binders.uzytkownicy = () => document.querySelectorAll("[data-u]").forEach(el => el.onchange = () =>
  updateDoc(doc(db, "users", el.dataset.u), { [el.dataset.f]: el.value }).catch(err));
