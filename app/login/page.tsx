'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login, storeUser, type LoginCredentials } from '@/lib/auth-api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const credentials: LoginCredentials = { email, password };
      const response = await login(credentials);
      
      if (response.ok && response.user) {
        // Store user data
        storeUser(response.user);
        
        // Redirect to home page
        router.push('/');
      } else {
        setError('Login failed. Please check your credentials.');
      }
    } catch (err: any) {
      setError(err.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 16px',
        background:
          'radial-gradient(circle at top, #0f172a 0, #020617 45%, #000000 100%)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          borderRadius: 24,
          padding: '32px 28px 26px',
          background:
            'linear-gradient(145deg, rgba(15,23,42,0.96), rgba(17,24,39,0.98))',
          border: '1px solid rgba(55,65,81,0.85)',
          boxShadow:
            '0 25px 70px rgba(15,23,42,0.95), 0 0 0 1px rgba(2,6,23,0.9)',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginBottom: 24,
            gap: 10,
          }}
        >
          <div
            style={{
              width: 54,
              height: 54,
              borderRadius: 999,
              background:
                'conic-gradient(from 180deg, #FE732E, #f97316, #22c55e, #0ea5e9, #4f46e5, #FE732E)',
              padding: 3,
            }}
          >
            <div
              style={{
                width: '100%',
                height: '100%',
                borderRadius: '999px',
                backgroundColor: '#020617',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 24,
                color: '#e5e7eb',
                fontWeight: 800,
              }}
            >
              T
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <h1
              style={{
                marginBottom: 4,
                color: '#f9fafb',
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: 0.4,
              }}
            >
              Totus Web Calling
            </h1>
            <p
              style={{
                margin: 0,
                color: '#9ca3af',
                fontSize: 13,
              }}
            >
              Войдите как агент, чтобы управлять звонками
            </p>
          </div>
        </div>

        {error && (
          <div
            style={{
              marginBottom: 18,
              padding: '10px 12px',
              backgroundColor: 'rgba(127,29,29,0.18)',
              border: '1px solid rgba(248,113,113,0.55)',
              borderRadius: 10,
              color: '#fecaca',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 18 }}>
            <label
              style={{
                display: 'block',
                marginBottom: 6,
                color: '#e5e7eb',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
              placeholder="agent@totus.club"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid rgba(75,85,99,0.9)',
                backgroundColor: 'rgba(15,23,42,0.95)',
                color: '#e5e7eb',
                fontSize: 14,
                outline: 'none',
              }}
            />
          </div>

          <div style={{ marginBottom: 22 }}>
            <label
              style={{
                display: 'block',
                marginBottom: 6,
                color: '#e5e7eb',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              Пароль
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              placeholder="Введите пароль агента"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid rgba(75,85,99,0.9)',
                backgroundColor: 'rgba(15,23,42,0.95)',
                color: '#e5e7eb',
                fontSize: 14,
                outline: 'none',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px 14px',
              borderRadius: 999,
              border: 'none',
              background: loading
                ? '#374151'
                : 'linear-gradient(135deg, #FE732E, #f97316)',
              color: '#f9fafb',
              fontSize: 15,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              boxShadow: loading
                ? 'none'
                : '0 16px 40px rgba(248,113,22,0.55)',
            }}
          >
            {loading ? 'Вход...' : 'Войти'}
          </button>
        </form>

        <div
          style={{
            marginTop: 20,
            padding: '10px 12px',
            borderRadius: 12,
            backgroundColor: 'rgba(15,23,42,0.95)',
            border: '1px dashed rgba(75,85,99,0.9)',
            fontSize: 11,
            color: '#9ca3af',
            textAlign: 'center',
          }}
        >
          Только пользователи с ролью <strong>agent</strong> могут войти в
          систему.
        </div>
      </div>
    </div>
  );
}

