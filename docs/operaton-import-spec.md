# Спецификация: раздел «Из Оператона» и импорт форм Operaton

Статус: **реализовано** (Фазы 1 и 3), см. §16 «Что фактически сделано»
Ветки: `sota-forms` → `claude/operator-forms-section-6ckxvw`,
`sota-bpmn` → `claude/sota-forms-integration`
Дата: 2026-07-30

> Разделы §1–§15 — исходная спецификация. Реализация отличается в двух местах,
> оба описаны в §16: импорт идёт **и по API sota-bpmn**, а не только из файла, и
> возврат данных в процесс (изначально Фаза 3) вошёл в первый релиз.

---

## 1. Задача

1. В реестре форм появляется **отдельный раздел «Из Оператона»** — формы, пришедшие
   из BPM-движка Operaton, визуально и по фильтру отделены от форм, созданных у нас.
2. Пользователь может **импортировать форму в формате Operaton**; она конвертируется
   в нашу схему (`FormSchema`) и сохраняется как обычная форма аккаунта.
3. Импортированная форма **редактируется существующим конструктором** без каких-либо
   ограничений — это обычный черновик, просто с пометкой источника.

Ключевой принцип: **импорт — это одноразовая конвертация, а не связь**. После импорта
форма живёт своей жизнью в нашей системе (версии, публикация, встраивание по `form-id`).
Обратная синхронизация в Operaton в эту доработку не входит (см. §12).

---

## 2. Что считаем «форматом Оператона»

Operaton (форк Camunda 7) допускает три способа задать форму пользовательской задачи:

| Формат | Что это | В этой доработке |
|---|---|---|
| **Operaton/Camunda Forms JSON** (`.form`, схема form-js) | JSON `{ "components": [...], "type": "default", "id": "...", "schemaVersion": N }` — то, что рисуется в редакторе форм Оператона | **Да, основной формат (Фаза 1)** |
| **`operaton:formData` / `camunda:formData` в BPMN XML** | `<userTask><extensionElements><operaton:formData><operaton:formField .../>` — «generated task forms» | **Да, Фаза 2** (опционально) |
| **Embedded / external HTML-формы** (`cam-variable-name`, `camunda-form-js` в HTML) | произвольный HTML+JS | **Нет.** Явно вне объёма — это не декларативная схема, автоматически в наши поля не переводится |

Определение формата при импорте — автоматическое, по содержимому файла:
* валидный JSON с массивом `components` → Operaton Forms JSON;
* текст, начинающийся с `<?xml` / содержащий `<bpmn:definitions` → BPMN (Фаза 2);
* иначе — ошибка `400` с понятным текстом.

---

## 3. Модель данных

### 3.1 Изменения в `backend/app/models.py` — таблица `forms`

```python
class Form(Base):
    ...
    # Откуда форма появилась: local (создана у нас) | operaton (импорт из BPM).
    source: Mapped[str] = mapped_column(String, default="local", index=True)
    # Паспорт импорта: ключ формы в Оператоне, версия схемы, карта переименований
    # ключей, отчёт конвертации. Только для чтения на фронте.
    source_meta: Mapped[dict] = mapped_column(JSONB, default=dict)
    # Исходная схема Оператона «как пришла» — для диффа и повторного импорта.
    source_schema: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
```

Структура `source_meta`:

```jsonc
{
  "format": "operaton_form_json",     // operaton_form_json | operaton_bpmn_formdata
  "operaton_form_id": "invoice_form", // поле id из схемы Оператона
  "schema_version": 17,
  "execution_platform": "Camunda Platform",
  "imported_at": "2026-07-30T10:00:00Z",
  "imported_by": "usr_...",
  "key_map": { "applicant.firstName": "applicant_firstName" },  // Operaton key → наш field.id
  "report": {
    "components_total": 24,
    "mapped": 21,
    "warnings": [ { "key": "amount", "code": "feel_expression_dropped", "message": "..." } ],
    "unsupported": [ { "key": "docs", "type": "documentPreview" } ]
  }
}
```

`key_map` обязателен: он единственная нить, по которой потом можно сопоставить наши
ответы с переменными процесса в Оператоне.

### 3.2 Миграция

БД поднимается через `Base.metadata.create_all` (`backend/app/db.py`), а он **не
добавляет колонки в уже существующие таблицы**. Поэтому в `init_db()` добавляется
идемпотентный догон схемы, выполняемый после `create_all`:

