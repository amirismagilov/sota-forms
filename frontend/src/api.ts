import axios from 'axios';
import type {
  Connection, Dictionary, FormListResult, FormSchema, FormSource, FormVersionInfo,
  OperatonFormSummary, OperatonPreview, OperatonProcess, PublicForm,
} from './types';

const api = axios.create({ baseURL: '/api' });

export const TOKEN_KEY = 'sota_token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

// Attach bearer token to every admin request.
api.interceptors.request.use((cfg) => {
  const t = getToken();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

// On auth failure, drop the token and let the app fall back to the login screen.
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401 && getToken()) {
      clearToken();
      window.dispatchEvent(new Event('sota:unauthorized'));
    }
    return Promise.reject(err);
  },
);

// ---- Auth ----
export interface AuthUser { id: string; email: string; role: string; account_id: string }
export const login = (email: string, password: string) =>
  api.post<{ token: string; user: AuthUser }>('/auth/login', { email, password }).then((r) => r.data);
export const register = (email: string, password: string, account_name?: string) =>
  api.post<{ token: string; user: AuthUser }>('/auth/register', { email, password, account_name }).then((r) => r.data);
export const me = () => api.get<AuthUser>('/auth/me').then((r) => r.data);

// ---- Forms (registry) ----
export interface FormQuery { q?: string; status?: string; source?: FormSource; limit?: number; offset?: number; sort?: string }
export const listForms = (params: FormQuery = {}) =>
  api.get<FormListResult>('/forms', { params }).then((r) => r.data);
export const getForm = (pk: string) => api.get<FormSchema>(`/forms/${pk}`).then((r) => r.data);
export const publishForm = (pk: string, note?: string) =>
  api.post<FormSchema>(`/forms/${pk}/publish`, { note }).then((r) => r.data);
export const setFormStatus = (pk: string, status: string) =>
  api.post<FormSchema>(`/forms/${pk}/status`, { status }).then((r) => r.data);
export const listVersions = (pk: string) =>
  api.get<FormVersionInfo[]>(`/forms/${pk}/versions`).then((r) => r.data);
export const getVersion = (pk: string, v: number) =>
  api.get(`/forms/${pk}/versions/${v}`).then((r) => r.data);
export const rollbackForm = (pk: string, v: number) =>
  api.post<FormSchema>(`/forms/${pk}/rollback/${v}`).then((r) => r.data);
export const createForm = (body: Partial<FormSchema>) =>
  api.post<FormSchema>('/forms', body).then((r) => r.data);
export const updateForm = (pk: string, body: Partial<FormSchema>) =>
  api.put<FormSchema>(`/forms/${pk}`, body).then((r) => r.data);
export const deleteForm = (pk: string) => api.delete(`/forms/${pk}`).then((r) => r.data);
export const exportForm = (pk: string) => api.get(`/forms/${pk}/export`).then((r) => r.data);

// ---- Dictionaries ----
export const listDictionaries = () =>
  api.get<Dictionary[]>('/dictionaries').then((r) => r.data);
export const createDictionary = (body: Partial<Dictionary>) =>
  api.post<Dictionary>('/dictionaries', body).then((r) => r.data);
export const updateDictionary = (id: string, body: Partial<Dictionary>) =>
  api.put<Dictionary>(`/dictionaries/${id}`, body).then((r) => r.data);
export const deleteDictionary = (id: string) =>
  api.delete(`/dictionaries/${id}`).then((r) => r.data);

// ---- Connections ----
export const listConnections = () =>
  api.get<Connection[]>('/connections').then((r) => r.data);
export const createConnection = (body: Partial<Connection>) =>
  api.post<Connection>('/connections', body).then((r) => r.data);
export const updateConnection = (id: string, body: Partial<Connection>) =>
  api.put<Connection>(`/connections/${id}`, body).then((r) => r.data);
export const deleteConnection = (id: string) =>
  api.delete(`/connections/${id}`).then((r) => r.data);
export interface ConnectionTestResult {
  ok: boolean;
  reachable: boolean;
  status: number | null;
  latency_ms: number | null;
  url: string;
  message: string;
}
export const testConnection = (id: string, body: { endpoint?: string; method?: string; body?: any } = {}) =>
  api.post<ConnectionTestResult>(`/connections/${id}/test`, body).then((r) => r.data);

// ---- Theme ----
export const getTheme = () => api.get('/account/theme').then((r) => r.data);
export const updateTheme = (design_tokens: any, webhook_default?: string) =>
  api.put('/account/theme', { design_tokens, webhook_default }).then((r) => r.data);

