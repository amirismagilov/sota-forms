import { StyleProvider } from '@ant-design/cssinjs';
import type Entity from '@ant-design/cssinjs/es/Cache';
import { App as AntApp, ConfigProvider } from 'antd';
import { forwardRef } from 'react';
import FormRenderer, { type FormHandle } from '../renderer/FormRenderer';
import { componentsTheme, tokenTheme } from '../theme';
import type { Dictionary, Field, FormSchema } from '../types';

interface Props {
  schema: Pick<FormSchema, 'fields' | 'grid_columns' | 'submit' | 'title'>;
  dictionaries: Dictionary[];
  initialValues?: Record<string, any>;
  tokens: { token?: Record<string, any> };
  container?: HTMLElement; // shadow root for style injection
  cache?: Entity;
  onSubmit?: (data: Record<string, any>) => Promise<any>;
  onChange?: (field: string, value: any, all: Record<string, any>) => void;
  onError?: (errors: Record<string, string>) => void;
  apiDictLoader?: (dictId: string, values: Record<string, any>) => Promise<{ code: string; label: string; attrs?: any }[]>;
  suggestLoader?: (field: Field, query: string, values: Record<string, any>) => Promise<{ value: string; label: string; data: any }[]>;
  fileUpload?: (file: File) => Promise<{ id: string; url: string; filename: string; size: number }>;
  showTitle?: boolean;
}

/** Ant Design form wrapped in a theme provider; style-isolated when a
 *  shadow-root container + cache are supplied (Web Component use, KP-10). */
const ThemedForm = forwardRef<FormHandle, Props>(function ThemedForm(
  { schema, dictionaries, initialValues, tokens, container, cache, onSubmit, onChange, onError, apiDictLoader, suggestLoader, fileUpload, showTitle },
  ref,
) {
  const inner = (
    <ConfigProvider
      theme={{ token: { ...tokenTheme, ...(tokens?.token || {}) }, components: componentsTheme }}
      getPopupContainer={() => container || document.body}
    >
      <AntApp>
        <FormRenderer
          ref={ref}
          schema={schema}
          dictionaries={dictionaries}
          initialValues={initialValues}
          onSubmit={onSubmit}
          onChange={onChange}
          onError={onError}
          apiDictLoader={apiDictLoader}
          suggestLoader={suggestLoader}
          fileUpload={fileUpload}
          showTitle={showTitle}
        />
      </AntApp>
    </ConfigProvider>
  );
  if (container && cache) {
    return (
      <StyleProvider container={container} cache={cache} hashPriority="high">
        {inner}
      </StyleProvider>
    );
  }
  return inner;
});

export default ThemedForm;
