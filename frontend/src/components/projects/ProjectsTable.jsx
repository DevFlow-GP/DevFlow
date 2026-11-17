import DataTable from '../ui/DataTable';
import Icon from '../ui/Icon';
import StatusBadge from '../ui/StatusBadge';
import { formatRelative } from '../../utils/formatDate';

/**
 * Projects from GET /projects. Status, live URL and deploy times arrive with
 * pipelines and deployments; until then every project is "not deployed".
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
    header: 'Status',
    render: () => <StatusBadge status="not_deployed" />,
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
  return (
    <div className="table-card">
      <div className="table-scroll">
        <DataTable
          columns={COLUMNS}
          rows={projects}
          getRowKey={(project) => project.id}
          emptyMessage="No projects match your search."
        />
      </div>
    </div>
  );
}
