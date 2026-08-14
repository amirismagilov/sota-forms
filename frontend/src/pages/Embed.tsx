import { ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Input, Row, Select, Space, Tag, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { listForms } from '../api';

/** Один обмен с внешней системой: что ушло, что вернулось, что решил флоу. */
interface Exchange {
  at: string;
  step: string;
  sent: Record<string, any>;
  matchedRule?: string | null;
  outcome?: any;
  error?: string;
}

function LiveWidget({
  formId, primaryColor, onExchange,
}: { formId: string; primaryColor?: string; onExchange: (e: Exchange) => void }) {
  const host = useRef<HTMLDivElement>(null);
  // Колбэк в ref: пересоздавать виджет на каждый новый обмен нельзя — это
  // сбросило бы форму ровно в тот момент, когда пользователь смотрит результат.
  const cb = useRef(onExchange);
  cb.current = onExchange;

  useEffect(() => {
    if (!host.current) return;
    host.current.innerHTML = '';
    const el = document.createElement('no-code-form');
    el.setAttribute('form-id', formId);
    if (primaryColor) el.setAttribute('primary-color', primaryColor);

    const now = () => new Date().toLocaleTimeString('ru-RU');
    const onDone = (e: any) => cb.current({
      at: now(),
      step: e.detail?.step || 'main',
      sent: e.detail?.data || {},
      matchedRule: e.detail?.matchedRule,
      outcome: e.detail?.outcome,
    });
    const onErr = (e: any) => {
      if (!e.detail?.detail) return; // ошибки валидации полей сюда не относятся
      cb.current({ at: now(), step: e.detail?.step || 'main', sent: {}, error: e.detail.detail });
    };
    el.addEventListener('form:completed', onDone);
    el.addEventListener('form:error', onErr);

    host.current.appendChild(el);
    return () => {
      el.removeEventListener('form:completed', onDone);
      el.removeEventListener('form:error', onErr);
      (el as any).destroy?.();
    };
  }, [formId, primaryColor]);
  return <div ref={host} />;
}

const KIND_LABEL: Record<string, string> = {
  message: 'сообщение',
  fields: 'новые поля',
  redirect: 'переход по ссылке',
  none: 'ничего',
};

export default function Embed() {
  const [forms, setForms] = useState<any[]>([]);
  const [formId, setFormId] = useState('order_form');
  const color: string | undefined = undefined; // primary-color customization removed
  const [received, setReceived] = useState<any[]>([]);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);

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
              <Select style={{ width: 200, marginLeft: 8 }} value={formId} onChange={(v) => { setFormId(v); setExchanges([]); }}
                options={forms.map((f) => ({ label: `${f.title} (${f.form_id})`, value: f.form_id }))} />
            </span>
          </Space>
          <Alert type="info" showIcon style={{ marginBottom: 16 }}
            message="Форма ниже отрендерена настоящим кастомным элементом <no-code-form> в изолированном Shadow DOM." />
          <div style={{ border: '1px dashed #d9d9d9', borderRadius: 8, padding: 16 }}>
            <LiveWidget formId={formId} primaryColor={color}
              onExchange={(e) => setExchanges((prev) => [e, ...prev].slice(0, 20))} />
          </div>
        </Card>
        <Card title="Код для встраивания" style={{ marginTop: 16 }}>
          <Input.TextArea value={snippet} rows={3} readOnly style={{ fontFamily: 'monospace', fontSize: 13 }} />
        </Card>
      </Col>

      <Col span={11}>
        <Card
          title="Обмен с внешней системой"
          extra={exchanges.length ? <Button size="small" onClick={() => setExchanges([])}>Очистить</Button> : undefined}
        >
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            Каждая отправка шага: что ушло, что ответила система и какое правило сработало.
          </Typography.Paragraph>
          {!exchanges.length
            ? <Typography.Text type="secondary">Пока пусто — отправьте форму слева</Typography.Text>
            : exchanges.map((x, i) => <ExchangeCard key={i} x={x} />)}
        </Card>

        <Card
          title="Полученные вебхуки (mock-клиент)"
          style={{ marginTop: 16 }}
          extra={<Button icon={<ReloadOutlined />} onClick={loadReceived}>Обновить</Button>}
        >
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            Шаги с доставкой на вебхук приходят сюда через воркер, с HMAC-подписью.
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

function ExchangeCard({ x }: { x: Exchange }) {
  const o = x.outcome || {};
  const resp = o.response;
  return (
    <Card
      size="small"
      style={{ marginBottom: 8 }}
      title={
        <Space size={4} wrap>
          <Tag color="blue">шаг {x.step}</Tag>
          {x.error
            ? <Tag color="red">ошибка</Tag>
            : <>
              {x.matchedRule && <Tag color="purple">правило: {x.matchedRule}</Tag>}
              <Tag color={o.kind === 'fields' ? 'green' : 'default'}>{KIND_LABEL[o.kind] || o.kind}</Tag>
            </>}
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>{x.at}</Typography.Text>
        </Space>
      }
    >
      {x.error && <Alert type="error" showIcon message={x.error} style={{ marginBottom: 8 }} />}

      {!!Object.keys(x.sent).length && (
        <Block title="Отправлено">{JSON.stringify(x.sent, null, 2)}</Block>
      )}

      {resp
        ? (
          <Block title={`Ответ системы${resp.status ? ` · HTTP ${resp.status}` : ''}`}>
            {JSON.stringify(resp.body, null, 2)}
          </Block>
        )
        : !x.error && (
          // Не молчим о том, почему тела ответа нет: без этого выглядит как баг.
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '4px 0 8px' }}>
            Тело ответа не показано — оно разбирается на сервере и в браузер не уходит.
            Включить: «Флоу отправки» → блок 3 → <b>Отдавать сырой ответ</b>.
          </Typography.Paragraph>
        )}

      {o.kind === 'fields' && (
        <Typography.Paragraph style={{ fontSize: 12, marginBottom: 0 }}>
          Открыт шаг <b>{o.stepTitle || o.stepId}</b>
          {o.fieldIds?.length ? ` · ${o.fieldIds.length} полей` : ''}
          {o.values && Object.keys(o.values).length
            ? <> · подставлено: {Object.entries(o.values).map(([k, v]) => (
              <Tag key={k} style={{ fontFamily: 'monospace' }}>{k} = {v === null ? '—' : String(v)}</Tag>
            ))}</>
            : null}
        </Typography.Paragraph>
      )}
      {o.kind === 'message' && (
        <Typography.Paragraph style={{ fontSize: 12, marginBottom: 0 }}>
          Показано: <b>{o.title || o.text}</b>{o.title && o.text ? ` — ${o.text}` : ''}
        </Typography.Paragraph>
      )}
      {o.kind === 'redirect' && (
        <Typography.Paragraph style={{ fontSize: 12, marginBottom: 0 }}>Переход на <code>{o.url}</code></Typography.Paragraph>
      )}
    </Card>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>{title}</Typography.Text>
      <pre style={{ margin: '2px 0 0', fontSize: 12, background: '#fafafa', padding: 8, borderRadius: 6, maxHeight: 220, overflow: 'auto' }}>
        {children}
      </pre>
    </div>
  );
}
