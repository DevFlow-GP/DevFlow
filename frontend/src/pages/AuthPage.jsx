import { useId, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Page from '../components/layout/Page';
import Alert from '../components/ui/Alert';
import AsyncContent from '../components/ui/AsyncContent';
import Button from '../components/ui/Button';
import FormField from '../components/ui/FormField';
import Icon from '../components/ui/Icon';
import SegmentedControl from '../components/ui/SegmentedControl';
import { REDIRECT_PARAM, ROUTES, safeRedirectPath } from '../config/navigation';
import { useSession } from '../context/SessionContext';
import useApi from '../hooks/useApi';
import { api } from '../services/api';

const SIGN_IN = 'signin';
const SIGN_UP = 'signup';

function SignInForm({ placeholders, submitLabel, submitting, onSubmit }) {
  const emailId = useId();
  const passwordId = useId();
  return (
    <form className="form" onSubmit={onSubmit}>
      <FormField label="Work Email" htmlFor={emailId}>
        <input id={emailId} name="email" type="email" required autoComplete="email" className="input" placeholder={placeholders.email} />
      </FormField>
      <FormField
        label="Password"
        htmlFor={passwordId}
        action={
          <Link to={ROUTES.forgotPassword} className="text-link">
            Forgot password?
          </Link>
        }
      >
        <input id={passwordId} name="password" type="password" required autoComplete="current-password" className="input" />
      </FormField>
      <Button type="submit" block className="auth-card__submit" disabled={submitting}>
        {submitting ? 'Signing in…' : submitLabel}
      </Button>
    </form>
  );
}

function SignUpForm({ placeholders, submitLabel, submitting, onSubmit }) {
  const nameId = useId();
  const companyId = useId();
  const emailId = useId();
  const passwordId = useId();
  const confirmPasswordId = useId();
  const passwordRef = useRef(null);
  const confirmPasswordRef = useRef(null);

  // Native constraint validation blocks submission and shows the browser's message while they differ.
  const checkPasswordsMatch = () => {
    const confirm = confirmPasswordRef.current;
    const mismatch = confirm.value && confirm.value !== passwordRef.current.value;
    confirm.setCustomValidity(mismatch ? 'Passwords do not match.' : '');
  };

  return (
    <form className="form" onSubmit={onSubmit}>
      <FormField label="Full Name" htmlFor={nameId}>
        <input id={nameId} name="name" type="text" required maxLength={255} autoComplete="name" className="input" placeholder={placeholders.name} />
      </FormField>
      <FormField label="Company (optional)" htmlFor={companyId} hint="Creates a workspace for your company.">
        <input id={companyId} name="companyName" type="text" maxLength={255} autoComplete="organization" className="input" placeholder={placeholders.company} />
      </FormField>
      <FormField label="Work Email" htmlFor={emailId}>
        <input id={emailId} name="email" type="email" required autoComplete="email" className="input" placeholder={placeholders.email} />
      </FormField>
      <FormField label="Password" htmlFor={passwordId}>
        <input
          id={passwordId}
          ref={passwordRef}
          name="password"
          type="password"
          required
          minLength={8}
          maxLength={128}
          autoComplete="new-password"
          className="input"
          placeholder={placeholders.password}
          onInput={checkPasswordsMatch}
        />
      </FormField>
      <FormField label="Confirm Password" htmlFor={confirmPasswordId}>
        <input
          id={confirmPasswordId}
          ref={confirmPasswordRef}
          name="confirmPassword"
          type="password"
          required
          autoComplete="new-password"
          className="input"
          placeholder={placeholders.confirmPassword}
          onInput={checkPasswordsMatch}
        />
      </FormField>
      <Button type="submit" block className="auth-card__submit" disabled={submitting}>
        {submitting ? 'Creating account…' : submitLabel}
      </Button>
    </form>
  );
}

export default function AuthPage() {
  const state = useApi(api.getAuthContent);
  const navigate = useNavigate();
  const { signIn, signUp } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = searchParams.get('mode') === SIGN_IN ? SIGN_IN : SIGN_UP;
  const redirectTo = safeRedirectPath(searchParams.get(REDIRECT_PARAM));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Switching tabs keeps the pending redirect so the user still lands where they were headed.
  const setMode = (nextMode) => {
    setError(null);
    const params = {};
    if (nextMode === SIGN_IN) params.mode = SIGN_IN;
    if (redirectTo) params[REDIRECT_PARAM] = redirectTo;
    setSearchParams(params, { replace: true });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    setSubmitting(true);
    setError(null);
    try {
      if (mode === SIGN_IN) {
        await signIn({ email: form.email, password: form.password });
      } else {
        await signUp({
          name: form.name,
          email: form.email,
          password: form.password,
          companyName: form.companyName.trim() || undefined,
        });
      }
      navigate(redirectTo ?? ROUTES.projects, { replace: true });
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <Page variant="auth">
      <AsyncContent state={state}>
        {({ modes, placeholders }) => {
          const copy = modes[mode];
          const otherMode = mode === SIGN_IN ? SIGN_UP : SIGN_IN;
          return (
            <div className="auth-card">
              <div className="auth-card__head">
                <Link to={ROUTES.landing} className="auth-card__brand">
                  <Icon name="rocket_launch" />
                  DevFlow
                </Link>
                <h1 className="auth-card__title">{copy.headline}</h1>
                <p className="auth-card__subtitle">{copy.subhead}</p>
              </div>

              <div className="auth-card__tabs">
                <SegmentedControl
                  block
                  label="Authentication mode"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: SIGN_IN, label: modes.signin.tabLabel },
                    { value: SIGN_UP, label: modes.signup.tabLabel },
                  ]}
                />
              </div>

              {error && (
                <Alert tone="error" icon="error" title={copy.errorTitle}>
                  {error}
                </Alert>
              )}

              {mode === SIGN_IN ? (
                <SignInForm placeholders={placeholders} submitLabel={copy.submitLabel} submitting={submitting} onSubmit={handleSubmit} />
              ) : (
                <SignUpForm placeholders={placeholders} submitLabel={copy.submitLabel} submitting={submitting} onSubmit={handleSubmit} />
              )}

              <div className="auth-card__switch">
                {copy.switchPrompt}{' '}
                <button type="button" className="text-link text-link--medium" onClick={() => setMode(otherMode)}>
                  {copy.switchAction}
                </button>
              </div>
            </div>
          );
        }}
      </AsyncContent>
    </Page>
  );
}
