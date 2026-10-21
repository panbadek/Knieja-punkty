// Czysta logika punktacji — bez Firebase, łatwa do testowania.
export const ZASTEPY = ["Lisy","Łosie","Żubry","Rysie","Niedźwiedzie","Gronostaje"];
export const DEFAULT_CONFIG = {
  base: 20, step: 0.2, mundur: 4,
  duze: [40,30,25,20,15,10], male: [20,15,13,11,9,6],
  alarmProgi: [10,6,4,2], alarmBonus: [8,6,5,4,3,1],
  liczebnosc: { Lisy:9, "Łosie":9, "Żubry":9, Rysie:9, "Niedźwiedzie":9, Gronostaje:9 },
  kwartaly: [
    { nazwa: "IV kw. 2026", start: "2026-10-01", end: "2026-12-31" },
    { nazwa: "I kw. 2027",  start: "2027-01-01", end: "2027-03-31" },
  ],
};

const DAY = 86400000;
export function parseD(s) { const [y,m,d] = s.split("-").map(Number); return Date.UTC(y, m-1, d); }
export function fmtD(t) { return new Date(t).toISOString().slice(0,10); }
export function monday(t) { const wd = (new Date(t).getUTCDay() + 6) % 7; return t - wd*DAY; }
const inQ = (s, q) => s >= q.start && s <= q.end;

// Liczebność h: najpierw z akcji, potem z ustawień
const hOf = (cfg, z, over) => Number(over ?? cfg.liczebnosc?.[z] ?? 0);

// --- Zbiórki zastępu ze streakiem
export function streakPoints(cfg, q, zbiorki, akcje, todayStr) {
  const out = {};
  const qs = parseD(q.start), qe = parseD(q.end), today = parseD(todayStr);
  const teamWeeks = new Set(akcje.filter(a => inQ(a.data, q)).map(a => monday(parseD(a.data))));
  for (const z of ZASTEPY) {
    const meetWeeks = new Set(zbiorki.filter(m => m.zastep === z && m.status === "zatwierdzona" && inQ(m.data, q))
                                     .map(m => monday(parseD(m.data))));
    let n = 0, total = 0; const log = [];
    for (let w = monday(qs); w <= qe && w <= today; w += 7*DAY) {
      const weekEnd = w + 6*DAY;
      if (meetWeeks.has(w)) {
        n++; const p = cfg.base * (1 + (n-1) * cfg.step); total += p;
        log.push({ tydzien: fmtD(w), n, pkt: p });
      } else if (teamWeeks.has(w)) {
        log.push({ tydzien: fmtD(w), n, pkt: 0, info: "akcja drużyny — streak zamrożony" });
      } else if (weekEnd < today) {          // tydzień się skończył bez zbiórki
        if (n > 0) log.push({ tydzien: fmtD(w), n: 0, pkt: 0, info: "brak zbiórki — streak wyzerowany" });
        n = 0;
      }
    }
    out[z] = { total, n, log };
  }
  return out;
}

// --- Akcja drużyny (zbiórka / biwak)
export function akcjaPoints(cfg, a) {
  const res = {};
  for (const z of ZASTEPY) {
    const w = a.wyniki?.[z] || {};
    const h = hOf(cfg, z, w.h), hob = Number(w.hob || 0);
    let gry = 0;
    for (const g of a.gry || []) {
      const m = Number(g.miejsca?.[z]);
      if (m >= 1) gry += Number((g.rodzaj === "duza" ? cfg.duze : cfg.male)[m-1] || 0);
    }
    let mund = 0;
    for (const m of a.mundury || []) {
      const d = m.dane?.[z]; const hm = Number(d?.h || 0);
      if (hm > 0) mund += (cfg.mundur * hm - Number(d.b || 0)) / hm;
    }
    const gryPrzel = h > 0 ? gry * hob / h : 0;
    res[z] = { gry, gryPrzel, mund, total: gryPrzel + mund, h, hob };
  }
  return res;
}

// --- Alarm: osoby × punkty progu + bonus za kolejność zastępów (wg 1. osoby, remis = to samo miejsce)
export function alarmPoints(cfg, al) {
  const res = {};
  const times = ZASTEPY.map(z => al.dane?.[z]?.pierwszy).filter(t => t !== "" && t != null).map(Number);
  const uniq = [...new Set(times)].sort((a,b) => a-b);
  for (const z of ZASTEPY) {
    const d = al.dane?.[z] || {};
    const osoby = (d.liczby || []).reduce((s, c, i) => s + Number(c || 0) * Number(cfg.alarmProgi[i] || 0), 0);
    let bonus = 0, miejsce = null;
    if (d.pierwszy !== "" && d.pierwszy != null) {
      miejsce = uniq.indexOf(Number(d.pierwszy)) + 1;
      bonus = Number(cfg.alarmBonus[miejsce-1] || 0);
    }
    res[z] = { osoby, bonus, miejsce, total: osoby + bonus };
  }
  return res;
}

export function quarterTotals(cfg, q, data, todayStr) {
  const st = streakPoints(cfg, q, data.zbiorki, data.akcje, todayStr);
  const t = Object.fromEntries(ZASTEPY.map(z => [z, { zbiorki: st[z].total, akcje: 0, alarmy: 0, streak: st[z].n, log: st[z].log }]));
  for (const a of data.akcje.filter(a => inQ(a.data, q))) {
    const r = akcjaPoints(cfg, a); for (const z of ZASTEPY) t[z].akcje += r[z].total;
  }
  for (const al of data.alarmy.filter(a => inQ(a.data, q))) {
    const r = alarmPoints(cfg, al); for (const z of ZASTEPY) t[z].alarmy += r[z].total;
  }
  for (const z of ZASTEPY) t[z].suma = t[z].zbiorki + t[z].akcje + t[z].alarmy;
  return t;
}

// Ułamki: 83.333… → "83 1/3"
export function frac(x) {
  if (!isFinite(x)) return "–";
  const s = x < 0 ? "−" : ""; x = Math.abs(x);
  const w = Math.floor(x + 1e-9), r = x - w;
  if (r < 1e-9) return s + w;
  for (let d = 2; d <= 360; d++) {
    const n = Math.round(r * d);
    if (Math.abs(r * d - n) < 1e-6) return s + (w ? w + " " : "") + n + "/" + d;
  }
  return s + x.toFixed(2);
}
