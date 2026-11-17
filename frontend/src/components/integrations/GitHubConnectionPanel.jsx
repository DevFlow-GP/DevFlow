import { useCallback, useState } from 'react';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Card from '../ui/Card';
import ChoiceCard from '../ui/ChoiceCard';
import Modal from '../ui/Modal';
import { api } from '../../services/api';
import { formatDate } from '../../utils/formatDate';

const ACCESS_OPTIONS = [
  {
    value: 'public',
    title: 'Public repositories',
    description: 'DevFlow can read your public repos only.',
  },
  {
    value: 'private',
    title: 'Public and private',
    description: 'Also lets DevFlow read and build your private repos.',
  },
];

export const ACCESS_LABELS = {
  public: 'Public repos only',
  private: 'Public and private repos',
};

/** Access level picker plus the button that sends the browser to GitHub. */
function ConnectForm({ initialAccess = 'public', submitLabel, onCancel }) {
  const [access, setAccess] = useState(initialAccess);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState(null);

  const connect = async () => {
    setRedirecting(true);
    setError(null);
    try {
      // The browser leaves DevFlow here; GitHub sends it back to /integrations/github.
      window.location.assign(await api.getGitHubAuthorizationUrl(access));
    } catch (err) {
      setError(err.message);
      setRedirecting(false);
    }
  };

  return (
    <div className="stack stack--md">
      <div className="choice-grid choice-grid--2" role="radiogroup" aria-label="GitHub access">
        {ACCESS_OPTIONS.map((option) => (
          <ChoiceCard
            key={option.value}
            name="github-access"
            value={option.value}
            checked={access === option.value}
            onChange={setAccess}
            title={option.title}
            description={option.description}
          />
        ))}
      </div>
      {error && (
        <Alert tone="error" icon="error" title="Couldn't start the GitHub connection">
          {error}
        </Alert>
      )}
      <div className="button-row">
        <Button icon="link" onClick={connect} disabled={redirecting}>
          {redirecting ? 'Opening GitHub…' : submitLabel}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={redirecting}>
            Cancel
          </Button>
        )}
      </div>
      <p className="text-muted github-panel__note">
        You'll approve access on GitHub, then come back here. You can disconnect at any time.
      </p>
    </div>
  );
}

/** Status of the user's GitHub link, with connect, change-access and disconnect actions. */
export default function GitHubConnectionPanel({ connection, onChanged }) {
  const [changingAccess, setChangingAccess] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState(null);

  const closeConfirm = useCallback(() => setConfirmOpen(false), []);

  const disconnect = async () => {
    setDisconnecting(true);
    setError(null);
    try {
      await api.disconnectGitHub();
      setConfirmOpen(false);
      onChanged();
    } catch (err) {
      setError(err.message);
      setConfirmOpen(false);
    } finally {
      setDisconnecting(false);
    }
  };

  if (!connection.connected) {
    return (
      <Card padding="lg" className="stack stack--md">
        <div>
          <h2 className="github-panel__title">Connect your GitHub account</h2>
          <p className="text-muted github-panel__text">
            DevFlow needs access to your repositories to create projects from them. Choose what it can see.
          </p>
        </div>
        <ConnectForm submitLabel="Connect GitHub" />
      </Card>
    );
  }

  const otherAccess = connection.access === 'private' ? 'public' : 'private';

  return (
    <Card padding="lg" className="stack stack--md">
      <div className="github-panel__account">
        <div>
          <div className="eyebrow text-muted">Connected account</div>
          <a
            className="github-panel__login"
            href={`https://github.com/${connection.username}`}
            target="_blank"
            rel="noreferrer"
          >
            @{connection.username}
          </a>
        </div>
        <span className="badge badge--success">{ACCESS_LABELS[connection.access]}</span>
      </div>
      {connection.connected_at && (
        <div className="meta-list">
          <span>
            Connected since <strong>{formatDate(connection.connected_at)}</strong>
          </span>
        </div>
      )}

      {error && (
        <Alert tone="error" icon="error" title="Couldn't disconnect GitHub">
          {error}
        </Alert>
      )}

      {changingAccess ? (
        <ConnectForm
          initialAccess={otherAccess}
          submitLabel="Reconnect with this access"
          onCancel={() => setChangingAccess(false)}
        />
      ) : (
        <div className="button-row">
          <Button variant="outline" icon="tune" onClick={() => setChangingAccess(true)}>
            Change access
          </Button>
          <Button variant="danger" icon="link_off" onClick={() => setConfirmOpen(true)}>
            Disconnect
          </Button>
        </div>
      )}

      <Modal
        open={confirmOpen}
        onClose={closeConfirm}
        title="Disconnect GitHub?"
        actions={
          <>
            <Button variant="ghost" onClick={closeConfirm} disabled={disconnecting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={disconnect} disabled={disconnecting}>
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </>
        }
      >
        DevFlow will lose access to <strong>@{connection.username}</strong>&apos;s repositories, and the
        authorization is revoked on GitHub too. Your existing projects stay, but you&apos;ll need to reconnect to
        create new ones.
      </Modal>
    </Card>
  );
}
