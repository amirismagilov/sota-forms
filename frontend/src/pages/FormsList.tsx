import { DownloadOutlined, PlusOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons';
import {
  App, Badge, Button, Card, Form as AntForm, Input, Modal, Segmented, Space, Table, Tag, Tooltip, Upload,
} from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createForm, deleteForm, exportForm, importForm, listForms, publishForm, setFormStatus } from '../api';
import type { FormSchema } from '../types';

const STATUS_META: Record<string, { color: string; label: string }> = {
  draft: { color: 'default', label: 'Черновик' },
  published: { color: 'green', label: 'Опубликована' },
  archived: { color: 'red', label: 'В архиве' },
};

export default function FormsList() {
  const { message } = App.useApp();
  const nav = useNavigate();
  const [rows, setRows] = useState<FormSchema[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [form] = AntForm.useForm();
  const pageSize = 10;

  const load = useCallback(() => {
    listForms({
      q: q || undefined,
      status: status === 'all' ? undefined : status,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }).then((r) => { setRows(r.items); setTotal(r.total); }).catch(() => setRows([]));
  }, [q, status, page]);
  useEffect(() => { load(); }, [load]);

  async function onCreate() {
    const vals = await form.validateFields();
    try {
      const created = await createForm({ form_id: vals.form_id, title: vals.title, grid_columns: 2, fields: [], submit: {} });
      setOpen(false);
      form.resetFields();
      nav(`/forms/${created.id}`);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || 'Ошибка создания');
    }
  }

  async function doExport(pk: string, formId: string) {
    const schema = await exportForm(pk);
    const blob = new Blob([JSON.stringify(schema, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${formId}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function doImport(file: File) {
    try {
      const created = await importForm(JSON.parse(await file.text()));
      message.success(`Импортирована форма ${created.form_id}`);
      nav(`/forms/${created.id}`);
    } catch (e: any) {
      message.error('Не удалось импортировать: ' + (e?.message || 'ошибка JSON'));
    }
    return false;
  }

  const columns = useMemo(() => [
    {
      title: 'Название', dataIndex: 'title',
      render: (t: string, r: FormSchema) => (
        <Space direction="vertical" size={0}>
          <a onClick={() => nav(`/forms/${r.id}`)}>{t}</a>
          <Tag color="blue" style={{ fontFamily: 'monospace' }}>{r.form_id}</Tag>
        </Space>
      ),
    },
    {
      title: 'Статус', dataIndex: 'status', width: 150,
      render: (s: string, r: FormSchema) => (
        <Space direction="vertical" size={2}>
          <Tag color={STATUS_META[s || 'draft']?.color}>{STATUS_META[s || 'draft']?.label}</Tag>
          {r.has_draft_changes && r.published_version
            ? <Tooltip title="Есть неопубликованные изменения"><Tag color="orange" style={{ fontSize: 11 }}>черновик изменён</Tag></Tooltip>
            : null}
        </Space>
      ),
    },
    {
      title: 'Версия', width: 90,
      render: (_: any, r: FormSchema) => r.published_version ? <Tag>v{r.published_version}</Tag> : '—',
    },
    {
      title: 'Заполнений', dataIndex: 'submission_count', width: 110,
      render: (c: number) => <Badge count={c} showZero color="#1677ff" overflowCount={9999} />,
    },
    {
      title: 'Обновлена', dataIndex: 'updated_at', width: 160,
      render: (v: string) => v ? new Date(v).toLocaleString('ru-RU') : '—',
    },
    {
      title: '', width: 260,
      render: (_: any, r: FormSchema) => (
        <Space wrap>
          <Button size="small" type="primary" ghost
            disabled={!r.has_draft_changes && !!r.published_version}
            onClick={async () => { await publishForm(r.id!); message.success('Опубликовано'); load(); }}>
            Опубликовать
          </Button>
          <Button size="small" icon={<DownloadOutlined />} onClick={() => doExport(r.id!, r.form_id)} />
          {r.status === 'archived'
            ? <Button size="small" onClick={async () => { await setFormStatus(r.id!, 'published').catch(() => setFormStatus(r.id!, 'draft')); load(); }}>Вернуть</Button>
            : <Button size="small" onClick={async () => { await setFormStatus(r.id!, 'archived'); load(); }}>В архив</Button>}
          <Button size="small" danger onClick={async () => { await deleteForm(r.id!); load(); }}>Удалить</Button>
        </Space>
      ),
    },
  ], [nav, load]);

  return (
    <Card
      title="Реестр форм"
      extra={
        <Space>
          <Upload accept=".json" showUploadList={false} beforeUpload={doImport}>
            <Button icon={<UploadOutlined />}>Импорт JSON</Button>
          </Upload>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Новая форма</Button>
        </Space>
      }
    >
      <Space style={{ marginBottom: 16 }} wrap>
        <Input
          allowClear prefix={<SearchOutlined />} placeholder="Поиск по названию или form-id"
          style={{ width: 320 }} value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
        />
        <Segmented
          value={status}
          onChange={(v) => { setStatus(v as string); setPage(1); }}
          options={[
            { label: 'Все', value: 'all' },
            { label: 'Опубликованные', value: 'published' },
            { label: 'Черновики', value: 'draft' },
            { label: 'Архив', value: 'archived' },
          ]}
        />
      </Space>
      <Table
        rowKey="id"
        dataSource={rows}
        columns={columns as any}
        pagination={{ current: page, pageSize, total, onChange: setPage, showTotal: (t) => `Всего: ${t}` }}
      />

      <Modal title="Новая форма" open={open} onOk={onCreate} onCancel={() => setOpen(false)} okText="Создать">
        <AntForm form={form} layout="vertical">
          <AntForm.Item name="title" label="Название" rules={[{ required: true }]}>
            <Input placeholder="Оформление заказа" />
          </AntForm.Item>
          <AntForm.Item name="form_id" label="form-id (глобальный slug для встраивания)"
            rules={[{ required: true, pattern: /^[a-z0-9_]+$/, message: 'Только a-z, 0-9, _' } as any]}>
            <Input placeholder="order_form" />
          </AntForm.Item>
        </AntForm>
      </Modal>
    </Card>
  );
}
