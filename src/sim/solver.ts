// @ts-nocheck
import { app } from '../state';
import { clamp, fmtU } from '../core/base';
import { CT } from '../parts/catalog';
import { MCU, compById, isGnd, isSupply, mcuById, mcuCaps, mcuCfg, mcuPinName, mk, mkSplit, pinsOf } from '../core/analysis';

// ════════════════════════ Simulação DC (MNA + Newton‑Raphson, PWM quase‑estático) ════════════════════════
export const VT = 0.025852, GMIN = 1e-12;

export function lexp(x) { return x < 80 ? Math.exp(x) : Math.exp(80) * (1 + x - 80); }
export function dlexp(x) { return x < 80 ? Math.exp(x) : Math.exp(80); }

export function pnjlim(vnew, vold, nvt, vcrit) {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * nvt) {
    if (vold > 0) { const arg = 1 + (vnew - vold) / nvt; vnew = arg > 0 ? vold + nvt * Math.log(arg) : vcrit; }
    else vnew = nvt * Math.log(vnew / nvt);
  }
  return vnew;
}

export function gauss(A, z) {
  const n = z.length;
  for (let i = 0; i < n; i++) {
    let p = i, mx = Math.abs(A[i][i]);
    for (let k = i + 1; k < n; k++) { const v = Math.abs(A[k][i]); if (v > mx) { mx = v; p = k; } }
    if (mx < 1e-14) return null;
    if (p !== i) { const t = A[i]; A[i] = A[p]; A[p] = t; const tz = z[i]; z[i] = z[p]; z[p] = tz; }
    const piv = A[i][i];
    for (let k = i + 1; k < n; k++) { const f = A[k][i] / piv; if (f !== 0) { const Ak = A[k], Ai = A[i]; for (let j = i; j < n; j++) Ak[j] -= f * Ai[j]; z[k] -= f * z[i]; } }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) { let s = z[i]; for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j]; x[i] = s / A[i][i]; }
  return x;
}

export function nodesOf(d) {
  switch (d.t) { case 'R': case 'RC': return [d.a, d.b]; case 'V': return [d.p, d.n]; case 'D': return [d.a, d.k]; case 'Q': return [d.c, d.b, d.e]; case 'M': return [d.d, d.g, d.s]; case 'REG': return [d.in, d.gnd, d.out]; case 'MO': return [d.pin, d.gnd]; }
  return [];
}

