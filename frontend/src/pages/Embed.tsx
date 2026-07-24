import { ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Input, Row, Select, Space, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { listForms } from '../api';

function LiveWidget({ formId, primaryColor }: { formId: string; primaryColor?: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    host.current.innerHTML = '';
    const el = document.createElement('no-code-form');
    el.setAttribute('form-id', formId);
    if (primaryColor) el.setAttribute('primary-color', primaryColor);
    host.current.appendChild(el);
    return () => { (el as any).destroy?.(); };
  }, [formId, primaryColor]);
  return <div ref={host} />;
}

export default function Embed() {
  const [forms, setForms] = useState<any[]>([]);
  const [formId, setFormId] = useState('order_form');
  const color: string | undefined = undefined; // primary-color customization removed
  const [received, setReceived] = useState<any[]>([]);

  useEffect(() => {
    listForms({ status: 'published', limit: 200 }).then((r) => {
      setForms(r.items);
      if (r.items[0]) setFormId(r.items[0].form_id);
    }).catch(() => {});
  }, []);
  const loadReceived = () => fetch('/api/mock/webhook/received').then((r) => r.json()).then(setReceived).catch(() => {});
  useEffect(() => { loadReceived(); const t = setInterval(loadReceived, 3000); return () => clearInterval(t); }, []);

  const snippet = `<script src="https://cdn.platform.com/form-widget.js"></script>\n<no-code-form form-id="${formId}"${color ? ` primary-color="${color}"` : ''}></no-code-form>`;

  return (
    <Row gutter={16}>
      <Col span={13}>
        <Card title="Встроенный виджет (Web Component · Shadow DOM)">
          <Space wrap style={{ marginBottom: 16 }}>
            <span>Форма:
              <Select style={{ width: 200, marginLeft: 8 }} value={formId} onChange={setFormId}
                options={forms.map((f) => ({ label: `${f.title} (${f.form_id})`, value: f.form_id }))} />
            </span>
          </Space>
          <Alert type="info" showIcon style={{ marginBottom: 16 }}
            message="Форма ниже отрендерена настоящим кастомным элементом <no-code-form> в изолированном Shadow DOM." />
          <div style={{ border: '1px dashed #d9d9d9', borderRadius: 8, padding: 16 }}>
            <LiveWidget formId={formId} primaryColor={color} />
          </div>
        </Card>
        <Card title="Код для встраивания" style={{ marginTop: 16 }}>
          <Input.TextArea value={snippet} rows={3} readOnly style={{ fontFamily: 'monospace', fontSize: 13 }} />
        </Card>
      </Col>
      <Col span={11}>
        <Card title="Полученные вебхуки (mock-клиент)" extra={<Button icon={<ReloadOutlined />} onClick={loadReceived}>Обновить</Button>}>
          <Typography.Paragraph type="secondary">
            Отправьте форму слева — данные пройдут через воркер и придут сюда с HMAC-подписью.
          </Typography.Paragraph>
          {received.length === 0 ? <Typography.Text type="secondary">Пока пусто</Typography.Text> :
            received.map((r, i) => (
              <Card size="small" key={i} style={{ marginBottom: 8 }}
                title={<Typography.Text style={{ fontSize: 11 }} code>{r.signature?.slice(0, 24)}…</Typography.Text>}>
                <pre style={{ margin: 0, fontSize: 12 }}>{JSON.stringify(r.body?.data ?? r.body, null, 2)}</pre>
              </Card>
            ))}
        </Card>
      </Col>
    </Row>
  );
}
