import Card from '../ui/Card';
import Icon from '../ui/Icon';
import StageFlow from '../ui/StageFlow';
import cx from '../../utils/classNames';

const STATE_DISPLAY = {
  done: { icon: 'check_circle', label: 'Done' },
  running: { icon: 'progress_activity', label: 'Running' },
  failed: { icon: 'cancel', label: 'Failed here' },
  aborted: { icon: 'block', label: 'Aborted here' },
};

function StageCard({ name, state }) {
  const display = STATE_DISPLAY[state];
  return (
    <div className={cx('stage-card', `stage-card--${state}`)}>
      <div>
        <div className="stage-card__name">{name}</div>
        <div className="stage-card__meta">{display.label}</div>
      </div>
      <Icon name={display.icon} size="sm" />
    </div>
  );
}

/** stages: [{ name, state: done | running | failed | aborted }] */
export default function StageProgress({ stages }) {
  const done = stages.filter((stage) => stage.state === 'done').length;
  return (
    <Card shadow>
      <div className="stage-progress__head">
        <span className="eyebrow text-muted">Pipeline Stage Progression</span>
        <span className="stage-progress__summary">
          {stages.length ? `${done} / ${stages.length} stages completed` : 'No stages reported yet'}
        </span>
      </div>
      {stages.length > 0 && (
        <div className="stage-cards">
          <StageFlow items={stages} getKey={(stage) => stage.name} renderItem={(stage) => <StageCard {...stage} />} />
        </div>
      )}
    </Card>
  );
}
