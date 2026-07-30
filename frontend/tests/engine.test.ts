/**
 * Condition engine — the riskiest part of the adaptive-forms change, because it
 * decides visibility for EVERY form that already exists. The first block pins
 * backward compatibility: a form authored before groups existed must behave
 * exactly as it did.
 */
import { describe, expect, it } from 'vitest';
import { evalCondition, readPath } from '../src/renderer/engine';
import type { ConditionNode } from '../src/types';

describe('старые однострочные условия', () => {
  const vals = { f_type: 'ip', f_sum: 100, f_tags: ['a', 'b'], f_empty: '' };

  it('eq / neq', () => {
    expect(evalCondition({ fieldId: 'f_type', operator: 'eq', value: 'ip' }, vals)).toBe(true);
    expect(evalCondition({ fieldId: 'f_type', operator: 'neq', value: 'ip' }, vals)).toBe(false);
  });

  it('gt / lt', () => {
    expect(evalCondition({ fieldId: 'f_sum', operator: 'gt', value: 50 }, vals)).toBe(true);
    expect(evalCondition({ fieldId: 'f_sum', operator: 'lt', value: 50 }, vals)).toBe(false);
  });

  it('contains для массива и строки', () => {
    expect(evalCondition({ fieldId: 'f_tags', operator: 'contains', value: 'a' }, vals)).toBe(true);
    expect(evalCondition({ fieldId: 'f_type', operator: 'contains', value: 'i' }, vals)).toBe(true);
  });

  it('empty / not_empty', () => {
    expect(evalCondition({ fieldId: 'f_empty', operator: 'empty' }, vals)).toBe(true);
    expect(evalCondition({ fieldId: 'f_type', operator: 'not_empty' }, vals)).toBe(true);
  });

  it('отсутствие условия = поле видно', () => {
    expect(evalCondition(undefined, vals)).toBe(true);
  });
});

describe('группы И/ИЛИ', () => {
  const vals = { role: 'manager', sum: 1000 };

  it('all — нужны все', () => {
    const yes: ConditionNode = { all: [
      { fieldId: 'role', operator: 'eq', value: 'manager' },
      { fieldId: 'sum', operator: 'gt', value: 500 },
    ] };
    const no: ConditionNode = { all: [
      { fieldId: 'role', operator: 'eq', value: 'manager' },
      { fieldId: 'sum', operator: 'gt', value: 5000 },
    ] };
    expect(evalCondition(yes, vals)).toBe(true);
    expect(evalCondition(no, vals)).toBe(false);
  });

  it('any — достаточно одного', () => {
    const node: ConditionNode = { any: [
      { fieldId: 'role', operator: 'eq', value: 'admin' },
      { fieldId: 'sum', operator: 'gt', value: 500 },
    ] };
    expect(evalCondition(node, vals)).toBe(true);
  });

  it('пустая группа не прячет поле', () => {
    expect(evalCondition({ all: [] }, vals)).toBe(true);
    expect(evalCondition({ any: [] }, vals)).toBe(true);
  });

  it('not инвертирует', () => {
    expect(evalCondition({ not: { fieldId: 'role', operator: 'eq', value: 'manager' } }, vals)).toBe(false);
  });

  it('вложенность', () => {
    const node: ConditionNode = { all: [
      { fieldId: 'role', operator: 'eq', value: 'manager' },
      { any: [{ fieldId: 'sum', operator: 'gt', value: 5000 }, { fieldId: 'sum', operator: 'eq', value: 1000 }] },
    ] };
    expect(evalCondition(node, vals)).toBe(true);
  });
});

describe('ссылки на ответ проверки', () => {
  const vals = {
    credit_check: { decision: 'need_docs', limits: { max: 500000 }, docs: ['passport'] },
    plain: 'x',
  };

  it('путь внутрь ответа', () => {
    expect(evalCondition({ fieldId: 'credit_check.decision', operator: 'eq', value: 'need_docs' }, vals)).toBe(true);
    expect(evalCondition({ fieldId: 'credit_check.limits.max', operator: 'gt', value: 100000 }, vals)).toBe(true);
  });

  it('несуществующий путь = пусто, а не падение', () => {
    expect(evalCondition({ fieldId: 'credit_check.nope.deep', operator: 'empty' }, vals)).toBe(true);
    expect(evalCondition({ fieldId: 'ghost.field', operator: 'eq', value: 'x' }, vals)).toBe(false);
  });

  it('пока проверку не выполнили — зависящее поле скрыто', () => {
    expect(evalCondition({ fieldId: 'credit_check.decision', operator: 'eq', value: 'need_docs' }, {})).toBe(false);
  });

  it('readPath: обычный id важнее пути', () => {
    expect(readPath({ 'a.b': 1, a: { b: 2 } }, 'a.b')).toBe(1);
    expect(readPath({ a: { b: 2 } }, 'a.b')).toBe(2);
    expect(readPath({ a: [{ b: 7 }] }, 'a.0.b')).toBe(7);
  });
});