```python
_COLUMN_PATCHES = (
    "ALTER TABLE forms ADD COLUMN IF NOT EXISTS source VARCHAR DEFAULT 'local' NOT NULL",
    "ALTER TABLE forms ADD COLUMN IF NOT EXISTS source_meta JSONB DEFAULT '{}'::jsonb NOT NULL",
    "ALTER TABLE forms ADD COLUMN IF NOT EXISTS source_schema JSONB",
    "CREATE INDEX IF NOT EXISTS ix_forms_source ON forms (source)",
)
```

Существующие формы автоматически получают `source = 'local'` — поведение для них
не меняется.

---

## 4. Backend API

Новый модуль конвертации `backend/app/operaton.py` — **чистая функция без БД и без
FastAPI**, чтобы покрывалась юнит-тестами:

```python
@dataclass
class ConversionResult:
    form_id: str            # предложенный slug
    title: str
    grid_columns: int
    fields: list[dict]      # наши поля
    submit: dict
    key_map: dict[str, str]
    warnings: list[dict]
    unsupported: list[dict]

def convert_operaton_form(schema: dict) -> ConversionResult: ...
```

### 4.1 `POST /api/forms/import/operaton/preview`

Dry-run: конвертирует и **ничего не сохраняет**. Нужен, чтобы модалка импорта
показала пользователю, что получится, до записи в БД.

```jsonc
// запрос
{ "schema": { ... } }              // сырая схема Оператона
// ответ 200
{
  "form_id": "invoice_form",       // предложенный slug (уже проверен на занятость)
  "title": "Заявка на оплату",
  "grid_columns": 2,
  "fields": [ ... ],               // наши поля, готовые к рендеру в предпросмотре
  "report": { "components_total": 24, "mapped": 21, "warnings": [...], "unsupported": [...] }
}
```

### 4.2 `POST /api/forms/import/operaton`

Создаёт форму. Конвертация выполняется **до** записи, всё сохраняется одной
транзакцией — частично импортированных форм не бывает.

```jsonc
// запрос
{
  "schema": { ... },
  "form_id": "invoice_form",       // опционально, иначе берётся предложенный
  "title": "Заявка на оплату"      // опционально
}
// ответ 200 — FormOut + отчёт
{ "id": "form_...", "form_id": "invoice_form", ..., "source": "operaton", "report": { ... } }
```

Поведение:
* `status = "draft"`, `version = 0`, `published_version = null`, `has_draft_changes = true` —
  публикация остаётся отдельным ручным шагом (как сейчас);
* `source = "operaton"`, заполняются `source_meta` и `source_schema`;
* `form_id` санитизируется под текущее правило `^[a-z0-9_]+$` и дедуплицируется
  суффиксом `_2`, `_3`… — ровно как в существующем `POST /api/forms/import`.

### 4.3 `GET /api/forms` — новый параметр `source`

```
GET /api/forms?source=operaton   // только импортированные
GET /api/forms?source=local      // только свои
GET /api/forms                   // все (поведение не меняется)
```

Значение вне `local|operaton` → `400`. Фильтр комбинируется с существующими `q` и
`status`. В каждый элемент ответа добавляются `source` и укороченный
`source_meta` (`operaton_form_id`, `imported_at`, счётчики отчёта) — без
`source_schema`, чтобы не раздувать список.

### 4.4 Ошибки

| Код | Когда | Текст |
|---|---|---|
| 400 | не JSON / нет `components` | «Файл не похож на форму Оператона: не найден массив components» |
| 400 | `components` пуст | «В форме нет ни одного поля» |
| 400 | размер файла > 1 МБ | «Файл слишком большой (макс. 1 МБ)» |
| 409 | указанный `form_id` занят | как сейчас — «form_id '...' already exists» |

---

## 5. Правила конвертации: типы компонентов

Слева — `component.type` из схемы form-js, справа — наш `Field.type`
(`frontend/src/pages/fieldTypes.ts`).

