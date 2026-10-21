import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, onSnapshot, setDoc, addDoc, updateDoc, deleteDoc, getDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { ZASTEPY, DEFAULT_CONFIG, quarterTotals, akcjaPoints, alarmPoints, alarmProgiMin, progIndex, meldMinute, frac } from "./scoring.js";

const app = initializeApp(firebaseConfig), auth = getAuth(app), db = getFirestore(app);
const S = { user: null, profile: null, cfg: DEFAULT_CONFIG, zbiorki: [], akcje: [], alarmy: [], meldunki: [], users: [],
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
const isKadra = () => rola() === "kadra";
const canZglaszac = () => ["kadra", "zastepowy"].includes(rola());          // zbiórki zastępu
const canMeldowac = () => ["szeregowy", "zastepowy"].includes(rola());     // meldunki z alarmów
const quarter = () => S.cfg.kwartaly[S.q] || S.cfg.kwartaly[0];
const inQ = d => d >= quarter().start && d <= quarter().end;
const err = e => alert("Błąd: " + (e?.message || e));
const DAY_MS = 86400000;

// ---------- dane na żywo
// Podczas edycji formularza nie przerysowujemy strony (żeby nie gubić wpisywanych danych i kliknięć).
const refresh = () => { if (!S.edit && !S.busy) render(); };
onSnapshot(doc(db, "config", "main"), s => { S.cfg = { ...DEFAULT_CONFIG, ...(s.data() || {}) }; pickQuarter(); refresh(); });
const live = (name, key, map = x => x) => onSnapshot(collection(db, name), s => {
  S[key] = s.docs.map(d => map({ id: d.id, ...d.data() })).sort((a, b) => (b.data || "").localeCompare(a.data || "")); refresh();
}, e => console.warn(name, e));
live("zbiorkiZastepu", "zbiorki"); live("akcje", "akcje"); live("alarmy", "alarmy");
live("meldunki", "meldunki", m => ({ ...m, czasMs: m.czas?.toMillis ? m.czas.toMillis() : (m.czas == null ? Date.now() : Number(m.czas)) }));
let usersUnsub = null, profUnsub = null;
onAuthStateChanged(auth, async u => {
  S.user = u; S.profile = null; usersUnsub?.(); usersUnsub = null; profUnsub?.(); profUnsub = null;
  if (u) {
    const ref = doc(db, "users", u.uid);
    try {
      const s = await getDoc(ref);
      if (!s.exists()) await setDoc(ref, { email: u.email, imie: loginOf(u.email), rola: "brak", zastep: S.regZastep || "" });
    } catch (e) { console.warn(e); }
    profUnsub = onSnapshot(ref, d => { S.profile = d.data() || null;
      if (isKadra() && !usersUnsub) usersUnsub = onSnapshot(collection(db, "users"), s => { S.users = s.docs.map(d => ({ id: d.id, ...d.data() })); refresh(); });
      refresh(); });
  }
  render();
});
function pickQuarter() { const t = today(); const i = S.cfg.kwartaly.findIndex(q => t >= q.start && t <= q.end); if (i >= 0 && S._qset !== true) S.q = i; }

// ---------- nawigacja
const TABS = [["wyniki","🏆 Wyniki"],["zbiorki","🔥 Zbiórki zastępu"],["akcje","⛺ Zbiórki drużyny / biwaki"],["alarmy","🚨 Alarmy"],["ustawienia","⚙️ Ustawienia"],["uzytkownicy","👥 Użytkownicy"]];
const ROLA_TXT = () => ({ kadra: "kadra", zastepowy: "zastępowy · " + (S.profile?.zastep || "bez zastępu"),
  szeregowy: "szeregowy · " + (S.profile?.zastep || "bez zastępu"), brak: "czeka na nadanie roli" }[rola()] || "");
function renderChrome() {
  $("#who").textContent = S.user ? `${S.profile?.imie || loginOf(S.user.email)} · ${ROLA_TXT()}` : "podgląd wyników";
  $("#authbox").innerHTML = S.user ? `<button id="out">Wyloguj</button>` : `<button id="in">Zaloguj</button>`;
  $("#out") && ($("#out").onclick = () => signOut(auth));
  $("#in") && ($("#in").onclick = () => { S.tab = "login"; render(); });
  const vis = TABS.filter(([k]) => !["ustawienia","uzytkownicy"].includes(k) || isKadra());
  $("#nav").innerHTML = vis.map(([k, l]) => `<button data-t="${k}" class="${S.tab === k ? "on" : ""}">${l}</button>`).join("");
  $("#nav").querySelectorAll("button").forEach(b => b.onclick = () => { S.tab = b.dataset.t; S.edit = null; S.view = null; render(); });
}
function quarterPicker() {
  return `<div class="row"><span class="mut">Kwartał:</span><select id="qsel">${S.cfg.kwartaly.map((q, i) =>
    `<option value="${i}" ${i == S.q ? "selected" : ""}>${esc(q.nazwa)} (${plDay(q.start)} – ${plDay(q.end)})</option>`).join("")}</select></div>`;
}
function bindQuarter() { $("#qsel") && ($("#qsel").onchange = e => { S.q = +e.target.value; S._qset = true; render(); }); }

function render() {
  renderChrome();
  const views = { wyniki: vWyniki, zbiorki: vZbiorki, akcje: vAkcje, alarmy: vAlarmy, ustawienia: vUstawienia, uzytkownicy: vUsers, login: vLogin };
  $("#main").innerHTML = (views[S.tab] || vWyniki)();
  bindQuarter(); (binders[S.tab] || (() => {}))();
}
const binders = {};

// ---------- logowanie
function vLogin() {
  return `<div class="card"><h2>Logowanie</h2>
  <div class="row"><input id="em" placeholder="login" autocomplete="username" autocapitalize="none" spellcheck="false"></div>
  <div class="row"><input id="pw" type="password" placeholder="hasło (min. 6 znaków)" autocomplete="current-password"></div>
  <div class="row"><button class="pri" id="li">Zaloguj</button></div>
  <h3>Nie masz konta?</h3>
  <div class="row"><select id="rz"><option value="">– Twój zastęp –</option>${ZASTEPY.map(z => `<option>${z}</option>`).join("")}<option value="">jestem w kadrze</option></select>
  <button id="reg">Załóż konto</button></div>
  <p class="mut">Login: małe litery bez polskich znaków, cyfry, kropka, myślnik (np. <b>jan.kowalski</b>).<br>
  Po założeniu konta kadra musi zatwierdzić Twoją rolę.</p></div>`;
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
  $("#li").onclick = () => go(signInWithEmailAndPassword);
  $("#reg").onclick = () => { S.regZastep = $("#rz").value; go(createUserWithEmailAndPassword); };
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
    ${t[z].log.map(l => `<tr><td>${plDay(l.tydzien)}</td><td class="n">${l.n}</td><td class="n">${frac(l.pkt)}</td><td class="mut">${l.info || ""}</td></tr>`).join("") || `<tr><td colspan=4 class="mut">brak</td></tr>`}</table></details>`).join("");
  return `<div class="card"><h2>Ranking</h2>${quarterPicker()}<div class="rank">${items}</div></div><div class="card"><h2>Szczegóły streaków</h2>${det}</div>`;
}

// ---------- ZBIÓRKI ZASTĘPU
function vZbiorki() {
  const mine = rola() === "zastepowy" ? S.profile.zastep : null;
  const noZ = rola() === "zastepowy" && !ZASTEPY.includes(mine);
  const cq = currentQ();
  const form = !canZglaszac() ? "" : !cq ? `<div class="card"><h2>Zgłoś zbiórkę zastępu</h2><p class="err">Dzisiejsza data nie należy do żadnego kwartału. Kadra musi dodać bieżący kwartał w Ustawieniach.</p></div>`
    : noZ ? `<div class="card"><h2>Zgłoś zbiórkę zastępu</h2><p class="err">Nie masz przypisanego zastępu. Poproś kadrę, żeby przypisała Ci zastęp w zakładce Użytkownicy.</p></div>`
    : `<div class="card"><h2>Zgłoś zbiórkę zastępu</h2><div class="row">
    <select id="zz" ${mine ? "disabled" : ""}>${ZASTEPY.map(z => `<option ${z === mine ? "selected" : ""}>${z}</option>`).join("")}</select>
    <input id="zd" type="date" value="${today()}" min="${cq.start}" max="${cq.end}"><input id="zo" placeholder="krótki opis (opcjonalnie)">
    <button class="pri" id="zadd">Zgłoś</button></div>
    <p class="mut">Można zgłaszać tylko zbiórki z bieżącego kwartału: <b>${esc(cq.nazwa)}</b> (${plDay(cq.start)} – ${plDay(cq.end)}).<br>
    Zbiórka liczy się do punktacji dopiero po zatwierdzeniu przez kadrę. Liczy się jedna zbiórka na tydzień (pon–nd).</p></div>`;
  const zCell = z => isKadra() ? `<select data-zs="${z.id}">${ZASTEPY.includes(z.zastep) ? "" : `<option value="">⚠ wybierz</option>`}${ZASTEPY.map(x => `<option ${x === z.zastep ? "selected" : ""}>${x}</option>`).join("")}</select>`
      : (ZASTEPY.includes(z.zastep) ? z.zastep : `<span class="err">brak zastępu</span>`);
  const row = z => `<tr><td><b>${plDay(z.data)}</b></td><td class="mut">${plTs(z.utworzono)}</td><td>${zCell(z)}</td><td>${esc(z.opis)}</td><td class="act">
    ${isKadra() && z.status !== "zatwierdzona" ? `<button data-ok="${z.id}">✔ Zatwierdź</button>` : ""}
    ${isKadra() && z.status === "oczekuje" ? `<button data-no="${z.id}" title="Odrzuć">✖</button>` : ""}
    ${(isKadra() || (z.zastep === mine && z.status === "oczekuje")) ? `<button class="del" data-del="${z.id}">Usuń</button>` : ""}</td></tr>`;
  const table = (list, empty) => `<div class="scroll"><table><tr><th>Data zbiórki</th><th>Zgłoszono</th><th>Zastęp</th><th>Opis</th><th></th></tr>
    ${list.map(row).join("") || `<tr><td colspan=5 class="mut">${empty}</td></tr>`}</table></div>`;
  const pend = S.zbiorki.filter(z => z.status === "oczekuje");
  const acc = S.zbiorki.filter(z => z.status === "zatwierdzona" && inQ(z.data));
  const rej = S.zbiorki.filter(z => z.status === "odrzucona" && inQ(z.data));
  return form
    + `<div class="card"><h2>⏳ Oczekujące na zatwierdzenie <span class="badge w">${pend.length}</span></h2>${table(pend, "Brak oczekujących zgłoszeń")}</div>`
    + `<div class="card"><h2>✅ Zatwierdzone <span class="badge ok">${acc.length}</span></h2>${quarterPicker()}${table(acc, "Brak zatwierdzonych zbiórek w tym kwartale")}
      ${rej.length ? `<details><summary class="mut">Odrzucone w tym kwartale (${rej.length})</summary>${table(rej, "")}</details>` : ""}</div>`;
}
binders.zbiorki = () => {
  $("#zadd") && ($("#zadd").onclick = () => {
    const zastep = rola() === "zastepowy" ? S.profile.zastep : $("#zz").value, data = $("#zd").value;
    if (!ZASTEPY.includes(zastep)) return alert("Wybierz zastęp");
    if (!data) return alert("Wybierz datę");
    const cq = currentQ();
    if (!cq || data < cq.start || data > cq.end) return alert(`Można zgłaszać tylko zbiórki z bieżącego kwartału (${plDay(cq?.start)} – ${plDay(cq?.end)}).`);
    addDoc(collection(db, "zbiorkiZastepu"), { zastep, data, opis: $("#zo").value,
      status: "oczekuje", autor: S.user.uid, utworzono: serverTimestamp() }).then(() => { const o = $("#zo"); if (o) o.value = ""; }).catch(err); });
  $$("[data-zs]").forEach(el => el.onchange = () => el.value &&
    updateDoc(doc(db, "zbiorkiZastepu", el.dataset.zs), { zastep: el.value }).catch(err));
  $$("[data-ok]").forEach(b => b.onclick = () => updateDoc(doc(db, "zbiorkiZastepu", b.dataset.ok), { status: "zatwierdzona", zatwierdzil: S.user.uid }).catch(err));
  $$("[data-no]").forEach(b => b.onclick = () => updateDoc(doc(db, "zbiorkiZastepu", b.dataset.no), { status: "odrzucona" }).catch(err));
  $$("[data-del]").forEach(b => b.onclick = () => confirm("Usunąć zgłoszenie?") && deleteDoc(doc(db, "zbiorkiZastepu", b.dataset.del)).catch(err));
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
  $("#cancel").onclick = () => { S.edit = null; render(); };
}
const clean = o => JSON.parse(JSON.stringify(o));   // usuwa undefined i dziury w tablicach (Firestore ich nie przyjmuje)
async function saveDoc(col, prep = d => d) {
  const btn = $("#save"); if (btn) { btn.disabled = true; btn.textContent = "Zapisuję…"; }
  const { id, ...data } = S.edit.d;
  const out = clean(prep({ ...data, zmienil: S.user.uid }));
  try { S.edit.id ? await setDoc(doc(db, col, S.edit.id), out) : await addDoc(collection(db, col), out); S.edit = null; render(); }
  catch (e) { err(e); if (btn) { btn.disabled = false; btn.textContent = "Zapisz"; } }
}

// ---------- AKCJE DRUŻYNY
const emptyAkcja = () => ({ typ: "zbiorka", nazwa: "", data: today(), wyniki: {}, gry: [], mundury: [] });
function vAkcje() {
  if (S.edit?.kind === "akcja") return vAkcjaEdit();
  const list = S.akcje.filter(a => inQ(a.data));
  const rows = list.map(a => { const r = akcjaPoints(S.cfg, a);
    return `<tr><td>${plDay(a.data)}</td><td>${a.typ === "biwak" ? "Biwak" : "Zbiórka"}: ${esc(a.nazwa)}</td>${ZASTEPY.map(z => `<td class="n">${frac(r[z].total)}</td>`).join("")}
    <td>${isKadra() ? `<button data-e="${a.id}">Edytuj</button>` : ""}</td></tr>`; }).join("");
  return `<div class="card"><h2>Zbiórki drużyny i biwaki</h2>${quarterPicker()}
    ${isKadra() ? `<div class="row"><button class="pri" id="anew">+ Nowa zbiórka drużyny / biwak</button></div>` : ""}
    <div class="scroll"><table><tr><th>Data</th><th>Akcja</th>${ZASTEPY.map(z => `<th class="n">${z}</th>`).join("")}<th></th></tr>
    ${rows || `<tr><td colspan=9 class="mut">Brak akcji w tym kwartale</td></tr>`}</table></div>
    <p class="mut">Punkty = gry × obecni/liczebność + umundurowanie (bez przeliczania).</p></div>`;
}
binders.akcje = () => {
  if (S.edit?.kind === "akcja") return bindAkcjaEdit();
  $("#anew") && ($("#anew").onclick = () => { S.edit = { kind: "akcja", d: emptyAkcja() }; render(); });
  $$("[data-e]").forEach(b => b.onclick = () => {
    const a = S.akcje.find(x => x.id === b.dataset.e); S.edit = { kind: "akcja", id: a.id, d: structuredClone(a) }; render(); });
};
function akcjaPreview() {
  const r = akcjaPoints(S.cfg, S.edit.d);
  return `<table>${head()}
   <tr><td>Gry (surowe)</td>${ZASTEPY.map(z => `<td class="n">${frac(r[z].gry)}</td>`).join("")}</tr>
   <tr><td>Gry × hob/h</td>${ZASTEPY.map(z => `<td class="n">${frac(r[z].gryPrzel)}</td>`).join("")}</tr>
   <tr><td>Mundur</td>${ZASTEPY.map(z => `<td class="n">${frac(r[z].mund)}</td>`).join("")}</tr>
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
    <button class="del" data-rm="mundury.${i}">Usuń</button></h3><div class="scroll"><table>${head()}
    ${numRow("Obecni przy sprawdzaniu", z => m.dane?.[z]?.h, z => `mundury.${i}.dane.${z}.h`)}
    ${numRow("Liczba błędów", z => m.dane?.[z]?.b, z => `mundury.${i}.dane.${z}.b`)}</table></div>`).join("");
  return `<div class="card"><h2>${S.edit.id ? "Edycja akcji" : "Nowa zbiórka drużyny / biwak"}</h2>
   <div class="row"><select data-p="typ"><option value="zbiorka" ${a.typ === "zbiorka" ? "selected" : ""}>Zbiórka drużyny</option><option value="biwak" ${a.typ === "biwak" ? "selected" : ""}>Biwak</option></select>
   <input type="date" data-p="data" value="${a.data}"><input data-p="nazwa" value="${esc(a.nazwa)}" placeholder="Nazwa"></div>
   <h3>Obecność</h3><div class="scroll"><table>${head()}
   ${numRow("Liczebność zastępu (h)", z => a.wyniki?.[z]?.h, z => `wyniki.${z}.h`, z => String(S.cfg.liczebnosc[z] ?? ""))}
   ${numRow("Obecni (hob)", z => a.wyniki?.[z]?.hob, z => `wyniki.${z}.hob`)}</table></div>
   <p class="mut">Puste h = liczebność z ustawień.</p>
   <h3>Gry</h3>${gry}<div class="row"><button id="gAdd">+ Gra duża</button><button id="mAdd">+ Gra mała</button></div>
   <h3>Umundurowanie</h3>${mund}<div class="row"><button id="uAdd">+ Sprawdzanie munduru</button></div>
   <h3>Podgląd punktów</h3><div class="scroll" id="pv">${akcjaPreview()}</div>
   <div class="row"><button class="pri" id="save">Zapisz</button><button id="cancel">Anuluj</button>${S.edit.id ? `<button class="del" id="remove">Usuń akcję</button>` : ""}</div></div>`;
}
function bindAkcjaEdit() {
  bindEditor(akcjaPreview); const a = S.edit.d;
  $("#gAdd").onclick = () => { a.gry.push({ nazwa: "", rodzaj: "duza", miejsca: {} }); render(); };
  $("#mAdd").onclick = () => { a.gry.push({ nazwa: "", rodzaj: "mala", miejsca: {} }); render(); };
  $("#uAdd").onclick = () => { a.mundury.push({ nazwa: "", dane: {} }); render(); };
  $("#save").onclick = () => { if (!S.edit.d.data) return alert("Wybierz datę"); saveDoc("akcje"); };
  $("#remove") && ($("#remove").onclick = () => confirm("Usunąć akcję?") && deleteDoc(doc(db, "akcje", S.edit.id)).then(() => { S.edit = null; render(); }).catch(err));
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
  let my = "";
  if (canMeldowac()) {
    const mine = S.profile?.zastep;
    const items = S.alarmy.filter(a => alarmState(a) !== "po" || myMeld(a)).filter(a => inQ(a.data)).map(a => {
      const m = myMeld(a), st = alarmState(a);
      let body;
      if (m) body = `<span class="badge ${MSTAT[m.status]?.[0]}">${MSTAT[m.status]?.[1] || m.status}</span> <span class="mut">zgłoszono ${plTime(m.czasMs)}</span>
        ${m.status === "oczekuje" ? `<button class="del" data-undo="${m.id}">Cofnij</button>` : ""}`;
      else if (!ZASTEPY.includes(mine)) body = `<span class="err">Nie masz przypisanego zastępu — poproś kadrę.</span>`;
      else if (st === "przed") body = `<span class="mut">Start: ${plTs(a.startMs)}</span>`;
      else if (st === "trwa" && S.photo?.alarmId === a.id) body = `<img class="ph" src="${S.photo.data}" alt="zdjęcie">
        <div class="row"><button class="pri" data-send="${a.id}">📨 Wyślij meldunek</button><button data-retake="${a.id}">Zrób inne zdjęcie</button><button data-cancelph>Anuluj</button></div>`;
      else if (st === "trwa") body = `<button class="pri big" data-meld="${a.id}">📸 Zamelduj wykonanie</button>`;
      else body = `<span class="mut">Alarm zakończony</span>`;
      return `<div class="it2"><div><b>${esc(a.nazwa) || "Alarm"}</b> <span class="mut">${plDay(a.data)}${a.start ? ", start " + a.start : ""}</span></div>${body}</div>`;
    }).join("");
    my = `<div class="card"><h2>📣 Meldowanie alarmów</h2>${items || `<p class="mut">Brak trwających alarmów.</p>`}
      <p class="mut">Po wykonaniu alarmu zrób zdjęcie i wyślij meldunek. Liczy się godzina wysłania. Punkty naliczają się po akceptacji przez kadrę.</p></div>`;
  }
  const list = S.alarmy.filter(a => inQ(a.data));
  const rows = list.map(a => { const r = alarmPoints(S.cfg, a, S.meldunki), ms = meldOf(a);
    const cnt = z => ms.filter(m => m.zastep === z && m.status !== "odrzucony").length;
    const pend = ms.filter(m => m.status === "oczekuje").length;
    return `<tr><td>${plDay(a.data)}${a.start ? `<div class="mut">${a.start}</div>` : ""}</td><td>${esc(a.nazwa)}</td>${ZASTEPY.map(z => `<td class="n">${frac(r[z].total)}${cnt(z) ? `<div class="mut">✔ ${cnt(z)}</div>` : ""}</td>`).join("")}
    <td class="act"><button data-v="${a.id}">Meldunki${pend && isKadra() ? ` <span class="badge w">${pend}</span>` : ""}</button>${isKadra() ? `<button data-e="${a.id}">Edytuj</button>` : ""}</td></tr>`; }).join("");
  return my + `<div class="card"><h2>Alarmy</h2>${quarterPicker()}${isKadra() ? `<div class="row"><button class="pri" id="anew">+ Nowy alarm</button></div>` : ""}
    <div class="scroll"><table><tr><th>Data</th><th>Alarm</th>${ZASTEPY.map(z => `<th class="n">${z}</th>`).join("")}<th></th></tr>
    ${rows || `<tr><td colspan=9 class="mut">Brak alarmów w tym kwartale</td></tr>`}</table></div>
    <p class="mut">Punkty liczą tylko zaakceptowane meldunki. „✔ n” = liczba meldunków (także czekających na akceptację).</p></div>`;
}
binders.alarmy = () => {
  if (S.edit?.kind === "alarm") return bindAlarmEdit();
  if (S.view?.kind === "alarm") return bindAlarmDetail();
  $("#anew") && ($("#anew").onclick = () => { S.edit = { kind: "alarm", d: emptyAlarm() }; render(); });
  $$("[data-e]").forEach(b => b.onclick = () => {
    const a = S.alarmy.find(x => x.id === b.dataset.e); const d = structuredClone(a);
    d.progiMin = alarmProgiMin(S.cfg, a); S.edit = { kind: "alarm", id: a.id, d }; render(); });
  $$("[data-v]").forEach(b => b.onclick = () => { S.view = { kind: "alarm", id: b.dataset.v }; render(); });
  $$("[data-meld],[data-retake]").forEach(b => b.onclick = () => pickPhoto(b.dataset.meld || b.dataset.retake));
  $$("[data-cancelph]").forEach(b => b.onclick = () => { S.photo = null; render(); });
  $$("[data-send]").forEach(b => b.onclick = () => sendMeld(b.dataset.send, b));
  $$("[data-undo]").forEach(b => b.onclick = () => confirm("Cofnąć meldunek? Przy ponownym meldunku liczy się nowa godzina.") &&
    Promise.all([deleteDoc(doc(db, "meldunki", b.dataset.undo)), deleteDoc(doc(db, "zdjecia", b.dataset.undo)).catch(() => {})]).catch(err));
};

// --- zdjęcie i meldunek
function pickPhoto(alarmId) {
  const inp = $("#photoInput"); inp.value = "";
  inp.onchange = async () => {
    const f = inp.files?.[0]; if (!f) return;
    S.busy = true;
    try { S.photo = { alarmId, data: await compressImage(f) }; } catch (e) { err("Nie udało się wczytać zdjęcia"); }
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
  const id = `${alarmId}_${S.user.uid}`;
  try {
    await setDoc(doc(db, "zdjecia", id), { uid: S.user.uid, alarmId, img: S.photo.data });
    await setDoc(doc(db, "meldunki", id), { alarmId, uid: S.user.uid, imie: S.profile?.imie || loginOf(S.user.email),
      zastep: S.profile.zastep, status: "oczekuje", czas: serverTimestamp() });
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

// --- szczegóły alarmu (meldunki)
function vAlarmDetail() {
  const a = S.alarmy.find(x => x.id === S.view.id); if (!a) { S.view = null; return vAlarmy(); }
  const r = alarmPoints(S.cfg, a, S.meldunki), ms = meldOf(a).sort((x, y) => x.czasMs - y.czasMs), labels = progLabels(alarmProgiMin(S.cfg, a));
  const row = m => { const min = meldMinute(a, m), pi = min == null ? null : progIndex(S.cfg, a, min);
    return `<tr><td>${plTime(m.czasMs)}<div class="mut">${min == null ? "" : Math.floor(min) + " min"}</div></td><td>${esc(m.imie)}</td><td>${esc(m.zastep)}</td>
    <td>${pi == null ? "–" : `${pi + 1}. próg<div class="mut">${S.cfg.alarmProgi[pi] ?? 0} pkt</div>`}</td>
    <td class="act">${isKadra() || m.uid === S.user?.uid ? `<button data-ph="${m.id}">📷</button>` : ""}
    ${isKadra() && m.status !== "zaakceptowany" ? `<button data-acc="${m.id}">✔ Akceptuj</button>` : ""}
    ${isKadra() && m.status !== "odrzucony" ? `<button data-rej="${m.id}" title="Odrzuć">✖</button>` : ""}</td></tr>`; };
  const tbl = (list, empty) => `<div class="scroll"><table><tr><th>Godz.</th><th>Kto</th><th>Zastęp</th><th>Próg</th><th></th></tr>
    ${list.map(row).join("") || `<tr><td colspan=5 class="mut">${empty}</td></tr>`}</table></div>`;
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
    <div class="card"><h2>✅ Zaakceptowane <span class="badge ok">${acc.length}</span></h2>${tbl(acc, "Brak")}
    ${rej.length ? `<details><summary class="mut">Odrzucone (${rej.length})</summary>${tbl(rej, "")}</details>` : ""}</div>`;
}
function bindAlarmDetail() {
  $("#back").onclick = () => { S.view = null; render(); };
  const set = (id, status) => updateDoc(doc(db, "meldunki", id), { status, sprawdzil: S.user.uid }).catch(err);
  $$("[data-acc]").forEach(b => b.onclick = () => set(b.dataset.acc, "zaakceptowany"));
  $$("[data-rej]").forEach(b => b.onclick = () => set(b.dataset.rej, "odrzucony"));
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
  $("#remove") && ($("#remove").onclick = () => confirm("Usunąć alarm? Meldunki do niego przestaną się liczyć.") && deleteDoc(doc(db, "alarmy", S.edit.id)).then(() => { S.edit = null; render(); }).catch(err));
}

// ---------- USTAWIENIA (kadra)
function vUstawienia() {
  const c = S.cfg, list = (k, n) => `<input data-c="${k}" value="${(c[k] || []).join(", ")}" style="width:100%" title="${n}">`;
  return `<div class="card"><h2>Ustawienia punktacji</h2>
   <div class="row">Pkt bazowe za zbiórkę zastępu <input type="number" data-c="base" value="${c.base}"></div>
   <div class="row">Przyrost streaka <input type="number" step="0.05" data-c="step" value="${c.step}"></div>
   <div class="row">Pkt za mundur na osobę <input type="number" data-c="mundur" value="${c.mundur}"></div>
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
binders.ustawienia = () => {
  const c = structuredClone(S.cfg);
  const read = () => {
    $$("[data-c]").forEach(el => { const k = el.dataset.c;
      c[k] = Array.isArray(DEFAULT_CONFIG[k]) ? el.value.split(/[,; ]+/).filter(Boolean).map(Number) : Number(el.value); });
    $$("[data-l]").forEach(el => c.liczebnosc[el.dataset.l] = Number(el.value));
    $$("[data-k]").forEach(el => { const [i, f] = el.dataset.k.split("."); c.kwartaly[i][f] = el.value; });
  };
  $("#kadd").onclick = () => { read(); c.kwartaly.push({ nazwa: "Nowy kwartał", start: today(), end: today() }); S.cfg = c; render(); };
  $$("[data-kdel]").forEach(b => b.onclick = () => { read(); c.kwartaly.splice(+b.dataset.kdel, 1); S.cfg = c; render(); });
  $("#csave").onclick = () => { read(); setDoc(doc(db, "config", "main"), c).then(() => alert("Zapisano")).catch(err); };
};

// ---------- UŻYTKOWNICY (kadra)
const ROLE = ["brak", "szeregowy", "zastepowy", "kadra"];
function vUsers() {
  const users = [...S.users].sort((a, b) => (a.rola === "brak" ? 0 : 1) - (b.rola === "brak" ? 0 : 1) || (a.zastep || "").localeCompare(b.zastep || "") || (a.imie || "").localeCompare(b.imie || ""));
  const nowi = users.filter(u => u.rola === "brak").length;
  return `<div class="card"><h2>Użytkownicy ${nowi ? `<span class="badge w">${nowi} nowych</span>` : ""}</h2>
   <p class="mut">Nowe osoby zakładają konto same (wybierając zastęp), a tu nadajesz im rolę: <b>szeregowy</b> melduje alarmy, <b>zastępowy</b> dodatkowo zgłasza zbiórki zastępu, <b>kadra</b> zarządza wszystkim.</p><div class="scroll"><table>
   <tr><th>Login</th><th>Imię</th><th>Rola</th><th>Zastęp</th></tr>
   ${users.map(u => `<tr><td>${esc(loginOf(u.email))}</td><td><input data-u="${u.id}" data-f="imie" value="${esc(u.imie)}"></td>
   <td><select data-u="${u.id}" data-f="rola">${ROLE.map(r => `<option ${u.rola === r ? "selected" : ""}>${r}</option>`).join("")}</select></td>
   <td>${["zastepowy", "szeregowy"].includes(u.rola) && !ZASTEPY.includes(u.zastep) ? `<span class="err">⚠ </span>` : ""}<select data-u="${u.id}" data-f="zastep"><option value="">–</option>${ZASTEPY.map(z => `<option ${u.zastep === z ? "selected" : ""}>${z}</option>`).join("")}</select></td></tr>`).join("")}
   </table></div></div>`;
}
binders.uzytkownicy = () => $$("[data-u]").forEach(el => el.onchange = () =>
  updateDoc(doc(db, "users", el.dataset.u), { [el.dataset.f]: el.value }).catch(err));
