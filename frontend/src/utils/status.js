/**
 * Maps a workload/job status to its display label and color tone.
 * `tone` drives badges, `iconTone` colors the project icon in tables.
 */
export const STATUS_CONFIG = {
  // Deployed workloads ("running" is a live service, not a build).
  running: { label: 'Running', tone: 'success', iconTone: 'primary' },
  deploying: { label: 'Deploying', tone: 'info', iconTone: 'secondary', pulse: true },
  failed: { label: 'Failed', tone: 'danger', iconTone: 'error' },
  stopped: { label: 'Stopped', tone: 'neutral', iconTone: 'outline' },
  // Real projects before pipelines and deployments exist.
  not_deployed: { label: 'Not deployed', tone: 'neutral', iconTone: 'outline' },
  passing: { label: 'Passing', tone: 'success' },

  // Builds. The backend's build "running" becomes "building" (see buildStatusKey).
  queued: { label: 'Queued', tone: 'neutral', pulse: true },
  building: { label: 'Building', tone: 'info', pulse: true },
  success: { label: 'Success', tone: 'success' },
  failure: { label: 'Failed', tone: 'danger' },
  unstable: { label: 'Unstable', tone: 'warning' },
  aborted: { label: 'Aborted', tone: 'neutral' },
  not_built: { label: 'Not built', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  never_built: { label: 'Never built', tone: 'neutral' },
};

export function getStatus(status) {
  return STATUS_CONFIG[status] ?? { label: status, tone: 'neutral', iconTone: 'outline' };
}

/** A build from the API → its STATUS_CONFIG key. */
export function buildStatusKey(build) {
  return build.status === 'running' ? 'building' : build.status;
}

export const isBuildActive = (build) => build?.status === 'running';
