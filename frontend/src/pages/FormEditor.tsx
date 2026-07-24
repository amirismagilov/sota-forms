import {
  AppstoreOutlined,
  CloudUploadOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  HistoryOutlined,
  PlusOutlined,
  SaveOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import {
  Alert,
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
  getDictOptions, getForm, getTheme, listConnections, listDictionaries, listVersions, probeSuggest,
  publishForm, rollbackForm, updateForm, uploadFile,
} from '../api';
import { extractRefs } from '../renderer/engine';
import type { Connection, Dictionary, Field, FormSchema, FormVersionInfo } from '../types';
import ThemedForm from '../widget/ThemedForm';
import { FIELD_TYPE_GROUPS, MASK_PRESETS, OPERATORS } from './fieldTypes';
import LayoutEditor, { ensureLayout } from './LayoutEditor';

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
  const [conns, setConns] = useState<Connection[]>([]);
  const [tokens, setTokens] = useState<Record<string, any>>({});
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [isNewField, setIsNewField] = useState(false);
  const [fieldForm] = AntForm.useForm();
  const [highlight, setHighlight] = useState<string | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<FormVersionInfo[]>([]);
  const [leftView, setLeftView] = useState<'fields' | 'layout'>('fields');
  const [suggestTest, setSuggestTest] = useState<any>(null);

  useEffect(() => {
    if (!pk) return;
    getForm(pk).then(setForm);
    listDictionaries().then(setDicts).catch(() => {});
    listConnections().then(setConns).catch(() => {});
    getTheme().then((t) => setTokens(t.design_tokens?.token || {})).catch(() => {});
  }, [pk]);

  const editType = AntForm.useWatch('type', fieldForm);

  if (!form) return <Card loading />;

  // Exclude the field being edited BY ID (index-based filtering broke when the
  // field's position didn't match editIndex, letting a field reference itself).
  const currentFieldId = editIndex !== null ? form.fields[editIndex]?.id : null;
  const otherFields = form.fields.filter((f) => f.id !== currentFieldId);

  function openEditor(index: number | null) {
    // Clear the shared editor form first, otherwise values from the previously
    // edited field (placeholder, dictDisplay, …) leak into this one and get saved.
    fieldForm.resetFields();
    if (index === null) {
      const f: Field = { id: newFieldId(), type: 'text', label: 'Новое поле', gridSpan: 1 };
      setForm({ ...form!, fields: [...form!.fields, f] });
      setEditIndex(form!.fields.length);
      setIsNewField(true);
      fieldForm.setFieldsValue(fieldToForm(f));
    } else {
      setEditIndex(index);
      setIsNewField(false);
      fieldForm.setFieldsValue(fieldToForm(form!.fields[index]));
    }
  }

  // Closing without «Применить» must discard a just-added field, otherwise an
  // empty «Новое поле» is left behind and resurfaces after save/reload.
  function closeEditor() {
    if (isNewField && editIndex !== null) {
      setForm({ ...form!, fields: form!.fields.filter((_, i) => i !== editIndex) });
    }
    setIsNewField(false);
    setEditIndex(null);
  }

  function applyField() {
    fieldForm.validateFields().then((vals) => {
      const merged = formToField(vals, form!.fields[editIndex!]);
      const next = [...form!.fields];
      next[editIndex!] = merged;
      setForm({ ...form!, fields: next });
      setIsNewField(false);
      setEditIndex(null);
    });
  }

  async function runSuggestTest() {
    const vals = fieldForm.getFieldsValue();
    const cfg = vals.suggest || {};
    if (!cfg.connectionId) { message.info('Выберите подключение'); return; }
    setSuggestTest({ loading: true });
    try {
      const res = await probeSuggest({ suggest: cfg, query: cfg.__testQuery || 'сбер', values: {} });
      setSuggestTest(res);
      if (!res.ok) message.error(res.error || 'Ошибка запроса');
    } catch (e: any) {
      setSuggestTest({ ok: false, error: e?.response?.data?.detail || String(e) });
    }
  }

  function removeField(i: number) {
    const next = form!.fields.filter((_, idx) => idx !== i);
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
                options={[1, 2, 3, 4, 5, 6]}
                onChange={(v) => setForm({ ...form, grid_columns: Number(v) })}
              />
            </span>
          </Space>

          <Segmented
            block
            style={{ marginBottom: 12 }}
            value={leftView}
            onChange={(v) => {
              if (v === 'layout') setForm({ ...form, fields: ensureLayout(form.fields, form.grid_columns) });
              // Leaving layout → reorder the field array to match the arrangement
              // (top→bottom, left→right), so the «Поля» list matches the preview.
              if (v === 'fields') setForm({ ...form, fields: sortByLayout(form.fields) });
              setLeftView(v as 'fields' | 'layout');
            }}
            options={[
              { label: 'Поля', value: 'fields', icon: <UnorderedListOutlined /> },
              { label: 'Раскладка (drag & resize)', value: 'layout', icon: <AppstoreOutlined /> },
            ]}
          />

          {leftView === 'fields' ? (
            <>
              <div>
                {form.fields.map((f, i) => (
                  <FieldRow
                    key={f.id}
                    field={f}
                    highlight={highlight === f.id}
                    onEdit={() => openEditor(i)}
                    onDelete={() => removeField(i)}
                    onBadgeClick={(target: string) => { setHighlight(target); setTimeout(() => setHighlight(null), 1500); }}
                    onCopyId={() => { navigator.clipboard?.writeText(f.id); message.success('ID скопирован: ' + f.id); }}
                  />
                ))}
              </div>
              <Button block icon={<PlusOutlined />} onClick={() => openEditor(null)} style={{ marginTop: 8 }}>
                Добавить поле
              </Button>
            </>
          ) : (
            <>
              <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                Тяните блоки, чтобы менять порядок; тяните правый/нижний край, чтобы растягивать поле по сетке
                ({form.grid_columns} {form.grid_columns === 1 ? 'колонка' : 'колонок'}). Раскладка сразу видна в предпросмотре справа.
              </Typography.Paragraph>
              <LayoutEditor
                fields={form.fields}
                cols={form.grid_columns}
                onChange={(fields) => setForm({ ...form, fields })}
              />
            </>
          )}

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
            suggestLoader={(field, query, values) =>
              probeSuggest({ suggest: field.suggest, query, values }).then((r) => r.items || [])}
            fileUpload={uploadFile}
            showTitle={false}
          />
        </Card>
      </Col>

      <Drawer
        title={editIndex !== null ? 'Настройка поля' : ''}
        open={editIndex !== null}
        width={460}
        onClose={closeEditor}
        extra={<Button type="primary" onClick={applyField}>Применить</Button>}
        destroyOnClose
      >
        <AntForm form={fieldForm} layout="vertical">
          <AntForm.Item name="type" label="Тип поля" rules={[{ required: true }]}>
            <Select
              options={FIELD_TYPE_GROUPS}
              showSearch
              optionFilterProp="label"
              placeholder="Начните вводить: текст, инн, дата, подсказка…"
            />
          </AntForm.Item>
          <AntForm.Item name="label" label={LAYOUT_TYPES.includes(editType) ? 'Текст' : 'Заголовок'} rules={[{ required: true }]}>
            <Input />
          </AntForm.Item>
          {editType === 'section_header' && (
            <AntForm.Item name="headingLevel" label="Уровень заголовка" initialValue={3}>
              <Select options={[{ label: 'H1 — крупный', value: 1 }, { label: 'H2 — средний', value: 2 }, { label: 'H3 — обычный', value: 3 }]} />
            </AntForm.Item>
          )}
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
              <AntForm.Item name="readOnly" label="Только для чтения" valuePropName="checked"
                tooltip="Поле не редактируется вручную — например, заполняется автоматически из подсказки (ИНН, адрес).">
                <Switch />
              </AntForm.Item>
              <AntForm.Item name="placeholder" label="Placeholder"><Input /></AntForm.Item>
              <AntForm.Item name="hint" label="Подсказка под полем"><Input /></AntForm.Item>
              <AntForm.Item name="tooltip" label="Tooltip (иконка ?)"><Input /></AntForm.Item>
              <AntForm.Item name="defaultValue" label="Значение по умолчанию"
                tooltip="Подставляется в поле при открытии формы. Для списков — код значения; для чекбокса — true/false.">
                <Input placeholder="необязательно" />
              </AntForm.Item>
            </>
          )}

          {DICT_TYPES.includes(editType) && (
            <>
              <AntForm.Item name="dictionaryId" label="Справочник" rules={[{ required: true }]}>
                <Select options={dicts.map((d) => ({ label: `${d.name} (${d.code})`, value: d.id }))} />
              </AntForm.Item>
              <AntForm.Item name="showExtra" label="Показывать атрибуты значения" valuePropName="checked"><Switch /></AntForm.Item>
            </>
          )}

          {editType === 'same_as' && (() => {
            const opts = otherFields
              .filter((of) => !['section_header', 'divider', 'info_text', 'same_as'].includes(of.type))
              .map((of) => ({ label: `${of.label} (${of.id})`, value: of.id }));
            return (
              <Card size="small" title="Совпадает с…" style={{ marginBottom: 12 }}>
                <Alert type="info" showIcon style={{ marginBottom: 12 }}
                  message="Чекбокс автозаполнения"
                  description={<span style={{ fontSize: 12 }}>Когда включён — «поле-приёмник» <b>скрывается</b> и <b>заполняется</b> значением из «поля-источника». Напр.: «Почтовый = юридическому».</span>}
                />
                <AntForm.Item name={['sameAs', 'target']} label="Поле-приёмник (скроется и заполнится)" rules={[{ required: true }]}
                  tooltip="Это поле пропадёт с формы и получит значение из источника.">
                  <Select showSearch optionFilterProp="label" placeholder="напр. Почтовый адрес" options={opts} />
                </AntForm.Item>
                <AntForm.Item name={['sameAs', 'source']} label="Поле-источник (откуда взять значение)" rules={[{ required: true }]}
                  tooltip="Из этого поля берётся значение для приёмника.">
                  <Select showSearch optionFilterProp="label" placeholder="напр. Юридический адрес" options={opts} />
                </AntForm.Item>
              </Card>
            );
          })()}

          {editType === 'suggest' && (
            <Card size="small" title="Подсказка (API)" style={{ marginBottom: 12 }}
              extra={<Button size="small" type="primary" ghost onClick={runSuggestTest}>Тест</Button>}>
              <Alert
                type="info" showIcon style={{ marginBottom: 12 }}
                message="Поиск по мере ввода через API"
                description={<span style={{ fontSize: 12 }}>Пользователь печатает — запрос уходит в API с введённым текстом, показываются совпадения. При выборе можно автозаполнить другие поля.</span>}
              />
              <AntForm.Item label="Пресеты">
                <Space wrap>
                  <Button size="small" onClick={() => {
                    const dd = conns.find((c) => /dadata/i.test(c.base_url));
                    fieldForm.setFieldsValue({ suggest: {
                      connectionId: dd?.id, method: 'POST', endpoint: '/suggest/address', queryParam: 'query',
                      params: '{"count": 10}', minChars: 3, path: 'suggestions', labelField: 'value', valueField: 'value',
                      labelTemplate: '{{value}}', subtitleTemplate: 'индекс {{data.postal_code}}', fill: [],
                    } });
                  }}>DaData адрес</Button>
                  <Button size="small" onClick={() => {
                    const dd = conns.find((c) => /dadata/i.test(c.base_url));
                    fieldForm.setFieldsValue({ suggest: {
                      connectionId: dd?.id, method: 'POST', endpoint: '/suggest/party', queryParam: 'query',
                      params: '{"count": 10}', minChars: 3, path: 'suggestions', labelField: 'value', valueField: 'value',
                      labelTemplate: '{{value}}', subtitleTemplate: 'ИНН {{data.inn}} · {{data.address.value}}',
                      fill: [{ fieldId: '', from: 'data.inn' }],
                    } });
                  }}>DaData компания / ИНН</Button>
                </Space>
              </AntForm.Item>
              <AntForm.Item name={['suggest', 'connectionId']} label="Подключение" rules={[{ required: true }]}
                tooltip="Настраивается в разделе «Подключения». Секреты остаются на сервере.">
                <Select options={conns.map((c) => ({ label: `${c.name} (${c.base_url})`, value: c.id }))} placeholder="Выберите подключение" />
              </AntForm.Item>
              <Row gutter={8}>
                <Col span={8}><AntForm.Item name={['suggest', 'method']} label="Метод" initialValue="POST">
                  <Select options={[{ label: 'POST', value: 'POST' }, { label: 'GET', value: 'GET' }]} />
                </AntForm.Item></Col>
                <Col span={16}><AntForm.Item name={['suggest', 'endpoint']} label="Адрес (endpoint)" tooltip="DaData: /suggest/address или /suggest/party">
                  <Input placeholder="/suggest/address" />
                </AntForm.Item></Col>
              </Row>
              <Row gutter={8}>
                <Col span={12}><AntForm.Item name={['suggest', 'queryParam']} label="Параметр запроса" initialValue="query"
                  tooltip="Имя параметра, в который кладётся введённый текст. DaData: query">
                  <Input placeholder="query" />
                </AntForm.Item></Col>
                <Col span={12}><AntForm.Item name={['suggest', 'minChars']} label="Мин. символов" initialValue={3}>
                  <InputNumber min={1} max={10} style={{ width: '100%' }} />
                </AntForm.Item></Col>
              </Row>
              <AntForm.Item name={['suggest', 'params']} label="Доп. параметры (JSON)" tooltip='Статические параметры, {{id_поля}} поддерживается. Напр. {"count": 10}'>
                <Input placeholder='{"count": 10}' style={{ fontFamily: 'monospace', fontSize: 12 }} />
              </AntForm.Item>
              <Row gutter={8}>
                <Col span={8}><AntForm.Item name={['suggest', 'path']} label="Где список" tooltip="Путь до массива в ответе. DaData: suggestions">
                  <Input placeholder="suggestions" />
                </AntForm.Item></Col>
                <Col span={8}><AntForm.Item name={['suggest', 'labelField']} label="Показать" tooltip="Поле для отображения. DaData: value">
                  <Input placeholder="value" />
                </AntForm.Item></Col>
                <Col span={8}><AntForm.Item name={['suggest', 'valueField']} label="Сохранить" tooltip="Что записать в поле. Можно вложенно: data.fias_id, data.inn">
                  <Input placeholder="value" />
                </AntForm.Item></Col>
              </Row>
              <AntForm.Item name={['suggest', 'labelTemplate']} label="Что показать в списке (основная строка)"
                tooltip="Шаблон с {{путь}}: {{value}}, {{data.inn}} и т.д. Пусто = поле «Показать».">
                <Input placeholder="{{value}}" style={{ fontFamily: 'monospace', fontSize: 12 }} />
              </AntForm.Item>
              <AntForm.Item name={['suggest', 'subtitleTemplate']} label="Вторая строка (серым, необязательно)"
                tooltip="Доп. строка под названием. Доступные поля смотри в «Тест» → сырой ответ."
                extra="Напр.: ИНН {{data.inn}} · {{data.address.value}}">
                <Input placeholder="ИНН {{data.inn}} · {{data.address.value}}" style={{ fontFamily: 'monospace', fontSize: 12 }} />
              </AntForm.Item>
              <Typography.Text strong style={{ fontSize: 12 }}>Автозаполнение полей при выборе</Typography.Text>
              <AntForm.List name={['suggest', 'fill']}>
                {(fl, { add, remove }) => (
                  <div style={{ margin: '4px 0 8px' }}>
                    {fl.map((ff) => (
                      <Space key={ff.key} align="baseline" style={{ display: 'flex', marginBottom: 4 }}>
                        <AntForm.Item {...ff} name={[ff.name, 'fieldId']} noStyle>
                          <Select style={{ width: 160 }} placeholder="какое поле" options={otherFields.map((of) => ({ label: `${of.label} (${of.id})`, value: of.id }))} />
                        </AntForm.Item>
                        <span style={{ color: '#888' }}>←</span>
                        <AntForm.Item {...ff} name={[ff.name, 'from']} noStyle>
                          <Input placeholder="data.inn или {{..}}, {{..}}" style={{ width: 220, fontFamily: 'monospace', fontSize: 12 }} />
                        </AntForm.Item>
                        <DeleteOutlined onClick={() => remove(ff.name)} />
                      </Space>
                    ))}
                    <Button size="small" icon={<PlusOutlined />} onClick={() => add({ fieldId: '', from: '' })}>Поле</Button>
                  </div>
                )}
              </AntForm.List>
              {suggestTest && (
                <Card size="small" style={{ background: '#fafafa', marginTop: 8 }}>
                  {suggestTest.loading ? 'Запрос…' : suggestTest.ok ? (
                    <>
                      <Tag color={suggestTest.items?.length ? 'green' : 'orange'}>
                        {suggestTest.items?.length ? `OK · ${suggestTest.items.length} совпадений (запрос «сбер»)` : 'Ответ пуст'}
                      </Tag>
                      {suggestTest.items?.slice(0, 3).map((it: any, i: number) => (
                        <div key={i} style={{ fontSize: 12 }}><b>{it.label}</b> <Typography.Text type="secondary">→ {it.value}</Typography.Text></div>
                      ))}
                      <details style={{ marginTop: 6 }}>
                        <summary style={{ cursor: 'pointer', fontSize: 12, color: '#888' }}>Сырой ответ</summary>
                        <pre style={{ margin: '6px 0 0', fontSize: 11, maxHeight: 180, overflow: 'auto' }}>{JSON.stringify(suggestTest.raw, null, 2)}</pre>
                      </details>
                    </>
                  ) : <Tag color="red">Ошибка: {suggestTest.error}</Tag>}
                </Card>
              )}
            </Card>
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
            <>
              <Row gutter={12}>
                <Col span={12}><AntForm.Item name={['validation', 'minLength']} label="Мин. длина"><InputNumber style={{ width: '100%' }} /></AntForm.Item></Col>
                <Col span={12}><AntForm.Item name={['validation', 'maxLength']} label="Макс. длина"><InputNumber style={{ width: '100%' }} /></AntForm.Item></Col>
              </Row>
              <AntForm.Item name={['mask', 'regex']} label="Своя маска (regex)"
                tooltip="Регулярное выражение, которому должно соответствовать значение. Напр. ^\\d{4}$ — ровно 4 цифры.">
                <Input placeholder="^\\d{4}$" style={{ fontFamily: 'monospace' }} />
              </AntForm.Item>
              <AntForm.Item name={['validation', 'regexMessage']} label="Сообщение при несоответствии">
                <Input placeholder="Напр.: введите 4 цифры" />
              </AntForm.Item>
            </>
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
function FieldRow({ field, highlight, onEdit, onDelete, onBadgeClick, onCopyId }: any) {
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
          <Select allowClear showSearch optionFilterProp="label" placeholder="поле"
            options={fields.filter((f) => !['section_header', 'divider', 'info_text'].includes(f.type)).map((f) => ({ label: `${f.label} (${f.id})`, value: f.id }))}
            style={{ width: '100%' }} />
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
// Reorder fields to match the visual grid arrangement (row y, then column x),
// stable on original position for ties / fields without layout.
function sortByLayout(fields: Field[]): Field[] {
  return fields
    .map((f, i) => ({ f, i }))
    .sort((a, b) => {
      const ay = a.f.layout?.y ?? a.i;
      const by = b.f.layout?.y ?? b.i;
      if (ay !== by) return ay - by;
      const ax = a.f.layout?.x ?? 0;
      const bx = b.f.layout?.x ?? 0;
      if (ax !== bx) return ax - bx;
      return a.i - b.i;
    })
    .map((x) => x.f);
}

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
    // Explicitly seed nested config objects so a NEW field never inherits the
    // previously-edited field's suggest/sameAs settings (resetFields alone can't
    // clear inputs that aren't mounted yet).
    suggest: f.suggest || {},
    sameAs: f.sameAs || {},
    mask: f.mask || {},
  };
}

function formToField(vals: any, prev: Field): Field {
  const out: Field = { ...prev, ...vals };
  // Apply the preset's mask regex, but keep a user-entered custom regex if set.
  if (MASK_PRESETS[vals.type]) {
    out.mask = { ...vals.mask, preset: vals.type, regex: vals.mask?.regex || MASK_PRESETS[vals.type].regex };
  }
  // Drop an empty mask object so plain fields stay clean.
  if (out.mask && !out.mask.regex && !out.mask.pattern && !out.mask.preset) delete out.mask;
  // Display is derived from the dictionary field type (single source of truth),
  // so «Тип поля» and how it renders can never disagree.
  if (DICT_TYPES.includes(out.type)) {
    out.dictDisplay = out.type === 'dict_radio' ? 'radio' : out.type === 'dict_checkbox' ? 'checkbox' : 'select';
  }
  if (!vals.visibleIf?.fieldId) delete out.visibleIf;
  if (!vals.requiredIf?.fieldId) delete out.requiredIf;
  if (vals.validation && Object.values(vals.validation).every((x) => x === undefined || x === null)) delete out.validation;
  // Keep nested config only on the field type that uses it.
  if (out.type !== 'suggest') delete out.suggest;
  if (out.type !== 'same_as') delete out.sameAs;
  return out;
}
