import { StyleProvider } from '@ant-design/cssinjs';
import type Entity from '@ant-design/cssinjs/es/Cache';
import { App as AntApp, ConfigProvider } from 'antd';
import { forwardRef } from 'react';
import FormRenderer, { type FormHandle } from '../renderer/FormRenderer';
import type { Dictionary, FormSchema } from '../types';

interface Props {
  schema: Pick<FormSchema, 'fields' | 'grid_columns' | 'submit' | 'title'>;
  dictionaries: Dictionary[];
  tokens: { token?: Record<string, any> };
  container?: HTMLElement; // shadow root for style injection
  cache?: Entity;
  onSubmit?: (data: Record<string, any>) => Promise<any>;
  onChange?: (field: string, value: any, all: Record<string, any>) => void;
  onError?: (errors: Record<string, string>) => void;
  apiDictLoader?: (dictId: string, values: Record<string, any>) => Promise<{ code: string; label: string; attrs?: any }[]>;
  fileUpload?: (file: File) => Promise<{ id: string; url: string; filename: string; size: number }>;
  showTitle?: boolean;
}

/** Ant Design form wrapped in a theme provider; style-isolated when a
 *  shadow-root container + cache are supplied (Web Component use, KP-10). */
const ThemedForm = forwardRef<FormHandle, Props>(function ThemedForm(
  { schema, dictionaries, tokens, container, cache, onSubmit, onChange, onError, apiDictLoader, fileUpload, showTitle },
  ref,
) {
  const inner = (
    <ConfigProvider theme={{ token: tokens?.token || {} }} getPopupContainer={() => container || document.body}>
      <AntApp>
        <FormRenderer
          ref={ref}
          schema={schema}
          dictionaries={dictionaries}
          onSubmit={onSubmit}
          onChange={onChange}
          onError={onError}
          apiDictLoader={apiDictLoader}
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
