import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import {
  App, Button, Card, Col, Drawer, Form as AntForm, Input, InputNumber, Row, Select, Space, Table, Tag,
} from 'antd';
import { useEffect, useState } from 'react';
import { createConnection, deleteConnection, listConnections, updateConnection } from '../api';
import type { Connection } from '../types';

const AUTH_TYPES = [
  { label: 'Без авторизации', value: 'none' },
  { label: 'Bearer token', value: 'bearer' },
  { label: 'Basic (login/password)', value: 'basic' },
  { label: 'API key (header)', value: 'apikey_header' },
  { label: 'API key (query)', value: 'apikey_query' },
];

export default function Connections() {
  const { message } = App.useApp();
  const [conns, setConns] = useState<Connection[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Connection | null>(null);
  const [form] = AntForm.useForm();
  const authType = AntForm.useWatch('auth_type', form);

  const load = () => listConnections().then(setConns).catch(() => setConns([]));
  useEffect(() => { load(); }, []);

  function openEditor(c: Connection | null) {
    setEditing(c);
    form.setFieldsValue(c
      ? { ...c, whitelist: (c.whitelist || []).join('\n'), ...c.auth_config }
      : { name: '', base_url: '', auth_type: 'none', timeout: 5000, rate_limit: 60, whitelist: '' });
    setOpen(true);
  }

  async function submit() {
    const v = await form.validateFields();
    const auth_config: Record<string, any> = {};
    if (v.auth_type === 'bearer') auth_config.token = v.token;
    if (v.auth_type === 'basic') { auth_config.login = v.login; auth_config.password = v.password; }
    if (v.auth_type === 'apikey_header') { auth_config.headerName = v.headerName; auth_config.token = v.token; }
    if (v.auth_type === 'apikey_query') { auth_config.paramName = v.paramName; auth_config.token = v.token; }
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

  return (
    <Card title="Подключения" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor(null)}>Новое</Button>}>
      <Table
        rowKey="id" dataSource={conns} pagination={false}
        columns={[
          { title: 'Название', dataIndex: 'name' },
          { title: 'URL', dataIndex: 'base_url', render: (v) => <code>{v}</code> },
          { title: 'Auth', dataIndex: 'auth_type', render: (v) => <Tag>{v}</Tag> },
          { title: 'Секрет', render: (_, r) => r.auth_config?.token === '__set__' || r.auth_config?.password === '__set__' ? <Tag color="green">скрыт ✓</Tag> : '—' },
          { title: 'Whitelist', render: (_, r) => (r.whitelist || []).length },
          {
            title: '', width: 160, render: (_, r) => (
              <Space>
                <Button size="small" onClick={() => openEditor(r)}>Изменить</Button>
                <Button size="small" danger onClick={async () => { await deleteConnection(r.id); load(); }}>Удалить</Button>
              </Space>
            ),
          },
        ]}
      />
      <Drawer title={editing ? 'Подключение' : 'Новое подключение'} open={open} width={520} onClose={() => setOpen(false)}
        extra={<Button type="primary" onClick={submit}>Сохранить</Button>}>
        <AntForm form={form} layout="vertical">
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
          {authType === 'bearer' && <AntForm.Item name="token" label="Token"><Input.Password placeholder={editing ? '•••• (оставьте пустым)' : ''} /></AntForm.Item>}
          {authType === 'basic' && <>
            <AntForm.Item name="login" label="Login"><Input /></AntForm.Item>
            <AntForm.Item name="password" label="Password"><Input.Password /></AntForm.Item>
          </>}
          {authType === 'apikey_header' && <>
            <AntForm.Item name="headerName" label="Header name" initialValue="Authorization"><Input /></AntForm.Item>
            <AntForm.Item name="token" label="Token"><Input.Password /></AntForm.Item>
          </>}
          {authType === 'apikey_query' && <>
            <AntForm.Item name="paramName" label="Param name"><Input /></AntForm.Item>
            <AntForm.Item name="token" label="Token"><Input.Password /></AntForm.Item>
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