| Operaton | Наш тип | Комментарий |
|---|---|---|
| `textfield` | `text` | при `validate.validationType = "email"` → `email`, `"phone"` → `phone` |
| `textarea` | `textarea` | |
| `number` | `number` | `decimalDigits` → `validation.step = 10^-n`; `increment` → `validation.step` |
| `checkbox` | `checkbox` | одиночное согласие/булево |
| `radio` | `radio_group` | статические `values` → `options` |
| `select` (single) | `select_static` | статические `values` → `options` |
| `checklist` | `checkbox_group` **(новый тип, см. §5.1)** | множественный выбор по статическим значениям |
| `taglist` | `checkbox_group` | предупреждение: визуально это не теги, а чекбоксы |
| `datetime` `subtype=date` | `date` | |
| `datetime` `subtype=time` | `time` | |
| `datetime` `subtype=datetime` | `datetime` | |
| `filepicker` | `file` | `accept` → `fileValidation.extensions`, `multiple` → `fileValidation.maxCount` |
| `text` (статический markdown) | `info_text` | markdown отдаётся как есть в `label` |
| `html` | `info_text` | HTML вырезается до текста, предупреждение |
| `separator` | `divider` | |
| `group` | `section_header` + плоский список детей | вложенность разворачивается, заголовок группы становится секцией |
| `spacer` | — | молча отбрасывается |
| `button` | — | отбрасывается, отправка у нас своя (`submit`) |
| `expression` | `calculated` **или** отбрасывание | конвертируется только тривиальная арифметика FEEL (см. §6.3) |
| `image`, `table`, `iframe`, `documentPreview`, `dynamiclist`, `filepicker` c `documentReference` | — | **не поддерживаются**, попадают в `unsupported`, поле не создаётся |

### 5.1 Требуемое расширение ядра: статический множественный выбор

У нас сейчас множественный выбор есть **только через справочник** (`dict_checkbox`).
У Оператона `checklist`/`taglist` несут значения прямо в схеме.

**Решение (рекомендуемое):** добавить тип `checkbox_group` — множественный выбор по
`field.options` (без справочника). Стоимость минимальна: в `FormRenderer` уже есть
ветка рендера `Checkbox.Group` для `dict_checkbox`, ей нужно лишь брать `options`
вместо элементов справочника; в `fieldTypes.ts` добавляется пункт в группу «Выбор».

**Отвергнутая альтернатива:** автосоздавать справочник на каждый `checklist`. Это
засоряет раздел «Справочники» служебными записями, создаёт сироты при удалении
формы и связывает две сущности там, где связи по смыслу нет.

---

## 6. Правила конвертации: свойства

### 6.1 Ключи полей

`component.key` → `field.id` со следующими правилами:
* form-js допускает вложенные пути (`applicant.firstName`); наш движок формул и
  зависимостей понимает только `[a-zA-Z0-9_]` (`frontend/src/renderer/engine.ts`,
  `REF_RE`). Поэтому `.` → `_`, остальные недопустимые символы → `_`;
* пустой/нечисловой результат → `field_1`, `field_2`…;
* коллизии после санитизации разрешаются суффиксом `_2`, `_3`…;
* **все переименования обязательно пишутся в `source_meta.key_map`.**

### 6.1a `form_id` и название формы

В схеме Оператона (Camunda 7, `schemaVersion` 16) **нет человекочитаемого названия
формы** — есть только технический `id`. Отсюда два правила:

**`form_id`.** Наш slug обязан соответствовать `^[a-z0-9_]+$`, а `id` Оператона
регулярно содержит camelCase (`form_obrashchenieKlienta_klassifikaciya`).
Преобразование: camelCase → snake_case (вставка `_` перед заглавной), затем
`lower()`, затем замена оставшихся недопустимых символов на `_`:

```
form_obrashchenieKlienta_klassifikaciya → form_obrashchenie_klienta_klassifikaciya
```

Простой `lower()` без разбиения camelCase дал бы нечитаемое
`form_obrashchenieklienta_klassifikaciya` — поэтому именно snake_case.

**`title`.** Берётся из `id` тем же преобразованием, но словами
(«Obrashchenie Klienta Klassifikaciya»). Такое название бесполезно для человека,
поэтому в модалке импорта поле **«Название» обязательно к заполнению** и снабжено
подсказкой «в схеме Оператона названия нет — задайте своё». Без этого реестр
заполняется техническими именами, которые невозможно различить глазом
(см. §7.3 — колонка «Источник» с ключом формы в тултипе).

### 6.2 Прямые соответствия

