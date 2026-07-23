import { useState } from 'react';

/**
 * Плавающий лейбл в стиле референс-системы «Лизинговый брокер».
 * Порт FloatingLabel.module.scss: лейбл лежит внутри поля как плейсхолдер
 * (top 14, #999, 14px), при фокусе/заполнении всплывает на верхнюю рамку
 * (top -7, #333, 12px) с белой подложкой, разрывающей border.
 *
 * Инлайн-стили намеренно: форма рендерится и в shadow-DOM (web-component),
 * куда внешний CSS-файл не попадёт.
 */
export default function FloatingField({
  label,
  active,
  children,
}: {
  label: React.ReactNode;
  active: boolean; // поле заполнено
  children: React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  const on = focused || active;

  return (
    <div
      style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={() => setFocused(false)}
    >
      {children}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          marginLeft: 12,
          marginRight: 26,
          pointerEvents: 'none',
          transition: '0.15s ease all',
          lineHeight: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          top: on ? -7 : 14,
          color: on ? '#333333' : '#999999',
          fontSize: on ? 12 : 14,
          fontWeight: on ? 400 : 500,
        }}
      >
        <span style={{ background: '#fff', padding: '0 4px', borderRadius: 10 }}>{label}</span>
      </div>
    </div>
  );
}
