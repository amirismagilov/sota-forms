import { CloudDownloadOutlined, InboxOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  Alert, App, Button, Checkbox, Collapse, Descriptions, Divider, Form as AntForm, Input, List, Modal,
  Segmented, Select, Space, Spin, Tag, Tooltip, Typography, Upload,
} from 'antd';
import { useCallback, useEffect, useState } from 'react';
import {
  operatonForms, operatonImport, operatonPreview, operatonProcesses, operatonStatus, operatonSync,
  type OperatonImportBody, type OperatonStatus, type OperatonSyncResult,
} from '../api';
import FormRenderer from '../renderer/FormRenderer';
import type { OperatonFormSummary, OperatonPreview, OperatonProcess } from '../types';

type Mode = 'catalog' | 'file';

/** Import a form from Operaton: pull it from the sota-bpmn catalogue or upload a .form file. */
export default function OperatonImportModal({
  open, onClose, onImported, onBulkImported,
}: {
  open: boolean;
  onClose: () => void;
  /** Single form imported — the caller usually opens it in the editor. */
  onImported: (pk: string) => void;
  /** Bulk sync finished — the caller just refreshes the registry. */
  onBulkImported?: () => void;
}) {
  const { message } = App.useApp();
  const [mode, setMode] = useState<Mode>('catalog');
  const [status, setStatus] = useState<OperatonStatus | null>(null);
  const [processes, setProcesses] = useState<OperatonProcess[]>([]);
  const [forms, setForms] = useState<OperatonFormSummary[]>([]);
  const [process, setProcess] = useState<string | undefined>();
  const [operatonFormId, setOperatonFormId] = useState<string | undefined>();
  const [uploaded, setUploaded] = useState<any | null>(null);
  const [preview, setPreview] = useState<OperatonPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<OperatonSyncResult | null>(null);
  const [publishOnSync, setPublishOnSync] = useState(false);
  const [form] = AntForm.useForm();

  const reset = useCallback(() => {
    setPreview(null); setError(null); setUploaded(null); setOperatonFormId(undefined);
    setSyncResult(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    reset();
    setLoading(true);
    operatonStatus()
      .then((s) => {
        setStatus(s);
        if (!s.ok) { setMode('file'); return []; }
        return operatonProcesses();
      })
      .then((items) => setProcesses(items || []))
      .catch(() => setStatus({ ok: false, configured: false, message: 'Не удалось проверить связь с sota-bpmn' }))
      .finally(() => setLoading(false));
  }, [open, reset]);

  useEffect(() => {
    if (!open || mode !== 'catalog' || !status?.ok) return;
    setLoading(true);
    operatonForms(process)
      .then((items) => setForms(items || []))
      .catch(() => setForms([]))
      .finally(() => setLoading(false));
  }, [open, mode, process, status?.ok]);

  async function runPreview(body: OperatonImportBody) {
    setLoading(true); setError(null); setPreview(null);
    try {
      const p = await operatonPreview(body);
      setPreview(p);
      form.setFieldsValue({ title: p.title, form_id: p.form_id });
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Не удалось разобрать форму');
    } finally {
      setLoading(false);
    }
  }

  async function onFile(file: File) {
    try {
      const schema = JSON.parse(await file.text());
      setUploaded(schema);
      await runPreview({ schema });
    } catch {
      setError('Файл не является корректным JSON');
    }
    return false;
  }

  async function doSync() {
    setSyncing(true); setError(null); setSyncResult(null); setPreview(null);
    try {
      setSyncResult(await operatonSync({ process_key: process, publish: publishOnSync }));
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Не удалось загрузить формы');
    } finally {
      setSyncing(false);
    }
  }

  async function doImport() {
    const vals = await form.validateFields();
    setImporting(true);
    try {
      const body: OperatonImportBody = uploaded
        ? { schema: uploaded, ...vals }
        : { operaton_form_id: operatonFormId, process_key: process, ...vals };
      const created = await operatonImport(body);
      message.success(`Импортирована форма ${created.form_id}`);
      onImported(created.id!);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Ошибка импорта');
    } finally {
      setImporting(false);
    }
  }

  const report = preview?.report;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={880}
      title="Импорт формы из Оператона"
      footer={
        syncResult
          ? [
            <Button key="more" onClick={() => setSyncResult(null)}>Загрузить ещё</Button>,
            <Button key="done" type="primary" onClick={() => (onBulkImported ?? onClose)()}>Готово</Button>,
          ]
          : [
            <Button key="c" onClick={onClose}>Отмена</Button>,
            <Button key="ok" type="primary" disabled={!preview} loading={importing} onClick={doImport}>
              Импортировать
            </Button>,
          ]
      }
    >
      <Segmented
        block
        value={mode}
        onChange={(v) => { setMode(v as Mode); reset(); }}
        options={[
          { label: 'Из каталога sota-bpmn', value: 'catalog', disabled: !status?.ok },
          { label: 'Из файла .form', value: 'file' },
        ]}
        style={{ marginBottom: 16 }}
      />

      {status && !status.ok && (
        <Alert
          type={status.configured ? 'warning' : 'info'}
          showIcon
          style={{ marginBottom: 16 }}
          message={status.configured ? 'sota-bpmn недоступен' : 'Интеграция с sota-bpmn не настроена'}
          description={<>{status.message}. Импорт из файла работает без неё.</>}
        />
      )}

      {mode === 'catalog' ? (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Space wrap>
            <Select
              style={{ width: 300 }} allowClear placeholder="Процесс (все)"
              value={process} onChange={(v) => { setProcess(v); reset(); }}
              options={processes.map((p) => ({ label: `${p.name} (${p.process_id})`, value: p.process_id }))}
            />
            <Select
              style={{ width: 380 }} placeholder="Форма процесса" value={operatonFormId}
              onChange={(v) => { setOperatonFormId(v); setUploaded(null); runPreview({ operaton_form_id: v, process_key: process }); }}
              options={forms.map((f) => ({ label: f.name ? `${f.name} — ${f.id}` : f.id, value: f.id }))}
              notFoundContent={loading ? <Spin size="small" /> : 'Формы не найдены'}
            />
            <Button icon={<ReloadOutlined />} onClick={() => setProcess(process)} />
          </Space>

          <Alert
            type="info"
            message={
              <Space wrap>
                <span>
                  Или загрузите <b>все формы {process ? 'процесса' : 'всех процессов'}</b> сразу
                  {forms.length ? ` (${forms.length} шт.)` : ''}
                </span>
                <Tooltip title="Уже импортированные формы будут пропущены — правки в них не затираются">
                  <Button
                    type="primary" ghost icon={<CloudDownloadOutlined />}
                    loading={syncing} disabled={!forms.length}
                    onClick={doSync}
                  >
                    Загрузить все
                  </Button>
                </Tooltip>
                <Checkbox checked={publishOnSync} onChange={(e) => setPublishOnSync(e.target.checked)}>
                  <Tooltip title="Опубликованная форма сразу заменяет форму Оператона в задачах. Без галочки формы приедут черновиками — их можно проверить и опубликовать вручную.">
                    сразу опубликовать
                  </Tooltip>
                </Checkbox>
              </Space>
            }
          />
        </Space>
      ) : (
        <Upload.Dragger accept=".form,.json" showUploadList={false} beforeUpload={onFile}>
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">Перетащите сюда файл .form из Оператона</p>
          <p className="ant-upload-hint">Схема form-js (Camunda Forms JSON)</p>
        </Upload.Dragger>
      )}

      {loading && <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>}
      {error && <Alert type="error" showIcon style={{ marginTop: 16 }} message={error} />}

      {syncResult && (
        <>
          <Divider />
          <Alert
            style={{ marginBottom: 12 }}
            type={syncResult.failed ? 'warning' : 'success'}
            showIcon
            message={
              syncResult.message
                ? syncResult.message
                : `Импортировано: ${syncResult.imported} · пропущено: ${syncResult.skipped} · с ошибкой: ${syncResult.failed}`
            }
          />
          <List
            size="small"
            bordered
            style={{ maxHeight: 300, overflow: 'auto' }}
            dataSource={syncResult.items}
            renderItem={(it) => (
              <List.Item
                actions={it.id ? [<a key="o" onClick={() => onImported(it.id!)}>открыть</a>] : []}
              >
                <Space direction="vertical" size={0} style={{ width: '100%' }}>
                  <Space wrap size={6}>
                    {it.status === 'imported' && <Tag color="green">импортирована</Tag>}
                    {it.status === 'skipped' && <Tag>пропущена</Tag>}
                    {it.status === 'failed' && <Tag color="red">ошибка</Tag>}
                    <b>{it.title || it.form_id || it.operaton_form_id}</b>
                    {it.published ? <Tag color="blue">опубликована</Tag> : null}
                    {it.warnings ? <Tag color="orange">{it.warnings} замечаний</Tag> : null}
                    {it.unsupported ? <Tag color="red">{it.unsupported} не перенесено</Tag> : null}
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace' }}>
                    {it.operaton_form_id}{it.detail ? ` — ${it.detail}` : ''}
                  </Typography.Text>
                </Space>
              </List.Item>
            )}
          />
        </>
      )}

      {preview && report && (
        <>
          <Divider />
          <Descriptions size="small" column={2} style={{ marginBottom: 12 }}>
            <Descriptions.Item label="Форма в Оператоне">
              <Tag style={{ fontFamily: 'monospace' }}>{preview.operaton_form_id}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Процесс">
              {preview.process_key ? <Tag color="purple">{preview.process_key}</Tag> : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Компонентов" span={2}>
              Распознано {report.components_total}, перенесено полей {report.fields_total ?? preview.fields.length},
              предупреждений {report.warnings.length}, не поддержано {report.unsupported.length}
            </Descriptions.Item>
          </Descriptions>

          {(report.warnings.length > 0 || report.unsupported.length > 0) && (
            <Collapse
              size="small"
              style={{ marginBottom: 12 }}
              items={[{
                key: 'w',
                label: `Требует внимания: ${report.warnings.length + report.unsupported.length}`,
                children: (
                  <>
                    {report.unsupported.map((u, i) => (
                      <div key={`u${i}`}>
                        <Tag color="red">не перенесено</Tag>
                        <code>{u.key || '—'}</code> — компонент <code>{u.type}</code>
                      </div>
                    ))}
                    {report.warnings.map((w, i) => (
                      <div key={`w${i}`}>
                        <Tag color="orange">{w.code}</Tag>
                        {w.key ? <code>{w.key}</code> : null} {w.message}
                      </div>
                    ))}
                  </>
                ),
              }]}
            />
          )}

          <AntForm form={form} layout="vertical">
            <AntForm.Item
              name="title" label="Название"
              tooltip="В схеме Оператона названия формы нет — задайте своё"
              rules={[{ required: true, message: 'Задайте понятное название' }]}
            >
              <Input placeholder="Классификация обращения" />
            </AntForm.Item>
            <AntForm.Item
              name="form_id" label="form-id (ключ встраивания)"
              rules={[{ required: true, pattern: /^[a-z0-9_]+$/, message: 'Только a-z, 0-9, _' } as any]}
            >
              <Input />
            </AntForm.Item>
          </AntForm>

          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Предпросмотр</Typography.Text>
          <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 16, marginTop: 6, maxHeight: 320, overflow: 'auto' }}>
            <FormRenderer
              schema={{ fields: preview.fields, grid_columns: preview.grid_columns, submit: {}, title: '' }}
              dictionaries={[]}
              showTitle={false}
            />
          </div>
        </>
      )}
    </Modal>
  );
}
