import type { Field, FlowStep, SubmitButton, SubmitConfig } from '../types';

export const MAIN_STEP = 'main';

/**
 * Шаги флоу для РЕНДЕРА: какие поля показать и как подписать кнопку.
 *
 * Намеренно зеркалит только эту часть `backend/app/flow.py::normalize_flow` —
 * условия и правила разбора ответа считаются исключительно на бэкенде, поэтому
 * дублировать (и рассинхронизировать) здесь нечего. Виджет получает готовый
 * исход и просто исполняет его.
 */
export function normalizeButton(cfg: SubmitButton | undefined): Required<SubmitButton> {
  return {
    text: cfg?.text || 'Отправить',
    loadingText: cfg?.loadingText || '',
    size: cfg?.size || 'large',
    block: cfg?.block === undefined ? true : !!cfg.block,
    align: cfg?.align || 'center',
  };
}

export function flowSteps(submit: SubmitConfig | undefined): FlowStep[] {
  const raw = (submit?.steps || []).filter(Boolean);
  if (!raw.length) {
    return [{ id: MAIN_STEP, title: '', description: '', button: normalizeButton(undefined) }];
  }
  const seen = new Set<string>();
  const steps: FlowStep[] = [];
  raw.forEach((s, i) => {
    const id = i === 0 ? MAIN_STEP : (s.id || `step${i + 1}`).trim();
    if (seen.has(id)) return;
    seen.add(id);
    steps.push({ ...s, id, button: normalizeButton(s.button) });
  });
  return steps;
}

export function findStep(steps: FlowStep[], id: string | undefined): FlowStep {
  return steps.find((s) => s.id === id) || steps[0];
}

/** Поле без явного шага принадлежит первому — иначе старые формы опустели бы. */
export function fieldStep(f: Field): string {
  return f.step || MAIN_STEP;
}
