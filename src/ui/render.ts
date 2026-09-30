// @ts-nocheck
import { app } from '../state';
import { $, BREADS, OX, OY, P, WIRECOL, boardAt, boardBody, boardDims, boardLabel, boardRect, boxPoly, breadRow, circ, colName, esc, hc, hk, holeExists, hr, inBoard, kindAt, line, n1, rowLabel, toView, txt, vp } from '../core/base';
import { CT, LIBMAP } from '../parts/catalog';
import { MCU, compById, epPos, isGnd, isSupply, makeComp, mcuById, mcuCaps, mcuCfg, mcuPinPos, mcuRect, mk, netColor, objectFree, overlapsBody, pinsOf, traceColor, validComp } from '../core/analysis';
import { buildSteps } from './panels';
import { ghostObject, nextWireColor, pastePreview } from './interaction';
import { RT } from '../code/arduino';

// ════════════════════════ Dimensões e desenho da bancada ════════════════════════
export const svg = $('board');

export function setDims() {
  let mx = 30, my = 22;
  for (const b of app.S.boards) { const R = boardRect(b); mx = Math.max(mx, R[1]); my = Math.max(my, R[3]); }
  for (const mo of app.S.mcus) { const R = mcuRect(mo); mx = Math.max(mx, R[1]); my = Math.max(my, R[3]); }
  app.COLS = Math.ceil(mx) + 18; app.ROWS = Math.ceil(my) + 12;
  app.W = OX * 2 + (app.COLS - 1) * P; app.H = OY * 2 + (app.ROWS - 1) * P;
  if (!svg) return; // testes sem DOM
  svg.setAttribute('viewBox', `0 0 ${app.W} ${app.H}`);
  svg.style.width = (app.W * app.zoom) + 'px'; svg.style.height = (app.H * app.zoom) + 'px';
}

export function setupSvg() {
  svg.innerHTML = `<defs>
    <radialGradient id="gSolder" cx="38%" cy="35%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#cfd3d8"/><stop offset="1" stop-color="#7b818a"/></radialGradient>
    <linearGradient id="gGreen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#227442"/><stop offset="1" stop-color="#1a5e35"/></linearGradient>
    <linearGradient id="gBrown" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c79a5c"/><stop offset="1" stop-color="#b3864a"/></linearGradient>
    <filter id="fGlow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="6"/></filter>
  </defs><g id="gBoardL"></g><g id="gItems"></g><g id="gOver"></g>`;
}

export function rectView(R) { const a = toView(R[0], R[2]), b = toView(R[1], R[3]); return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])]; }
export const lab = (p, t, col, anchor) => `<text x="${n1(p[0])}" y="${n1(p[1] + 3)}" font-size="9" fill="${col}" text-anchor="${anchor || 'middle'}" font-family="JetBrains Mono,monospace">${t}</text>`;

