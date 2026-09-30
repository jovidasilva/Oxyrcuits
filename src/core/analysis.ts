// @ts-nocheck
import { app } from '../state';
import { BJT, NETPAL, TRACECOL, boardAt, boardDims, boardRect, bp, breadRow, clone, hc, hk, hname, holeExists, hr, inBoard, kindAt, rotv, toView } from './base';
import { CT, LIBMAP } from '../parts/catalog';

// ════════════════════════ Microcontroladores ════════════════════════
export function mkMcu(def) {
  const seen = {}, pins = [];
  const add = (list, side) => list.forEach((n, i) => { if (!n) return; seen[n] = (seen[n] || 0) + 1; const id = seen[n] > 1 ? n + '#' + seen[n] : n; pins.push({ id, n, side, i }); });
  add(def.left, 0); add(def.right, 1);
  def.pins = pins; def.pin = {}; pins.forEach(p => def.pin[p.id] = p);
  def.rowsN = Math.max(def.left.length, def.right.length);
  def.wp = 8; def.hp = 4.8 + def.rowsN;
  return def;
}

export const MCU = {
  uno: mkMcu({ label:'Arduino Uno', short:'UNO', vcc:5, rout:25, iw:0.02, ie:0.04, adc:1023, vmaxIn:5.5, col:'#0f7f8a',
    left:['IOREF','3V3','5V','GND','GND','VIN',null,'A0','A1','A2','A3','A4','A5'],
    right:['GND','D13','D12','D11','D10','D9','D8',null,'D7','D6','D5','D4','D3','D2','D1','D0'],
    pwm:['D3','D5','D6','D9','D10','D11'], analogOnly:[], inputOnly:[], supplies:{ '5V':5, '3V3':3.3 }, supMax:{ '5V':0.45, '3V3':0.05 }, noconn:['IOREF'] }),
  nano: mkMcu({ label:'Arduino Nano', short:'NANO', vcc:5, rout:25, iw:0.02, ie:0.04, adc:1023, vmaxIn:5.5, col:'#1e5aa8',
    left:['D13','3V3','A0','A1','A2','A3','A4','A5','A6','A7','5V','GND','VIN'],
    right:['D12','D11','D10','D9','D8','D7','D6','D5','D4','D3','D2','GND','D0','D1'],
    pwm:['D3','D5','D6','D9','D10','D11'], analogOnly:['A6','A7'], inputOnly:['A6','A7'], supplies:{ '5V':5, '3V3':3.3 }, supMax:{ '5V':0.45, '3V3':0.05 }, noconn:[] }),
  esp32: mkMcu({ label:'ESP32 DevKit', short:'ESP32', vcc:3.3, rout:40, iw:0.012, ie:0.04, adc:4095, vmaxIn:3.6, col:'#24262b',
    left:['VIN','GND','G13','G12','G14','G27','G26','G25','G33','G32','G35','G34','G39','G36'],
    right:['3V3','GND','G15','G2','G4','G16','G17','G5','G18','G19','G21','G3','G1','G22','G23'],
    pwm:null, analogOnly:[], inputOnly:['G34','G35','G36','G39'], adcPins:['G32','G33','G34','G35','G36','G39','G25','G26','G27','G14','G12','G13','G15','G2','G4'], supplies:{ 'VIN':5, '3V3':3.3 }, supMax:{ 'VIN':0.45, '3V3':0.4 }, noconn:[] }),
};

export const isSupply = (m, n) => n in m.supplies;
export const isGnd = n => n === 'GND';

export function mcuCaps(m, p) {
  const n = p.n;
  if (isGnd(n) || isSupply(m, n) || m.noconn.includes(n) || n === 'VIN') return { io:false };
  const analog = m.adcPins ? m.adcPins.includes(n) : n[0] === 'A';
  return { io:true, out:!m.inputOnly.includes(n), pwm: m.pwm ? m.pwm.includes(n) : !m.inputOnly.includes(n), analog };
}

// Pinos de microcontrolador são referenciados por [id do MCU, id do pino]; a chave de texto é "mid:pid".
export const mk = (mid, pid) => mid + ':' + pid;

