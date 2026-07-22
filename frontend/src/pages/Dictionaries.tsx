import { DeleteOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import {
  App, Button, Card, Col, Drawer, Form as AntForm, Input, Row, Select, Space, Table, Tag, Typography,
} from 'antd';
import { useEffect, useState } from 'react';
import {
  createDictionary, deleteDictionary, listConnections, listDictionaries, testDictionary, updateDictionary,
} from '../api';
import type { Connection, Dictionary } from '../types';

export default function Dictionaries() {
  const { message } = App.useApp();
  const [dicts, setDicts] = useState<Dictionary[]>([]);
  const [conns, setConns] = useState<Connection[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Dictionary | null>(null);
  const [testResult, setTestResult] = useState<any>(null);
  const [form] = AntForm.useForm();
  const type = AntForm.useWatch('type', form);
  const urlMode = AntForm.useWatch(['api', 'urlMode'], form);

  const load = () => listDictionaries().then(setDicts).catch(() => setDicts([]));
  useEffect(() => { load(); listConnections().then(setConns).catch(() => {}); }, []);

  function openEditor(d: Dictionary | null) {
    setEditing(d);
    setTestResult(null);
    const cfg = d?.api_config || {};
    form.setFieldsValue(
      d
        ? {
            ...d,
            attrs: d.attrs || [],
            items: (d.items || []).map((it) => ({ ...it, attrs: JSON.stringify(it.attrs || {}) })),
            api: {
              connectionId: cfg.connectionId,
              urlMode: cfg.urlMode || 'single',
              method: cfg.method || 'GET',
              endpoint: cfg.endpoint || '',
              params: cfg.params || '',
              refresh: cfg.refresh || 'hourly',
              path: cfg.mapping?.path || 'data',
              codeField: cfg.mapping?.codeField || 'code',
              valueField: cfg.mapping?.valueField || 'value',
              attrsMap: JSON.stringify(cfg.mapping?.attrs || {}),
              urlMap: cfg.urlMap || [],
            },
          }
        : {
            code: '', name: '', type: 'manual', attrs: [], items: [], dependencies: [],
            api: { urlMode: 'single', method: 'GET', refresh: 'hourly', path: 'data', codeField: 'code', valueField: 'value', attrsMap: '{}', urlMap: [] },
          },
    );
    setOpen(true);
  }

  function buildBody(vals: any) {
    const body: any = {
      code: vals.code,
      name: vals.name,
      type: vals.type,
      dependencies: vals.dependencies || [],
      attrs: vals.attrs || [],
      items: vals.type === 'manual'
        ? (vals.items || []).map((it: any) => ({ code: it.code, label: it.label, parentValue: it.parentValue || '', attrs: safeJson(it.attrs) }))
        : [],
    };
    if (vals.type === 'api') {
      const a = vals.api || {};
      body.api_config = {
        connectionId: a.connectionId,
        urlMode: a.urlMode || 'single',
        method: a.method || 'GET',
        endpoint: a.endpoint || '',
        params: a.params || '',
        refresh: a.refresh || 'hourly',
        mapping: { path: a.path, codeField: a.codeField, valueField: a.valueField, attrs: safeJson(a.attrsMap) },
        urlMap: a.urlMap || [],
      };
    }
    return body;
  }

  async function submit() {
    const vals = await form.validateFields();
    try {
      if (editing) await updateDictionary(editing.id, buildBody(vals));
      else await createDictionary(buildBody(vals));
      setOpen(false);
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || 'Ошибка');
    }
  }

  async function runTest() {
    const vals = form.getFieldsValue();
    if (!editing) { message.info('Сначала сохраните справочник, затем тестируйте'); return; }
    await updateDictionary(editing.id, buildBody(vals)).catch(() => {});
    setTestResult({ loading: true });
    try {
      const res = await testDictionary(editing.id, {});
      setTestResult(res);
      if (!res.ok) message.error('Ошибка запроса');
    } catch (e: any) {
      setTestResult({ ok: false, error: e?.response?.data?.detail || String(e) });
    }
  }

  return (
    <Card
      title="Справочники"
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor(null)}>Новый</Button>}
    >
      <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
        Общий раздел аккаунта — справочники доступны во всех формах.
      </Typography.Paragraph>
      <Table
        rowKey="id"
        dataSource={dicts}
        pagination={false}
        columns={[
          { title: 'Название', dataIndex: 'name' },
          { title: 'Код', dataIndex: 'code', render: (v) => <Tag>{v}</Tag> },
          { title: 'Тип', dataIndex: 'type', render: (v) => <Tag color={v === 'api' ? 'geekblue' : 'green'}>{v}</Tag> },
          { title: 'Значений', render: (_, r) => r.items?.length ?? 0 },
          { title: 'Атрибуты', render: (_, r) => (r.attrs || []).map((a) => <Tag key={a.name}>{a.name}</Tag>) },
          {
            title: '', width: 160, render: (_, r) => (
              <Space>
                <Button size="small" onClick={() => openEditor(r)}>Изменить</Button>
                <Button size="small" danger onClick={async () => { await deleteDictionary(r.id); load(); }}>Удалить</Button>
              </Space>
            ),
          },
        ]}
      />

      <Drawer title={editing ? 'Справочник' : 'Новый справочник'} open={open} width={640} onClose={() => setOpen(false)}
        extra={<Button type="primary" onClick={submit}>Сохранить</Button>}>
        <AntForm form={form} layout="vertical">
          <Row gutter={12}>
            <Col span={12}><AntForm.Item name="name" label="Название" rules={[{ required: true }]}><Input /></AntForm.Item></Col>
            <Col span={12}><AntForm.Item name="code" label="Код" rules={[{ required: true }]}><Input /></AntForm.Item></Col>
          </Row>
          <AntForm.Item name="type" label="Тип" initialValue="manual">
            <Select options={[{ label: 'Ручной', value: 'manual' }, { label: 'API', value: 'api' }]} />
          </AntForm.Item>

          {type === 'api' && (
            <Card size="small" title="Источник (API)" style={{ marginBottom: 12 }}
              extra={<Button size="small" icon={<ThunderboltOutlined />} onClick={runTest}>Тест</Button>}>
              <AntForm.Item name={['api', 'connectionId']} label="Подключение" rules={[{ required: true }]}>
                <Select options={conns.map((c) => ({ label: `${c.name} (${c.base_url})`, value: c.id }))} placeholder="Выберите подключение" />
              </AntForm.Item>
              <Row gutter={8}>
                <Col span={12}><AntForm.Item name={['api', 'urlMode']} label="Режим URL">
                  <Select options={[{ label: 'single (один URL)', value: 'single' }, { label: 'smart (URL по родителю)', value: 'smart' }]} />
                </AntForm.Item></Col>
                <Col span={12}><AntForm.Item name={['api', 'refresh']} label="Обновление">
                  <Select options={[{ label: 'вручную', value: 'manual' }, { label: 'каждый час', value: 'hourly' }, { label: 'ежедневно', value: 'daily' }]} />
                </AntForm.Item></Col>
              </Row>
              {urlMode !== 'smart' && (
                <Row gutter={8}>
                  <Col span={8}><AntForm.Item name={['api', 'method']} label="Метод"><Select options={[{ label: 'GET', value: 'GET' }, { label: 'POST', value: 'POST' }]} /></AntForm.Item></Col>
                  <Col span={16}><AntForm.Item name={['api', 'endpoint']} label="Endpoint"><Input placeholder="/products" /></AntForm.Item></Col>
                </Row>
              )}
              {urlMode === 'smart' && (
                <>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>URL по значению родителя:</Typography.Text>
                  <AntForm.List name={['api', 'urlMap']}>
                    {(fields, { add, remove }) => (
                      <div style={{ marginBottom: 8 }}>
                        {fields.map((f) => (
                          <Space key={f.key} align="baseline" style={{ display: 'flex', marginTop: 4 }}>
                            <AntForm.Item {...f} name={[f.name, 'parentValue']} noStyle><Input placeholder="значение" style={{ width: 90 }} /></AntForm.Item>
                            <AntForm.Item {...f} name={[f.name, 'method']} noStyle initialValue="GET"><Select style={{ width: 80 }} options={[{ label: 'GET', value: 'GET' }, { label: 'POST', value: 'POST' }]} /></AntForm.Item>
                            <AntForm.Item {...f} name={[f.name, 'endpoint']} noStyle><Input placeholder="/branches/msk" style={{ width: 160 }} /></AntForm.Item>
                            <DeleteOutlined onClick={() => remove(f.name)} />
                          </Space>
                        ))}
                        <Button size="small" icon={<PlusOutlined />} onClick={() => add({ method: 'GET' })} style={{ marginTop: 4 }}>URL</Button>
                      </div>
                    )}
                  </AntForm.List>
                </>
              )}
              <AntForm.Item name={['api', 'params']} label="Параметры (JSON, поддержка {{field}})" extra='напр. {"region": "{{f_region}}"}'>
                <Input.TextArea rows={2} placeholder="{}" style={{ fontFamily: 'monospace', fontSize: 12 }} />
              </AntForm.Item>
              <Row gutter={8}>
                <Col span={8}><AntForm.Item name={['api', 'path']} label="path (в JSON)"><Input placeholder="data" /></AntForm.Item></Col>
                <Col span={8}><AntForm.Item name={['api', 'codeField']} label="code поле"><Input placeholder="id" /></AntForm.Item></Col>
                <Col span={8}><AntForm.Item name={['api', 'valueField']} label="label поле"><Input placeholder="name" /></AntForm.Item></Col>
              </Row>
              <AntForm.Item name={['api', 'attrsMap']} label="Атрибуты → поля JSON (JSON)" extra='напр. {"price": "price"}'>
                <Input placeholder="{}" style={{ fontFamily: 'monospace', fontSize: 12 }} />
              </AntForm.Item>
              {testResult && (
                <Card size="small" style={{ background: '#fafafa' }}>
                  {testResult.loading ? 'Запрос…' : testResult.ok
                    ? <><Tag color="green">OK · {testResult.items?.length} значений</Tag>
                        <pre style={{ margin: '8px 0 0', fontSize: 11, maxHeight: 160, overflow: 'auto' }}>{JSON.stringify(testResult.items?.slice(0, 5), null, 2)}</pre></>
                    : <Tag color="red">Ошибка: {testResult.error}</Tag>}
                </Card>
              )}
            </Card>
          )}

          <Typography.Text strong>Атрибуты значений</Typography.Text>
          <AntForm.List name="attrs">
            {(fields, { add, remove }) => (
              <div style={{ marginBottom: 12 }}>
                {fields.map((f) => (
                  <Space key={f.key} align="baseline" style={{ display: 'flex', marginTop: 4 }}>
                    <AntForm.Item {...f} name={[f.name, 'name']} noStyle><Input placeholder="name" /></AntForm.Item>
                    <AntForm.Item {...f} name={[f.name, 'label']} noStyle><Input placeholder="Метка" /></AntForm.Item>
                    <AntForm.Item {...f} name={[f.name, 'type']} noStyle initialValue="number">
                      <Select style={{ width: 110 }} options={[{ label: 'число', value: 'number' }, { label: 'строка', value: 'string' }]} />
                    </AntForm.Item>
                    <DeleteOutlined onClick={() => remove(f.name)} />
                  </Space>
                ))}
                <Button size="small" icon={<PlusOutlined />} onClick={() => add({ type: 'number' })} style={{ marginTop: 4 }}>Атрибут</Button>
              </div>
            )}
          </AntForm.List>

          <Typography.Text strong>Зависимость (каскад)</Typography.Text>
          <AntForm.List name="dependencies">
            {(fields, { add, remove }) => (
              <div style={{ marginBottom: 12 }}>
                {fields.map((f) => (
                  <Space key={f.key} align="baseline" style={{ display: 'flex', marginTop: 4 }}>
                    <AntForm.Item {...f} name={[f.name, 'fieldId']} noStyle><Input placeholder="fieldId родителя (напр. f_region)" /></AntForm.Item>
                    <AntForm.Item {...f} name={[f.name, 'paramName']} noStyle><Input placeholder="paramName" /></AntForm.Item>
                    <DeleteOutlined onClick={() => remove(f.name)} />
                  </Space>
                ))}
                <Button size="small" icon={<PlusOutlined />} onClick={() => add()} style={{ marginTop: 4 }}>Зависимость</Button>
              </div>
            )}
          </AntForm.List>

          {type !== 'api' && (
            <>
              <Typography.Text strong>Значения</Typography.Text>
              <AntForm.List name="items">
                {(fields, { add, remove }) => (
                  <div style={{ marginTop: 4 }}>
                    {fields.map((f) => (
                      <Space key={f.key} align="baseline" style={{ display: 'flex', marginTop: 4 }} wrap>
                        <AntForm.Item {...f} name={[f.name, 'code']} noStyle><Input placeholder="код" style={{ width: 110 }} /></AntForm.Item>
                        <AntForm.Item {...f} name={[f.name, 'label']} noStyle><Input placeholder="Метка" style={{ width: 150 }} /></AntForm.Item>
                        <AntForm.Item {...f} name={[f.name, 'parentValue']} noStyle><Input placeholder="parent" style={{ width: 90 }} /></AntForm.Item>
                        <AntForm.Item {...f} name={[f.name, 'attrs']} noStyle><Input placeholder='{"cost":500}' style={{ width: 150 }} /></AntForm.Item>
                        <DeleteOutlined onClick={() => remove(f.name)} />
                      </Space>
                    ))}
                    <Button size="small" icon={<PlusOutlined />} onClick={() => add({ attrs: '{}' })} style={{ marginTop: 4 }}>Значение</Button>
                  </div>
                )}
              </AntForm.List>
            </>
          )}
        </AntForm>
      </Drawer>
    </Card>
  );
}

function safeJson(s: any): Record<string, any> {
  if (!s) return {};
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { return {}; }
}
