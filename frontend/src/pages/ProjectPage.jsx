import { useCallback, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import Page from '../components/layout/Page';
import PageHeader from '../components/layout/PageHeader';
import BuildHistory from '../components/project/BuildHistory';
import LinkJenkinsJob from '../components/project/LinkJenkinsJob';
import ProjectSettings from '../components/project/ProjectSettings';
import ProjectSideNav from '../components/project/ProjectSideNav';
import QueuedBuildBanner from '../components/project/QueuedBuildBanner';
import Alert from '../components/ui/Alert';
import AsyncContent from '../components/ui/AsyncContent';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import Icon from '../components/ui/Icon';
import MetricCard from '../components/ui/MetricCard';
import usePolling from '../hooks/usePolling';
import { api } from '../services/api';
import { formatRelative } from '../utils/formatDate';
import { buildDuration } from '../utils/formatDuration';
import { buildStatusKey, getStatus, isBuildActive } from '../utils/status';

const BUILD_LIMIT = 20;
const STATUS_TEXT_TONE = { success: 'success', danger: 'error', warning: 'warning' };

/** Last build, duration, success rate and branch, from the builds Jenkins reports. */
function BuildMetrics({ project, builds }) {
  const latest = builds[0];
  const finished = builds.filter((build) => !isBuildActive(build));
  const passed = finished.filter((build) => build.status === 'success').length;
  const latestStatus = latest && getStatus(buildStatusKey(latest));
  return (
    <div className="metric-grid">
      <MetricCard
        label="Last build"
        value={latest ? latestStatus.label : 'None yet'}
        valueTone={latest ? STATUS_TEXT_TONE[latestStatus.tone] : undefined}
        hint={latest ? `#${latest.number} · ${formatRelative(latest.started_at)}` : 'Run the first build'}
      />
      <MetricCard
        label="Duration"
        value={latest ? buildDuration(latest) : '—'}
        hint={latest && isBuildActive(latest) ? 'Still running' : 'Last build'}
      />
      <MetricCard
        label="Success rate"
        value={finished.length ? `${Math.round((passed / finished.length) * 100)}%` : '—'}
        hint={`${passed} of ${finished.length} finished builds`}
      />
      <MetricCard label="Branch" value={project.branch} valueFormat="code" hint={project.repo_full_name} />
    </div>
  );
}

function ProjectOverview({ project: initialProject }) {
  const location = useLocation();
  const [project, setProject] = useState(initialProject);
  // A build started by the New Project form arrives in the navigation state.
  const [queueId, setQueueId] = useState(location.state?.queueId ?? null);
  const [triggerError, setTriggerError] = useState(location.state?.buildError ?? null);
  const [triggering, setTriggering] = useState(false);

  const fetchBuilds = useCallback(() => api.listBuilds(project.id, { limit: BUILD_LIMIT }), [project.id]);
  const builds = usePolling(fetchBuilds, {
    intervalMs: 3000,
    shouldPoll: (data) => Boolean(queueId) || Boolean(data?.some(isBuildActive)),
  });
  // 409: the project has no Jenkins job yet.
  const notLinked = builds.error?.status === 409;

  const runBuild = async () => {
    setTriggering(true);
    setTriggerError(null);
    try {
      const { queue_id: id } = await api.triggerBuild(project.id);
      setQueueId(id);
    } catch (err) {
      setTriggerError(err.message);
    } finally {
      setTriggering(false);
    }
  };

  const { refresh } = builds;
  const onStarted = useCallback(() => refresh(), [refresh]);
  const onQueueDone = useCallback(() => setQueueId(null), []);

  const onLinked = (updated) => {
    setProject(updated);
    builds.reload();
  };

  return (
    <>
      <ProjectSideNav project={project} section="overview" />
      <main className="page-main">
        <div className="container container--6xl stack">
          <PageHeader
            title={project.name}
            description={
              <span className="project-header__meta">
                <a href={project.repo_url} target="_blank" rel="noreferrer" className="text-link">
                  {project.repo_full_name}
                </a>
                <span className="tag tag--strong">
                  <Icon name={project.is_private ? 'lock' : 'public'} size="xs" />{' '}
                  {project.is_private ? 'Private' : 'Public'}
                </span>
                <span className="tag">
                  <Icon name="call_split" size="xs" /> {project.branch}
                </span>
              </span>
            }
            actions={
              <Button icon="play_arrow" onClick={runBuild} disabled={triggering || Boolean(queueId) || notLinked}>
                {triggering ? 'Starting…' : 'Run build'}
              </Button>
            }
          />

          {triggerError && (
            <Alert
              tone="error"
              icon="error"
              title="Couldn't start a build"
              action={<Button variant="ghost" size="xs" icon="close" aria-label="Dismiss" onClick={() => setTriggerError(null)} />}
            >
              {triggerError}
            </Alert>
          )}
          {queueId && (
            <QueuedBuildBanner
              projectId={project.id}
              queueId={queueId}
              onStarted={onStarted}
              onDone={onQueueDone}
            />
          )}
          {notLinked && <LinkJenkinsJob project={project} onLinked={onLinked} />}

          {builds.data && <BuildMetrics project={project} builds={builds.data} />}

          <div className="card card--clip" id="builds">
            <div className="card__header">
              <h3 className="panel-title panel-title--flush">Build history</h3>
              {builds.data && project.jenkins_job && (
                <span className="text-muted project-header__job">
                  Jenkins: <code>{project.jenkins_job}</code>
                </span>
              )}
            </div>
            {notLinked ? (
              <div className="card__body text-muted">Link a Jenkins job above to see builds.</div>
            ) : (
              <AsyncContent state={builds} loadingLabel="Loading builds from Jenkins…">
                {(rows) => <BuildHistory projectId={project.id} builds={rows} />}
              </AsyncContent>
            )}
          </div>

          <Card padding="lg">
            <EmptyState
              icon="rocket_launch"
              title="Not deployed yet"
              description="Live URL, traffic, resources and replicas appear here once the pipeline's deploy stage is connected."
            />
          </Card>

          <ProjectSettings project={project} onSaved={onLinked} />
        </div>
      </main>
    </>
  );
}

export default function ProjectPage() {
  const { projectId } = useParams();
  const fetchProject = useCallback(() => api.getProject(projectId), [projectId]);
  const state = usePolling(fetchProject);

  return (
    <Page variant="sidebar">
      <AsyncContent state={state} loadingLabel="Loading project…">
        {(project) => <ProjectOverview key={project.id} project={project} />}
      </AsyncContent>
    </Page>
  );
}