export const mkSplit = k => { const i = k.indexOf(':'); return [+k.slice(0, i), k.slice(i + 1)]; };
export function mcuById(mid) { return app.S.mcus.find(m => m.id === mid); }
export function mcuPinWorld(mo, pid) { const m = MCU[mo.type], p = m.pin[pid]; return [mo.x + (p.side ? m.wp - 0.8 : 0.8), mo.y + 3.2 + p.i]; }
export function mcuPinPos(mid, pid) { const mo = mcuById(mid); if (!mo) return null; const w = mcuPinWorld(mo, pid); return toView(w[0], w[1]); }
export function mcuCfg(mid, pid) { const r = app.RUNCFG[mid]; if (r && r[pid]) return r[pid]; const mo = mcuById(mid); return (mo && mo.pins && mo.pins[pid]) || { mode:'in', level:0, duty:50 }; }
export function mcuPinName(mid, pid) { const mo = mcuById(mid); return mo ? `${app.S.mcus.length > 1 ? mo.name : MCU[mo.type].short}.${pid.split('#')[0]}` : 'MCU'; }

// ════════════════════════ Utilidades de estado ════════════════════════
export function pinsOf(c) {
  const t = CT[c.type], names = t.names(c);
  return t.pins(c).map(([x, y], i) => { const [dx, dy] = rotv(x, y, c.rot); return { c: c.c + dx, r: c.r + dy, name: names[i], i }; });
}

export function compById(id) { return app.S.comps.find(c => c.id === id); }

export function epPos(ep) {
  if (ep.h) return toView(ep.h[0], ep.h[1]);
  if (ep.mcu) return mcuPinPos(ep.mcu[0], ep.mcu[1]);
  if (ep.pin) { const c = compById(ep.pin[0]); if (c) { const p = pinsOf(c)[ep.pin[1]]; if (p) return toView(p.c, p.r); } }
  return null;
}

export function epName(ep) {
  if (ep.h) return hname(ep.h[0], ep.h[1]);
  if (ep.mcu) return mcuPinName(ep.mcu[0], ep.mcu[1]);
  if (ep.pin) { const c = compById(ep.pin[0]); if (c) return `${c.p.name}.${pinsOf(c)[ep.pin[1]].name}`; }
  return '?';
}

export function epValid(ep) {
  if (ep.h) return holeExists(ep.h[0], ep.h[1]);
  if (ep.mcu) { const mo = mcuById(ep.mcu[0]); return !!(mo && MCU[mo.type].pin[ep.mcu[1]]); }
  if (ep.pin) { const c = compById(ep.pin[0]); return !!(c && ep.pin[1] < pinsOf(c).length); }
  return false;
}

export function occupancy(exComp) {
  const m = new Map();
  for (const c of app.S.comps) { if (c.id === exComp) continue; for (const p of pinsOf(c)) m.set(hk(p.c, p.r), { kind:'pin', comp:c, pin:p }); }
  for (const w of app.S.wires) for (const ep of [w.a, w.b]) if (ep.h) m.set(hk(ep.h[0], ep.h[1]), { kind:'wire', w });
  return m;
}

export function compAABB(c) {
  const [a1, a2, b1, b2] = CT[c.type].box(c);
  const pts = [bp(c, a1, b1), bp(c, a2, b1), bp(c, a2, b2), bp(c, a1, b2)];
  return [Math.min(...pts.map(p => p[0])), Math.max(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[1]))];
}

export function validComp(comp) {
  const occ = occupancy(comp.id), seen = new Set(); let brd = null;
  for (const p of pinsOf(comp)) { if (!holeExists(p.c, p.r)) return false; const b = boardAt(p.c, p.r); if (brd && b !== brd) return false; brd = b; const h = hk(p.c, p.r); if (occ.has(h) || seen.has(h)) return false; seen.add(h); }
  return true;
}

export function overlapsBody(comp) {
  const A = compAABB(comp);
  return app.S.comps.some(o => { if (o.id === comp.id) return false; const B = compAABB(o); return Math.min(A[1], B[1]) - Math.max(A[0], B[0]) > 0.12 && Math.min(A[3], B[3]) - Math.max(A[2], B[2]) > 0.12; });
}

