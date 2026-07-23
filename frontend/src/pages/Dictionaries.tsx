import { DeleteOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import {
  Alert, App, AutoComplete, Button, Card, Col, Drawer, Form as AntForm, Input, Row, Select, Space, Table, Tag, Typography,
} from 'antd';
import { useEffect, useState } from 'react';
import {
  createDictionary, deleteDictionary, listConnections, listDictionaries, probeDictionary, updateDictionary,
} from '../api';
import type { Connection, Dictionary } from '../types';

export default function Dictionaries() {
  const { message } = App.useApp();
  const [dicts, setDicts] = useState<Dictionary[]>([]);
  const [conns, setConns] = useState<Connection[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Dictionary | null>(null);
  const [testResult, setTestResult] = useState<any>(null);
  const [probeRaw, setProbeRaw] = useState<any>(null);
  const [form] = AntForm.useForm();
  const type = AntForm.useWatch('type', form);
  const urlMode = AntForm.useWatch(['api', 'urlMode'], form);
  const apiPath = AntForm.useWatch(['api', 'path'], form);

  // Auto-discovery from a test response: where the list lives, and its fields.
  const arrayPaths = probeRaw ? findArrayPaths(probeRaw) : [];
  const fieldKeys = probeRaw ? fieldsAtPath(probeRaw, apiPath || '') : [];
  const pathOptions = arrayPaths.map((p) => ({ value: p, label: p === '' ? '(корень — сам массив)' : p }));
  const fieldOptions = fieldKeys.map((k) => ({ value: k }));

  const load = () => listDictionaries().then(setDicts).catch(() => setDicts([]));
  useEffect(() => { load(); listConnections().then(setConns).catch(() => {}); }, []);

  function openEditor(d: Dictionary | null) {
    setEditing(d);
    setTestResult(null);
    setProbeRaw(null);
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
    const cfg = buildBody(vals).api_config;
    if (!cfg?.connectionId) { message.info('Сначала выберите подключение'); return; }
    setTestResult({ loading: true });
    try {
      // Probe the current (possibly unsaved) config so the response shows immediately.
      const res = await probeDictionary({ api_config: cfg, dependencies: vals.dependencies || [], values: {} });
      setTestResult(res);
      setProbeRaw(res.ok ? res.raw : null);
      if (!res.ok) message.error(res.error || 'Ошибка запроса');
      else if (!res.items?.length) message.warning('Сервер ответил, но список пуст — проверьте поле «Где в ответе список»');
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
              extra={<Button size="small" type="primary" ghost icon={<ThunderboltOutlined />} onClick={runTest}>Тест</Button>}>
              <Alert
                type="info" showIcon style={{ marginBottom: 12 }}
                message="Варианты списка берутся из вашего API"
                description={(
                  <span style={{ fontSize: 12 }}>
                    1. Выберите подключение и укажите адрес (endpoint). 2. Нажмите <b>«Тест»</b> — увидите ответ сервера.
                    3. Внизу выберите, <b>где</b> в ответе лежит список и <b>какие поля</b> показывать. Угадывать не нужно — поля подставятся из ответа.
                  </span>
                )}
              />
              <AntForm.Item
                name={['api', 'connectionId']} label="Подключение" rules={[{ required: true }]}
                tooltip="Откуда брать данные. Настраивается в разделе «Подключения» (адрес API + авторизация)."
              >
                <Select options={conns.map((c) => ({ label: `${c.name} (${c.base_url})`, value: c.id }))} placeholder="Выберите подключение" />
              </AntForm.Item>
              <Row gutter={8}>
                <Col span={12}><AntForm.Item
                  name={['api', 'urlMode']} label="Режим URL"
                  tooltip="Один фиксированный адрес, либо разный адрес в зависимости от значения родительского поля (каскад)."
                >
                  <Select options={[{ label: 'Один адрес', value: 'single' }, { label: 'Адрес зависит от др. поля', value: 'smart' }]} />
                </AntForm.Item></Col>
                <Col span={12}><AntForm.Item
                  name={['api', 'refresh']} label="Когда обновлять данные"
                  tooltip="«При каждом открытии формы» — форма всегда запрашивает свежие данные (без кэша). «Раз в час/день» — ответ кэшируется, API дёргается реже."
                >
                  <Select options={[
                    { label: 'При каждом открытии формы (всегда свежие)', value: 'onOpen' },
                    { label: 'Раз в час (кэш)', value: 'hourly' },
                    { label: 'Раз в день (кэш)', value: 'daily' },
                  ]} />
                </AntForm.Item></Col>
              </Row>
              {urlMode !== 'smart' && (
                <Row gutter={8}>
                  <Col span={8}><AntForm.Item name={['api', 'method']} label="Метод"><Select options={[{ label: 'GET', value: 'GET' }, { label: 'POST', value: 'POST' }]} /></AntForm.Item></Col>
                  <Col span={16}><AntForm.Item
                    name={['api', 'endpoint']} label="Адрес (endpoint)"
                    tooltip="Дописывается к адресу подключения. Напр. подключение = https://api.site.ru, endpoint = /products → запрос уйдёт на https://api.site.ru/products"
                  >
                    <Input placeholder="/products" />
                  </AntForm.Item></Col>
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
              <AntForm.Item
                name={['api', 'params']} label="Параметры запроса (необязательно)"
                tooltip="JSON с параметрами запроса. Можно подставлять значения полей формы через {{id_поля}} — напр. фильтровать список по выбранному региону."
                extra={'Оставьте пустым, если не нужны. Пример: {"region": "{{f_region}}"}'}
              >
                <Input.TextArea rows={2} placeholder="{}" style={{ fontFamily: 'monospace', fontSize: 12 }} />
              </AntForm.Item>
              <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>Как разобрать ответ</Typography.Text>
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                Ответ API — это JSON. Укажите, где внутри него лежит список вариантов и какие два поля брать: одно
                сохраняется в форму (значение), второе видит пользователь (название). {probeRaw
                  ? 'Поля ниже подставляются из ответа — просто выберите из списка.'
                  : 'Нажмите «Тест» вверху — и поля можно будет выбрать из реального ответа.'}
              </Typography.Paragraph>
              <AntForm.Item
                name={['api', 'path']} label="Где в ответе список"
                tooltip='Путь до массива внутри JSON, через точку. Если API вернул {"data":[...]} → напишите data. Если сразу [...] — оставьте пустым.'
                extra={arrayPaths.length ? `Найдены списки: ${arrayPaths.map((p) => p || '(корень)').join(', ')}` : 'напр. data или result.items'}
              >
                <AutoComplete options={pathOptions} placeholder="data" filterOption={(i, o) => String(o?.value ?? '').toLowerCase().includes(i.toLowerCase())} />
              </AntForm.Item>
              <Row gutter={8}>
                <Col span={12}><AntForm.Item
                  name={['api', 'codeField']} label="Поле-значение (сохранится)"
                  tooltip="Имя поля внутри каждого элемента списка, которое запишется в форму как выбранное значение. Обычно id/код/sku."
                >
                  <AutoComplete options={fieldOptions} placeholder="id" filterOption={(i, o) => String(o?.value ?? '').toLowerCase().includes(i.toLowerCase())} />
                </AntForm.Item></Col>
                <Col span={12}><AntForm.Item
                  name={['api', 'valueField']} label="Поле-название (видит юзер)"
                  tooltip="Имя поля внутри каждого элемента, которое показывается в выпадающем списке. Обычно name/title/название."
                >
                  <AutoComplete options={fieldOptions} placeholder="name" filterOption={(i, o) => String(o?.value ?? '').toLowerCase().includes(i.toLowerCase())} />
                </AntForm.Item></Col>
              </Row>
              <AntForm.Item
                name={['api', 'attrsMap']} label="Доп. поля к варианту (необязательно)"
                tooltip='Доп. данные, которые «прицепятся» к каждому варианту (цена, остаток) — их можно использовать в формулах и на форме. Формат: {"имя_атрибута": "поле_в_JSON"}.'
                extra={'Оставьте {} если не нужно. Пример: {"price": "price", "stock": "stock"}'}
              >
                <Input placeholder="{}" style={{ fontFamily: 'monospace', fontSize: 12 }} />
              </AntForm.Item>
              {testResult && (
                <Card size="small" style={{ background: '#fafafa' }}>
                  {testResult.loading ? 'Запрос…' : testResult.ok ? (
                    <>
                      <Tag color={testResult.items?.length ? 'green' : 'orange'}>
                        {testResult.items?.length ? `OK · распознано ${testResult.items.length} вариантов` : 'Ответ получен, но список пуст'}
                      </Tag>
                      {!!testResult.items?.length && (
                        <div style={{ margin: '8px 0 4px', fontSize: 12 }}>
                          {testResult.items.slice(0, 3).map((it: any) => (
                            <div key={it.code}><b>{it.label || '—'}</b> <Typography.Text type="secondary">({it.code})</Typography.Text></div>
                          ))}
                          {testResult.items.length > 3 && <Typography.Text type="secondary">…и ещё {testResult.items.length - 3}</Typography.Text>}
                        </div>
                      )}
                      <details style={{ marginTop: 6 }}>
                        <summary style={{ cursor: 'pointer', fontSize: 12, color: '#888' }}>Сырой ответ API</summary>
                        <pre style={{ margin: '6px 0 0', fontSize: 11, maxHeight: 200, overflow: 'auto' }}>{JSON.stringify(testResult.raw, null, 2)}</pre>
                      </details>
                    </>
                  ) : <Tag color="red">Ошибка: {testResult.error}</Tag>}
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

// Dot-paths inside a JSON response that point to an array of objects (the option
// list). '' means the root itself is the array. Searched a few levels deep.
function findArrayPaths(obj: any, prefix = '', depth = 0): string[] {
  if (Array.isArray(obj)) {
    return obj.length && typeof obj[0] === 'object' && !Array.isArray(obj[0]) ? [prefix] : [];
  }
  if (obj && typeof obj === 'object' && depth < 3) {
    return Object.keys(obj).flatMap((k) => findArrayPaths(obj[k], prefix ? `${prefix}.${k}` : k, depth + 1));
  }
  return [];
}

// Keys available on the first element of the array at the given dot-path.
function fieldsAtPath(raw: any, path: string): string[] {
  let node = raw;
  for (const part of path.split('.').filter(Boolean)) node = node?.[part];
  if (Array.isArray(node) && node.length && node[0] && typeof node[0] === 'object') return Object.keys(node[0]);
  return [];
}
