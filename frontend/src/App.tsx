import {
  ApiOutlined,
  BgColorsOutlined,
  DatabaseOutlined,
  FormOutlined,
  InboxOutlined,
  LogoutOutlined,
  SendOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import { Button, Dropdown, Layout, Menu, Space, Typography } from 'antd';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { AuthUser } from './api';
import Connections from './pages/Connections';
import Deliveries from './pages/Deliveries';
import Dictionaries from './pages/Dictionaries';
import Embed from './pages/Embed';
import FormEditor from './pages/FormEditor';
import FormsList from './pages/FormsList';
import Submissions from './pages/Submissions';
import Theme from './pages/Theme';

const { Header, Sider, Content } = Layout;

const items = [
  { key: '/forms', icon: <FormOutlined />, label: 'Формы' },
  { key: '/dictionaries', icon: <DatabaseOutlined />, label: 'Справочники' },
  { key: '/connections', icon: <ApiOutlined />, label: 'Подключения' },
  { key: '/theme', icon: <BgColorsOutlined />, label: 'Тема (токены)' },
  { key: '/submissions', icon: <InboxOutlined />, label: 'Заполнения' },
  { key: '/deliveries', icon: <SendOutlined />, label: 'Доставки (worker)' },
  { key: '/embed', icon: <CodeOutlined />, label: 'Встраивание' },
];

export default function App({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const nav = useNavigate();
  const loc = useLocation();
  const selected = '/' + (loc.pathname.split('/')[1] || 'forms');
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="light" width={230} style={{ borderRight: '1px solid #f0f0f0' }}>
        <div style={{ padding: 16 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>SOTA Forms</Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>no-code конструктор</Typography.Text>
        </div>
        <Menu mode="inline" selectedKeys={[selected]} items={items} onClick={(e) => nav(e.key)} />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', borderBottom: '1px solid #f0f0f0', paddingInline: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography.Text strong>Универсальный конструктор форм</Typography.Text>
          <Dropdown menu={{ items: [{ key: 'out', icon: <LogoutOutlined />, label: 'Выйти', onClick: onLogout }] }}>
            <Button type="text">
              <Space>
                <span style={{ color: '#666' }}>{user.email}</span>
              </Space>
            </Button>
          </Dropdown>
        </Header>
        <Content style={{ padding: 24, overflow: 'auto' }}>
          <Routes>
            <Route path="/" element={<Navigate to="/forms" replace />} />
            <Route path="/forms" element={<FormsList />} />
            <Route path="/forms/:pk" element={<FormEditor />} />
            <Route path="/dictionaries" element={<Dictionaries />} />
            <Route path="/connections" element={<Connections />} />
            <Route path="/theme" element={<Theme />} />
            <Route path="/submissions" element={<Submissions />} />
            <Route path="/deliveries" element={<Deliveries />} />
            <Route path="/embed" element={<Embed />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}