export function boardSvg(b) {
  const bottom = app.view === 'bottom', [w, h] = boardDims(b), L = (c, r) => toView(b.x + c, b.y + r);
  const [rx, ry, rw, rh] = rectView(boardBody(b));
  let s = `<g data-board="${b.id}">`;
  s += `<text x="${n1(rx + 4)}" y="${n1(ry - 8)}" font-size="11" style="fill:var(--ink)" font-family="Barlow,system-ui,sans-serif" font-weight="600">${esc(b.name)} <tspan style="fill:var(--muted)" font-weight="500">· ${esc(boardLabel(b))}</tspan></text>`;
  if (b.kind === 'bread') {
    s += `<rect x="${n1(rx)}" y="${n1(ry)}" width="${n1(rw)}" height="${n1(rh)}" rx="8" fill="#f1efe8" stroke="#c9c5b8" stroke-width="2"/>`;
    const B = BREADS[b.size];
    for (let r = 0; r < h; r++) {
      const br = breadRow(b, r), y = L(0, r)[1];
      if (br.t === 'rail') { const col = br.sign === '+' ? '#d23b2f' : '#2d5fc4', off = (br.sign === '+') === (r < 8) ? -P * 0.5 : P * 0.5; s += `<line x1="${n1(rx + 14)}" y1="${n1(y + off)}" x2="${n1(rx + rw - 14)}" y2="${n1(y + off)}" stroke="${col}" stroke-width="2"/>`; s += lab([rx + 12, y], br.sign, col) + lab([rx + rw - 12, y], br.sign, col); }
      if (br.t === 'm') s += lab([rx + 12, y], br.letter, '#6b675c') + lab([rx + rw - 12, y], br.letter, '#6b675c');
      if (br.t === 'g' && (!B.rails || r === 8)) s += `<rect x="${n1(rx + 18)}" y="${n1(y - 5)}" width="${n1(rw - 36)}" height="10" fill="#dcd8cc"/>`;
    }
    for (let c = 0; c < w; c++) if ((c + 1) % 5 === 0 || c === 0) { const x = L(c, 0)[0]; s += lab([x, ry + 12], c + 1, '#6b675c') + lab([x, ry + rh - 14], c + 1, '#6b675c'); }
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (holeExists(b.x + c, b.y + r)) { const [x, y] = L(c, r); s += `<rect x="${n1(x - 4.5)}" y="${n1(y - 4.5)}" width="9" height="9" rx="1.5" fill="#2e2d2a"/>`; }
    return s + '</g>';
  }
  const green = b.kind === 'perf' && b.sides === 2, silk = green ? '#bfe2cb' : '#5a3d1a';
  s += `<rect x="${n1(rx)}" y="${n1(ry)}" width="${n1(rw)}" height="${n1(rh)}" rx="7" fill="url(#${green ? 'gGreen' : 'gBrown'})" stroke="${green ? '#12482a' : '#8a6331'}" stroke-width="2"/>`;
  for (const [x, y] of [[rx + 13, ry + 13], [rx + rw - 13, ry + 13], [rx + 13, ry + rh - 13], [rx + rw - 13, ry + rh - 13]]) s += `<circle cx="${n1(x)}" cy="${n1(y)}" r="7" fill="${green ? '#d3b56c' : '#b87b40'}"/><circle cx="${n1(x)}" cy="${n1(y)}" r="4.2" fill="#2a2219"/>`;
  for (let c = 0; c < w; c++) {
    const x = L(c, 0)[0];
    if (green && c > 0 && c < w - 1) s += `<rect x="${n1(x - P * 0.24)}" y="${n1(ry + 5)}" width="${n1(P * 0.48)}" height="12" rx="2" fill="#c3c8ce"/><rect x="${n1(x - P * 0.24)}" y="${n1(ry + rh - 17)}" width="${n1(P * 0.48)}" height="12" rx="2" fill="#c3c8ce"/>`;
    s += lab([x, ry + 22], colName(c), silk) + lab([x, ry + rh - 28], colName(c), silk);
  }
  for (let r = 0; r < h; r++) { const y = L(0, r)[1]; s += lab([rx + 16, y], rowLabel(b, r), silk) + lab([rx + rw - 16, y], rowLabel(b, r), silk); }
  if (b.kind === 'strip' && bottom) {
    for (let r = 0; r < h; r++) { const a = L(0, r), z = L(w - 1, r), x0 = Math.min(a[0], z[0]); s += `<rect x="${n1(x0 - P * 0.45)}" y="${n1(a[1] - P * 0.38)}" width="${n1((w - 1) * P + P * 0.9)}" height="${n1(P * 0.76)}" rx="3" fill="#c9874a"/>`; }
    const cuts = new Set(app.S.cuts.map(([c, r]) => c + ',' + r));
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) { const p = L(c, r); s += cuts.has((b.x + c) + ',' + (b.y + r)) ? circ(p, P * 0.4, '#b3864a', 'stroke="#6d4a20" stroke-width="1"') + circ(p, P * 0.15, '#241d14') : circ(p, P * 0.15, '#241d14'); }
    return s + '</g>';
  }
  const copper = green || bottom;
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) { const p = L(c, r); if (copper) s += circ(p, P * 0.36, green ? '#c9994a' : '#c9874a'); s += circ(p, P * 0.155, '#241d14'); }
  return s + '</g>';
}

export function renderBoard() { $('gBoardL').innerHTML = app.S.boards.map(boardSvg).join(''); }

