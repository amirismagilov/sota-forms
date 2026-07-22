import { App, Button, Card, Form as AntForm, Input, Segmented, Typography } from 'antd';
import { useState } from 'react';
import { type AuthUser, login, register, setToken } from '../api';

export default function Login({ onAuthed }: { onAuthed: (u: AuthUser) => void }) {
  const { message } = App.useApp();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const [form] = AntForm.useForm();

  async function submit() {
    const v = await form.validateFields();
    setLoading(true);
    try {
      const res = mode === 'login'
        ? await login(v.email, v.password)
        : await register(v.email, v.password, v.account_name);
      setToken(res.token);
      onAuthed(res.user);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || 'Ошибка авторизации');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f5f5f5' }}>
      <Card style={{ width: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <Typography.Title level={3} style={{ marginBottom: 0 }}>SOTA Forms</Typography.Title>
          <Typography.Text type="secondary">конструктор форм</Typography.Text>
        </div>
        <Segmented
          block
          value={mode}
          onChange={(m) => setMode(m as any)}
          options={[{ label: 'Вход', value: 'login' }, { label: 'Регистрация', value: 'register' }]}
          style={{ marginBottom: 16 }}
        />
        <AntForm form={form} layout="vertical" onFinish={submit}
          initialValues={{ email: 'demo@sota.forms', password: 'demo12345' }}>
          {mode === 'register' && (
            <AntForm.Item name="account_name" label="Название аккаунта">
              <Input placeholder="Моя компания" />
            </AntForm.Item>
          )}
          <AntForm.Item name="email" label="Email" rules={[{ required: true }]}>
            <Input placeholder="you@company.com" />
          </AntForm.Item>
          <AntForm.Item name="password" label="Пароль" rules={[{ required: true, min: 6 } as any]}>
            <Input.Password />
          </AntForm.Item>
          <Button type="primary" block loading={loading} onClick={submit}>
            {mode === 'login' ? 'Войти' : 'Создать аккаунт'}
          </Button>
        </AntForm>
        {mode === 'login' && (
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12, marginBottom: 0, textAlign: 'center' }}>
            Демо-доступ подставлен: <code>demo@sota.forms / demo12345</code>
          </Typography.Paragraph>
        )}
      </Card>
    </div>
  );
}
