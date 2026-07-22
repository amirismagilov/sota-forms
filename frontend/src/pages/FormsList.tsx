import { DownloadOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { App, Button, Card, Empty, Modal, Form as AntForm, Input, Space, Table, Tag, Upload } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createForm, deleteForm, exportForm, importForm, listForms } from '../api';
import type { FormSchema } from '../types';

export default function FormsList() {
  const [forms, setForms] = useState<FormSchema[]>([]);
  const [open, setOpen] = useState(false);
  const [form] = AntForm.useForm();
  const nav = useNavigate();
  const { message } = App.useApp();

  const load = () => listForms().then(setForms).catch(() => setForms([]));
  useEffect(() => { load(); }, []);

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
      const text = await file.text();
      const created = await importForm(JSON.parse(text));
      message.success(`Импортирована форма ${created.form_id}`);
      nav(`/forms/${created.id}`);
    } catch (e: any) {
      message.error('Не удалось импортировать: ' + (e?.message || 'ошибка JSON'));
    }
    return false;
  }

  return (
    <Card
      title="Формы"
      extra={
        <Space>
          <Upload accept=".json" showUploadList={false} beforeUpload={doImport}>
            <Button icon={<UploadOutlined />}>Импорт JSON</Button>
          </Upload>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Новая форма</Button>
        </Space>
      }
    >
      {forms.length === 0 ? (
        <Empty description="Пока нет форм" />
      ) : (
        <Table
          rowKey="id"
          dataSource={forms}
          pagination={false}
          columns={[
            { title: 'Название', dataIndex: 'title' },
            { title: 'form-id', dataIndex: 'form_id', render: (v) => <Tag color="blue">{v}</Tag> },
            { title: 'Версия', dataIndex: 'version', width: 90 },
            { title: 'Полей', render: (_, r) => r.fields?.length ?? 0, width: 80 },
            {
              title: '',
              width: 200,
              render: (_, r) => (
                <Space>
                  <Button size="small" onClick={() => nav(`/forms/${r.id}`)}>Редактор</Button>
                  <Button size="small" icon={<DownloadOutlined />} onClick={() => doExport(r.id!, r.form_id)}>JSON</Button>
                  <Button size="small" danger onClick={async () => { await deleteForm(r.id!); load(); }}>Удалить</Button>
                </Space>
              ),
            },
          ]}
        />
      )}
      <Modal title="Новая форма" open={open} onOk={onCreate} onCancel={() => setOpen(false)} okText="Создать">
        <AntForm form={form} layout="vertical">
          <AntForm.Item name="title" label="Название" rules={[{ required: true }]}>
            <Input placeholder="Оформление заказа" />
          </AntForm.Item>
          <AntForm.Item name="form_id" label="form-id (slug для встраивания)" rules={[{ required: true, pattern: /^[a-z0-9_]+$/, message: 'Только a-z, 0-9, _' } as any]}>
            <Input placeholder="order_form" />
          </AntForm.Item>
        </AntForm>
      </Modal>
    </Card>
  );
}