export function nextName(prefix) {
  let m = 0; const re = new RegExp('^' + prefix + '(\\d+)$');
  for (const c of app.S.comps) { const x = re.exec(c.p.name || ''); if (x) m = Math.max(m, +x[1]); }
  return prefix + (m + 1);
}

export function makeComp(key, c, r, rot, ghost) {
  const [, , type, props] = LIBMAP[key];
  const p = clone(props); p.name = ghost ? CT[type].prefix + '?' : nextName(CT[type].prefix); p.desc = '';
  return { id: ghost ? -1 : app.S.nextId++, type, c, r, rot, p };
}

export function nextTraceTag() { return app.S.traces.reduce((m, t) => Math.max(m, t.tag || 0), 0) + 1; }

// ════════════════════════ Análise: conectividade + verificação ════════════════════════
export function traceCover(t) {
  const out = [];
  for (let i = 0; i < t.pts.length - 1; i++) {
    const [ac, ar] = t.pts[i], [bc, br] = t.pts[i + 1];
    const dc = bc - ac, dr = br - ar, n = Math.max(Math.abs(dc), Math.abs(dr));
    if (n === 0) continue;
    const sc = Math.sign(dc), sr = Math.sign(dr);
    for (let k = (out.length ? 1 : 0); k <= n; k++) out.push({ c: ac + sc * k, r: ar + sr * k, vertex: k === 0 || k === n, seg: i });
  }
  return out;
}

