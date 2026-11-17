import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import FrameworkSection from './FrameworkSection';
import ModulesSection from './ModulesSection';
import PipelineModeSection from './PipelineModeSection';
import ProjectSpecSection from './ProjectSpecSection';
import SourceSection from './SourceSection';
import { ROUTES } from '../../config/navigation';
import { api } from '../../services/api';

/** The repo dropdown shows this many of the most recently updated repos. */
const REPO_LIMIT = 100;

const repoName = (fullName) => fullName.split('/')[1] ?? fullName;

function GitHubNotice({ title, message }) {
  return (
    <Alert
      icon="link_off"
      title={title}
      action={
        <Button size="xs" icon="link" to={ROUTES.githubIntegration}>
          Go to GitHub settings
        </Button>
      }
    >
      {message}
    </Alert>
  );
}

/**
 * Creates a project from one of the user's GitHub repositories (POST /projects).
 * Framework, environment, modules and pipeline mode come from mock options and
 * aren't saved yet: the backend has no templates or pipelines so far.
 */
export default function NewProjectForm({ options }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedRepo = searchParams.get('repo');
  const { defaults } = options;

  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [environment, setEnvironment] = useState(options.environments[0].value);
  const [source, setSource] = useState('github');
  const [code, setCode] = useState(defaults.entrypoint);
  const [framework, setFramework] = useState(defaults.framework);
  const [modules, setModules] = useState(
    () => new Set(options.modules.filter((module) => module.enabled).map((module) => module.id)),
  );
  const [pipelineMode, setPipelineMode] = useState('standard');

  const [repos, setRepos] = useState({ loading: true, items: [], hasMore: false, error: null });
  const [repository, setRepository] = useState('');
  const [branches, setBranches] = useState({ loading: false, items: [], hasMore: false, error: null });
  const [branch, setBranch] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // The user's repositories, most recently updated first.
  useEffect(() => {
    let cancelled = false;
    api
      .listGitHubRepos({ perPage: REPO_LIMIT })
      .then((result) => {
        if (cancelled) return;
        const items = result.repositories;
        setRepos({ loading: false, items, hasMore: result.has_next, error: null });
        const wanted = items.find((repo) => repo.full_name.toLowerCase() === requestedRepo?.toLowerCase());
        setRepository((wanted ?? items[0])?.full_name ?? '');
      })
      .catch((error) => {
        if (!cancelled) setRepos({ loading: false, items: [], hasMore: false, error });
      });
    return () => {
      cancelled = true;
    };
  }, [requestedRepo]);

  // Branches of the selected repository; the default branch is preselected.
  useEffect(() => {
    if (!repository) return undefined;
    let cancelled = false;
    setBranches({ loading: true, items: [], hasMore: false, error: null });
    setBranch('');
    api
      .listGitHubBranches(repository)
      .then((result) => {
        if (cancelled) return;
        const items = result.branches.map((item) => item.name);
        if (!items.includes(result.default_branch)) items.unshift(result.default_branch);
        setBranches({ loading: false, items, hasMore: result.has_next, error: null });
        setBranch(result.default_branch);
      })
      .catch((error) => {
        if (!cancelled) setBranches({ loading: false, items: [], hasMore: false, error });
      });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  // Until the user types their own, the project is named after the repository.
  useEffect(() => {
    if (!nameEdited && repository) setName(repoName(repository));
  }, [repository, nameEdited]);

  const changeName = (value) => {
    setName(value);
    setNameEdited(true);
  };

  const toggleModule = (id, checked) => {
    setModules((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitError(null);
    if (source !== 'github') {
      setSubmitError("Pasting code isn't supported yet. Link a GitHub repository instead.");
      return;
    }
    if (!repository || !branch) {
      setSubmitError('Choose a repository and a branch first.');
      return;
    }
    setSubmitting(true);
    try {
      await api.createProject({ repoFullName: repository, name: name.trim() || undefined, branch });
      navigate(ROUTES.projects);
    } catch (error) {
      setSubmitError(error.message);
      setSubmitting(false);
    }
  };

  // --- what the source section shows -------------------------------------------
  let notice = null;
  if (source === 'paste') {
    notice = (
      <Alert icon="info" title="Not available yet">
        DevFlow can only build from a GitHub repository for now.
      </Alert>
    );
  } else if (repos.error?.status === 409) {
    // Not connected, or access was revoked on GitHub.
    notice = <GitHubNotice title="Connect GitHub to pick a repository" message={repos.error.message} />;
  } else if (repos.error) {
    notice = (
      <Alert tone="error" icon="error" title="Couldn't load your repositories">
        {repos.error.message}
      </Alert>
    );
  } else if (!repos.loading && repos.items.length === 0) {
    notice = (
      <GitHubNotice
        title="No repositories found"
        message="The connected GitHub account has no repositories DevFlow can see. Create one on GitHub, or reconnect with private access."
      />
    );
  }

  const repositoryOptions = repos.loading
    ? [{ value: '', label: 'Loading repositories…' }]
    : repos.items.map((repo) => ({
        value: repo.full_name,
        label: `${repo.full_name}${repo.private ? ' (private)' : ''}`,
      }));
  let branchOptions = branches.items;
  if (branches.loading || (repos.loading && !repository)) branchOptions = [{ value: '', label: 'Loading…' }];
  else if (branches.error) branchOptions = [{ value: '', label: "Couldn't load branches" }];

  const ready = source === 'github' && !notice && Boolean(repository && branch);

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-stack">
        <ProjectSpecSection
          name={name}
          onNameChange={changeName}
          domain={`${name || 'your-project'}${defaults.domainSuffix}`}
          environment={environment}
          environments={options.environments}
          onEnvironmentChange={setEnvironment}
        />
        <SourceSection
          source={source}
          onSourceChange={setSource}
          repositories={repositoryOptions}
          repository={repository}
          onRepositoryChange={setRepository}
          repositoriesDisabled={repos.loading}
          repositoriesHint={repos.hasMore ? `Showing your ${REPO_LIMIT} most recently updated repositories.` : undefined}
          branches={branchOptions}
          branch={branch}
          onBranchChange={setBranch}
          branchesDisabled={branches.loading || Boolean(branches.error) || !repository}
          branchesHint={branches.error?.message ?? (branches.hasMore ? 'Showing the first 100 branches.' : undefined)}
          notice={notice}
          code={code}
          onCodeChange={setCode}
        />
        <FrameworkSection
          frameworks={options.frameworks}
          value={framework}
          onChange={setFramework}
          notice={options.frameworkNotice}
        />
        <ModulesSection modules={options.modules} selected={modules} onToggle={toggleModule} />
        <PipelineModeSection
          mode={pipelineMode}
          onModeChange={setPipelineMode}
          stages={options.stages}
          script={options.pipelineScript}
        />

        {submitError && (
          <Alert tone="error" icon="error" title="Couldn't create the project">
            {submitError}
          </Alert>
        )}
      </div>

      {/* Sticky bottom action bar */}
      <div className="action-bar">
        <div className="action-bar__inner">
          <div className="action-bar__note">
            Saves the project and its branch. Builds and deploys aren&apos;t connected yet.
          </div>
          <div className="action-bar__actions">
            <Button variant="ghost" to={ROUTES.projects}>
              Cancel
            </Button>
            <Button type="submit" icon="add" className="btn--wide" disabled={!ready || submitting}>
              {submitting ? 'Creating…' : 'Create project'}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
