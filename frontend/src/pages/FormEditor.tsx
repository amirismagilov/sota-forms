import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CloudUploadOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  HistoryOutlined,
  PlusOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import {
  App,
  Button,
  Card,
  Col,
  Drawer,
  Form as AntForm,
  Input,
  InputNumber,
  List,
  Row,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  getDictOptions, getForm, getTheme, listDictionaries, listVersions, publishForm, rollbackForm, updateForm, uploadFile,
} from '../api';
import { extractRefs } from '../renderer/engine';
import type { Dictionary, Field, FormSchema, FormVersionInfo } from '../types';
import ThemedForm from '../widget/ThemedForm';
import { FIELD_TYPE_GROUPS, MASK_PRESETS, OPERATORS } from './fieldTypes';

const LAYOUT_TYPES = ['section_header', 'divider', 'info_text'];
const DICT_TYPES = ['dict_select', 'dict_radio', 'dict_checkbox'];
const STATIC_OPT_TYPES = ['select_static', 'radio_group'];

let idCounter = 0;
function newFieldId() {
  idCounter += 1;
  return `f_${Date.now().toString(36)}_${idCounter}`;
}

export default function FormEditor() {
  const { pk } = useParams();
  const { message } = App.useApp();
  const [form, setForm] = useState<FormSchema | null>(null);
  const [dicts, setDicts] = useState<Dictionary[]>([]);
  const [tokens, setTokens] = useState<Record<string, any>>({});
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [fieldForm] = AntForm.useForm();
  const [highlight, setHighlight] = useState<string | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<FormVersionInfo[]>([]);

  useEffect(() => {
    if (!pk) return;
    getForm(pk).then(setForm);
    listDictionaries().then(setDicts).catch(() => {});
    getTheme().then((t) => setTokens(t.design_tokens?.token || {})).catch(() => {});
  }, [pk]);

  const editType = AntForm.useWatch('type', fieldForm);

  if (!form) return <Card loading />;

  const otherFields = form.fields.filter((_, i) => i !== editIndex);

  function openEditor(index: number | null) {
    if (index === null) {
      const f: Field = { id: newFieldId(), type: 'text', label: 'Новое поле', gridSpan: 1 };
      setForm({ ...form!, fields: [...form!.fields, f] });
      setEditIndex(form!.fields.length);
      fieldForm.setFieldsValue(fieldToForm(f));
    } else {
      setEditIndex(index);
      fieldForm.setFieldsValue(fieldToForm(form!.fields[index]));
    }
  }

  function applyField() {
    fieldForm.validateFields().then((vals) => {
      const merged = formToField(vals, form!.fields[editIndex!]);
      const next = [...form!.fields];
      next[editIndex!] = merged;
      setForm({ ...form!, fields: next });
      setEditIndex(null);
    });
  }

  function removeField(i: number) {
    const next = form!.fields.filter((_, idx) => idx !== i);
    setForm({ ...form!, fields: next });
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= form!.fields.length) return;
    const next = [...form!.fields];
    [next[i], next[j]] = [next[j], next[i]];
    setForm({ ...form!, fields: next });
  }

  async function save() {
    try {
      const saved = await updateForm(pk!, {
        form_id: form!.form_id,
        title: form!.title,
        grid_columns: form!.grid_columns,
        fields: form!.fields,
        submit: form!.submit,
      });
      setForm(saved);
      message.success('Черновик сохранён');
    } catch (e: any) {
      message.error(e?.response?.data?.detail || 'Ошибка сохранения');
    }
  }

  async function publish() {
    try {
      // Persist current draft first, then publish an immutable snapshot.
      await updateForm(pk!, {
        form_id: form!.form_id, title: form!.title, grid_columns: form!.grid_columns,
        fields: form!.fields, submit: form!.submit,
      });
      const pub = await publishForm(pk!);
      setForm(pub);
      message.success('Опубликовано: v' + pub.version);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || 'Ошибка публикации');
    }
  }

  async function openVersions() {
    setVersionsOpen(true);
    setVersions(await listVersions(pk!).catch(() => []));
  }

  async function doRollback(v: number) {
    const restored = await rollbackForm(pk!, v);
    setForm(restored);
    setVersionsOpen(false);
    message.success(`Версия v${v} восстановлена в черновик — опубликуйте, чтобы сделать её живой`);
  }

  return (
    <Row gutter={16}>
      <Col span={13}>
        <Card
          title={<Input variant="borderless" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={{ fontWeight: 600, fontSize: 16 }} />}
          extra={
            <Space>
              <Button icon={<HistoryOutlined />} onClick={openVersions}>Версии</Button>
              <Button icon={<SaveOutlined />} onClick={save}>Сохранить черновик</Button>
              <Button type="primary" icon={<CloudUploadOutlined />} onClick={publish}>Опубликовать</Button>
            </Space>
          }
          styles={{ body: { maxHeight: '72vh', overflow: 'auto' } }}
        >
          <Space wrap style={{ marginBottom: 12 }}>
            <span>form-id: <Tag color="blue">{form.form_id}</Tag></span>
            <Tag color={form.status === 'published' ? 'green' : form.status === 'archived' ? 'red' : 'default'}>
              {form.status === 'published' ? `Опубликована v${form.published_version}` : form.status === 'archived' ? 'В архиве' : 'Черновик'}
            </Tag>
            {form.has_draft_changes && form.published_version
              ? <Tag color="orange">неопубликованные изменения</Tag> : null}
            <span>Колонок:
              <Segmented
                size="small"
                style={{ marginLeft: 8 }}
                value={form.grid_columns}
                options={[1, 2, 3]}
                onChange={(v) => setForm({ ...form, grid_columns: Number(v) })}
              />
            </span>
          </Space>
          <div>
            {form.fields.map((f, i) => (
              <FieldRow
                key={f.id}
                field={f}
                highlight={highlight === f.id}
                onEdit={() => openEditor(i)}
                onDelete={() => removeField(i)}
                onUp={() => move(i, -1)}
                onDown={() => move(i, 1)}
                onBadgeClick={(target: string) => { setHighlight(target); setTimeout(() => setHighlight(null), 1500); }}
                onCopyId={() => { navigator.clipboard?.writeText(f.id); message.success('ID скопирован: ' + f.id); }}
              />
            ))}
          </div>
          <Button block icon={<PlusOutlined />} onClick={() => openEditor(null)} style={{ marginTop: 8 }}>
            Добавить поле
          </Button>

          <Card size="small" title="Отправка (webhook)" style={{ marginTop: 16 }}>
            <AntForm layout="vertical">
              <AntForm.Item label="Webhook URL">
                <Input value={form.submit?.webhookUrl} placeholder="http://backend:8000/api/mock/webhook"
                  onChange={(e) => setForm({ ...form, submit: { ...form.submit, webhookUrl: e.target.value } })} />
              </AntForm.Item>
              <AntForm.Item label="Сообщение об успехе">
                <Input value={form.submit?.successMessage}
                  onChange={(e) => setForm({ ...form, submit: { ...form.submit, successMessage: e.target.value } })} />
              </AntForm.Item>
            </AntForm>
          </Card>
        </Card>
      </Col>

      <Col span={11}>
        <Card title="Живой предпросмотр" styles={{ body: { maxHeight: '78vh', overflow: 'auto' } }}>
          <ThemedForm
            schema={{ fields: form.fields, grid_columns: form.grid_columns, submit: form.submit, title: form.title }}
            dictionaries={dicts}
            tokens={{ token: tokens }}
            apiDictLoader={getDictOptions}
            fileUpload={uploadFile}
            showTitle={false}
          />
        </Card>
      </Col>

      <Drawer
        title={editIndex !== null ? 'Настройка поля' : ''}
        open={editIndex !== null}
        width={460}
        onClose={() => setEditIndex(null)}
        extra={<Button type="primary" onClick={applyField}>Применить</Button>}
        destroyOnClose
      >
        <AntForm form={fieldForm} layout="vertical">
          <AntForm.Item name="type" label="Тип поля" rules={[{ required: true }]}>
            <Select options={FIELD_TYPE_GROUPS} />
          </AntForm.Item>
          <AntForm.Item name="label" label={LAYOUT_TYPES.includes(editType) ? 'Текст' : 'Заголовок'} rules={[{ required: true }]}>
            <Input />
          </AntForm.Item>
          <AntForm.Item name="id" label="ID поля">
            <Input />
          </AntForm.Item>

          {!LAYOUT_TYPES.includes(editType) && (
            <>
              <Row gutter={12}>
                <Col span={12}>
                  <AntForm.Item name="gridSpan" label="Ширина (колонок)">
                    <Select options={[{ label: '1', value: 1 }, { label: '2', value: 2 }, { label: '3', value: 3 }]} />
                  </AntForm.Item>
                </Col>
                <Col span={12}>
                  <AntForm.Item name="required" label="Обязательное" valuePropName="checked">
                    <Switch />
                  </AntForm.Item>
                </Col>
              </Row>
              <AntForm.Item name="placeholder" label="Placeholder"><Input /></AntForm.Item>
              <AntForm.Item name="hint" label="Подсказка под полем"><Input /></AntForm.Item>
              <AntForm.Item name="tooltip" label="Tooltip (иконка ?)"><Input /></AntForm.Item>
            </>
          )}

          {DICT_TYPES.includes(editType) && (
            <>
              <AntForm.Item name="dictionaryId" label="Справочник" rules={[{ required: true }]}>
                <Select options={dicts.map((d) => ({ label: `${d.name} (${d.code})`, value: d.id }))} />
              </AntForm.Item>
              <AntForm.Item name="dictDisplay" label="Отображение">
                <Select options={[{ label: 'Список', value: 'select' }, { label: 'Радио', value: 'radio' }, { label: 'Чекбоксы', value: 'checkbox' }]} />
              </AntForm.Item>
              <AntForm.Item name="showExtra" label="Показывать атрибуты значения" valuePropName="checked"><Switch /></AntForm.Item>
            </>
          )}

          {STATIC_OPT_TYPES.includes(editType) && (
            <AntForm.List name="options">
              {(fields, { add, remove }) => (
                <Card size="small" title="Варианты" style={{ marginBottom: 12 }}>
                  {fields.map((fld) => (
                    <Space key={fld.key} align="baseline" style={{ display: 'flex', marginBottom: 4 }}>
                      <AntForm.Item {...fld} name={[fld.name, 'label']} noStyle><Input placeholder="Название" /></AntForm.Item>
                      <AntForm.Item {...fld} name={[fld.name, 'value']} noStyle><Input placeholder="значение" /></AntForm.Item>
                      <DeleteOutlined onClick={() => remove(fld.name)} />
                    </Space>
                  ))}
                  <Button size="small" onClick={() => add({ label: '', value: '' })} icon={<PlusOutlined />}>Добавить</Button>
                </Card>
              )}
            </AntForm.List>
          )}

          {editType === 'calculated' && (
            <>
              <AntForm.Item name="formula" label="Формула" extra="Ссылки: {{f_price}} · атрибут: {{f_delivery.cost}}">
                <Input.TextArea rows={2} placeholder="{{f_price}} * {{f_qty}}" />
              </AntForm.Item>
              <FieldChips fields={otherFields} dicts={dicts} onInsert={(t) => {
                const cur = fieldForm.getFieldValue('formula') || '';
                fieldForm.setFieldValue('formula', cur + t);
              }} />
              <Row gutter={12}>
                <Col span={8}><AntForm.Item name="calcPrefix" label="Префикс"><Input /></AntForm.Item></Col>
                <Col span={8}><AntForm.Item name="calcSuffix" label="Суффикс"><Input /></AntForm.Item></Col>
                <Col span={8}><AntForm.Item name="calcDecimals" label="Знаков"><InputNumber min={0} max={6} style={{ width: '100%' }} /></AntForm.Item></Col>
              </Row>
            </>
          )}

          {(['text', 'textarea', 'phone', 'inn', 'snils', 'passport', 'bik', 'kpp', 'ogrn', 'card'].includes(editType)) && (
            <Row gutter={12}>
              <Col span={12}><AntForm.Item name={['validation', 'minLength']} label="Мин. длина"><InputNumber style={{ width: '100%' }} /></AntForm.Item></Col>
              <Col span={12}><AntForm.Item name={['validation', 'maxLength']} label="Макс. длина"><InputNumber style={{ width: '100%' }} /></AntForm.Item></Col>
            </Row>
          )}
          {['number', 'amount', 'slider'].includes(editType) && (
            <Row gutter={12}>
              <Col span={12}><AntForm.Item name={['validation', 'min']} label="Мин."><InputNumber style={{ width: '100%' }} /></AntForm.Item></Col>
              <Col span={12}><AntForm.Item name={['validation', 'max']} label="Макс."><InputNumber style={{ width: '100%' }} /></AntForm.Item></Col>
            </Row>
          )}

          {['file', 'image'].includes(editType) && (
            <Card size="small" title="Валидация файлов" style={{ marginBottom: 12 }}>
              <AntForm.Item name={['fileValidation', 'extensions']} label="Расширения"><Input placeholder=".pdf,.jpg,.png" /></AntForm.Item>
              <Row gutter={12}>
                <Col span={12}><AntForm.Item name={['fileValidation', 'maxSize']} label="Макс. размер (МБ)"><InputNumber style={{ width: '100%' }} /></AntForm.Item></Col>
                <Col span={12}><AntForm.Item name={['fileValidation', 'maxCount']} label="Макс. кол-во"><InputNumber style={{ width: '100%' }} /></AntForm.Item></Col>
              </Row>
              {editType === 'image' && (
                <Row gutter={12}>
                  <Col span={6}><AntForm.Item name={['fileValidation', 'minWidth']} label="Мин. W"><InputNumber style={{ width: '100%' }} /></AntForm.Item></Col>
                  <Col span={6}><AntForm.Item name={['fileValidation', 'maxWidth']} label="Макс. W"><InputNumber style={{ width: '100%' }} /></AntForm.Item></Col>
                  <Col span={6}><AntForm.Item name={['fileValidation', 'minHeight']} label="Мин. H"><InputNumber style={{ width: '100%' }} /></AntForm.Item></Col>
                  <Col span={6}><AntForm.Item name={['fileValidation', 'maxHeight']} label="Макс. H"><InputNumber style={{ width: '100%' }} /></AntForm.Item></Col>
                </Row>
              )}
              <AntForm.Item name={['fileValidation', 'errorMsg']} label="Сообщение об ошибке"><Input /></AntForm.Item>
            </Card>
          )}

          {!LAYOUT_TYPES.includes(editType) && (
            <>
              <Typography.Text strong>Условие видимости (visibleIf)</Typography.Text>
              <ConditionEditor prefix="visibleIf" fields={otherFields} form={fieldForm} />
              <Typography.Text strong>Условие обязательности (requiredIf)</Typography.Text>
              <ConditionEditor prefix="requiredIf" fields={otherFields} form={fieldForm} />
            </>
          )}
        </AntForm>
      </Drawer>

      <Drawer title="История версий" open={versionsOpen} width={420} onClose={() => setVersionsOpen(false)}>
        <Typography.Paragraph type="secondary">
          Каждая публикация создаёт неизменяемый снимок схемы. Виджет отдаёт опубликованную версию,
          а не черновик. Откат восстанавливает выбранную версию в черновик — опубликуйте её, чтобы сделать живой.
        </Typography.Paragraph>
        <List
          dataSource={versions}
          locale={{ emptyText: 'Пока нет опубликованных версий' }}
          renderItem={(v) => (
            <List.Item
              actions={[
                <Button key="rb" size="small" onClick={() => doRollback(v.version)}>Откатить</Button>,
              ]}
            >
              <List.Item.Meta
                title={<Space>v{v.version}{v.is_published && <Tag color="green">живая</Tag>}</Space>}
                description={
                  <span style={{ fontSize: 12 }}>
                    {v.title} · {v.field_count} полей · {new Date(v.created_at).toLocaleString('ru-RU')}
                    {v.note ? ` · ${v.note}` : ''}
                  </span>
                }
              />
            </List.Item>
          )}
        />
      </Drawer>
    </Row>
  );
}

