# SOTA Forms — universal no-code form builder (demo)

Конструктор форм со своей базой данных. Формы настраиваются в админке без кода,
встраиваются в любой проект **микрофронтом по `form-id`** (Web Component, Shadow DOM),
данные заполнения сохраняются в БД и **отдаются по ID заполнения как JSON**.

Стек: **React + Ant Design (TypeScript)** · **Python (FastAPI)** · **PostgreSQL** · **Redis** · всё в **Docker**.

---

## Быстрый старт

```bash
docker compose up --build
```

| Сервис | URL |
|---|---|
| Конструктор (админка) | http://localhost:5173 |
| Backend API + Swagger | http://localhost:8000/docs |
| Встроенный виджет (демо) | http://localhost:5173/embed |

При первом запуске БД автоматически засевается демо-аккаунтом, справочниками
(регионы, доставка с атрибутами cost/days, тарифы со скидкой) и готовой формой
`order_form` («Оформление заказа»).

---

## Что внутри (архитектура)

```
frontend (React+Ant)          backend (FastAPI)              worker
┌───────────────────┐  /api   ┌────────────────────┐        ┌──────────────────┐
│ Конструктор        │◄──────►│ CRUD форм/справоч./ │        │ execute-worker    │
│  · дерево полей     │        │ подключений         │        │ (webhook outbox)  │
│  · живой preview    │        │ public: schema+токены│  ──►  │ POST + HMAC,      │
│ Виджет <no-code-form>│ public │ submit → outbox     │ outbox │ retry+backoff     │
│  · Shadow DOM       │◄──────►│ proxy (секреты)     │  таблица└────────┬─────────┘
└───────────────────┘        └─────────┬──────────┘                 │
                                       ▼                            ▼
                                  PostgreSQL  ◄──── доска доставок ──┘   webhook клиента
```

- **Доска** — вкладки «Заполнения» и «Доставки (worker)» в админке: живой статус
  outbox-очереди (в очереди / доставлено / ошибка / повтор).
- **Воркер для экзекьют** — отдельный процесс (`app.worker.webhook_worker`), забирает
  pending-задачи из outbox, шлёт POST на webhook клиента с HMAC-подписью,
  повторяет при сбое с экспоненциальным backoff.

---

## Реализованные требования спеки

| Критерий | Где |
|---|---|
| КП-1 Форма собирается без кода | Конструктор → дерево полей + редактор (`FormEditor.tsx`) |
| КП-2 Встраивание одним тегом `<no-code-form form-id>` | `widget/webcomponent.tsx` |
| КП-3/4 Ant Design + токены аккаунта, live-смена темы | `ThemedForm.tsx`, вкладка «Тема» |
| КП-5 Интеграции через proxy, секреты скрыты | `proxy_client.py`, `crypto.py` (AES/Fernet) |
| КП-6 Каскадные справочники + атрибуты | `engine.ts` (`dictItemsFor`), демо `f_region → f_delivery` |
| КП-7 Вычисляемые поля в реальном времени | безопасный evaluator (`formula.py` / `engine.ts`) |
| КП-8 Видимость / обязательность по условию | `visibleIf` / `requiredIf` (демо: ИНН для «Компания») |
| КП-9 Данные уходят на webhook клиента | outbox + `webhook_worker.py` (HMAC, retry) |
| КП-10 Изоляция виджета (Shadow DOM) | Web Component + `@ant-design/cssinjs` StyleProvider |
| Отдача заполнения по ID как JSON | `GET /api/submissions/{id}` |

Типы полей: text/textarea/number/email/phone/password/url/date, dict_select/radio/checkbox,
select_static/radio_group/checkbox/toggle, спец-маски (ИНН/СНИЛС/паспорт/БИК/КПП/ОГРН/карта/сумма),
file/image/rating/slider, calculated, section_header/divider/info_text.

---

## Тестовый контур (GRACE — прагматичное ядро)

Критерий «зелёный отчёт ≠ доказательство». Реализованы:

- **Property-based инварианты** (Hypothesis) на движок формул и работу с секретами —
  проверяются тысячи входов, а не пара примеров (`tests/test_formula.py`, `test_crypto.py`).
- **Infra-тир на реальной БД** — API-тесты гоняются против настоящего PostgreSQL,
  без замоканного слоя данных (`tests/test_api.py`).
- **honest-NA** — если БД недоступна, интеграционные тесты помечаются SKIP
  («не проверено»), а не проходят молча (`tests/conftest.py`).
- **Статический гейт** — ruff (+ mypy на критичных модулях) в CI.
- **Security-инвариант** — формулы исполняются только по whitelist AST, без `eval`
  (тест `test_no_arbitrary_code_execution`).

```bash
cd backend
pip install -r requirements.txt
TEST_DATABASE_URL=postgresql+asyncpg://forms:forms@localhost:5432/forms_test pytest -q
```

CI (`.github/workflows/ci.yml`) поднимает Postgres-сервис и прогоняет оба яруса +
typecheck/build фронтенда.

---

## Встраивание в чужой проект

```html
<script src="https://cdn.platform.com/form-widget.js"></script>
<no-code-form form-id="order_form"></no-code-form>
<!-- опционально: primary-color, border-radius, api-base -->
```

JS API элемента: `getValues()`, `reset()`, `destroy()`; события `form:ready`,
`form:change`, `form:submit`.

---

## API (основное)

| Метод | Endpoint | Назначение |
|---|---|---|
| GET/POST/PUT/DELETE | `/api/forms[/:id]` | CRUD форм |
| GET/POST/PUT/DELETE | `/api/dictionaries[/:id]` | CRUD справочников |
| GET/POST/PUT/DELETE | `/api/connections[/:id]` | CRUD подключений (секреты шифруются) |
| GET/PUT | `/api/account/theme` | Токены дизайна |
| GET | `/api/public/forms/:formId` | Схема + токены + справочники (для виджета) |
| POST | `/api/public/forms/:formId/submit` | Приём заполнения |
| POST | `/api/proxy/:connectionId` | Proxy к внешнему API (whitelist + rate limit) |
| GET | `/api/submissions[/:id]` | Заполнения / одно как JSON |
| GET | `/api/submissions/deliveries/board` | Доска доставок вебхуков |
```
