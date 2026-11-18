import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DataTable from '../ui/DataTable';
import Icon from '../ui/Icon';
import StatusBadge from '../ui/StatusBadge';
import { projectRoute } from '../../config/navigation';
import { api } from '../../services/api';
import { formatRelative } from '../../utils/formatDate';
import { buildStatusKey } from '../../utils/status';

/**
 * The latest build's status. Fetched per row for now: one request per project.
 * Flagged for the backend: return `last_build` with GET /projects instead.
 */
function LastBuildStatus({ project }) {
  const [status, setStatus] = useState(project.jenkins_job ? 'loading' : 'never_built');

  useEffect(() => {
    if (!project.jenkins_job) return undefined;
    let cancelled = false;
    api
      .listBuilds(project.id, { limit: 1 })
      .then(([latest]) => {
        if (!cancelled) setStatus(latest ? buildStatusKey(latest) : 'never_built');
      })
      .catch(() => {
        if (!cancelled) setStatus('unknown');
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, project.jenkins_job]);

  if (status === 'loading') return <span className="text-placeholder">…</span>;
  if (status === 'unknown') return <span className="text-placeholder">Jenkins unavailable</span>;
  return <StatusBadge status={status} />;
}

/**
 * Projects from GET /projects. Live URLs arrive with deployments; until then
 * every project shows "Not deployed yet".
 */
const COLUMNS = [
  {
    key: 'project',
    header: 'Project',
    render: (project) => (
      <>
        <div className="project-name">
          <Icon name="view_in_ar" size="base" className="text-outline" />
          {project.name}
        </div>
        <div className="project-meta">
          {project.repo_full_name} · {project.branch}
        </div>
      </>
    ),
  },
  {
    key: 'visibility',
    header: 'Repository',
    render: (project) => (
      <span className="tag tag--strong">
        <Icon name={project.is_private ? 'lock' : 'public'} size="xs" /> {project.is_private ? 'Private' : 'Public'}
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Last build',
    render: (project) => <LastBuildStatus project={project} />,
  },
  {
    key: 'url',
    header: 'Live URL',
    render: () => <span className="text-placeholder">Not deployed yet</span>,
  },
  {
    key: 'created',
    header: 'Created',
    className: 'cell-muted',
    render: (project) => formatRelative(project.created_at),
  },
  {
    key: 'actions',
    header: 'Actions',
    align: 'right',
    stopPropagation: true,
    render: (project) =>
      project.repo_url && (
        <a href={project.repo_url} target="_blank" rel="noreferrer" className="link-btn link-btn--primary">
          View on GitHub
        </a>
      ),
  },
];

export default function ProjectsTable({ projects }) {
  const navigate = useNavigate();
  return (
    <div className="table-card">
      <div className="table-scroll">
        <DataTable
          columns={COLUMNS}
          rows={projects}
          getRowKey={(project) => project.id}
          onRowClick={(project) => navigate(projectRoute(project.id))}
          emptyMessage="No projects match your search."
        />
      </div>
    </div>
  );
}
