import { useId, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AuthShell from '../components/auth/AuthShell';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import FormField from '../components/ui/FormField';
import { ROUTES } from '../config/navigation';
import { api } from '../services/api';

/** Opened from the emailed link (?token=...). The link works once. */
export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const passwordId = useId();
  const confirmId = useId();
  const passwordRef = useRef(null);
  const confirmRef = useRef(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const checkMatch = () => {
    const confirm = confirmRef.current;
    confirm.setCustomValidity(confirm.value && confirm.value !== passwordRef.current.value ? 'Passwords do not match.' : '');
  };

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.resetPassword({ token, newPassword: passwordRef.current.value });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const signInLink = (
    <Link to={ROUTES.signIn} className="text-link text-link--medium">
      Go to sign in
    </Link>
  );

  if (!token) {
    return (
      <AuthShell title="Reset your password" footer={signInLink}>
        <Alert tone="error" icon="link_off" title="This link is incomplete">
          Open the link from the email again, or{' '}
          <Link to={ROUTES.forgotPassword} className="text-link">
            request a new one
          </Link>
          .
        </Alert>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password" subtitle="This signs you out everywhere else." footer={signInLink}>
      {done ? (
        <Alert tone="success" icon="check_circle" title="Password changed">
          You can sign in with your new password now.
        </Alert>
      ) : (
        <form className="form" onSubmit={submit}>
          {error && (
            <Alert tone="error" icon="error" title="Couldn't reset the password">
              {error}{' '}
              <Link to={ROUTES.forgotPassword} className="text-link">
                Request a new link
              </Link>
            </Alert>
          )}
          <FormField label="New password" htmlFor={passwordId}>
            <input
              id={passwordId}
              ref={passwordRef}
              type="password"
              required
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              className="input"
              onInput={checkMatch}
            />
          </FormField>
          <FormField label="Confirm new password" htmlFor={confirmId}>
            <input
              id={confirmId}
              ref={confirmRef}
              type="password"
              required
              autoComplete="new-password"
              className="input"
              onInput={checkMatch}
            />
          </FormField>
          <Button type="submit" block className="auth-card__submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Set new password'}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