export function mkEl(d, I, cfg) {
  const Vx = x => q => q < 0 ? 0 : x[q];
  switch (d.t) {
    case 'R': case 'RC': {
      if (d.t === 'RC' && cfg.relay(d.relay) !== d.when) return null;
      const a = I(d.a), b = I(d.b), g = 1 / Math.max(d.t === 'RC' ? 0.05 : d.r, 1e-4);
      return { d, touch:[a, b], stamp(S) { S.G(a, b, g); }, info(V) { const v = V(a) - V(b); return { v, i: v * g }; } };
    }
    case 'V': {
      const p = I(d.p), n = I(d.n), val = d.duty != null ? (cfg.high(d) ? d.v : 0) : d.v;
      return { d, touch:[p, n], branch:true, stamp(S) { const m = this.m; S.add(p, m, 1); S.add(n, m, -1); S.add(m, p, 1); S.add(m, n, -1); S.z[m] += val * S.scale; }, info(V, x) { return { i: -x[this.m], v: val }; } };
    }
    case 'MO': {
      const pin = I(d.pin), gnd = I(d.gnd), g = 1 / d.rout, hi = d.duty != null ? cfg.high(d) : !!d.level;
      return { d, touch:[pin, gnd], stamp(S) { S.G(pin, gnd, g); if (hi) S.cur(gnd, pin, d.vh / d.rout * S.scale); }, info(V) { const v = V(pin) - V(gnd); return { v, i: (hi ? d.vh / d.rout : 0) - v * g, hi }; } };
    }
    case 'D': {
      const a = I(d.a), k = I(d.k), m = d.m, nvt = m.n * VT, vcrit = nvt * Math.log(nvt / (Math.SQRT2 * m.Is));
      const st = d.st || (d.st = { v: 0 });
      const f = v => { let i = m.Is * (lexp(v / nvt) - 1), g = m.Is / nvt * dlexp(v / nvt); if (m.bv) { const vb = m.nb * VT, u = -(v + m.bv) / vb; i -= m.ibv * lexp(u); g += m.ibv / vb * dlexp(u); } return [i, g + GMIN]; };
      return { d, touch:[a, k],
        stamp(S) { const [i, g] = f(st.v); S.G(a, k, g); S.cur(a, k, i - g * st.v); },
        update(x) { const V = Vx(x), vn = V(a) - V(k), vo = st.v; let vl = pnjlim(vn, vo, nvt, vcrit);
          if (m.bv && vn < -m.bv + 5 * m.nb * VT) { const vb = m.nb * VT, vcb = vb * Math.log(vb / (Math.SQRT2 * m.ibv)); let t = -(vn + m.bv); t = pnjlim(t, -(vo + m.bv), vb, vcb); vl = -(t + m.bv); }
          st.v = vl; return Math.abs(vl - vo) < 1e-7; },
        info(V) { const ko = d.ko != null ? I(d.ko) : k; return { v: V(a) - V(ko), i: f(V(a) - V(k))[0] }; } };
    }
    case 'Q': {
      const c = I(d.c), b = I(d.b), e = I(d.e), m = d.m, p = m.pol, vcrit = VT * Math.log(VT / (Math.SQRT2 * m.Is));
      const st = d.st || (d.st = { vbe: 0, vbc: 0 });
      const ev = (vbe, vbc) => { const ef = lexp(vbe / VT), er = lexp(vbc / VT), gF = m.Is / VT * dlexp(vbe / VT), gR = m.Is / VT * dlexp(vbc / VT);
        return { Ic: m.Is * (ef - er) - m.Is / m.br * (er - 1), Ib: m.Is / m.bf * (ef - 1) + m.Is / m.br * (er - 1), dc: [gF, -gR - gR / m.br], db: [gF / m.bf, gR / m.br] }; };
      return { d, touch:[c, b, e],
        stamp(S) { const r = ev(st.vbe, st.vbc), de = [-(r.dc[0] + r.db[0]), -(r.dc[1] + r.db[1])];
          for (const [k, I0, dd] of [[c, r.Ic, r.dc], [b, r.Ib, r.db], [e, -r.Ic - r.Ib, de]]) { if (k < 0) continue; S.add(k, b, dd[0] + dd[1]); S.add(k, e, -dd[0]); S.add(k, c, -dd[1]); S.z[k] -= p * (I0 - dd[0] * st.vbe - dd[1] * st.vbc); }
          S.G(b, e, GMIN); S.G(b, c, GMIN); },
        update(x) { const V = Vx(x); const be = pnjlim(p * (V(b) - V(e)), st.vbe, VT, vcrit), bc = pnjlim(p * (V(b) - V(c)), st.vbc, VT, vcrit); const ok = Math.abs(be - st.vbe) < 1e-7 && Math.abs(bc - st.vbc) < 1e-7; st.vbe = be; st.vbc = bc; return ok; },
        info(V) { const r = ev(p * (V(b) - V(e)), p * (V(b) - V(c))); return { ic: p * r.Ic, ib: p * r.Ib, vb: V(d.bo != null ? I(d.bo) : b), vc: V(c), ve: V(e) }; } };
    }
    case 'M': {
      const dn = I(d.d), g = I(d.g), s = I(d.s), m = d.m, st = d.st || (d.st = { vgs: 0, vds: 0 });
      const f = (vgs, vds) => {
        if (vds < 0) { const r = f(vgs - vds, -vds); return { id: -r.id, gm: -r.gm, gds: r.gm + r.gds }; }
        const sm = 0.04, xx = (vgs - m.vth) / sm, vov = xx > 40 ? vgs - m.vth : sm * Math.log1p(Math.exp(xx)), sig = xx > 40 ? 1 : 1 / (1 + Math.exp(-xx)), L = 1 + m.lam * vds;
        let id, dv, gds;
        if (vds < vov) { id = m.K * (vov * vds - vds * vds / 2) * L; dv = m.K * vds * L; gds = m.K * (vov - vds) * L + m.K * (vov * vds - vds * vds / 2) * m.lam; }
        else { id = m.K / 2 * vov * vov * L; dv = m.K * vov * L; gds = m.K / 2 * vov * vov * m.lam; }
        return { id, gm: dv * sig, gds };
      };
      return { d, touch:[dn, s],
        stamp(S) { const r = f(st.vgs, st.vds), I0 = r.id - r.gm * st.vgs - r.gds * st.vds;
          S.add(dn, g, r.gm); S.add(dn, dn, r.gds); S.add(dn, s, -(r.gm + r.gds)); if (dn >= 0) S.z[dn] -= I0;
          S.add(s, g, -r.gm); S.add(s, dn, -r.gds); S.add(s, s, r.gm + r.gds); if (s >= 0) S.z[s] += I0;
          S.G(dn, s, GMIN); },
        update(x) { const V = Vx(x), vgs = V(g) - V(s), vds = V(dn) - V(s); const ok = Math.abs(vgs - st.vgs) < 1e-7 && Math.abs(vds - st.vds) < 1e-6;
          const lim = (n, o, L) => n - o > L ? o + L : o - n > L ? o - L : n; st.vgs = lim(vgs, st.vgs, 0.5); st.vds = lim(vds, st.vds, 2); return ok; },
        info(V) { const vgs = V(g) - V(s), vds = V(dn) - V(s); return { vgs, vds, id: f(vgs, vds).id }; } };
    }
    case 'REG': {
      const i_ = I(d.in), g = I(d.gnd), o = I(d.out), m = d.m, st = d.st || (d.st = { reg: 'reg', n: 0 });
      return { d, touch:[i_, g, o], branch:true, reset() { st.n = 0; },
        stamp(S) { const j = this.m; S.add(o, j, -1); S.add(i_, j, 1); S.cur(i_, g, m.iq * S.scale);
          if (st.reg === 'drop') { S.add(j, o, 1); S.add(j, i_, -1); S.z[j] += -m.drop; } else { S.add(j, o, 1); S.add(j, g, -1); S.z[j] += st.reg === 'reg' ? m.vnom * S.scale : 0; } },
        update(x) { const V = Vx(x), vin = V(i_) - V(g), nr = vin - m.drop >= m.vnom ? 'reg' : vin > m.drop ? 'drop' : 'off'; st.n++; if (nr !== st.reg && st.n < 60) { st.reg = nr; return false; } return true; },
        info(V, x) { return { vin: V(i_) - V(g), vout: V(o) - V(g), iout: x[this.m], region: st.reg }; } };
    }
  }
  return null;
}