| Operaton | Наше поле |
|---|---|
| `label` | `label` (пусто → `key`) |
| `description` | `hint` |
| `defaultValue` | `defaultValue` |
| `readonly`, `disabled` | `readOnly` |
| `validate.required` | `required` |
| `validate.minLength` / `maxLength` | `validation.minLength` / `maxLength` |
| `validate.min` / `max` | `validation.min` / `max` |
| `validate.pattern` (`custom` regex) | `validation.regex` + `validation.regexMessage` из `validate.patternMessage` |
| `values: [{label, value}]` | `options: [{label, value}]` |
| `valuesKey` / `valuesExpression` (динамические опции из переменной процесса) | опции пустые + предупреждение `dynamic_values_unsupported` с текстом «привяжите справочник вручную» |

### 6.3 Условная видимость

form-js: `conditional: { hide: "=applicantAge < 18" }` — FEEL-выражение, и это
**условие скрытия**, то есть инверсия нашего `visibleIf`.

Поддерживается только простой одиночный предикат вида `=<key> <op> <literal>`,
где `op ∈ { =, !=, >, < }`. Преобразование инвертирует оператор:

| FEEL `hide` | Наш `visibleIf` |
|---|---|
| `=x = "a"` | `{ fieldId: x, operator: "neq", value: "a" }` |
| `=x != "a"` | `{ fieldId: x, operator: "eq", value: "a" }` |
| `=x > 10` | `{ fieldId: x, operator: "lt", value: 10 }` |
| `=x < 10` | `{ fieldId: x, operator: "gt", value: 10 }` |

Всё сложнее (`and`/`or`, вызовы функций, обращения к контексту) — **не
конвертируется**: поле импортируется без условия, в отчёт пишется предупреждение
`feel_condition_dropped` с исходным выражением, чтобы человек донастроил вручную.
То же правило для `expression`-компонентов и FEEL в `defaultValue`.

Причина такого консерватизма: молча переведённое «почти правильно» условие
видимости хуже, чем честно отсутствующее.

### 6.4 Раскладка

form-js использует **16-колоночную** сетку (`layout: { row: "Row_1", columns: 8 }`),
у нас `grid_columns ∈ 1..6` и `layout: {x, y, w, h}` (`LayoutEditor.tsx`).

Правила:
* если в схеме **нет ни одного `layout`** (частый случай — так экспортируют формы
  Camunda 7 / schemaVersion 16), то `grid_columns = 1`, все поля идут вертикальным
  стеком на всю ширину. Это ровно то, как форма рисуется в самом Оператоне;
  вариант «`grid_columns = 2`, по одному полю в строку» даёт поля в половину ширины
  и не соответствует оригиналу;
* если `layout` есть — `grid_columns = 2` по умолчанию;
* `w = max(1, round(columns / 16 * grid_columns))`;
* поля одной `row` идут в одну строку, `x` — накопительно, при переполнении
  переносятся вниз; `y` — порядковый номер строки;
* `h = 1`, кроме `textarea`/`signature`/`file` → `h = 2` (соответствует `TALL`
  в `LayoutEditor.tsx`);
* `section_header`, `divider`, `info_text` растягиваются на всю ширину.

### 6.5 Отправка

`submit` заполняется дефолтами аккаунта: `webhookUrl` — пустой (пользователь
задаёт сам), `successMessage` — «Форма отправлена». Никакой автоматической
привязки к Operaton REST (`/task/{id}/complete`) не делается — это Фаза 3.

---

## 7. Frontend

### 7.1 `frontend/src/types.ts`

```ts
export interface OperatonMeta {
  format: string;
  operaton_form_id?: string;
  schema_version?: number;
  imported_at?: string;
  report?: { components_total: number; mapped: number; warnings: any[]; unsupported: any[] };
}

export interface FormSchema {
  ...
  source?: 'local' | 'operaton';
  source_meta?: OperatonMeta;
}
```

### 7.2 `frontend/src/api.ts`

```ts
export interface FormQuery { q?; status?; source?: 'local' | 'operaton'; limit?; offset?; sort? }
export const previewOperatonForm = (schema: any) => ...  // POST /forms/import/operaton/preview
export const importOperatonForm = (body: { schema: any; form_id?: string; title?: string }) => ...
```

### 7.3 `frontend/src/pages/FormsList.tsx` — раздел «Из Оператона»

Вид: **вкладка-переключатель источника** рядом с существующим фильтром статусов —
это сохраняет единый реестр (поиск, статусы, пагинация, публикация работают
одинаково) и не плодит вторую почти-такую-же страницу.

