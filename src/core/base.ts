// @ts-nocheck
import { app } from '../state';

// ════════════════════════ Constantes e utilidades ════════════════════════
// Tudo vive numa grade "mundo" em passos de 2,54 mm. Placas e microcontroladores são objetos posicionados nela.
export const P = 26, OX = 26, OY = 26, BM = 1.6;

export const $ = id => document.getElementById(id);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[ch]));
export const LET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const colName = c => c < 26 ? LET[c] : LET[Math.floor(c / 26) - 1] + LET[c % 26];
export const hk = (c, r) => r * app.COLS + c;
export const hc = h => h % app.COLS, hr = h => Math.floor(h / app.COLS);
export const clone = o => JSON.parse(JSON.stringify(o));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ════════════════════════ Placas ════════════════════════
export const SIZES = [['2x8','2×8 cm',8,28],['3x7','3×7 cm',10,24],['4x6','4×6 cm',14,20],['5x7','5×7 cm',18,24],['7x9','7×9 cm',24,30],['9x15','9×15 cm',34,53]];

export const BREADS = { 830:{ cols:63, rows:17, rails:true, label:'Protoboard 830 furos' }, 400:{ cols:30, rows:17, rails:true, label:'Protoboard 400 furos' }, 170:{ cols:17, rows:11, rails:false, label:'Mini protoboard 170' } };
export const KINDS = { perf:'Perfurada (ilhas)', strip:'Veroboard (trilhas)', bread:'Protoboard' };
export const BPREFIX = { perf:'P', strip:'V', bread:'PB' };
export function boardDefault() { return { kind:'perf', size:'7x9', cols:24, rows:30, sides:2, labels:'num' }; }
export function boardDims(b) { return b.kind === 'bread' ? [BREADS[b.size].cols, BREADS[b.size].rows] : [b.cols, b.rows]; }

export function boardLabel(b) {
  if (b.kind === 'bread') return BREADS[b.size].label;
  const s = SIZES.find(x => x[0] === b.size);
  return `${b.kind === 'strip' ? 'Veroboard' : (b.sides === 1 ? 'Perfurada face simples' : 'Perfurada dupla face')} ${s ? s[1] : b.cols + '×' + b.rows + ' furos'}`;
}

export function boardAt(c, r) { for (const b of app.S.boards) { const [w, h] = boardDims(b); if (c >= b.x && c < b.x + w && r >= b.y && r < b.y + h) return b; } return null; }
export function boardBody(b) { const [w, h] = boardDims(b); return [b.x - BM, b.x + w - 1 + BM, b.y - BM, b.y + h - 1 + BM]; }
export function boardRect(b) { const R = boardBody(b); R[2] -= 1; return R; }   // inclui a etiqueta com o nome acima da placa
export function boardRectAt(x, y) { for (let i = app.S.boards.length - 1; i >= 0; i--) { const b = app.S.boards[i], R = boardRect(b); if (x >= R[0] && x <= R[1] && y >= R[2] && y <= R[3]) return b; } return null; }
export const inBoard = (c, r) => !!boardAt(c, r);
export const kindAt = (c, r) => { const b = boardAt(c, r); return b ? b.kind : null; };
export const hasKind = k => app.S.boards.some(b => b.kind === k);

export function breadRow(b, r) {
  const B = BREADS[b.size];
  if (!B.rails) { if (r < 5) return { t:'m', half:0, top:0, letter:'abcde'[r] }; if (r === 5) return { t:'g' }; return { t:'m', half:1, top:6, letter:'fghij'[r - 6] }; }
  if (r === 0) return { t:'rail', sign:'+' }; if (r === 1) return { t:'rail', sign:'−' };
  if (r === 2 || r === 8 || r === 14) return { t:'g' };
  if (r < 8) return { t:'m', half:0, top:3, letter:'abcde'[r - 3] };
  if (r < 14) return { t:'m', half:1, top:9, letter:'fghij'[r - 9] };
  return { t:'rail', sign: r === 15 ? '+' : '−' };
}

export function holeExists(c, r) {
  if (!Number.isInteger(c) || !Number.isInteger(r)) return false;
  const b = boardAt(c, r); if (!b) return false;
  if (b.kind !== 'bread') return true;
  const br = breadRow(b, r - b.y);
  if (br.t === 'g') return false;
  if (br.t === 'rail') return (c - b.x) % 6 !== 5;
  return true;
}

export function rowLabel(b, r) { return b.labels === 'let' ? LET[r % 26] + (r >= 26 ? '²' : '') : String(r + 1); }

