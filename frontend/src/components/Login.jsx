import React from 'react';
import { useAuth } from '../context/AuthContext';

const Login = () => {
  const { user, loginWithGoogle, loginWithEmail, logout } = useAuth();
  const [showEmail, setShowEmail] = React.useState(false);
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState(null);

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    try {
      await loginWithEmail(email, password);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  };

  if (user && !user.isAnonymous) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', animation: 'fadeIn 0.4s ease-out' }}>
        {user.photoURL ? (
          <img 
            src={user.photoURL} 
            alt={user.displayName} 
            style={{ 
                width: '40px', 
                height: '40px', 
                borderRadius: '50%', 
                border: '2px solid var(--md-sys-color-primary-container)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
            }}
          />
        ) : (
          <div style={{ 
              width: '40px', 
              height: '40px', 
              borderRadius: '50%', 
              backgroundColor: 'var(--md-sys-color-primary)', 
              color: 'var(--md-sys-color-on-primary)',
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              fontWeight: 'bold',
              fontSize: '1.125rem'
          }}>
            {user.email?.[0].toUpperCase() || '?'}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ 
              fontSize: '0.875rem', 
              fontWeight: 500, 
              color: 'var(--md-sys-color-on-surface)',
              marginBottom: '2px'
          }}>
            {user.displayName || user.email?.split('@')[0]}
          </span>
          <button
            onClick={logout}
            style={{ 
                background: 'none',
                border: 'none',
                padding: 0,
                color: 'var(--md-sys-color-error)', 
                fontSize: '0.75rem', 
                fontWeight: 500, 
                textAlign: 'left',
                cursor: 'pointer',
                opacity: 0.8
            }}
            onMouseOver={e => e.target.style.opacity = 1}
            onMouseOut={e => e.target.style.opacity = 0.8}
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  if (showEmail) {
    return (
      <form onSubmit={handleEmailLogin} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', position: 'relative' }}>
        <md-outlined-text-field
          label="Email"
          type="email"
          value={email}
          onInput={e => setEmail(e.target.value)}
          style={{ height: '48px', '--md-outlined-text-field-container-shape': '12px' }}
        ></md-outlined-text-field>
        <md-outlined-text-field
          label="Password"
          type="password"
          value={password}
          onInput={e => setPassword(e.target.value)}
          style={{ height: '48px', '--md-outlined-text-field-container-shape': '12px' }}
        ></md-outlined-text-field>
        
        <md-filled-button type="submit">Login</md-filled-button>
        
        <md-outlined-icon-button type="button" onClick={() => setShowEmail(false)} style={{ '--md-outlined-icon-button-container-shape': '12px' }}>
          <md-icon><span className="material-symbols-outlined">close</span></md-icon>
        </md-outlined-icon-button>

        {error && (
            <div style={{ 
                position: 'absolute', 
                top: '52px', 
                left: 0, 
                color: 'var(--md-sys-color-error)', 
                fontSize: '0.75rem',
                backgroundColor: 'var(--md-sys-color-error-container)',
                padding: '4px 8px',
                borderRadius: '4px'
            }}>
                {error}
            </div>
        )}
      </form>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
      <md-outlined-button onClick={loginWithGoogle}>
        <svg slot="icon" viewBox="0 0 24 24" style={{ width: '18px', height: '18px' }}>
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
          />
        </svg>
        Sign in with Google
      </md-outlined-button>
      
      <md-outlined-button onClick={() => setShowEmail(true)}>
          <md-icon slot="icon"><span className="material-symbols-outlined">mail</span></md-icon>
          Email Login
      </md-outlined-button>
    </div>
  );
};

export default Login;
