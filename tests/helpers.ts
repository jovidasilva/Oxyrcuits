import { app } from '../src/state';
import { exampleState } from '../src/app/projects';
import { analyze } from '../src/core/analysis';
import { simulate } from '../src/sim/solver';
import { setDims } from '../src/ui/render';
import { normalize } from '../src/ui/interaction';
import { RT, Interp, compileCode } from '../src/code/arduino';

/** Carrega um estado e roda verificação + simulação, como o app faz em changed(). */
export function run(st: any) {
  app.S = normalize(st); app.RUNCFG = {}; setDims();
  const AN = (app.AN = analyze()); const SIM = (app.SIM = simulate(AN));
  const S = app.S;
  return { AN, SIM, S, by: (name: string) => SIM.comp.get(S.comps.find((c: any) => c.p.name === name).id) };
}
export const example = (k: string) => run(exampleState(k));
export const errs = (list: any[]) => list.filter(i => i.sev === 'err');

/** Executa código Arduino sem a UI até `us` microssegundos virtuais. */
export function runCode(src: string, mo: any, us = 1e6) {
  const r = compileCode(src, mo);
  if (!r.ok) return { ok: false, diags: r.diags, serial: '' };
  Object.assign(RT, { running: true, paused: false, mid: mo.id, mo, vt: 0, target: 0, serialOut: '', runDiags: [], dirty: false, steps: 0, pins: {}, serialOn: false, loops: 0, stopped: '' });
  app.RUNCFG = { [mo.id]: {} };
  const it = new Interp(r.prog, mo), gen = it.main();
  let guard = 0;
  while (RT.vt < us && guard++ < 2e6) { if (gen.next().done) break; }
  return { ok: true, diags: r.diags.concat(RT.runDiags), serial: RT.serialOut, cfg: app.RUNCFG[mo.id], vt: RT.vt };
}
