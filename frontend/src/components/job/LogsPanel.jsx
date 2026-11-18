import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../ui/Icon';
import cx from '../../utils/classNames';
import { copyToClipboard, notify } from '../../utils/notify';

const ALL_STAGES = 'All';

function LogLine({ line }) {
  return (
    <div className={cx('log-line', `log-line--${line.tone}`)}>
      <span className="log-line__number">{line.number}</span>
      {line.text || ' '}
    </div>
  );
}

/**
 * Jenkins console output with a stage filter, search, follow, copy and download.
 * lines: [{ number, stage, tone, text }] from parseJenkinsLog; `live` while the build runs.
 */
export default function LogsPanel({ lines, stages, fileName, rawText, live }) {
  const [activeStage, setActiveStage] = useState(ALL_STAGES);
  const [query, setQuery] = useState('');
  const [follow, setFollow] = useState(true);
  const viewerRef = useRef(null);

  const visibleLines = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return lines.filter(
      (line) =>
        (activeStage === ALL_STAGES || line.stage === activeStage) &&
        (!needle || line.text.toLowerCase().includes(needle)),
    );
  }, [lines, activeStage, query]);

  useEffect(() => {
    if (follow && viewerRef.current) {
      viewerRef.current.scrollTop = viewerRef.current.scrollHeight;
    }
  }, [follow, visibleLines]);

  const copyLogs = async () => {
    const copied = await copyToClipboard(visibleLines.map((line) => line.text).join('\n'));
    notify(copied ? 'Log copied to clipboard.' : "Couldn't copy the log.");
  };

  const downloadLog = () => {
    const url = URL.createObjectURL(new Blob([rawText], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="logs-panel">
      <div className="logs-panel__tabs">
        <div className="logs-tabs" role="tablist">
          <button type="button" role="tab" aria-selected="true" className="logs-tab is-active">
            Console Output{live && ' · live'}
          </button>
        </div>
        <div className="logs-tools">
          <label className="checkbox-label">
            <input
              type="checkbox"
              className="checkbox checkbox--inline"
              checked={follow}
              onChange={(event) => setFollow(event.target.checked)}
            />
            Follow output
          </label>
          <button type="button" className="logs-tool" onClick={copyLogs}>
            <Icon name="content_copy" size="xs" /> Copy
          </button>
          <button type="button" className="logs-tool" onClick={downloadLog}>
            <Icon name="download" size="xs" /> Download
          </button>
        </div>
      </div>

      <div className="log-filter-bar">
        <div className="log-filter-bar__group">
          <span className="log-filter-bar__label">FILTER STAGE:</span>
          {[ALL_STAGES, ...stages].map((stage) => (
            <button
              key={stage}
              type="button"
              className={cx('log-filter', activeStage === stage && 'is-active')}
              onClick={() => setActiveStage(stage)}
            >
              {stage}
            </button>
          ))}
        </div>
        <input
          type="text"
          className="log-search"
          placeholder="Search logs (grep)..."
          aria-label="Search logs"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="terminal log-viewer dark-scroll" ref={viewerRef}>
        {visibleLines.length > 0 ? (
          visibleLines.map((line) => <LogLine key={line.number} line={line} />)
        ) : (
          <div className="log-line log-line--muted">
            {lines.length ? 'No log lines match the current filter.' : 'Waiting for output…'}
          </div>
        )}
      </div>
    </div>
  );
}