export function solveNR(els, n, scale, maxIt) {
  let M = n; for (const e of els) if (e.branch) e.m = M++;
  for (const e of els) if (e.reset) e.reset();
  let prev = null;
  for (let it = 0; it < maxIt; it++) {
    const A = Array.from({ length: M }, () => new Float64Array(M)), z = new Float64Array(M);
    const add = (i, j, v) => { if (i >= 0 && j >= 0) A[i][j] += v; };
    const S = { z, scale, add, G(a, b, g) { add(a, a, g); add(b, b, g); add(a, b, -g); add(b, a, -g); }, cur(a, b, I) { if (a >= 0) z[a] -= I; if (b >= 0) z[b] += I; } };
    for (let i = 0; i < n; i++) A[i][i] += 1e-9;
    for (const e of els) e.stamp(S);
    const x = gauss(A, z);
    if (!x) return { err: 'singular' };
    let conv = it > 0;
    for (const e of els) if (e.update && !e.update(x)) conv = false;
    if (prev) for (let i = 0; i < M; i++) if (Math.abs(x[i] - prev[i]) > 1e-7 * (1 + Math.abs(x[i]))) { conv = false; break; }
    prev = x;
    if (conv) return { x };
  }
  return { err: 'noconv' };
}

export function aggregate(list) {
  // list: [{w, r}] → média ponderada nos números, pico absoluto em r.pk
  const out = {}, pk = {};
  const main = list.reduce((a, b) => b.w > a.w ? b : a, list[0]);
  for (const { w, r } of list) for (const [k, v] of Object.entries(r)) {
    if (typeof v === 'number') { out[k] = (out[k] || 0) + v * w; if (!(k in pk) || Math.abs(v) > Math.abs(pk[k])) pk[k] = v; }
    else if (!(k in out)) out[k] = main.r[k];
  }
  out.pk = pk;
  if (list.length > 1 && typeof main.r.region === 'string') { const rs = {}; for (const { w, r } of list) rs[r.region] = (rs[r.region] || 0) + w; if (Object.keys(rs).length > 1) out.regions = ' ' + Object.entries(rs).map(([k, v]) => `${k.toLowerCase()} ${Math.round(v * 100)}%`).join(' · '); }
  return out;
}

