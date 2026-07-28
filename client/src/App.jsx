import { useEffect, useState } from 'react'
import './App.css'
import FunctionEditor from './components/FunctionEditor'
import FunctionTester from './components/FunctionTester'
import Login from './components/Login'
import Brand from './components/Brand'
import './components/FunctionEditor.css'
import './components/FunctionTester.css'
import './dashboard-theme.css'

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
    return (
      <div className="auth-loading">
        <span className="spinner"></span>
        Loading Function Editor…
      </div>
    );
  }

  if (!auth.username) {
    return <Login onLogin={(username) => setAuth({ loading: false, username })} />;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand-link" href="/" aria-label="OpenFaaS Function Editor">
          <Brand />
        </a>

        <nav className="navigation" aria-label="Function editor">
          <button
            className={`nav-button ${activePage === 'editor' ? 'active' : ''}`}
            onClick={() => setActivePage('editor')}
          >
            Edit function
          </button>
          <button
            className={`nav-button ${activePage === 'tester' ? 'active' : ''}`}
            onClick={() => setActivePage('tester')}
          >
            Test function
          </button>
        </nav>

        <div className="header-meta">
          <button className="logout-button" onClick={logout}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10" />
            </svg>
            Sign out
          </button>
        </div>
      </header>

      <main className="app">
        <div className="breadcrumbs">
          <span>Functions</span><span aria-hidden="true">/</span><strong>{functionName}</strong>
        </div>
        <div className="page-heading">
          <div>
            <h1 className="title">{activePage === 'editor' ? 'Function editor' : 'Test function'}</h1>
            <p>
              {activePage === 'editor'
                ? 'Edit the source, publish an image, and deploy it to OpenFaaS.'
                : 'Invoke the deployed function and inspect its response and logs.'}
            </p>
          </div>
        </div>

        <section className="workspace-card">
          {activePage === 'editor' ? (
            <FunctionEditor functionName={functionName} />
          ) : (
            <FunctionTester functionName={functionName} />
          )}
        </section>
      </main>
    </div>
  )
}

export default App
