import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import {
  App, Button, Card, Col, Drawer, Form as AntForm, Input, Row, Select, Space, Table, Tag, Typography,
} from 'antd';
import { useEffect, useState } from 'react';
import { createDictionary, deleteDictionary, listDictionaries, updateDictionary } from '../api';
import type { Dictionary } from '../types';

export default function Dictionaries() {
  const { message } = App.useApp();
  const [dicts, setDicts] = useState<Dictionary[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Dictionary | null>(null);
  const [form] = AntForm.useForm();

  const load = () => listDictionaries().then(setDicts).catch(() => setDicts([]));
  useEffect(() => { load(); }, []);

  function openEditor(d: Dictionary | null) {
    setEditing(d);
    form.setFieldsValue(
      d
        ? { ...d, attrs: d.attrs || [], items: (d.items || []).map((it) => ({ ...it, attrs: JSON.stringify(it.attrs || {}) })) }
        : { code: '', name: '', type: 'manual', attrs: [], items: [], dependencies: [] },
    );
    setOpen(true);
  }

  async function submit() {
    const vals = await form.validateFields();
    const body: any = {
      code: vals.code,
      name: vals.name,
      type: vals.type,
      dependencies: vals.dependencies || [],
      attrs: vals.attrs || [],
      items: (vals.items || []).map((it: any) => ({
        code: it.code, label: it.label, parentValue: it.parentValue || '',
        attrs: safeJson(it.attrs),
      })),
    };
    try {
      if (editing) await updateDictionary(editing.id, body);
      else await createDictionary(body);
      setOpen(false);
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || 'Ошибка');
    }
  }

  return (
    <Card title="Справочники" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor(null)}>Новый</Button>}>
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