export function simulate(an) {
  const out = { ok: false, msg: '', V: new Map(), comp: new Map(), mcu: new Map(), pwm: false, issues: [], floating: new Set(), segs: 1 };
  const D = [];
  for (const c of app.S.comps) { const N = an.pinNode.get(c.id); for (const d of CT[c.type].sim(c, N)) { d.owner = c.id; D.push(d); } }
  // resistências série internas (diodos e base dos transistores) mantêm correntes finitas em curtos
  for (const d of D.slice()) {
    if (d.t === 'D' && d.m.rs) { const x = 'rs' + d.owner + d.tag; D.push({ t: 'R', a: x, b: d.k, r: d.m.rs, owner: d.owner, tag: d.tag + '_rs' }); d.ko = d.k; d.k = x; }
    if (d.t === 'Q' && d.m.rb) { const x = 'rb' + d.owner + d.tag; D.push({ t: 'R', a: d.b, b: x, r: d.m.rb, owner: d.owner, tag: d.tag + '_rb' }); d.bo = d.b; d.b = x; }
  }
  const gndOf = new Map();   // mid → nó do GND
  for (const mo of app.S.mcus) {
    const m = MCU[mo.type], used = [...an.mcuUsed].filter(k => mkSplit(k)[0] === mo.id);
    if (!used.length) continue;
    const gndK = an.mcuNode.get(mk(mo.id, m.pins.find(p => isGnd(p.n)).id)); gndOf.set(mo.id, gndK);
    for (const kk of used) {
      const pid = mkSplit(kk)[1], p = m.pin[pid], k = an.mcuNode.get(kk);
      if (isSupply(m, p.n)) { D.push({ t: 'V', p: k, n: gndK, v: m.supplies[p.n], owner: 'mcu', tag: kk }); continue; }
      const caps = mcuCaps(m, p); if (!caps.io) continue;
      const cf = mcuCfg(mo.id, pid);
      if (cf.mode === 'out' && caps.out) D.push({ t: 'MO', pin: k, gnd: gndK, vh: m.vcc, rout: m.rout, level: cf.level, owner: 'mcu', tag: kk });
      else if (cf.mode === 'pwm' && caps.pwm) D.push({ t: 'MO', pin: k, gnd: gndK, vh: m.vcc, rout: m.rout, duty: clamp(cf.duty / 100, 0, 1), owner: 'mcu', tag: kk });
      else if (cf.mode === 'pullup') D.push({ t: 'MO', pin: k, gnd: gndK, vh: m.vcc, rout: mo.type === 'esp32' ? 45000 : 35000, level: 1, owner: 'mcu', tag: kk, pull: true });
    }
  }
  if (!D.some(d => d.t === 'V' || d.t === 'MO')) { out.msg = app.S.comps.length ? 'Nenhuma fonte ligada. Configure um borne como "Fonte DC" ou ligue um microcontrolador para simular.' : 'Coloque peças na placa para simular.'; return out; }
  // ilhas e referência (terra) de cada ilha
  const par = new Map(), f = x => { if (!par.has(x)) par.set(x, x); while (par.get(x) !== x) x = par.get(x); return x; };
  for (const d of D) { const ns = nodesOf(d); for (let i = 1; i < ns.length; i++) { const a = f(ns[0]), b = f(ns[i]); if (a !== b) par.set(a, b); } }
  const refOf = new Map();
  const setRef = k => { const r = f(k); if (!refOf.has(r)) refOf.set(r, k); };
  for (const g of gndOf.values()) setRef(g);
  for (const d of D) if (d.t === 'V') setRef(d.n);
  for (const d of D) if (d.t === 'REG') setRef(d.gnd);
  const idx = new Map(); let n = 0;
  const unpowered = new Set();
  for (const k of par.keys()) { const r = f(k), ref = refOf.get(r); if (!ref) { unpowered.add(k); idx.set(k, -1); } else if (k === ref) idx.set(k, -1); else idx.set(k, n++); }
  const I = k => { const v = idx.get(k); return v == null ? -1 : v; };
  // segmentos de PWM
  const duties = [...new Set(D.filter(d => d.duty != null).map(d => d.duty))].filter(x => x > 0 && x < 1).sort((a, b) => a - b);
  const cuts = [0, ...duties, 1], segs = [];
  for (let i = 0; i < cuts.length - 1; i++) if (cuts[i + 1] - cuts[i] > 1e-9) segs.push({ t0: cuts[i], t1: cuts[i + 1] });
  out.pwm = D.some(d => d.duty != null); out.segs = segs.length;
  const relays = app.S.comps.filter(c => c.type === 'relay');
  const results = [];
  let relayState = new Map(relays.map(r => [r.id, false]));
  for (const sg of segs) {
    const tm = (sg.t0 + sg.t1) / 2;
    const cfg = { high: d => d.duty != null ? tm < d.duty : true, relay: id => relayState.get(id) };
    let sol = null, els = null;
    for (let pass = 0; pass < 8; pass++) {
      els = D.map(d => mkEl(d, I, cfg)).filter(Boolean);
      sol = solveNR(els, n, 1, 300);
      if (sol.err === 'noconv') { for (const d of D) delete d.st; els = D.map(d => mkEl(d, I, cfg)).filter(Boolean); for (let s = 1; s <= 25; s++) { sol = solveNR(els, n, s / 25, 300); if (sol.err) break; } }
      if (sol.err) break;
      const V = q => q < 0 ? 0 : sol.x[q];
      let changed = false;
      for (const r of relays) { const e = els.find(e => e.d.owner === r.id && e.d.tag === 'coil'); const v = Math.abs(e.info(V, sol.x).v), on = relayState.get(r.id); const nv = on ? v > 1.5 : v >= 3.75; if (nv !== on) { relayState.set(r.id, nv); changed = true; } }
      if (!changed) break;
    }
    if (sol.err) { out.msg = sol.err === 'singular' ? 'O circuito não tem solução: há fontes de tensão diferentes ligadas no mesmo ponto, ou uma fonte em curto.' : 'A simulação não convergiu. Verifique curtos e fontes em paralelo.'; out.issues.push({ sev: 'err', msg: 'Simulação: ' + out.msg, at: null }); return out; }
    results.push({ w: sg.t1 - sg.t0, x: sol.x, els, relay: new Map(relayState) });
  }
  // flutuantes (nenhum elemento conduz no nó)
  const touched = new Set(); for (const e of results[0].els) for (const q of e.touch) if (q >= 0) touched.add(q);
  for (const [k, v] of idx) if (v >= 0 && !touched.has(v)) out.floating.add(k);
  for (const k of unpowered) out.floating.add(k);
  // tensões médias
  const allKeys = new Set([...idx.keys()]);
  for (const k of allKeys) { let s = 0; for (const r of results) { const i = I(k); s += (i < 0 ? 0 : r.x[i]) * r.w; } out.V.set(k, s); }
  // resultados por componente
  for (const c of app.S.comps) {
    const list = results.map(res => {
      const V = q => q < 0 ? 0 : res.x[q];
      const E = {
        el: tag => { const e = res.els.find(e => e.d.owner === c.id && e.d.tag === tag); return e ? e.info(V, res.x) : { v: 0, i: 0, ic: 0, ib: 0, vb: 0, vc: 0, ve: 0, id: 0, vgs: 0, vds: 0, vin: 0, vout: 0, iout: 0, region: 'off' }; },
        V: (cc, i) => V(I(an.pinNode.get(cc.id)[i])),
        relay: id => res.relay.get(id),
      };
      return { w: res.w, r: CT[c.type].result(c, E) };
    });
    out.comp.set(c.id, aggregate(list));
  }
  // resultados dos microcontroladores
  for (const kk of an.mcuUsed) {
    const gndK = gndOf.get(mkSplit(kk)[0]);
    const list = results.map(res => {
      const V = q => q < 0 ? 0 : res.x[q];
      const e = res.els.find(e => e.d.owner === 'mcu' && e.d.tag === kk);
      const v = V(I(an.mcuNode.get(kk))) - (gndK ? V(I(gndK)) : 0);
      return { w: res.w, r: e ? Object.assign({ v }, e.info(V, res.x)) : { v, i: 0 } };
    });
    const a = aggregate(list), nk = an.mcuNode.get(kk); a.floating = out.floating.has(nk) || !idx.has(nk);
    out.mcu.set(kk, a);
  }
  out.ok = true;
  // verificações baseadas na simulação
  for (const c of app.S.comps) {
    const r = out.comp.get(c.id), t = CT[c.type]; if (!r || !t.checks) continue;
    const p0 = pinsOf(c)[0];
    t.checks(c, r, (sev, msg) => out.issues.push({ sev, msg, at: { c: p0.c, r: p0.r } }));
  }
  for (const ind of an.inductive) for (const did of ind.diodes) {
    const r = out.comp.get(did), dc = compById(did);
    if (r && r.i > 0.01) out.issues.push({ sev: 'err', msg: `${dc.p.name} está invertido sobre ${ind.comp.p.name}: conduz ${fmtU(r.i, 'A')} direto da fonte. O cátodo (faixa) vai no lado positivo da carga.`, at: { c: dc.c, r: dc.r } });
  }
  for (const [kk, r] of out.mcu) {
    const [mid, pid] = mkSplit(kk), mo = mcuById(mid), m = MCU[mo.type], p = m.pin[pid], cf = mcuCfg(mid, pid), nm = mcuPinName(mid, pid), ex = { mcu: mid };
    if (isSupply(m, p.n)) { const i = r.i || 0; if (i > m.supMax[p.n]) out.issues.push({ sev: 'warn', msg: `O pino ${p.n} do ${mo.name} fornece ${fmtU(i, 'A')}; o limite é cerca de ${fmtU(m.supMax[p.n], 'A')}. Use uma fonte externa para as cargas.`, at: null, ...ex }); if (i < -0.005) out.issues.push({ sev: 'err', msg: `Corrente entrando no pino ${p.n} do ${mo.name}: há uma fonte externa empurrando tensão nele.`, at: null, ...ex }); continue; }
    if (!mcuCaps(m, p).io) continue;
    if (r.pk.v > m.vmaxIn) out.issues.push({ sev: 'err', msg: `${nm} recebe ${fmtU(r.pk.v, 'V')}. O limite é ${m.vmaxIn} V${mo.type === 'esp32' ? ' (o ESP32 não tolera 5 V)' : ''}: use divisor de tensão ou conversor de nível.`, at: null, ...ex });
    if (r.pk.v < -0.5) out.issues.push({ sev: 'err', msg: `${nm} recebe tensão negativa (${fmtU(r.pk.v, 'V')}).`, at: null, ...ex });
    if ((cf.mode === 'out' || cf.mode === 'pwm') && !r.pull) {
      const i = Math.abs(r.pk.i || 0);
      if (i > m.ie) out.issues.push({ sev: 'err', msg: `${nm} fornece ${fmtU(i, 'A')}, acima do máximo absoluto de ${fmtU(m.ie, 'A')}. O pino pode queimar: use um transistor.`, at: null, ...ex });
      else if (i > m.iw) out.issues.push({ sev: 'warn', msg: `${nm} fornece ${fmtU(i, 'A')}, acima dos ${fmtU(m.iw, 'A')} recomendados.`, at: null, ...ex });
    }
    if ((cf.mode === 'in' || cf.mode === 'analog') && r.floating) out.issues.push({ sev: 'warn', msg: `${nm} é entrada e está flutuando: a leitura fica aleatória. Use INPUT_PULLUP ou um resistor de 10 kΩ para GND/VCC.`, at: null, ...ex });
  }
  return out;
}

export function mcuReading(kk, r) {
  const [mid, pid] = mkSplit(kk), m = MCU[mcuById(mid).type], cf = mcuCfg(mid, pid), v = r.v;
  if (r.floating && cf.mode !== 'out' && cf.mode !== 'pwm') return 'flutuando';
  if (cf.mode === 'analog') return `analogRead ≈ ${Math.round(clamp(v / m.vcc, 0, 1) * m.adc)}`;
  if (cf.mode === 'in' || cf.mode === 'pullup') return v > 0.6 * m.vcc ? 'digitalRead = HIGH' : v < 0.3 * m.vcc ? 'digitalRead = LOW' : 'indefinido (zona proibida)';
  return '';
}
