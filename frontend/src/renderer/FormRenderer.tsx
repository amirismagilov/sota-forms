import { QuestionCircleOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Checkbox,
  DatePicker,
  Descriptions,
  Input,
  InputNumber,
  Radio,
  Rate,
  Select,
  Slider,
  Switch,
  Tooltip,
  Typography,
  Upload,
  message,
} from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { useMemo, useState } from 'react';
import type { Dictionary, Field, FormSchema } from '../types';
import { dictItemsFor, evalCondition, evalFormula } from './engine';

const { Title, Text, Paragraph } = Typography;

interface Props {
  schema: Pick<FormSchema, 'fields' | 'grid_columns' | 'submit' | 'title'>;
  dictionaries: Dictionary[];
  onSubmit?: (data: Record<string, any>) => Promise<{ successMessage?: string; redirectUrl?: string | null; submissionId?: string }>;
  onChange?: (field: string, value: any, all: Record<string, any>) => void;
  showTitle?: boolean;
}

function applyMask(preset: string | undefined, raw: string): string {
  if (preset === 'phone') {
    const d = raw.replace(/\D/g, '').replace(/^8/, '7').replace(/^7/, '').slice(0, 10);
    let out = '+7';
    if (d.length > 0) out += ' (' + d.slice(0, 3);
    if (d.length >= 3) out += ') ' + d.slice(3, 6);
    if (d.length >= 6) out += '-' + d.slice(6, 8);
    if (d.length >= 8) out += '-' + d.slice(8, 10);
    return out;
  }
  return raw;
}