export function drawComp(c, o = {}) {
  const t = CT[c.type], p0 = pinsOf(c)[0], onBread = kindAt(p0.c, p0.r) === 'bread';
  let s = `<g opacity="${o.faint ? 0.16 : o.ghost ? 0.62 : o.dim ? 0.35 : 1}">` + t.draw(c, o, o.res);
  if (!o.faint && !o.thumb && t.tagAt) { const [a, b] = t.tagAt(c); const hot = o.res && o.hot; s += txt(vp(c, a, b), t.tag(c), 9, hot ? '#ffb4a8' : (onBread ? '#2a2a2a' : '#eef7f0'), onBread ? '' : 'paint-order="stroke" stroke="rgba(0,0,0,.35)" stroke-width="2"'); }
  s += '</g>';
  if (o.invalid) for (const p of pinsOf(c)) s += circ(toView(p.c, p.r), P * 0.42, 'none', 'stroke="#ff4d3d" stroke-width="2.5"');
  else if (o.overlap) { const [a1, a2, b1, b2] = t.box(c); s += `<polygon points="${boxPoly(c, a1, a2, b1, b2)}" fill="none" stroke="#ffb020" stroke-width="2" stroke-dasharray="4 3"/>`; }
  return s;
}

export function traceD(t) { return 'M' + t.pts.map(p => toView(p[0], p[1]).map(n1).join(' ')).join(' L'); }

export function traceSvg(t, faint) {
  const d = traceD(t), col = traceColor(t);
  if (faint) return `<path d="${d}" fill="none" stroke="${col || '#dfe3e8'}" stroke-width="${P * 0.4}" stroke-linecap="round" stroke-linejoin="round" opacity="${col ? 0.55 : 0.33}"/>`;
  if (col) return `<path d="${d}" fill="none" stroke="#6f757c" stroke-width="${P * 0.52}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${col}" stroke-width="${P * 0.4}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#fff" stroke-width="${P * 0.08}" stroke-linecap="round" stroke-linejoin="round" opacity=".45" transform="translate(-1.5,-1.5)"/>`;
  return `<path d="${d}" fill="none" stroke="#8e949c" stroke-width="${P * 0.5}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#cdd1d6" stroke-width="${P * 0.4}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#f3f5f7" stroke-width="${P * 0.1}" stroke-linecap="round" stroke-linejoin="round" opacity=".75" transform="translate(-1.5,-1.5)"/>`;
}

export function traceTagPos(t) {
  let best = 0, bi = 0;
  for (let i = 0; i < t.pts.length - 1; i++) { const d = Math.max(Math.abs(t.pts[i + 1][0] - t.pts[i][0]), Math.abs(t.pts[i + 1][1] - t.pts[i][1])); if (d > best) { best = d; bi = i; } }
  const a = t.pts[bi], b = t.pts[bi + 1] || a;
  const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  const sc = Math.sign(b[0] - a[0]), sr = Math.sign(b[1] - a[1]);
  return toView(n >= 2 ? a[0] + sc * (n / 2) : a[0], n >= 2 ? a[1] + sr * (n / 2) : a[1]);
}

export function traceTag(t, faint) {
  const [x, y] = traceTagPos(t), col = traceColor(t) || '#5d646c', label = `T${t.tag}${t.name ? ' ' + t.name : ''}`;
  const w = 8 + label.length * 5.6, bad = app.AN.traceIssues.has(t.id) && app.AN.traceIssues.get(t.id).some(s => s.startsWith('cruza'));
  return `<g opacity="${faint ? 0.7 : 1}"><rect x="${n1(x - w / 2)}" y="${n1(y - 7.5)}" width="${n1(w)}" height="15" rx="4" fill="${col}" stroke="${bad ? '#ff3b2f' : '#fff'}" stroke-width="${bad ? 2 : 1}"/><text x="${n1(x)}" y="${n1(y + 0.5)}" font-size="9.5" fill="#fff" text-anchor="middle" dominant-baseline="central" font-family="JetBrains Mono,monospace" font-weight="500">${esc(label)}</text></g>`;
}

