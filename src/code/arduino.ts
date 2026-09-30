// @ts-nocheck
import { app } from '../state';
import { $, clamp, esc } from '../core/base';
import { MCU, analyze, mcuById, mcuCaps, mk, mkSplit } from '../core/analysis';
import { simulate } from '../sim/solver';
import { renderItems, renderOverlay } from '../ui/render';
import { changed, renderStatus, renderTabs, say } from '../ui/panels';
import { pressBtn } from '../ui/interaction';
import { flushSave, scheduleSave } from '../app/projects';

// ════════════════════════ Código Arduino: interpretador de C/C++ ════════════════════════
// Subconjunto do C++ usado em sketches: tipos básicos, arrays, funções, if/for/while/switch, String,
// Serial e a API do Arduino. O código roda num relógio virtual e conversa com a simulação do circuito.
export class CodeErr extends Error { constructor(line, msg) { super(msg); this.line = line; } }

export const TYPEWORDS = new Set(['void', 'bool', 'boolean', 'char', 'byte', 'int', 'short', 'long', 'float', 'double', 'String', 'word', 'size_t', 'uint8_t', 'int8_t', 'uint16_t', 'int16_t', 'uint32_t', 'int32_t', 'unsigned', 'signed']);
export const QUALWORDS = new Set(['const', 'static', 'volatile']);
export const LIBS_OK = new Set(['Arduino.h', 'math.h', 'stdint.h', 'stdlib.h']);
export function escChar(c) { return { n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', "'": "'", '"': '"' }[c] ?? c; }

export function lex(src) {
  const toks = [], n = src.length; let i = 0, line = 1;
  const push = (t, v, extra) => toks.push(Object.assign({ t, v, line }, extra));
  const OPS = ['<<=', '>>=', '++', '--', '==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '->', '::'];
  while (i < n) {
    const ch = src[i];
    if (ch === '\n') { line++; i++; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue; }
    if (ch === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (ch === '/' && src[i + 1] === '*') { const l0 = line; i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; } if (i >= n) throw new CodeErr(l0, 'Comentário /* aberto e nunca fechado com */.'); i += 2; continue; }
    if (ch === '#') { let j = i; while (j < n && src[j] !== '\n') j++; push('pp', src.slice(i, j).trim()); i = j; continue; }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)([uUlLfF]*)/.exec(src.slice(i));
      const txt = m[1], suf = m[2].toLowerCase(); let v, isFloat = false;
      if (/^0[xX]/.test(txt)) v = parseInt(txt.slice(2), 16); else if (/^0[bB]/.test(txt)) v = parseInt(txt.slice(2), 2); else { v = parseFloat(txt); isFloat = /[.eE]/.test(txt) || suf.includes('f'); }
      push('num', v, { isFloat, suf }); i += m[0].length; continue;
    }
    if (ch === '"') { let j = i + 1, s = ''; while (j < n && src[j] !== '"') { if (src[j] === '\n') throw new CodeErr(line, 'Texto entre aspas sem fechar (falta o " no fim).'); if (src[j] === '\\') { s += escChar(src[j + 1]); j += 2; } else s += src[j++]; } if (j >= n) throw new CodeErr(line, 'Texto entre aspas sem fechar.'); push('str', s); i = j + 1; continue; }
    if (ch === "'") { let j = i + 1, c; if (src[j] === '\\') { c = escChar(src[j + 1]); j += 2; } else c = src[j++]; if (src[j] !== "'") throw new CodeErr(line, "Caractere entre aspas simples mal formado: use 'a'."); push('chr', c.charCodeAt(0)); i = j + 1; continue; }
    if (/[A-Za-z_]/.test(ch)) { let j = i; while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++; push('id', src.slice(i, j)); i = j; continue; }
    let op = OPS.find(o => src.startsWith(o, i)) || ch;
    if (!'+-*/%=<>!&|^~?:;,.(){}[]'.includes(op[0])) throw new CodeErr(line, `Caractere inesperado "${ch}".`);
    push('op', op); i += op.length;
  }
  push('eof', null);
  return toks;
}

// #define simples (sem parâmetros) e #include
export function preprocess(toks, diags) {
  const macros = new Map(), out = [];
  for (const t of toks) {
    if (t.t === 'pp') {
      let m;
      if ((m = /^#\s*include\s*[<"]([^>"]+)[>"]/.exec(t.v))) { if (!LIBS_OK.has(m[1])) diags.push({ sev: 'err', line: t.line, msg: `A biblioteca ${m[1]} não é simulada aqui. Dá para usar a API básica do Arduino (pinos, Serial, millis, String).` }); continue; }
      if ((m = /^#\s*define\s+([A-Za-z_]\w*)(\()?\s*(.*)$/.exec(t.v))) { if (m[2]) { diags.push({ sev: 'err', line: t.line, msg: `#define com parâmetros (${m[1]}(...)) não é suportado. Use uma função.` }); continue; } const body = lex(m[3]).filter(x => x.t !== 'eof'); body.forEach(x => x.line = t.line); macros.set(m[1], body); continue; }
      if (/^#\s*(ifdef|ifndef|endif|if|else|pragma|undef)/.test(t.v)) { diags.push({ sev: 'warn', line: t.line, msg: `A diretiva "${t.v.split(/\s/)[0]}" é ignorada no simulador.` }); continue; }
      diags.push({ sev: 'err', line: t.line, msg: `Diretiva não reconhecida: ${t.v}` }); continue;
    }
    const expand = (x, depth) => { if (x.t === 'id' && macros.has(x.v) && depth < 8) { for (const y of macros.get(x.v)) expand(Object.assign({}, y, { line: x.line }), depth + 1); } else out.push(x); };
    expand(t, 0);
  }
  return out;
}

// ─── analisador sintático ───
export function parseProgram(toks) {
  let p = 0;
  const peek = (o = 0) => toks[p + o], next = () => toks[p++];
  const is = (v, o = 0) => { const t = toks[p + o]; return t && (t.t === 'op' || t.t === 'id') && t.v === v; };
  const expect = (v, what) => { const t = next(); if (!t || t.v !== v || (t.t !== 'op' && t.t !== 'id')) { const got = t.t === 'eof' ? 'o fim do código' : `"${t.v}"`; throw new CodeErr(t.line, `Esperava "${v}"${what ? ' ' + what : ''}, mas encontrei ${got}.${v === ';' ? ' Faltou ponto e vírgula no fim da linha anterior?' : ''}`); } return t; };
  const isTypeStart = (o = 0) => { const t = peek(o); return t && t.t === 'id' && (TYPEWORDS.has(t.v) || QUALWORDS.has(t.v)); };
  function parseType() {
    const t0 = peek(); let isConst = false, isStatic = false, unsigned = false, words = [];
    while (peek().t === 'id' && (QUALWORDS.has(peek().v) || TYPEWORDS.has(peek().v))) { const w = next().v; if (w === 'const') isConst = true; else if (w === 'static') isStatic = true; else if (w === 'volatile') {} else if (w === 'unsigned') unsigned = true; else if (w === 'signed') {} else words.push(w); }
    let base = words.join(' ') || (unsigned ? 'int' : '');
    const map = { 'void': 'void', 'bool': 'bool', 'boolean': 'bool', 'char': unsigned ? 'byte' : 'char', 'byte': 'byte', 'uint8_t': 'byte', 'int8_t': 'char', 'int': unsigned ? 'uint' : 'int', 'short': unsigned ? 'uint' : 'i16', 'int16_t': 'i16', 'uint16_t': 'u16', 'word': 'uint', 'long': unsigned ? 'ulong' : 'long', 'long int': unsigned ? 'ulong' : 'long', 'long long': unsigned ? 'ulong' : 'long', 'int32_t': 'long', 'uint32_t': 'ulong', 'size_t': 'ulong', 'float': 'float', 'double': 'float', 'long double': 'float', 'String': 'String' };
    const ty = map[base];
    if (!ty) throw new CodeErr(t0.line, `Tipo "${base || t0.v}" não reconhecido.`);
    if (is('*') || is('&')) throw new CodeErr(peek().line, `Ponteiros e referências (${peek().v}) não são suportados no simulador. Use variáveis comuns ou arrays.`);
    return { ty, isConst, isStatic, line: t0.line };
  }
  // expressões (precedência do C)
  const BIN = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '<=', '>', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
  function expr() { const e = assign(); if (is(',')) { const list = [e]; while (is(',')) { next(); list.push(assign()); } return { k: 'comma', list, line: e.line }; } return e; }
  function assign() {
    const a = tern();
    const t = peek();
    if (t.t === 'op' && ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='].includes(t.v)) { next(); if (a.k !== 'id' && a.k !== 'idx') throw new CodeErr(t.line, 'Só dá para atribuir a uma variável ou posição de array.'); return { k: 'asg', op: t.v, a, b: assign(), line: t.line }; }
    return a;
  }
  function tern() { const c = bin(0); if (is('?')) { const l = next().line; const a = assign(); expect(':', 'no operador ternário'); const b = assign(); return { k: 'tern', c, a, b, line: l }; } return c; }
  function bin(lv) { if (lv >= BIN.length) return unary(); let a = bin(lv + 1); while (peek().t === 'op' && BIN[lv].includes(peek().v)) { const t = next(); a = { k: 'bin', op: t.v, a, b: bin(lv + 1), line: t.line }; } return a; }
  function unary() {
    const t = peek();
    if (t.t === 'op' && ['!', '~', '-', '+'].includes(t.v)) { next(); return { k: 'un', op: t.v, a: unary(), line: t.line }; }
    if (t.t === 'op' && (t.v === '++' || t.v === '--')) { next(); const a = unary(); if (a.k !== 'id' && a.k !== 'idx') throw new CodeErr(t.line, `${t.v} precisa de uma variável.`); return { k: 'pre', op: t.v, a, line: t.line }; }
    if (t.t === 'op' && (t.v === '*' || t.v === '&')) throw new CodeErr(t.line, `Ponteiros (${t.v}) não são suportados no simulador.`);
    if (is('(') && isTypeStart(1)) { const l = next().line; const ty = parseType(); expect(')', 'depois do tipo na conversão'); return { k: 'cast', ty: ty.ty, a: unary(), line: l }; }
    return postfix();
  }
  function postfix() {
    let a = primary();
    for (;;) {
      const t = peek();
      if (is('(')) { next(); const args = []; if (!is(')')) { args.push(assign()); while (is(',')) { next(); args.push(assign()); } } expect(')', 'fechando a chamada'); a = { k: 'call', f: a, args, line: t.line }; }
      else if (is('[')) { next(); const i = expr(); expect(']'); a = { k: 'idx', a, i, line: t.line }; }
      else if (is('.')) { next(); const nm = next(); if (nm.t !== 'id') throw new CodeErr(nm.line, 'Esperava o nome de um método depois do ponto.'); a = { k: 'mem', o: a, name: nm.v, line: nm.line }; }
      else if (is('->')) throw new CodeErr(t.line, 'O operador -> (ponteiros) não é suportado.');
      else if (t.t === 'op' && (t.v === '++' || t.v === '--')) { next(); if (a.k !== 'id' && a.k !== 'idx') throw new CodeErr(t.line, `${t.v} precisa de uma variável.`); a = { k: 'post', op: t.v, a, line: t.line }; }
      else return a;
    }
  }
  function primary() {
    const t = next();
    if (t.t === 'num') return { k: 'num', v: t.v, isFloat: t.isFloat, suf: t.suf, line: t.line };
    if (t.t === 'chr') return { k: 'chr', v: t.v, line: t.line };
    if (t.t === 'str') { let s = t.v; while (peek().t === 'str') s += next().v; return { k: 'str', v: s, line: t.line }; }
    if (t.t === 'id') {
      if (TYPEWORDS.has(t.v) && is('(')) { const ty = { int: 'int', long: 'long', float: 'float', double: 'float', byte: 'byte', char: 'char', bool: 'bool', boolean: 'bool', String: 'String', word: 'uint' }[t.v]; if (!ty) throw new CodeErr(t.line, `Conversão ${t.v}(...) não suportada.`); next(); const args = []; if (!is(')')) { args.push(assign()); while (is(',')) { next(); args.push(assign()); } } expect(')'); return ty === 'String' ? { k: 'call', f: { k: 'id', name: 'String', line: t.line }, args, line: t.line } : { k: 'cast', ty, a: args[0] || { k: 'num', v: 0, line: t.line }, line: t.line }; }
      if (['new', 'delete', 'class', 'struct', 'template', 'goto', 'union', 'enum', 'typedef', 'namespace', 'this', 'operator'].includes(t.v)) throw new CodeErr(t.line, `"${t.v}" não é suportado no simulador.`);
      return { k: 'id', name: t.v, line: t.line };
    }
    if (t.t === 'op' && t.v === '(') { const e = expr(); expect(')', 'fechando o parêntese'); return e; }
    if (t.t === 'eof') throw new CodeErr(t.line, 'O código terminou no meio de uma expressão. Falta fechar algo?');
    throw new CodeErr(t.line, `"${t.v}" inesperado aqui.`);
  }
  function initList() { const l = next().line; const items = []; if (!is('}')) { items.push(is('{') ? initList() : assign()); while (is(',')) { next(); if (is('}')) break; items.push(is('{') ? initList() : assign()); } } expect('}', 'fechando a lista de valores'); return { k: 'list', items, line: l }; }
  function declRest(ty, first) {
    const vars = [];
    let nm = first;
    for (;;) {
      if (!nm) { nm = next(); if (nm.t !== 'id') throw new CodeErr(nm.line, 'Esperava o nome da variável.'); }
      if (TYPEWORDS.has(nm.v) || QUALWORDS.has(nm.v)) throw new CodeErr(nm.line, `"${nm.v}" é uma palavra reservada e não pode ser nome de variável.`);
      const v = { name: nm.v, dims: [], init: null, line: nm.line };
      while (is('[')) { next(); v.dims.push(is(']') ? null : expr()); expect(']'); }
      if (is('=')) { next(); v.init = is('{') ? initList() : assign(); }
      else if (is('(') && ty.ty === 'String') { next(); v.init = is(')') ? { k: 'str', v: '', line: nm.line } : assign(); expect(')'); }
      vars.push(v);
      if (is(',')) { next(); nm = null; continue; }
      break;
    }
    return { k: 'decl', ty: ty.ty, isConst: ty.isConst, isStatic: ty.isStatic, vars, line: ty.line };
  }
  function block() { const l = expect('{').line; const body = []; while (!is('}')) { if (peek().t === 'eof') throw new CodeErr(l, 'Bloco aberto com { e nunca fechado com }.'); body.push(stmt()); } next(); return { k: 'block', body, line: l }; }
  function stmt() {
    const t = peek();
    if (is('{')) return block();
    if (is(';')) { next(); return { k: 'empty', line: t.line }; }
    if (isTypeStart()) { const ty = parseType(); const d = declRest(ty); expect(';', 'no fim da declaração'); return d; }
    if (t.t === 'id') switch (t.v) {
      case 'if': { next(); expect('(', 'depois do if'); const c = expr(); expect(')', 'fechando a condição do if'); const th = stmt(); let el = null; if (is('else')) { next(); el = stmt(); } return { k: 'if', c, t: th, f: el, line: t.line }; }
      case 'while': { next(); expect('('); const c = expr(); expect(')'); return { k: 'while', c, body: stmt(), line: t.line }; }
      case 'do': { next(); const body = stmt(); expect('while', 'depois do bloco do'); expect('('); const c = expr(); expect(')'); expect(';'); return { k: 'do', body, c, line: t.line }; }
      case 'for': { next(); expect('(', 'depois do for'); let init = null; if (!is(';')) { if (isTypeStart()) init = declRest(parseType()); else init = { k: 'expr', e: expr(), line: t.line }; } expect(';', 'no for'); const c = is(';') ? null : expr(); expect(';', 'no for'); const step = is(')') ? null : expr(); expect(')', 'fechando o for'); return { k: 'for', init, c, step, body: stmt(), line: t.line }; }
      case 'switch': { next(); expect('('); const e = expr(); expect(')'); expect('{'); const cases = []; let cur = null; while (!is('}')) { if (is('case')) { const l = next().line; const v = tern(); expect(':', 'depois do case'); cur = { v, body: [], line: l }; cases.push(cur); } else if (is('default')) { const l = next().line; expect(':'); cur = { v: null, body: [], line: l }; cases.push(cur); } else { if (!cur) throw new CodeErr(peek().line, 'Comando dentro do switch antes de qualquer case.'); cur.body.push(stmt()); } } next(); return { k: 'switch', e, cases, line: t.line }; }
      case 'break': next(); expect(';'); return { k: 'break', line: t.line };
      case 'continue': next(); expect(';'); return { k: 'continue', line: t.line };
      case 'return': { next(); const e = is(';') ? null : expr(); expect(';', 'depois do return'); return { k: 'return', e, line: t.line }; }
      case 'else': throw new CodeErr(t.line, '"else" sem um "if" antes (confira as chaves).');
    }
    const e = expr(); expect(';', 'no fim do comando'); return { k: 'expr', e, line: t.line };
  }
  const funcs = new Map(), globals = [];
  while (peek().t !== 'eof') {
    if (is(';')) { next(); continue; }
    if (!isTypeStart()) { const t = peek(); throw new CodeErr(t.line, t.t === 'id' ? `"${t.v}" fora de uma função. Comandos precisam ficar dentro de setup(), loop() ou outra função.` : `"${t.v}" inesperado fora de uma função.`); }
    const ty = parseType(); const nm = next();
    if (nm.t !== 'id') throw new CodeErr(nm.line, 'Esperava um nome depois do tipo.');
    if (is('(')) {
      next(); const params = [];
      if (!is(')') && !(is('void') && is(')', 1))) { do { if (is(',')) next(); const pt = parseType(); const pn = next(); if (pn.t !== 'id') throw new CodeErr(pn.line, 'Esperava o nome do parâmetro.'); let arr = false; while (is('[')) { next(); if (!is(']')) expr(); expect(']'); arr = true; } params.push({ ty: pt.ty, name: pn.v, arr }); } while (is(',')); } else if (is('void')) next();
      expect(')', 'fechando os parâmetros');
      if (is(';')) { next(); continue; }
      if (funcs.has(nm.v)) throw new CodeErr(nm.line, `A função ${nm.v}() foi definida duas vezes.`);
      funcs.set(nm.v, { name: nm.v, ty: ty.ty, params, body: block(), line: nm.line });
    } else { const d = declRest(ty, nm); expect(';', 'no fim da declaração'); globals.push(d); }
  }
  return { funcs, globals };
}

// ─── API do Arduino ───
export const INTW = { avr: { int: [16, true], uint: [16, false], i16: [16, true], u16: [16, false], long: [32, true], ulong: [32, false], char: [8, true], byte: [8, false] }, esp: { int: [32, true], uint: [32, false], i16: [16, true], u16: [16, false], long: [32, true], ulong: [32, false], char: [8, true], byte: [8, false] } };

export const INTLIM = { 16: [-32768, 32767, 65535], 32: [-2147483648, 2147483647, 4294967295], 8: [-128, 127, 255] };
export const isIntTy = t => ['int', 'uint', 'i16', 'u16', 'long', 'ulong', 'char', 'byte', 'bool'].includes(t);
export const RANK = { bool: 0, char: 0, byte: 0, i16: 1, int: 1, u16: 2, uint: 2, long: 3, ulong: 4, float: 9 };
export function promote(a, b) { if (a === 'String' || b === 'String') return 'String'; if (a === 'float' || b === 'float') return 'float'; const r = Math.max(RANK[a] ?? 1, RANK[b] ?? 1, 1); return Object.keys(RANK).find(k => RANK[k] === r && k !== 'i16' && k !== 'u16') || 'int'; }
export function wrapInt(v, bits, signed) { if (!isFinite(v)) return 0; v = Math.trunc(v); const m = 2 ** bits; v = ((v % m) + m) % m; if (signed && v >= m / 2) v -= m; return v; }

export const BUILTIN = {
  pinMode: [2, 'void'], digitalWrite: [2, 'void'], digitalRead: [1, 'int'], analogRead: [1, 'int'], analogWrite: [2, 'void'],
  delay: [1, 'void'], delayMicroseconds: [1, 'void'], millis: [0, 'ulong'], micros: [0, 'ulong'],
  map: [5, 'long'], constrain: [3, '*'], min: [2, '*'], max: [2, '*'], abs: [1, '*'], pow: [2, 'float'], sqrt: [1, 'float'], sq: [1, '*'],
  sin: [1, 'float'], cos: [1, 'float'], tan: [1, 'float'], floor: [1, 'float'], ceil: [1, 'float'], round: [1, 'long'], fabs: [1, 'float'], log: [1, 'float'], exp: [1, 'float'],
  random: [[1, 2], 'long'], randomSeed: [1, 'void'], tone: [[2, 3], 'void'], noTone: [1, 'void'],
  bitRead: [2, 'int'], bitSet: [2, '*'], bitClear: [2, '*'], bitWrite: [3, '*'], highByte: [1, 'byte'], lowByte: [1, 'byte'], bit: [1, 'ulong'],
  isDigit: [1, 'bool'], isAlpha: [1, 'bool'], isSpace: [1, 'bool'], yield: [0, 'void'], String: [[0, 2], 'String'],
};

export const UNSUPPORTED_FN = { attachInterrupt: 'Interrupções não são simuladas. Leia o pino dentro do loop().', detachInterrupt: 'Interrupções não são simuladas.', pulseIn: 'pulseIn() não é simulado.', shiftOut: 'shiftOut() não é simulado.', shiftIn: 'shiftIn() não é simulado.', malloc: 'Alocação de memória não é suportada.', sizeof: 'sizeof não é suportado; guarde o tamanho do array numa constante.' };
export const SERIAL_M = { begin: [[1, 2], 'void'], end: [0, 'void'], print: [[1, 2], 'ulong'], println: [[0, 2], 'ulong'], write: [1, 'ulong'], available: [0, 'int'], read: [0, 'int'], peek: [0, 'int'], readString: [0, 'String'], readStringUntil: [1, 'String'], parseInt: [0, 'long'], parseFloat: [0, 'float'], flush: [0, 'void'], setTimeout: [1, 'void'], availableForWrite: [0, 'int'] };
export const STRING_M = { length: [0, 'uint'], toInt: [0, 'long'], toFloat: [0, 'float'], indexOf: [[1, 2], 'int'], lastIndexOf: [1, 'int'], substring: [[1, 2], 'String'], charAt: [1, 'char'], equals: [1, 'bool'], equalsIgnoreCase: [1, 'bool'], startsWith: [1, 'bool'], endsWith: [1, 'bool'], trim: [0, 'void'], toUpperCase: [0, 'void'], toLowerCase: [0, 'void'], replace: [2, 'void'], concat: [1, 'bool'], c_str: [0, 'String'], isEmpty: [0, 'bool'], remove: [[1, 2], 'void'] };

export function boardConsts(type) {
  const esp = type === 'esp32';
  const c = { HIGH: 1, LOW: 0, INPUT: 0, OUTPUT: 1, INPUT_PULLUP: 2, true: 1, false: 0, LED_BUILTIN: esp ? 2 : 13, PI: Math.PI, HALF_PI: Math.PI / 2, TWO_PI: Math.PI * 2, DEG_TO_RAD: Math.PI / 180, RAD_TO_DEG: 180 / Math.PI, DEC: 10, HEX: 16, OCT: 8, BIN: 2, NULL: 0 };
  if (esp) Object.assign(c, { A0: 36, A3: 39, A4: 32, A5: 33, A6: 34, A7: 35, A10: 4, A11: 0, A12: 2, A13: 15, A14: 13, A15: 12, A16: 14, A17: 27, A18: 25, A19: 26 });
  else for (let i = 0; i < 8; i++) c['A' + i] = 14 + i;
  return c;
}

export function pinIdFor(type, n) {
  if (!Number.isInteger(n)) return null;
  const m = MCU[type];
  if (type === 'esp32') return m.pin['G' + n] ? 'G' + n : null;
  if (n >= 0 && n <= 13) return 'D' + n;
  if (n >= 14 && n <= 21) { const id = 'A' + (n - 14); return m.pin[id] ? id : null; }
  return null;
}

export const defaultCode = type => `// ${MCU[type].label}: pisca o LED da placa a cada meio segundo.
// Ligue um LED com resistor de 330 Ω num pino e troque LED_BUILTIN pelo número dele.
const int LED = LED_BUILTIN;

void setup() {
  pinMode(LED, OUTPUT);
  Serial.begin(${type === 'esp32' ? 115200 : 9600});
  Serial.println("Iniciado");
}

void loop() {
  digitalWrite(LED, HIGH);
  delay(500);
  digitalWrite(LED, LOW);
  delay(500);
}
`;

export const CODE_TEMPLATES = {
  blink: ['Piscar LED', type => defaultCode(type)],
  button: ['Botão com pull-up', type => `// Botão entre o pino 2 e o GND, sem resistor (usa o pull-up interno).
// LED com resistor de 330 Ω no pino 13.
const int BOTAO = ${type === 'esp32' ? 4 : 2};
const int LED = ${type === 'esp32' ? 2 : 13};

void setup() {
  pinMode(BOTAO, INPUT_PULLUP);
  pinMode(LED, OUTPUT);
}

void loop() {
  if (digitalRead(BOTAO) == LOW) {   // apertado = LOW por causa do pull-up
    digitalWrite(LED, HIGH);
  } else {
    digitalWrite(LED, LOW);
  }
}
`],
  fade: ['Fade com PWM', type => `// Aumenta e diminui o brilho de um LED no pino ${type === 'esp32' ? 16 : 9} (PWM).
const int LED = ${type === 'esp32' ? 16 : 9};
int brilho = 0;
int passo = 5;

void setup() {
  pinMode(LED, OUTPUT);
}

void loop() {
  analogWrite(LED, brilho);
  brilho = brilho + passo;
  if (brilho <= 0 || brilho >= 255) {
    passo = -passo;
  }
  delay(30);
}
`],
  analog: ['Leitura analógica + Serial', type => `// Lê um potenciômetro ou LDR no ${type === 'esp32' ? 'G34' : 'A0'} e mostra no monitor serial.
const int SENSOR = ${type === 'esp32' ? 34 : 'A0'};

void setup() {
  Serial.begin(${type === 'esp32' ? 115200 : 9600});
}

void loop() {
  int leitura = analogRead(SENSOR);
  float volts = leitura * (${type === 'esp32' ? '3.3 / 4095.0' : '5.0 / 1023.0'});
  Serial.print("Leitura: ");
  Serial.print(leitura);
  Serial.print("  Tensao: ");
  Serial.println(volts);
  delay(500);
}
`],
  traffic: ['Semáforo com 3 LEDs', type => `// Semáforo: LEDs vermelho, amarelo e verde com resistores de 330 Ω.
const int VERMELHO = ${type === 'esp32' ? 16 : 10};
const int AMARELO = ${type === 'esp32' ? 17 : 11};
const int VERDE = ${type === 'esp32' ? 18 : 12};

void acende(int pino, unsigned long tempo) {
  digitalWrite(VERMELHO, pino == VERMELHO);
  digitalWrite(AMARELO, pino == AMARELO);
  digitalWrite(VERDE, pino == VERDE);
  delay(tempo);
}

void setup() {
  pinMode(VERMELHO, OUTPUT);
  pinMode(AMARELO, OUTPUT);
  pinMode(VERDE, OUTPUT);
}

void loop() {
  acende(VERDE, 3000);
  acende(AMARELO, 1000);
  acende(VERMELHO, 3000);
}
`],
  serial: ['Eco pelo Serial', type => `// Digite no monitor serial: o Arduino devolve o texto e liga o LED com "on".
const int LED = LED_BUILTIN;

void setup() {
  pinMode(LED, OUTPUT);
  Serial.begin(${type === 'esp32' ? 115200 : 9600});
  Serial.println("Digite on ou off");
}

void loop() {
  if (Serial.available() > 0) {
    String cmd = Serial.readString();
    cmd.trim();
    Serial.print("Recebi: ");
    Serial.println(cmd);
    if (cmd == "on") digitalWrite(LED, HIGH);
    if (cmd == "off") digitalWrite(LED, LOW);
  }
}
`],
};

// ─── verificação estática (tipos, nomes, pinos) ───
export function compileCode(src, mo) {
  const diags = [], type = mo.type, plat = type === 'esp32' ? 'esp' : 'avr', consts = boardConsts(type), m = MCU[type];
  let prog;
  try { prog = parseProgram(preprocess(lex(src), diags)); }
  catch (e) { if (e instanceof CodeErr) { diags.push({ sev: 'err', line: e.line, msg: e.message }); return { ok: false, diags }; } throw e; }
  const W = INTW[plat];
  const add = (sev, line, msg) => { if (!diags.some(d => d.line === line && d.msg === msg)) diags.push({ sev, line, msg }); };
  if (!prog.funcs.has('setup')) add('err', 1, 'Falta a função void setup() { }.');
  if (!prog.funcs.has('loop')) add('err', 1, 'Falta a função void loop() { }.');
  for (const nm of ['setup', 'loop']) { const f = prog.funcs.get(nm); if (f && f.params.length) add('err', f.line, `${nm}() não recebe parâmetros.`); }
  const pinUses = [];       // { fn, pin, line }
  const used = new Set(), declared = [];
  let serialBegin = false, serialUse = null;
  const scopes = [new Map()];
  const lookup = n => { for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(n)) return scopes[i].get(n); return null; };
  const declare = (v, d, line) => { const cur = scopes[scopes.length - 1]; if (cur.has(v.name)) add('err', line, `A variável ${v.name} já foi declarada neste bloco.`); cur.set(v.name, d); declared.push({ name: v.name, line, d }); };
  function constVal(e) {
    if (!e) return undefined;
    if (e.k === 'num' || e.k === 'chr') return e.v;
    if (e.k === 'id') { const d = lookup(e.name); if (d) return d.isConst ? d.cval : undefined; return e.name in consts ? consts[e.name] : undefined; }
    if (e.k === 'un') { const a = constVal(e.a); return a === undefined ? undefined : e.op === '-' ? -a : e.op === '!' ? +!a : e.op === '~' ? ~a : a; }
    if (e.k === 'bin') { const a = constVal(e.a), b = constVal(e.b); if (a === undefined || b === undefined) return undefined; switch (e.op) { case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return b ? Math.trunc(a / b) : undefined; case '%': return b ? a % b : undefined; } }
    if (e.k === 'cast') return constVal(e.a);
    return undefined;
  }
  function ty(e) {
    switch (e.k) {
      case 'num': e.ty = e.isFloat ? 'float' : e.suf.includes('u') && e.suf.includes('l') ? 'ulong' : e.suf.includes('l') ? 'long' : e.suf.includes('u') ? 'uint' : (e.v > INTLIM[W.int[0]][1] ? (e.v > 2147483647 ? 'ulong' : 'long') : 'int'); return e.ty;
      case 'chr': return e.ty = 'char';
      case 'str': return e.ty = 'cstr';
      case 'id': {
        const d = lookup(e.name);
        if (d) { used.add(d); e.ty = d.arr ? 'array' : d.ty; e.d = d; return e.ty; }
        if (e.name in consts) { e.ty = ['PI', 'HALF_PI', 'TWO_PI', 'DEG_TO_RAD', 'RAD_TO_DEG'].includes(e.name) ? 'float' : e.name === 'true' || e.name === 'false' ? 'bool' : 'int'; e.cv = consts[e.name]; return e.ty; }
        if (e.name === 'Serial') return e.ty = 'Serial';
        if (prog.funcs.has(e.name) || BUILTIN[e.name]) { add('err', e.line, `${e.name} é uma função: use ${e.name}(...).`); return e.ty = 'int'; }
        const sug = { OUPUT: 'OUTPUT', OUTPU: 'OUTPUT', ouput: 'OUTPUT', output: 'OUTPUT', input: 'INPUT', high: 'HIGH', low: 'LOW', INPUT_PULLDOWN: 'INPUT (o Arduino não tem pull-down interno)', serial: 'Serial', True: 'true', False: 'false', TRUE: 'true', FALSE: 'false' }[e.name];
        add('err', e.line, `"${e.name}" não foi declarado.${sug ? ` Você quis dizer ${sug}?` : ' Declare a variável antes de usar (ex.: int ' + e.name + ' = 0;).'}`);
        return e.ty = 'int';
      }
      case 'un': { const a = ty(e.a); return e.ty = e.op === '!' ? 'bool' : (a === 'float' ? 'float' : promote(a, 'int')); }
      case 'pre': case 'post': { const a = ty(e.a); if (e.a.d && e.a.d.isConst) add('err', e.line, `${e.a.name} é const e não pode ser alterado.`); return e.ty = a; }
      case 'cast': ty(e.a); return e.ty;
      case 'tern': { ty(e.c); const a = ty(e.a), b = ty(e.b); return e.ty = a === b ? a : promote(a === 'cstr' ? 'String' : a, b === 'cstr' ? 'String' : b); }
      case 'comma': { let t; for (const x of e.list) t = ty(x); return e.ty = t; }
      case 'bin': {
        const a = ty(e.a), b = ty(e.b);
        if (['==', '!=', '<', '<=', '>', '>=', '&&', '||'].includes(e.op)) { if ((a === 'cstr' && b === 'cstr') && (e.op === '==' || e.op === '!=')) add('warn', e.line, 'Comparar dois textos entre aspas compara endereços, não o conteúdo. Use String.'); return e.ty = 'bool'; }
        if (e.op === '+' && (a === 'cstr' || b === 'cstr') && a !== 'String' && b !== 'String') { if (isIntTy(a === 'cstr' ? b : a)) add('warn', e.line, 'Em C++, "texto" + número não junta os dois: pula caracteres do texto (aritmética de ponteiro). Use String("texto") + número, ou dois Serial.print.'); return e.ty = 'cstr'; }
        if ((e.op === '/' || e.op === '%') && constVal(e.b) === 0) add('err', e.line, 'Divisão por zero.');
        if (e.op === '/' && isIntTy(a) && isIntTy(b)) { const av = constVal(e.a), bv = constVal(e.b); if (av !== undefined && bv !== undefined && av % bv !== 0 && Math.abs(av) < Math.abs(bv) * 10) add('info', e.line, `${av} / ${bv} com inteiros dá ${Math.trunc(av / bv)} (a parte decimal some). Use ${av}.0 / ${bv} para ter decimais.`); }
        const t = promote(a === 'cstr' ? 'String' : a, b === 'cstr' ? 'String' : b);
        if (t === 'String' && e.op !== '+') add('err', e.line, `O operador ${e.op} não funciona com String.`);
        if (['%', '&', '|', '^', '<<', '>>'].includes(e.op) && t === 'float') add('err', e.line, `O operador ${e.op} só funciona com inteiros.`);
        return e.ty = t;
      }
      case 'asg': {
        const a = ty(e.a), b = ty(e.b);
        if (e.a.d && e.a.d.isConst) add('err', e.line, `${e.a.name} é const e não pode receber outro valor.`);
        if (e.a.k === 'id' && e.a.d && e.a.d.arr && e.op === '=') add('err', e.line, 'Não dá para atribuir um array inteiro de uma vez. Copie posição por posição.');
        checkStore(a, e.b, e.line, e.a.k === 'id' ? e.a.name : 'a variável');
        return e.ty = a;
      }
      case 'idx': { const a = ty(e.a); ty(e.i); if (a === 'String') return e.ty = 'char'; if (a !== 'array') { add('err', e.line, 'Colchetes [ ] só funcionam em arrays e String.'); return e.ty = 'int'; } const base = e.a.k === 'id' ? e.a.d : null; const iv = constVal(e.i); if (base && iv !== undefined && base.dims[0] != null && (iv < 0 || iv >= base.dims[0])) add('err', e.line, `Índice ${iv} fora do array ${base.name} (tamanho ${base.dims[0]}, vai de 0 a ${base.dims[0] - 1}).`); e.depth = (e.a.depth || 0) + 1; return e.ty = base && e.depth < base.dims.length ? 'array' : (base ? base.ty : (e.a.elt || 'int')); }
      case 'mem': add('err', e.line, `Use ${e.name}(...) como método.`); return e.ty = 'int';
      case 'call': return e.ty = callTy(e);
    }
    return 'int';
  }
  function checkStore(target, valE, line, name) {
    const vt = valE.ty || ty(valE), cv = constVal(valE);
    if (isIntTy(target) && target !== 'bool' && vt === 'float') add('info', line, `${name} é inteiro: o valor decimal será truncado (sem arredondar).`);
    if (isIntTy(target) && target !== 'bool' && cv !== undefined) { const [bits, signed] = W[target]; const lim = INTLIM[bits]; if (signed ? (cv < lim[0] || cv > lim[1]) : (cv < 0 || cv > lim[2])) add('warn', line, `${cv} não cabe em ${target === 'int' ? 'int' : target} (${signed ? lim[0] + ' a ' + lim[1] : '0 a ' + lim[2]}${plat === 'avr' && target === 'int' ? ' no Arduino, int tem 16 bits' : ''}). Use long.`); }
    if (valE.k === 'call' && valE.f.k === 'id' && (valE.f.name === 'millis' || valE.f.name === 'micros') && target !== 'ulong') add('warn', line, `Guarde ${valE.f.name}() em unsigned long. Em ${target} ele estoura${plat === 'avr' && target === 'int' ? ' em 32 segundos' : ''} e a comparação de tempo quebra.`);
    if (target === 'String' && isIntTy(vt) && valE.k !== 'call') add('info', line, `Atribuir um número a String guarda o texto dele.`);
    if (target === 'cstr' || vt === 'void') { if (vt === 'void') add('err', line, 'Essa função não devolve valor (é void).'); }
  }
  function argc(spec, n, line, nm) { const [lo, hi] = Array.isArray(spec) ? spec : [spec, spec]; if (n < lo || n > hi) add('err', line, `${nm}() espera ${lo === hi ? lo : lo + ' a ' + hi} argumento${hi === 1 ? '' : 's'}, mas recebeu ${n}.`); }
  function callTy(e) {
    if (e.f.k === 'mem') {
      const o = e.f.o, nm = e.f.name; const ot = o.k === 'id' && o.name === 'Serial' ? 'Serial' : ty(o);
      e.args.forEach(ty);
      if (ot === 'Serial') { const s = SERIAL_M[nm]; if (!s) { add('err', e.line, `Serial.${nm}() não existe ou não é simulado.`); return 'int'; } argc(s[0], e.args.length, e.line, 'Serial.' + nm); if (nm === 'begin') serialBegin = true; else if (!serialUse) serialUse = e.line; e.obj = 'Serial'; return s[1]; }
      if (ot === 'String') { const s = STRING_M[nm]; if (!s) { add('err', e.line, `String não tem o método ${nm}().`); return 'int'; } argc(s[0], e.args.length, e.line, nm); e.obj = 'String'; return s[1]; }
      add('err', e.line, o.k === 'id' ? `"${o.name}" não é um objeto conhecido (bibliotecas como LCD, Servo ou Wire não são simuladas).` : 'Método chamado em algo que não é objeto.'); return 'int';
    }
    if (e.f.k !== 'id') { add('err', e.line, 'Chamada de função inválida.'); return 'int'; }
    const nm = e.f.name;
    e.args.forEach(ty);
    if (UNSUPPORTED_FN[nm]) { add('err', e.line, UNSUPPORTED_FN[nm]); return 'int'; }
    const uf = prog.funcs.get(nm);
    if (uf) { e.user = true; if (e.args.length !== uf.params.length) add('err', e.line, `${nm}() espera ${uf.params.length} argumento${uf.params.length === 1 ? '' : 's'}, mas recebeu ${e.args.length}.`); uf.called = true; e.args.forEach((a, i) => { if (uf.params[i]) { if (uf.params[i].arr !== (a.ty === 'array')) add('err', a.line, `O argumento ${i + 1} de ${nm}() ${uf.params[i].arr ? 'deve ser um array' : 'não pode ser um array'}.`); else if (!uf.params[i].arr) checkStore(uf.params[i].ty, a, a.line, `o parâmetro ${uf.params[i].name}`); } }); return uf.ty; }
    const b = BUILTIN[nm];
    if (!b) { add('err', e.line, `A função ${nm}() não existe. Confira maiúsculas e minúsculas${/^digitalwrite|^pinmode|^digitalread|^analogread|^analogwrite/i.test(nm) ? ' (ex.: digitalWrite, pinMode)' : ''}.`); return 'int'; }
    argc(b[0], e.args.length, e.line, nm);
    if (['pinMode', 'digitalWrite', 'digitalRead', 'analogRead', 'analogWrite', 'tone', 'noTone'].includes(nm) && e.args[0]) {
      const pv = constVal(e.args[0]);
      if (pv !== undefined) {
        const pid = pinIdFor(type, pv);
        if (!pid) add('err', e.line, `O pino ${pv} não existe no ${m.label}.`);
        else {
          const caps = mcuCaps(m, m.pin[pid]);
          pinUses.push({ fn: nm, pid, line: e.line, mode: nm === 'pinMode' ? constVal(e.args[1]) : undefined });
          if (nm === 'analogRead' && !caps.analog) add('err', e.line, `${pid} não tem leitura analógica.${type === 'esp32' ? ' No ESP32 use G32–G39 (ADC1).' : ' Use A0 a A5.'}`);
          if ((nm === 'digitalWrite' || nm === 'analogWrite' || (nm === 'pinMode' && constVal(e.args[1]) === 1)) && !caps.out) add('err', e.line, `${pid} só funciona como entrada.`);
          if (nm === 'analogWrite' && !caps.pwm) add('warn', e.line, `${pid} não tem PWM: analogWrite vira liga/desliga (≥128 liga). PWM no ${m.label}: ${m.pwm ? m.pwm.join(', ') : 'qualquer pino de saída'}.`);
          if (nm === 'pinMode' && e.args[1] && ![0, 1, 2].includes(constVal(e.args[1]))) add('err', e.line, 'O modo do pinMode deve ser INPUT, OUTPUT ou INPUT_PULLUP.');
          if (type !== 'esp32' && (pid === 'D0' || pid === 'D1')) add('warn', e.line, `${pid} é usado pelo Serial (RX/TX) e pela gravação USB. Prefira outro pino.`);
          if (type === 'esp32' && [6, 7, 8, 9, 10, 11].includes(pv)) add('err', e.line, `G${pv} é ligado à memória flash do ESP32 e não pode ser usado.`);
        }
      }
    }
    if (nm === 'delay' && e.args[0]) { const v = constVal(e.args[0]); if (v !== undefined && v < 0) add('err', e.line, 'delay() com valor negativo.'); }
    if (nm === 'map' && e.args.length === 5 && constVal(e.args[1]) !== undefined && constVal(e.args[1]) === constVal(e.args[2])) add('err', e.line, 'map() com faixa de entrada vazia (divisão por zero).');
    if (b[1] === '*') return e.args.length ? e.args.map(a => a.ty).reduce((x, y) => promote(x === 'cstr' ? 'String' : x, y === 'cstr' ? 'String' : y)) : 'int';
    return b[1];
  }
  function markYield(e) {
    if (!e || typeof e !== 'object') return false;
    let y = false;
    for (const key of ['a', 'b', 'c', 'i', 'o', 'f']) if (e[key] && typeof e[key] === 'object' && markYield(e[key])) y = true;
    if (e.args) for (const a of e.args) if (markYield(a)) y = true;
    if (e.list) for (const a of e.list) if (markYield(a)) y = true;
    if (e.items) for (const a of e.items) if (markYield(a)) y = true;
    if (e.k === 'call' && (e.user || (e.f.k === 'id' && (e.f.name === 'delay' || e.f.name === 'delayMicroseconds')))) y = true;
    e.y = y; return y;
  }
  function declStmt(s, global) {
    for (const v of s.vars) {
      const dims = v.dims.map(d => d == null ? null : constVal(d));
      v.dims.forEach((d, i) => { if (d != null) { ty(d); if (dims[i] === undefined) add('err', v.line, `O tamanho do array ${v.name} precisa ser uma constante.`); else if (dims[i] <= 0) add('err', v.line, `Tamanho inválido para o array ${v.name}.`); } });
      if (v.init) {
        if (v.init.k === 'list') { if (!v.dims.length) add('err', v.line, `Lista { } só serve para arrays. Declare ${v.name}[].`); const walk = l => l.items.forEach(it => it.k === 'list' ? walk(it) : ty(it)); walk(v.init); if (dims[0] == null) dims[0] = v.init.items.length; else if (v.init.items.length > dims[0]) add('err', v.line, `Valores demais para o array ${v.name}[${dims[0]}].`); }
        else if (v.dims.length && v.init.k === 'str') { if (dims[0] == null) dims[0] = v.init.v.length + 1; }
        else { ty(v.init); if (v.dims.length) add('err', v.line, `Para iniciar o array ${v.name} use uma lista entre chaves.`); else checkStore(s.ty, v.init, v.line, v.name); }
      } else if (s.isConst) add('err', v.line, `A constante ${v.name} precisa de um valor.`);
      if (v.dims.length && dims.some(d => d == null)) add('err', v.line, `Informe o tamanho do array ${v.name}.`);
      if (s.ty === 'void') add('err', v.line, 'Variável não pode ser void.');
      if (s.isStatic && !global) add('info', v.line, `static dentro de função: ${v.name} guarda o valor entre as chamadas.`);
      const d = { name: v.name, ty: s.ty, isConst: s.isConst, arr: v.dims.length > 0, dims, global, cval: s.isConst && !v.dims.length && v.init ? constVal(v.init) : undefined, isStatic: s.isStatic };
      v.d = d; declare(v, d, v.line);
      if (v.init) markYield(v.init);
      if (global && v.init && v.init.y) add('err', v.line, 'Uma variável global não pode ser iniciada chamando uma função que demora (delay) ou uma função sua. Faça isso no setup().');
    }
  }
  function stmtCheck(s, fn) {
    switch (s.k) {
      case 'block': scopes.push(new Map()); s.body.forEach(x => stmtCheck(x, fn)); scopes.pop(); break;
      case 'decl': declStmt(s, false); break;
      case 'expr': ty(s.e); markYield(s.e); if (['bin', 'num', 'id'].includes(s.e.k) && !(s.e.k === 'bin' && ['&&', '||'].includes(s.e.op))) add('warn', s.line, 'Essa linha calcula um valor e não faz nada com ele. Faltou uma atribuição (=)?'); break;
      case 'if': ty(s.c); markYield(s.c); if (s.c.k === 'asg' && s.c.op === '=') add('warn', s.line, 'Atribuição (=) dentro do if. Para comparar use ==.'); stmtCheck(s.t, fn); if (s.f) stmtCheck(s.f, fn); if (s.t.k === 'empty') add('warn', s.line, 'Ponto e vírgula logo depois do if: o bloco seguinte sempre roda.'); break;
      case 'while': ty(s.c); markYield(s.c); if (s.c.k === 'asg' && s.c.op === '=') add('warn', s.line, 'Atribuição (=) na condição do while. Para comparar use ==.'); stmtCheck(s.body, fn); break;
      case 'do': stmtCheck(s.body, fn); ty(s.c); markYield(s.c); break;
      case 'for': scopes.push(new Map()); if (s.init) { if (s.init.k === 'decl') declStmt(s.init, false); else { ty(s.init.e); markYield(s.init.e); } } if (s.c) { ty(s.c); markYield(s.c); } if (s.step) { ty(s.step); markYield(s.step); } stmtCheck(s.body, fn); scopes.pop(); if (s.body.k === 'empty') add('warn', s.line, 'Ponto e vírgula logo depois do for: o laço não repete o bloco seguinte.'); break;
      case 'switch': ty(s.e); markYield(s.e); for (const c of s.cases) { if (c.v) { ty(c.v); if (constVal(c.v) === undefined) add('err', c.line, 'O valor do case precisa ser uma constante.'); } scopes.push(new Map()); c.body.forEach(x => stmtCheck(x, fn)); scopes.pop(); } break;
      case 'return': if (s.e) { ty(s.e); markYield(s.e); if (fn.ty === 'void') add('err', s.line, `${fn.name}() é void e não pode devolver valor.`); else checkStore(fn.ty, s.e, s.line, 'o retorno'); } else if (fn.ty !== 'void') add('err', s.line, `${fn.name}() deve devolver um valor do tipo ${fn.ty}.`); break;
    }
  }
  for (const g of prog.globals) declStmt(g, true);
  for (const f of prog.funcs.values()) {
    scopes.push(new Map());
    for (const p of f.params) { const d = { name: p.name, ty: p.ty, arr: p.arr, dims: [null], isParam: true }; p.d = d; declare(p, d, f.line); used.add(d); }
    stmtCheck(f.body, f);
    if (f.ty !== 'void' && !JSON.stringify(f.body).includes('"k":"return"')) add('warn', f.line, `${f.name}() deveria devolver ${f.ty}, mas não tem return.`);
    scopes.pop();
  }
  for (const f of prog.funcs.values()) if (!f.called && f.name !== 'setup' && f.name !== 'loop') add('info', f.line, `A função ${f.name}() nunca é chamada.`);
  for (const dv of declared) if (!used.has(dv.d) && !dv.d.isParam) add('info', dv.line, `A variável ${dv.name} foi declarada mas não é usada.`);
  if (serialUse && !serialBegin) add('warn', serialUse, 'Serial usado sem Serial.begin() no setup(). Nada vai aparecer no monitor.');
  // pinos × circuito
  const modes = new Map(); for (const u of pinUses) if (u.fn === 'pinMode') modes.set(u.pid, u.mode);
  const warned = new Set();
  for (const u of pinUses) {
    const key = mk(mo.id, u.pid);
    if (!warned.has(u.pid) && !app.AN.mcuUsed.has(key) && u.pid !== pinIdFor(type, consts.LED_BUILTIN)) { warned.add(u.pid); add('info', u.line, `${u.pid} não está ligado a nada na bancada. Use a ferramenta Fio (J) para ligá-lo ao circuito.`); }
    if ((u.fn === 'digitalWrite' || u.fn === 'analogWrite') && modes.get(u.pid) !== 1 && !(u.fn === 'analogWrite' && modes.has(u.pid) === false)) { if (!modes.has(u.pid)) add('warn', u.line, `${u.pid} é escrito sem pinMode(${u.pid.replace(/^D|^G/, '')}, OUTPUT). Sem isso, digitalWrite só liga o pull-up e o pino não fornece corrente.`); else if (modes.get(u.pid) !== 1) add('warn', u.line, `${u.pid} foi configurado como entrada e depois é escrito como saída.`); }
    if (u.fn === 'pinMode' && u.mode === 1) {
      const nk = app.AN.mcuNode.get(key), mem = app.AN.nodeMembers.get(nk) || [];
      if (mem.some(x => x.mcu && x.mcu !== key && /GND|5V|3V3|VIN/.test(mkSplit(x.mcu)[1]))) add('err', u.line, `${u.pid} está ligado direto num pino de alimentação. Como OUTPUT ele entra em curto.`);
    }
  }
  const ok = !diags.some(d => d.sev === 'err');
  diags.sort((a, b) => ({ err: 0, warn: 1, info: 2 }[a.sev] - { err: 0, warn: 1, info: 2 }[b.sev]) || a.line - b.line);
  return { ok, diags, prog };
}

// ─── execução ───
export const RT = { running: false, paused: false, mid: null, vt: 0, gen: null, speed: 1, serialOut: '', serialIn: '', diags: [], runDiags: [], last: 0, dirty: false, steps: 0, raf: 0, pins: {}, rnd: 1, lastRender: 0, stopped: '', mo: null };

export class Interp {
  constructor(prog, mo) {
    this.prog = prog; this.mo = mo; this.type = mo.type; this.plat = mo.type === 'esp32' ? 'esp' : 'avr'; this.W = INTW[this.plat];
    this.consts = boardConsts(mo.type); this.globals = new Map(); this.depth = 0; this.cost = this.plat === 'avr' ? 6 : 2; this.statics = new Map();
    this.warnedOverflow = new Set();
  }
  err(line, msg) { throw new CodeErr(line, msg); }
  warn(line, msg, sev = 'warn') { if (!RT.runDiags.some(d => d.line === line && d.msg === msg)) { RT.runDiags.push({ sev, line, msg }); RT.uiDirty = true; } }
  store(ty, v, line) {
    if (ty === 'String') return typeof v === 'string' ? v : this.str(v, 'int');
    if (typeof v === 'string') { if (ty === 'cstr') return v; this.err(line, 'Texto usado onde se esperava número.'); }
    if (ty === 'float') return this.plat === 'avr' ? Math.fround(v) : v;
    if (ty === 'bool') return v ? 1 : 0;
    const w = this.W[ty]; if (!w) return v;
    const r = wrapInt(v, w[0], w[1]);
    if (r !== Math.trunc(v) && isFinite(v) && !this.warnedOverflow.has(line)) { this.warnedOverflow.add(line); this.warn(line, `Estouro: ${Math.trunc(v)} não cabe em ${ty}${this.plat === 'avr' && ty === 'int' ? ' (16 bits no Arduino, −32768 a 32767)' : ''} e virou ${r}. Use long ou unsigned long.`); }
    return r;
  }
  str(v, ty) {
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) { let s = ''; for (const c of v) { if (!c) break; s += String.fromCharCode(c); } return s; }
    if (ty === 'float') return (+v).toFixed(2);
    if (ty === 'char') return String.fromCharCode(v);
    return String(Math.trunc(v));
  }
  // variáveis
  lookup(env, name) { for (let e = env; e; e = e.parent) if (e.vars.has(name)) return e.vars.get(name); return this.globals.get(name); }
  mkArray(ty, dims, init, line, env) {
    const build = (level, list) => { const n = dims[level]; const a = new Array(n); for (let i = 0; i < n; i++) { const it = list && list.items ? list.items[i] : undefined; a[i] = level < dims.length - 1 ? build(level + 1, it) : (it ? this.store(ty, this.evs(it, env), line) : (ty === 'String' ? '' : 0)); } return a; };
    if (init && init.k === 'str') { const a = new Array(dims[0]).fill(0); for (let i = 0; i < init.v.length && i < dims[0]; i++) a[i] = init.v.charCodeAt(i); return a; }
    return build(0, init);
  }
  *declare(s, env, global) {
    for (const v of s.vars) {
      const d = v.d, map = global ? this.globals : env.vars;
      if (d.isStatic && !global) { const key = v.line + ':' + v.name; if (this.statics.has(key)) { map.set(v.name, this.statics.get(key)); continue; } }
      let rec;
      if (d.arr) rec = { ty: d.ty, arr: this.mkArray(d.ty, d.dims, v.init, v.line, env) };
      else { const val = v.init ? (v.init.y ? yield* this.evg(v.init, env) : this.evs(v.init, env)) : (d.ty === 'String' ? '' : 0); rec = { ty: d.ty, v: this.store(d.ty, val, v.line), c: d.isConst }; }
      if (d.isStatic && !global) this.statics.set(v.line + ':' + v.name, rec);
      map.set(v.name, rec);
    }
  }
  // referência a variável ou posição de array
  ref(e, env) {
    if (e.k === 'id') { const r = this.lookup(env, e.name); if (!r) this.err(e.line, `"${e.name}" não existe aqui.`); return { get: () => r.v, set: v => { r.v = this.store(r.ty, v, e.line); return r.v; }, ty: r.ty }; }
    const chain = []; let x = e; while (x.k === 'idx') { chain.unshift(x.i); x = x.a; }
    const r = this.lookup(env, x.name);
    if (r && r.ty === 'String' && !r.arr) { const i = this.evs(chain[0], env); return { get: () => (r.v.charCodeAt(i) || 0), set: v => { if (i < 0 || i >= r.v.length) this.err(e.line, `Posição ${i} fora do texto (tamanho ${r.v.length}).`); r.v = r.v.slice(0, i) + String.fromCharCode(v) + r.v.slice(i + 1); return v; }, ty: 'char' }; }
    if (!r || !r.arr) this.err(e.line, 'Colchetes em algo que não é array.');
    let a = r.arr; const idx = chain.map(c => this.evs(c, env));
    for (let k = 0; k < idx.length - 1; k++) { if (idx[k] < 0 || idx[k] >= a.length) this.err(e.line, `Índice ${idx[k]} fora do array ${x.name} (tamanho ${a.length}).`); a = a[idx[k]]; }
    const i = idx[idx.length - 1];
    if (!Number.isInteger(i) || i < 0 || i >= a.length) this.err(e.line, `Índice ${i} fora do array ${x.name} (0 a ${a.length - 1}). No Arduino real isso corrompe a memória.`);
    return { get: () => a[i], set: v => (a[i] = this.store(r.ty, v, e.line)), ty: r.ty };
  }
  // operadores
  bin(op, a, b, ty, line, ta, tb) {
    if (op === '&&') return a && b ? 1 : 0; if (op === '||') return a || b ? 1 : 0;
    if (ty === 'cstr' && op === '+') { const s = typeof a === 'string' ? a : b, n = typeof a === 'string' ? b : a; return n >= 0 && n <= s.length ? s.slice(n) : ''; }
    if (ty === 'String' || typeof a === 'string' || typeof b === 'string') {
      const sa = typeof a === 'string' ? a : this.str(a, ta), sb = typeof b === 'string' ? b : this.str(b, tb);
      switch (op) { case '+': return sa + sb; case '==': return sa === sb ? 1 : 0; case '!=': return sa !== sb ? 1 : 0; case '<': return sa < sb ? 1 : 0; case '>': return sa > sb ? 1 : 0; case '<=': return sa <= sb ? 1 : 0; case '>=': return sa >= sb ? 1 : 0; }
      this.err(line, `Operador ${op} não funciona com texto.`);
    }
    let r;
    switch (op) {
      case '+': r = a + b; break; case '-': r = a - b; break; case '*': r = a * b; break;
      case '/': if (b === 0) { if (ty === 'float') { this.warn(line, 'Divisão por zero com float: o resultado é infinito.'); r = a / b; break; } this.err(line, 'Divisão por zero. No Arduino real o resultado é imprevisível.'); } r = ty === 'float' ? a / b : Math.trunc(a / b); break;
      case '%': if (b === 0) this.err(line, 'Resto de divisão por zero.'); r = a % b; break;
      case '<<': r = ty === 'float' ? 0 : a * 2 ** b; break; case '>>': r = Math.floor(a / 2 ** b); break;
      case '&': r = (a & b) >>> 0; break; case '|': r = (a | b) >>> 0; break; case '^': r = (a ^ b) >>> 0; break;
      case '==': return a == b ? 1 : 0; case '!=': return a != b ? 1 : 0; case '<': return a < b ? 1 : 0; case '>': return a > b ? 1 : 0; case '<=': return a <= b ? 1 : 0; case '>=': return a >= b ? 1 : 0;
    }
    return ty === 'float' ? r : this.store(ty === 'bool' ? 'int' : ty, r, line);
  }
  // avaliação sem pausas (a maior parte das expressões)
  evs(e, env) {
    switch (e.k) {
      case 'num': case 'chr': return e.v;
      case 'str': return e.v;
      case 'id': { if (e.cv !== undefined) return e.cv; const r = this.lookup(env, e.name); if (!r) this.err(e.line, `"${e.name}" não existe aqui.`); return r.arr ? r.arr : r.v; }
      case 'un': { const a = this.evs(e.a, env); return e.op === '!' ? (a ? 0 : 1) : e.op === '-' ? this.bin('-', 0, a, e.ty, e.line) : e.op === '~' ? this.store(e.ty, ~a, e.line) : a; }
      case 'bin': { if (e.op === '&&') return this.evs(e.a, env) ? (this.evs(e.b, env) ? 1 : 0) : 0; if (e.op === '||') return this.evs(e.a, env) ? 1 : (this.evs(e.b, env) ? 1 : 0); return this.bin(e.op, this.evs(e.a, env), this.evs(e.b, env), e.ty, e.line, e.a.ty, e.b.ty); }
      case 'tern': return this.evs(e.c, env) ? this.evs(e.a, env) : this.evs(e.b, env);
      case 'cast': { const v = this.evs(e.a, env); if (e.ty === 'String') return this.str(v, e.a.ty); return typeof v === 'string' ? this.err(e.line, 'Conversão de texto para número: use .toInt().') : e.ty === 'float' ? v : this.store(e.ty, v, e.line); }
      case 'comma': { let v; for (const x of e.list) v = this.evs(x, env); return v; }
      case 'idx': return this.ref(e, env).get();
      case 'asg': return this.assign(e, env, this.evs(e.b, env));
      case 'pre': case 'post': { const r = this.ref(e.a, env), old = r.get(); const nv = r.set(old + (e.op === '++' ? 1 : -1)); return e.k === 'pre' ? nv : old; }
      case 'call': return this.callSync(e, env, e.args.map(a => this.evs(a, env)));
    }
    this.err(e.line, 'Expressão não suportada.');
  }
  assign(e, env, v) {
    const r = this.ref(e.a, env);
    if (e.op === '=') return r.set(v);
    const op = e.op.slice(0, -1);
    return r.set(this.bin(op, r.get(), v, promote(r.ty, e.b.ty === 'cstr' ? 'String' : e.b.ty), e.line, r.ty, e.b.ty));
  }
  // avaliação com pausas possíveis (delay, funções do usuário)
  *evg(e, env) {
    if (!e.y) return this.evs(e, env);
    switch (e.k) {
      case 'un': { const a = yield* this.evg(e.a, env); return e.op === '!' ? (a ? 0 : 1) : e.op === '-' ? -a : e.op === '~' ? ~a : a; }
      case 'bin': { const a = yield* this.evg(e.a, env); if (e.op === '&&' && !a) return 0; if (e.op === '||' && a) return 1; const b = yield* this.evg(e.b, env); return this.bin(e.op, a, b, e.ty, e.line, e.a.ty, e.b.ty); }
      case 'tern': return (yield* this.evg(e.c, env)) ? yield* this.evg(e.a, env) : yield* this.evg(e.b, env);
      case 'cast': { const v = yield* this.evg(e.a, env); return e.ty === 'String' ? this.str(v, e.a.ty) : e.ty === 'float' ? v : this.store(e.ty, v, e.line); }
      case 'comma': { let v; for (const x of e.list) v = yield* this.evg(x, env); return v; }
      case 'asg': return this.assign(e, env, yield* this.evg(e.b, env));
      case 'call': {
        const args = []; for (const a of e.args) args.push(yield* this.evg(a, env));
        if (e.user) return yield* this.callUser(e.f.name, args, e.line);
        const nm = e.f.name;
        if (nm === 'delay' || nm === 'delayMicroseconds') { const t = args[0] * (nm === 'delay' ? 1000 : 1); if (t < 0) this.err(e.line, 'delay() negativo.'); RT.vt += t; yield 'delay'; return 0; }
        return this.callSync(e, env, args);
      }
    }
    return this.evs(e, env);
  }
  *callUser(name, args, line) {
    const f = this.prog.funcs.get(name);
    if (++this.depth > 120) this.err(line || f.line, `Recursão profunda demais em ${name}(). No Arduino a memória acabaria.`);
    const env = { vars: new Map(), parent: null };
    f.params.forEach((p, i) => env.vars.set(p.name, p.arr ? { ty: p.ty, arr: args[i] } : { ty: p.ty, v: this.store(p.ty, args[i], f.line) }));
    const r = yield* this.exec(f.body, env, f);
    this.depth--;
    return r && r.t === 'ret' ? (f.ty === 'void' ? 0 : this.store(f.ty, r.v, f.line)) : (f.ty === 'String' ? '' : 0);
  }
  pinOf(v, line) { const pid = pinIdFor(this.type, v); if (!pid) this.err(line, `O pino ${v} não existe no ${MCU[this.type].label}.`); return pid; }
  cfg(pid) { return RT.pins[pid] || (RT.pins[pid] = { mode: 'in', level: 0, duty: 0, set: false, written: 0 }); }
  setPin(pid, patch) { const c = this.cfg(pid); Object.assign(c, patch); app.RUNCFG[this.mo.id] = app.RUNCFG[this.mo.id] || {}; app.RUNCFG[this.mo.id][pid] = { mode: c.mode, level: c.level, duty: c.duty }; RT.dirty = true; }
  readV(pid, line) {
    if (RT.dirty) simRefresh();
    const key = mk(this.mo.id, pid), r = app.SIM.ok ? app.SIM.mcu.get(key) : null;
    if (!r) return null;
    if (r.floating) { this.warn(line, `${pid} está flutuando (sem pull-up e sem ligação definida): a leitura é aleatória. Use INPUT_PULLUP ou um resistor.`); return Math.random() < 0.5 ? 0 : MCU[this.type].vcc; }
    return r.v;
  }
  callSync(e, env, args) {
    const m = MCU[this.type];
    if (e.f.k === 'mem') {
      if (e.obj === 'Serial') return this.serial(e.f.name, args, e);
      const ref = e.f.o.k === 'id' || e.f.o.k === 'idx' ? this.ref(e.f.o, env) : null, s = ref ? ref.get() : this.evs(e.f.o, env);
      const set = v => { if (ref) ref.set(v); };
      switch (e.f.name) {
        case 'length': return s.length; case 'toInt': return this.store('long', parseInt(s, 10) || 0, e.line); case 'toFloat': return parseFloat(s) || 0;
        case 'indexOf': return s.indexOf(typeof args[0] === 'string' ? args[0] : String.fromCharCode(args[0]), args[1] || 0);
        case 'lastIndexOf': return s.lastIndexOf(typeof args[0] === 'string' ? args[0] : String.fromCharCode(args[0]));
        case 'substring': return s.substring(args[0], args[1] == null ? undefined : args[1]);
        case 'charAt': return s.charCodeAt(args[0]) || 0; case 'equals': return s === args[0] ? 1 : 0; case 'equalsIgnoreCase': return s.toLowerCase() === String(args[0]).toLowerCase() ? 1 : 0;
        case 'startsWith': return s.startsWith(args[0]) ? 1 : 0; case 'endsWith': return s.endsWith(args[0]) ? 1 : 0;
        case 'trim': set(s.trim()); return 0; case 'toUpperCase': set(s.toUpperCase()); return 0; case 'toLowerCase': set(s.toLowerCase()); return 0;
        case 'replace': set(s.split(typeof args[0] === 'string' ? args[0] : String.fromCharCode(args[0])).join(typeof args[1] === 'string' ? args[1] : String.fromCharCode(args[1]))); return 0;
        case 'concat': set(s + this.str(args[0], e.args[0].ty)); return 1; case 'c_str': return s; case 'isEmpty': return s.length ? 0 : 1;
        case 'remove': set(s.slice(0, args[0]) + (args[1] == null ? '' : s.slice(args[0] + args[1]))); return 0;
      }
      this.err(e.line, `Método ${e.f.name} não suportado.`);
    }
    const nm = e.f.name;
    switch (nm) {
      case 'pinMode': { const pid = this.pinOf(args[0], e.line), md = args[1]; this.cfg(pid).set = true; this.setPin(pid, md === 1 ? { mode: 'out', level: this.cfg(pid).written, duty: 0 } : md === 2 ? { mode: 'pullup', level: 0, duty: 0 } : { mode: 'in', level: 0, duty: 0 }); return 0; }
      case 'digitalWrite': { const pid = this.pinOf(args[0], e.line), c = this.cfg(pid), lv = args[1] ? 1 : 0; c.written = lv; if (c.mode === 'out' || c.mode === 'pwm') this.setPin(pid, { mode: 'out', level: lv, duty: 0 }); else { if (lv) this.warn(e.line, `digitalWrite(HIGH) em ${pid} sem pinMode OUTPUT liga só o pull-up interno (~35 kΩ).`); this.setPin(pid, { mode: lv ? 'pullup' : 'in', level: 0 }); } return 0; }
      case 'digitalRead': { const pid = this.pinOf(args[0], e.line), c = this.cfg(pid); if (c.mode === 'out') return c.level; if (c.mode === 'pwm') return c.duty > 50 ? 1 : 0; const v = this.readV(pid, e.line); if (v == null) { this.warn(e.line, `${pid} não está ligado a nada: a leitura fica flutuando.`); return Math.random() < 0.5 ? 1 : 0; } if (v > 0.6 * m.vcc) return 1; if (v < 0.3 * m.vcc) return 0; this.warn(e.line, `${pid} está com ${v.toFixed(2)} V, entre LOW e HIGH: leitura instável.`); return v > m.vcc / 2 ? 1 : 0; }
      case 'analogRead': { const pid = this.pinOf(args[0], e.line); if (!mcuCaps(m, m.pin[pid]).analog) this.err(e.line, `${pid} não tem entrada analógica.`); const c = this.cfg(pid); if (c.mode !== 'in' && c.mode !== 'analog' && c.mode !== 'pullup') this.warn(e.line, `analogRead em ${pid}, que está como saída.`); if (c.mode === 'in') this.setPin(pid, { mode: 'analog' }); const v = this.readV(pid, e.line); if (v == null) { this.warn(e.line, `${pid} não está ligado a nada: a leitura analógica flutua.`); return Math.floor(Math.random() * m.adc); } return Math.round(clamp(v / m.vcc, 0, 1) * m.adc); }
      case 'analogWrite': { const pid = this.pinOf(args[0], e.line), caps = mcuCaps(m, m.pin[pid]); const v = clamp(Math.round(args[1]), 0, 255); if (args[1] > 255 || args[1] < 0) this.warn(e.line, `analogWrite aceita 0 a 255; ${Math.round(args[1])} foi limitado a ${v}.`); if (!this.cfg(pid).set && this.cfg(pid).mode === 'in') this.cfg(pid).set = true; if (!caps.pwm) { this.setPin(pid, { mode: 'out', level: v >= 128 ? 1 : 0, duty: 0 }); return 0; } if (v === 0) this.setPin(pid, { mode: 'out', level: 0, duty: 0 }); else if (v === 255) this.setPin(pid, { mode: 'out', level: 1, duty: 100 }); else this.setPin(pid, { mode: 'pwm', level: 0, duty: v / 255 * 100 }); return 0; }
      case 'tone': { const pid = this.pinOf(args[0], e.line); this.setPin(pid, { mode: 'pwm', duty: 50 }); if (args[2]) this.toneEnd = { pid, t: RT.vt + args[2] * 1000 }; return 0; }
      case 'noTone': { const pid = this.pinOf(args[0], e.line); this.setPin(pid, { mode: 'out', level: 0, duty: 0 }); return 0; }
      case 'millis': return this.store('ulong', Math.floor(RT.vt / 1000), e.line);
      case 'micros': return this.store('ulong', Math.floor(RT.vt), e.line);
      case 'delay': case 'delayMicroseconds': RT.vt += args[0] * (nm === 'delay' ? 1000 : 1); return 0;
      case 'map': { const [x, a, b, c, d] = args; if (b === a) this.err(e.line, 'map() com faixa de entrada vazia.'); return this.store('long', Math.trunc((x - a) * (d - c) / (b - a) + c), e.line); }
      case 'constrain': return Math.min(Math.max(args[0], args[1]), args[2]);
      case 'min': return Math.min(args[0], args[1]); case 'max': return Math.max(args[0], args[1]); case 'abs': return Math.abs(args[0]);
      case 'pow': return Math.pow(args[0], args[1]); case 'sqrt': if (args[0] < 0) this.warn(e.line, 'Raiz de número negativo dá NaN.'); return Math.sqrt(args[0]); case 'sq': return args[0] * args[0];
      case 'sin': return Math.sin(args[0]); case 'cos': return Math.cos(args[0]); case 'tan': return Math.tan(args[0]); case 'floor': return Math.floor(args[0]); case 'ceil': return Math.ceil(args[0]); case 'round': return Math.round(args[0]); case 'fabs': return Math.abs(args[0]); case 'log': return Math.log(args[0]); case 'exp': return Math.exp(args[0]);
      case 'random': { RT.rnd = (RT.rnd * 1103515245 + 12345) % 2147483648; const r = RT.rnd / 2147483648; const [lo, hi] = args.length === 2 ? args : [0, args[0]]; return hi <= lo ? lo : lo + Math.floor(r * (hi - lo)); }
      case 'randomSeed': RT.rnd = Math.abs(Math.trunc(args[0])) % 2147483647 || 1; return 0;
      case 'bitRead': return (args[0] >> args[1]) & 1; case 'bitSet': return args[0] | (1 << args[1]); case 'bitClear': return args[0] & ~(1 << args[1]); case 'bitWrite': return args[2] ? args[0] | (1 << args[1]) : args[0] & ~(1 << args[1]); case 'bit': return 2 ** args[0];
      case 'highByte': return (args[0] >> 8) & 255; case 'lowByte': return args[0] & 255;
      case 'isDigit': return args[0] >= 48 && args[0] <= 57 ? 1 : 0; case 'isAlpha': return /[A-Za-z]/.test(String.fromCharCode(args[0])) ? 1 : 0; case 'isSpace': return /\s/.test(String.fromCharCode(args[0])) ? 1 : 0;
      case 'yield': return 0;
      case 'String': { if (!args.length) return ''; const a = args[0], t = e.args[0].ty; if (typeof a === 'string') return a; if (args.length === 2) return t === 'float' ? (+a).toFixed(args[1]) : Math.trunc(a).toString(args[1]).toUpperCase(); return this.str(a, t); }
    }
    this.err(e.line, `Função ${nm}() não suportada.`);
  }
  serial(nm, args, e) {
    const fmt = (v, t, f) => { if (typeof v === 'string' || Array.isArray(v)) return this.str(v); if (t === 'float') return (+v).toFixed(f == null ? 2 : f); if (t === 'char' && f == null) return String.fromCharCode(v); if (f === 16) return (v >>> 0).toString(16).toUpperCase(); if (f === 2) return (v >>> 0).toString(2); if (f === 8) return (v >>> 0).toString(8); return String(Math.trunc(v)); };
    const out = s => { if (!RT.serialOn) { this.warn(e.line, 'Serial usado antes de Serial.begin(): nada sai no monitor.'); return 0; } RT.serialOut += s; if (RT.serialOut.length > 20000) RT.serialOut = RT.serialOut.slice(-15000); RT.uiDirty = true; return s.length; };
    switch (nm) {
      case 'begin': RT.serialOn = true; RT.baud = args[0]; if (![300, 1200, 2400, 4800, 9600, 14400, 19200, 28800, 38400, 57600, 74880, 115200, 230400, 250000, 500000, 1000000].includes(args[0])) this.warn(e.line, `Velocidade ${args[0]} incomum: o monitor serial precisa estar na mesma velocidade.`); return 0;
      case 'end': RT.serialOn = false; return 0;
      case 'print': return out(fmt(args[0], e.args[0].ty, args[1]));
      case 'println': return out((args.length ? fmt(args[0], e.args[0].ty, args[1]) : '') + '\n');
      case 'write': return out(typeof args[0] === 'string' ? args[0] : String.fromCharCode(args[0]));
      case 'available': return RT.serialIn.length; case 'availableForWrite': return 63;
      case 'read': { if (!RT.serialIn.length) return -1; const c = RT.serialIn.charCodeAt(0); RT.serialIn = RT.serialIn.slice(1); return c; }
      case 'peek': return RT.serialIn.length ? RT.serialIn.charCodeAt(0) : -1;
      case 'readString': { const s = RT.serialIn; RT.serialIn = ''; return s; }
      case 'readStringUntil': { const ch = typeof args[0] === 'string' ? args[0] : String.fromCharCode(args[0]); const i = RT.serialIn.indexOf(ch); const s = i < 0 ? RT.serialIn : RT.serialIn.slice(0, i); RT.serialIn = i < 0 ? '' : RT.serialIn.slice(i + 1); return s; }
      case 'parseInt': { const m2 = /-?\d+/.exec(RT.serialIn); if (!m2) { RT.serialIn = ''; return 0; } RT.serialIn = RT.serialIn.slice(m2.index + m2[0].length); return +m2[0]; }
      case 'parseFloat': { const m2 = /-?\d+(\.\d+)?/.exec(RT.serialIn); if (!m2) { RT.serialIn = ''; return 0; } RT.serialIn = RT.serialIn.slice(m2.index + m2[0].length); return +m2[0]; }
      case 'flush': case 'setTimeout': return 0;
    }
    return 0;
  }
  // comandos
  *exec(s, env, fn) {
    RT.vt += this.cost;
    if (++RT.steps % 1500 === 0) yield 'steps';
    if (this.toneEnd && RT.vt >= this.toneEnd.t) { this.setPin(this.toneEnd.pid, { mode: 'out', level: 0, duty: 0 }); this.toneEnd = null; }
    switch (s.k) {
      case 'block': { const inner = { vars: new Map(), parent: env }; for (const x of s.body) { const r = yield* this.exec(x, inner, fn); if (r) return r; } return null; }
      case 'decl': yield* this.declare(s, env, false); return null;
      case 'expr': if (s.e.y) yield* this.evg(s.e, env); else this.evs(s.e, env); return null;
      case 'empty': return null;
      case 'if': { const c = s.c.y ? yield* this.evg(s.c, env) : this.evs(s.c, env); if (c) return yield* this.exec(s.t, env, fn); if (s.f) return yield* this.exec(s.f, env, fn); return null; }
      case 'while': case 'do': {
        if (s.k === 'do') { const r = yield* this.exec(s.body, env, fn); if (r && r.t === 'ret') return r; if (r && r.t === 'brk') return null; }
        for (;;) { const c = s.c.y ? yield* this.evg(s.c, env) : this.evs(s.c, env); if (!c) return null; const r = yield* this.exec(s.body, env, fn); if (r) { if (r.t === 'brk') return null; if (r.t === 'ret') return r; } RT.vt += this.cost; if (++RT.steps % 1500 === 0) yield 'steps'; }
      }
      case 'for': {
        const fe = { vars: new Map(), parent: env };
        if (s.init) { if (s.init.k === 'decl') yield* this.declare(s.init, fe, false); else if (s.init.e.y) yield* this.evg(s.init.e, fe); else this.evs(s.init.e, fe); }
        for (;;) { if (s.c && !(s.c.y ? yield* this.evg(s.c, fe) : this.evs(s.c, fe))) return null; const r = yield* this.exec(s.body, fe, fn); if (r) { if (r.t === 'brk') return null; if (r.t === 'ret') return r; } if (s.step) { if (s.step.y) yield* this.evg(s.step, fe); else this.evs(s.step, fe); } RT.vt += this.cost; if (++RT.steps % 1500 === 0) yield 'steps'; }
      }
      case 'switch': {
        const v = s.e.y ? yield* this.evg(s.e, env) : this.evs(s.e, env); let on = false; const se = { vars: new Map(), parent: env };
        for (const c of s.cases) { if (!on && (c.v === null ? false : this.evs(c.v, env) == v)) on = true; if (on) for (const x of c.body) { const r = yield* this.exec(x, se, fn); if (r) { if (r.t === 'brk') return null; return r; } } }
        if (!on) { const d = s.cases.findIndex(c => c.v === null); if (d >= 0) for (let i = d; i < s.cases.length; i++) for (const x of s.cases[i].body) { const r = yield* this.exec(x, se, fn); if (r) { if (r.t === 'brk') return null; return r; } } }
        return null;
      }
      case 'break': return { t: 'brk' };
      case 'continue': return { t: 'cont' };
      case 'return': return { t: 'ret', v: s.e ? (s.e.y ? yield* this.evg(s.e, env) : this.evs(s.e, env)) : 0 };
    }
    return null;
  }
  *main() {
    for (const g of this.prog.globals) yield* this.declare(g, null, true);
    yield* this.callUser('setup', [], 1);
    for (;;) { yield* this.callUser('loop', [], 1); RT.vt += 4; RT.loops = (RT.loops || 0) + 1; yield 'loop'; }
  }
}

export function simRefresh() { app.AN = analyze(); app.SIM = simulate(app.AN); RT.dirty = false; RT.uiDirty = true; }

export function runCode() {
  const mo = mcuById(codeMid()); if (!mo) { say('Adicione um Arduino ou ESP32 na bancada para rodar código.', true); return; }
  stopCode(true);
  const r = compileCode(mo.code || '', mo);
  RT.diags = r.diags;
  if (!r.ok) { RT.stopped = 'Corrija os erros antes de rodar.'; renderDock(); changed({ noSave: true }); return; }
  Object.assign(RT, { running: true, paused: false, mid: mo.id, mo, vt: 0, target: 0, serialOut: '', runDiags: [], dirty: true, steps: 0, pins: {}, serialOn: false, loops: 0, stopped: '', last: performance.now() });
  app.RUNCFG = { [mo.id]: {} };
  RT.interp = new Interp(r.prog, mo); RT.gen = RT.interp.main();
  tickCode();
  renderDock(); changed({ noSave: true });
}

export function stopCode(silent) {
  if (!RT.running && !RT.paused) { if (!silent) renderDock(); return; }
  cancelAnimationFrame(RT.raf); RT.running = false; RT.paused = false; RT.gen = null; app.RUNCFG = {};
  for (const c of app.S.comps) if (c.type === 'btn' && c.p.pressed && pressBtn === c.id) c.p.pressed = false;
  if (!silent) { RT.stopped = 'Parado.'; changed({ noSave: true }); renderDock(); }
}

export function pauseCode() { if (!RT.running) return; RT.paused = !RT.paused; if (!RT.paused) { RT.last = performance.now(); tickCode(); } else cancelAnimationFrame(RT.raf); renderDock(); }

export function tickCode() {
  if (!RT.running || RT.paused) return;
  const now = performance.now(), dt = Math.min(now - RT.last, 100); RT.last = now;
  RT.target = Math.max(RT.target || 0, RT.vt - 200000) + dt * 1000 * RT.speed; const target = RT.target, t0 = performance.now();
  try {
    while (RT.vt < target && performance.now() - t0 < 12) { const r = RT.gen.next(); if (r.done) { RT.running = false; RT.stopped = 'O programa terminou.'; break; } if (RT.dirty && r.value === 'delay') simRefresh(); }
  } catch (e) {
    RT.running = false;
    if (e instanceof CodeErr) { RT.runDiags.push({ sev: 'err', line: e.line, msg: e.message }); RT.stopped = `Parou na linha ${e.line}: ${e.message}`; }
    else { RT.stopped = 'Erro interno do simulador: ' + e.message; console.error(e); }
  }
  if (RT.dirty) simRefresh();
  if (RT.uiDirty && now - RT.lastRender > 90) { RT.uiDirty = false; RT.lastRender = now; renderItems(); renderOverlay(); renderStatus(); if (app.tab === 'sim' || app.tab === 'drc') renderTabs(); renderDockLive(); }
  if (RT.running) RT.raf = requestAnimationFrame(tickCode); else { app.RUNCFG = {}; changed({ noSave: true }); renderDock(); }
}

export function codeIssues() {
  const out = [];
  for (const mo of app.S.mcus) {
    if (!(mo.code || '').trim()) continue;
    const r = mo.id === RT.mid && RT.diags.length ? { diags: RT.diags } : (CODECHK.get(mo.id) || { diags: [] });
    const list = r.diags.concat(mo.id === RT.mid ? RT.runDiags : []).filter(d => d.sev !== 'info');
    for (const d of list) out.push({ sev: d.sev, msg: `Código do ${mo.name}, linha ${d.line}: ${d.msg}`, at: null, mcu: mo.id, code: true, line: d.line });
  }
  return out;
}

export const CODECHK = new Map();
export function checkAllCode() { for (const mo of app.S.mcus) if ((mo.code || '').trim()) { try { CODECHK.set(mo.id, compileCode(mo.code, mo)); } catch (e) { CODECHK.set(mo.id, { diags: [{ sev: 'err', line: 1, msg: 'Erro interno: ' + e.message }] }); } } }
export let chkTimer = 0;
export function onCircuitChanged() { if (RT.running) return; clearTimeout(chkTimer); chkTimer = setTimeout(() => { checkAllCode(); if (!$('dock').hidden) renderDockDiags(); }, 400); }

// ─── painel de código ───
export let dockMid = null;

export function codeMid() { if (dockMid && mcuById(dockMid)) return dockMid; dockMid = app.S.mcus.length ? app.S.mcus[0].id : null; return dockMid; }
export function openCode(mid) { dockMid = mid; $('dock').hidden = false; $('bCode').classList.add('on'); renderDock(); setTimeout(() => $('codeArea') && $('codeArea').focus(), 50); }

export function renderDock() {
  const d = $('dock'); if (d.hidden) return;
  const mid = codeMid(), mo = mid && mcuById(mid);
  $('codeMcu').innerHTML = app.S.mcus.length ? app.S.mcus.map(m => `<option value="${m.id}"${m.id === mid ? ' selected' : ''}>${esc(m.name)}</option>`).join('') : '<option>sem microcontrolador</option>';
  $('codeMcu').disabled = !app.S.mcus.length;
  const area = $('codeArea');
  if (!mo) { area.value = ''; area.disabled = true; area.placeholder = 'Adicione um Arduino ou ESP32 na bancada (biblioteca → Placas e controladores).'; }
  else { area.disabled = false; area.placeholder = ''; if (document.activeElement !== area || area.dataset.mid !== String(mo.id)) area.value = mo.code || ''; area.dataset.mid = mo.id; }
  const running = RT.running && RT.mid === mid;
  $('cRun').disabled = !mo; $('cRun').textContent = running ? '↻ Reiniciar' : '▶ Rodar';
  $('cPause').disabled = !running && !(RT.paused && RT.mid === mid); $('cPause').textContent = RT.paused ? '▶ Continuar' : '⏸ Pausar';
  $('cStop').disabled = !(RT.running || RT.paused);
  $('cCheck').disabled = !mo;
  renderGutter(); renderDockDiags(); renderDockLive();
}

export function renderGutter() {
  const area = $('codeArea'), n = (area.value.match(/\n/g) || []).length + 1, bad = new Map();
  const mo = mcuById(codeMid()); const diags = mo ? (mo.id === RT.mid && RT.diags.length ? RT.diags.concat(RT.runDiags) : (CODECHK.get(mo.id) || { diags: [] }).diags) : [];
  for (const d of diags) if (!bad.has(d.line) || d.sev === 'err') bad.set(d.line, d.sev);
  let h = ''; for (let i = 1; i <= n; i++) h += `<div class="${bad.get(i) || ''}">${i}</div>`;
  $('gutter').innerHTML = h; $('gutter').scrollTop = area.scrollTop;
}

export function renderDockDiags() {
  const mo = mcuById(codeMid()); if (!mo) { $('codeDiags').innerHTML = ''; return; }
  const base = mo.id === RT.mid && RT.diags.length ? RT.diags : (CODECHK.get(mo.id) || { diags: [] }).diags, list = base.concat(mo.id === RT.mid ? RT.runDiags : []);
  const e = list.filter(d => d.sev === 'err').length, w = list.filter(d => d.sev === 'warn').length;
  $('codeSum').innerHTML = !(mo.code || '').trim() ? '<span class="pill mute">vazio</span>' : e ? `<span class="pill err">${e} erro${e > 1 ? 's' : ''}</span>` : w ? `<span class="pill warn">${w} aviso${w > 1 ? 's' : ''}</span>` : '<span class="pill ok">sem erros</span>';
  $('codeDiags').innerHTML = list.length ? list.map((d, i) => `<li class="${d.sev}" data-line="${d.line}" tabindex="0"><span class="mono">L${d.line}</span> ${esc(d.msg)}</li>`).join('') : `<li class="info" style="cursor:default">${(mo.code || '').trim() ? 'Nenhum problema encontrado no código.' : 'Escreva o código ou escolha um modelo.'}</li>`;
  renderGutter();
}

export function renderDockLive() {
  const running = RT.running && RT.mid === codeMid();
  const t = RT.vt / 1e6;
  $('codeTime').textContent = (RT.running || RT.paused) ? `t = ${t < 60 ? t.toFixed(2) + ' s' : Math.floor(t / 60) + ' min ' + (t % 60).toFixed(0) + ' s'}${RT.paused ? ' · pausado' : ''}` : (RT.stopped || 'parado');
  $('codeState').className = 'pill ' + (running ? 'ok' : RT.paused ? 'warn' : 'mute'); $('codeState').textContent = running ? 'rodando' : RT.paused ? 'pausado' : 'parado';
  const out = $('serialOut'), atEnd = out.scrollTop + out.clientHeight >= out.scrollHeight - 8;
  out.textContent = RT.serialOut || (RT.running ? '' : 'O que o programa enviar com Serial.print aparece aqui.');
  if (atEnd) out.scrollTop = out.scrollHeight;
  if (running) renderDockDiags();
}

export function jumpToLine(n) {
  const area = $('codeArea'), lines = area.value.split('\n'); let pos = 0; for (let i = 0; i < n - 1 && i < lines.length; i++) pos += lines[i].length + 1;
  area.focus(); area.setSelectionRange(pos, pos + (lines[n - 1] || '').length);
  const lh = parseFloat(getComputedStyle(area).lineHeight) || 18; area.scrollTop = Math.max(0, (n - 4) * lh); renderGutter();
}

export let codeSaveT = 0;


/** Efeitos de inicialização do módulo (eventos, DOM). Chamado por main.ts na ordem certa. */
export function mount() {
  $('codeArea').addEventListener('input', () => { const mo = mcuById(codeMid()); if (!mo) return; mo.code = $('codeArea').value; renderGutter(); clearTimeout(codeSaveT); codeSaveT = setTimeout(() => { scheduleSave(); try { CODECHK.set(mo.id, compileCode(mo.code, mo)); } catch (e) {} if (!(RT.running && RT.mid === mo.id)) { RT.diags = RT.mid === mo.id ? [] : RT.diags; } renderDockDiags(); renderTabs(); }, 500); });
  $('codeArea').addEventListener('scroll', () => { $('gutter').scrollTop = $('codeArea').scrollTop; });
  $('codeArea').addEventListener('keydown', e => {
    const a = e.target;
    if (e.key === 'Tab') { e.preventDefault(); const s = a.selectionStart, en = a.selectionEnd; a.setRangeText('  ', s, en, 'end'); a.dispatchEvent(new Event('input')); }
    else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { const s = a.selectionStart, ln = a.value.slice(0, s).split('\n').pop(), ind = (/^\s*/.exec(ln)[0]) + (/\{\s*$/.test(ln) ? '  ' : ''); e.preventDefault(); a.setRangeText('\n' + ind, s, a.selectionEnd, 'end'); a.dispatchEvent(new Event('input')); }
    else if (e.key === '}' ) { const s = a.selectionStart, ln = a.value.slice(0, s).split('\n').pop(); if (/^\s+$/.test(ln) && ln.length >= 2) { e.preventDefault(); a.setRangeText('}', s - 2, a.selectionEnd, 'end'); a.dispatchEvent(new Event('input')); } }
    else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runCode(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); flushSave(); }
  });
  $('codeDiags').addEventListener('click', e => { const li = e.target.closest('[data-line]'); if (li) jumpToLine(+li.dataset.line); });
  $('codeDiags').addEventListener('keydown', e => { if (e.key === 'Enter') { const li = e.target.closest('[data-line]'); if (li) jumpToLine(+li.dataset.line); } });
  $('codeMcu').onchange = e => { dockMid = +e.target.value; renderDock(); };
  $('cRun').onclick = runCode;
  $('cStop').onclick = () => stopCode(false);
  $('cPause').onclick = pauseCode;
  $('cCheck').onclick = () => { const mo = mcuById(codeMid()); if (!mo) return; const r = compileCode(mo.code || '', mo); CODECHK.set(mo.id, r); if (!RT.running) RT.diags = []; renderDockDiags(); renderTabs(); say(r.ok ? (r.diags.length ? `Compila, com ${r.diags.length} aviso${r.diags.length > 1 ? 's' : ''}.` : 'Código sem erros.') : 'O código tem erros: veja a lista.', !r.ok); };
  $('cSpeed').onchange = e => { RT.speed = +e.target.value; };
  $('cTpl').innerHTML = '<option value="">Modelos…</option>' + Object.entries(CODE_TEMPLATES).map(([k, [l]]) => `<option value="${k}">${esc(l)}</option>`).join('');
  $('cTpl').onchange = e => { const k = e.target.value; e.target.value = ''; const mo = mcuById(codeMid()); if (!k || !mo) return; if ((mo.code || '').trim() && !$('cTpl').dataset.confirm) { $('cTpl').dataset.confirm = k; say('O modelo substitui o código atual. Escolha de novo para confirmar (Ctrl+Z não desfaz texto).', true); setTimeout(() => delete $('cTpl').dataset.confirm, 4000); return; } delete $('cTpl').dataset.confirm; mo.code = CODE_TEMPLATES[k][1](mo.type); scheduleSave(); CODECHK.set(mo.id, compileCode(mo.code, mo)); renderDock(); };
  $('serialForm').addEventListener('submit', e => { e.preventDefault(); const v = $('serialIn').value; if (!RT.running) { say('Rode o código para enviar dados pelo Serial.', true); return; } RT.serialIn += v + ($('serialNl').checked ? '\n' : ''); RT.serialOut += `> ${v}\n`; $('serialIn').value = ''; renderDockLive(); });
  $('serialClear').onclick = () => { RT.serialOut = ''; renderDockLive(); };
  $('bCode').onclick = () => { const d = $('dock'); d.hidden = !d.hidden; $('bCode').classList.toggle('on', !d.hidden); if (!d.hidden) { checkAllCode(); renderDock(); } };
  $('dockClose').onclick = () => { $('dock').hidden = true; $('bCode').classList.remove('on'); };
}
