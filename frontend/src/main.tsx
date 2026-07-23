import { App as AntApp, ConfigProvider } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { type AuthUser, clearToken, getTheme, getToken, me } from './api';
import Login from './pages/Login';
import { componentsTheme, tokenTheme } from './theme';
import './widget/webcomponent'; // registers <no-code-form> for the Embed demo

function Root() {
  const [tokens, setTokens] = useState<Record<string, any>>({});
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener('sota:unauthorized', onUnauthorized);
    return () => window.removeEventListener('sota:unauthorized', onUnauthorized);
  }, []);

  useEffect(() => {
    if (getToken()) {
      me().then(setUser).catch(() => clearToken()).finally(() => setReady(true));
    } else {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (user) getTheme().then((t) => setTokens(t.design_tokens?.token || {})).catch(() => {});
  }, [user]);

  const body = !ready ? null : user ? <App user={user} onLogout={() => { clearToken(); setUser(null); }} /> : <Login onAuthed={setUser} />;

  return (
    <ConfigProvider
      locale={ruRU}
      theme={{ token: { ...tokenTheme, ...(user ? tokens : {}) }, components: componentsTheme }}
    >
      <AntApp>
        <BrowserRouter>{body}</BrowserRouter>
      </AntApp>
    </ConfigProvider>
  );
}

createRoot(document.getElementById('root')!).render(<Root />);
