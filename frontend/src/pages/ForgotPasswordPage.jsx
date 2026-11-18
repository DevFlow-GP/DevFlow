import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import AuthShell from '../components/auth/AuthShell';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import FormField from '../components/ui/FormField';
import { ROUTES } from '../config/navigation';
import { api } from '../services/api';

/** Asks for an email and sends a reset link. The backend answers the same whether or not the account exists. */
export default function ForgotPasswordPage() {
  const emailId = useId();
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.forgotPassword(new FormData(event.currentTarget).get('email'));
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your account's email and we'll send you a link to choose a new password."
      footer={
        <Link to={ROUTES.signIn} className="text-link text-link--medium">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <Alert tone="success" icon="mark_email_read" title="Check your inbox">
          If an account uses that email, a reset link is on its way. The link expires in 30 minutes.
        </Alert>
      ) : (
        <form className="form" onSubmit={submit}>
          {error && (
            <Alert tone="error" icon="error" title="Couldn't send the link">
              {error}
            </Alert>
          )}
          <FormField label="Work Email" htmlFor={emailId}>
            <input id={emailId} name="email" type="email" required autoComplete="email" className="input" />
          </FormField>
          <Button type="submit" block className="auth-card__submit" disabled={submitting}>
            {submitting ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
