import { ReloadOutlined } from '@ant-design/icons';
import { App, Button, Card, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { deliveriesBoard, retryDelivery } from '../api';

const STATUS: Record<string, { color: string; label: string }> = {
  delivered: { color: 'green', label: 'доставлено' },
  pending: { color: 'gold', label: 'в очереди' },
  failed: { color: 'red', label: 'ошибка' },
  dead: { color: 'volcano', label: 'исчерпано' },
};

export default function Deliveries() {
  const { message } = App.useApp();
  const [rows, setRows] = useState<any[]>([]);
  const timer = useRef<any>(null);
  const load = () => deliveriesBoard().then(setRows).catch(() => setRows([]));

  useEffect(() => {
    load();
    timer.current = setInterval(load, 3000); // live board
    return () => clearInterval(timer.current);
  }, []);

  return (
    <Card
      title="Доставки вебхуков · execute-worker"
      extra={<Space><Tag color="blue">auto-refresh 3s</Tag><Button icon={<ReloadOutlined />} onClick={load}>Обновить</Button></Space>}
    >
      <Typography.Paragraph type="secondary">
        Outbox-очередь. Отдельный воркер забирает pending-задачи, шлёт POST на webhook клиента с HMAC-подписью,
        повторяет при ошибке с экспоненциальным backoff.
      </Typography.Paragraph>
      <Table
        rowKey="id"
        dataSource={rows}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: 'Форма', dataIndex: 'form_id', render: (v) => <Tag color="blue">{v}</Tag> },
          { title: 'URL', dataIndex: 'url', render: (v) => <code style={{ fontSize: 12 }}>{v}</code> },
          { title: 'Статус', dataIndex: 'status', render: (v) => <Tag color={STATUS[v]?.color || 'default'}>{STATUS[v]?.label || v}</Tag> },
          { title: 'Попыток', render: (_, r) => `${r.attempts}/${r.max_attempts}` },
          { title: 'HTTP', dataIndex: 'last_status_code', render: (v) => v ?? '—' },
          { title: 'Ошибка', dataIndex: 'last_error', render: (v) => v ? <Tooltip title={v}><span style={{ color: '#cf1322' }}>{String(v).slice(0, 30)}…</span></Tooltip> : '—' },
          {
            title: '', render: (_, r) => (r.status === 'dead' || r.status === 'failed')
              ? <Button size="small" onClick={async () => { await retryDelivery(r.id); message.success('Повтор запланирован'); load(); }}>Повторить</Button>
              : null,
          },
        ]}
      />
    </Card>
  );
}
