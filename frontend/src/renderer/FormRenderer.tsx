import { QuestionCircleOutlined, UploadOutlined } from '@ant-design/icons';
import {
  Alert,
  AutoComplete,
  Button,
  Checkbox,
  ColorPicker,
  DatePicker,
  Descriptions,
  Input,
  InputNumber,
  Radio,
  Rate,
  Select,
  Slider,
  Spin,
  Switch,
  TimePicker,
  Tooltip,
  Typography,
  Upload,
  message,
} from 'antd';
import { cloneElement, forwardRef, isValidElement, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Dictionary, Field, FormSchema } from '../types';
import { dictItemsFor, evalCondition, evalFormula } from './engine';
import FloatingField from './FloatingField';
import { maskValue } from './masks';
import SignaturePad from './SignaturePad';
import { validateFileMeta, validateImageDims } from './validateFile';

const { Title, Paragraph } = Typography;

const LAYOUT = ['section_header', 'divider', 'info_text'];
const FULL_WIDTH = [...LAYOUT, 'textarea', 'calculated', 'signature'];
// Поля с плавающим лейблом (стиль референса). Остальные (checkbox, radio,
// slider, switch, rating, color, file, signature) — с лейблом сверху.
const FLOAT_LABEL = new Set([
  'text', 'email', 'phone', 'url', 'password', 'inn', 'snils', 'passport',
  'bik', 'kpp', 'ogrn', 'card', 'number', 'amount', 'textarea',
  'select_static', 'dict_select', 'suggest', 'date', 'datetime', 'time',
]);

export interface FormHandle {
  getValues: () => Record<string, any>;
  setValues: (v: Record<string, any>) => void;
  validate: () => { valid: boolean; errors: Record<string, string> };
  reset: () => void;
  submit: () => void;
}

interface Props {
  schema: Pick<FormSchema, 'fields' | 'grid_columns' | 'submit' | 'title'>;
  dictionaries: Dictionary[];
  /** Values known before the user types — e.g. the variables of an Operaton task
   *  being reopened. Applied once per distinct payload; user edits always win. */
  initialValues?: Record<string, any>;
  onSubmit?: (data: Record<string, any>) => Promise<{ successMessage?: string; redirectUrl?: string | null; submissionId?: string }>;
  onChange?: (field: string, value: any, all: Record<string, any>) => void;
  onError?: (errors: Record<string, string>) => void;
  showTitle?: boolean;
  apiDictLoader?: (dictId: string, values: Record<string, any>) => Promise<{ code: string; label: string; attrs?: any }[]>;
  suggestLoader?: (field: Field, query: string, values: Record<string, any>) => Promise<SuggestItem[]>;
  fileUpload?: (file: File) => Promise<{ id: string; url: string; filename: string; size: number }>;
}

type DictItem = { code: string; label: string; attrs?: any };
type SuggestItem = { value: string; label: string; data: any };

