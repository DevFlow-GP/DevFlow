import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import GitHubConnectionPanel, { ACCESS_LABELS } from '../components/integrations/GitHubConnectionPanel';
import GitHubRepoList from '../components/integrations/GitHubRepoList';
import Page from '../components/layout/Page';
import PageHeader from '../components/layout/PageHeader';
import WorkspaceSideNav from '../components/projects/WorkspaceSideNav';
import Alert from '../components/ui/Alert';
import AsyncContent from '../components/ui/AsyncContent';
import Button from '../components/ui/Button';
import { ROUTES } from '../config/navigation';
import { useSession } from '../context/SessionContext';
import useApi from '../hooks/useApi';
import { api } from '../services/api';

/** Why the GitHub round trip failed (`reason` in the backend's redirect). */
const ERROR_REASONS = {
  invalid_state: 'The connection link expired or was already used. Please try connecting again.',
  missing_code: "GitHub didn't send an approval back. Please try connecting again.",
  github_error: "GitHub didn't respond as expected. Please try again in a moment.",
};

/**
 * The backend sends the browser here after GitHub with
 * ?status=connected&access=... | ?status=cancelled | ?status=error&reason=...
 */
function readResult(params) {
  const status = params.get('status');
  if (status === 'connected') {
    return {
      tone: 'success',
      icon: 'check_circle',
      title: 'GitHub connected',
      message: `DevFlow can now see your ${ACCESS_LABELS[params.get('access')]?.toLowerCase() ?? 'repositories'}.`,
    };
  }
  if (status === 'cancelled') {
    return {
      tone: 'warning',
      icon: 'info',
      title: 'Connection cancelled',
      message: 'You cancelled on GitHub, so nothing changed.',
    };
  }
  if (status === 'error') {
    return {
      tone: 'error',
      icon: 'error',
      title: "Couldn't connect GitHub",
      message: ERROR_REASONS[params.get('reason')] ?? 'Something went wrong. Please try again.',
    };
  }
  return null;
}

export default function GitHubIntegrationPage() {
  const { workspace } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const [result, setResult] = useState(() => readResult(searchParams));
  const state = useApi(api.getGitHubConnection);

  // Show the result once; drop it from the URL so a refresh doesn't repeat it.
  useEffect(() => {
    if (searchParams.has('status')) setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const refresh = () => {
    setResult(null);
    state.reload();
  };

  return (
    <Page variant="sidebar">
      <WorkspaceSideNav workspace={workspace} />

      <main className="page-main">
        <div className="container container--3xl stack">
          <PageHeader
            title="GitHub"
            description="Connect GitHub so DevFlow can list your repositories and create projects from them."
            actions={
              state.data?.connected && (
                <Button icon="add" iconSize="base" to={ROUTES.newProject}>
                  New project
                </Button>
              )
            }
          />

          {result && (
            <Alert
              tone={result.tone}
              icon={result.icon}
              title={result.title}
              action={
                <Button variant="ghost" size="xs" icon="close" aria-label="Dismiss" onClick={() => setResult(null)} />
              }
            >
              {result.message}
            </Alert>
          )}

          <AsyncContent state={state} loadingLabel="Checking your GitHub connection…">
            {(connection) => (
              <>
                <GitHubConnectionPanel connection={connection} onChanged={refresh} />
                {/* Keyed so changing access reloads the list with what's now visible. */}
                {connection.connected && <GitHubRepoList key={connection.access} />}
              </>
            )}
          </AsyncContent>
        </div>
      </main>
    </Page>
  );
}