export function wireSvg(w, faint) {
  const a = epPos(w.a), b = epPos(w.b); if (!a || !b) return '';
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  const k = Math.min(0.22 * len, 40), cx = (a[0] + b[0]) / 2 - dy / len * k, cy = (a[1] + b[1]) / 2 + dx / len * k + (w.a.mcu || w.b.mcu ? Math.min(len * 0.12, 30) : 0);
  const d = `M${n1(a[0])} ${n1(a[1])} Q${n1(cx)} ${n1(cy)} ${n1(b[0])} ${n1(b[1])}`, col = WIRECOL[w.color] || '#d8342a';
  if (faint) return `<path d="${d}" fill="none" stroke="${col}" stroke-width="${P * 0.14}" stroke-linecap="round" opacity=".28"/>`;
  let s = `<path d="${d}" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="${P * 0.3}" stroke-linecap="round" transform="translate(1.5,2.5)"/><path d="${d}" fill="none" stroke="${col}" stroke-width="${P * 0.24}" stroke-linecap="round"/>`;
  s += circ(a, P * 0.14, '#c7ccd2') + circ(b, P * 0.14, '#c7ccd2');
  if (w.name) s += txt([(a[0] + 2 * cx + b[0]) / 4, (a[1] + 2 * cy + b[1]) / 4 - 9], w.name, 9, '#fff', 'paint-order="stroke" stroke="rgba(0,0,0,.6)" stroke-width="3"');
  return s;
}

export function mcuSvg(mo, o = {}) {
  const m = MCU[mo.type], [x0, y0, w, h] = rectView(mcuRect(mo)), esp = mo.type === 'esp32';
  const running = typeof RT !== 'undefined' && RT.running && RT.mid === mo.id;
  let s = `<g opacity="${o.ghost ? 0.55 : 1}"><rect x="${n1(x0)}" y="${n1(y0)}" width="${n1(w)}" height="${n1(h)}" rx="10" fill="${m.col}" stroke="${running ? '#52c47f' : '#0b0d0f'}" stroke-width="${running ? 3 : 2}"/>`;
  s += `<rect x="${n1(x0 + w / 2 - 22)}" y="${n1(y0 - 8)}" width="44" height="26" rx="3" fill="#c3c8ce" stroke="#6c7278"/>`;
  s += `<rect x="${n1(x0 + w / 2 - 30)}" y="${n1(y0 + h / 2 - 34)}" width="60" height="${esp ? 80 : 60}" rx="4" fill="${esp ? '#b8bcc2' : '#16181b'}"/>`;
  s += txt([x0 + w / 2, y0 + 34], m.short, 15, '#fff', 'font-family="Barlow Semi Condensed,sans-serif"');
  s += txt([x0 + w / 2, y0 + h - 16], (mo.name || m.label) + (running ? ' · rodando' : ''), 10, running ? '#9ff0b7' : '#e6f0f2');
  if (!o.ghost) for (const p of m.pins) {
    const [x, y] = mcuPinPos(mo.id, p.id), kk = mk(mo.id, p.id), used = app.AN.mcuUsed.has(kk), cf = mcuCfg(mo.id, p.id), caps = mcuCaps(m, p);
    const lvl = app.SIM.ok && app.SIM.mcu.has(kk) ? app.SIM.mcu.get(kk).v > 0.6 * m.vcc : false;
    s += `<rect x="${n1(x - 7)}" y="${n1(y - 7)}" width="14" height="14" rx="2" fill="#141517"/>`;
    s += circ([x, y], 4, used ? (caps.io && (cf.mode === 'out' || cf.mode === 'pwm') && lvl ? '#6cf29a' : '#ffd166') : '#d9b45a');
    const label = p.n + (caps.io && used ? (cf.mode === 'out' ? (cf.level ? ' ▲' : ' ▼') : cf.mode === 'pwm' ? ' ∿' : cf.mode === 'pullup' ? ' ↑' : cf.mode === 'analog' ? ' ~' : '') : '');
    const right = (p.side === 1) !== (app.view === 'bottom');
    s += `<text x="${n1(right ? x - 12 : x + 12)}" y="${n1(y + 0.5)}" font-size="9.5" fill="${isGnd(p.n) ? '#bfc6cc' : isSupply(m, p.n) ? '#ffb4a0' : '#e8f3f5'}" text-anchor="${right ? 'end' : 'start'}" dominant-baseline="central" font-family="JetBrains Mono,monospace">${esc(label)}</text>`;
  }
  if (!o.ghost) { const bl = mo.type === 'esp32' ? 'G2' : 'D13', cf = mcuCfg(mo.id, bl), on = (cf.mode === 'out' && cf.level) || (cf.mode === 'pwm' && cf.duty > 0); const lp = [x0 + w / 2 + 40, y0 + 18]; if (on) s += circ(lp, 9, '#ffb347', 'opacity=".6" filter="url(#fGlow)"'); s += `<rect x="${n1(lp[0] - 5)}" y="${n1(lp[1] - 3)}" width="10" height="6" rx="1" fill="${on ? '#ffb347' : '#5a4630'}"/>` + txt([lp[0] + 11, lp[1]], 'L', 8, '#e6f0f2'); }
  return s + '</g>';
}

