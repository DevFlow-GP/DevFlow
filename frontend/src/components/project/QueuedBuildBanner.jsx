import { useEffect, useState } from 'react';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import { buildRoute } from '../../config/navigation';
import { api } from '../../services/api';

const POLL_MS = 2000;

/**
 * Follows a triggered build from the Jenkins queue until it gets a build number.
 * Calls `onStarted(number)` once, then `onDone()` when the banner is dismissed.
 */
export default function QueuedBuildBanner({ projectId, queueId, onStarted, onDone }) {
  const [item, setItem] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer;
    const poll = async () => {
      try {
        const next = await api.getQueuedBuild(projectId, queueId);
        if (cancelled) return;
        setItem(next);
        if (next.state === 'started') onStarted(next.build_number);
        else if (next.state === 'queued') timer = setTimeout(poll, POLL_MS);
      } catch (err) {
        if (cancelled) return;
        // 404: Jenkins already forgot the item, so the build started a while ago
        // and is in the history already. Nothing left to follow.
        if (err.status === 404) {
          onStarted(null);
          onDone();
        } else setError(err.message);
      }
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [projectId, queueId, onStarted, onDone]);

  const dismiss = <Button variant="ghost" size="xs" icon="close" aria-label="Dismiss" onClick={onDone} />;

  if (error) {
    return (
      <Alert tone="error" icon="error" title="Couldn't follow the queued build" action={dismiss}>
        {error}
      </Alert>
    );
  }
  if (item?.state === 'cancelled') {
    return (
      <Alert icon="block" title="Build cancelled" action={dismiss}>
        The queued build was cancelled on Jenkins before it started.
      </Alert>
    );
  }
  if (item?.state === 'started') {
    return (
      <Alert
        tone="success"
        icon="play_circle"
        title={`Build #${item.build_number} started`}
        action={
          <div className="button-row">
            <Button size="xs" icon="terminal" to={buildRoute(projectId, item.build_number)}>
              Watch logs
            </Button>
            {dismiss}
          </div>
        }
      >
        It's running on Jenkins now.
      </Alert>
    );
  }
  return (
    <Alert tone="info" icon="hourglass_top" title="Build queued">
      {item?.reason ?? 'Waiting for Jenkins to pick it up…'}
    </Alert>
  );
}
