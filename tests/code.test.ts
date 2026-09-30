import { describe, it, expect } from 'vitest';
import { example, runCode, errs } from './helpers';

const mo = () => example('relay').S.mcus[0];

describe('interpretador Arduino', () => {
  it('Serial e digitalWrite', () => {
    const r = runCode('void setup(){Serial.begin(9600);pinMode(13,OUTPUT);Serial.println(2+3);} void loop(){digitalWrite(13,HIGH);delay(100);}', mo());
    expect(r.ok).toBe(true);
    expect(r.serial).toBe('5\n');
    expect(r.cfg.D13).toMatchObject({ mode: 'out', level: 1 });
  });
  it('overflow de int no AVR (16 bits)', () => {
    const r = runCode('void setup(){Serial.begin(9600);int x=32767;x=x+1;Serial.println(x);} void loop(){}', mo(), 1000);
    expect(r.serial.trim()).toBe('-32768');
  });
  it('delay avança o relógio virtual', () => {
    const r = runCode('void setup(){} void loop(){delay(250);}', mo(), 1e6);
    expect(r.vt).toBeGreaterThanOrEqual(1e6);
  });
});

describe('diagnósticos estáticos', () => {
  it('falta loop()', () => {
    const r = runCode('void setup(){}', mo());
    expect(r.ok).toBe(false);
    expect(r.diags.some((d: any) => /loop/.test(d.msg))).toBe(true);
  });
  it('erro de sintaxe aponta a linha', () => {
    const r = runCode('void setup(){\n  int a = ;\n}\nvoid loop(){}', mo());
    expect(r.ok).toBe(false);
    expect(errs(r.diags)[0].line).toBe(2);
  });
  it('variável não declarada', () => {
    const r = runCode('void setup(){ y = 3; } void loop(){}', mo());
    expect(r.ok).toBe(false);
  });
});