export function labelFlags() {
  let s = '';
  for (const lb of app.S.labels) { if (!inBoard(lb.h[0], lb.h[1]) || !lb.name) continue; const [x, y] = toView(lb.h[0], lb.h[1]); const w = 10 + lb.name.length * 6; const col = netColor(app.AN.holeKey(hk(lb.h[0], lb.h[1]))); s += `<g><line x1="${x}" y1="${y}" x2="${x + 8}" y2="${y - 14}" stroke="${col}" stroke-width="2"/><rect x="${x + 6}" y="${y - 24}" width="${w}" height="15" rx="3" fill="${col}"/><text x="${x + 6 + w / 2}" y="${y - 16}" font-size="9.5" fill="#fff" text-anchor="middle" dominant-baseline="central" font-family="JetBrains Mono,monospace" font-weight="500">${esc(lb.name)}</text></g>`; }
  return s;
}

export function renderItems() {
  const bottom = app.view === 'bottom';
  const overlapIds = new Set(); for (const i of app.AN.issues) if (i.comps) i.comps.forEach(id => overlapIds.add(id));
  const comps = app.S.comps.map(c => { const r = app.SIM.ok ? app.SIM.comp.get(c.id) : null; return drawComp(c, { faint: bottom, res: r, hot: r && r.p != null && c.type === 'res' && r.p > c.p.watt, invalid: app.drag && app.drag.kind === 'items' && app.drag.ids.has(c.id) && !validComp(c), overlap: !bottom && overlapIds.has(c.id) }); }).join('');
  const boardWires = app.S.wires.filter(w => w.a.h && w.b.h).map(w => wireSvg(w, bottom)).join('');
  const extWires = app.S.wires.filter(w => !(w.a.h && w.b.h)).map(w => wireSvg(w, false)).join('');
  let s = '';
  if (bottom) {
    s += comps + boardWires;
    s += app.S.traces.map(t => traceSvg(t, false)).join('');
    const blobs = new Set(app.S.solder.filter(([c, r]) => inBoard(c, r) && kindAt(c, r) !== 'bread').map(([c, r]) => hk(c, r)));
    for (const h of app.AN.occ.keys()) if (app.AN.soldered.has(h)) blobs.add(h);
    for (const j of app.AN.junctions) blobs.add(hk(j.c, j.r));
    for (const h of blobs) s += circ(toView(hc(h), hr(h)), P * 0.42, 'url(#gSolder)', 'stroke="#7b818a" stroke-width=".8"');
    for (const h of app.AN.occ.keys()) if (kindAt(hc(h), hr(h)) !== 'bread') s += circ(toView(hc(h), hr(h)), P * 0.12, app.AN.soldered.has(h) ? '#a8aeb5' : '#8a9097', 'stroke="#555b62" stroke-width=".8"');
    if (app.showTags) s += app.S.traces.map(t => traceTag(t, false)).join('');
  } else {
    if (app.xray) s += app.S.traces.map(t => traceSvg(t, true)).join('');
    let rings = ''; for (const h of app.AN.soldered) { const b = boardAt(hc(h), hr(h)); if (b && b.kind === 'perf' && b.sides === 2) rings += circ(toView(hc(h), hr(h)), P * 0.34, 'none', 'stroke="#e4e7ea" stroke-width="2.2" opacity=".85"'); } s += rings;
    s += boardWires + comps;
    if (app.xray && app.showTags) s += app.S.traces.map(t => traceTag(t, true)).join('');
  }
  s += labelFlags();
  s += app.S.mcus.map(mo => mcuSvg(mo)).join('');
  s += extWires;
  $('gItems').innerHTML = s;
}

