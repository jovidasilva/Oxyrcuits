import { describe, it, expect } from 'vitest';
import { exampleState } from '../src/app/projects';
import { example, run, errs } from './helpers';

describe('exemplos simulam sem erros', () => {
  for (const k of ['led', 'relay', 'motor', 'psu']) {
    it(k, () => {
      const { AN, SIM } = example(k);
      expect(SIM.ok).toBe(true);
      expect(errs(AN.issues)).toEqual([]);
      expect(errs(SIM.issues)).toEqual([]);
    });
  }
});

describe('valores do exemplo LED + 2N2222', () => {
  const { by } = example('led');
  it('LED acende com ~9 mA', () => { expect(by('D1').i).toBeGreaterThan(0.008); expect(by('D1').i).toBeLessThan(0.010); });
  it('transistor saturado', () => { expect(by('Q1').region).toBe('Saturação'); expect(by('Q1').vce).toBeLessThan(0.2); });
  it('lei de Ohm no resistor do LED', () => { const r = by('R2'); expect(r.v / r.i).toBeCloseTo(330, 0); });
});

it('regulador da fonte entrega 5 V', () => {
  const { by } = example('psu');
  expect(by('U1').vout).toBeCloseTo(5, 2);
  expect(by('U1').region).toBe('reg');
});

describe('falhas são detectadas', () => {
  it('resistor de 1 Ω no LED gera erro', () => {
    const st = exampleState('led'); st.comps.find((c: any) => c.p.name === 'R2').p.val = 1;
    const { AN, SIM } = run(st);
    expect(errs([...AN.issues, ...SIM.issues]).length).toBeGreaterThan(0);
  });
  it('sem trilhas o circuito não fecha', () => {
    const st = exampleState('led'); st.traces = []; st.wires = [];
    const { AN, by } = run(st);
    expect(AN.issues.length).toBeGreaterThan(0);
    expect(Math.abs(by('D1')?.i || 0)).toBeLessThan(1e-4);
  });
});

it('salvar/abrir mantém o estado (normalize é idempotente)', () => {
  const { S } = example('relay');
  const again = run(JSON.parse(JSON.stringify(S))).S;
  expect(again).toEqual(S);
});
