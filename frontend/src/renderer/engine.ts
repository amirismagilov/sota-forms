import type { Condition, ConditionNode, Dictionary, Field } from '../types';

/** Follow a dot-path into the collected values: `credit_check.decision`. */
export function readPath(values: Record<string, any>, path: string): any {
  if (path in values) return values[path]; // plain field id wins — ids may contain no dots anyway
  let node: any = values;
  for (const part of String(path || '').split('.')) {
    if (node == null) return undefined;
    node = Array.isArray(node) ? node[Number(part)] : node[part];
  }
  return node;
}

// ---- Condition evaluation (visibleIf / requiredIf) ----
export function evalCondition(cond: ConditionNode | undefined, values: Record<string, any>): boolean {
  if (!cond) return true;
  // Groups: «все условия» / «любое из» / отрицание. A form authored before these
  // existed carries a bare Condition, which falls through to the logic below.
  if ('all' in cond) return (cond.all || []).every((c) => evalCondition(c, values));
  if ('any' in cond) {
    const list = cond.any || [];
    return list.length === 0 || list.some((c) => evalCondition(c, values));
  }
  if ('not' in cond) return !evalCondition(cond.not, values);

  const leaf = cond as Condition;
  if (!leaf.fieldId) return true;
  const v = readPath(values, leaf.fieldId);
  const target = leaf.value;
  return evalLeaf(v, leaf.operator, target);
}

function evalLeaf(v: any, operator: Condition['operator'], target: any): boolean {
  switch (operator) {
    case 'eq':
      return String(v ?? '') === String(target ?? '');
    case 'neq':
      return String(v ?? '') !== String(target ?? '');
    case 'contains':
      return Array.isArray(v) ? v.includes(target) : String(v ?? '').includes(String(target ?? ''));
    case 'empty':
      return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    case 'not_empty':
      return !(v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0));
    case 'gt':
      return Number(v) > Number(target);
    case 'lt':
      return Number(v) < Number(target);
    default:
      return true;
  }
}

// ---- Safe formula evaluation (recursive-descent, no eval) ----
const REF_RE = /\{\{\s*([a-zA-Z0-9_]+)(?:\.([a-zA-Z0-9_]+))?\s*\}\}/g;

function toNumber(v: any): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  const cleaned = String(v).replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

export function extractRefs(formula: string): { fieldId: string; attr?: string }[] {
  const out: { fieldId: string; attr?: string }[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(REF_RE);
  while ((m = re.exec(formula)) !== null) out.push({ fieldId: m[1], attr: m[2] });
  return out;
}

// Tokenizer + parser for + - * / % ( ) and comparisons.
type Tok = { t: string; v?: number };

function tokenize(s: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') { i++; continue; }
    if ('+-*/%()'.includes(c)) { toks.push({ t: c }); i++; continue; }
    if (c === '>' || c === '<' || c === '=' || c === '!') {
      if (s[i + 1] === '=') { toks.push({ t: c + '=' }); i += 2; }
      else { toks.push({ t: c }); i++; }
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      toks.push({ t: 'num', v: parseFloat(s.slice(i, j)) });
      i = j;
      continue;
    }
    throw new Error('bad char ' + c);
  }
  return toks;
}

function parseExpr(toks: Tok[]): number {
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];

  function comparison(): number {
    let left = additive();
    while (peek() && ['>', '<', '>=', '<=', '==', '!='].includes(peek().t)) {
      const op = next().t;
      const right = additive();
      left = evalCmp(left, op, right);
    }
    return left;
  }
  function additive(): number {
    let left = term();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = next().t;
      const right = term();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }
  function term(): number {
    let left = unary();
    while (peek() && (peek().t === '*' || peek().t === '/' || peek().t === '%')) {
      const op = next().t;
      const right = unary();
      if ((op === '/' || op === '%') && right === 0) left = 0;
      else if (op === '*') left = left * right;
      else if (op === '/') left = left / right;
      else left = left % right;
    }
    return left;
  }
  function unary(): number {
    if (peek() && (peek().t === '-' || peek().t === '+')) {
      const op = next().t;
      return op === '-' ? -unary() : unary();
    }
    return primary();
  }
  function primary(): number {
    const tk = peek();
    if (!tk) return 0;
    if (tk.t === 'num') { next(); return tk.v!; }
    if (tk.t === '(') { next(); const val = comparison(); if (peek() && peek().t === ')') next(); return val; }
    return 0;
  }
  function evalCmp(l: number, op: string, r: number): number {
    switch (op) {
      case '>': return l > r ? 1 : 0;
      case '<': return l < r ? 1 : 0;
      case '>=': return l >= r ? 1 : 0;
      case '<=': return l <= r ? 1 : 0;
      case '==': return l === r ? 1 : 0;
      case '!=': return l !== r ? 1 : 0;
      default: return 0;
    }
  }
  return comparison();
}

export function evalFormula(
  formula: string,
  values: Record<string, any>,
  attrs: Record<string, Record<string, any>>,
): number {
  if (!formula || !formula.trim()) return 0;
  const substituted = formula.replace(REF_RE, (_all, fieldId, attr) => {
    const raw = attr ? attrs[fieldId]?.[attr] : values[fieldId];
    return String(toNumber(raw));
  });
  try {
    const result = parseExpr(tokenize(substituted));
    return isFinite(result) ? result : 0;
  } catch {
    return 0;
  }
}

// ---- Dictionary helpers ----
export function dictItemsFor(
  dict: Dictionary | undefined,
  field: Field,
  values: Record<string, any>,
): Dictionary['items'] {
  if (!dict) return [];
  // Only a dependency with a real fieldId cascades. An empty/incomplete row ({})
  // must NOT hide all options.
  const dep = dict.dependencies?.find((d) => d && d.fieldId);
  if (dep) {
    const parentVal = values[dep.fieldId];
    if (parentVal === undefined || parentVal === '' || parentVal === null) return [];
    return dict.items.filter((it) => String(it.parentValue ?? '') === String(parentVal));
  }
  return dict.items;
}
