import { describe, it, expect } from 'vitest';
import { exampleState } from '../src/app/projects';
import { run, runCode, errs } from './helpers';

// Roda o código do exemplo com um som de teste no microfone e devolve o brilho (0–100%) de cada LED.
function brilhos(sinal: string) {
  const st = exampleState('audio');
  st.comps.find((c: any) => c.p.name === 'MK1').p.sinal = sinal;
  const { S, AN, SIM } = run(st);
  expect(errs([...AN.issues, ...SIM.issues])).toEqual([]);
  const mo = S.mcus[0], r = runCode(mo.code, mo, 1.5e6);
  expect(r.ok).toBe(true);
  expect(r.diags).toEqual([]);
  const pct = (p: string) => { const c = r.cfg[p] || {}; return c.mode === 'pwm' ? c.duty : c.level ? 100 : 0; };
  return { g: pct('D9'), m: pct('D10'), a: pct('D11'), serial: r.serial };
}

describe('analisador de áudio', () => {
  it('mede a taxa de amostragem (~8 kHz no Uno)', () => {
    const fs = +brilhos('mix').serial.match(/amostragem: (\d+)/)![1];
    expect(fs).toBeGreaterThan(6000); expect(fs).toBeLessThan(9000);
  });
  for (const [sinal, alvo] of [['grave', 'g'], ['medio', 'm'], ['agudo', 'a']] as const) {
    it(`tom ${sinal} acende só o LED da sua faixa`, () => {
      const b = brilhos(sinal) as any, outros = ['g', 'm', 'a'].filter(k => k !== alvo);
      expect(b[alvo]).toBeGreaterThan(40);
      for (const k of outros) expect(b[alvo]).toBeGreaterThan(2 * b[k]);
    });
  }
  it('silêncio apaga tudo', () => {
    const b = brilhos('silencio');
    expect(Math.max(b.g, b.m, b.a)).toBeLessThan(3);
  });
});
