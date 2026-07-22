import { createCache } from '@ant-design/cssinjs';
import axios from 'axios';
import { createRoot, type Root } from 'react-dom/client';
import ThemedForm from './ThemedForm';
import type { PublicForm } from '../types';

/**
 * <no-code-form form-id="order_form"></no-code-form>
 *
 * Renders a form by ID inside a Shadow DOM, fully style-isolated (ВТ-1, KP-10).
 * Loads schema + design tokens + dictionaries from the backend (ВТ-3),
 * applies the account theme (ДС-5), submits to the client webhook via backend.
 */
class NoCodeForm extends HTMLElement {
  private root: Root | null = null;
  private values: Record<string, any> = {};
  private shadow: ShadowRoot;

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
    return this.getAttribute('api-base') || '/api';
  }

  private async render() {
    const formId = this.getAttribute('form-id');
    const mount = document.createElement('div');
    this.shadow.innerHTML = '';
    this.shadow.appendChild(mount);
    const cache = createCache();

    if (!formId) {
      mount.textContent = 'no-code-form: missing form-id';
      return;
    }

    let data: PublicForm;
    try {
      data = (await axios.get(`${this.apiBase()}/public/forms/${formId}`)).data;
    } catch (e: any) {
      mount.textContent = `Не удалось загрузить форму "${formId}"`;
      return;
    }

    // Attribute overrides (ВТ 6.3).
    const token = { ...(data.design_tokens?.token || {}) };
    const pc = this.getAttribute('primary-color');
    const br = this.getAttribute('border-radius');
    if (pc) token.colorPrimary = pc;
    if (br) token.borderRadius = Number(br);

    const onSubmit = async (payload: Record<string, any>) => {
      this.dispatchEvent(new CustomEvent('form:submit', { detail: { data: payload }, bubbles: true, composed: true }));
      const res = (await axios.post(`${this.apiBase()}/public/forms/${formId}/submit`, { data: payload })).data;
      return res;
    };
    const onChange = (field: string, value: any, all: Record<string, any>) => {
      this.values = all;
      this.dispatchEvent(new CustomEvent('form:change', { detail: { field, value }, bubbles: true, composed: true }));
    };

    this.root?.unmount();
    this.root = createRoot(mount);
    this.root.render(
      <ThemedForm
        schema={data}
        dictionaries={data.dictionaries || []}
        tokens={{ token }}
        container={this.shadow as unknown as HTMLElement}
        cache={cache}
        onSubmit={onSubmit}
        onChange={onChange}
      />,
    );
    this.dispatchEvent(new CustomEvent('form:ready', { detail: { formId }, bubbles: true, composed: true }));
  }

  // ---- Public JS API (§6.4) ----
  getValues() {
    return { ...this.values };
  }
  reset() {
    this.render();
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