export function analyze() {
  const N = app.COLS * app.ROWS; let total = N;
  const pinId = new Map();
  for (const c of app.S.comps) { pinId.set(c.id, total); total += pinsOf(c).length; }
  const mcuId = new Map();
  for (const mo of app.S.mcus) for (const p of MCU[mo.type].pins) mcuId.set(mk(mo.id, p.id), total++);
  const par = new Int32Array(total); for (let i = 0; i < total; i++) par[i] = i;
  const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
  const cuts = new Set(app.S.cuts.filter(([c, r]) => kindAt(c, r) === 'strip').map(([c, r]) => hk(c, r)));
  const contact = (c, r) => kindAt(c, r) === 'bread';   // protoboard: pino encosta sem solda
  // pré-ligações de cada placa
  for (const b of app.S.boards) {
    const [w, h] = boardDims(b);
    if (b.kind === 'bread') for (let r = 0; r < h; r++) { const br = breadRow(b, r); for (let c = 0; c < w; c++) { if (!holeExists(b.x + c, b.y + r)) continue; if (br.t === 'm') uni(hk(b.x + c, b.y + r), hk(b.x + c, b.y + br.top)); else if (br.t === 'rail') uni(hk(b.x + c, b.y + r), hk(b.x, b.y + r)); } }
    if (b.kind === 'strip') for (let r = 0; r < h; r++) for (let c = 1; c < w; c++) { const h1 = hk(b.x + c - 1, b.y + r), h2 = hk(b.x + c, b.y + r); if (!cuts.has(h1) && !cuts.has(h2)) uni(h1, h2); }
  }
  const soldered = new Set(app.S.solder.filter(([c, r]) => inBoard(c, r) && !contact(c, r)).map(([c, r]) => hk(c, r)));
  const traceHoles = new Map(), diag = new Map(), covers = new Map(), traceOf = new Map();
  for (const t of app.S.traces) {
    const cov = traceCover(t); covers.set(t.id, cov);
    for (let j = 0; j < cov.length; j++) {
      const e = cov[j]; if (!inBoard(e.c, e.r)) continue; const h = hk(e.c, e.r);
      soldered.add(h);
      if (j > 0) {
        const p = cov[j - 1]; uni(hk(p.c, p.r), h);
        const dc = e.c - p.c, dr = e.r - p.r;
        if (dc && dr) { const key = Math.min(e.c, p.c) + ',' + Math.min(e.r, p.r); if (!diag.has(key)) diag.set(key, []); diag.get(key).push({ tid: t.id, dir: dc * dr > 0 ? 'b' : 's' }); }
      }
      if (!traceHoles.has(h)) traceHoles.set(h, []);
      traceHoles.get(h).push({ tid: t.id, vertex: e.vertex });
    }
  }
  const epId = ep => { if (ep.h) { if (!inBoard(ep.h[0], ep.h[1])) return null; const h = hk(ep.h[0], ep.h[1]); if (!contact(ep.h[0], ep.h[1])) soldered.add(h); return h; } if (ep.mcu) { const v = mcuId.get(mk(ep.mcu[0], ep.mcu[1])); return v == null ? null : v; } if (ep.pin) { const b = pinId.get(ep.pin[0]); return b == null ? null : b + ep.pin[1]; } return null; };
  for (const w of app.S.wires) { const a = epId(w.a), b = epId(w.b); if (a != null && b != null) uni(a, b); }
  const issues = [], add = (sev, msg, at, extra) => issues.push(Object.assign({ sev, msg, at }, extra || {}));
  const unsoldered = [];
  for (const c of app.S.comps) {
    const base = pinId.get(c.id);
    pinsOf(c).forEach((p, i) => { if (!inBoard(p.c, p.r)) return; const h = hk(p.c, p.r); if (contact(p.c, p.r) || soldered.has(h)) uni(base + i, h); else { unsoldered.push({ c: p.c, r: p.r }); add('warn', `${c.p.name}.${p.name} (${hname(p.c, p.r)}) está sem solda e não conduz.`, { c: p.c, r: p.r }); } });
    for (const [a, b] of (CT[c.type].internal || [])) uni(base + a, base + b);
  }
  for (const mo of app.S.mcus) { const g = MCU[mo.type].pins.filter(p => isGnd(p.n)).map(p => mcuId.get(mk(mo.id, p.id))); for (let i = 1; i < g.length; i++) uni(g[0], g[i]); }
  // chaves de rede
  const key = id => 'n' + find(id);
  const pinNode = new Map(), nodeMembers = new Map(), mcuNode = new Map();
  const addMember = (k, m) => { if (!nodeMembers.has(k)) nodeMembers.set(k, []); nodeMembers.get(k).push(m); };
  for (const c of app.S.comps) { const base = pinId.get(c.id); const ks = pinsOf(c).map((p, i) => { const k = key(base + i); addMember(k, { comp: c, i, name: `${c.p.name}.${p.name}` }); return k; }); pinNode.set(c.id, ks); }
  for (const mo of app.S.mcus) for (const p of MCU[mo.type].pins) { const kk = mk(mo.id, p.id), k = key(mcuId.get(kk)); mcuNode.set(kk, k); addMember(k, { mcu: kk, name: mcuPinName(mo.id, p.id) }); }
  const holeRoot = new Int32Array(N); for (let h = 0; h < N; h++) holeRoot[h] = find(h);
  const holeKey = h => 'n' + holeRoot[h];
  const mcuUsed = new Set();
  const wiredMcu = new Set(); for (const w of app.S.wires) for (const ep of [w.a, w.b]) if (ep.mcu) wiredMcu.add(mk(ep.mcu[0], ep.mcu[1]));
  for (const [kk, k] of mcuNode) { const mem = nodeMembers.get(k) || []; if (mem.some(m => !m.mcu) || wiredMcu.has(kk)) mcuUsed.add(kk); }
  // nomes de rede
  const netName = new Map(), labelKeys = new Map();
  for (const lb of app.S.labels) { if (!inBoard(lb.h[0], lb.h[1]) || !lb.name) continue; const k = holeKey(hk(lb.h[0], lb.h[1])); if (!netName.has(k)) netName.set(k, lb.name); if (!labelKeys.has(lb.name)) labelKeys.set(lb.name, new Set()); labelKeys.get(lb.name).add(k); }
  for (const [nm, ks] of labelKeys) if (ks.size > 1) add('warn', `O nome de rede "${nm}" aparece em ${ks.size} redes que não estão ligadas entre si.`, null);
  // cor de rede
  const netIdx = new Map(); let ni = 0;
  for (const t of app.S.traces) { const cov = covers.get(t.id); if (!cov || !cov.length) continue; const k = holeKey(hk(cov[0].c, cov[0].r)); if (!netIdx.has(k)) netIdx.set(k, ni++); }
  const occ = occupancy(null);
  const traceById = new Map(app.S.traces.map(t => [t.id, t]));
  const tName = tid => { const t = traceById.get(tid); return t ? `T${t.tag}${t.name ? ' "' + t.name + '"' : ''}` : 'trilha'; };
  // conflitos de trilha
  const crossings = [], junctions = [], passWarn = [], traceIssues = new Map();
  const tIssue = (tid, txt) => { if (!traceIssues.has(tid)) traceIssues.set(tid, []); traceIssues.get(tid).push(txt); };
  for (const [h, list] of traceHoles) {
    if (list.length < 2) continue;
    const c = hc(h), r = hr(h), tids = [...new Set(list.map(e => e.tid))];
    if (!list.some(e => e.vertex)) {
      crossings.push({ c, r });
      const nm = netName.get(holeKey(h));
      add('err', `${tids.map(tName).join(' e ')} se cruzam em ${hname(c, r)}. As redes ficam em curto. Desvie uma delas, use um jumper ou clique nesse furo ao desenhar se a ligação for de propósito.`, { c, r }, { tids });
      tids.forEach(t => tIssue(t, `cruza ${tids.filter(x => x !== t).map(tName).join(', ')} em ${hname(c, r)}`));
    } else if (tids.length > 1) junctions.push({ c, r });
  }
  for (const [k, list] of diag) {
    if (new Set(list.map(e => e.dir)).size < 2) continue;
    const [c, r] = k.split(',').map(Number), tids = [...new Set(list.map(e => e.tid))];
    crossings.push({ c: c + 0.5, r: r + 0.5 });
    add('err', `${tids.map(tName).join(' e ')} se cruzam em X entre ${hname(c, r)} e ${hname(c + 1, r + 1)}: a solda encosta e dá curto.`, { c, r }, { tids });
    tids.forEach(t => tIssue(t, `cruza em diagonal perto de ${hname(c, r)}`));
  }
  for (const [h, list] of traceHoles) {
    const o = occ.get(h); if (!o || list.some(e => e.vertex)) continue;
    const c = hc(h), r = hr(h), who = o.kind === 'pin' ? `${o.comp.p.name}.${o.pin.name}` : 'uma ponta de fio';
    passWarn.push({ c, r });
    add('warn', `${tName(list[0].tid)} atravessa ${who} (${hname(c, r)}) sem terminar nele, então ele fica ligado a essa trilha. Se for de propósito, clique nesse furo ao desenhar.`, { c, r }, { tids: [list[0].tid] });
    tIssue(list[0].tid, `atravessa ${who}`);
  }
  // trilhas vizinhas de redes diferentes (risco de ponte de solda)
  {
    const pairs = new Map();
    for (const [h, list] of traceHoles) {
      const c = hc(h), r = hr(h);
      for (const [dc, dr] of [[1, 0], [0, 1]]) {
        if (!inBoard(c + dc, r + dr)) continue; const h2 = hk(c + dc, r + dr); const l2 = traceHoles.get(h2); if (!l2) continue;
        if (holeRoot[h] === holeRoot[h2]) continue;
        const a = list[0].tid, b = l2[0].tid, pk = a < b ? a + ':' + b : b + ':' + a;
        if (!pairs.has(pk)) pairs.set(pk, { n: 0, c, r, a, b }); pairs.get(pk).n++;
      }
    }
    for (const p of pairs.values()) if (p.n >= 3) { add('info', `${tName(p.a)} e ${tName(p.b)} correm lado a lado por ${p.n} furos (perto de ${hname(p.c, p.r)}) e são de redes diferentes. Solde com cuidado para não fazer ponte.`, { c: p.c, r: p.r }, { tids: [p.a, p.b] }); tIssue(p.a, `vizinha de ${tName(p.b)}`); tIssue(p.b, `vizinha de ${tName(p.a)}`); }
  }
  // pinos sem ligação, curtos, flutuantes
  for (const c of app.S.comps) {
    const ks = pinNode.get(c.id), ps = pinsOf(c);
    const connector = c.type === 'header' || (c.type === 'term' && c.p.ways === 3);
    ks.forEach((k, i) => {
      const mem = nodeMembers.get(k);
      if (mem.length === 1 && inBoard(ps[i].c, ps[i].r) && (contact(ps[i].c, ps[i].r) || soldered.has(hk(ps[i].c, ps[i].r))) && !connector) add('info', `${c.p.name}.${ps[i].name} não está ligado a nenhum outro pino.`, { c: ps[i].c, r: ps[i].r });
    });
    const allSame = ks.length > 1 && ks.every(k => k === ks[0]) && ks.every((k, i) => inBoard(ps[i].c, ps[i].r) && (contact(ps[i].c, ps[i].r) || soldered.has(hk(ps[i].c, ps[i].r))));
    if (allSame && !connector) {
      const src = c.type === 'term' && (c.p.mode === 'src' || c.p.mode === 'pwm');
      add(src ? 'err' : 'warn', src ? `${c.p.name}: + e − estão na mesma rede. Curto na fonte!` : `${c.p.name} está em curto: todos os pinos caem na mesma rede${kindAt(ps[0].c, ps[0].r) === 'bread' ? ' (no protoboard, cada coluna de 5 furos é ligada por dentro)' : kindAt(ps[0].c, ps[0].r) === 'strip' ? ' (a trilha do veroboard liga os furos da linha; corte entre os pinos)' : ''}.`, { c: ps[0].c, r: ps[0].r });
    }
    if (c.type === 'bjt' || c.type === 'mos') {
      const nm = CT[c.type].names(c), pi = nm.indexOf(c.type === 'bjt' ? 'B' : 'G');
      if (pi >= 0 && nodeMembers.get(ks[pi]).length === 1) add('warn', `${c.p.name}: ${c.type === 'bjt' ? 'a base' : 'o gate'} está flutuando (sem ligação). ${c.type === 'mos' ? 'Gate solto liga sozinho com ruído: use um resistor de 10 kΩ para o source.' : ''}`, { c: ps[pi].c, r: ps[pi].r });
    }
    if (c.type === 'btn') { if (ks[0] === ks[2]) add('warn', `${c.p.name}: os dois lados do botão estão na mesma rede, então ele não faz nada. Gire o botão 90°: os pinos A1–A2 e B1–B2 já são ligados por dentro.`, { c: ps[0].c, r: ps[0].r }); }
  }
  // colisão de corpos e borda
  const boxes = app.S.comps.map(c => [c, compAABB(c)]);
  for (let i = 0; i < boxes.length; i++) {
    const [c, A] = boxes[i];
    const cb = boardAt(pinsOf(c)[0].c, pinsOf(c)[0].r);
    if (cb && c.type !== 'term') { const [bw, bh] = boardDims(cb); if (A[0] < cb.x - 1.2 || A[1] > cb.x + bw + 0.2 || A[2] < cb.y - 1.2 || A[3] > cb.y + bh + 0.2) add('info', `${c.p.name} passa da borda da placa ${cb.name}.`, { c: c.c, r: c.r }); }
    for (let j = i + 1; j < boxes.length; j++) {
      const [d, B] = boxes[j];
      if (Math.min(A[1], B[1]) - Math.max(A[0], B[0]) > 0.12 && Math.min(A[3], B[3]) - Math.max(A[2], B[2]) > 0.12) add('warn', `Os corpos de ${c.p.name} e ${d.p.name} se sobrepõem: não cabem na placa real. Afaste um deles.`, { c: c.c, r: c.r }, { comps: [c.id, d.id] });
    }
  }
  // nomes repetidos
  const nameCount = {}; for (const c of app.S.comps) nameCount[c.p.name] = (nameCount[c.p.name] || 0) + 1;
  for (const [nm, n] of Object.entries(nameCount)) if (n > 1) add('warn', `O nome ${nm} está em ${n} peças. Renomeie para não confundir na montagem.`, null);
  // esquema (ligações planejadas)
  const linkId = ep => ep.mcu ? (mcuId.has(mk(ep.mcu[0], ep.mcu[1])) ? mcuId.get(mk(ep.mcu[0], ep.mcu[1])) : null) : ep.pin ? (pinId.get(ep.pin[0]) != null ? pinId.get(ep.pin[0]) + ep.pin[1] : null) : null;
  const missing = [], extras = [];
  if (app.S.links.length) {
    const lpar = new Map(), lf = x => { while (lpar.get(x) !== x) x = lpar.get(x); return x; };
    for (const l of app.S.links) { const a = linkId(l.a), b = linkId(l.b); if (a == null || b == null) continue; if (!lpar.has(a)) lpar.set(a, a); if (!lpar.has(b)) lpar.set(b, b); const ra = lf(a), rb = lf(b); if (ra !== rb) lpar.set(ra, rb); if (find(a) !== find(b)) missing.push(l); }
    const groupsByNode = new Map();
    for (const id of lpar.keys()) { const k = key(id); if (!groupsByNode.has(k)) groupsByNode.set(k, new Map()); groupsByNode.get(k).set(lf(id), id); }
    for (const [k, g] of groupsByNode) if (g.size > 1) {
      const names = [...g.values()].map(id => { const m = (nodeMembers.get(k) || []).find(mm => (mm.mcu ? mcuId.get(mm.mcu) : pinId.get(mm.comp.id) + mm.i) === id); return m ? m.name : '?'; });
      extras.push(k); add('err', `Curto contra o esquema: ${names.join(' e ')} estão ligados na placa, mas pertencem a ligações diferentes do esquema.`, null);
    }
    missing.forEach(l => { const p = l.a.pin ? (() => { const c = compById(l.a.pin[0]); const pp = pinsOf(c)[l.a.pin[1]]; return { c: pp.c, r: pp.r }; })() : null; add('warn', `Falta ligar ${epName(l.a)} com ${epName(l.b)} (linha tracejada amarela).`, p); });
  }
  // cargas indutivas e diodo de proteção
  const inductive = [];
  const pinRole = (k) => (nodeMembers.get(k) || []).map(m => { if (m.mcu) { const cf = mcuCfg(...mkSplit(m.mcu)); return (cf.mode === 'out' || cf.mode === 'pwm') ? 'mcu' : null; } const c = m.comp; if (c.type === 'bjt' && BJT[c.p.model].pol > 0 && CT.bjt.names(c)[m.i] === 'C') return 'drv'; if (c.type === 'mos' && CT.mos.names(c)[m.i] === 'D') return 'drv'; if (c.type === 'bjt' && BJT[c.p.model].pol < 0 && CT.bjt.names(c)[m.i] === 'C') return 'drv'; return null; }).filter(Boolean);
  for (const c of app.S.comps) {
    let pair = CT[c.type].inductive;
    if (c.type === 'term' && c.p.ways === 2 && c.p.mode === 'load' && c.p.kind === 'ind') pair = [0, 1];
    if (!pair) continue;
    const ks = pinNode.get(c.id), k1 = ks[pair[0]], k2 = ks[pair[1]];
    if (k1 === k2) continue;
    const diodes = app.S.comps.filter(d => d.type === 'diode').filter(d => { const dk = pinNode.get(d.id); return (dk[0] === k1 && dk[1] === k2) || (dk[0] === k2 && dk[1] === k1); });
    const roles = pinRole(k1).concat(pinRole(k2));
    inductive.push({ comp: c, k1, k2, diodes: diodes.map(d => d.id) });
    const at = { c: pinsOf(c)[pair[0]].c, r: pinsOf(c)[pair[0]].r };
    if (roles.includes('mcu')) add('err', `${c.p.name} (carga indutiva) está ligado direto num pino do microcontrolador. O pino não aguenta: use um transistor ou MOSFET e um diodo de proteção.`, at);
    else if (roles.includes('drv') && !diodes.length) add('warn', `${c.p.name} é uma carga indutiva chaveada sem diodo de proteção. Ao desligar, o pico de tensão pode queimar o transistor: coloque um 1N4007 em paralelo, com a faixa (cátodo) no lado positivo.`, at);
  }
  // microcontroladores: checagens estáticas
  const srcs = app.S.comps.filter(c => c.type === 'term' && c.p.ways === 2 && (c.p.mode === 'src' || c.p.mode === 'pwm') && c.p.on);
  for (const mo of app.S.mcus) {
    const mcu = MCU[mo.type], used = [...mcuUsed].filter(k => mkSplit(k)[0] === mo.id);
    if (!used.length) continue;
    const gndK = mcuNode.get(mk(mo.id, mcu.pins.find(p => isGnd(p.n)).id));
    const sigUsed = used.some(k => mcuCaps(mcu, mcu.pin[mkSplit(k)[1]]).io);
    if (sigUsed && srcs.length && !srcs.some(s => pinNode.get(s.id)[1] === gndK)) add('warn', `O GND do ${mo.name} não está ligado ao − da fonte externa. Sem terra comum, os sinais não têm referência e o circuito não funciona.`, null, { mcu: mo.id });
    for (const s of srcs) {
      const pk = pinNode.get(s.id)[0];
      for (const nm of Object.keys(mcu.supplies)) { const id = mcu.pins.find(p => p.n === nm).id; if (mcuNode.get(mk(mo.id, id)) === pk && nm !== 'VIN') add('err', `${s.p.name} (${s.p.v} V) está ligado no pino ${nm} do ${mo.name}. Duas fontes no mesmo ponto: alimente pelo VIN ou pelo USB.`, null, { mcu: mo.id }); }
      const vin = mcu.pins.find(p => p.n === 'VIN');
      if (vin && mcuNode.get(mk(mo.id, vin.id)) === pk) { const v = +s.p.v; if (mo.type === 'esp32') { if (v > 6) add('err', `O VIN do ${mo.name} recebe ${v} V. O ESP32 aceita até ~6 V (5 V do USB).`, null, { mcu: mo.id }); } else if (v < 7) add('warn', `O VIN do ${mo.name} recebe ${v} V: abaixo de 7 V o regulador interno não entrega 5 V estáveis.`, null, { mcu: mo.id }); else if (v > 12) add(v > 20 ? 'err' : 'warn', `O VIN do ${mo.name} recebe ${v} V: acima de 12 V o regulador interno esquenta muito.`, null, { mcu: mo.id }); }
    }
  }
  // placas sobrepostas
  for (let i = 0; i < app.S.boards.length; i++) for (let j = i + 1; j < app.S.boards.length; j++) if (rectsOverlap(boardRect(app.S.boards[i]), boardRect(app.S.boards[j]))) add('warn', `As placas ${app.S.boards[i].name} e ${app.S.boards[j].name} estão sobrepostas. Arraste uma delas pela borda.`, null);
  return { soldered, holeRoot, holeKey, pinNode, mcuNode, mcuUsed, nodeMembers, netName, netIdx, issues, crossings, junctions, passWarn, unsoldered, covers, traceHoles, diag, traceIssues, missing, inductive, occ, cuts };
}