// ---- Field row with dependency badges ----
function FieldRow({ field, highlight, onEdit, onDelete, onUp, onDown, onBadgeClick, onCopyId }: any) {
  const f: Field = field;
  const isLayout = LAYOUT_TYPES.includes(f.type);
  const badges: React.ReactNode[] = [];
  if (f.visibleIf?.fieldId && f.requiredIf?.fieldId)
    badges.push(<Tag key="both" color="purple" style={{ cursor: 'pointer' }} onClick={() => onBadgeClick(f.visibleIf!.fieldId)}>vis+req</Tag>);
  else {
    if (f.visibleIf?.fieldId) badges.push(<Tag key="v" color="gold" style={{ cursor: 'pointer' }} onClick={() => onBadgeClick(f.visibleIf!.fieldId)}>видимость</Tag>);
    if (f.requiredIf?.fieldId) badges.push(<Tag key="r" color="magenta" style={{ cursor: 'pointer' }} onClick={() => onBadgeClick(f.requiredIf!.fieldId)}>обязат.</Tag>);
  }
  if (f.type === 'calculated' && f.formula) {
    const refs = extractRefs(f.formula);
    if (refs.length) badges.push(<Tag key="f" color="blue" style={{ cursor: 'pointer' }} onClick={() => onBadgeClick(refs[0].fieldId)}>формула →{refs.length}</Tag>);
  }
  return (
    <div style={{
      border: '1px solid ' + (highlight ? '#1677ff' : '#f0f0f0'),
      boxShadow: highlight ? '0 0 0 2px rgba(22,119,255,0.2)' : 'none',
      borderRadius: 8, padding: '8px 12px', marginBottom: 8, background: isLayout ? '#fafafa' : '#fff',
      transition: 'all .2s',
    }}>
      <Row align="middle" justify="space-between">
        <Col flex="auto">
          <Space size={6} wrap>
            <Typography.Text strong={!isLayout} type={isLayout ? 'secondary' : undefined}>{f.label || '(без названия)'}</Typography.Text>
            <Tag>{f.type}</Tag>
            <Tag style={{ cursor: 'pointer', fontFamily: 'monospace' }} onClick={onCopyId} icon={<CopyOutlined />}>{f.id}</Tag>
            {f.required && <Tag color="red">*</Tag>}
            {badges}
          </Space>
        </Col>
        <Col>
          <Space size={2}>
            <Button size="small" type="text" icon={<ArrowUpOutlined />} onClick={onUp} />
            <Button size="small" type="text" icon={<ArrowDownOutlined />} onClick={onDown} />
            <Button size="small" type="text" icon={<EditOutlined />} onClick={onEdit} />
            <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={onDelete} />
          </Space>
        </Col>
      </Row>
    </div>
  );
}

