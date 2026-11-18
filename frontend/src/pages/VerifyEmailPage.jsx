import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AuthShell from '../components/auth/AuthShell';
import Alert from '../components/ui/Alert';
import { ROUTES } from '../config/navigation';
import { useSession } from '../context/SessionContext';
import { api } from '../services/api';

/** Opened from the verification email (?token=...); confirms the address straight away. */
export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const { isAuthenticated } = useSession();
  const [result, setResult] = useState(token ? 'pending' : 'missing');
  const [error, setError] = useState(null);
  const sentRef = useRef(false);

  useEffect(() => {
    // Once only: React's dev double-render would otherwise spend the token twice.
    if (!token || sentRef.current) return;
    sentRef.current = true;
    api
      .verifyEmail(token)
      .then(() => setResult('verified'))
      .catch((err) => {
        setError(err.message);
        setResult('failed');
      });
  }, [token]);

  const next = (
    <Link to={isAuthenticated ? ROUTES.projects : ROUTES.signIn} className="text-link text-link--medium">
      {isAuthenticated ? 'Go to your projects' : 'Go to sign in'}
    </Link>
  );

  return (
    <AuthShell title="Verify your email" footer={next}>
      {result === 'pending' && (
        <div className="async-state" role="status">
          <span className="spinner" aria-hidden="true" />
          Verifying…
        </div>
      )}
      {result === 'verified' && (
        <Alert tone="success" icon="verified" title="Email verified">
          Thanks, your email address is confirmed.
        </Alert>
      )}
      {result === 'failed' && (
        <Alert tone="error" icon="error" title="Couldn't verify your email">
          {error} You can send a new link from{' '}
          <Link to={ROUTES.settings} className="text-link">
            Account settings
          </Link>
          .
        </Alert>
      )}
      {result === 'missing' && (
        <Alert tone="error" icon="link_off" title="This link is incomplete">
          Open the link from the email again.
        </Alert>
      )}
    </AuthShell>
  );
}
