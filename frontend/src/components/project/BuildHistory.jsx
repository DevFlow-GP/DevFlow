import { useNavigate } from 'react-router-dom';
import DataTable from '../ui/DataTable';
import StatusBadge from '../ui/StatusBadge';
import cx from '../../utils/classNames';
import { buildRoute } from '../../config/navigation';
import { formatRelative } from '../../utils/formatDate';
import { buildDuration } from '../../utils/formatDuration';
import { buildStatusKey } from '../../utils/status';

/**
 * Builds from GET /projects/{id}/builds, newest first. Commit and message columns
 * wait for the backend to return them (flagged: commit SHA/message per build).
 */
export default function BuildHistory({ projectId, builds }) {
  const navigate = useNavigate();
  const columns = [
    {
      key: 'number',
      header: 'Build #',
      className: 'cell-strong',
      render: (build) => (
        <span className={cx(build === builds[0] ? 'text-primary' : 'text-on-surface')}>
          #{build.number}
          {build === builds[0] && ' (Latest)'}
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: (build) => <StatusBadge status={buildStatusKey(build)} /> },
    { key: 'duration', header: 'Duration', render: (build) => buildDuration(build) },
    {
      key: 'started',
      header: 'Started',
      className: 'cell-body cell-muted',
      render: (build) => formatRelative(build.started_at),
    },
    {
      key: 'details',
      header: 'Details',
      align: 'right',
      className: 'cell-body cell-medium',
      render: (build) =>
        build.status === 'failure' ? (
          <span className="text-error">Logs →</span>
        ) : (
          <span className="text-primary">Inspect →</span>
        ),
    },
  ];

  return (
    <div className="table-scroll">
      <DataTable
        variant="compact"
        columns={columns}
        rows={builds}
        getRowKey={(build) => build.number}
        onRowClick={(build) => navigate(buildRoute(projectId, build.number))}
        emptyMessage="No builds yet. Run the first one."
      />
    </div>
  );
}
