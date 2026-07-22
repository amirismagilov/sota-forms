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
  fileValidation?: FileValidation;
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

export interface FormSchema {
  id?: string;
  form_id: string;
  title: string;
  version?: number;
  grid_columns: number;
  fields: Field[];
  submit: {
    webhookUrl?: string;
    successMessage?: string;
    redirectUrl?: string | null;
  };
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
