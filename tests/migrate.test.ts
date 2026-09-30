import { it, expect } from 'vitest';
import { migrateV1 } from '../src/app/projects';
import { run } from './helpers';

it('projeto v1 (bancada 7×9) abre na versão atual', () => {
  const v1 = {
    comps: [{ id: 1, type: 'res', c: 3, r: 3, rot: 0, p: { name: 'R1', val: 330, span: 3, watt: 0.25 } }, { id: 2, type: 'npn', c: 8, r: 8, rot: 0, p: { name: 'Q1' } }],
    traces: [{ id: 3, pts: [[3, 3], [3, 6]] }], jumpers: [], solder: [3 * 24 + 3], nextId: 10,
  };
  const { S } = run(migrateV1(v1));
  expect(S.v).toBe(3);
  expect(S.boards.length).toBe(1);
  expect(S.comps.map((c: any) => c.type)).toEqual(['res', 'bjt']);
  expect(S.traces[0].tag).toBe(1);
});
