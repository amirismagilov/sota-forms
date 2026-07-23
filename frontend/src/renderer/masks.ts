// Input masking: presets + custom pattern ('9'=digit, 'A'=letter, '*'=any).

export interface MaskDef {
  pattern: string; // e.g. '+7 (999) 999-99-99'
  regex?: string;
}

export const MASK_PRESETS: Record<string, MaskDef> = {
  phone: { pattern: '+7 (999) 999-99-99', regex: '^\\+7 \\(\\d{3}\\) \\d{3}-\\d{2}-\\d{2}$' },
  inn: { pattern: '999999999999', regex: '^(\\d{10}|\\d{12})$' },
  snils: { pattern: '999-999-999 99', regex: '^\\d{3}-\\d{3}-\\d{3} \\d{2}$' },
  passport: { pattern: '9999 999999', regex: '^\\d{4} \\d{6}$' },
  bik: { pattern: '999999999', regex: '^\\d{9}$' },
  kpp: { pattern: '999999999', regex: '^\\d{9}$' },
  ogrn: { pattern: '9999999999999', regex: '^\\d{13}$' },
  card: { pattern: '9999 9999 9999 9999', regex: '^\\d{4} \\d{4} \\d{4} \\d{4}$' },
};

const CLASS: Record<string, RegExp> = {
  '9': /\d/,
  A: /[a-zA-Zа-яА-ЯёЁ]/,
  '*': /./,
};

/** Apply a pattern mask to raw input, keeping literal separators. */
export function applyPattern(pattern: string, raw: string): string {
  if (!pattern) return raw;
  // For the phone preset we normalise a leading 8/7 to the +7 form.
  const chars = [...String(raw)];
  let out = '';
  let ci = 0;
  for (let pi = 0; pi < pattern.length && ci <= chars.length; pi++) {
    const pc = pattern[pi];
    const cls = CLASS[pc];
    if (cls) {
      // consume input chars until one matches the class
      while (ci < chars.length && !cls.test(chars[ci])) ci++;
      if (ci >= chars.length) break;
      out += chars[ci];
      ci++;
    } else {
      // literal separator — emit it if there is more input to place after it
      if (ci < chars.length) out += pc;
      else break;
    }
  }
  return out;
}

export function maskFor(preset: string | undefined): MaskDef | undefined {
  return preset ? MASK_PRESETS[preset] : undefined;
}

/** Mask a value for a field by its type/mask config. */
export function maskValue(type: string, maskPattern: string | undefined, preset: string | undefined, raw: string): string {
  if (preset === 'phone' || type === 'phone') {
    // normalise leading 8 → 7 before applying the +7 template
    const digits = String(raw).replace(/\D/g, '').replace(/^8/, '7');
    const rest = digits.startsWith('7') ? digits.slice(1) : digits;
    return applyPattern('(999) 999-99-99', rest) ? '+7 ' + applyPattern('(999) 999-99-99', rest) : '+7 ';
  }
  const def = maskFor(preset || type);
  const pattern = maskPattern || def?.pattern;
  if (pattern) return applyPattern(pattern, raw);
  return raw;
}
