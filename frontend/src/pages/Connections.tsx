import { DeleteOutlined, EditOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import {
  Alert, App, Button, Card, Col, Drawer, Form as AntForm, Input, InputNumber, Row, Select, Space, Table, Tag, Tooltip, Typography,
} from 'antd';
import { useEffect, useState } from 'react';
import type { ConnectionTestResult } from '../api';
import { createConnection, deleteConnection, listConnections, testConnection, updateConnection } from '../api';
import type { Connection } from '../types';

const AUTH_TYPES = [
  { label: 'Без авторизации', value: 'none' },
  { label: 'Bearer token', value: 'bearer' },
  { label: 'Basic (login/password)', value: 'basic' },
  { label: 'API key (header)', value: 'apikey_header' },
  { label: 'API key (query)', value: 'apikey_query' },
];

const isDaData = (baseUrl?: string) => /suggestions\.dadata\.ru/i.test(baseUrl || '');

// A meaningful probe per provider. DaData rejects a bare GET on its base URL,
// so we hit the real suggest endpoint with a tiny query; everyone else just
// probes the base URL with GET.
function testRecipe(c: Connection): { endpoint?: string; method?: string; body?: any } {
  if (isDaData(c.base_url)) {
    return { endpoint: '/suggest/address', method: 'POST', body: { query: 'москва', count: 1 } };
  }
  return {};
}

export default function Connections() {
  const { message } = App.useApp();
  const [conns, setConns] = useState<Connection[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Connection | null>(null);
  const [form] = AntForm.useForm();
  const authType = AntForm.useWatch('auth_type', form);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ConnectionTestResult>>({});
  const [drawerResult, setDrawerResult] = useState<ConnectionTestResult | null>(null);

  const load = () => listConnections().then(setConns).catch(() => setConns([]));
  useEffect(() => { load(); }, []);

  function openEditor(c: Connection | null) {
    setEditing(c);
    setDrawerResult(null);
    // Always start from a clean form so secrets/values don't bleed between connections.
    form.resetFields();
    if (c) {
      // Don't prefill secret fields with the redaction marker ('__set__'): it would
      // otherwise be concatenated into the real token when the user edits it. Leaving
      // them empty means "keep the stored secret" (see submit()).
      const { token, password, ...safeAuth } = c.auth_config || {};
      form.setFieldsValue({ ...c, whitelist: (c.whitelist || []).join('\n'), ...safeAuth });
    } else {
      form.setFieldsValue({ name: '', base_url: '', auth_type: 'none', timeout: 5000, rate_limit: 60, whitelist: '' });
    }
    setOpen(true);
  }

  async function submit() {
    const v = await form.validateFields();
    const auth_config: Record<string, any> = {};
    // Secrets (token/password) are only sent when the user actually typed a value.
    // An empty field on an existing connection means "keep the stored secret".
    if (v.auth_type === 'bearer') { if (v.token) auth_config.token = v.token; }
    if (v.auth_type === 'basic') { auth_config.login = v.login; if (v.password) auth_config.password = v.password; }
    if (v.auth_type === 'apikey_header') {
      auth_config.headerName = v.headerName;
      if (v.token) {
        // DaData expects `Authorization: Token <key>`; the header value is sent
        // verbatim, so prepend the scheme if the user pasted just the key.
        auth_config.token = isDaData(v.base_url) && !/^token\s/i.test(v.token.trim())
          ? `Token ${v.token.trim()}`
          : v.token;
      }
    }
    if (v.auth_type === 'apikey_query') { auth_config.paramName = v.paramName; if (v.token) auth_config.token = v.token; }
    const body: any = {
      name: v.name, base_url: v.base_url, auth_type: v.auth_type, auth_config,
      whitelist: String(v.whitelist || '').split('\n').map((s) => s.trim()).filter(Boolean),
      timeout: v.timeout || 5000, rate_limit: v.rate_limit || 60, cache: 'none', env: 'prod',
    };
    try {
      if (editing) await updateConnection(editing.id, body);
      else await createConnection(body);
      setOpen(false); load();
    } catch (e: any) { message.error(e?.response?.data?.detail || 'Ошибка'); }
  }

  async function runTest(id: string, inDrawer = false): Promise<void> {
    setTestingId(id);
    try {
      const conn = conns.find((c) => c.id === id);
      const res = await testConnection(id, conn ? testRecipe(conn) : {});
      setResults((m) => ({ ...m, [id]: res }));
      if (inDrawer) setDrawerResult(res);
      if (res.ok) message.success(`Работает — ${res.message}${res.latency_ms != null ? ` · ${res.latency_ms} мс` : ''}`);
      else if (res.reachable) message.warning(`Сервер отвечает, но вернул ${res.message}`);
      else message.error(res.message);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || 'Ошибка проверки');
    } finally {
      setTestingId(null);
    }
  }

  function testTag(id: string) {
    const res = results[id];
    if (!res) return <Typography.Text type="secondary">—</Typography.Text>;
    if (res.ok) return <Tag color="green">OK{res.latency_ms != null ? ` · ${res.latency_ms} мс` : ''}</Tag>;
    if (res.reachable) return <Tooltip title={res.message}><Tag color="orange">HTTP {res.status}</Tag></Tooltip>;
    return <Tooltip title={res.message}><Tag color="red">нет связи</Tag></Tooltip>;
  }

  return (
    <Card
      title="Подключения"
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor(null)}>Новое</Button>}
    >
      <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
        Общий раздел аккаунта — интеграции и секреты доступны всем формам, секреты хранятся зашифрованными.
      </Typography.Paragraph>
      <Table
        scroll={{ x: 'max-content' }}
        rowKey="id" dataSource={conns} pagination={false}
        columns={[
          { title: 'Название', dataIndex: 'name', width: 160, ellipsis: true },
          { title: 'URL', dataIndex: 'base_url', width: 220, ellipsis: true, render: (v) => <code style={{ wordBreak: 'break-all' }}>{v}</code> },
          { title: 'Auth', dataIndex: 'auth_type', width: 120, render: (v) => <Tag>{v}</Tag> },
          { title: 'Секрет', width: 100, render: (_, r) => r.auth_config?.token === '__set__' || r.auth_config?.password === '__set__' ? <Tag color="green">скрыт ✓</Tag> : '—' },
          { title: 'Whitelist', width: 90, render: (_, r) => (r.whitelist || []).length },
          { title: 'Проверка', width: 120, render: (_, r) => testTag(r.id) },
          {
            title: '', width: 120, align: 'center' as const, render: (_, r) => (
              <Space size={4}>
                <Tooltip title="Проверить">
                  <Button
                    size="small" type="text" icon={<ThunderboltOutlined />}
                    loading={testingId === r.id} onClick={() => runTest(r.id)}
                  />
                </Tooltip>
                <Tooltip title="Изменить">
                  <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEditor(r)} />
                </Tooltip>
                <Tooltip title="Удалить">
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={async () => { await deleteConnection(r.id); load(); }} />
                </Tooltip>
              </Space>
            ),
          },
        ]}
      />
      <Drawer title={editing ? 'Подключение' : 'Новое подключение'} open={open} width={520} onClose={() => setOpen(false)}
        extra={(
          <Space>
            {editing && (
              <Tooltip title="Проверяется сохранённое подключение (с текущими секретами)">
                <Button icon={<ThunderboltOutlined />} loading={testingId === editing.id} onClick={() => runTest(editing.id, true)}>
                  Проверить
                </Button>
              </Tooltip>
            )}
            <Button type="primary" onClick={submit}>Сохранить</Button>
          </Space>
        )}>
        <AntForm form={form} layout="vertical">
          {drawerResult && (
            <Alert
              style={{ marginBottom: 16 }}
              type={drawerResult.ok ? 'success' : drawerResult.reachable ? 'warning' : 'error'}
              showIcon
              message={drawerResult.ok ? 'Подключение работает' : drawerResult.reachable ? 'Сервер отвечает с ошибкой' : 'Нет связи'}
              description={(
                <>
                  <div>{drawerResult.message}{drawerResult.latency_ms != null ? ` · ${drawerResult.latency_ms} мс` : ''}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12, wordBreak: 'break-all' }}>{drawerResult.url}</Typography.Text>
                </>
              )}
            />
          )}
          <AntForm.Item label="Пресеты">
            <Space wrap>
              <Button size="small" onClick={() => form.setFieldsValue({
                name: 'DaData Suggestions', base_url: 'https://suggestions.dadata.ru/suggestions/api/4_1/rs',
                auth_type: 'apikey_header', headerName: 'Authorization', whitelist: '^/suggest/.*$',
                timeout: 5000, rate_limit: 60,
              })}>DaData</Button>
              <Button size="small" onClick={() => form.setFieldsValue({
                name: 'REST API', base_url: 'https://api.example.com', auth_type: 'bearer', timeout: 5000, rate_limit: 60, whitelist: '',
              })}>REST + Bearer</Button>
            </Space>
          </AntForm.Item>
          <AntForm.Item name="name" label="Название" rules={[{ required: true }]}><Input /></AntForm.Item>
          <AntForm.Item name="base_url" label="Base URL" rules={[{ required: true }]}><Input placeholder="https://suggestions.dadata.ru/..." /></AntForm.Item>
          <AntForm.Item name="auth_type" label="Тип авторизации"><Select options={AUTH_TYPES} /></AntForm.Item>
          {authType === 'bearer' && <AntForm.Item name="token" label="Token"><Input.Password placeholder={editing ? '•••• (оставьте пустым, чтобы не менять)' : ''} /></AntForm.Item>}
          {authType === 'basic' && <>
            <AntForm.Item name="login" label="Login"><Input /></AntForm.Item>
            <AntForm.Item name="password" label="Password"><Input.Password placeholder={editing ? '•••• (оставьте пустым, чтобы не менять)' : ''} /></AntForm.Item>
          </>}
          {authType === 'apikey_header' && <>
            <AntForm.Item name="headerName" label="Header name" initialValue="Authorization"><Input /></AntForm.Item>
            <AntForm.Item
              name="token" label="Token"
              extra="Значение уходит в заголовок как есть. Для DaData используйте API-ключ (не секретный) — префикс «Token » добавится автоматически."
            >
              <Input.Password placeholder={editing ? '•••• (оставьте пустым, чтобы не менять)' : ''} />
            </AntForm.Item>
          </>}
          {authType === 'apikey_query' && <>
            <AntForm.Item name="paramName" label="Param name"><Input /></AntForm.Item>
            <AntForm.Item name="token" label="Token"><Input.Password placeholder={editing ? '•••• (оставьте пустым, чтобы не менять)' : ''} /></AntForm.Item>
          </>}
          <AntForm.Item name="whitelist" label="Whitelist путей (regex, по строке)" extra="Например: ^/suggest/.*$">
            <Input.TextArea rows={3} />
          </AntForm.Item>
          <Row gutter={12}>
            <Col span={12}><AntForm.Item name="timeout" label="Timeout (мс)"><InputNumber style={{ width: '100%' }} /></AntForm.Item></Col>
            <Col span={12}><AntForm.Item name="rate_limit" label="Rate limit (в мин)"><InputNumber style={{ width: '100%' }} /></AntForm.Item></Col>
          </Row>
        </AntForm>
      </Drawer>
    </Card>
  );
}