```
[ Поиск… ]  [ Все | Опубликованные | Черновики | Архив ]  [ Все источники | Свои | Из Оператона ]
```

Изменения:
1. Второй `<Segmented>`: `Все источники` (`all`) / `Свои` (`local`) / `Из Оператона`
   (`operaton`); значение уходит в `listForms({ source })`, сбрасывает `page` на 1.
2. Новая колонка **«Источник»**: `<Tag color="purple">Из Оператона</Tag>` с
   `<Tooltip>` — ключ формы в Оператоне и дата импорта; для своих форм — «—».
3. Кнопка **«Импорт из Оператона»** в `extra` карточки рядом с «Импорт JSON»
   (`<Upload accept=".form,.json,.bpmn">`).
4. При выбранном источнике `operaton` заголовок карточки меняется на
   «Реестр форм — из Оператона», а пустое состояние показывает подсказку с кнопкой
   импорта.

### 7.4 Модалка импорта

Шаг 1 — файл. Drag&drop `.form` / `.json`. Файл читается на фронте, схема уходит в
`previewOperatonForm`.

Шаг 2 — предпросмотр и подтверждение:
* сводка: «Распознано 24 компонента, перенесено 21 поле, 2 предупреждения,
  1 не поддержан»;
* раскрывающийся список предупреждений и неподдержанных компонентов **с ключами
  полей** — пользователь сразу видит, что придётся донастроить;
* `Название` и `form-id` (предзаполнены, `form-id` с той же валидацией
  `^[a-z0-9_]+$`, что и при создании);
* живой предпросмотр формы существующим `FormRenderer` — переиспользуем как есть;
* кнопка «Импортировать» → `importOperatonForm` → `nav('/forms/' + created.id)`.

Отчёт нигде не теряется: он лежит в `source_meta.report` и доступен позже.

### 7.5 Редактор

Изменений в логике редактирования **нет** — импортированная форма является обычным
черновиком. Единственное добавление в шапку `FormEditor.tsx`, рядом с
`form-id` и статусом:

```
<Tag color="purple">Из Оператона</Tag>  ключ: invoice_form  ·  импорт 30.07.2026
```

плюс, если `report.warnings` непуст — `<Alert type="warning">` с кратким списком
того, что не перенеслось, и кнопкой скрыть.

---

## 8. Правила жизненного цикла

* `source` **неизменяем** после создания и не редактируется через UI/API. Правка
  импортированной формы не превращает её в «свою» — иначе раздел «Из Оператона»
  опустеет после первого же редактирования.
* Версионирование, публикация, откат, экспорт, встраивание по `form-id`, удаление —
  работают без изменений. Экспорт (`GET /forms/{pk}/export`) отдаёт **нашу** схему;
  экспорт обратно в формат Оператона в объём не входит.
* Повторный импорт того же файла создаёт **новую** форму с новым `form_id`
  (`invoice_form_2`). Обновление существующей формы из нового файла — см. §11, Фаза 1.5.

---

## 9. Безопасность

* Импорт доступен только аутентифицированному пользователю аккаунта
  (`Depends(require_account)`), форма создаётся в его `account_id`.
* Лимит размера тела запроса — 1 МБ; лимит на количество компонентов — 500.
* Схема Оператона **не исполняется**: FEEL-выражения только парсятся регуляркой
  по белому списку шаблонов (§6.3), никакого `eval`. Это то же правило, что
  действует в нашем evaluator формул.
* `html`-компоненты не переносятся как HTML — только как текст, чтобы через импорт
  нельзя было занести разметку в форму.
* `source_schema` хранится как есть, но наружу (в публичный `/api/public/forms/...`)
  не отдаётся — только в админский `GET /api/forms/{pk}`.

---

## 10. Тесты

Юнит (без БД, `backend/tests/test_operaton.py`):
* по одному тесту на каждый тип компонента из таблицы §5;
* санитизация и дедупликация ключей, корректность `key_map`;
* инверсия `conditional.hide` → `visibleIf` для всех четырёх операторов;
* сложное FEEL-выражение → поле без условия + предупреждение;
* маппинг 16-колоночной раскладки в нашу сетку;
* неподдержанные компоненты не создают полей и попадают в `unsupported`.

