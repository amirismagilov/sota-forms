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

/**
 * Шаги для КОНСТРУКТОРА — со всей начинкой (запрос, правила), а не только тем,
 * что нужно рендеру.
 *
 * Форму, настроенную до появления шагов, разворачиваем в один шаг «main» с её
 * старым вебхуком и сообщением: иначе автор откроет редактор и увидит пустые
 * настройки там, где на деле работает legacy-вебхук. Ровно то же делает
 * `backend/app/flow.py::normalize_flow`, и живут эти две функции по одним
 * правилам намеренно — редактор обязан показывать то, что реально исполнится.
 */
export function editorSteps(submit: SubmitConfig | undefined): FlowStep[] {
  if (submit?.steps?.length) return flowSteps(submit);
  return [{
    id: MAIN_STEP,
    title: '',
    description: '',
    button: normalizeButton(undefined),
    request: submit?.webhookUrl
      ? { transport: 'webhook', webhookUrl: submit.webhookUrl }
      : { transport: 'none' },
    rules: [{
      id: 'default',
      name: 'По умолчанию',
      when: [],
      then: submit?.redirectUrl
        ? { kind: 'redirect', url: submit.redirectUrl }
        : { kind: 'message', messageType: 'success', text: submit?.successMessage || 'Спасибо!' },
    }],
  }];
}

/**
 * Записать шаги обратно в submit, стерев legacy-ключи.
 *
 * Держать одновременно и `steps`, и старые `webhookUrl`/`successMessage` —
 * верный способ однажды отправить данные не туда: какой из двух источников
 * победит, зависит от порядка нормализации, а не от намерения автора.
 */
export function writeSteps(submit: SubmitConfig | undefined, steps: FlowStep[]): SubmitConfig {
  const { webhookUrl, successMessage, redirectUrl, ...rest } = submit || {};
  void webhookUrl; void successMessage; void redirectUrl;
  return { ...rest, steps };
}

let stepSeq = 0;
export function newStepId(): string {
  stepSeq += 1;
  return `step_${Date.now().toString(36)}_${stepSeq}`;
}