export function lPath(a, b) { const dc = b[0] - a[0], dr = b[1] - a[1]; if (dc === 0 || dr === 0 || Math.abs(dc) === Math.abs(dr)) return [b]; return [[b[0], a[1]], b]; }

// Conflitos de um trecho novo de trilha (guarda ao desenhar)
export function segConflicts(a, b, ownPts) {
  const out = [], dc = b[0] - a[0], dr = b[1] - a[1], n = Math.max(Math.abs(dc), Math.abs(dr)), sc = Math.sign(dc), sr = Math.sign(dr);
  const tagOf = tid => { const t = app.S.traces.find(t => t.id === tid); return t ? 'T' + t.tag : 'trilha'; };
  for (let k = 1; k < n; k++) {
    const c = a[0] + sc * k, r = a[1] + sr * k, h = hk(c, r);
    const o = app.AN.occ.get(h); if (o) out.push({ c, r, why: `passa pelo pino ${o.kind === 'pin' ? o.comp.p.name + '.' + o.pin.name : 'de um fio'}` });
    const tl = app.AN.traceHoles.get(h); if (tl && !tl.some(e => e.vertex)) out.push({ c, r, why: `cruza ${[...new Set(tl.map(e => tagOf(e.tid)))].join(', ')}` });
    if (app.AN.cuts.has(h)) out.push({ c, r, why: 'passa por um furo cortado' });
  }
  if (dc && dr) for (let k = 0; k < n; k++) {
    const c = a[0] + sc * k, r = a[1] + sr * k, key = Math.min(c, c + sc) + ',' + Math.min(r, r + sr), dir = sc * sr > 0 ? 'b' : 's';
    const l = app.AN.diag.get(key); if (l && l.some(e => e.dir !== dir)) out.push({ c: c + sc / 2, r: r + sr / 2, why: `cruza em X ${[...new Set(l.map(e => tagOf(e.tid)))].join(', ')}` });
  }
  return out;
}

export const dash = (R, col, extra) => { const [x, y, w, h] = rectView(R); return `<rect x="${n1(x - 4)}" y="${n1(y - 4)}" width="${n1(w + 8)}" height="${n1(h + 8)}" rx="10" fill="${extra || 'none'}" stroke="${col}" stroke-width="2.5" stroke-dasharray="7 4"/>`; };
export function compBoxSvg(c, col) { const [a1, a2, b1, b2] = CT[c.type].box(c); return `<polygon points="${boxPoly(c, a1 - 0.15, a2 + 0.15, b1 - 0.15, b2 + 0.15)}" fill="none" stroke="${col}" stroke-width="2" stroke-dasharray="6 4"/>`; }