API (`backend/tests/test_api.py`, тир с реальной БД):
* импорт валидной схемы → `200`, форма видна в `GET /api/forms?source=operaton`
  и не видна в `?source=local`;
* импорт мусора → `400`, в БД ничего не создано;
* импортированная форма редактируется через `PUT /api/forms/{pk}` и публикуется
  через `POST /api/forms/{pk}/publish`;
* `source` не меняется после `PUT`.

Фикстуры: 2–3 реальных `.form`-файла в `backend/tests/fixtures/operaton/`
(простая форма, форма с условиями и группами, форма с неподдерживаемыми
компонентами).

---

## 11. Этапы и оценка

| Фаза | Содержание | Файлы | Оценка |
|---|---|---|---|
| **1. Ядро** | модель + миграция, `operaton.py`, 2 эндпоинта, фильтр `source`, тесты | `models.py`, `db.py`, `schemas.py`, `routers/forms.py`, `operaton.py`, `tests/` | 2–3 дня |
| **1. UI** | переключатель источника, колонка, модалка импорта с предпросмотром, метка в редакторе | `FormsList.tsx`, `FormEditor.tsx`, `api.ts`, `types.ts` | 1.5–2 дня |
| **1. Ядро+** | тип `checkbox_group` (§5.1) | `fieldTypes.ts`, `FormRenderer.tsx`, `FormEditor.tsx` | 0.5 дня |
| **1.5** | обновление существующей формы из нового файла (`mode=update`, дифф «что изменится») | `routers/forms.py`, модалка | 1 день |
| **2** | импорт `operaton:formData` из BPMN XML (userTask по выбору) | `operaton.py` + парсер XML | 1.5 дня |
| **3** | живая связь с движком: подключение к Operaton REST, список задач, отправка `complete` | новый роутер + раздел | отдельная оценка |

Итого Фаза 1: **≈ 4–6 рабочих дней**.

---

## 12. Вне объёма

* Обратная синхронизация и завершение задач в Operaton (`/task/{id}/complete`).
* Опрос Deployment API и автоподтягивание форм из движка.
* Импорт embedded HTML-форм Оператона.
* Полноценный интерпретатор FEEL.
* Связывание опций с переменными процесса (`valuesKey`) — только предупреждение.
* Экспорт наших форм обратно в формат Оператона.

---

## 13. Критерии приёмки

1. В реестре форм есть переключатель источника; «Из Оператона» показывает только
   импортированные формы, «Свои» — только созданные у нас, счётчик и пагинация верны.
2. Файл `.form` из Оператона загружается через модалку, предпросмотр показывает
   поля и честный список того, что не перенеслось.
3. После импорта форма открывается в существующем конструкторе, все её поля
   редактируются, форма публикуется и отдаётся виджетом по `form-id`.
4. Каждый тип из таблицы §5 либо конвертируется, либо попадает в `unsupported` —
   молчаливых потерь полей нет.
5. Соответствие ключей Operaton → наши `field.id` сохранено в `source_meta.key_map`.
6. Редактирование импортированной формы не меняет её источник.
7. Существующие формы после миграции имеют `source = local` и работают как раньше.
8. Тесты §10 зелёные.

---

## 14. Проверка на реальных формах процесса «Обращение клиента»

Спецификация сверена с пятью боевыми файлами (экспортёр `sota-bpmn 1.0`,
`executionPlatform: Camunda Platform 7.21.0`, `schemaVersion: 16`):

| Файл | Компоненты | Результат |
|---|---|---|
| `form_obrashchenieKlienta_klassifikaciya` | `select` (3 значения, required) + `textarea` | конвертируется полностью |
| `form_obrashchenieKlienta_obrabotka` | `select` (3 значения, required) + `textarea` | конвертируется полностью |
| `form_obrashchenieKlienta_pervayaLiniya` | `select` (1 значение, required) + `textarea` | конвертируется полностью |
| `form_obrashchenieKlienta_otvet` | `select` (1 значение, required) + `textarea` | конвертируется полностью |
| `form_obrashchenieKlienta_peredacha` | `select` (1 значение, required) + `textarea` | конвертируется полностью |

Все пять — одной структуры: одиночный `select` со статическими `values` +
необязательный `textarea`. Потерь полей нет, предупреждений нет,
`unsupported` пуст. Ключи (`klassifikaciya_result`, `pervayaLiniya_comment`, …)
уже удовлетворяют `[a-zA-Z0-9_]`, поэтому `key_map` — тождественный, и вопрос
переименования вложенных ключей на этом наборе не возникает.

