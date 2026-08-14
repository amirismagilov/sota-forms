export type Operator = 'eq' | 'neq' | 'contains' | 'empty' | 'not_empty' | 'gt' | 'lt';

export interface Condition {
  fieldId: string;
  operator: Operator;
  value?: any;
}

export interface FieldMask {
  preset?: string;
  pattern?: string;
  regex?: string;
}

export interface FieldValidation {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  step?: number;
  regex?: string;
  regexMessage?: string;
}

export interface FileValidation {
  extensions?: string; // ".pdf,.jpg"
  mimeTypes?: string;
  maxSize?: number; // MB
  minSize?: number; // KB
  maxCount?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  errorMsg?: string;
}

export interface OptionItem {
  label: string;
  value: string;
}

export interface Field {
  id: string;
  type: string;
  label: string;
  gridSpan?: number;
  placeholder?: string | null;
  hint?: string | null;
  tooltip?: string | null;
  required?: boolean;
  readOnly?: boolean;
  defaultValue?: any;
  requiredMessage?: string | null;
  mask?: FieldMask;
  validation?: FieldValidation;
  options?: OptionItem[];
  dictionaryId?: string;
  dictDisplay?: 'select' | 'radio' | 'checkbox';
  showExtra?: boolean;
  formula?: string;
  calcPrefix?: string;
  calcSuffix?: string;
  calcDecimals?: number;
  visibleIf?: Condition;
  requiredIf?: Condition;
  rows?: number;
  headingLevel?: 1 | 2 | 3;
  fileValidation?: FileValidation;
  suggest?: SuggestConfig;
  // «Совпадает с…» checkbox: when ON, `target` field is hidden and auto-filled
  // from `source` field.
  sameAs?: { target?: string; source?: string };
  // Visual grid placement (set by the layout editor). x/w in columns, y/h in rows.
  layout?: { x: number; y: number; w: number; h: number };
  /** Шаг флоу, на котором показывается поле. Пусто = первый шаг («main»). */
  step?: string;
}

// Auto-fill another form field from the selected suggestion's data.
export interface SuggestFill {
  fieldId: string;   // which form field to fill
  from: string;      // dot-path into the picked item, e.g. "data.inn" or "value"
}

// Server-side typeahead field (DaData and any other REST/suggest API).
export interface SuggestConfig {
  connectionId?: string;
  method?: 'GET' | 'POST';
  endpoint?: string;      // e.g. /suggest/address, /suggest/party
  queryParam?: string;    // param carrying the typed text (DaData: "query")
  params?: string;        // extra static params as JSON, {{field}} supported
  minChars?: number;      // start querying from N chars (default 3)
  path?: string;          // where the array is in the response (DaData: "suggestions")
  labelField?: string;    // shown in the dropdown (DaData: "value")
  valueField?: string;    // stored in the form (DaData: "value" or "data.fias_id")
  // Rich dropdown display. {{path}} pulls from the item (value/label/data.*).
  // labelTemplate is the primary line (falls back to labelField), subtitleTemplate
  // renders a smaller grey second line, e.g. "ИНН {{data.inn}} · {{data.address.value}}".
  labelTemplate?: string;
  subtitleTemplate?: string;
  fill?: SuggestFill[];   // auto-fill other fields on select
}

export interface DictAttr {
  name: string;
  label: string;
  type: 'number' | 'string';
}

export interface DictItem {
  code: string;
  label: string;
  parentValue?: string;
  attrs?: Record<string, any>;
}

export interface Dictionary {
  id: string;
  code: string;
  name: string;
  type: 'manual' | 'api';
  dependencies: { fieldId: string; paramName: string }[];
  attrs: DictAttr[];
  items: DictItem[];
  api_config?: any;
}

export type FormSource = 'local' | 'operaton';

export interface OperatonReport {
  components_total: number;
  mapped: number;
  fields_total?: number;
  warnings: { key?: string; code: string; message: string }[];
  unsupported: { key?: string; type: string }[];
}

export interface OperatonMeta {
  format?: string;
  operaton_form_id?: string;
  process_key?: string | null;
  schema_version?: number | null;
  imported_at?: string;
  key_map?: Record<string, string>;
  report?: OperatonReport;
  warning_count?: number;
}

export interface OperatonProcess {
  process_id: string;
  name: string;
  version?: number;
  status?: string;
}

export interface OperatonFormSummary {
  id: string;
  name?: string | null;
  processKey?: string | null;
}

export interface OperatonPreview {
  form_id: string;
  title: string;
  grid_columns: number;
  fields: Field[];
  submit: FormSchema['submit'];
  operaton_form_id: string;
  process_key?: string | null;
  key_map: Record<string, string>;
  report: OperatonReport;
}

// ---- Флоу отправки: кнопка → запрос → разбор ответа → действие ----

export interface SubmitButton {
  text?: string;
  loadingText?: string;
  size?: 'small' | 'middle' | 'large';
  block?: boolean;
  align?: 'left' | 'center' | 'right';
  danger?: boolean;
}