export default function FormRenderer({ schema, dictionaries, onSubmit, onChange, showTitle = true }: Props) {
  const [values, setValues] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const dictById = useMemo(() => {
    const m: Record<string, Dictionary> = {};
    dictionaries.forEach((d) => (m[d.id] = d));
    return m;
  }, [dictionaries]);

  // Attributes of the selected dictionary value for each dict-backed field.
  const attrs = useMemo(() => {
    const a: Record<string, Record<string, any>> = {};
    for (const f of schema.fields) {
      if (f.dictionaryId && values[f.id] !== undefined) {
        const dict = dictById[f.dictionaryId];
        const item = dict?.items.find((it) => it.code === values[f.id]);
        if (item?.attrs) a[f.id] = item.attrs;
      }
    }
    return a;
  }, [values, schema.fields, dictById]);

  // Values + calculated fields resolved.
  const computed = useMemo(() => {
    const c: Record<string, any> = { ...values };
    for (const f of schema.fields) {
      if (f.type === 'calculated' && f.formula) {
        c[f.id] = evalFormula(f.formula, c, attrs);
      }
    }
    return c;
  }, [values, attrs, schema.fields]);

  const setValue = (field: Field, v: any) => {
    // Build the next values from current state (no side-effects inside the
    // updater, so StrictMode's double-invoke can't fire onChange twice).
    const nextVals = { ...values, [field.id]: v };
    // Reset children whose dictionary depends on this field (cascade).
    for (const f of schema.fields) {
      if (f.dictionaryId) {
        const dep = dictById[f.dictionaryId]?.dependencies?.[0];
        if (dep && dep.fieldId === field.id) delete nextVals[f.id];
      }
    }
    setValues(nextVals);
    setErrors((e) => ({ ...e, [field.id]: '' }));
    onChange?.(field.id, v, nextVals);
  };

  const isVisible = (f: Field) => evalCondition(f.visibleIf, computed);
  const isRequired = (f: Field) => !!f.required || (!!f.requiredIf && evalCondition(f.requiredIf, computed));

  function validateField(f: Field): string {
    const v = computed[f.id];
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    if (isRequired(f) && empty) return f.requiredMessage || 'Обязательное поле';
    if (empty) return '';
    const val = f.validation || {};
    if (typeof v === 'string') {
      if (val.minLength && v.length < val.minLength) return `Минимум ${val.minLength} символов`;
      if (val.maxLength && v.length > val.maxLength) return `Максимум ${val.maxLength} символов`;
    }
    if (f.type === 'number' || f.type === 'amount') {
      if (val.min !== undefined && Number(v) < val.min) return `Минимум ${val.min}`;
      if (val.max !== undefined && Number(v) > val.max) return `Максимум ${val.max}`;
    }
    if (f.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v))) return 'Некорректный email';
    const regex = f.mask?.regex || val.regex;
    if (regex) {
      try {
        if (!new RegExp(regex).test(String(v))) return val.regexMessage || 'Неверный формат';
      } catch { /* ignore bad regex */ }
    }
    return '';
  }

  async function handleSubmit() {
    const errs: Record<string, string> = {};
    for (const f of schema.fields) {
      if (['section_header', 'divider', 'info_text'].includes(f.type)) continue;
      if (!isVisible(f)) continue;
      const e = validateField(f);
      if (e) errs[f.id] = e;
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      message.error('Проверьте заполнение формы');
      return;
    }
    if (!onSubmit) {
      message.success('Форма валидна (превью)');
      return;
    }
    setSubmitting(true);
    try {
      // Only send visible fields + calculated values.
      const payload: Record<string, any> = {};
      for (const f of schema.fields) {
        if (['section_header', 'divider', 'info_text'].includes(f.type)) continue;
        if (!isVisible(f)) continue;
        payload[f.id] = computed[f.id];
      }
      const res = await onSubmit(payload);
      if (res.redirectUrl) window.location.href = res.redirectUrl;
      else setDone(res.successMessage || 'Спасибо!');
    } catch (e: any) {
      message.error('Ошибка отправки: ' + (e?.message || 'unknown'));
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return <Alert type="success" showIcon message={done} style={{ margin: 8 }} />;
  }

  const cols = schema.grid_columns || 2;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 8 }}>
      {showTitle && <Title level={3}>{schema.title}</Title>}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 16 }}>
        {schema.fields.map((f) => {
          if (!isVisible(f)) return null;
          const span = Math.min(f.gridSpan || 1, cols);
          const full = ['section_header', 'divider', 'info_text', 'textarea', 'calculated'].includes(f.type);
          return (
            <div key={f.id} style={{ gridColumn: `span ${full ? cols : span}` }}>
              {renderField(f)}
            </div>
          );
        })}
      </div>
      <Button type="primary" size="large" onClick={handleSubmit} loading={submitting} style={{ marginTop: 20 }} block>
        Отправить
      </Button>
    </div>
  );

  function label(f: Field) {
    return (
      <span style={{ fontWeight: 500 }}>
        {f.label}
        {isRequired(f) && <span style={{ color: '#ff4d4f' }}> *</span>}
        {f.tooltip && (
          <Tooltip title={f.tooltip}>
            {' '}
            <QuestionCircleOutlined style={{ color: '#999' }} />
          </Tooltip>
        )}
      </span>
    );
  }

  function wrap(f: Field, control: React.ReactNode) {
    return (
      <div>
        <div style={{ marginBottom: 4 }}>{label(f)}</div>
        {control}
        {f.hint && <div style={{ color: '#888', fontSize: 12, marginTop: 2 }}>{f.hint}</div>}
        {errors[f.id] && <div style={{ color: '#ff4d4f', fontSize: 12, marginTop: 2 }}>{errors[f.id]}</div>}
        {f.showExtra && attrs[f.id] && (
          <Descriptions size="small" column={1} bordered style={{ marginTop: 8 }}>
            {Object.entries(attrs[f.id]).map(([k, v]) => (
              <Descriptions.Item key={k} label={k}>{String(v)}</Descriptions.Item>
            ))}
          </Descriptions>
        )}
      </div>
    );
  }

  function renderField(f: Field): React.ReactNode {
    const v = values[f.id];
    switch (f.type) {
      case 'section_header':
        return <Title level={4} style={{ marginBottom: 0, marginTop: 8 }}>{f.label}</Title>;
      case 'divider':
        return <div style={{ borderTop: '1px solid #eee', margin: '8px 0' }} />;
      case 'info_text':
        return <Paragraph type="secondary" style={{ marginBottom: 0 }}>{f.label}</Paragraph>;
      case 'textarea':
        return wrap(f, <Input.TextArea rows={f.rows || 3} placeholder={f.placeholder || ''} value={v} onChange={(e) => setValue(f, e.target.value)} />);
      case 'number':
      case 'amount':
        return wrap(f, <InputNumber style={{ width: '100%' }} value={v} min={f.validation?.min} max={f.validation?.max} onChange={(x) => setValue(f, x)} addonAfter={f.type === 'amount' ? '₽' : undefined} />);
      case 'calculated': {
        const num = Number(computed[f.id] || 0);
        const text = `${f.calcPrefix || ''}${num.toFixed(f.calcDecimals ?? 2)}${f.calcSuffix || ''}`;
        return (
          <div>
            <div style={{ marginBottom: 4 }}>{label(f)}</div>
            <Input readOnly value={text} style={{ fontWeight: 600, background: '#fafafa' }} />
          </div>
        );
      }
      case 'select_static':
        return wrap(f, <Select style={{ width: '100%' }} value={v} placeholder={f.placeholder || ''} options={(f.options || []).map((o) => ({ label: o.label, value: o.value }))} onChange={(x) => setValue(f, x)} allowClear />);
      case 'radio_group':
        return wrap(f, <Radio.Group value={v} onChange={(e) => setValue(f, e.target.value)}>{(f.options || []).map((o) => <Radio key={o.value} value={o.value}>{o.label}</Radio>)}</Radio.Group>);
      case 'checkbox':
        return (
          <div>
            <Checkbox checked={!!v} onChange={(e) => setValue(f, e.target.checked)}>{f.label}{isRequired(f) && <span style={{ color: '#ff4d4f' }}> *</span>}</Checkbox>
            {errors[f.id] && <div style={{ color: '#ff4d4f', fontSize: 12 }}>{errors[f.id]}</div>}
          </div>
        );
      case 'toggle':
        return (
          <div>
            <div style={{ marginBottom: 4 }}>{label(f)}</div>
            <Switch checked={!!v} onChange={(x) => setValue(f, x)} />
          </div>
        );
      case 'date':
        return wrap(f, <DatePicker style={{ width: '100%' }} onChange={(_, s) => setValue(f, s)} />);
      case 'rating':
        return wrap(f, <Rate value={v} onChange={(x) => setValue(f, x)} />);
      case 'slider':
        return wrap(f, <Slider value={v} min={f.validation?.min ?? 0} max={f.validation?.max ?? 100} onChange={(x) => setValue(f, x)} />);
      case 'dict_select':
      case 'dict_radio':
      case 'dict_checkbox': {
        const dict = f.dictionaryId ? dictById[f.dictionaryId] : undefined;
        const items = dictItemsFor(dict, f, values);
        const opts = items.map((it) => ({ label: it.label, value: it.code }));
        const display = f.dictDisplay || (f.type === 'dict_radio' ? 'radio' : f.type === 'dict_checkbox' ? 'checkbox' : 'select');
        if (display === 'radio')
          return wrap(f, <Radio.Group value={v} onChange={(e) => setValue(f, e.target.value)}>{opts.map((o) => <Radio key={o.value} value={o.value}>{o.label}</Radio>)}</Radio.Group>);
        if (display === 'checkbox')
          return wrap(f, <Checkbox.Group value={v} options={opts} onChange={(x) => setValue(f, x)} />);
        return wrap(f, <Select style={{ width: '100%' }} value={v} placeholder={f.placeholder || 'Выберите…'} options={opts} onChange={(x) => setValue(f, x)} allowClear notFoundContent="Нет вариантов (проверьте зависимости)" />);
      }
      case 'file':
      case 'image':
        return wrap(f, <Upload beforeUpload={() => false} maxCount={5}><Button icon={<UploadOutlined />}>Загрузить</Button></Upload>);
      default: {
        // text, email, phone, url, password, inn, snils, passport, bik, kpp, ogrn, card, ...
        const isPass = f.type === 'password';
        const Comp: any = isPass ? Input.Password : Input;
        return wrap(
          f,
          <Comp
            placeholder={f.placeholder || ''}
            value={v}
            onChange={(e: any) => setValue(f, f.mask?.preset === 'phone' ? applyMask('phone', e.target.value) : e.target.value)}
          />,
        );
      }
    }
  }
}
