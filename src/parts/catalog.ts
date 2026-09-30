// @ts-nocheck
import { BJT, CAPCOL, CAPS, DIO, LEAD, LEDCOL, LEDNAME, LEDVF, MOS, P, REG, RVALS, TERMCOL, bands, boxPoly, circ, circPoly, clamp, drawAxial, drawTO220, drawTO92, f1, fmtR, fmtU, line, n1, poly, txt, vp, wattName } from '../core/base';
import { VT } from '../sim/solver';

// ════════════════════════ Registro de componentes ════════════════════════
// Cada tipo define: pinos, caixa (corpo), desenho, modelo de simulação, leitura, verificações, campos do inspetor.
export const selOpts = obj => Object.keys(obj).map(k => [k, k]);

export const permOpts = ['EBC','ECB','BEC','BCE','CBE','CEB'];
export const inl = (a, b, c3) => [[0, 0], [a, 0]].concat(c3 != null ? [[c3, 0]] : []);
export const CT = {};
export function semiNames(c, def) { return (c.p.pinout || def).split(''); }

// Biblioteca: [categoria, [[chave, rótulo, tipo, props]]]
export const LIB = [
  ['Placas e controladores', [
    ['b_perf79','Perfurada 7×9','board',{ kind:'perf', size:'7x9' }],
    ['b_perf57','Perfurada 5×7','board',{ kind:'perf', size:'5x7' }],
    ['b_perf915','Perfurada 9×15','board',{ kind:'perf', size:'9x15' }],
    ['b_strip79','Veroboard 7×9','board',{ kind:'strip', size:'7x9' }],
    ['b_bread830','Protoboard 830','board',{ kind:'bread', size:830 }],
    ['b_bread400','Protoboard 400','board',{ kind:'bread', size:400 }],
    ['b_bread170','Mini protoboard','board',{ kind:'bread', size:170 }],
    ['m_uno','Arduino Uno','mcu',{ type:'uno' }],
    ['m_nano','Arduino Nano','mcu',{ type:'nano' }],
    ['m_esp32','ESP32','mcu',{ type:'esp32' }],
  ]],
  ['Passivos', [
    ['r330','Resistor 330 Ω','res',{ val:330, span:4, watt:0.25 }],
    ['r1k','Resistor 1 kΩ','res',{ val:1000, span:4, watt:0.25 }],
    ['r10k','Resistor 10 kΩ','res',{ val:10000, span:4, watt:0.25 }],
    ['rX','Resistor (outro)','res',{ val:220, span:4, watt:0.25 }],
    ['pot','Potenciômetro','pot',{ val:10000, pos:0.5, pitch:2, color:'azul' }],
    ['trim','Trimpot','pot',{ val:10000, pos:0.5, pitch:1, color:'azul' }],
    ['ldr','LDR','ldr',{ light:50 }],
    ['c100n','Cerâmico 100 nF','capc',{ model:'100n', span:2 }],
    ['c10u','Eletrolítico 10 µF','cape',{ model:'10u' }],
    ['c100u','Eletrolítico 100 µF','cape',{ model:'100u' }],
    ['c470u','Eletrolítico 470 µF','cape',{ model:'470u' }],
  ]],
  ['Diodos e LEDs', [
    ['led','LED','led',{ color:'red', size:5 }],
    ['d4007','1N4007','diode',{ model:'1N4007', span:4 }],
    ['d4148','1N4148','diode',{ model:'1N4148', span:3 }],
    ['d5819','1N5819','diode',{ model:'1N5819', span:4 }],
    ['z51','Zener 5,1 V','diode',{ model:'1N4733A', span:4 }],
  ]],
  ['Transistores', [
    ['q2222','2N2222','bjt',{ model:'2N2222', pinout:'EBC' }],
    ['q547','BC547','bjt',{ model:'BC547', pinout:'CBE' }],
    ['q337','BC337','bjt',{ model:'BC337', pinout:'CBE' }],
    ['q2907','2N2907 (PNP)','bjt',{ model:'2N2907', pinout:'EBC' }],
    ['q557','BC557 (PNP)','bjt',{ model:'BC557', pinout:'CBE' }],
    ['tip120','TIP120','bjt',{ model:'TIP120', pinout:'BCE' }],
    ['m7000','2N7000','mos',{ model:'2N7000', pinout:'SGD' }],
    ['irlz','IRLZ44N','mos',{ model:'IRLZ44N', pinout:'GDS' }],
    ['irfz','IRFZ44N','mos',{ model:'IRFZ44N', pinout:'GDS' }],
  ]],
  ['Alimentação', [
    ['term2','Borne 2 vias','term',{ ways:2, mode:'src', v:5, on:true, duty:50, rload:1000, kind:'res', color:'azul' }],
    ['term3','Borne 3 vias','term',{ ways:3, mode:'open', v:5, on:true, duty:50, rload:1000, kind:'res', color:'azul' }],
    ['u7805','7805','reg',{ model:'7805' }],
    ['u1117','LM1117 3,3 V','reg',{ model:'LM1117-3.3' }],
  ]],
  ['Conexões e entradas', [
    ['hdr','Barra de pinos','header',{ n:4, female:false }],
    ['btn','Botão','btn',{ pressed:false, color:'preto' }],
    ['sw','Chave SPDT','sw',{ pos:0 }],
  ]],
  ['Cargas', [
    ['relay','Relé 5 V','relay',{}],
    ['motor','Motor DC','motor',{ vnom:5, r:15 }],
    ['buzzer','Buzzer ativo','buzzer',{}],
  ]],
];

export const LIBMAP = {};
export const QUICK = { '1':'r330', '2':'r1k', '3':'q2222', '4':'term2', '5':'led' };


