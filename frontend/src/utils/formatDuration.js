/** 134000 → "2m 14s", 4200 → "4s", 0 → "0s". */
export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** How long a build has taken: its final duration, or the time since it started while running. */
export function buildDuration(build, now = Date.now()) {
  if (build.status !== 'running') return formatDuration(build.duration_ms);
  return formatDuration(now - new Date(build.started_at).getTime());
}
