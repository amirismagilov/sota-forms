import { createCache } from '@ant-design/cssinjs';
import axios from 'axios';
import { createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { FormHandle } from '../renderer/FormRenderer';
import type { PublicForm } from '../types';
import ThemedForm from './ThemedForm';

// Default API base = origin the widget script was served from (so an external
// site embedding <script src="https://forms.acme.com/form-widget.js"> talks to
// forms.acme.com, not its own origin). Falls back to same-origin '/api'.
function scriptApiBase(): string {
  try {
    const src = (document.currentScript as HTMLScriptElement | null)?.src;
    if (src) return new URL(src).origin + '/api';
  } catch { /* ignore */ }
  return '/api';
}
const DEFAULT_API_BASE = scriptApiBase();

/**
 * <no-code-form form-id="order_form"></no-code-form>
 *
 * Renders a form by ID inside a Shadow DOM, fully style-isolated (ВТ-1, KP-10).
 * Loads schema + tokens + dictionaries (ВТ-3), applies the account theme,
 * resolves API dictionaries and uploads through the backend proxy.
 */
class NoCodeForm extends HTMLElement {
  private root: Root | null = null;
  private shadow: ShadowRoot;
  private handleRef = createRef<FormHandle>();
  private values: Record<string, any> = {};

  static get observedAttributes() {
    return ['form-id', 'primary-color', 'border-radius', 'api-base'];
  }

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }

  private apiBase() {
    return this.getAttribute('api-base') || DEFAULT_API_BASE;
  }

  private async render() {
    const formId = this.getAttribute('form-id');
    const mount = document.createElement('div');
    this.shadow.innerHTML = '';
    this.shadow.appendChild(mount);
    const cache = createCache();
    const api = this.apiBase();

    if (!formId) {
      mount.textContent = 'no-code-form: missing form-id';
      return;
    }

    let data: PublicForm;
    try {
      data = (await axios.get(`${api}/public/forms/${formId}`)).data;
    } catch {
      mount.textContent = `Не удалось загрузить форму "${formId}"`;
      this.emit('form:error', { error: 'load_failed', formId });
      return;
    }

    const token = { ...(data.design_tokens?.token || {}) };
    const pc = this.getAttribute('primary-color');
    const br = this.getAttribute('border-radius');
    if (pc) token.colorPrimary = pc;
    if (br) token.borderRadius = Number(br);

    const onSubmit = async (payload: Record<string, any>) => {
      this.emit('form:submit', { data: payload, webhookUrl: data.submit?.webhookUrl });
      return (await axios.post(`${api}/public/forms/${formId}/submit`, { data: payload })).data;
    };
    const onChange = (field: string, value: any, all: Record<string, any>) => {
      this.values = all;
      this.emit('form:change', { field, value });
    };
    const onError = (errors: Record<string, string>) => this.emit('form:error', { errors });

    const apiDictLoader = async (dictId: string, values: Record<string, any>) => {
      const res = (await axios.post(`${api}/public/dictionaries/${dictId}/options`, { values })).data;
      return res.items || [];
    };
    const fileUpload = async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return (await axios.post(`${api}/public/files`, fd)).data;
    };

    this.root?.unmount();
    this.root = createRoot(mount);
    this.root.render(
      <ThemedForm
        ref={this.handleRef}
        schema={data}
        dictionaries={data.dictionaries || []}
        tokens={{ token }}
        container={this.shadow as unknown as HTMLElement}
        cache={cache}
        onSubmit={onSubmit}
        onChange={onChange}
        onError={onError}
        apiDictLoader={apiDictLoader}
        fileUpload={fileUpload}
      />,
    );
    this.emit('form:ready', { formId });
  }

  private emit(name: string, detail: any) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  // ---- Public JS API (§6.4) ----
  getValues() {
    return this.handleRef.current?.getValues() ?? { ...this.values };
  }
  setValues(v: Record<string, any>) {
    this.handleRef.current?.setValues(v);
  }
  validate() {
    return this.handleRef.current?.validate() ?? { valid: false, errors: {} };
  }
  submit() {
    this.handleRef.current?.submit();
  }
  reset() {
    this.handleRef.current?.reset();
  }
  destroy() {
    this.root?.unmount();
    this.root = null;
    this.shadow.innerHTML = '';
  }
}

if (!customElements.get('no-code-form')) {
  customElements.define('no-code-form', NoCodeForm);
}

export {};