/** Registro das peças (dados puros; roda ao importar o módulo). */
function registerParts() {
  CT.res = {
    prefix:'R', label:c => `Resistor ${fmtR(c.p.val)}`, step:'axial',
    pins:c => [[0,0],[c.p.span,0]], names:() => ['1','2'],
    box:c => c.p.span === 1 ? [-0.5,1.2,-0.5,0.5] : [-0.3,c.p.span+0.3,-0.38,0.38],
    draw:(c,o) => drawAxial(c, o, '#dcbf8e', '#8f6d43', bands(c.p.val).map((b,i) => [[0.2,0.36,0.52,0.8][i], b]), c.p.span),
    tagAt:c => [c.p.span/2, -0.78], tag:c => `${c.p.name} ${fmtR(c.p.val)}`,
    sim:(c,N) => [{ t:'R', a:N[0], b:N[1], r:c.p.val, tag:'r' }],
    result:(c,E) => { const r = E.el('r'); return { v:r.v, i:r.i, p:Math.abs(r.v * r.i) }; },
    read:(c,r) => `${fmtU(Math.abs(r.v),'V')} · ${fmtU(Math.abs(r.i),'A')}<br>${fmtU(r.p,'W')} <span class="muted">de ${wattName(c.p.watt)}</span>`,
    checks:(c,r,add) => { if (r.p > c.p.watt) add('err', `${c.p.name} dissipa ${fmtU(r.p,'W')}, acima de ${wattName(c.p.watt)}. Use um resistor de potência maior ou aumente a resistência.`); else if (r.p > 0.7 * c.p.watt) add('warn', `${c.p.name} está em ${Math.round(r.p / c.p.watt * 100)}% da potência máxima e vai esquentar.`); },
    bom:c => `Resistor ${fmtR(c.p.val)} ${wattName(c.p.watt)}`,
    fields:c => [['val','Resistência','sel',(RVALS.includes(+c.p.val) ? RVALS : RVALS.concat([+c.p.val]).sort((a,b)=>a-b)).map(v => [v, fmtR(v)]),true],['valx','Outro valor (Ω)','num',{min:0.1,step:1,val:c.p.val}],['span','Espaçamento','sel',[1,2,3,4,5,6,7,8].map(v => [v, `${v} furo${v>1?'s':''} (${(v*2.54).toFixed(1)} mm)${v===1?' em pé':''}`]),true],['watt','Potência','sel',[[0.125,'1/8 W'],[0.25,'1/4 W'],[0.5,'1/2 W'],[1,'1 W'],[2,'2 W']],true]],
  };
  CT.pot = {
    prefix:'RV', label:c => `${c.p.pitch === 1 ? 'Trimpot' : 'Potenciômetro'} ${fmtR(c.p.val)}`, step:'pot',
    pins:c => [[0,0],[c.p.pitch,0],[2*c.p.pitch,0]], names:() => ['1','W','3'],
    box:c => [-0.7, 2*c.p.pitch+0.7, c.p.pitch === 1 ? -1.4 : -2.6, 0.5],
    draw:(c,o) => {
      const k = c.p.pitch, big = k === 2, col = CAPCOL[c.p.color] || '#2d5fc4';
      let s = `<polygon points="${boxPoly(c, -0.7, 2*k+0.7, big ? -2.6 : -1.4, 0.45)}" fill="${big ? '#4a4f56' : col}" stroke="#15171a" stroke-width="1.2"/>`;
      const ctr = big ? [k, -1.1] : [k, -0.5], rr = big ? 1.15 : 0.55;
      s += `<polygon points="${circPoly(c, ctr[0], ctr[1], rr)}" fill="${big ? col : '#e8e4d8'}" stroke="#15171a" stroke-width="1"/>`;
      const ang = (-135 + 270 * c.p.pos) * Math.PI / 180;
      s += line(vp(c, ctr[0], ctr[1]), vp(c, ctr[0] + Math.sin(ang) * rr * 0.85, ctr[1] - Math.cos(ang) * rr * 0.85), big ? '#fff' : '#333', 2.2);
      for (let i = 0; i < 3; i++) s += circ(vp(c, i*k, 0), P*0.12, LEAD);
      return s;
    },
    tagAt:c => [c.p.pitch, c.p.pitch === 1 ? -1.8 : -3.0], tag:c => `${c.p.name} ${fmtR(c.p.val)}`,
    sim:(c,N) => { const a = Math.max(1, c.p.val * c.p.pos), b = Math.max(1, c.p.val * (1 - c.p.pos)); return [{ t:'R', a:N[0], b:N[1], r:a, tag:'a' }, { t:'R', a:N[1], b:N[2], r:b, tag:'b' }]; },
    result:(c,E) => { const a = E.el('a'), b = E.el('b'); return { vw:E.V(c, 1), p:Math.abs(a.v*a.i) + Math.abs(b.v*b.i), i:Math.max(Math.abs(a.i), Math.abs(b.i)) }; },
    read:(c,r) => `cursor em ${Math.round(c.p.pos*100)}% · W = ${fmtU(r.vw,'V')}<br>${fmtU(r.p,'W')}`,
    checks:(c,r,add) => { if (r.p > 0.25) add('warn', `${c.p.name} dissipa ${fmtU(r.p,'W')}: potenciômetros comuns aguentam cerca de 0,25 W.`); },
    bom:c => `${c.p.pitch === 1 ? 'Trimpot' : 'Potenciômetro'} ${fmtR(c.p.val)} linear`,
    fields:c => [['val','Resistência','sel',[1000,5000,10000,50000,100000].map(v=>[v,fmtR(v)]),true],['pos','Posição','range',{min:0,max:1,step:0.01,fmt:v=>Math.round(v*100)+'%'}],['color','Cor','sel',selOpts(CAPCOL)]],
  };
  CT.ldr = {
    prefix:'LDR', label:() => 'LDR (sensor de luz)', step:'axial',
    pins:() => [[0,0],[1,0]], names:() => ['1','2'], box:() => [-0.5,1.5,-0.6,0.6],
    draw:(c,o) => {
      let s = line(vp(c,0,0), vp(c,1,0), LEAD, P*0.11);
      s += `<polygon points="${circPoly(c, 0.5, 0, 0.62)}" fill="#e7a24a" stroke="#8a5a1d" stroke-width="1.2"/>`;
      const pts = []; for (let k = 0; k <= 8; k++) pts.push(vp(c, 0.12 + k * 0.095, (k % 2 ? 0.28 : -0.28)));
      s += `<polyline points="${poly(pts)}" fill="none" stroke="#8a2d18" stroke-width="1.6"/>`;
      return s;
    },
    tagAt:() => [0.5,-1.0], tag:c => c.p.name,
    ohm:c => Math.pow(10, 6 - 3 * c.p.light / 100),
    sim:(c,N) => [{ t:'R', a:N[0], b:N[1], r:CT.ldr.ohm(c), tag:'r' }],
    result:(c,E) => { const r = E.el('r'); return { v:r.v, i:r.i, p:Math.abs(r.v*r.i) }; },
    read:(c,r) => `luz ${c.p.light}% → ${fmtR(CT.ldr.ohm(c))}<br>${fmtU(Math.abs(r.v),'V')} · ${fmtU(Math.abs(r.i),'A')}`,
    checks:(c,r,add) => { if (r.p > 0.1) add('warn', `${c.p.name} dissipa ${fmtU(r.p,'W')}: um LDR aguenta cerca de 0,1 W.`); },
    bom:() => 'LDR 5 mm (GL5528)',
    fields:() => [['light','Luz','range',{min:0,max:100,step:1,fmt:v=>`${v}% (${fmtR(Math.pow(10,6-3*v/100))})`}]],
  };
  CT.capc = {
    prefix:'C', label:c => `Capacitor ${CAPS[c.p.model].label}`, step:'capc',
    pins:c => [[0,0],[c.p.span,0]], names:() => ['1','2'], box:c => [-0.35, c.p.span+0.35, -0.55, 0.55],
    draw:(c,o) => {
      const k = c.p.span; let s = line(vp(c,0,0), vp(c,k,0), LEAD, P*0.11);
      const pts = []; for (let i = 0; i <= 30; i++) { const t = i/30*Math.PI*2; pts.push(vp(c, k/2 + (k/2+0.15)*Math.cos(t), 0.45*Math.sin(t))); }
      s += `<polygon points="${poly(pts)}" fill="${c.p.model === '22p' ? '#d98b2b' : '#e4a93a'}" stroke="#8a5a14" stroke-width="1.2"/>`;
      if (!o.thumb) s += txt(vp(c, k/2, 0), CAPS[c.p.model].code, 7.5, '#4a2d05');
      return s;
    },
    tagAt:c => [c.p.span/2,-0.95], tag:c => c.p.name,
    sim:() => [], result:(c,E) => ({ v:E.V(c,0) - E.V(c,1) }),
    read:(c,r) => `${CAPS[c.p.model].label} · ${fmtU(r.v,'V')} <span class="muted">(em DC não conduz)</span>`,
    checks:(c,r,add) => { const m = CAPS[c.p.model]; if (Math.abs(r.pk.v) > m.v) add('err', `${c.p.name} recebe ${fmtU(Math.abs(r.pk.v),'V')}, acima dos ${m.v} V dele.`); },
    bom:c => `Capacitor cerâmico ${CAPS[c.p.model].label} (${CAPS[c.p.model].code})`,
    fields:() => [['model','Valor','sel',['22p','100n','1u'].map(k=>[k,CAPS[k].label+' ('+CAPS[k].code+')'])],['span','Espaçamento','sel',[[1,'1 furo (2,54 mm)'],[2,'2 furos (5,08 mm)']],true]],
  };
  CT.cape = {
    prefix:'C', label:c => `Eletrolítico ${CAPS[c.p.model].label}`, step:'cape',
    pins:c => [[0,0],[CAPS[c.p.model].span,0]], names:() => ['+','−'],
    box:c => { const m = CAPS[c.p.model], s2 = m.span/2; return [s2-m.r, s2+m.r, -m.r, m.r]; },
    draw:(c,o) => {
      const m = CAPS[c.p.model], k = m.span; let s = '';
      s += `<polygon points="${circPoly(c, k/2, 0, m.r)}" fill="#20315c" stroke="#0e1730" stroke-width="1.4"/>`;
      const band = []; for (let i = 0; i <= 12; i++) { const t = -0.6 + i/12*1.2; band.push(vp(c, k/2 + m.r*Math.cos(t), m.r*Math.sin(t))); }
      for (let i = 12; i >= 0; i--) { const t = -0.6 + i/12*1.2; band.push(vp(c, k/2 + m.r*0.55*Math.cos(t) + m.r*0.2, m.r*0.9*Math.sin(t))); }
      s += `<polygon points="${poly(band)}" fill="#aeb8cc"/>`;
      s += circ(vp(c,0,0), P*0.12, LEAD) + circ(vp(c,k,0), P*0.12, LEAD);
      if (!o.thumb) { s += txt(vp(c, k/2 + m.r*0.72, 0), '−', 11, '#1b2745'); s += txt(vp(c, k/2 - m.r*0.3, 0), '+', 10, '#c9d3ea'); }
      return s;
    },
    tagAt:c => { const m = CAPS[c.p.model]; return [m.span/2, -m.r-0.4]; }, tag:c => c.p.name,
    sim:() => [], result:(c,E) => ({ v:E.V(c,0) - E.V(c,1) }),
    read:(c,r) => `${CAPS[c.p.model].label} · ${fmtU(r.v,'V')}`,
    checks:(c,r,add) => {
      const m = CAPS[c.p.model];
      if (r.pk.v < -0.5 || r.v < -0.5) add('err', `${c.p.name} está com a polaridade invertida (${fmtU(r.v,'V')}). Eletrolítico invertido estufa ou estoura: o lado da faixa (−) vai no potencial mais baixo.`);
      if (Math.abs(r.pk.v) > m.v) add('err', `${c.p.name} recebe ${fmtU(Math.abs(r.pk.v),'V')}, acima dos ${m.v} V dele.`);
      else if (Math.abs(r.pk.v) > 0.8 * m.v) add('warn', `${c.p.name} opera em ${Math.round(Math.abs(r.pk.v)/m.v*100)}% da tensão máxima. Use um de tensão maior para ter margem.`);
    },
    bom:c => `Capacitor eletrolítico ${CAPS[c.p.model].label}`,
    fields:() => [['model','Valor','sel',['10u','100u','470u','1000u'].map(k=>[k,CAPS[k].label])]],
  };
  CT.diode = {
    prefix:'D', label:c => `Diodo ${c.p.model}`, step:'axial',
    pins:c => [[0,0],[c.p.span,0]], names:() => ['A','K'],
    box:c => [-0.3, c.p.span+0.3, -0.38, 0.38],
    draw:(c,o) => { const m = DIO[c.p.model]; const glass = m.look === 'glass'; return drawAxial(c, o, glass ? '#e98a3a' : '#2a2a2c', glass ? '#9a4f14' : '#0d0d0e', [[0.84, glass ? '#1a1a1a' : '#d6d9de', 0.16]], c.p.span); },
    tagAt:c => [c.p.span/2,-0.78], tag:c => `${c.p.name} ${c.p.model}`,
    sim:(c,N) => [{ t:'D', a:N[0], k:N[1], m:DIO[c.p.model], tag:'d' }],
    result:(c,E) => { const d = E.el('d'); return { v:d.v, i:d.i, p:Math.abs(d.v*d.i) }; },
    read:(c,r) => { const m = DIO[c.p.model]; const st = m.zener && r.v < -m.bv*0.9 ? '<span class="tag act">regulando</span>' : r.i > 1e-4 ? '<span class="tag sat">conduzindo</span>' : '<span class="tag cut">bloqueando</span>'; return `${st}<br>${fmtU(r.v,'V')} · ${fmtU(r.i,'A')}`; },
    checks:(c,r,add) => {
      const m = DIO[c.p.model];
      if (Math.abs(r.pk.i) > m.imax) add('err', `${c.p.name} (${c.p.model}) conduz ${fmtU(Math.abs(r.pk.i),'A')}, acima de ${fmtU(m.imax,'A')}.`);
      if (m.zener && r.p > m.pmax) add('err', `${c.p.name} (zener) dissipa ${fmtU(r.p,'W')}, acima de ${m.pmax} W. Aumente o resistor em série.`);
      if (!m.zener && -r.pk.v > m.vr) add('err', `${c.p.name} recebe ${fmtU(-r.pk.v,'V')} reversos, acima dos ${m.vr} V.`);
    },
    bom:c => `Diodo ${c.p.model} (${DIO[c.p.model].desc})`,
    fields:() => [['model','Modelo','sel',Object.keys(DIO).map(k=>[k,`${k} · ${DIO[k].desc}`])],['span','Espaçamento','sel',[2,3,4,5,6].map(v=>[v,`${v} furos`]),true]],
  };
  CT.led = {
    prefix:'D', label:c => `LED ${LEDNAME[c.p.color]}`, step:'led',
    pins:() => [[0,0],[1,0]], names:() => ['A','K'],
    box:c => { const r = c.p.size === 3 ? 0.6 : 0.98; return [0.5-r, 0.5+r, -r, r]; },
    draw:(c,o,res) => {
      const col = LEDCOL[c.p.color] || '#f33', br = res ? res.bright : 0, R = c.p.size === 3 ? 0.6 : 0.98;
      let s = line(vp(c,0,0), vp(c,1,0), LEAD, P*0.11);
      if (br > 0.03 && !o.faint && !o.ghost && !o.thumb) s += circ(vp(c,0.5,0), P*(R + br*0.9), col, `opacity="${0.25 + br*0.55}" filter="url(#fGlow)"`);
      s += `<polygon points="${circPoly(c, 0.5, 0, R, R*0.84)}" fill="${col}" fill-opacity="${0.32 + br*0.68}" stroke="${col}" stroke-width="1.5"/>`;
      s += circ(vp(c,0.28,-0.3*R/0.98), P*0.16*R/0.98, '#fff', `opacity="${0.35 + br*0.5}"`);
      if (!o.thumb) s += txt(vp(c,-0.05,0.62), '+', 10, '#e9f5ec');
      return s;
    },
    tagAt:c => [0.5, c.p.size === 3 ? -0.95 : -1.3], tag:c => c.p.name,
    sim:(c,N) => { const nvt = 2*VT, vf = LEDVF[c.p.color] || 1.9; return [{ t:'D', a:N[0], k:N[1], m:{ Is:0.01/Math.exp(vf/nvt), n:2, rs:12 }, tag:'d' }]; },
    result:(c,E) => { const d = E.el('d'); return { v:d.v, i:d.i, bright:clamp(d.i/0.012, 0, 1) }; },
    read:(c,r) => `${r.i > 5e-4 ? `<span class="tag sat">aceso ${Math.round(r.bright*100)}%</span>` : '<span class="tag cut">apagado</span>'}<br>${fmtU(r.v,'V')} · ${fmtU(r.i,'A')}`,
    checks:(c,r,add) => {
      const ip = r.pk.i, vf = LEDVF[c.p.color] || 1.9;
      if (ip > 0.03) add('err', `${c.p.name} recebe ${fmtU(ip,'A')} e vai queimar. Coloque um resistor em série de pelo menos (V − ${vf} V) ÷ 0,015 A.`);
      else if (ip > 0.02) add('warn', `${c.p.name} está com ${fmtU(ip,'A')}, no limite de 20 mA.`);
      if (r.pk.v < -5) add('err', `${c.p.name} recebe ${fmtU(-r.pk.v,'V')} ao contrário. LEDs aguentam só uns 5 V reversos.`);
    },
    bom:c => `LED ${c.p.size || 5} mm ${LEDNAME[c.p.color]}`,
    fields:() => [['color','Cor','sel',Object.keys(LEDCOL).map(k=>[k,`${LEDNAME[k]} (~${LEDVF[k]} V)`])],['size','Tamanho','sel',[[5,'5 mm'],[3,'3 mm']],true]],
  };
  CT.bjt = {
    prefix:'Q', label:c => `Transistor ${c.p.model}`, step:c => BJT[c.p.model].pkg === 'TO220' ? 'to220' : 'to92',
    pins:() => [[0,0],[1,0],[2,0]], names:c => semiNames(c, BJT[c.p.model].pinout),
    box:c => BJT[c.p.model].pkg === 'TO220' ? [-1.0,3.0,-2.15,0.45] : [-0.3,2.3,-1.0,0.45],
    draw:(c,o) => BJT[c.p.model].pkg === 'TO220' ? drawTO220(c, o, c.p.model, CT.bjt.names(c)) : drawTO92(c, o, c.p.model, CT.bjt.names(c)),
    tagAt:c => [1, BJT[c.p.model].pkg === 'TO220' ? -2.55 : -1.3], tag:c => c.p.name,
    sim:(c,N) => {
      const m = BJT[c.p.model], nm = CT.bjt.names(c), k = {}; nm.forEach((n,i) => k[n] = N[i]);
      if (!m.dar) return [{ t:'Q', c:k.C, b:k.B, e:k.E, m, tag:'q' }];
      const x = 'x' + c.id;
      return [{ t:'Q', c:k.C, b:k.B, e:x, m, tag:'q1' }, { t:'Q', c:k.C, b:x, e:k.E, m, tag:'q2' }, { t:'R', a:k.B, b:x, r:8000, tag:'rb' }, { t:'R', a:x, b:k.E, r:120, tag:'re' }];
    },
    result:(c,E) => {
      const m = BJT[c.p.model], p = m.pol; let ic, ib, vb, vc, ve;
      if (!m.dar) { const q = E.el('q'); ic = q.ic; ib = q.ib; vb = q.vb; vc = q.vc; ve = q.ve; }
      else { const q1 = E.el('q1'), q2 = E.el('q2'), rb = E.el('rb'); ic = q1.ic + q2.ic; ib = q1.ib + rb.i; vb = q1.vb; vc = q1.vc; ve = q2.ve; }
      const vbe = p*(vb - ve), vce = p*(vc - ve), icp = p*ic, ibp = p*ib;
      let region = 'Corte';
      if (vbe > (m.dar ? 1.0 : 0.55) && ibp > 1e-7) region = vce < (m.dar ? 0.95 : 0.25) ? 'Saturação' : 'Ativo';
      if (vce < -0.1) region = 'Invertido';
      return { vbe, vce, ic:icp, ib:ibp, p:Math.abs(vce*icp) + Math.abs(vbe*ibp), region };
    },
    read:(c,r) => { const cls = { 'Saturação':'sat', 'Ativo':'act', 'Corte':'cut', 'Invertido':'bad' }[r.region]; return `<span class="tag ${cls}">${r.region}</span>${r.regions ? `<span class="muted">${r.regions}</span>` : ''}<br>Ic ${fmtU(r.ic,'A')} · Ib ${fmtU(r.ib,'A')}<br>Vbe ${fmtU(r.vbe,'V')} · Vce ${fmtU(r.vce,'V')}<br>P ${fmtU(r.p,'W')}${r.ib > 1e-7 && r.region !== 'Corte' ? ` · Ic/Ib ${(r.ic/r.ib).toFixed(0)}` : ''}`; },
    checks:(c,r,add) => {
      const m = BJT[c.p.model], nm = c.p.name;
      if (r.pk.ic > m.icmax) add('err', `${nm} (${c.p.model}) conduz ${fmtU(r.pk.ic,'A')} no coletor, acima de ${fmtU(m.icmax,'A')}. Use um transistor maior (TIP120) ou um MOSFET.`);
      if (r.p > m.pmax) add('err', `${nm} dissipa ${fmtU(r.p,'W')}, acima de ${fmtU(m.pmax,'W')}${m.pkg === 'TO220' ? ' sem dissipador' : ''}.`);
      if (r.pk.vce > m.vceo) add('err', `${nm} recebe ${fmtU(r.pk.vce,'V')} entre coletor e emissor, acima de ${m.vceo} V.`);
      if (r.pk.vbe < -5) add('err', `${nm}: a junção base‑emissor está polarizada ao contrário com ${fmtU(-r.pk.vbe,'V')} (máx. ~5 V).`);
      if (r.region === 'Invertido') add('warn', `${nm} está funcionando invertido (coletor e emissor trocados?). Confira a pinagem ${CT.bjt.names(c).join('‑')}.`);
      if (r.region === 'Ativo' && r.ic > 1e-3 && r.vce < 2) add('warn', `${nm} está quase saturado (Vce ${fmtU(r.vce,'V')}). Para chavear, aumente a corrente de base com um resistor de base menor.`);
      else if (r.region === 'Ativo' && r.p > 0.3 * m.pmax) add('warn', `${nm} está no modo ativo dissipando ${fmtU(r.p,'W')}: vai esquentar. Como chave ele deve saturar.`);
      if (r.region === 'Saturação' && !m.dar && r.ib > 0 && r.ic / r.ib > 12) add('info', `${nm} satura com pouca folga (Ic/Ib ≈ ${(r.ic/r.ib).toFixed(0)}). A regra prática para chave é Ic/Ib ≤ 10.`);
    },
    bom:c => `Transistor ${c.p.model} (${BJT[c.p.model].desc})`,
    fields:c => [['model','Modelo','sel',Object.keys(BJT).map(k=>[k,`${k} · ${BJT[k].desc}`])],['pinout','Pinagem','sel',permOpts.map(p=>[p, p.split('').join('‑') + (p === BJT[c.p.model].pinout ? ' (padrão)' : '')])]],
  };
  CT.mos = {
    prefix:'Q', label:c => `MOSFET ${c.p.model}`, step:c => MOS[c.p.model].pkg === 'TO220' ? 'to220' : 'to92',
    pins:() => [[0,0],[1,0],[2,0]], names:c => semiNames(c, MOS[c.p.model].pinout),
    box:c => MOS[c.p.model].pkg === 'TO220' ? [-1.0,3.0,-2.15,0.45] : [-0.3,2.3,-1.0,0.45],
    draw:(c,o) => MOS[c.p.model].pkg === 'TO220' ? drawTO220(c, o, c.p.model, CT.mos.names(c)) : drawTO92(c, o, c.p.model, CT.mos.names(c)),
    tagAt:c => [1, MOS[c.p.model].pkg === 'TO220' ? -2.55 : -1.3], tag:c => c.p.name,
    sim:(c,N) => { const m = MOS[c.p.model], nm = CT.mos.names(c), k = {}; nm.forEach((n,i) => k[n] = N[i]); return [{ t:'M', d:k.D, g:k.G, s:k.S, m, tag:'m' }, { t:'D', a:k.S, k:k.D, m:{ Is:1e-12, n:1, rs:0.01 }, tag:'body' }]; },
    result:(c,E) => { const m = MOS[c.p.model], q = E.el('m'), bd = E.el('body'); const id = q.id - bd.i; const on = q.vgs > m.vth; const region = !on ? 'Corte' : q.vds < q.vgs - m.vth ? 'Conduzindo' : 'Linear'; return { vgs:q.vgs, vds:q.vds, id, p:Math.abs(q.vds*id), region, rds: on && Math.abs(id) > 1e-6 ? q.vds/id : null }; },
    read:(c,r) => { const cls = { 'Conduzindo':'sat', 'Linear':'act', 'Corte':'cut' }[r.region]; return `<span class="tag ${cls}">${r.region}</span>${r.regions ? `<span class="muted">${r.regions}</span>` : ''}<br>Id ${fmtU(r.id,'A')} · Vgs ${fmtU(r.vgs,'V')}<br>Vds ${fmtU(r.vds,'V')}${r.rds != null ? ` · Rds ${fmtR(Math.max(r.rds,0.001))}` : ''}<br>P ${fmtU(r.p,'W')}`; },
    checks:(c,r,add) => {
      const m = MOS[c.p.model], nm = c.p.name;
      if (Math.abs(r.pk.vgs) > m.vgsmax) add('err', `${nm}: Vgs de ${fmtU(Math.abs(r.pk.vgs),'V')} passa do máximo de ±${m.vgsmax} V e rompe o gate.`);
      if (Math.abs(r.pk.id) > m.idmax) add('err', `${nm} conduz ${fmtU(Math.abs(r.pk.id),'A')}, acima de ${m.idmax} A.`);
      if (r.pk.vds > m.vdsmax) add('err', `${nm} recebe ${fmtU(r.pk.vds,'V')} entre dreno e source, acima de ${m.vdsmax} V.`);
      if (r.p > m.pfree) add('err', `${nm} dissipa ${fmtU(r.p,'W')}. Sem dissipador ele aguenta cerca de ${m.pfree} W.`);
      else if (r.p > 0.5 * m.pfree) add('warn', `${nm} dissipa ${fmtU(r.p,'W')}: vai esquentar bastante sem dissipador.`);
      if (!m.logic && r.pk.vgs < 8 && Math.abs(r.pk.id) > 0.3) add('warn', `${nm} (${c.p.model}) não é de nível lógico: com Vgs de ${fmtU(r.pk.vgs,'V')} ele não abre totalmente. Use IRLZ44N ou um driver de 10–12 V no gate.`);
      if (r.region === 'Linear' && r.p > 0.3) add('warn', `${nm} está na região linear: ele esquenta em vez de chavear. Aumente a tensão no gate.`);
    },
    bom:c => `MOSFET ${c.p.model} (${MOS[c.p.model].desc})`,
    fields:c => [['model','Modelo','sel',Object.keys(MOS).map(k=>[k,`${k} · ${MOS[k].desc}`])],['pinout','Pinagem','sel',['GDS','GSD','DGS','DSG','SGD','SDG'].map(p=>[p, p.split('').join('‑') + (p === MOS[c.p.model].pinout ? ' (padrão)' : '')])]],
  };
  CT.reg = {
    prefix:'U', label:c => `Regulador ${c.p.model}`, step:'to220',
    pins:() => [[0,0],[1,0],[2,0]], names:c => REG[c.p.model].pins,
    box:() => [-1.0,3.0,-2.15,0.45],
    draw:(c,o) => drawTO220(c, o, c.p.model, REG[c.p.model].pins.map(n => n === 'GND' ? 'G' : n === 'OUT' ? 'O' : 'I')),
    tagAt:() => [1,-2.55], tag:c => c.p.name,
    sim:(c,N) => { const m = REG[c.p.model], k = {}; m.pins.forEach((n,i) => k[n] = N[i]); return [{ t:'REG', in:k.IN, gnd:k.GND, out:k.OUT, m, tag:'u' }]; },
    result:(c,E) => { const u = E.el('u'); return { vin:u.vin, vout:u.vout, iout:u.iout, p:Math.max(0,(u.vin - u.vout)*u.iout), region:u.region }; },
    read:(c,r) => `<span class="tag ${r.region === 'reg' ? 'sat' : r.region === 'drop' ? 'wrn' : 'cut'}">${r.region === 'reg' ? 'regulando' : r.region === 'drop' ? 'sem margem' : 'desligado'}</span><br>entrada ${fmtU(r.vin,'V')} → saída ${fmtU(r.vout,'V')}<br>${fmtU(r.iout,'A')} · P ${fmtU(r.p,'W')}`,
    checks:(c,r,add) => {
      const m = REG[c.p.model], nm = c.p.name;
      if (r.pk.vin > m.vinmax) add('err', `${nm}: entrada de ${fmtU(r.pk.vin,'V')} acima do máximo de ${m.vinmax} V.`);
      if (r.region === 'drop') add('warn', `${nm} não consegue regular: a entrada precisa de pelo menos ${f1(m.vnom + m.drop)} V (tem ${fmtU(r.vin,'V')}).`);
      if (r.pk.iout > m.imax) add('err', `${nm} fornece ${fmtU(r.pk.iout,'A')}, acima de ${m.imax} A.`);
      if (r.p > 2) add('err', `${nm} dissipa ${fmtU(r.p,'W')}. Sem dissipador passa de 2 W e desliga por temperatura.`);
      else if (r.p > 1) add('warn', `${nm} dissipa ${fmtU(r.p,'W')}: use dissipador.`);
      if (r.iout < -1e-3) add('warn', `${nm} está recebendo corrente na saída: há outra fonte empurrando tensão para ele.`);
    },
    bom:c => `Regulador ${c.p.model} (${REG[c.p.model].desc})`,
    fields:() => [['model','Modelo','sel',Object.keys(REG).map(k=>[k,`${k} · ${REG[k].desc}`])]],
  };
  CT.term = {
    prefix:'J', label:c => `Borne ${c.p.ways} vias`, step:'term',
    pins:c => c.p.ways === 3 ? [[0,0],[2,0],[4,0]] : [[0,0],[2,0]],
    names:c => c.p.ways === 3 ? ['1','2','3'] : (c.p.mode === 'src' || c.p.mode === 'pwm') ? ['+','−'] : ['1','2'],
    box:c => [-0.95, (c.p.ways - 1)*2 + 0.95, -1.75, 0.85],
    draw:(c,o) => {
      const [fill, edge] = TERMCOL[c.p.color] || TERMCOL.azul, w = c.p.ways, nm = CT.term.names(c);
      let s = `<polygon points="${boxPoly(c, -0.95, (w-1)*2 + 0.95, -1.75, 0.85)}" fill="${fill}" stroke="${edge}" stroke-width="1.5"/>`;
      for (let i = 0; i < w; i++) {
        const a = i*2;
        s += line(vp(c, a-0.42, -1.45), vp(c, a+0.42, -1.45), '#0f1a2b', P*0.36, 'stroke-linecap="butt"');
        s += circ(vp(c, a, 0), P*0.5, 'url(#gSolder)', 'stroke="#6f767e" stroke-width="1"');
        s += line(vp(c, a-0.32, -0.32), vp(c, a+0.32, 0.32), '#4b5159', 2);
        if (!o.thumb) s += txt(vp(c, a, -0.85), nm[i], 10, '#fff');
      }
      if (!o.thumb && w === 2) { const md = c.p.mode === 'src' ? (c.p.on ? (+c.p.v).toFixed(1)+'V' : 'desl.') : c.p.mode === 'pwm' ? `PWM ${c.p.duty}%` : c.p.mode === 'load' ? fmtR(c.p.rload) : '—'; s += txt(vp(c, 1, -0.85), md, 8, '#dce8ff'); }
      return s;
    },
    tagAt:c => [(c.p.ways-1), -2.2], tag:c => c.p.name,
    sim:(c,N) => {
      if (c.p.ways !== 2) return [];
      if (c.p.mode === 'src' && c.p.on) return [{ t:'V', p:N[0], n:N[1], v:+c.p.v || 0, tag:'v' }];
      if (c.p.mode === 'pwm' && c.p.on) return [{ t:'V', p:N[0], n:N[1], v:+c.p.v || 0, duty:clamp(c.p.duty/100, 0, 1), tag:'v' }];
      if (c.p.mode === 'load') return [{ t:'R', a:N[0], b:N[1], r:c.p.rload, tag:'r' }];
      return [];
    },
    result:(c,E) => {
      if (c.p.ways !== 2) return {};
      if ((c.p.mode === 'src' || c.p.mode === 'pwm') && c.p.on) { const v = E.el('v'); return { i:v.i, p:v.i*v.v }; }
      if (c.p.mode === 'load') { const r = E.el('r'); return { v:r.v, i:r.i, p:Math.abs(r.v*r.i) }; }
      return { v:E.V(c,0) - E.V(c,1) };
    },
    read:(c,r) => {
      if (c.p.ways !== 2) return 'conector (sem função elétrica)';
      if (c.p.mode === 'src' || c.p.mode === 'pwm') return `<button class="sw${c.p.on ? ' on' : ''}" data-toggle="${c.id}"><i></i>${(+c.p.v).toFixed(1)} V${c.p.mode === 'pwm' ? ` · PWM ${c.p.duty}%` : ''}</button>${c.p.on ? ` fornece ${fmtU(r.i,'A')} · ${fmtU(r.p,'W')}` : ' desligada'}`;
      if (c.p.mode === 'load') return `${c.p.kind === 'ind' ? 'carga indutiva' : 'carga'} ${fmtR(c.p.rload)} · ${fmtU(r.v,'V')} · ${fmtU(r.i,'A')} · ${fmtU(r.p,'W')}`;
      return `aberto · ${fmtU(r.v,'V')} entre pinos`;
    },
    checks:(c,r,add) => { if ((c.p.mode === 'src' || c.p.mode === 'pwm') && r.i < -1e-3) add('warn', `${c.p.name}: a fonte está recebendo corrente (${fmtU(-r.i,'A')}). Outra fonte de tensão maior está ligada contra ela.`); },
    bom:c => `Borne KF301 ${c.p.ways} vias (passo 5,08 mm)`,
    fields:c => {
      const f = [['ways','Vias','sel',[[2,'2 vias'],[3,'3 vias']],true],['color','Cor','sel',selOpts(TERMCOL)]];
      if (c.p.ways !== 2) return f;
      f.push(['mode','Função','sel',[['src','Fonte DC'],['pwm','Sinal PWM'],['load','Carga externa'],['open','Aberto / conector']]]);
      if (c.p.mode === 'src' || c.p.mode === 'pwm') { f.push(['preset','Predefinição','sel',[['','escolher…'],[3.3,'3,3 V'],[3.7,'3,7 V (Li‑ion)'],[5,'5 V (USB)'],[6,'6 V (4 pilhas AA)'],[9,'9 V (bateria)'],[12,'12 V (fonte)'],[24,'24 V']]]); f.push(['v','Tensão (V)','num',{min:0,max:60,step:0.1}]); if (c.p.mode === 'pwm') f.push(['duty','Ciclo ativo','range',{min:0,max:100,step:1,fmt:v=>v+'%'}]); f.push(['on','Ligada','toggle']); }
      if (c.p.mode === 'load') { f.push(['rload','Resistência (Ω)','num',{min:0.1,step:1}]); f.push(['kind','Tipo de carga','sel',[['res','Resistiva (lâmpada, aquecedor, eletrodo)'],['ind','Indutiva (motor, bobina, solenoide)']]]); }
      return f;
    },
  };
  CT.header = {
    prefix:'H', label:c => `Barra de pinos 1×${c.p.n}`, step:'hdr',
    pins:c => Array.from({ length:c.p.n }, (_, i) => [i, 0]), names:c => Array.from({ length:c.p.n }, (_, i) => String(i+1)),
    box:c => [-0.5, c.p.n - 0.5, -0.5, 0.5],
    draw:(c,o) => {
      const f = c.p.female;
      let s = `<polygon points="${boxPoly(c, -0.5, c.p.n - 0.5, -0.5, 0.5)}" fill="#1c1d20" stroke="#000" stroke-width="1"/>`;
      for (let i = 0; i < c.p.n; i++) { const p = vp(c, i, 0); s += f ? `<rect x="${n1(p[0]-4)}" y="${n1(p[1]-4)}" width="8" height="8" fill="#050506"/>` : `<rect x="${n1(p[0]-3.5)}" y="${n1(p[1]-3.5)}" width="7" height="7" fill="#d9b45a" stroke="#8a6d25" stroke-width=".8"/>`; }
      return s;
    },
    tagAt:c => [(c.p.n-1)/2, -0.95], tag:c => c.p.name,
    sim:() => [], result:() => ({}), read:() => '',
    bom:c => `Barra de pinos ${c.p.female ? 'fêmea' : 'macho'} 1×${c.p.n}`,
    fields:() => [['n','Pinos','sel',[1,2,3,4,5,6,8,10].map(v=>[v,String(v)]),true],['female','Tipo','sel',[[false,'Macho'],[true,'Fêmea']],'bool']],
  };
  CT.btn = {
    prefix:'SW', label:() => 'Botão táctil 6×6', step:'sw',
    pins:() => [[0,0],[3,0],[0,2],[3,2]], names:() => ['A1','A2','B1','B2'], box:() => [-0.35,3.35,-0.35,2.35],
    internal:[[0,1],[2,3]],
    draw:(c,o) => {
      let s = `<polygon points="${boxPoly(c, -0.3, 3.3, -0.3, 2.3)}" fill="#2a2c30" stroke="#0e0f11" stroke-width="1.4"/>`;
      for (const [a,b] of [[0,0],[3,0],[0,2],[3,2]]) s += circ(vp(c,a,b), P*0.13, LEAD);
      s += `<polygon points="${circPoly(c, 1.5, 1, c.p.pressed ? 0.62 : 0.72)}" fill="${CAPCOL[c.p.color] || '#27292d'}" stroke="#000" stroke-width="1" ${c.p.pressed ? 'opacity=".75"' : ''}/>`;
      return s;
    },
    tagAt:() => [1.5,-0.8], tag:c => c.p.name,
    sim:(c,N) => c.p.pressed ? [{ t:'R', a:N[0], b:N[2], r:0.05, tag:'r' }] : [],
    result:() => ({}), read:c => `<button class="sw${c.p.pressed ? ' on' : ''}" data-press="${c.id}"><i></i>${c.p.pressed ? 'Pressionado' : 'Solto'}</button>`,
    bom:() => 'Botão táctil 6×6 mm (4 terminais)',
    fields:() => [['pressed','Pressionado','toggle'],['color','Cor','sel',selOpts(CAPCOL)]],
  };
  CT.sw = {
    prefix:'SW', label:() => 'Chave deslizante SPDT', step:'sw',
    pins:() => [[0,0],[1,0],[2,0]], names:() => ['1','C','2'], box:() => [-0.7,2.7,-0.6,0.6],
    draw:(c,o) => {
      let s = `<polygon points="${boxPoly(c, -0.7, 2.7, -0.55, 0.55)}" fill="#2b5aa8" stroke="#122a52" stroke-width="1.3"/>`;
      const a = c.p.pos ? 1.45 : 0.55;
      s += `<polygon points="${boxPoly(c, a-0.35, a+0.35, -0.3, 0.3)}" fill="#e7e7e2" stroke="#555" stroke-width="1"/>`;
      return s;
    },
    tagAt:() => [1,-1.0], tag:c => c.p.name,
    sim:(c,N) => [{ t:'R', a:N[1], b:c.p.pos ? N[2] : N[0], r:0.05, tag:'r' }],
    result:() => ({}), read:c => `<button class="sw on" data-flip="${c.id}"><i></i>C ↔ ${c.p.pos ? '2' : '1'}</button>`,
    bom:() => 'Chave deslizante SPDT (3 terminais)',
    fields:() => [['pos','Posição','sel',[[0,'C ligado ao 1'],[1,'C ligado ao 2']],true]],
  };
  CT.relay = {
    prefix:'K', label:() => 'Relé 5 V (SRD‑05VDC)', step:'big',
    pins:() => [[0,2],[1,0],[1,4],[6,0],[6,4]], names:() => ['COM','B1','B2','NC','NO'], box:() => [-0.8,6.8,-0.8,4.8],
    inductive:[1,2],
    draw:(c,o,res) => {
      const on = res && res.on > 0.5;
      let s = `<polygon points="${boxPoly(c, -0.8, 6.8, -0.8, 4.8)}" fill="#1f5bc4" stroke="#0f2f6b" stroke-width="1.5"/>`;
      for (const [a,b] of [[0,2],[1,0],[1,4],[6,0],[6,4]]) s += circ(vp(c,a,b), P*0.13, LEAD);
      if (!o.thumb) { s += txt(vp(c, 3.5, 1.4), 'SRD‑05VDC', 8.5, '#e8efff'); s += txt(vp(c, 3.5, 2.4), on ? 'ATIVADO' : 'desligado', 9, on ? '#9ff0b7' : '#b9c8ea'); ['COM','B1','B2','NC','NO'].forEach((n,i) => { const pp = [[0,2],[1,0],[1,4],[6,0],[6,4]][i]; s += txt(vp(c, pp[0] + (pp[0] === 6 ? -0.75 : 0.75), pp[1]), n, 7, '#e8efff'); }); }
      return s;
    },
    tagAt:() => [3,-1.25], tag:c => c.p.name,
    sim:(c,N) => [{ t:'R', a:N[1], b:N[2], r:70, tag:'coil' }, { t:'RC', a:N[0], b:N[4], relay:c.id, when:true, tag:'no' }, { t:'RC', a:N[0], b:N[3], relay:c.id, when:false, tag:'nc' }],
    result:(c,E) => { const k = E.el('coil'), on = E.relay(c.id); const ct = on ? E.el('no') : E.el('nc'); return { v:k.v, i:k.i, on:on ? 1 : 0, ic:ct ? ct.i : 0 }; },
    read:(c,r) => `<span class="tag ${r.on > 0.5 ? 'sat' : 'cut'}">${r.on > 0.99 ? 'ativado' : r.on > 0.01 ? `ativado ${Math.round(r.on*100)}% do tempo` : 'desligado'}</span><br>bobina ${fmtU(Math.abs(r.v),'V')} · ${fmtU(Math.abs(r.i),'A')}<br>COM ligado ao ${r.on > 0.5 ? 'NO' : 'NC'} · ${fmtU(Math.abs(r.ic),'A')}`,
    checks:(c,r,add) => {
      const v = Math.abs(r.v);
      if (v > 6.5) add('err', `${c.p.name}: bobina de 5 V recebendo ${fmtU(v,'V')}.`);
      if (r.on < 0.5 && v > 2 && v < 3.75) add('warn', `${c.p.name}: a bobina recebe só ${fmtU(v,'V')} e não aciona (precisa de ~3,75 V).`);
      if (r.on > 0.01 && r.on < 0.99) add('warn', `${c.p.name} está recebendo PWM e vai ficar batendo. Relé não serve para PWM.`);
      if (Math.abs(r.pk.ic) > 10) add('err', `${c.p.name}: ${fmtU(Math.abs(r.pk.ic),'A')} nos contatos, acima de 10 A.`);
    },
    bom:() => 'Relé SRD‑05VDC‑SL‑C (bobina 5 V, contato 10 A)',
    fields:() => [],
  };
  CT.motor = {
    prefix:'M', label:() => 'Motor DC pequeno', step:'big',
    pins:() => [[0,0],[2,0]], names:() => ['+','−'], box:() => [-0.4,2.4,-2.6,0.3], inductive:[0,1],
    draw:(c,o,res) => {
      let s = line(vp(c,0,0), vp(c,0,-0.6), LEAD, P*0.11) + line(vp(c,2,0), vp(c,2,-0.6), LEAD, P*0.11);
      s += `<polygon points="${circPoly(c, 1, -1.3, 1.25)}" fill="#a9afb6" stroke="#5c6269" stroke-width="1.4"/>`;
      s += circ(vp(c,1,-1.3), P*0.32, '#d8dce0', 'stroke="#5c6269"');
      const run = res && Math.abs(res.i) > 0.05;
      if (!o.thumb) s += txt(vp(c,1,-1.3), run ? '↻' : 'M', 11, '#2a2e33');
      return s;
    },
    tagAt:() => [1,-3.0], tag:c => c.p.name,
    sim:(c,N) => [{ t:'R', a:N[0], b:N[1], r:c.p.r, tag:'r' }],
    result:(c,E) => { const r = E.el('r'); return { v:r.v, i:r.i, p:Math.abs(r.v*r.i) }; },
    read:(c,r) => `${Math.abs(r.i) > 0.05 ? `<span class="tag sat">girando ${r.v < 0 ? 'ao contrário ' : ''}~${Math.round(clamp(Math.abs(r.v)/c.p.vnom,0,1.5)*100)}%</span>` : '<span class="tag cut">parado</span>'}<br>${fmtU(r.v,'V')} · ${fmtU(r.i,'A')}`,
    checks:(c,r,add) => { if (Math.abs(r.v) > c.p.vnom * 1.3) add('warn', `${c.p.name}: motor de ${c.p.vnom} V recebendo ${fmtU(Math.abs(r.v),'V')}.`); },
    bom:c => `Motor DC ${c.p.vnom} V`,
    fields:() => [['vnom','Tensão nominal','sel',[[3,'3 V'],[5,'5 V'],[6,'6 V'],[12,'12 V']],true],['r','Resistência (Ω)','num',{min:0.5,step:0.5}]],
  };
  CT.buzzer = {
    prefix:'BZ', label:() => 'Buzzer ativo 5 V', step:'big',
    pins:() => [[0,0],[3,0]], names:() => ['+','−'], box:() => [-0.8,3.8,-2.3,2.3],
    draw:(c,o,res) => {
      let s = `<polygon points="${circPoly(c, 1.5, 0, 2.3)}" fill="#1d1e21" stroke="#000" stroke-width="1.4"/>`;
      s += circ(vp(c,1.5,0), P*0.35, '#050506');
      if (!o.thumb) s += txt(vp(c,0,-1.0), '+', 12, '#e9f5ec');
      if (!o.thumb && res && res.i > 0.01) s += txt(vp(c,1.5,1.35), '♪', 12, '#ffd166');
      return s;
    },
    tagAt:() => [1.5,-2.7], tag:c => c.p.name,
    sim:(c,N) => [{ t:'D', a:N[0], k:'z' + c.id, m:{ Is:1e-12, n:1.2 }, tag:'d' }, { t:'R', a:'z' + c.id, b:N[1], r:150, tag:'r' }],
    result:(c,E) => { const r = E.el('r'); return { i:r.i, v:E.V(c,0) - E.V(c,1) }; },
    read:(c,r) => `${r.i > 0.01 ? '<span class="tag sat">apitando</span>' : '<span class="tag cut">mudo</span>'}<br>${fmtU(r.v,'V')} · ${fmtU(r.i,'A')}`,
    checks:(c,r,add) => { if (r.v < -0.5) add('info', `${c.p.name} está com a polaridade invertida e não apita.`); if (r.v > 7) add('warn', `${c.p.name}: buzzer de 5 V recebendo ${fmtU(r.v,'V')}.`); },
    bom:() => 'Buzzer ativo 5 V 12 mm', fields:() => [],
  };
  for (const [, items] of LIB) for (const it of items) LIBMAP[it[0]] = it;
}
registerParts();