Эти файлы кладутся в `backend/tests/fixtures/operaton/` как основной набор
приёмочных фикстур (§10).

**Что они изменили в спецификации:** §6.4 (нет `layout` → `grid_columns = 1`,
а не 2) и новый §6.1a (`form_id` и отсутствующее название формы).

**Что они закрыли из открытых вопросов:** целевой формат — Camunda 7,
`schemaVersion` 16; `checkbox_group` из §5.1 для них не нужен; точки в ключах
не встречаются.

---

## 15. Открытые вопросы

1. **Множественный выбор** — подтвердить решение §5.1 (новый тип `checkbox_group`
   против автосоздания справочников). На присланных формах не требуется, но нужен,
   если где-то в процессах используются `checklist`/`taglist`.
2. **BPMN-импорт (Фаза 2)** — нужен ли, или формы всегда выгружаются отдельными
   `.form`-файлами, как присланные пять?
3. **Обновление формы из нового файла (Фаза 1.5)** — включать в первый релиз?
   Для набора однотипных форм процесса это заметно удобнее, чем импорт-дубликат.
4. **Ключи полей**: допустимо ли переименование `applicant.firstName` →
   `applicant_firstName`, если такие ключи всё же появятся, или нужна поддержка
   точек в `field.id` (тогда правка движка формул и зависимостей)?
5. **Возврат результата в процесс.** Присланные формы — это формы
   пользовательских задач: их смысл в том, чтобы записать `*_result` в переменную
   процесса и завершить задачу. В Фазе 1 форма после отправки уходит в наш webhook,
   а не в `/task/{id}/complete` Оператона. Нужно решить, достаточно ли webhook-а
   на первом этапе или Фаза 3 требуется сразу.

---

## 16. Что фактически сделано

Реализовано в двух репозиториях. Ключевое отличие от исходного плана: импорт
работает **и по API sota-bpmn**, а не только файлом, и возврат данных в процесс
(Фаза 3) вошёл в первый релиз — без него импортированные формы задач бесполезны
в проде.

### 16.1 sota-forms

| Файл | Что |
|---|---|
| `backend/app/operaton.py` | Конвертер form-js → наша схема, парсер FEEL-условий, шаблоны webhook-URL. Чистый, без БД и сети |
| `backend/app/bpmn_client.py` | Клиент к BFF sota-bpmn (`/api/processes`, `/api/forms`, `/api/forms/{id}`) + инъекция общего секрета |
| `backend/app/routers/operaton.py` | `GET /api/operaton/{status,processes,forms}`, `POST /api/operaton/{preview,import}` |
| `backend/app/models.py`, `db.py` | `Form.source/source_meta/source_schema` + идемпотентная миграция `ALTER TABLE … IF NOT EXISTS` |
| `backend/app/routers/forms.py` | Фильтр `?source=`, урезанный паспорт в списке, **запрет ломать переменные процесса** при `PUT` |
| `backend/app/routers/public.py` | Подстановка `{{taskId}}`/`{{bpmnBase}}`, синхронная доставка, перевод ошибок движка на человеческий, `GET /api/public/forms/by-operaton/{id}` |
| `frontend/src/pages/OperatonImportModal.tsx` | Импорт: каталог sota-bpmn или файл, dry-run предпросмотр, отчёт, живой рендер формы |
| `frontend/src/pages/FormsList.tsx` | Переключатель источника, колонка «Источник», пустое состояние раздела |
| `frontend/src/pages/FormEditor.tsx` | Метка «Из Оператона», список непереносов, блокировка ID связанных полей |
| `frontend/src/widget/webcomponent.tsx` | Атрибуты `task-id` / `context`, событие `form:completed`, проброс ошибок движка |
| `frontend/src/renderer/FormRenderer.tsx` | Новый тип `checkbox_group` (§5.1) |

### 16.2 sota-bpmn

