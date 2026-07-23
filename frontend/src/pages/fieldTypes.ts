export const FIELD_TYPE_GROUPS: { label: string; options: { label: string; value: string }[] }[] = [
  {
    label: 'Базовые',
    options: [
      { label: 'Текст', value: 'text' },
      { label: 'Многострочный текст', value: 'textarea' },
      { label: 'Число', value: 'number' },
      { label: 'Email', value: 'email' },
      { label: 'Телефон', value: 'phone' },
      { label: 'Пароль', value: 'password' },
      { label: 'URL', value: 'url' },
      { label: 'Дата', value: 'date' },
      { label: 'Дата и время', value: 'datetime' },
      { label: 'Время', value: 'time' },
      { label: 'Цвет', value: 'color' },
    ],
  },
  {
    label: 'Выбор',
    options: [
      { label: 'Справочник — список', value: 'dict_select' },
      { label: 'Справочник — радио', value: 'dict_radio' },
      { label: 'Справочник — чекбоксы', value: 'dict_checkbox' },
      { label: 'Статический список', value: 'select_static' },
      { label: 'Радио-группа', value: 'radio_group' },
      { label: 'Чекбокс (согласие)', value: 'checkbox' },
      { label: 'Переключатель', value: 'toggle' },
    ],
  },
  {
    label: 'Спец-типы (маски)',
    options: [
      { label: 'ИНН', value: 'inn' },
      { label: 'СНИЛС', value: 'snils' },
      { label: 'Паспорт', value: 'passport' },
      { label: 'БИК', value: 'bik' },
      { label: 'КПП', value: 'kpp' },
      { label: 'ОГРН', value: 'ogrn' },
      { label: 'Карта', value: 'card' },
      { label: 'Сумма', value: 'amount' },
    ],
  },
  {
    label: 'Файлы / прочее',
    options: [
      { label: 'Файл', value: 'file' },
      { label: 'Изображение', value: 'image' },
      { label: 'Подпись (canvas)', value: 'signature' },
      { label: 'Рейтинг', value: 'rating' },
      { label: 'Слайдер', value: 'slider' },
    ],
  },
  {
    label: 'Вычисления',
    options: [{ label: 'Вычисляемое поле', value: 'calculated' }],
  },
  {
    label: 'Компоновка',
    options: [
      { label: 'Заголовок секции', value: 'section_header' },
      { label: 'Разделитель', value: 'divider' },
      { label: 'Инфо-текст', value: 'info_text' },
    ],
  },
];

export const MASK_PRESETS: Record<string, { regex: string }> = {
  phone: { regex: '^\\+7 \\(\\d{3}\\) \\d{3}-\\d{2}-\\d{2}$' },
  inn: { regex: '^\\d{10}$' },
  snils: { regex: '^\\d{3}-\\d{3}-\\d{3} \\d{2}$' },
  passport: { regex: '^\\d{4} \\d{6}$' },
  bik: { regex: '^\\d{9}$' },
  kpp: { regex: '^\\d{9}$' },
  ogrn: { regex: '^\\d{13}$' },
  card: { regex: '^\\d{4} \\d{4} \\d{4} \\d{4}$' },
};

export const OPERATORS = [
  { label: '= равно', value: 'eq' },
  { label: '≠ не равно', value: 'neq' },
  { label: 'содержит', value: 'contains' },
  { label: 'пусто', value: 'empty' },
  { label: 'не пусто', value: 'not_empty' },
  { label: '> больше', value: 'gt' },
  { label: '< меньше', value: 'lt' },
];
