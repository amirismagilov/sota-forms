import { App, Button, Card, Col, ColorPicker, Divider, Form as AntForm, Input, InputNumber, Row, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { getTheme, updateTheme } from '../api';
import ThemedForm from '../widget/ThemedForm';

const PREVIEW_FIELDS = [
  { id: 'p1', type: 'text', label: 'Имя', gridSpan: 2, placeholder: 'Введите имя' },
  { id: 'p2', type: 'select_static', label: 'Город', gridSpan: 1, options: [{ label: 'Москва', value: 'm' }, { label: 'СПб', value: 's' }] },
  { id: 'p3', type: 'number', label: 'Сумма', gridSpan: 1 },
  { id: 'p4', type: 'checkbox', label: 'Согласен с условиями', gridSpan: 2 },
];

export default function Theme() {
  const { message } = App.useApp();
  const [token, setToken] = useState<Record<string, any>>({});
  const [json, setJson] = useState('');

  useEffect(() => {
    getTheme().then((t) => { const tk = t.design_tokens?.token || {}; setToken(tk); setJson(JSON.stringify({ token: tk }, null, 2)); });
  }, []);

  function set(k: string, v: any) {
    const next = { ...token, [k]: v };
    setToken(next);
    setJson(JSON.stringify({ token: next }, null, 2));
  }

  async function save() {
    try {
      const parsed = JSON.parse(json);
      await updateTheme(parsed);
      setToken(parsed.token || {});
      message.success('Тема сохранена. Все формы обновятся (live).');
    } catch { message.error('Некорректный JSON'); }
  }

  return (
    <Row gutter={16}>
      <Col span={12}>
        <Card title="Дизайн-токены (Ant Design v5)" extra={<Button type="primary" onClick={save}>Сохранить</Button>}>
          <Typography.Paragraph type="secondary">Один JSON токенов на аккаунт. UI-настроек стиля в конструкторе нет — только тема.</Typography.Paragraph>
          <Row gutter={12}>
            <Col span={12}><AntForm.Item label="colorPrimary"><ColorPicker showText value={token.colorPrimary} onChange={(_, hex) => set('colorPrimary', hex)} /></AntForm.Item></Col>
            <Col span={12}><AntForm.Item label="colorError"><ColorPicker showText value={token.colorError} onChange={(_, hex) => set('colorError', hex)} /></AntForm.Item></Col>
            <Col span={12}><AntForm.Item label="borderRadius"><InputNumber value={token.borderRadius} onChange={(v) => set('borderRadius', v)} /></AntForm.Item></Col>
            <Col span={12}><AntForm.Item label="controlHeight"><InputNumber value={token.controlHeight} onChange={(v) => set('controlHeight', v)} /></AntForm.Item></Col>
            <Col span={12}><AntForm.Item label="fontSize"><InputNumber value={token.fontSize} onChange={(v) => set('fontSize', v)} /></AntForm.Item></Col>
          </Row>
          <Divider>JSON</Divider>
          <Input.TextArea value={json} onChange={(e) => setJson(e.target.value)} rows={12} style={{ fontFamily: 'monospace', fontSize: 12 }} />
        </Card>
      </Col>
      <Col span={12}>
        <Card title="Предпросмотр темы">
          <ThemedForm schema={{ fields: PREVIEW_FIELDS as any, grid_columns: 2, submit: {}, title: '' }} dictionaries={[]} tokens={{ token }} />
        </Card>
      </Col>
    </Row>
  );
}