| Файл | Что |
|---|---|
| `backend/sota_forms_client.py` | Резолв «есть ли у этой формы Оператона опубликованный аналог в sota-forms» |
| `backend/routes/forms_bff.py` | `GET /api/tasks/{id}/external-form`; защита `POST /complete` общим секретом |
| `backend/operaton_client.py` | `get_task_form_ref` — design-time id формы из `operatonFormRef` / `camundaFormRef` / `formKey` |
| `backend/config.py` | `SOTA_FORMS_URL`, `FORMS_WEBHOOK_TOKEN` |
| `frontend/src/forms/SotaFormsTask.tsx` | Хост виджета sota-forms: одна загрузка бандла на страницу, `form:completed` → `onCompleted` |
| `frontend/src/forms/FormRenderer.tsx` | Спрашивает sota-forms **до** обращения к движку; 404 → обычный form-js |

### 16.3 Как это работает целиком

```
Импорт (design-time)
  sota-forms → GET  {bpmn}/api/forms?process=obrashchenieKlienta
             → GET  {bpmn}/api/forms/form_obrashchenieKlienta_klassifikaciya
             → конвертация + отчёт → форма с source=operaton → правка → публикация

Исполнение (runtime)
  задача в sota-bpmn → GET /api/tasks/{taskId}/external-form
                     → sota-forms /api/public/forms/by-operaton/{formRef}
                     → <no-code-form form-id=… task-id={taskId}>
  submit → POST {forms}/api/public/forms/{id}/submit {data, context:{taskId}}
         → POST {bpmn}/api/tasks/{taskId}/complete {"data": …}  (синхронно, X-Forms-Token)
         → 204 «Задача отправлена в процесс» | 409 «Задача уже завершена другим пользователем»
```

**Деградация везде безопасная.** sota-forms выключен или недоступен → sota-bpmn
рисует form-js как раньше. sota-bpmn недоступен → импорт из файла работает,
`/api/operaton/status` честно показывает причину. Форма ещё черновик → резолвер
отдаёт 404, живую задачу неопубликованная форма не перехватывает.

### 16.4 Решения, принятые по ходу

1. **`checkbox_group` вместо автосоздания справочников** (§5.1) — реализован как
   рекомендовано; раздел «Справочники» не засоряется служебными записями.
2. **Синхронная доставка для задач Оператона.** Наш outbox с ретраями хорош для
   обычных webhook-ов, но здесь пользователь должен сразу узнать про 409/404, а
   не получить «Спасибо» и молча не сдвинуть процесс. Запись в доске доставок при
   этом сохраняется — история не теряется.
3. **Отсутствие `taskId` — ошибка 400, а не тихий пропуск.** Форма задачи без
   рантайм-контекста не может ничего завершить; это ошибка вёрстки хоста, и
   молчать о ней вреднее, чем упасть.
4. **Резолвер живёт в sota-forms**, а не в sota-bpmn: правила санитизации slug
   принадлежат одной стороне, иначе они разъедутся при первом же изменении.
5. **Дескриптор внешней формы валидируется по форме.** Ответ 200 без `formId`/
   `widgetSrc` не считается дескриптором — иначе случайный 200 от прокси уводил бы
   рендеринг от form-js.
6. **Секрет опционален и по умолчанию выключен** — существующие развёртывания
   sota-bpmn продолжают работать без изменений.

### 16.5 Проверено

| Набор | Результат |
|---|---|
| sota-forms: юнит-тесты конвертера (`tests/test_operaton.py`) | 59 зелёных |
| sota-forms: API-тесты импорта и возврата (`tests/test_operaton_api.py`) | 17 зелёных |
| sota-forms: весь backend на реальном Postgres | 119 зелёных |
| sota-forms: `tsc --noEmit` | чисто (единственная ошибка — в нетронутом `suggestControl`, была до правок) |
| sota-forms: `ruff` | ноль новых замечаний относительно базы |
| sota-bpmn: backend | 108 зелёных (было 100) |
| sota-bpmn: frontend Vitest | 283 зелёных (было 277) |
| sota-bpmn: `tsc -b` | чисто |

### 16.6 Что осталось за рамками

* Обновление уже импортированной формы из нового файла/каталога (Фаза 1.5).
* Импорт `operaton:formData` из BPMN XML (Фаза 2).
* Предзаполнение формы текущими переменными задачи (`GET /api/tasks/{id}/form`
  отдаёт `data`, но виджет пока не принимает начальные значения снаружи).
* Типизация переменных при возврате: массивы и файлы уходят как есть, движок
  выводит тип сам. Для присланных форм (строки) это корректно, для мультивыбора
  потребуется явный `Json`.
