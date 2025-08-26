import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/utils/costCalculations.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 } });
const mod = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const { computeRowTotal, computeGroupTotal } = mod;

test('row total equals quantity * unit price * factor', () => {
  const total = computeRowTotal({ quantity: 2, unitPrice: 5, factor: 3 });
  assert.strictEqual(total, 30);
});

test('group total equals sum of child row totals', () => {
  const rows = [
    { quantity: 2, unitPrice: 5, factor: 1 },
    { quantity: 3, unitPrice: 4, factor: 2 },
  ];
  const groupTotal = computeGroupTotal(rows);
  assert.strictEqual(
    groupTotal,
    computeRowTotal(rows[0]) + computeRowTotal(rows[1])
  );
});

test('totals recompute after input change (simulate toggle)', () => {
  const rows = [{ quantity: 1, unitPrice: 10, factor: 1 }];
  let total = computeGroupTotal(rows);
  assert.strictEqual(total, 10);
  // change quantity
  rows[0].quantity = 2;
  total = computeGroupTotal(rows);
  assert.strictEqual(total, 20);
});

test('regression: ignores stale totals in data', () => {
  const row = { quantity: 1, unitPrice: 10, factor: 1, chf: 5 };
  const row2 = { quantity: 1, unitPrice: 5, factor: 1, totalChf: 99 };
  const total = computeGroupTotal([row, row2]);
  assert.strictEqual(total, 15);
});

