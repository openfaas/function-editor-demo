import { useEffect, useState } from 'react'
import './App.css'
import FunctionEditor from './components/FunctionEditor'
import FunctionTester from './components/FunctionTester'
import Login from './components/Login'
import './components/FunctionEditor.css'
import './components/FunctionTester.css'

function App() {
  const [activePage, setActivePage] = useState('editor');
  const [functionName] = useState('fn1');
  const [auth, setAuth] = useState({ loading: true, username: null });

  useEffect(() => {
    const requireAuth = () => setAuth({ loading: false, username: null });
    window.addEventListener('auth-required', requireAuth);

    fetch('/api/auth/status')
      .then(async (response) => {
        const result = await response.json();
        setAuth({ loading: false, username: response.ok ? result.username : null });
      })
      .catch(() => setAuth({ loading: false, username: null }));

    return () => window.removeEventListener('auth-required', requireAuth);
  }, []);

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setAuth({ loading: false, username: null });
  };

  if (auth.loading) {
    return <div className="auth-loading">Loading…</div>;
  }

  if (!auth.username) {
    return <Login onLogin={(username) => setAuth({ loading: false, username })} />;
  }

  return (
    <div className="app">
      <div className="header">
        <h1 className="title">Function Editor</h1>
        <div className="header-meta">
          <span className="branding">Powered by OpenFaaS</span>
          <span>{auth.username}</span>
          <button className="logout-button" onClick={logout}>Sign out</button>
        </div>
      </div>
      
      <div className="navigation">
        <button 
          className={`nav-button ${activePage === 'editor' ? 'active' : ''}`}
          onClick={() => setActivePage('editor')}
        >
          Edit Function
        </button>
        <button 
          className={`nav-button ${activePage === 'tester' ? 'active' : ''}`}
          onClick={() => setActivePage('tester')}
        >
          Test Function
        </button>
      </div>
      
      {activePage === 'editor' ? (
        <FunctionEditor functionName={functionName} />
      ) : (
        <FunctionTester functionName={functionName} />
      )}
    </div>
  )
}

export default App