export function hname(c, r) {
  const b = boardAt(c, r); if (!b) return '?';
  const lc = c - b.x, lr = r - b.y, pre = app.S.boards.length > 1 ? b.name + '·' : '';
  if (b.kind === 'bread') { const br = breadRow(b, lr); return pre + (br.t === 'rail' ? `${br.sign}${lc + 1}` : br.t === 'm' ? `${br.letter}${lc + 1}` : '?'); }
  return pre + (b.labels === 'let' ? `${colName(lc)}·${rowLabel(b, lr)}` : `${colName(lc)}${lr + 1}`);
}

export function nextBoardName(kind) { const pre = BPREFIX[kind]; let m = 0; for (const b of app.S.boards) { const x = new RegExp('^' + pre + '(\\d+)$').exec(b.name || ''); if (x) m = Math.max(m, +x[1]); } return pre + (m + 1); }
export const toView = (x, y) => [OX + (app.view === 'bottom' ? (app.COLS - 1 - x) : x) * P, OY + y * P];
export const fromView = (px, py) => { let x = (px - OX) / P; if (app.view === 'bottom') x = app.COLS - 1 - x; return [x, (py - OY) / P]; };

// ════════════════════════ Modelos de peças ════════════════════════
export const BJT = {
  '2N2222': { pol:1, rb:10, pinout:'EBC', bf:200, br:6, Is:1.4e-14, icmax:0.6, pmax:0.625, vceo:40, pkg:'TO92', desc:'NPN uso geral, 600 mA' },
  'BC547':  { pol:1, rb:20, pinout:'CBE', bf:300, br:8, Is:1.8e-14, icmax:0.1, pmax:0.5, vceo:45, pkg:'TO92', desc:'NPN de sinal, 100 mA' },
  'BC337':  { pol:1, rb:10, pinout:'CBE', bf:250, br:10, Is:4e-14, icmax:0.8, pmax:0.625, vceo:45, pkg:'TO92', desc:'NPN, 800 mA' },
  '2N2907': { pol:-1, rb:10, pinout:'EBC', bf:200, br:6, Is:2e-14, icmax:0.6, pmax:0.625, vceo:60, pkg:'TO92', desc:'PNP uso geral, 600 mA' },
  'BC557':  { pol:-1, rb:20, pinout:'CBE', bf:300, br:8, Is:2e-14, icmax:0.1, pmax:0.5, vceo:45, pkg:'TO92', desc:'PNP de sinal, 100 mA' },
  'TIP120': { pol:1, rb:5, pinout:'BCE', bf:40, br:4, Is:1e-13, icmax:5, pmax:2, vceo:60, pkg:'TO220', dar:true, desc:'Darlington NPN, 5 A' },
};

export const MOS = {
  'IRLZ44N': { vth:1.5, K:13, lam:0.01, idmax:47, pfree:1.8, vgsmax:16, vdsmax:55, logic:true, pinout:'GDS', pkg:'TO220', desc:'MOSFET N nível lógico, 47 A' },
  'IRFZ44N': { vth:3.0, K:8, lam:0.01, idmax:49, pfree:1.8, vgsmax:20, vdsmax:55, logic:false, pinout:'GDS', pkg:'TO220', desc:'MOSFET N, precisa de 10 V no gate' },
  '2N7000':  { vth:2.1, K:0.083, lam:0.02, idmax:0.2, pfree:0.4, vgsmax:20, vdsmax:60, logic:true, pinout:'SGD', pkg:'TO92', desc:'MOSFET N de sinal, 200 mA' },
};

export const DIO = {
  '1N4007':  { Is:7e-9, n:1.8, rs:0.04, imax:1, vr:1000, look:'black', span:4, desc:'Retificador 1 A' },
  '1N4148':  { Is:2.5e-9, n:1.75, rs:0.6, imax:0.3, vr:100, look:'glass', span:3, desc:'Sinal rápido 300 mA' },
  '1N5819':  { Is:1e-5, n:1.6, rs:0.05, imax:1, vr:40, look:'black', span:4, desc:'Schottky 1 A' },
  '1N4733A': { Is:1e-9, n:1.5, rs:5, bv:5.1, ibv:0.049, nb:1.5, pmax:1, imax:0.178, vr:1e9, look:'glass', span:4, desc:'Zener 5,1 V · 1 W', zener:true },
};

export const LEDVF = { red:1.9, yellow:2.0, green:2.1, blue:3.0, white:3.0 };
export const LEDCOL = { red:'#ff3b2f', yellow:'#ffd21f', green:'#39e26b', blue:'#3d8bff', white:'#f4f7ff' };
export const LEDNAME = { red:'vermelho', yellow:'amarelo', green:'verde', blue:'azul', white:'branco' };

export const REG = {
  '7805':       { vnom:5, drop:2, iq:0.005, imax:1.5, vinmax:35, pins:['IN','GND','OUT'], desc:'Regulador 5 V · 1,5 A' },
  'LM1117-3.3': { vnom:3.3, drop:1.2, iq:0.005, imax:0.8, vinmax:15, pins:['GND','OUT','IN'], desc:'Regulador 3,3 V · 800 mA' },
};