export type Transport = 'none' | 'webhook' | 'rest';

export interface StepRequest {
  transport?: Transport;
  /** webhook: произвольный URL, поддерживает {{taskId}}, {{formId}}, {{submissionId}} */
  webhookUrl?: string;
  /** rest: через «Подключение» — секреты и whitelist остаются на бэкенде */
  connectionId?: string;
  endpoint?: string;
  method?: 'POST' | 'PUT' | 'PATCH' | 'GET';
  headers?: { name: string; value: string }[];
  /** envelope — наш конверт, data — голое {"data": …}, custom — JSON-шаблон автора */
  payload?: 'envelope' | 'data' | 'custom';
  bodyTemplate?: string;
  /** Отдавать ли сырой ответ в браузер (по умолчанию нет). */
  exposeResponse?: boolean;
  delivery?: 'sync' | 'async';
  operatonComplete?: boolean;
}

export type ConditionSource = 'status' | 'body' | 'field' | 'error';
export type RuleOperator =
  | 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte'
  | 'in' | 'contains' | 'regex' | 'empty' | 'not_empty' | 'exists';

export interface RuleCondition {
  source: ConditionSource;
  path?: string;
  operator: RuleOperator;
  value?: any;
}

export type OutcomeKind = 'message' | 'fields' | 'redirect' | 'none';

export interface OutcomeAction {
  kind: OutcomeKind;
  // message
  messageType?: 'success' | 'info' | 'warning' | 'error';
  title?: string;
  text?: string;
  // fields — открыть следующий шаг и подставить в него значения из ответа
  stepId?: string;
  fill?: { fieldId: string; from: string }[];
  // redirect
  url?: string;
  newTab?: boolean;
  delayMs?: number;
}

export interface ResponseRule {
  id: string;
  name?: string;
  match?: 'all' | 'any';
  when: RuleCondition[];
  then: OutcomeAction;
}

export interface FlowStep {
  id: string;
  title?: string;
  description?: string;
  button?: SubmitButton;
  request?: StepRequest;
  rules?: ResponseRule[];
  /** Только в ответе бэкенда (`GET /forms/:pk/flow`). */
  fieldIds?: string[];
}

/** Исход шага, уже посчитанный бэкендом: виджету остаётся его исполнить. */
export interface ResolvedOutcome {
  kind: OutcomeKind;
  messageType?: 'success' | 'info' | 'warning' | 'error';
  title?: string;
  text?: string;
  stepId?: string;
  stepTitle?: string;
  stepDescription?: string;
  fieldIds?: string[];
  button?: SubmitButton;
  values?: Record<string, any>;
  url?: string;
  newTab?: boolean;
  delayMs?: number;
  response?: { status?: number | null; body?: any };
}

export interface SubmitResult {
  ok?: boolean;
  submissionId?: string;
  flowToken?: string;
  step?: string;
  outcome?: ResolvedOutcome;
  matchedRule?: string | null;
  successMessage?: string | null;
  redirectUrl?: string | null;
}

export interface FlowTestResult {
  matchedRuleId?: string | null;
  matchedRuleName?: string | null;
  trace: { id: string; name: string; matched: boolean }[];
  outcome: ResolvedOutcome & { stepExists?: boolean };
}

export interface SubmitConfig {
  /** Шаги флоу. Первый всегда «main»; отсутствует — старая одношаговая форма. */
  steps?: FlowStep[];
  // Legacy (одиночный вебхук). Бэкенд мигрирует это в шаг «main» на лету.
  webhookUrl?: string;
  successMessage?: string;
  redirectUrl?: string | null;
  // Operaton task completion: sync delivery, bare {"data": …} body and a
  // server-injected shared secret.
  delivery?: 'sync' | 'async';
  payload?: 'envelope' | 'data';
  operatonComplete?: boolean;
  operatonProcessKey?: string;
}

export interface FormSchema {
  id?: string;
  form_id: string;
  title: string;
  version?: number;
  grid_columns: number;
  fields: Field[];
  submit: SubmitConfig;
  source?: FormSource;
  source_meta?: OperatonMeta;
  status?: 'draft' | 'published' | 'archived';
  published_version?: number | null;
  has_draft_changes?: boolean;
  submission_count?: number;
  updated_at?: string | null;
}

export interface FormVersionInfo {
  version: number;
  title: string;
  note?: string | null;
  field_count: number;
  is_published: boolean;
  created_at: string;
}

export interface FormListResult {
  items: FormSchema[];
  total: number;
  limit: number;
  offset: number;
}

export interface PublicForm extends FormSchema {
  design_tokens: { token: Record<string, any> };
  dictionaries: Dictionary[];
  /** Operaton process variable name → our field id (empty for local forms). */
  key_map?: Record<string, string>;
}

export interface Connection {
  id: string;
  name: string;
  base_url: string;
  auth_type: string;
  auth_config: Record<string, any>;
  whitelist: string[];
  timeout: number;
  rate_limit: number;
  cache: string;
  env: string;
}
