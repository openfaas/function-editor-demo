import { useState } from 'react';
import Brand from './Brand';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Login failed');
      }

      setPassword('');
      onLogin(result.username);
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <header className="login-topbar">
        <Brand />
      </header>
      <div className="login-container">
        <form className="login-card" onSubmit={submit}>
          <div className="login-card-header">
            <span className="login-lock" aria-hidden="true">●</span>
            Authentication required
          </div>
          <div className="login-card-body">
            <h1>Function Editor</h1>
            <p>Sign in to edit, deploy, and test functions.</p>
            <label>
              Username
              <input
                autoComplete="username"
                autoFocus
                placeholder="Username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error && <div className="login-error" role="alert">{error}</div>}
            <button type="submit" disabled={isSubmitting || !username || !password}>
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