export const CAPS = {
  '22p':   { val:22e-12, v:50, kind:'c', label:'22 pF', code:'22' },
  '100n':  { val:100e-9, v:50, kind:'c', label:'100 nF', code:'104' },
  '1u':    { val:1e-6, v:50, kind:'c', label:'1 µF', code:'105' },
  '10u':   { val:10e-6, v:25, kind:'e', r:0.9, span:1, label:'10 µF 25 V' },
  '100u':  { val:100e-6, v:16, kind:'e', r:1.25, span:1, label:'100 µF 16 V' },
  '470u':  { val:470e-6, v:16, kind:'e', r:1.6, span:2, label:'470 µF 16 V' },
  '1000u': { val:1e-3, v:16, kind:'e', r:2.0, span:2, label:'1000 µF 16 V' },
};

export const PINFULL = { E:'emissor', B:'base', C:'coletor', A:'ânodo (+)', K:'cátodo (−)', G:'gate', D:'dreno', S:'source', IN:'entrada', OUT:'saída', GND:'terra', W:'cursor', COM:'comum', NO:'normalmente aberto', NC:'normalmente fechado', B1:'bobina', B2:'bobina', '+':'positivo', '−':'negativo' };
export const WIRECOL = { vermelho:'#d8342a', preto:'#26272a', amarelo:'#e8c21a', azul:'#2a62d8', verde:'#2c9b4a', branco:'#eeeeee', laranja:'#ee7d1c', roxo:'#8a47c9', cinza:'#8d9196', marrom:'#7b4a26' };
export const TRACECOL = { solda:null, vermelho:'#e0533c', azul:'#3f86e0', verde:'#34b06b', amarelo:'#e3b21c', laranja:'#ee8a2a', roxo:'#9a62d6', rosa:'#e0689a', ciano:'#23aebd', preto:'#3a3d42' };
export const NETPAL = ['#e0533c','#3f86e0','#e3b21c','#34b06b','#9a62d6','#e0689a','#23aebd','#b07a3c','#7fa33a','#c04a7a','#5b6bd6','#d0782a'];
export const TERMCOL = { azul:['#2566c7','#163f7d'], verde:['#2f9a52','#1d5f33'], preto:['#2b2d31','#111214'] };
export const CAPCOL = { preto:'#27292d', vermelho:'#c9322a', azul:'#2d5fc4', amarelo:'#e6c01d', verde:'#2f9a52', branco:'#e9e9e6' };

// ════════════════════════ Formatação ════════════════════════
export const f1 = n => Math.round(n * 10) / 10;

export function fmtR(v) { v = +v; if (v >= 1e6) return (+(v / 1e6).toPrecision(3)) + 'MΩ'; if (v >= 1e3) return (+(v / 1e3).toPrecision(3)) + 'kΩ'; return (+v.toPrecision(3)) + 'Ω'; }

export function fmtU(v, u) {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a < 1e-9) return '0 ' + u;
  if (a >= 1000) return (v / 1000).toFixed(2) + ' k' + u;
  if (a >= 1) return v.toFixed(a >= 10 ? 1 : 2) + ' ' + u;
  if (a >= 1e-3) return (v * 1e3).toFixed(a >= 0.01 ? 1 : 2) + ' m' + u;
  if (a >= 1e-6) return (v * 1e6).toFixed(1) + ' µ' + u;
  return (v * 1e9).toFixed(1) + ' n' + u;
}

export const wattName = w => ({ 0.125:'1/8 W', 0.25:'1/4 W', 0.5:'1/2 W', 1:'1 W', 2:'2 W' }[w] || w + ' W');
export const BANDC = ['#111','#7a4a1d','#d22','#f07b16','#f5d20c','#1f9a3a','#2458d6','#8a3fc4','#8b8b8b','#f4f4f4'];

export function bands(val) {
  let e = Math.floor(Math.log10(val)) - 1, d = Math.round(val / Math.pow(10, e));
  if (d >= 100) { d = Math.round(d / 10); e++; }
  const mult = e >= 0 ? (BANDC[e] || '#fff') : (e === -1 ? '#c9a13a' : '#c0c0c0');
  return [BANDC[Math.floor(d / 10)], BANDC[d % 10], mult, '#c9a13a'];
}

export const RVALS = [10, 22, 47, 100, 150, 220, 330, 470, 680, 1000, 1500, 2200, 3300, 4700, 6800, 10000, 15000, 22000, 47000, 100000, 220000, 470000, 1000000];

// ════════════════════════ Desenho SVG: primitivas ════════════════════════
export const n1 = v => v.toFixed(1);

