import { DeleteOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import {
  Alert, Button, Card, Col, Collapse, Empty, Form as AntForm, Input, InputNumber, Radio,
  Row, Segmented, Select, Space, Switch, Tag, Tooltip, Typography,
} from 'antd';
import { useState } from 'react';
import { testFlow } from '../api';
import { MAIN_STEP } from '../renderer/flow';
import type {
  Connection, Field, FlowStep, FlowTestResult, OutcomeAction, ResponseRule,
  RuleCondition, StepRequest, SubmitButton, SubmitConfig,
} from '../types';

const { Text, Paragraph } = Typography;

const OPERATORS = [
  { label: 'равно', value: 'eq' },
  { label: 'не равно', value: 'neq' },
  { label: 'больше', value: 'gt' },
  { label: 'больше или равно', value: 'gte' },
  { label: 'меньше', value: 'lt' },
  { label: 'меньше или равно', value: 'lte' },
  { label: 'одно из (через запятую)', value: 'in' },
  { label: 'содержит', value: 'contains' },
  { label: 'по регулярке', value: 'regex' },
  { label: 'заполнено', value: 'not_empty' },
  { label: 'пусто', value: 'empty' },
];
const NO_VALUE_OPS = ['exists', 'empty', 'not_empty'];

const SOURCES = [
  { label: 'Поле ответа', value: 'body' },
  { label: 'HTTP-статус', value: 'status' },
  { label: 'Поле формы', value: 'field' },
  { label: 'Ошибка связи', value: 'error' },
];

let seq = 0;
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(seq += 1)}`;

interface Props {
  submit: SubmitConfig;
  fields: Field[];
  connections: Connection[];
  formPk: string;
  /** Шаг, открытый в предпросмотре справа. */
  previewStep: string;
  onPreviewStep: (step: string) => void;
  onChange: (submit: SubmitConfig) => void;
}

/**
 * Настройка флоу отправки: кнопка → куда слать JSON → как разобрать ответ →
 * что показать. Каждый шаг — самостоятельная связка из этих четырёх блоков,
 * поэтому «одобрено → добери ещё 3 поля → отправь уже в CRM» настраивается
 * тем же самым редактором, что и первый экран.
 */
export default function FlowEditor({
  submit, fields, connections, formPk, previewStep, onPreviewStep, onChange,
}: Props) {
  const steps: FlowStep[] = submit.steps?.length
    ? submit.steps
    : [{
      id: MAIN_STEP,
      button: { text: 'Отправить' },
      request: submit.webhookUrl
        ? { transport: 'webhook', webhookUrl: submit.webhookUrl }
        : { transport: 'none' },
      rules: [{
        id: 'default',
        name: 'По умолчанию',
        when: [],
        then: submit.redirectUrl
          ? { kind: 'redirect', url: submit.redirectUrl }
          : { kind: 'message', messageType: 'success', text: submit.successMessage || 'Спасибо!' },
      }],
    }];

  const [active, setActive] = useState<string>(steps[0]?.id || MAIN_STEP);
  const step = steps.find((s) => s.id === active) || steps[0];

  function writeSteps(next: FlowStep[]) {
    // Legacy-ключи стираются при первом же сохранении флоу: держать две
    // конфигурации одновременно — верный способ отправить не туда.
    const { webhookUrl, successMessage, redirectUrl, ...rest } = submit;
    void webhookUrl; void successMessage; void redirectUrl;
    onChange({ ...rest, steps: next });
  }

  const patchStep = (id: string, patch: Partial<FlowStep>) =>
    writeSteps(steps.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  function addStep() {
    const id = newId('step');
    writeSteps([...steps, {
      id,
      title: 'Новый шаг',
      description: '',
      button: { text: 'Отправить' },
      request: { transport: 'none' },
      rules: [{ id: newId('rule'), name: 'Готово', when: [], then: { kind: 'message', messageType: 'success', text: 'Спасибо!' } }],
    }]);
    setActive(id);
    onPreviewStep(id);
  }

  function removeStep(id: string) {
    writeSteps(steps.filter((s) => s.id !== id));
    setActive(MAIN_STEP);
    onPreviewStep(MAIN_STEP);
  }

  const stepFields = (id: string) => fields.filter((f) => (f.step || MAIN_STEP) === id);

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="Как это работает"
        description={
          <span style={{ fontSize: 12 }}>
            Шаг = <b>поля</b> + <b>кнопка</b> + <b>куда уходит JSON</b> + <b>правила разбора ответа</b>.
            Правило может показать сообщение, открыть следующий шаг с новыми полями или увести по ссылке.
            Условия считаются на сервере — тело ответа не попадает в браузер, пока вы сами не разрешите.
          </span>
        }
      />

      <Space wrap style={{ marginBottom: 12 }}>
        <Segmented
          value={active}
          onChange={(v) => { setActive(String(v)); onPreviewStep(String(v)); }}
          options={steps.map((s) => ({
            label: `${s.id === MAIN_STEP ? '1. ' : ''}${s.title || (s.id === MAIN_STEP ? 'Первый шаг' : s.id)} · ${stepFields(s.id).length} полей`,
            value: s.id,
          }))}
        />
        <Button size="small" icon={<PlusOutlined />} onClick={addStep}>Шаг</Button>
        {step && step.id !== MAIN_STEP && (
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeStep(step.id)}>
            Удалить шаг
          </Button>
        )}
      </Space>

      {!stepFields(step.id).length && (
        <Alert
          type="warning" showIcon style={{ marginBottom: 12 }}
          message="На этом шаге пока нет полей"
          description={<span style={{ fontSize: 12 }}>Откройте вкладку «Поля», отредактируйте поле и выберите ему шаг «{step.title || step.id}».</span>}
        />
      )}

      {step.id !== MAIN_STEP && (
        <Row gutter={12} style={{ marginBottom: 8 }}>
          <Col span={10}>
            <AntForm layout="vertical">
              <AntForm.Item label="Название шага" style={{ marginBottom: 8 }}>
                <Input value={step.title} onChange={(e) => patchStep(step.id, { title: e.target.value })} />
              </AntForm.Item>
            </AntForm>
          </Col>
          <Col span={14}>
            <AntForm layout="vertical">
              <AntForm.Item label="Подпись под названием" style={{ marginBottom: 8 }}>
                <Input value={step.description} placeholder="Кредит одобрен — заполните данные для зачисления"
                  onChange={(e) => patchStep(step.id, { description: e.target.value })} />
              </AntForm.Item>
            </AntForm>
          </Col>
        </Row>
      )}

      <Collapse
        defaultActiveKey={['btn', 'req', 'rules']}
        items={[
          {
            key: 'btn',
            label: <b>2 · Кнопка отправки</b>,
            children: <ButtonBlock value={step.button} onChange={(button) => patchStep(step.id, { button })} />,
          },
          {
            key: 'req',
            label: <b>3 · Куда отправить JSON с полями</b>,
            children: (
              <RequestBlock
                value={step.request}
                connections={connections}
                fields={fields}
                onChange={(request) => patchStep(step.id, { request })}
              />
            ),
          },
          {
            key: 'rules',
            label: <b>4–5 · Разбор ответа и что показать</b>,
            children: (
              <RulesBlock
                rules={step.rules || []}
                steps={steps}
                stepId={step.id}
                fields={fields}
                formPk={formPk}
                transport={step.request?.transport || 'none'}
                onChange={(rules) => patchStep(step.id, { rules })}
              />
            ),
          },
        ]}
      />
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
        Предпросмотр справа показывает шаг «{step.title || step.id}». Реальные запросы уходят
        только из опубликованной формы — {previewStep === step.id ? 'здесь' : 'в предпросмотре'} внешние системы не дёргаются.
      </Text>
    </div>
  );
}

// ---------------------------------------------------------------- 2. Кнопка
function ButtonBlock({ value, onChange }: { value?: SubmitButton; onChange: (v: SubmitButton) => void }) {
  const v = value || {};
  const patch = (p: Partial<SubmitButton>) => onChange({ ...v, ...p });
  return (
    <AntForm layout="vertical">
      <Row gutter={12}>
        <Col span={10}>
          <AntForm.Item label="Текст кнопки" style={{ marginBottom: 8 }}>
            <Input value={v.text} placeholder="Отправить" onChange={(e) => patch({ text: e.target.value })} />
          </AntForm.Item>
        </Col>
        <Col span={8}>
          <AntForm.Item label="Текст во время отправки" style={{ marginBottom: 8 }}
            tooltip="Показывается, пока идёт запрос. Пусто — останется основной текст.">
            <Input value={v.loadingText} placeholder="Проверяем…" onChange={(e) => patch({ loadingText: e.target.value })} />
          </AntForm.Item>
        </Col>
        <Col span={6}>
          <AntForm.Item label="Размер" style={{ marginBottom: 8 }}>
            <Select
              value={v.size || 'large'}
              onChange={(size) => patch({ size })}
              options={[{ label: 'Крупная', value: 'large' }, { label: 'Обычная', value: 'middle' }, { label: 'Мелкая', value: 'small' }]}
            />
          </AntForm.Item>
        </Col>
      </Row>
      <Space size={24} wrap>
        <span>
          <Switch size="small" checked={v.block === undefined ? true : v.block} onChange={(block) => patch({ block })} />
          <Text style={{ marginLeft: 8 }}>Во всю ширину</Text>
        </span>
        <span>
          <Text type="secondary" style={{ marginRight: 8 }}>Выравнивание</Text>
          <Segmented
            size="small"
            value={v.align || 'center'}
            onChange={(align) => patch({ align: align as SubmitButton['align'] })}
            options={[{ label: 'Слева', value: 'left' }, { label: 'По центру', value: 'center' }, { label: 'Справа', value: 'right' }]}
          />
        </span>
      </Space>
    </AntForm>
  );
}

// ---------------------------------------------------------------- 3. Запрос
function RequestBlock({
  value, connections, fields, onChange,
}: { value?: StepRequest; connections: Connection[]; fields: Field[]; onChange: (v: StepRequest) => void }) {
  const v = value || {};
  const transport = v.transport || (v.webhookUrl ? 'webhook' : v.connectionId ? 'rest' : 'none');
  const patch = (p: Partial<StepRequest>) => onChange({ ...v, ...p });

  return (
    <AntForm layout="vertical">
      <Radio.Group
        value={transport}
        onChange={(e) => patch({ transport: e.target.value })}
        optionType="button"
        buttonStyle="solid"
        style={{ marginBottom: 12 }}
        options={[
          { label: 'Никуда (только сохранить)', value: 'none' },
          { label: 'Вебхук (URL)', value: 'webhook' },
          { label: 'REST через подключение', value: 'rest' },
        ]}
      />

      {transport === 'none' && (
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          Данные шага сохраняются в «Заполнениях», наружу ничего не уходит. Правила ниже
          всё равно работают — например, чтобы просто показать сообщение.
        </Paragraph>
      )}

      {transport === 'webhook' && (
        <>
          <AntForm.Item label="Webhook URL" style={{ marginBottom: 8 }}
            tooltip="Поддерживает {{taskId}}, {{formId}}, {{submissionId}} и любые ключи из context виджета.">
            <Input value={v.webhookUrl} placeholder="https://crm.example/api/hooks/forms"
              onChange={(e) => patch({ webhookUrl: e.target.value })} />
          </AntForm.Item>
          <AntForm.Item label="Доставка" style={{ marginBottom: 8 }}>
            <Radio.Group value={v.delivery || 'async'} onChange={(e) => patch({ delivery: e.target.value })}>
              <Radio value="async">В фоне с ретраями (ответ не разбирается)</Radio>
              <Radio value="sync">Дождаться ответа (можно разбирать правилами)</Radio>
            </Radio.Group>
          </AntForm.Item>
          {(v.delivery || 'async') === 'async' && (
            <Alert type="info" showIcon style={{ marginBottom: 8 }}
              message="Фоновая доставка не даёт ответа"
              description={<span style={{ fontSize: 12 }}>Правила ниже увидят пустой ответ. Чтобы ветвиться по ответу — выберите «Дождаться ответа» или REST-подключение.</span>} />
          )}
        </>
      )}

      {transport === 'rest' && (
        <>
          <Row gutter={12}>
            <Col span={12}>
              <AntForm.Item label="Подключение" style={{ marginBottom: 8 }}
                tooltip="Настраивается в разделе «Подключения». Ключи и токены остаются на сервере и в браузер не попадают.">
                <Select
                  value={v.connectionId}
                  placeholder="Выберите подключение"
                  onChange={(connectionId) => patch({ connectionId })}
                  options={connections.map((c) => ({ label: `${c.name} (${c.base_url})`, value: c.id }))}
                />
              </AntForm.Item>
            </Col>
            <Col span={5}>
              <AntForm.Item label="Метод" style={{ marginBottom: 8 }}>
                <Select
                  value={v.method || 'POST'}
                  onChange={(method) => patch({ method })}
                  options={['POST', 'PUT', 'PATCH', 'GET'].map((m) => ({ label: m, value: m }))}
                />
              </AntForm.Item>
            </Col>
            <Col span={7}>
              <AntForm.Item label="Адрес (endpoint)" style={{ marginBottom: 8 }}
                tooltip="Дописывается к базовому URL подключения. Можно подставлять поля: /clients/{{inn}}">
                <Input value={v.endpoint} placeholder="/decision" onChange={(e) => patch({ endpoint: e.target.value })} />
              </AntForm.Item>
            </Col>
          </Row>
          <AntForm.Item label="Тело запроса" style={{ marginBottom: 8 }}>
            <Radio.Group value={v.payload || 'envelope'} onChange={(e) => patch({ payload: e.target.value })}>
              <Radio value="envelope">Конверт (formId, submissionId, data)</Radio>
              <Radio value="data">Только данные: {'{"data": {…}}'}</Radio>
              <Radio value="custom">Свой JSON-шаблон</Radio>
            </Radio.Group>
          </AntForm.Item>
          {v.payload === 'custom' && (
            <AntForm.Item
              style={{ marginBottom: 8 }}
              extra={
                <span style={{ fontSize: 12 }}>
                  Значение целиком в кавычках подставляется <b>с типом</b>: <code>"{'{{amount}}'}"</code> → число.
                  Поля: {fields.filter((f) => f.id).slice(0, 12).map((f) => <Tag key={f.id} style={{ fontFamily: 'monospace' }}>{`{{${f.id}}}`}</Tag>)}
                </span>
              }
            >
              <Input.TextArea
                rows={5}
                value={v.bodyTemplate}
                placeholder={'{\n  "sum": "{{amount}}",\n  "client": { "fio": "{{fio}}" }\n}'}
                onChange={(e) => patch({ bodyTemplate: e.target.value })}
                style={{ fontFamily: 'monospace', fontSize: 12 }}
              />
            </AntForm.Item>
          )}
          <HeadersEditor value={v.headers || []} onChange={(headers) => patch({ headers })} />
        </>
      )}

      {transport !== 'none' && (
        <div style={{ marginTop: 8 }}>
          <Switch size="small" checked={!!v.exposeResponse} onChange={(exposeResponse) => patch({ exposeResponse })} />
          <Text style={{ marginLeft: 8 }}>Отдавать сырой ответ в браузер</Text>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 2 }}>
            По умолчанию выключено: ответ разбирается на сервере, в страницу уходит только готовый текст.
            Включайте, если ответ действительно нужен принимающей стороне на клиенте.
          </Text>
        </div>
      )}
    </AntForm>
  );
}

function HeadersEditor({ value, onChange }: { value: { name: string; value: string }[]; onChange: (v: any[]) => void }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>Дополнительные заголовки</Text>
      {value.map((h, i) => (
        <Space key={i} style={{ display: 'flex', marginTop: 4 }}>
          <Input placeholder="X-Request-Id" value={h.name} style={{ width: 200 }}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <Input placeholder="{{submissionId}}" value={h.value} style={{ width: 260, fontFamily: 'monospace', fontSize: 12 }}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
          <DeleteOutlined onClick={() => onChange(value.filter((_, j) => j !== i))} />
        </Space>
      ))}
      <Button size="small" icon={<PlusOutlined />} style={{ marginTop: 4 }}
        onClick={() => onChange([...value, { name: '', value: '' }])}>Заголовок</Button>
    </div>
  );
}

// ------------------------------------------------------- 4–5. Правила и исход
function RulesBlock({
  rules, steps, stepId, fields, formPk, transport, onChange,
}: {
  rules: ResponseRule[]; steps: FlowStep[]; stepId: string; fields: Field[];
  formPk: string; transport: string; onChange: (r: ResponseRule[]) => void;
}) {
  const [sample, setSample] = useState('{\n  "decision": "approved",\n  "approvedLimit": 300000\n}');
  const [sampleStatus, setSampleStatus] = useState(200);
  const [result, setResult] = useState<FlowTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  const patchRule = (i: number, patch: Partial<ResponseRule>) =>
    onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const move = (i: number, dir: -1 | 1) => {
    const next = [...rules];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  async function runTest() {
    setTesting(true);
    setTestError(null);
    try {
      const parsed = sample.trim() ? JSON.parse(sample) : {};
      setResult(await testFlow(formPk, { step: stepId, status: sampleStatus, response: parsed }));
    } catch (e: any) {
      setResult(null);
      setTestError(e?.message?.includes('JSON') ? 'Образец не разбирается как JSON' : (e?.response?.data?.detail || String(e)));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div>
      <Paragraph type="secondary" style={{ fontSize: 12 }}>
        Правила проверяются <b>сверху вниз</b>, срабатывает первое подошедшее. Правило без условий —
        это «иначе», его место в конце. Если не сработало ни одно, форма покажет нейтральное «Спасибо!».
      </Paragraph>

      {!rules.length && <Empty description="Правил нет — форма просто скажет «Спасибо!»" />}

      {rules.map((rule, i) => (
        <Card
          key={rule.id || i}
          size="small"
          style={{ marginBottom: 8 }}
          title={
            <Space>
              <Tag color="blue">{i + 1}</Tag>
              <Input
                variant="borderless"
                placeholder="Название правила (напр. «Одобрено»)"
                value={rule.name}
                style={{ width: 260 }}
                onChange={(e) => patchRule(i, { name: e.target.value })}
              />
              {!rule.when?.length && <Tag>иначе</Tag>}
            </Space>
          }
          extra={
            <Space size={2}>
              <Button size="small" type="text" disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
              <Button size="small" type="text" disabled={i === rules.length - 1} onClick={() => move(i, 1)}>↓</Button>
              <Button size="small" type="text" danger icon={<DeleteOutlined />}
                onClick={() => onChange(rules.filter((_, j) => j !== i))} />
            </Space>
          }
        >
          <ConditionsEditor
            conditions={rule.when || []}
            match={rule.match || 'all'}
            fields={fields}
            transport={transport}
            onChange={(when, match) => patchRule(i, { when, match })}
          />
          <ActionEditor
            action={rule.then}
            steps={steps}
            stepId={stepId}
            fields={fields}
            onChange={(then) => patchRule(i, { then })}
          />
        </Card>
      ))}

      <Space>
        <Button size="small" icon={<PlusOutlined />} onClick={() => onChange([...rules, {
          id: newId('rule'), name: '', when: [{ source: 'body', path: '', operator: 'eq', value: '' }],
          then: { kind: 'message', messageType: 'success', text: 'Спасибо!' },
        }])}>Правило</Button>
        <Button size="small" onClick={() => onChange([...rules, {
          id: newId('rule'), name: 'Иначе', when: [],
          then: { kind: 'message', messageType: 'success', text: 'Спасибо!' },
        }])}>Правило «иначе»</Button>
      </Space>

      <Card size="small" title="Тест: какое правило сработает" style={{ marginTop: 12, background: '#fafafa' }}
        extra={<Button size="small" type="primary" ghost icon={<ThunderboltOutlined />} loading={testing} onClick={runTest}>Проверить</Button>}>
        <Row gutter={12}>
          <Col span={5}>
            <Text type="secondary" style={{ fontSize: 12 }}>HTTP-статус</Text>
            <InputNumber value={sampleStatus} onChange={(v) => setSampleStatus(Number(v) || 200)} style={{ width: '100%' }} />
          </Col>
          <Col span={19}>
            <Text type="secondary" style={{ fontSize: 12 }}>Образец ответа (JSON)</Text>
            <Input.TextArea rows={4} value={sample} onChange={(e) => setSample(e.target.value)}
              style={{ fontFamily: 'monospace', fontSize: 12 }} />
          </Col>
        </Row>
        {testError && <Alert type="error" showIcon style={{ marginTop: 8 }} message={testError} />}
        {result && (
          <div style={{ marginTop: 8 }}>
            {result.trace.map((t) => (
              <Tag key={t.id} color={t.matched ? 'green' : 'default'}>
                {t.matched ? '✓' : '✕'} {t.name || t.id}
              </Tag>
            ))}
            <div style={{ marginTop: 6 }}>
              <OutcomePreview outcome={result.outcome} matched={result.matchedRuleId} />
            </div>
          </div>
        )}
        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6 }}>
          Тест гоняет те же правила, что и боевой submit — по <b>черновику</b>, поэтому проверять можно до публикации.
        </Text>
      </Card>
    </div>
  );
}

function OutcomePreview({ outcome, matched }: { outcome: FlowTestResult['outcome']; matched?: string | null }) {
  if (!matched) {
    return <Alert type="warning" showIcon message="Ни одно правило не подошло — форма покажет «Спасибо!»" />;
  }
  if (outcome.kind === 'fields') {
    return outcome.stepExists ? (
      <Alert
        type="info" showIcon
        message={`Откроется шаг «${outcome.stepTitle || outcome.stepId}» (${outcome.fieldIds?.length || 0} полей)`}
        description={outcome.values && Object.keys(outcome.values).length
          ? <span style={{ fontSize: 12 }}>Подставится: {Object.entries(outcome.values).map(([k, v]) => <Tag key={k}>{k} = {String(v)}</Tag>)}</span>
          : undefined}
      />
    ) : (
      <Alert type="error" showIcon message={`Шаг «${outcome.stepId}» не найден — правило сломано`} />
    );
  }
  if (outcome.kind === 'redirect') {
    return <Alert type="info" showIcon message={`Переход на ${outcome.url || '(пустой URL)'}`} />;
  }
  return (
    <Alert
      type={outcome.messageType || 'success'} showIcon
      message={outcome.title || outcome.text || '(пустое сообщение)'}
      description={outcome.title && outcome.text ? outcome.text : undefined}
    />
  );
}

function ConditionsEditor({
  conditions, match, fields, transport, onChange,
}: {
  conditions: RuleCondition[]; match: 'all' | 'any'; fields: Field[]; transport: string;
  onChange: (c: RuleCondition[], match: 'all' | 'any') => void;
}) {
  const patch = (i: number, p: Partial<RuleCondition>) =>
    onChange(conditions.map((c, j) => (j === i ? { ...c, ...p } : c)), match);

  return (
    <div style={{ marginBottom: 8 }}>
      <Space style={{ marginBottom: 4 }}>
        <Text strong style={{ fontSize: 12 }}>Когда</Text>
        {conditions.length > 1 && (
          <Segmented size="small" value={match} onChange={(m) => onChange(conditions, m as 'all' | 'any')}
            options={[{ label: 'все условия', value: 'all' }, { label: 'любое условие', value: 'any' }]} />
        )}
        {!conditions.length && <Text type="secondary" style={{ fontSize: 12 }}>условий нет — правило сработает всегда</Text>}
      </Space>
      {conditions.map((c, i) => (
        <Row gutter={6} key={i} style={{ marginBottom: 4 }} align="middle">
          <Col span={5}>
            <Select size="small" style={{ width: '100%' }} value={c.source} options={SOURCES}
              onChange={(source) => patch(i, { source })} />
          </Col>
          <Col span={6}>
            {c.source === 'field' ? (
              <Select size="small" style={{ width: '100%' }} showSearch optionFilterProp="label"
                value={c.path} placeholder="поле формы"
                options={fields.filter((f) => f.id).map((f) => ({ label: `${f.label} (${f.id})`, value: f.id }))}
                onChange={(path) => patch(i, { path })} />
            ) : c.source === 'body' ? (
              <Input size="small" placeholder="decision или result.limit" value={c.path}
                style={{ fontFamily: 'monospace', fontSize: 12 }}
                onChange={(e) => patch(i, { path: e.target.value })} />
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>{c.source === 'status' ? 'код ответа' : 'текст ошибки'}</Text>
            )}
          </Col>
          <Col span={7}>
            <Select size="small" style={{ width: '100%' }} value={c.operator} options={OPERATORS}
              onChange={(operator) => patch(i, { operator })} />
          </Col>
          <Col span={5}>
            <Input size="small" placeholder="значение" value={c.value ?? ''}
              disabled={NO_VALUE_OPS.includes(c.operator)}
              onChange={(e) => patch(i, { value: e.target.value })} />
          </Col>
          <Col span={1}>
            <DeleteOutlined onClick={() => onChange(conditions.filter((_, j) => j !== i), match)} />
          </Col>
        </Row>
      ))}
      <Space>
        <Button size="small" icon={<PlusOutlined />}
          onClick={() => onChange([...conditions, { source: 'body', path: '', operator: 'eq', value: '' }], match)}>
          Условие
        </Button>
        {transport === 'none' && conditions.some((c) => c.source === 'body') && (
          <Tooltip title="Шаг никуда не отправляет данные, значит тело ответа всегда пустое">
            <Tag color="orange">ответа не будет</Tag>
          </Tooltip>
        )}
      </Space>
    </div>
  );
}

function ActionEditor({
  action, steps, stepId, fields, onChange,
}: { action: OutcomeAction; steps: FlowStep[]; stepId: string; fields: Field[]; onChange: (a: OutcomeAction) => void }) {
  const patch = (p: Partial<OutcomeAction>) => onChange({ ...action, ...p });
  const targets = steps.filter((s) => s.id !== stepId);
  const targetFields = fields.filter((f) => (f.step || MAIN_STEP) === action.stepId);

  return (
    <div style={{ borderTop: '1px dashed #eee', paddingTop: 8 }}>
      <Text strong style={{ fontSize: 12, marginRight: 8 }}>То</Text>
      <Segmented
        size="small"
        value={action.kind}
        onChange={(kind) => patch({ kind: kind as OutcomeAction['kind'] })}
        options={[
          { label: 'Показать сообщение', value: 'message' },
          { label: 'Показать новые поля', value: 'fields' },
          { label: 'Перейти по ссылке', value: 'redirect' },
        ]}
      />

      {action.kind === 'message' && (
        <Row gutter={6} style={{ marginTop: 8 }}>
          <Col span={5}>
            <Select size="small" style={{ width: '100%' }} value={action.messageType || 'success'}
              onChange={(messageType) => patch({ messageType })}
              options={[
                { label: 'Успех', value: 'success' }, { label: 'Инфо', value: 'info' },
                { label: 'Внимание', value: 'warning' }, { label: 'Ошибка', value: 'error' },
              ]} />
          </Col>
          <Col span={8}>
            <Input size="small" placeholder="Заголовок" value={action.title}
              onChange={(e) => patch({ title: e.target.value })} />
          </Col>
          <Col span={11}>
            <Input size="small" placeholder="Текст. Можно {{resp.reason}} и {{поле_формы}}" value={action.text}
              onChange={(e) => patch({ text: e.target.value })} />
          </Col>
        </Row>
      )}

      {action.kind === 'fields' && (
        <div style={{ marginTop: 8 }}>
          <Space wrap>
            <Text type="secondary" style={{ fontSize: 12 }}>Открыть шаг</Text>
            <Select size="small" style={{ width: 220 }} value={action.stepId || undefined} placeholder="выберите шаг"
              onChange={(sid) => patch({ stepId: sid })}
              options={targets.map((s) => ({ label: `${s.title || s.id} (${fields.filter((f) => (f.step || MAIN_STEP) === s.id).length} полей)`, value: s.id }))} />
            {!targets.length && <Tag color="orange">сначала добавьте второй шаг</Tag>}
          </Space>
          <div style={{ marginTop: 6 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>Подставить в поля значения из ответа</Text>
            {(action.fill || []).map((f, i) => (
              <Space key={i} style={{ display: 'flex', marginTop: 4 }}>
                <Select size="small" style={{ width: 220 }} value={f.fieldId || undefined} placeholder="поле шага"
                  showSearch optionFilterProp="label"
                  options={(targetFields.length ? targetFields : fields).map((x) => ({ label: `${x.label} (${x.id})`, value: x.id }))}
                  onChange={(fieldId) => patch({ fill: (action.fill || []).map((y, j) => (j === i ? { ...y, fieldId } : y)) })} />
                <span style={{ color: '#888' }}>←</span>
                <Input size="small" style={{ width: 240, fontFamily: 'monospace', fontSize: 12 }}
                  placeholder="resp.approvedLimit" value={f.from}
                  onChange={(e) => patch({ fill: (action.fill || []).map((y, j) => (j === i ? { ...y, from: e.target.value } : y)) })} />
                <DeleteOutlined onClick={() => patch({ fill: (action.fill || []).filter((_, j) => j !== i) })} />
              </Space>
            ))}
            <Button size="small" icon={<PlusOutlined />} style={{ marginTop: 4 }}
              onClick={() => patch({ fill: [...(action.fill || []), { fieldId: '', from: '' }] })}>Подстановка</Button>
          </div>
        </div>
      )}

      {action.kind === 'redirect' && (
        <Row gutter={6} style={{ marginTop: 8 }} align="middle">
          <Col span={13}>
            <Input size="small" placeholder="https://example.com/ok?id={{submissionId}}" value={action.url}
              onChange={(e) => patch({ url: e.target.value })} />
          </Col>
          <Col span={5}>
            <InputNumber size="small" style={{ width: '100%' }} min={0} step={500} addonAfter="мс"
              value={action.delayMs} placeholder="задержка"
              onChange={(delayMs) => patch({ delayMs: Number(delayMs) || 0 })} />
          </Col>
          <Col span={6}>
            <Switch size="small" checked={!!action.newTab} onChange={(newTab) => patch({ newTab })} />
            <Text style={{ marginLeft: 6, fontSize: 12 }}>в новой вкладке</Text>
          </Col>
        </Row>
      )}
    </div>
  );
}
