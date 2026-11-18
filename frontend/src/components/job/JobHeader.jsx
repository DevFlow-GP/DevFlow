import SubHeader from '../layout/SubHeader';
import BackLink from '../ui/BackLink';
import Button from '../ui/Button';
import StatusBadge from '../ui/StatusBadge';
import { projectRoute } from '../../config/navigation';
import { formatRelative } from '../../utils/formatDate';
import { buildDuration } from '../../utils/formatDuration';
import { buildStatusKey } from '../../utils/status';

/** Breadcrumb, status and facts of one build, with Re-run and Open in Jenkins. */
export default function JobHeader({ project, build, onRerun, rerunning }) {
  const meta = [
    { label: 'Branch', value: project.branch },
    { label: 'Started', value: formatRelative(build.started_at) },
    { label: 'Duration', value: buildDuration(build) },
    { label: 'Jenkins job', value: project.jenkins_job },
  ];

  return (
    <SubHeader width="wide">
      <div>
        <div className="breadcrumbs">
          <BackLink to={projectRoute(project.id)} className="back-link--inline">
            {project.name}
          </BackLink>
          <span className="breadcrumbs__separator">/</span>
          <span className="breadcrumbs__current">Build #{build.number}</span>
          <StatusBadge status={buildStatusKey(build)} />
        </div>
        <h1 className="job-title">
          Build #{build.number} — <span className="job-title__sub">{project.repo_full_name}</span>
        </h1>
        <div className="meta-list">
          {meta.map((item) => (
            <span key={item.label}>
              {item.label}: <strong>{item.value}</strong>
            </span>
          ))}
        </div>
      </div>

      <div className="button-row">
        <Button size="xs" variant="outline" icon="replay" onClick={onRerun} disabled={rerunning}>
          {rerunning ? 'Starting…' : 'Re-run build'}
        </Button>
        <Button size="xs" variant="ghost" icon="open_in_new" href={build.url} target="_blank" rel="noreferrer">
          Open in Jenkins
        </Button>
      </div>
    </SubHeader>
  );
}