function ConditionEditor({ prefix, fields, form }: { prefix: string; fields: Field[]; form: any }) {
  const fid = AntForm.useWatch([prefix, 'fieldId'], form);
  const op = AntForm.useWatch([prefix, 'operator'], form);
  return (
    <Row gutter={8} style={{ marginBottom: 8 }}>
      <Col span={9}>
        <AntForm.Item name={[prefix, 'fieldId']} noStyle>
          <Select allowClear placeholder="поле" options={fields.map((f) => ({ label: f.id, value: f.id }))} style={{ width: '100%' }} />
        </AntForm.Item>
      </Col>
      <Col span={7}>
        <AntForm.Item name={[prefix, 'operator']} noStyle>
          <Select placeholder="оператор" options={OPERATORS} disabled={!fid} style={{ width: '100%' }} />
        </AntForm.Item>
      </Col>
      <Col span={8}>
        <AntForm.Item name={[prefix, 'value']} noStyle>
          <Input placeholder="значение" disabled={!fid || ['empty', 'not_empty'].includes(op)} />
        </AntForm.Item>
      </Col>
    </Row>
  );
}

function FieldChips({ fields, dicts, onInsert }: { fields: Field[]; dicts: Dictionary[]; onInsert: (t: string) => void }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>Поля:</Typography.Text>
      <div style={{ marginTop: 4 }}>
        {fields.filter((f) => !LAYOUT_TYPES.includes(f.type)).map((f) => (
          <Tag key={f.id} color="blue" style={{ cursor: 'pointer', marginBottom: 4 }} onClick={() => onInsert(`{{${f.id}}}`)}>{f.id}</Tag>
        ))}
        {fields.filter((f) => f.dictionaryId).flatMap((f) => {
          const d = dicts.find((x) => x.id === f.dictionaryId);
          return (d?.attrs || []).map((a) => (
            <Tag key={f.id + a.name} color="green" style={{ cursor: 'pointer', marginBottom: 4 }} onClick={() => onInsert(`{{${f.id}.${a.name}}}`)}>{f.id}.{a.name}</Tag>
          ));
        })}
      </div>
    </div>
  );
}

// ---- field <-> form mapping ----
function fieldToForm(f: Field): any {
  return {
    ...f,
    gridSpan: f.gridSpan || 1,
    dictDisplay: f.dictDisplay || 'select',
    visibleIf: f.visibleIf || {},
    requiredIf: f.requiredIf || {},
    validation: f.validation || {},
    options: f.options || [],
    calcDecimals: f.calcDecimals ?? 2,
  };
}

function formToField(vals: any, prev: Field): Field {
  const out: Field = { ...prev, ...vals };
  // Auto-apply mask regex for special types.
  if (MASK_PRESETS[vals.type]) {
    out.mask = { preset: vals.type, regex: MASK_PRESETS[vals.type].regex };
  }
  if (!vals.visibleIf?.fieldId) delete out.visibleIf;
  if (!vals.requiredIf?.fieldId) delete out.requiredIf;
  if (vals.validation && Object.values(vals.validation).every((x) => x === undefined || x === null)) delete out.validation;
  return out;
}