// ---- Public / submissions ----
export const getPublicForm = (formId: string) =>
  api.get<PublicForm>(`/public/forms/${formId}`).then((r) => r.data);
export const submitForm = (formId: string, data: Record<string, any>) =>
  api.post(`/public/forms/${formId}/submit`, { data }).then((r) => r.data);
export const listSubmissions = (formId?: string) =>
  api.get('/submissions', { params: formId ? { form_id: formId } : {} }).then((r) => r.data);
export const getSubmission = (id: string) =>
  api.get(`/submissions/${id}`).then((r) => r.data);
export const deliveriesBoard = () =>
  api.get('/submissions/deliveries/board').then((r) => r.data);
export const retryDelivery = (id: string) =>
  api.post(`/submissions/deliveries/${id}/retry`).then((r) => r.data);

// ---- API dictionaries / files ----
export const getDictOptions = (dictId: string, values: Record<string, any>) =>
  api.post(`/public/dictionaries/${dictId}/options`, { values }).then((r) => r.data.items as { code: string; label: string; attrs?: any }[]);
export const testDictionary = (dictId: string, values: Record<string, any>) =>
  api.post(`/dictionaries/${dictId}/test`, { values }).then((r) => r.data);
// Probe an unsaved API config so the constructor can show the response before saving.
export const probeDictionary = (body: { api_config: any; dependencies?: any[]; values?: Record<string, any> }) =>
  api.post('/dictionaries/probe', body).then((r) => r.data);
// Suggest typeahead against an inline (unsaved) field config — preview + field-editor test.
export const probeSuggest = (body: { suggest: any; query: string; values?: Record<string, any> }) =>
  api.post('/suggest/probe', body).then((r) => r.data as { ok: boolean; items?: { value: string; label: string; data: any }[]; raw?: any; error?: string });
// Try an api_check config before the form is published, so a wrong response path
// is found in the editor rather than by a live user.
export const probeCheck = (body: { check: any; values?: Record<string, any> }) =>
  api.post('/checks/probe', body).then((r) => r.data as { ok: boolean; data?: any; error?: string });
export const runFormCheck = (formId: string, fieldId: string, values: Record<string, any>) =>
  api.post(`/public/forms/${formId}/check`, { fieldId, values })
    .then((r) => r.data as { ok: boolean; data?: any });
export const uploadFile = (file: File) => {
  const fd = new FormData();
  fd.append('file', file);
  return api.post('/public/files', fd).then((r) => r.data as { id: string; url: string; filename: string; size: number });
};
export const importForm = (body: any) => api.post('/forms/import', body).then((r) => r.data);

// ---- Operaton (sota-bpmn) ----
export interface OperatonStatus {
  ok: boolean; configured: boolean; base_url?: string; status?: number; message: string;
}
export interface OperatonImportBody {
  schema?: any;              // uploaded .form file
  operaton_form_id?: string; // or pulled from the sota-bpmn catalogue
  process_key?: string;
  form_id?: string;
  title?: string;
}
export const operatonStatus = () =>
  api.get<OperatonStatus>('/operaton/status').then((r) => r.data);
export const operatonProcesses = () =>
  api.get<{ items: OperatonProcess[] }>('/operaton/processes').then((r) => r.data.items);
export const operatonForms = (process?: string) =>
  api.get<{ items: OperatonFormSummary[] }>('/operaton/forms', { params: process ? { process } : {} })
    .then((r) => r.data.items);
export const operatonPreview = (body: OperatonImportBody) =>
  api.post<OperatonPreview>('/operaton/preview', body).then((r) => r.data);
export const operatonImport = (body: OperatonImportBody) =>
  api.post<FormSchema>('/operaton/import', body).then((r) => r.data);

// Bulk: pull every form of a process at once. Already-imported forms are skipped.
export interface OperatonSyncItem {
  operaton_form_id: string;
  status: 'imported' | 'skipped' | 'failed';
  id?: string;
  form_id?: string;
  title?: string;
  detail?: string;
  published?: boolean;
  warnings?: number;
  unsupported?: number;
}
export interface OperatonSyncResult {
  items: OperatonSyncItem[];
  imported: number;
  skipped: number;
  failed: number;
  message?: string;
}
export const operatonSync = (body: { process_key?: string; publish?: boolean }) =>
  api.post<OperatonSyncResult>('/operaton/sync', body).then((r) => r.data);

export default api;
