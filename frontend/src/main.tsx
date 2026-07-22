import { App as AntApp, ConfigProvider } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { getTheme } from './api';
import './widget/webcomponent'; // registers <no-code-form> for the Embed demo

function Root() {
  const [tokens, setTokens] = useState<Record<string, any>>({});
  useEffect(() => {
    getTheme().then((t) => setTokens(t.design_tokens?.token || {})).catch(() => {});
  }, []);
  return (
    <ConfigProvider locale={ruRU} theme={{ token: tokens }}>
      <AntApp>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  );
}

createRoot(document.getElementById('root')!).render(<Root />);
