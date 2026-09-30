// @ts-nocheck
import { app } from '../state';
import { $, BREADS, KINDS, PINFULL, SIZES, TRACECOL, WIRECOL, boardAt, boardLabel, boardRectAt, clone, esc, fmtR, fmtU, hasKind, hk, hname, kindAt, n1, vp } from '../core/base';
import { CT, LIB, LIBMAP, QUICK } from '../parts/catalog';
import { MCU, analyze, compById, epName, isSupply, mcuById, mcuCaps, mcuCfg, mcuPinName, mk, mkSplit, pinsOf, traceColor, traceConnects, traceNetKey } from '../core/analysis';
import { mcuReading, simulate } from '../sim/solver';
import { renderBoard, renderItems, renderOverlay, setDims } from './render';
import { mcuPinAt } from './interaction';
import { RT, codeIssues, onCircuitChanged } from '../code/arduino';
import { PROJ, scheduleSave } from '../app/projects';

// ════════════════════════ Painéis ════════════════════════
export function fieldHtml(obj, f) {
  const [k, label, kind, opt, num] = f, id = 'f_' + k, cur = obj[k];
  if (kind === 'text') return `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="text" data-f="${k}" value="${esc(cur || '')}" maxlength="40"></div>`;
  if (kind === 'num') return `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="number" data-f="${k}" data-num="1" min="${opt.min ?? ''}" max="${opt.max ?? ''}" step="${opt.step ?? 'any'}" value="${opt.val != null ? opt.val : cur}"></div>`;
  if (kind === 'range') return `<div class="field"><label for="${id}">${label}</label><div class="rng"><input id="${id}" type="range" data-f="${k}" data-num="1" data-live="1" min="${opt.min}" max="${opt.max}" step="${opt.step}" value="${cur}"><span id="${id}_v">${opt.fmt(cur)}</span></div></div>`;
  if (kind === 'toggle') return `<div class="field"><label>${label}</label><div><button class="sw${cur ? ' on' : ''}" data-tog="${k}"><i></i>${cur ? 'Sim' : 'Não'}</button></div></div>`;
  if (kind === 'sel') return `<div class="field"><label for="${id}">${label}</label><select id="${id}" data-f="${k}" ${num === true ? 'data-num="1"' : num === 'bool' ? 'data-bool="1"' : ''}>${opt.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
  return '';
}

export let rangeFmt = {};

export function renderInspector() {
  const el = $('inspector'); rangeFmt = {};
  if (!app.selected) {
    const tl = { select:'Clique em peças, trilhas, fios ou furos para editar. Arraste peças para mover, arraste o fundo para rolar.', trace:'Clique furo a furo para desenhar uma trilha de solda (lado de baixo). Clique de novo no último furo ou tecle Enter para terminar.', wire:'Clique em dois pontos para ligar um fio: furos, pinos do microcontrolador, bornes ou barras de pinos.', solder:'Clique num furo para colocar ou tirar solda.', cut:'Clique num furo do veroboard para cortar a trilha de cobre ali.', link:'Clique em dois pinos para dizer que eles devem estar ligados. A placa mostra o que falta e acusa curtos contra o esquema.', erase:'Clique numa peça, trilha, fio, solda, corte ou linha do esquema para apagar.', place:'Clique num furo para colocar a peça. R gira. Esc volta para Selecionar.' }[app.tool];
    el.innerHTML = `<h2>Inspetor</h2><p class="note" style="margin:0">${tl}</p>`;
    return;
  }
  let h = '';
  if (app.selected.kind === 'multi') {
    const n = app.multi ? app.multi.comps.size + app.multi.traces.size + app.multi.wires.size : 0;
    h = `<h2>${n} itens selecionados</h2><p class="note" style="margin:0">${app.multi.comps.size} peças · ${app.multi.traces.size} trilhas · ${app.multi.wires.size} fios. Arraste qualquer um para mover o grupo, ou use as setas.</p>`;
    h += `<div class="row-actions"><button class="btn" data-act="copy">Copiar (Ctrl+C)</button><button class="btn" data-act="dupsel">Duplicar (Ctrl+D)</button><button class="btn danger" data-act="del">Excluir</button></div>`;
    el.innerHTML = h; return;
  }
  if (app.selected.kind === 'comp') {
    const c = compById(app.selected.id); if (!c) { app.selected = null; return renderInspector(); }
    const t = CT[c.type], pins = pinsOf(c).map(p => `${p.name}→${hname(p.c, p.r)}`).join(' · ');
    const fs = t.fields(c);
    for (const f of fs) if (f[2] === 'range') rangeFmt[f[0]] = f[3].fmt;
    h = `<h2>${esc(c.p.name)} <small>${esc(t.label(c))}</small></h2><div class="small mono muted">${pins}</div>`;
    h += fieldHtml(c.p, ['name', 'Nome', 'text']) + fieldHtml(c.p, ['desc', 'Função', 'text']);
    h += fs.map(f => fieldHtml(c.p, f)).join('');
    if (c.type === 'bjt' || c.type === 'mos') h += `<p class="note">Com a face plana (ou a etiqueta) virada para você, pinos da esquerda para a direita. Confira no datasheet do seu componente.</p>`;
    if (c.type === 'btn') h += `<p class="note">A1–A2 e B1–B2 são ligados por dentro. Apertar liga o lado A ao lado B.</p>`;
    h += `<div class="row-actions"><button class="btn" data-act="rot">↻ Girar (R)</button><button class="btn" data-act="dup">Duplicar</button><button class="btn danger" data-act="del">Excluir</button></div>`;
  } else if (app.selected.kind === 'trace') {
    const t = app.S.traces.find(t => t.id === app.selected.id); if (!t) { app.selected = null; return renderInspector(); }
    const cov = app.AN.covers.get(t.id) || [], nk = traceNetKey(t), nn = nk ? app.AN.netName.get(nk) : '';
    const iss = app.AN.traceIssues.get(t.id) || [];
    h = `<h2><span class="tchip" style="background:${traceColor(t) || '#5d646c'}">T${t.tag}</span> Trilha de solda</h2>`;
    h += `<div class="small mono muted">${hname(t.pts[0][0], t.pts[0][1])} → ${hname(t.pts[t.pts.length - 1][0], t.pts[t.pts.length - 1][1])} · ${cov.length} furos · ${(Math.max(0, cov.length - 1) * 2.54).toFixed(1)} mm</div>`;
    h += fieldHtml(t, ['name', 'Nome', 'text']) + fieldHtml(t, ['color', 'Cor', 'sel', Object.keys(TRACECOL).map(k => [k, k === 'solda' ? 'solda (prata)' : k])]);
    h += `<div class="field"><label for="f_net">Nome da rede</label><input id="f_net" type="text" data-net="${t.pts[0][0]},${t.pts[0][1]}" value="${esc(nn || '')}" placeholder="ex.: GND, 5V, BASE" maxlength="16"></div>`;
    h += `<p class="note">Liga: ${traceConnects(t).join(', ') || 'nenhum pino ainda'}.</p>`;
    h += iss.length ? `<p class="note" style="color:var(--err)">Problemas: ${esc(iss.join('; '))}.</p>` : `<p class="note" style="color:var(--ok)">Sem cruzamentos.</p>`;
    h += `<div class="row-actions"><button class="btn danger" data-act="del">Excluir trilha</button></div>`;
  } else if (app.selected.kind === 'wire') {
    const w = app.S.wires.find(w => w.id === app.selected.id); if (!w) { app.selected = null; return renderInspector(); }
    h = `<h2>Fio <small>${esc(epName(w.a))} ↔ ${esc(epName(w.b))}</small></h2>`;
    h += fieldHtml(w, ['name', 'Nome', 'text']) + fieldHtml(w, ['color', 'Cor', 'sel', Object.keys(WIRECOL).map(k => [k, k])]);
    h += `<div class="row-actions"><button class="btn danger" data-act="del">Excluir fio</button></div>`;
  } else if (app.selected.kind === 'hole') {
    const { c, r } = app.selected, hh = hk(c, r), k = app.AN.holeKey(hh), mem = app.AN.nodeMembers.get(k) || [];
    const occ = app.AN.occ.get(hh), pk = occ && occ.kind === 'pin' ? app.AN.pinNode.get(occ.comp.id)[occ.pin.i] : k;
    const lb = app.S.labels.find(l => app.AN.holeKey(hk(l.h[0], l.h[1])) === pk);
    const v = app.SIM.ok && app.SIM.V.has(pk) ? fmtU(app.SIM.V.get(pk), 'V') : '—';
    h = `<h2>Rede em ${hname(c, r)}</h2>`;
    h += `<div class="field"><label for="f_net">Nome da rede</label><input id="f_net" type="text" data-net="${lb ? lb.h.join(',') : c + ',' + r}" value="${esc(lb ? lb.name : '')}" placeholder="ex.: GND, 5V, SINAL" maxlength="16"></div>`;
    h += `<p class="note">Tensão: <span class="mono">${v}</span>${app.SIM.pwm ? ' (média)' : ''}<br>Pinos nesta rede: ${esc((app.AN.nodeMembers.get(pk) || mem).map(m => m.name).join(', ') || 'nenhum')}</p>`;
    if (lb) h += `<div class="row-actions"><button class="btn" data-act="unlabel">Remover nome</button></div>`;
  } else if (app.selected.kind === 'mcu') {
    const mo = mcuById(app.selected.id); if (!mo) { app.selected = null; return renderInspector(); }
    const m = MCU[mo.type], running = typeof RT !== 'undefined' && RT.running && RT.mid === mo.id;
    h = `<h2>${esc(mo.name || m.label)} <small>${m.label} · lógica ${m.vcc} V</small></h2>`;
    h += fieldHtml(mo, ['name', 'Nome', 'text']);
    h += `<div class="row-actions" style="margin-top:4px"><button class="btn primary" data-act="code">Abrir código</button></div>`;
    const used = m.pins.filter(p => app.AN.mcuUsed.has(mk(mo.id, p.id)) && mcuCaps(m, p).io);
    if (running) h += `<p class="note">O código está rodando e controla os pinos. Pare o código para configurar os pinos à mão.</p>`;
    else if (!used.length) h += `<p class="note">Nenhum pino de sinal ligado. Use a ferramenta Fio para ligar um pino do ${esc(mo.name)} a uma placa.</p>`;
    else h += `<p class="note" style="margin-bottom:0">Configuração manual dos pinos (vale enquanto o código não roda):</p>`;
    if (!running) for (const p of used) {
      const cf = mcuCfg(mo.id, p.id), caps = mcuCaps(m, p), key = mk(mo.id, p.id);
      const opts = [['in', 'INPUT'], ['pullup', 'INPUT_PULLUP']]; if (caps.analog) opts.push(['analog', 'analogRead']); if (caps.out) opts.push(['out', 'OUTPUT']); if (caps.pwm) opts.push(['pwm', 'PWM (analogWrite)']);
      h += `<div class="field"><label for="m_${esc(key)}">${p.n}</label><select id="m_${esc(key)}" data-mpin="${esc(key)}" data-mk="mode">${opts.map(([v, l]) => `<option value="${v}"${cf.mode === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>`;
      if (cf.mode === 'out') h += `<div class="field"><label></label><div><button class="sw${cf.level ? ' on' : ''}" data-mlev="${esc(key)}"><i></i>${cf.level ? 'HIGH' : 'LOW'}</button></div></div>`;
      if (cf.mode === 'pwm') h += `<div class="field"><label></label><div class="rng"><input type="range" min="0" max="100" step="1" value="${cf.duty}" data-mpin="${esc(key)}" data-mk="duty" data-live="1" aria-label="Ciclo PWM ${p.n}"><span>${cf.duty}%</span></div></div>`;
    }
    h += `<p class="note">${mo.type === 'esp32' ? 'ESP32: pinos de 3,3 V, não toleram 5 V; recomendado até 12 mA por pino. G34–G39 só entrada.' : 'Arduino: até 20 mA por pino recomendado (40 mA máximo absoluto). PWM em D3, D5, D6, D9, D10, D11.'} Arraste pela borda para mover.</p>`;
    h += `<div class="row-actions"><button class="btn danger" data-act="del">Remover ${esc(m.label)}</button></div>`;
  } else if (app.selected.kind === 'board') {
    const b = app.S.boards.find(b => b.id === app.selected.id); if (!b) { app.selected = null; return renderInspector(); }
    const n = itemsOnBoard(b);
    h = `<h2>${esc(b.name)} <small>${esc(boardLabel(b))}</small></h2>`;
    h += fieldHtml(b, ['name', 'Nome', 'text']);
    h += `<div class="field"><label for="b_kind">Tipo</label><select id="b_kind" data-board="kind">${Object.entries(KINDS).map(([k, l]) => `<option value="${k}"${b.kind === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>`;
    if (b.kind === 'bread') h += `<div class="field"><label for="b_size">Tamanho</label><select id="b_size" data-board="size">${Object.entries(BREADS).map(([k, v]) => `<option value="${k}"${String(b.size) === k ? ' selected' : ''}>${v.label}</option>`).join('')}</select></div>`;
    else {
      h += `<div class="field"><label for="b_size">Tamanho</label><select id="b_size" data-board="size">${SIZES.map(z => `<option value="${z[0]}"${b.size === z[0] ? ' selected' : ''}>${z[1]} · ${z[2]}×${z[3]} furos</option>`).join('')}<option value="custom"${b.size === 'custom' ? ' selected' : ''}>Personalizada</option></select></div>`;
      if (b.size === 'custom') h += `<div class="field"><label for="b_cols">Colunas × linhas</label><div class="rng"><input id="b_cols" type="number" min="4" max="70" value="${b.cols}" data-board="cols" style="width:5em"> × <input id="b_rows" type="number" min="4" max="90" value="${b.rows}" data-board="rows" style="width:5em"></div></div>`;
      if (b.kind === 'perf') h += `<div class="field"><label for="b_sides">Faces</label><select id="b_sides" data-board="sides"><option value="2"${b.sides === 2 ? ' selected' : ''}>Dupla face (verde)</option><option value="1"${b.sides === 1 ? ' selected' : ''}>Face simples (fenolite)</option></select></div>`;
      h += `<div class="field"><label for="b_lab">Rótulos</label><select id="b_lab" data-board="labels"><option value="num"${b.labels === 'num' ? ' selected' : ''}>Letras e números</option><option value="let"${b.labels === 'let' ? ' selected' : ''}>Letras nos dois eixos</option></select></div>`;
    }
    h += `<p class="note">${n} ${n === 1 ? 'item está' : 'itens estão'} nesta placa. Arraste a placa pela borda para mover tudo junto. Conte os furos da sua placa: fabricantes variam.</p>`;
    h += `<div class="row-actions"><button class="btn danger" data-act="del">Remover placa${n ? ` e ${n} ${n === 1 ? 'item' : 'itens'}` : ''}</button></div>`;
  }
  el.innerHTML = h;
}

export const TABS = [['sim', 'Simulação'], ['drc', 'Verificação'], ['traces', 'Trilhas'], ['schem', 'Esquema'], ['guide', 'Montagem'], ['board', 'Bancada']];
export function allIssues() { return app.AN.issues.concat(app.SIM.issues || [], typeof codeIssues === 'function' ? codeIssues() : []); }

export function renderTabs() {
  const is = allIssues(), e = is.filter(i => i.sev === 'err').length, w = is.filter(i => i.sev === 'warn').length;
  $('tabs').innerHTML = TABS.map(([k, l]) => {
    let n = '';
    if (k === 'drc' && (e || w)) n = `<span class="n ${e ? 'err' : 'warn'}">${e || w}</span>`;
    if (k === 'traces' && app.S.traces.length) n = `<span class="n">${app.S.traces.length}</span>`;
    if (k === 'schem' && app.AN.missing.length) n = `<span class="n warn">${app.AN.missing.length}</span>`;
    return `<button class="tab${app.tab === k ? ' on' : ''}" role="tab" aria-selected="${app.tab === k}" data-tab="${k}">${l}${n}</button>`;
  }).join('');
  const body = $('tabBody');
  body.innerHTML = ({ sim: tabSim, drc: tabDrc, traces: tabTraces, schem: tabSchem, guide: tabGuide, board: tabBoard })[app.tab]();
}

export function tabSim() {
  if (!app.SIM.ok) return `<p class="note" style="margin:0"><span class="pill ${app.S.comps.length ? 'warn' : 'mute'}">parada</span> ${esc(app.SIM.msg)}</p>`;
  const is = allIssues(), hasErr = is.some(i => i.sev === 'err');
  let h = `<p class="note" style="margin:0 0 6px">${hasErr ? '<span class="pill err">com erros</span>' : '<span class="pill ok">funcionando</span>'} ${app.SIM.pwm ? 'Com PWM: valores médios; limites conferidos no pico.' : 'Ponto de operação DC.'}</p>`;
  const order = { term:0, reg:1, bjt:2, mos:2, relay:3, res:4, pot:4, ldr:4, led:5, diode:5, motor:6, buzzer:6, capc:7, cape:7, btn:8, sw:8, header:9 };
  const comps = app.S.comps.slice().sort((a, b) => (order[a.type] - order[b.type]) || a.p.name.localeCompare(b.p.name, 'pt', { numeric: true }));
  for (const c of comps) { const r = app.SIM.comp.get(c.id), t = CT[c.type]; if (!r) continue; const txt = t.read(c, r); if (!txt) continue; h += `<div class="ro click" data-sel="${c.id}"><b>${esc(c.p.name)}</b><div class="vals">${txt}</div></div>`; }
  for (const mo of app.S.mcus) {
    const m = MCU[mo.type], rows = [...app.SIM.mcu].filter(([kk]) => mkSplit(kk)[0] === mo.id && !kk.includes('#'));
    if (!rows.length) continue;
    h += `<div class="sectlabel">${esc(mo.name || m.label)}${typeof RT !== 'undefined' && RT.running && RT.mid === mo.id ? ' · código rodando' : ''}</div>`;
    for (const [kk, r] of rows) { const pid = mkSplit(kk)[1], p = m.pin[pid], cf = mcuCfg(mo.id, pid); let v = `${fmtU(r.v, 'V')}`; if (isSupply(m, p.n)) v += ` · fornece ${fmtU(r.i || 0, 'A')}`; else if (cf.mode === 'out' || cf.mode === 'pwm') v += ` · ${cf.mode === 'pwm' ? `PWM ${cf.duty}% · ` : ''}${fmtU(r.i || 0, 'A')}`; const rd = mcuCaps(m, p).io ? mcuReading(kk, r) : ''; if (rd) v += `<br>${rd}`; h += `<div class="ro click" data-mcusel="${mo.id}"><b>${esc(p.n)}</b><div class="vals">${v}</div></div>`; }
  }
  const named = [...app.AN.netName.entries()].filter(([k]) => app.SIM.V.has(k));
  if (named.length) { h += `<div class="sectlabel">Redes nomeadas</div>`; for (const [k, nm] of named) h += `<div class="ro"><b>${esc(nm)}</b><div class="vals">${fmtU(app.SIM.V.get(k), 'V')}${app.SIM.floating.has(k) ? ' <span class="tag wrn">flutuando</span>' : ''}</div></div>`; }
  return h;
}

export function tabDrc() {
  const is = allIssues().slice().sort((a, b) => ({ err:0, warn:1, info:2 }[a.sev] - { err:0, warn:1, info:2 }[b.sev]));
  issueCache = is;
  if (!is.length) return `<p class="note" style="margin:0"><span class="pill ok">sem problemas</span> Nenhuma trilha cruzada, nenhum pino sem solda e a simulação não acusou excessos.</p>`;
  const e = is.filter(i => i.sev === 'err').length, w = is.filter(i => i.sev === 'warn').length, n = is.length - e - w;
  return `<p class="note" style="margin:0 0 6px">${e} erro${e === 1 ? '' : 's'} · ${w} aviso${w === 1 ? '' : 's'} · ${n} dica${n === 1 ? '' : 's'}. Clique para localizar.</p><ul class="issues">${is.slice(0, 80).map((i, k) => `<li class="${i.sev}" tabindex="0" data-issue="${k}">${esc(i.msg)}</li>`).join('')}</ul>`;
}

export let issueCache = [];

export function tabTraces() {
  if (!hasKind('perf') && !hasKind('strip')) return `<p class="note" style="margin:0">Não há placa perfurada nem veroboard na bancada. No protoboard as ligações são feitas pelas colunas internas e por fios.</p>`;
  let h = `<div class="row-actions" style="margin:0 0 6px"><button class="sw${app.blockCross ? ' on' : ''}" data-act="block"><i></i>Bloquear cruzamentos ao desenhar</button><button class="sw${app.showTags ? ' on' : ''}" data-act="tags"><i></i>Etiquetas</button><button class="sw${app.netColors ? ' on' : ''}" data-act="netcol"><i></i>Cores por rede</button></div>`;
  if (!app.S.traces.length) return h + `<p class="note">Nenhuma trilha ainda. Use a ferramenta Trilha (T). Cada trilha recebe um código (T1, T2…), uma cor e a rede a que pertence.</p>`;
  const groups = new Map();
  for (const t of app.S.traces) { const k = traceNetKey(t) || '?'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
  for (const [k, list] of groups) {
    const nm = app.AN.netName.get(k), pins = (app.AN.nodeMembers.get(k) || []).map(m => m.name);
    h += `<div class="sectlabel">${esc(nm ? 'Rede ' + nm : 'Rede sem nome')} <span style="text-transform:none;letter-spacing:0;font-weight:500">· ${esc(pins.slice(0, 6).join(', '))}${pins.length > 6 ? '…' : ''}</span></div>`;
    for (const t of list.sort((a, b) => a.tag - b.tag)) {
      const cov = app.AN.covers.get(t.id) || [], iss = app.AN.traceIssues.get(t.id) || [], col = traceColor(t) || '#5d646c';
      const st = iss.some(s => s.startsWith('cruza')) ? '<span class="tag bad">cruza</span>' : iss.length ? '<span class="tag wrn">atenção</span>' : '<span class="tag sat">ok</span>';
      h += `<div class="trow${app.selected && app.selected.kind === 'trace' && app.selected.id === t.id ? ' sel' : ''}" data-trace="${t.id}"><span class="tchip" style="background:${col}">T${t.tag}</span><div class="d">${esc(t.name || traceConnects(t).join(' → ') || 'sem pinos')}<br><span class="mono">${hname(t.pts[0][0], t.pts[0][1])}→${hname(t.pts[t.pts.length - 1][0], t.pts[t.pts.length - 1][1])} · ${cov.length} furos${iss.length ? ' · ' + esc(iss.join('; ')) : ''}</span></div>${st}</div>`;
    }
  }
  return h;
}

export function tabSchem() {
  let h = `<p class="note" style="margin:0 0 6px">O esquema diz quais pinos devem estar ligados. Linhas tracejadas amarelas mostram o que falta, e a verificação acusa pinos ligados que o esquema separa. Use a ferramenta Ligação (L) ou capture da placa.</p>`;
  h += `<div class="row-actions" style="margin:0 0 8px"><button class="btn sm" data-act="capture">Capturar ligações atuais</button><button class="btn sm danger" data-act="clearlinks"${app.S.links.length ? '' : ' disabled'}>Limpar esquema</button></div>`;
  if (!app.S.links.length) return h + `<p class="note">Nenhuma ligação planejada.</p>`;
  const miss = new Set(app.AN.missing);
  h += `<p class="note">${app.S.links.length} ligações · ${app.AN.missing.length} faltando</p>`;
  app.S.links.forEach((l, i) => { h += `<div class="ro"><b>${miss.has(l) ? '<span class="tag wrn">falta</span>' : '<span class="tag sat">ok</span>'}</b><div class="vals">${esc(epName(l.a))} ↔ ${esc(epName(l.b))} <button class="btn sm" data-dellink="${i}" aria-label="Remover ligação">×</button></div></div>`; });
  return h;
}

export function buildSteps() {
  const steps = [];
  const onBread = c => kindAt(pinsOf(c)[0].c, pinsOf(c)[0].r) === 'bread';
  const comps = t => app.S.comps.filter(c => { const s = CT[c.type].step; return (typeof s === 'function' ? s(c) : s) === t; });
  if (app.S.cuts.length) steps.push({ title: 'Cortes nas trilhas de cobre', text: `Faça ${app.S.cuts.length} corte${app.S.cuts.length > 1 ? 's' : ''} com uma broca de 3–4 mm girada à mão sobre o furo, pelo lado do cobre.`, cuts: app.S.cuts });
  const bw = app.S.wires.filter(w => w.a.h && w.b.h);
  if (bw.length) steps.push({ title: 'Fios jumper na placa', text: `${bw.length} fio${bw.length > 1 ? 's' : ''}: ${bw.map(w => `${w.name ? w.name + ' ' : ''}${epName(w.a)}→${epName(w.b)} (${w.color})`).join(', ')}.`, wires: bw });
  const defs = [['axial', 'Resistores, diodos e LDR', 'Peças deitadas e mais baixas primeiro. Diodo: a faixa é o cátodo.'], ['hdr', 'Barras de pinos', ''], ['capc', 'Capacitores cerâmicos', 'Não têm polaridade.'], ['sw', 'Botões e chaves', ''], ['to92', 'Transistores TO‑92', 'Confira a pinagem com a face plana virada para você.'], ['led', 'LEDs', 'Perna longa = ânodo (+). Lado chanfrado = cátodo.'], ['cape', 'Capacitores eletrolíticos', 'A faixa marca o negativo (−).'], ['to220', 'Componentes TO‑220', 'Deixe espaço para dissipador se a simulação pedir.'], ['pot', 'Potenciômetros', ''], ['term', 'Bornes', 'Entradas de fio viradas para fora da placa.'], ['big', 'Relé, buzzer e motor', 'Peças maiores por último.']];
  for (const [k, title, tip] of defs) { const cs = comps(k); if (!cs.length) continue; const sold = cs.filter(c => !onBread(c)), pins = sold.reduce((s, c) => s + pinsOf(c).length, 0), enc = cs.length - sold.length; steps.push({ title, text: `${cs.map(c => `${c.p.name} (${CT[c.type].bom(c)})`).join(', ')}. ${pins ? `Solde ${pins} pinos e corte as sobras dos terminais.` : ''}${enc ? ` Encaixe ${enc === cs.length ? 'as peças' : enc + ' no protoboard'} e confira as colunas.` : ''} ${tip}`, comps: cs.map(c => c.id) }); }
  if (app.S.traces.length) steps.push({ title: 'Trilhas de solda (lado de baixo)', text: `${app.S.traces.length} trilha${app.S.traces.length > 1 ? 's' : ''}: ${app.S.traces.map(t => 'T' + t.tag + (t.name ? ' ' + t.name : '')).join(', ')}. Faça pontes de solda furo a furo ou use fio desencapado. Vire a placa (vista Inferior) para seguir.`, traces: app.S.traces });
  const ext = app.S.wires.filter(w => !(w.a.h && w.b.h));
  if (ext.length) steps.push({ title: 'Fios para fora da placa', text: ext.map(w => `${w.name ? w.name + ': ' : ''}${epName(w.a)} → ${epName(w.b)} (${w.color})`).join('; ') + '.', wires: ext });
  steps.push({ title: 'Conferência final', text: 'Antes de ligar: confira a aba Verificação, procure pontes de solda com lupa e meça continuidade entre + e − com o multímetro (não pode apitar).' });
  return steps;
}

export function tabGuide() {
  const groups = new Map();
  for (const c of app.S.comps) { const k = CT[c.type].bom(c); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c.p.name); }
  for (const b of app.S.boards) { const k = boardLabel(b); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b.name); }
  for (const mo of app.S.mcus) { const k = MCU[mo.type].label; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(mo.name); }
  let h = `<div class="sectlabel" style="margin-top:0">Lista de materiais</div>`;
  if (!groups.size) h += `<p class="note">Sem peças.</p>`;
  else h += `<table class="bom"><thead><tr><th>Qtd</th><th>Peça</th><th>Posição</th></tr></thead><tbody>${[...groups].sort((a, b) => a[0].localeCompare(b[0])).map(([k, n]) => `<tr><td class="q">${n.length}</td><td>${esc(k)}</td><td class="mono small">${esc(n.sort((a, b) => a.localeCompare(b, 'pt', { numeric: true })).join(', '))}</td></tr>`).join('')}</tbody></table>`;
  const wires = app.S.wires.length; if (wires) h += `<p class="note">Mais ${wires} fio${wires > 1 ? 's' : ''} (jumpers/Dupont).</p>`;
  const steps = buildSteps();
  h += `<div class="sectlabel">Passo a passo</div>`;
  if (app.guideStep < 0) h += `<p class="note">Ordem de montagem das peças mais baixas para as mais altas. O passo atual fica destacado na placa.</p><div class="row-actions"><button class="btn primary sm" data-guide="0">Começar (${steps.length} passos)</button></div>`;
  else { const i = Math.min(app.guideStep, steps.length - 1), st = steps[i]; h += `<div class="step"><h4>${i + 1}/${steps.length} · ${esc(st.title)}</h4><div class="small">${esc(st.text)}</div></div><div class="row-actions"><button class="btn sm" data-guide="${i - 1}"${i ? '' : ' disabled'}>← Anterior</button><button class="btn sm" data-guide="${i + 1 < steps.length ? i + 1 : -1}">${i + 1 < steps.length ? 'Próximo →' : 'Concluir'}</button><button class="btn sm" data-guide="-1">Sair</button></div>`; }
  return h;
}

export function tabBoard() {
  let h = `<p class="note" style="margin:0 0 8px">Tudo o que está na bancada. Clique para selecionar e editar; arraste placas e microcontroladores pela borda para mover.</p>`;
  h += `<div class="sectlabel" style="margin-top:0">Placas</div>`;
  if (!app.S.boards.length) h += `<p class="note">Nenhuma placa. Adicione uma abaixo.</p>`;
  for (const b of app.S.boards) { const n = itemsOnBoard(b); h += `<div class="trow${app.selected && app.selected.kind === 'board' && app.selected.id === b.id ? ' sel' : ''}" data-selboard="${b.id}"><span class="tchip" style="background:${b.kind === 'bread' ? '#8a8578' : b.kind === 'strip' ? '#b3864a' : '#227442'}">${esc(b.name)}</span><div class="d">${esc(boardLabel(b))}<br><span class="mono">${n} ${n === 1 ? 'item' : 'itens'}</span></div><button class="btn sm danger" data-rmboard="${b.id}" aria-label="Remover ${esc(b.name)}">Remover</button></div>`; }
  h += `<div class="sectlabel">Microcontroladores</div>`;
  if (!app.S.mcus.length) h += `<p class="note">Nenhum.</p>`;
  for (const mo of app.S.mcus) { const n = app.S.wires.filter(w => (w.a.mcu && w.a.mcu[0] === mo.id) || (w.b.mcu && w.b.mcu[0] === mo.id)).length; h += `<div class="trow${app.selected && app.selected.kind === 'mcu' && app.selected.id === mo.id ? ' sel' : ''}" data-selmcu="${mo.id}"><span class="tchip" style="background:${MCU[mo.type].col}">${esc(MCU[mo.type].short)}</span><div class="d">${esc(mo.name)}<br><span class="mono">${n} fio${n === 1 ? '' : 's'}${(mo.code || '').trim() ? ' · tem código' : ''}</span></div><button class="btn sm danger" data-rmmcu="${mo.id}" aria-label="Remover ${esc(mo.name)}">Remover</button></div>`; }
  h += `<div class="sectlabel">Adicionar</div><div class="row-actions" style="margin-top:0">${LIB[0][1].map(it => `<button class="btn sm" data-lib="${it[0]}">+ ${esc(it[1])}</button>`).join('')}</div>`;
  h += `<p class="note">Escolha e clique num espaço livre da bancada. Também dá para arrastar da biblioteca à esquerda.</p>`;
  return h;
}

export function renderStatus() {
  const parts = [];
  if (app.hover) {
    parts.push(hname(app.hover.c, app.hover.r));
    const h = hk(app.hover.c, app.hover.r), occ = app.AN.occ.get(h);
    let k = app.AN.holeKey(h);
    if (occ && occ.kind === 'pin') { parts.push(`${occ.comp.p.name}.${occ.pin.name} ${PINFULL[occ.pin.name] || ''}`); k = app.AN.pinNode.get(occ.comp.id)[occ.pin.i]; }
    const tl = app.AN.traceHoles.get(h); if (tl) parts.push([...new Set(tl.map(e => { const t = app.S.traces.find(t => t.id === e.tid); return t ? 'T' + t.tag : ''; }))].join(','));
    const nm = app.AN.netName.get(k); if (nm) parts.push('rede ' + nm);
    const mem = app.AN.nodeMembers.get(k); if (mem && mem.length) parts.push(mem.map(m => m.name).join(', '));
    if (app.SIM.ok && app.SIM.V.has(k)) parts.push(fmtU(app.SIM.V.get(k), 'V') + (app.SIM.pwm ? ' méd.' : ''));
  } else if (app.hoverV) { const pr = mcuPinAt(app.hoverV); if (pr) { const kk = mk(pr[0], pr[1]); parts.push(mcuPinName(pr[0], pr[1])); const k = app.AN.mcuNode.get(kk); const mem = app.AN.nodeMembers.get(k); if (mem && mem.length > 1) parts.push(mem.map(m => m.name).join(', ')); if (app.SIM.ok && app.SIM.V.has(k)) parts.push(fmtU(app.SIM.V.get(k), 'V')); } else if (app.hoverF) { const b = boardRectAt(app.hoverF[0], app.hoverF[1]); if (b) parts.push(`${b.name} · arraste a borda para mover`); } }
  const hint = { select:'Clique seleciona · arraste move · R gira · Del exclui', trace: app.drawing ? 'Clique continua · clique no último furo ou Enter termina · Esc cancela' : 'Clique no furo onde a trilha começa', wire: app.wireStart ? 'Clique no destino do fio' : 'Clique no início do fio', solder:'Clique num furo para soldar', cut:'Clique num furo para cortar a trilha', link: app.linkStart ? 'Clique no segundo pino' : 'Clique no primeiro pino', erase:'Clique no que quer apagar', place:'Clique para colocar · R gira · Esc sai' }[app.tool] || '';
  $('status').innerHTML = (app.statusMsg ? `<span class="${app.statusBad ? 'bad' : 'msg'}">${esc(app.statusMsg)}</span>` : '') + `<span>${esc(parts.join('  ·  '))}</span><span style="margin-left:auto">${esc(hint)}</span>`;
}

export function renderChrome() {
  $('bUndo').disabled = !app.undoStack.length; $('bRedo').disabled = !app.redoStack.length;
  $('vTop').classList.toggle('on', app.view === 'top'); $('vBot').classList.toggle('on', app.view === 'bottom'); $('vBot').disabled = !hasKind('perf') && !hasKind('strip');
  $('bXray').classList.toggle('on', app.xray); $('bTags').classList.toggle('on', app.showTags); $('bNetCol').classList.toggle('on', app.netColors); $('bSolderAll').disabled = !hasKind('perf') && !hasKind('strip');
  $('zVal').textContent = Math.round(app.zoom * 100) + '%';
  $('viewtag').textContent = `${app.view === 'top' ? 'vista superior' : 'vista inferior (espelhada)'} · ${app.S.boards.length} placa${app.S.boards.length === 1 ? '' : 's'}${app.S.mcus.length ? ` · ${app.S.mcus.length} microcontrolador${app.S.mcus.length > 1 ? 'es' : ''}` : ''} · ${Math.round(app.zoom * 100)}%`;
  if (document.activeElement !== $('projName')) $('projName').value = PROJ.name;
}

export function renderAll() { renderItems(); renderOverlay(); renderInspector(); renderTabs(); renderStatus(); renderChrome(); renderTools(); }
export function changed(opts) { if (app.view === 'bottom' && !hasKind('perf') && !hasKind('strip')) app.view = 'top'; setDims(); renderBoard(); app.AN = analyze(); app.SIM = simulate(app.AN); renderAll(); if (!(opts && opts.noSave)) scheduleSave(); if (typeof onCircuitChanged === 'function') onCircuitChanged(); }
export function say(t, bad) { app.statusMsg = t; app.statusBad = !!bad; clearTimeout(app.msgTimer); app.msgTimer = setTimeout(() => { app.statusMsg = ''; renderStatus(); }, 4000); renderStatus(); }

// ════════════════════════ Ferramentas e biblioteca ════════════════════════
export const TOOLS = [
  { k:'select', key:'V', label:'Selecionar', icon:'<path d="M6 3l12 9-6 1 3 7-3 1-3-7-3 4z" fill="currentColor"/>' },
  { k:'trace', key:'T', label:'Trilha', icon:'<path d="M3 16h8l6-6h5" fill="none" stroke="#cdd1d6" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 16h8l6-6h5" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>' },
  { k:'wire', key:'J', label:'Fio', icon:'<path d="M3 17Q12 -1 21 17" fill="none" stroke="#d8342a" stroke-width="3" stroke-linecap="round"/>' },
  { k:'solder', key:'S', label:'Solda', icon:'<circle cx="12" cy="12" r="6" fill="#cfd3d8" stroke="currentColor"/><path d="M18 2l-4 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' },
  { k:'cut', key:'X', label:'Cortar', icon:'<rect x="2" y="8" width="20" height="5" fill="#c9874a"/><circle cx="12" cy="10.5" r="4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 7l6 7M15 7l-6 7" stroke="currentColor" stroke-width="1.4"/>' },
  { k:'link', key:'L', label:'Ligação', icon:'<circle cx="5" cy="15" r="2.5" fill="currentColor"/><circle cx="19" cy="5" r="2.5" fill="currentColor"/><path d="M5 15L19 5" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 2"/>' },
  { k:'erase', key:'E', label:'Apagar', icon:'<path d="M4 14l8-8 7 7-5 5H8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><line x1="8" y1="10" x2="15" y2="17" stroke="currentColor" stroke-width="1.6"/>' },
];

export function toolEnabled(k) { if ((k === 'trace' || k === 'solder') && !hasKind('perf') && !hasKind('strip')) return false; if (k === 'cut' && !hasKind('strip')) return false; return true; }

export function renderTools() {
  $('tools').innerHTML = TOOLS.map(t => `<button class="tool${app.tool === t.k ? ' on' : ''}" data-tool="${t.k}" title="${t.label} (${t.key})" aria-pressed="${app.tool === t.k}"${toolEnabled(t.k) ? '' : ' disabled'}><kbd>${t.key}</kbd><svg viewBox="0 0 24 20" aria-hidden="true">${t.icon}</svg>${t.label}</button>`).join('');
  document.querySelectorAll('.part').forEach(b => b.classList.toggle('on', app.tool === 'place' && b.dataset.lib === app.libKey));
}

export let thumbs = {};

export function buildThumbs() {
  const sv = app.view; app.view = 'top';
  for (const [key, , type, props] of Object.values(LIBMAP)) {
    if (type === 'board') { const col = props.kind === 'bread' ? '#f1efe8' : props.kind === 'strip' ? '#c79a5c' : '#227442'; let dots = ''; for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) dots += props.kind === 'strip' && false ? '' : `<circle cx="${10 + i * 8}" cy="${8 + j * 7}" r="1.8" fill="${props.kind === 'bread' ? '#2e2d2a' : '#d7a44f'}"/>`; thumbs[key] = `<svg viewBox="0 0 60 30" aria-hidden="true"><rect x="2" y="2" width="56" height="26" rx="3" fill="${col}" stroke="#555" stroke-width="1"/>${props.kind === 'strip' ? [8, 15, 22].map(y => `<rect x="5" y="${y - 2}" width="50" height="4" fill="#c9874a"/>`).join('') : ''}${dots}</svg>`; continue; }
    if (type === 'mcu') { const m = MCU[props.type]; thumbs[key] = `<svg viewBox="0 0 60 30" aria-hidden="true"><rect x="6" y="2" width="48" height="26" rx="3" fill="${m.col}" stroke="#111"/><rect x="24" y="9" width="12" height="12" fill="#16181b"/>${[10, 16, 22, 28, 34, 40, 46].map(x => `<rect x="${x}" y="4" width="3" height="3" fill="#d9b45a"/><rect x="${x}" y="23" width="3" height="3" fill="#d9b45a"/>`).join('')}</svg>`; continue; }
    const c = { id: -1, type, c: 0, r: 0, rot: 0, p: Object.assign({ name: '' }, clone(props)) };
    const [a1, a2, b1, b2] = CT[type].box(c); const p1 = vp(c, a1, b1), p2 = vp(c, a2, b2);
    const x = Math.min(p1[0], p2[0]) - 3, y = Math.min(p1[1], p2[1]) - 3, w = Math.abs(p2[0] - p1[0]) + 6, h = Math.abs(p2[1] - p1[1]) + 6;
    thumbs[key] = `<svg viewBox="${n1(x)} ${n1(y)} ${n1(w)} ${n1(h)}" aria-hidden="true">${CT[type].draw(c, { thumb: true })}</svg>`;
  }
  app.view = sv;
}

export const LIBTAGS = { board:'placa perfurada protoboard veroboard bancada breadboard', mcu:'arduino esp32 microcontrolador uno nano código', res:'resistor resistência ohm', pot:'potenciômetro trimpot ajuste divisor', ldr:'luz sensor fotoresistor', capc:'capacitor cerâmico desacoplamento', cape:'capacitor eletrolítico filtro polarizado', diode:'diodo retificador proteção flyback zener schottky', led:'led luz indicador', bjt:'transistor bipolar npn pnp chave darlington', mos:'mosfet transistor chave potência motor', reg:'regulador fonte tensão', term:'borne conector fonte alimentação bateria', header:'barra pinos conector dupont arduino', btn:'botão push chave entrada', sw:'chave liga desliga', relay:'relé carga isolação', motor:'motor carga indutiva', buzzer:'buzzer som alarme' };

export function renderLib() {
  const q = $('libSearch').value.trim().toLowerCase();
  const qk = Object.fromEntries(Object.entries(QUICK).map(([a, b]) => [b, a]));
  const usedTypes = new Set(app.S.comps.map(c => c.type + ':' + (c.p.model || c.p.val || '')).concat(app.S.boards.map(b => 'board:' + b.kind), app.S.mcus.map(m => 'mcu:' + m.type)));
  $('libChips').innerHTML = [['', 'Todas'], ...LIB.map(([cat]) => [cat, cat])].map(([k, l]) => `<button class="chip${app.libCat === k && !app.libUsed ? ' on' : ''}" data-cat="${esc(k)}">${esc(l)}</button>`).join('') + `<button class="chip${app.libUsed ? ' on' : ''}" data-used="1">No projeto</button>`;
  const words = q.split(/\s+/).filter(Boolean);
  const html = LIB.map(([cat, items]) => {
    if (app.libCat && app.libCat !== cat && !app.libUsed) return '';
    const f = items.filter(it => {
      const hay = (it[1] + ' ' + cat + ' ' + it[2] + ' ' + (LIBTAGS[it[2]] || '') + ' ' + Object.values(it[3]).join(' ') + ' ' + (it[3].val ? fmtR(it[3].val) : '')).toLowerCase();
      if (words.some(w => !hay.includes(w))) return false;
      if (app.libUsed && !usedTypes.has(it[2] + ':' + (it[2] === 'board' ? it[3].kind : it[2] === 'mcu' ? it[3].type : (it[3].model || it[3].val || '')))) return false;
      return true;
    });
    if (!f.length) return '';
    return `<div class="libcat"><h3>${cat} <span style="font-weight:500">${f.length}</span></h3><div class="libgrid">${f.map(it => `<button class="part${app.tool === 'place' && app.libKey === it[0] ? ' on' : ''}" data-lib="${it[0]}" title="${esc(it[1])}">${thumbs[it[0]]}<span>${esc(it[1])}${qk[it[0]] ? ` <kbd>${qk[it[0]]}</kbd>` : ''}</span></button>`).join('')}</div></div>`;
  }).join('');
  $('lib').innerHTML = html || `<p class="note">Nenhuma peça com esse filtro.${app.libUsed ? ' O projeto ainda não usa peças dessa busca.' : ''}</p>`;
}

export function itemsOnBoard(b) { const on = (c, r) => boardAt(c, r) === b; return app.S.comps.filter(c => on(pinsOf(c)[0].c, pinsOf(c)[0].r)).length + app.S.traces.filter(t => on(t.pts[0][0], t.pts[0][1])).length + app.S.wires.filter(w => (w.a.h && on(w.a.h[0], w.a.h[1])) || (w.b.h && on(w.b.h[0], w.b.h[1]))).length; }

export function setTool(k, lk) {
  if (!toolEnabled(k)) { say('Essa ferramenta não se aplica a este tipo de placa', true); return; }
  app.tool = k; app.libKey = k === 'place' ? lk : null; app.drawing = null; app.wireStart = null; app.linkStart = null;
  if (k !== 'select') app.selected = null;
  renderTools(); renderOverlay(); renderInspector(); renderStatus();
}
