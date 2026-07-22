import { StyleProvider } from '@ant-design/cssinjs';
import { App as AntApp, ConfigProvider } from 'antd';
import type Entity from '@ant-design/cssinjs/es/Cache';
import FormRenderer from '../renderer/FormRenderer';
import type { Dictionary, FormSchema } from '../types';

interface Props {
  schema: Pick<FormSchema, 'fields' | 'grid_columns' | 'submit' | 'title'>;
  dictionaries: Dictionary[];
  tokens: { token?: Record<string, any> };
  container?: HTMLElement; // shadow root for style injection
  cache?: Entity;
  onSubmit?: (data: Record<string, any>) => Promise<any>;
  onChange?: (field: string, value: any, all: Record<string, any>) => void;
  showTitle?: boolean;
}

/** Ant Design form wrapped in a theme provider; style-isolated when a
 *  shadow-root container + cache are supplied (Web Component use, KP-10). */
export default function ThemedForm({ schema, dictionaries, tokens, container, cache, onSubmit, onChange, showTitle }: Props) {
  const inner = (
    <ConfigProvider theme={{ token: tokens?.token || {} }} getPopupContainer={() => container || document.body}>
      <AntApp>
        <FormRenderer schema={schema} dictionaries={dictionaries} onSubmit={onSubmit} onChange={onChange} showTitle={showTitle} />
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
}
