import { ReloadOutlined } from '@ant-design/icons';
import { Button, Card, Space, Table, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { listSubmissions } from '../api';

const STATUS_COLORS: Record<string, string> = {
  delivered: 'green', pending: 'gold', retrying: 'orange', failed: 'red', no_webhook: 'default',
};

export default function Submissions() {
  const [rows, setRows] = useState<any[]>([]);
  const load = () => listSubmissions().then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  return (
    <Card title="Заполнения форм" extra={<Button icon={<ReloadOutlined />} onClick={load}>Обновить</Button>}>
      <Table
        rowKey="id"
        dataSource={rows}
        pagination={{ pageSize: 20 }}
        expandable={{
          expandedRowRender: (r) => (
            <pre style={{ margin: 0, fontSize: 12, background: '#fafafa', padding: 12, borderRadius: 6 }}>
              {JSON.stringify(r.data, null, 2)}
            </pre>
          ),
        }}
        columns={[
          { title: 'ID', dataIndex: 'id', render: (v) => <Typography.Text copyable style={{ fontFamily: 'monospace' }}>{v}</Typography.Text> },
          { title: 'Форма', dataIndex: 'form_id', render: (v) => <Tag color="blue">{v}</Tag> },
          { title: 'Webhook', dataIndex: 'webhook_status', render: (v) => <Tag color={STATUS_COLORS[v] || 'default'}>{v}</Tag> },
          { title: 'Создано', dataIndex: 'created_at', render: (v) => new Date(v).toLocaleString('ru-RU') },
          {
            title: 'JSON по ID', render: (_, r) => (
              <Space>
                <Button size="small" href={`/api/submissions/${r.id}`} target="_blank">Открыть JSON</Button>
              </Space>
            ),
          },
        ]}
      />
    </Card>
  );
}