export function renderOverlay() {
  let s = '';
  if (app.hover && app.AN && !app.drag) {
    const h = hk(app.hover.c, app.hover.r), rt = app.AN.holeRoot[h];
    const mates = []; for (let i = 0; i < app.AN.holeRoot.length; i++) if (app.AN.holeRoot[i] === rt && (app.AN.soldered.has(i) || (kindAt(hc(i), hr(i)) || 'perf') !== 'perf')) mates.push(i);
    if (mates.length > 1 || app.AN.occ.has(h)) for (const hh of mates) s += circ(toView(hc(hh), hr(hh)), P * 0.46, 'none', 'stroke="#ffd166" stroke-width="2"');
  }
  if (app.hoverTrace != null) { const t = app.S.traces.find(t => t.id === app.hoverTrace); if (t) s += `<path d="${traceD(t)}" fill="none" stroke="#ffd166" stroke-width="${P * 0.62}" stroke-linecap="round" stroke-linejoin="round" opacity=".5"/>`; }
  for (const w of app.AN.passWarn) s += circ(toView(w.c, w.r), P * 0.55, 'none', 'stroke="#ffb020" stroke-width="2.5" stroke-dasharray="4 3"');
  for (const u of app.AN.unsoldered) s += circ(toView(u.c, u.r), P * 0.5, 'none', 'stroke="#ffb020" stroke-width="1.8" stroke-dasharray="2 3"');
  for (const k of app.AN.crossings) { const [x, y] = toView(k.c, k.r), d = P * 0.32; s += circ([x, y], P * 0.6, 'rgba(255,60,40,.25)', 'stroke="#ff3b2f" stroke-width="2.5"') + line([x - d, y - d], [x + d, y + d], '#ff3b2f', 3) + line([x + d, y - d], [x - d, y + d], '#ff3b2f', 3); }
  for (const l of app.AN.missing) { const a = epPos(l.a), b = epPos(l.b); if (a && b) s += line(a, b, '#ffd166', 2, 'stroke-dasharray="5 4" opacity=".95"'); }
  if (app.tab === 'guide' && app.guideStep >= 0) { const st = buildSteps()[app.guideStep]; if (st) { for (const id of st.comps || []) { const c = compById(id); if (!c) continue; const [a1, a2, b1, b2] = CT[c.type].box(c); s += `<polygon points="${boxPoly(c, a1 - 0.25, a2 + 0.25, b1 - 0.25, b2 + 0.25)}" fill="rgba(255,209,102,.18)" stroke="#ffd166" stroke-width="2.5"/>`; } for (const t of st.traces || []) s += `<path d="${traceD(t)}" fill="none" stroke="#ffd166" stroke-width="${P * 0.6}" stroke-linecap="round" stroke-linejoin="round" opacity=".55"/>`; for (const w of st.wires || []) { const a = epPos(w.a), b = epPos(w.b); if (a && b) s += line(a, b, '#ffd166', 4, 'opacity=".6"'); } for (const [c, r] of st.cuts || []) s += circ(toView(c, r), P * 0.55, 'none', 'stroke="#ffd166" stroke-width="3"'); } }
  // seleção
  if (app.multi) {
    for (const id of app.multi.comps) { const c = compById(id); if (c) s += compBoxSvg(c, '#7fd3ff'); }
    for (const id of app.multi.traces) { const t = app.S.traces.find(t => t.id === id); if (t) s += `<path d="${traceD(t)}" fill="none" stroke="#7fd3ff" stroke-width="3" stroke-dasharray="6 4" stroke-linecap="round"/>`; }
    for (const id of app.multi.wires) { const w = app.S.wires.find(w => w.id === id); if (w) { const a = epPos(w.a), b = epPos(w.b); if (a && b) s += line(a, b, '#7fd3ff', 3, 'stroke-dasharray="6 4"'); } }
  }
  if (app.selected) {
    if (app.selected.kind === 'comp') { const c = compById(app.selected.id); if (c) s += compBoxSvg(c, '#ffd166'); }
    else if (app.selected.kind === 'trace') { const t = app.S.traces.find(t => t.id === app.selected.id); if (t) s += `<path d="${traceD(t)}" fill="none" stroke="#ffd166" stroke-width="3" stroke-dasharray="6 4" stroke-linecap="round"/>`; }
    else if (app.selected.kind === 'wire') { const w = app.S.wires.find(w => w.id === app.selected.id); if (w) { const a = epPos(w.a), b = epPos(w.b); if (a && b) s += line(a, b, '#ffd166', 3, 'stroke-dasharray="6 4"'); } }
    else if (app.selected.kind === 'hole') s += circ(toView(app.selected.c, app.selected.r), P * 0.55, 'none', 'stroke="#ffd166" stroke-width="3"');
    else if (app.selected.kind === 'board') { const b = app.S.boards.find(b => b.id === app.selected.id); if (b) s += dash(boardBody(b), app.drag && app.drag.kind === 'board' && !app.drag.ok ? '#ff4d3d' : '#ffd166'); }
    else if (app.selected.kind === 'mcu') { const mo = mcuById(app.selected.id); if (mo) s += dash(mcuRect(mo), app.drag && app.drag.kind === 'mcu' && !app.drag.ok ? '#ff4d3d' : '#ffd166'); }
  }
  if (app.box) { const x = Math.min(app.box.x0, app.box.x1), y = Math.min(app.box.y0, app.box.y1); s += `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(Math.abs(app.box.x1 - app.box.x0))}" height="${n1(Math.abs(app.box.y1 - app.box.y0))}" fill="rgba(127,211,255,.12)" stroke="#7fd3ff" stroke-width="1.5" stroke-dasharray="4 3"/>`; }
  // fantasmas de colocação
  if (app.tool === 'place' && app.libKey && app.hoverF) {
    const it = LIBMAP[app.libKey];
    if (it[2] === 'board' || it[2] === 'mcu') { const g = ghostObject(app.libKey, app.hoverF); const ok = it[2] === 'board' ? objectFree(boardRect(g)) : objectFree(mcuRect(g)); if (it[2] === 'mcu') s += mcuSvg(g, { ghost: true }); s += dash(it[2] === 'board' ? boardBody(g) : mcuRect(g), ok ? '#7fd3ff' : '#ff4d3d', ok ? 'rgba(127,211,255,.10)' : 'rgba(255,77,61,.10)'); if (it[2] === 'board') { const [x, y] = toView(g.x, g.y); s += txt([x + 60, y - 2], ok ? 'Clique para colocar' : 'Sobrepõe outro objeto', 11, ok ? '#7fd3ff' : '#ff4d3d'); } }
    else if (app.hover) { const g = makeComp(app.libKey, app.hover.c, app.hover.r, app.ghostRot, true); s += drawComp(g, { ghost: true, invalid: !validComp(g), overlap: overlapsBody(g) }); }
  }
  if (app.tool === 'paste' && app.clipboard && app.hover) { for (const c of pastePreview(app.hover)) s += drawComp(c, { ghost: true, invalid: !validComp(c) }); }
  if (app.tool === 'trace' && app.drawing) {
    let pts = app.drawing.pts.slice(), conf = [];
    if (app.hover) { const nx = lPath(pts[pts.length - 1], [app.hover.c, app.hover.r]); let prev = pts[pts.length - 1]; for (const q of nx) { conf = conf.concat(segConflicts(prev, q)); prev = q; } pts = pts.concat(nx); }
    s += `<path d="M${pts.map(p => toView(p[0], p[1]).map(n1).join(' ')).join(' L')}" fill="none" stroke="${conf.length ? '#ff6b5b' : '#e8ecef'}" stroke-width="${P * 0.4}" stroke-linecap="round" stroke-linejoin="round" opacity=".65"/>`;
    for (const p of app.drawing.pts) s += circ(toView(p[0], p[1]), 4, '#ffd166');
    for (const k of conf) s += circ(toView(k.c, k.r), P * 0.5, 'none', 'stroke="#ff3b2f" stroke-width="2.5"');
  }
  if (app.tool === 'wire' && app.wireStart) { const a = epPos(app.wireStart); if (a) { s += circ(a, 6, '#ffd166'); const b = app.hoverV; if (b) s += line(a, b, WIRECOL[nextWireColor()] || '#ffd166', P * 0.2, 'opacity=".7"'); } }
  if (app.tool === 'link' && app.linkStart) { const a = epPos(app.linkStart); if (a) { s += circ(a, 6, '#ffd166'); const b = app.hoverV; if (b) s += line(a, b, '#ffd166', 2, 'stroke-dasharray="5 4"'); } }
  if (app.hover && ['trace', 'wire', 'solder', 'erase', 'cut', 'link'].includes(app.tool)) s += circ(toView(app.hover.c, app.hover.r), P * 0.44, 'none', `stroke="${app.tool === 'erase' || app.tool === 'cut' ? '#ff6b5b' : '#ffffff'}" stroke-width="2"`);
  if (app.flash && Date.now() - app.flash.t < 2500) { const [x, y] = toView(app.flash.c, app.flash.r); s += `<circle cx="${x}" cy="${y}" r="${P * 0.9}" fill="none" stroke="#ffd166" stroke-width="3"><animate attributeName="r" values="${P * 0.5};${P * 1.2};${P * 0.5}" dur="1s" repeatCount="3"/></circle>`; }
  $('gOver').innerHTML = s;
}
