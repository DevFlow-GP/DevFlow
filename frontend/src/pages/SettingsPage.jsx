import { useCallback, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Page from '../components/layout/Page';
import PageHeader from '../components/layout/PageHeader';
import WorkspaceSideNav from '../components/projects/WorkspaceSideNav';
import Alert from '../components/ui/Alert';
import AsyncContent from '../components/ui/AsyncContent';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import FormField from '../components/ui/FormField';
import Modal from '../components/ui/Modal';
import { ROUTES } from '../config/navigation';
import { useSession } from '../context/SessionContext';
import useApi from '../hooks/useApi';
import { api, tokenStore } from '../services/api';

/** Success or error line under a form. */
function Result({ result }) {
  if (!result) return null;
  return (
    <Alert tone={result.ok ? 'success' : 'error'} icon={result.ok ? 'check_circle' : 'error'} title={result.title}>
      {result.text}
    </Alert>
  );
}

function ProfileCard({ me, onSaved }) {
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const [name, setName] = useState(me.full_name);
  const [email, setEmail] = useState(me.email);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const emailChanged = email.trim().toLowerCase() !== me.email.toLowerCase();

  const save = async (event) => {
    event.preventDefault();
    const fields = {};
    if (name.trim() !== me.full_name) fields.full_name = name.trim();
    if (emailChanged) Object.assign(fields, { email: email.trim(), current_password: password });
    setSaving(true);
    setResult(null);
    try {
      onSaved(await api.updateMe(fields));
      setPassword('');
      setResult({
        ok: true,
        title: 'Profile saved',
        text: emailChanged ? 'Check your new inbox for a verification link.' : 'Your changes are saved.',
      });
    } catch (err) {
      setResult({ ok: false, title: "Couldn't save your profile", text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const dirty = name.trim() !== me.full_name || emailChanged;

  return (
    <Card padding="lg" className="stack stack--md">
      <h2 className="panel-title panel-title--flush">Profile</h2>
      <Result result={result} />
      <form className="form" onSubmit={save}>
        <FormField label="Full name" htmlFor={nameId}>
          <input id={nameId} className="input" required maxLength={255} value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label="Email" htmlFor={emailId} hint="A new address must be verified again.">
          <input id={emailId} type="email" className="input" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </FormField>
        {emailChanged && (
          <FormField label="Current password" htmlFor={passwordId} hint="Needed to change your email.">
            <input
              id={passwordId}
              type="password"
              className="input"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormField>
        )}
        <div className="button-row">
          <Button type="submit" icon="save" disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save profile'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function VerificationCard({ me }) {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const resend = async () => {
    setSending(true);
    setResult(null);
    try {
      await api.resendVerification();
      setResult({ ok: true, title: 'Link sent', text: `Check ${me.email} for a new verification link.` });
    } catch (err) {
      setResult({ ok: false, title: "Couldn't send the link", text: err.message });
    } finally {
      setSending(false);
    }
  };

  if (me.email_verified) {
    return (
      <Alert tone="success" icon="verified" title="Email verified">
        {me.email} is confirmed.
      </Alert>
    );
  }
  return (
    <>
      <Alert
        icon="mark_email_unread"
        title="Email not verified yet"
        action={
          <Button size="xs" variant="warning" icon="send" onClick={resend} disabled={sending}>
            {sending ? 'Sending…' : 'Resend link'}
          </Button>
        }
      >
        Open the link we sent to {me.email}.
      </Alert>
      <Result result={result} />
    </>
  );
}

function PasswordCard({ onChanged }) {
  const currentId = useId();
  const newId = useId();
  const confirmId = useId();
  const formRef = useRef(null);
  const newRef = useRef(null);
  const confirmRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const checkMatch = () => {
    const confirm = confirmRef.current;
    confirm.setCustomValidity(confirm.value && confirm.value !== newRef.current.value ? 'Passwords do not match.' : '');
  };

  const save = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setResult(null);
    try {
      const response = await api.changePassword({
        currentPassword: form.get('current'),
        newPassword: form.get('new'),
      });
      // Every older token is now invalid, including the one this tab used.
      onChanged(response.access_token);
      formRef.current.reset();
      setResult({ ok: true, title: 'Password changed', text: 'Other devices have been signed out.' });
    } catch (err) {
      setResult({ ok: false, title: "Couldn't change the password", text: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card padding="lg" className="stack stack--md">
      <h2 className="panel-title panel-title--flush">Password</h2>
      <Result result={result} />
      <form className="form" onSubmit={save} ref={formRef}>
        <FormField label="Current password" htmlFor={currentId}>
          <input id={currentId} name="current" type="password" required autoComplete="current-password" className="input" />
        </FormField>
        <FormField label="New password" htmlFor={newId} hint="At least 8 characters.">
          <input
            id={newId}
            ref={newRef}
            name="new"
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
          <input id={confirmId} ref={confirmRef} type="password" required autoComplete="new-password" className="input" onInput={checkMatch} />
        </FormField>
        <div className="button-row">
          <Button type="submit" icon="key" disabled={saving}>
            {saving ? 'Changing…' : 'Change password'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function DeleteAccountCard() {
  const navigate = useNavigate();
  const { signOut } = useSession();
  const passwordId = useId();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const close = useCallback(() => setOpen(false), []);

  const remove = async () => {
    setDeleting(true);
    setError(null);
    try {
      await api.deleteAccount(password);
      signOut();
      navigate(ROUTES.landing, { replace: true });
    } catch (err) {
      setError(err.message);
      setDeleting(false);
    }
  };

  return (
    <Card padding="lg" className="danger-zone">
      <div>
        <div className="danger-zone__title">Delete account</div>
        <p className="text-muted danger-zone__text">
          Deletes your account and your projects, revokes GitHub access, and deletes your company if you're its only member.
        </p>
      </div>
      <Button variant="danger" icon="delete_forever" onClick={() => setOpen(true)}>
        Delete account
      </Button>
      <Modal
        open={open}
        onClose={close}
        title="Delete your account?"
        actions={
          <>
            <Button variant="ghost" onClick={close} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" icon="delete_forever" onClick={remove} disabled={deleting || !password}>
              {deleting ? 'Deleting…' : 'Delete account'}
            </Button>
          </>
        }
      >
        <div className="stack stack--md">
          <p>This can't be undone. Enter your password to confirm.</p>
          {error && <div className="text-error">{error}</div>}
          <FormField label="Password" htmlFor={passwordId}>
            <input
              id={passwordId}
              type="password"
              className="input"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormField>
        </div>
      </Modal>
    </Card>
  );
}

export default function SettingsPage() {
  const { workspace, refreshSession } = useSession();
  const state = useApi(api.getMe);
  const [me, setMe] = useState(null);

  const onProfileSaved = (updated) => {
    setMe(updated);
    refreshSession(); // the navbar shows the name and initials
  };

  const onPasswordChanged = (token) => {
    tokenStore.set(token);
    refreshSession();
  };

  return (
    <Page variant="sidebar">
      <WorkspaceSideNav workspace={workspace} />
      <main className="page-main">
        <div className="container container--3xl stack">
          <PageHeader title="Account settings" description="Your profile, email, password and account." />
          <AsyncContent state={state} loadingLabel="Loading your account…">
            {(loaded) => {
              const current = me ?? loaded;
              return (
                <>
                  <VerificationCard me={current} />
                  <ProfileCard key={current.email} me={current} onSaved={onProfileSaved} />
                  <PasswordCard onChanged={onPasswordChanged} />
                  <DeleteAccountCard />
                </>
              );
            }}
          </AsyncContent>
        </div>
      </main>
    </Page>
  );
}