export function rectsOverlap(A, B) { return Math.min(A[1], B[1]) - Math.max(A[0], B[0]) > 0.05 && Math.min(A[3], B[3]) - Math.max(A[2], B[2]) > 0.05; }
export function mcuRect(mo) { const m = MCU[mo.type]; return [mo.x, mo.x + m.wp, mo.y, mo.y + m.hp]; }

export function objectFree(rect, exBoard, exMcu) {
  for (const b of app.S.boards) if (b.id !== exBoard && rectsOverlap(rect, boardRect(b))) return false;
  for (const mo of app.S.mcus) if (mo.id !== exMcu && rectsOverlap(rect, mcuRect(mo))) return false;
  return rect[0] >= 0.2 && rect[2] >= 0.2;
}

export function netColor(k) {
  const nm = (app.AN.netName.get(k) || '').toUpperCase();
  if (/GND|TERRA|^0V/.test(nm)) return '#3a3d42';
  if (/VCC|VDD|^\+|5V|12V|3V3|9V|VIN/.test(nm)) return '#e0533c';
  const i = app.AN.netIdx.get(k); return NETPAL[(i == null ? 0 : i) % NETPAL.length];
}

export function traceColor(t) {
  if (t.color && TRACECOL[t.color]) return TRACECOL[t.color];
  if (app.netColors) { const cov = app.AN.covers.get(t.id); if (cov && cov.length) return netColor(app.AN.holeKey(hk(cov[0].c, cov[0].r))); }
  return null;
}

export function traceNetKey(t) { const cov = app.AN.covers.get(t.id); return cov && cov.length ? app.AN.holeKey(hk(cov[0].c, cov[0].r)) : null; }

export function traceConnects(t) {
  const cov = app.AN.covers.get(t.id) || [], out = [];
  for (const e of cov) { const o = app.AN.occ.get(hk(e.c, e.r)); if (o) out.push(o.kind === 'pin' ? `${o.comp.p.name}.${o.pin.name}` : 'fio'); }
  return [...new Set(out)];
}