export function poly(pts) { return pts.map(p => n1(p[0]) + ',' + n1(p[1])).join(' '); }
export function line(a, b, stroke, w, extra = '') { return `<line x1="${n1(a[0])}" y1="${n1(a[1])}" x2="${n1(b[0])}" y2="${n1(b[1])}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" ${extra}/>`; }
export function circ(p, r, fill, extra = '') { return `<circle cx="${n1(p[0])}" cy="${n1(p[1])}" r="${n1(r)}" fill="${fill}" ${extra}/>`; }
export function txt(p, t, size, fill, extra = '') { return `<text x="${n1(p[0])}" y="${n1(p[1])}" font-size="${size}" fill="${fill}" text-anchor="middle" dominant-baseline="central" font-family="Barlow,system-ui,sans-serif" font-weight="600" ${extra}>${esc(t)}</text>`; }
export function rotv(x, y, rot) { switch (rot & 3) { case 0: return [x, y]; case 1: return [-y, x]; case 2: return [-x, -y]; default: return [y, -x]; } }
export function bp(c, a, b) { const u = rotv(1, 0, c.rot), v = rotv(0, 1, c.rot); return [c.c + u[0] * a + v[0] * b, c.r + u[1] * a + v[1] * b]; }
export function vp(c, a, b) { const [x, y] = bp(c, a, b); return toView(x, y); }
export function toLocal(c, x, y) { const u = rotv(1, 0, c.rot), v = rotv(0, 1, c.rot); const dx = x - c.c, dy = y - c.r; return [dx * u[0] + dy * u[1], dx * v[0] + dy * v[1]]; }
export function boxPoly(c, a1, a2, b1, b2) { return poly([vp(c, a1, b1), vp(c, a2, b1), vp(c, a2, b2), vp(c, a1, b2)]); }
export function circPoly(c, ca, cb, r, clipA) { const pts = []; for (let k = 0; k <= 36; k++) { const t = k / 36 * Math.PI * 2; let a = r * Math.cos(t), b = r * Math.sin(t); if (clipA != null && a > clipA) a = clipA; pts.push(vp(c, ca + a, cb + b)); } return poly(pts); }
export const LEAD = '#b8bdc3';

export function drawAxial(c, o, body, edge, bandList, span) {
  const pv = [vp(c, 0, 0), vp(c, span, 0)];
  let s = line(pv[0], pv[1], LEAD, P * 0.11);
  if (span === 1) {
    s += circ(pv[0], P * 0.42, body, `stroke="${edge}" stroke-width="1.5"`);
    return s;
  }
  const L = clamp(span - 1.1, 0.9, 2.6), a1 = span / 2 - L / 2, a2 = span / 2 + L / 2;
  s += line(vp(c, a1, 0), vp(c, a2, 0), edge, P * 0.66);
  s += line(vp(c, a1, 0), vp(c, a2, 0), body, P * 0.54);
  for (const [pos, col, w] of bandList) { const a = a1 + L * pos; s += line(vp(c, a, -0.26), vp(c, a, 0.26), col, P * (w || 0.12), 'stroke-linecap="butt"'); }
  return s;
}

export function drawTO92(c, o, label, names) {
  const pts = [vp(c, -0.25, 0.42), vp(c, 2.25, 0.42)];
  for (let k = 0; k <= 24; k++) { const t = k / 24 * Math.PI; pts.push(vp(c, 1 + 1.25 * Math.cos(t), 0.42 - 1.35 * Math.sin(t))); }
  let s = `<polygon points="${poly(pts)}" fill="#26282c" stroke="#0d0e10" stroke-width="1.5"/>`;
  for (let i = 0; i < 3; i++) s += circ(vp(c, i, 0), P * 0.12, LEAD);
  if (!o.thumb) { s += txt(vp(c, 1, -0.4), label, 7, '#d9dde2'); names.forEach((n, i) => { s += txt(vp(c, i, 0.8), n, 8, '#e9f5ec'); }); }
  return s;
}

export function drawTO220(c, o, label, names) {
  let s = `<polygon points="${boxPoly(c, -0.95, 2.95, -2.1, -0.95)}" fill="#c3c8ce" stroke="#80868d" stroke-width="1"/>`;
  s += circ(vp(c, 1, -1.55), P * 0.28, '#5a5f66');
  s += `<polygon points="${boxPoly(c, -0.95, 2.95, -1.0, 0.35)}" fill="#1f2124" stroke="#0b0c0d" stroke-width="1.5"/>`;
  for (let i = 0; i < 3; i++) s += circ(vp(c, i, 0), P * 0.13, LEAD);
  if (!o.thumb) { s += txt(vp(c, 1, -0.5), label, 7, '#d9dde2'); names.forEach((n, i) => { s += txt(vp(c, i, 0.75), n, 8, '#e9f5ec'); }); }
  return s;
}