const FormRenderer = forwardRef<FormHandle, Props>(function FormRenderer(
  { schema, dictionaries, initialValues, onSubmit, onChange, onError, showTitle = true, apiDictLoader, suggestLoader, fileUpload },
  ref,
) {
  const [values, setValues] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [apiOptions, setApiOptions] = useState<Record<string, DictItem[]>>({});
  const [apiLoading, setApiLoading] = useState<Record<string, boolean>>({});
  const apiKeys = useRef<Record<string, string>>({});
  const [suggestOpts, setSuggestOpts] = useState<Record<string, SuggestItem[]>>({});
  const [suggestBusy, setSuggestBusy] = useState<Record<string, boolean>>({});
  const suggestTimers = useRef<Record<string, any>>({});

  const dictById = useMemo(() => {
    const m: Record<string, Dictionary> = {};
    dictionaries.forEach((d) => (m[d.id] = d));
    return m;
  }, [dictionaries]);

  // Options available for a dict-backed field (manual filter or API result).
  const optionsFor = (f: Field): DictItem[] => {
    const dict = f.dictionaryId ? dictById[f.dictionaryId] : undefined;
    if (!dict) return [];
    if (dict.type === 'api') return apiOptions[f.id] || [];
    return dictItemsFor(dict, f, values).map((it) => ({ code: it.code, label: it.label, attrs: it.attrs }));
  };

  // Selected-value attributes for each dict field (manual + API).
  const attrs = useMemo(() => {
    const a: Record<string, Record<string, any>> = {};
    for (const f of schema.fields) {
      if (!f.dictionaryId || values[f.id] === undefined) continue;
      const dict = dictById[f.dictionaryId];
      const pool: DictItem[] = dict?.type === 'api' ? apiOptions[f.id] || [] : dict?.items || [];
      const item = pool.find((it) => it.code === values[f.id]);
      if (item?.attrs) a[f.id] = item.attrs;
    }
    return a;
  }, [values, schema.fields, dictById, apiOptions]);

  const computed = useMemo(() => {
    const c: Record<string, any> = { ...values };
    for (const f of schema.fields) {
      if (f.type === 'calculated' && f.formula) c[f.id] = evalFormula(f.formula, c, attrs);
    }
    return c;
  }, [values, attrs, schema.fields]);

  // Seed default values when the form loads (only for fields not yet touched).
  // Seed from the host BEFORE defaults, so a value the process already holds is
  // not overwritten by the field's default. Keyed on the serialised payload so a
  // re-render never wipes what the user has typed since.
  const seeded = useRef<string | null>(null);
  useEffect(() => {
    if (!initialValues) return;
    const key = JSON.stringify(initialValues);
    if (seeded.current === key) return;
    seeded.current = key;
    setValues((prev) => ({ ...prev, ...initialValues }));
  }, [initialValues]);

  useEffect(() => {
    setValues((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const f of schema.fields) {
        if (f.defaultValue === undefined || f.defaultValue === '' || next[f.id] !== undefined) continue;
        let dv: any = f.defaultValue;
        if (dv === 'true') dv = true;
        else if (dv === 'false') dv = false;
        else if ((f.type === 'number' || f.type === 'amount') && dv !== '' && !isNaN(Number(dv))) dv = Number(dv);
        next[f.id] = dv;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [schema.fields]);

  // Load API-dictionary options when their dependency values change.
  useEffect(() => {
    if (!apiDictLoader) return;
    for (const f of schema.fields) {
      const dict = f.dictionaryId ? dictById[f.dictionaryId] : undefined;
      if (!dict || dict.type !== 'api') continue;
      const deps = dict.dependencies || [];
      const ready = deps.every((d) => values[d.fieldId] !== undefined && values[d.fieldId] !== '');
      if (deps.length && !ready) {
        if (apiKeys.current[f.id] !== '∅') {
          apiKeys.current[f.id] = '∅';
          setApiOptions((p) => ({ ...p, [f.id]: [] }));
        }
        continue;
      }
      const depVals = Object.fromEntries(deps.map((d) => [d.fieldId, values[d.fieldId]]));
      const key = JSON.stringify(depVals);
      if (apiKeys.current[f.id] === key) continue;
      apiKeys.current[f.id] = key;
      setApiLoading((p) => ({ ...p, [f.id]: true }));
      apiDictLoader(f.dictionaryId!, values)
        .then((items) => setApiOptions((p) => ({ ...p, [f.id]: items })))
        .catch(() => setApiOptions((p) => ({ ...p, [f.id]: [] })))
        .finally(() => setApiLoading((p) => ({ ...p, [f.id]: false })));
    }
  }, [values, schema.fields, dictById, apiDictLoader]);

  // «Совпадает с…»: while the checkbox is ON, keep its target field synced to
  // the source field's value.
  useEffect(() => {
    const patch: Record<string, any> = {};
    for (const f of schema.fields) {
      if (f.type === 'same_as' && values[f.id] && f.sameAs?.target && f.sameAs?.source) {
        if (values[f.sameAs.target] !== values[f.sameAs.source]) patch[f.sameAs.target] = values[f.sameAs.source];
      }
    }
    if (Object.keys(patch).length) setValues((v) => ({ ...v, ...patch }));
  }, [values, schema.fields]);

  // Target fields of a checked «Совпадает с…» are hidden (value comes from source).
  const hiddenBySameAs = useMemo(() => {
    const s = new Set<string>();
    for (const f of schema.fields) {
      if (f.type === 'same_as' && values[f.id] && f.sameAs?.target) s.add(f.sameAs.target);
    }
    return s;
  }, [values, schema.fields]);

  const setValue = (field: Field, v: any) => {
    const nextVals = { ...values, [field.id]: v };
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

  const isVisible = (f: Field) => !hiddenBySameAs.has(f.id) && evalCondition(f.visibleIf, computed);
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
    if (f.type === 'number' || f.type === 'amount' || f.type === 'slider') {
      if (val.min !== undefined && Number(v) < val.min) return `Минимум ${val.min}`;
      if (val.max !== undefined && Number(v) > val.max) return `Максимум ${val.max}`;
    }
    if (f.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v))) return 'Некорректный email';
    if (f.type === 'url' && !/^https?:\/\/.+/.test(String(v))) return 'Некорректный URL';
    const regex = f.mask?.regex || val.regex;
    if (regex) {
      try {
        if (!new RegExp(regex).test(String(v))) return val.regexMessage || 'Неверный формат';
      } catch { /* ignore bad regex */ }
    }
    return '';
  }

  function runValidation(): Record<string, string> {
    const errs: Record<string, string> = {};
    for (const f of schema.fields) {
      if (LAYOUT.includes(f.type) || !isVisible(f)) continue;
      const e = validateField(f);
      if (e) errs[f.id] = e;
    }
    return errs;
  }

  async function handleSubmit() {
    const errs = runValidation();
    setErrors(errs);
    if (Object.keys(errs).length) {
      message.error('Проверьте заполнение формы');
      onError?.(errs);
      return;
    }
    if (!onSubmit) {
      message.success('Форма валидна (превью)');
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, any> = {};
      for (const f of schema.fields) {
        if (LAYOUT.includes(f.type) || !isVisible(f)) continue;
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

  useImperativeHandle(ref, () => ({
    getValues: () => ({ ...computed }),
    setValues: (v) => setValues((prev) => ({ ...prev, ...v })),
    validate: () => {
      const errs = runValidation();
      setErrors(errs);
      return { valid: Object.keys(errs).length === 0, errors: errs };
    },
    reset: () => {
      setValues({});
      setErrors({});
      setDone(null);
      apiKeys.current = {};
    },
    submit: handleSubmit,
  }));

  if (done) return <Alert type="success" showIcon message={done} style={{ margin: 8 }} />;

  const cols = schema.grid_columns || 2;
  const useLayout = schema.fields.some((f) => f.layout);
  // Compact original row indices so hidden fields don't leave holes, while
  // keeping horizontal (x/w) placement exactly as designed.
  const rowMap = new Map<number, number>();
  if (useLayout) {
    const ys = Array.from(new Set(schema.fields.filter(isVisible).map((f) => f.layout?.y ?? 0))).sort((a, b) => a - b);
    ys.forEach((y, i) => rowMap.set(y, i + 1));
  }

  const maxWidth = useLayout ? 980 : 760;

  return (
    <div style={{ maxWidth, margin: '0 auto', padding: 8 }}>
      {showTitle && <Title level={3}>{schema.title}</Title>}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, alignItems: 'start', gap: 16 }}>
        {schema.fields.map((f) => {
          if (!isVisible(f)) return null;
          let style: React.CSSProperties;
          if (useLayout && f.layout) {
            const x = Math.min(Math.max(f.layout.x, 0), cols - 1);
            const w = Math.min(f.layout.w || 1, cols - x);
            style = { gridColumn: `${x + 1} / span ${w}`, gridRow: String(rowMap.get(f.layout.y ?? 0) ?? 'auto') };
          } else {
            const span = Math.min(f.gridSpan || 1, cols);
            const full = FULL_WIDTH.includes(f.type);
            style = { gridColumn: `span ${full ? cols : span}` };
          }
          return (
            <div key={f.id} style={style}>
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

  function wrap(f: Field, control: React.ReactNode, floating = FLOAT_LABEL.has(f.type)) {
    const v = values[f.id];
    const filled = v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
    let body: React.ReactNode;
    if (floating && f.label) {
      // Лейбл заменяет placeholder — глушим нативный (пробел, чтобы antd не показал свой дефолт).
      const ctrl = isValidElement(control) ? cloneElement(control as any, { placeholder: ' ' }) : control;
      body = (
        <FloatingField
          active={filled}
          label={
            <>
              {f.label}
              {isRequired(f) && <span style={{ color: '#ff4d4f' }}> *</span>}
            </>
          }
        >
          {ctrl}
        </FloatingField>
      );
    } else {
      body = (
        <>
          <div style={{ marginBottom: 4 }}>{label(f)}</div>
          {control}
        </>
      );
    }
    return (
      <div>
        {body}
        {f.hint && <div style={{ color: '#888', fontSize: 12, marginTop: 2 }}>{f.hint}</div>}
        {errors[f.id] && <div style={{ color: '#ff5028', fontSize: 12, marginTop: 4 }}>{errors[f.id]}</div>}
        {f.showExtra && attrs[f.id] && (
          <Descriptions size="small" column={1} bordered style={{ marginTop: 8 }}>
            {Object.entries(attrs[f.id]).map(([k, val]) => (
              <Descriptions.Item key={k} label={k}>{String(val)}</Descriptions.Item>
            ))}
          </Descriptions>
        )}
      </div>
    );
  }

  function dictControl(f: Field) {
    const opts = optionsFor(f).map((o) => ({ label: o.label, value: o.code }));
    const loading = !!apiLoading[f.id];
    const v = values[f.id];
    const display = f.dictDisplay || (f.type === 'dict_radio' ? 'radio' : f.type === 'dict_checkbox' ? 'checkbox' : 'select');
    if (display === 'radio')
      return wrap(f, <Radio.Group value={v} onChange={(e) => setValue(f, e.target.value)}>{opts.map((o) => <Radio key={o.value} value={o.value}>{o.label}</Radio>)}</Radio.Group>, false);
    if (display === 'checkbox')
      return wrap(f, <Checkbox.Group value={v} options={opts} onChange={(x) => setValue(f, x)} />, false);
    return wrap(
      f,
      <Select
        style={{ width: '100%' }}
        value={v}
        placeholder={f.placeholder || 'Выберите…'}
        options={opts}
        loading={loading}
        onChange={(x) => setValue(f, x)}
        showSearch
        optionFilterProp="label"
        allowClear
        notFoundContent={loading ? <Spin size="small" /> : 'Нет вариантов (проверьте зависимости)'}
      />,
    );
  }

  function digPath(obj: any, path: string): any {
    return (path || '').split('.').filter(Boolean).reduce((n, k) => (n == null ? n : n[k]), obj);
  }

  // Templates and fill-paths are resolved against the RAW API element (item.data),
  // exactly like «Сохранить»/«Показать» (valueField/labelField). So {{data.inn}}
  // for DaData means item.data.data.inn — same path the constructor's «Тест» shows.
  function fillTemplate(tpl: string, raw: any): string {
    return (tpl || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, p) => {
      const val = digPath(raw, p);
      return val == null ? '' : String(val);
    })
      // Tidy up separators around parts that resolved to empty.
      .replace(/,\s*,/g, ', ')
      .replace(/·\s*·/g, '·')
      .replace(/^[\s,·]+|[\s,·]+$/g, '')
      .trim();
  }

  function suggestControl(f: Field) {
    const cfg = f.suggest || {};
    const min = cfg.minChars ?? 3;
    const rawV = values[f.id];
    const v = (cfg.storeAs === 'object' && rawV && typeof rawV === 'object')
      ? String(rawV[cfg.labelField || 'name'] ?? rawV[cfg.valueField || 'id'] ?? '')
      : rawV;
    const busy = !!suggestBusy[f.id];
    const opts = (suggestOpts[f.id] || []).map((it) => {
      const primary = cfg.labelTemplate ? fillTemplate(cfg.labelTemplate, it.data) : it.label;
      const subtitle = cfg.subtitleTemplate ? fillTemplate(cfg.subtitleTemplate, it.data) : '';
      return {
        value: it.value,
        item: it,
        label: subtitle
          ? (
            <div>
              <div>{primary}</div>
              <div style={{ fontSize: 12, color: '#8c8c8c', lineHeight: 1.3 }}>{subtitle}</div>
            </div>
          )
          : primary,
      };
    });

    const doSearch = (text: string) => {
      const q = (text || '').trim();
      if (!suggestLoader || q.length < min) {
        setSuggestOpts((p) => ({ ...p, [f.id]: [] }));
        return;
      }
      if (suggestTimers.current[f.id]) clearTimeout(suggestTimers.current[f.id]);
      suggestTimers.current[f.id] = setTimeout(() => {
        setSuggestBusy((p) => ({ ...p, [f.id]: true }));
        suggestLoader(f, q, values)
          .then((items) => setSuggestOpts((p) => ({ ...p, [f.id]: items })))
          .catch(() => setSuggestOpts((p) => ({ ...p, [f.id]: [] })))
          .finally(() => setSuggestBusy((p) => ({ ...p, [f.id]: false })));
      }, 300);
    };

    return wrap(
      f,
      <AutoComplete
        style={{ width: '100%' }}
        value={v}
        options={opts}
        optionLabelProp="value"
        onSearch={doSearch}
        onChange={(val) => setValue(f, val)}
        onSelect={(val, option: any) => {
          // Store the picked value and auto-fill related fields from its data.
          const item: SuggestItem | undefined = option?.item;
          let fieldValue: any = val;
          if (cfg.storeAs === 'object' && item) {
            // Store both id (valueField) and name (labelField) as an object.
            fieldValue = {
              [cfg.valueField || 'id']: val,
              [cfg.labelField || 'name']: item.label,
            };
          }
          const patch: Record<string, any> = { [f.id]: fieldValue };
          if (item && cfg.fill?.length) {
            for (const fm of cfg.fill) {
              if (!fm.fieldId) continue;
              // A {{...}} value is a template (combine several parts); otherwise a single path.
              patch[fm.fieldId] = /\{\{/.test(fm.from || '')
                ? fillTemplate(fm.from, item.data)
                : digPath(item.data, fm.from);
            }
          }
          const nextVals = { ...values, ...patch };
          setValues(nextVals);
          Object.keys(patch).forEach((k) => setErrors((e) => ({ ...e, [k]: '' })));
          onChange?.(f.id, val, nextVals);
        }}
        placeholder={f.placeholder || 'Начните вводить…'}
        filterOption={false}
        notFoundContent={busy ? <Spin size="small" /> : null}
        allowClear
      />,
    );
  }

  function fileControl(f: Field) {
    const fileList = (values[f.id] || []).map((x: any, i: number) => ({ uid: String(i), name: x.filename, url: x.url, status: 'done' }));
    return wrap(
      f,
      <Upload
        listType={f.type === 'image' ? 'picture' : 'text'}
        fileList={fileList}
        maxCount={f.fileValidation?.maxCount || 5}
        accept={f.fileValidation?.extensions}
        beforeUpload={async (file) => {
          const err = validateFileMeta(file, f.fileValidation) || (await validateImageDims(file, f.fileValidation));
          if (err) { message.error(err); return Upload.LIST_IGNORE; }
          if (fileUpload) {
            try {
              const res = await fileUpload(file);
              setValue(f, [...(values[f.id] || []), res]);
            } catch { message.error('Ошибка загрузки файла'); }
          }
          return false; // prevent auto-upload; we handle it
        }}
        onRemove={(file) => {
          setValue(f, (values[f.id] || []).filter((x: any) => x.filename !== file.name));
        }}
      >
        <Button icon={<UploadOutlined />}>Загрузить</Button>
      </Upload>,
    );
  }

  function renderField(f: Field): React.ReactNode {
    const v = values[f.id];
    switch (f.type) {
      case 'section_header':
        return <Title level={f.headingLevel || 3} style={{ marginBottom: 0, marginTop: 8 }}>{f.label}</Title>;
      case 'divider':
        return <div style={{ borderTop: '1px solid #eee', margin: '8px 0' }} />;
      case 'info_text':
        return <Paragraph type="secondary" style={{ marginBottom: 0 }}>{f.label}</Paragraph>;
      case 'textarea':
        return wrap(f, <Input.TextArea rows={f.rows || 3} placeholder={f.placeholder || ''} value={v} readOnly={f.readOnly} onChange={(e) => setValue(f, e.target.value)} />);
      case 'number':
      case 'amount':
        return wrap(f, <InputNumber style={{ width: '100%' }} value={v} readOnly={f.readOnly} min={f.validation?.min} max={f.validation?.max} step={f.validation?.step} onChange={(x) => setValue(f, x)} addonAfter={f.type === 'amount' ? '₽' : undefined} />);
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
      // Multi-select over static options (Operaton checklist/taglist). The
      // dictionary-backed variant is dict_checkbox; this one carries its values
      // inline, so nothing has to be materialised into the dictionaries section.
      case 'checkbox_group':
        return wrap(f, <Checkbox.Group value={Array.isArray(v) ? v : []} options={(f.options || []).map((o) => ({ label: o.label, value: o.value }))} onChange={(x) => setValue(f, x)} />, false);
      case 'checkbox':
        return (
          <div>
            <Checkbox checked={!!v} onChange={(e) => setValue(f, e.target.checked)}>{f.label}{isRequired(f) && <span style={{ color: '#ff4d4f' }}> *</span>}</Checkbox>
            {errors[f.id] && <div style={{ color: '#ff4d4f', fontSize: 12 }}>{errors[f.id]}</div>}
          </div>
        );
      case 'same_as':
        return (
          <div>
            <Checkbox checked={!!v} onChange={(e) => setValue(f, e.target.checked)}>{f.label}</Checkbox>
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
      case 'datetime':
        return wrap(f, <DatePicker showTime style={{ width: '100%' }} onChange={(_, s) => setValue(f, s)} />);
      case 'time':
        return wrap(f, <TimePicker style={{ width: '100%' }} onChange={(_, s) => setValue(f, s)} />);
      case 'color':
        return wrap(f, <ColorPicker showText value={v} onChange={(_, hex) => setValue(f, hex)} />);
      case 'signature':
        return wrap(f, <SignaturePad value={v} onChange={(dataUrl) => setValue(f, dataUrl)} />);
      case 'rating':
        return wrap(f, <Rate value={v} onChange={(x) => setValue(f, x)} />);
      case 'slider':
        return wrap(f, <Slider value={v} min={f.validation?.min ?? 0} max={f.validation?.max ?? 100} onChange={(x) => setValue(f, x)} />);
      case 'dict_select':
      case 'dict_radio':
      case 'dict_checkbox':
        return dictControl(f);
      case 'suggest':
        return suggestControl(f);
      case 'file':
      case 'image':
        return fileControl(f);
      default: {
        // text, email, phone, url, password, inn, snils, passport, bik, kpp, ogrn, card, ...
        const isPass = f.type === 'password';
        const Comp: any = isPass ? Input.Password : Input;
        const preset = f.mask?.preset || (['phone', 'inn', 'snils', 'passport', 'bik', 'kpp', 'ogrn', 'card'].includes(f.type) ? f.type : undefined);
        return wrap(
          f,
          <Comp
            placeholder={f.placeholder || ''}
            value={v}
            readOnly={f.readOnly}
            inputMode={preset && preset !== 'phone' ? 'numeric' : undefined}
            onChange={(e: any) => setValue(f, preset || f.mask?.pattern ? maskValue(f.type, f.mask?.pattern, preset, e.target.value) : e.target.value)}
          />,
        );
      }
    }
  }
});

export default FormRenderer;
