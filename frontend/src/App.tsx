import {
  ApiOutlined,
  BgColorsOutlined,
  DatabaseOutlined,
  FormOutlined,
  InboxOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SendOutlined,
  CodeOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Button, Dropdown, Layout, Menu, Typography } from 'antd';
import { useState } from 'react';
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

const { Sider, Content } = Layout;

const items = [
  { key: '/forms', icon: <FormOutlined />, label: 'Формы' },
  { key: '/dictionaries', icon: <DatabaseOutlined />, label: 'Справочники' },
  { key: '/connections', icon: <ApiOutlined />, label: 'Подключения' },
  { key: '/theme', icon: <BgColorsOutlined />, label: 'Тема (токены)' },
  { key: '/submissions', icon: <InboxOutlined />, label: 'Заполнения' },
  { key: '/deliveries', icon: <SendOutlined />, label: 'Доставки (worker)' },
  { key: '/embed', icon: <CodeOutlined />, label: 'Встраивание' },
];

const BRAND = '#FF5028'; // Balance Platform accent

function Logo({ collapsed }: { collapsed: boolean }) {
  const mark = (
    <div style={{
      width: 30, height: 30, borderRadius: 8, background: BRAND, color: '#fff',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 800, fontSize: 18, lineHeight: 1, flexShrink: 0,
    }}>b</div>
  );
  if (collapsed) return <div style={{ padding: '16px 0', textAlign: 'center' }}>{mark}</div>;
  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {mark}
        <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.3px' }}>
          Balance<span style={{ color: BRAND }}>.</span>
        </span>
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 40, display: 'block', marginTop: -2 }}>
        Формы
      </Typography.Text>
    </div>
  );
}

export default function App({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const nav = useNavigate();
  const loc = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const selected = '/' + (loc.pathname.split('/')[1] || 'forms');
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        theme="light" width={230} collapsedWidth={72}
        collapsed={collapsed} trigger={null}
        style={{ borderRight: '1px solid #f0f0f0' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
          <Logo collapsed={collapsed} />
          <Menu
            mode="inline" selectedKeys={[selected]} items={items} onClick={(e) => nav(e.key)}
            style={{ flex: 1, borderInlineEnd: 0, overflowY: 'auto' }}
          />
          {/* Bottom: user + collapse toggle */}
          <div style={{ borderTop: '1px solid #f0f0f0', padding: 8 }}>
            <Dropdown placement="topRight" menu={{ items: [{ key: 'out', icon: <LogoutOutlined />, label: 'Выйти', onClick: onLogout }] }}>
              <Button
                type="text" block title={user.email}
                style={{ height: 40, display: 'flex', alignItems: 'center', gap: 8, paddingInline: 8, justifyContent: collapsed ? 'center' : 'flex-start' }}
              >
                <UserOutlined />
                {!collapsed && <span style={{ color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</span>}
              </Button>
            </Dropdown>
            <Button
              type="text" block onClick={() => setCollapsed(!collapsed)}
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, paddingInline: 8, justifyContent: collapsed ? 'center' : 'flex-start' }}
            >
              {!collapsed && 'Свернуть'}
            </Button>
          </div>
        </div>
      </Sider>
      <Layout>
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
