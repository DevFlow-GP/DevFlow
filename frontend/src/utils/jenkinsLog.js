/**
 * Turns Jenkins console text into lines and stages for the build page.
 *
 * Jenkins' plain-text log has no timestamps or stage data, so stages are read from
 * the Pipeline markers it prints: "[Pipeline] { (Checkout)" opens a stage,
 * "[Pipeline] // stage" closes it. This is a stopgap until the backend exposes
 * stages properly (Jenkins' stage API).
 */

const STAGE_START = /^\[Pipeline\] \{ \((.+)\)$/;
const STAGE_END = /^\[Pipeline\] \/\/ stage$/;
const NO_STAGE = 'Setup';

function toneOf(text) {
  if (/^Finished: SUCCESS/.test(text)) return 'final';
  if (/^Finished: /.test(text) || /\b(ERROR|FATAL|Exception)\b|error:/i.test(text)) return 'error';
  if (/\bWARN(ING)?\b/.test(text)) return 'warning';
  if (text.startsWith('[Pipeline]') || text.startsWith('+ ')) return 'muted';
  return 'default';
}

/** { lines: [{ number, stage, tone, text }], stages: ['Checkout', 'Build', ...] } */
export function parseJenkinsLog(text) {
  const lines = [];
  const stages = [];
  let current = NO_STAGE;
  text.split(/\r?\n/).forEach((raw, index) => {
    const start = raw.match(STAGE_START);
    if (start) {
      current = start[1];
      if (!stages.includes(current)) stages.push(current);
    }
    if (raw === '' && index === text.split(/\r?\n/).length - 1) return; // trailing newline
    lines.push({ number: index + 1, stage: current, tone: toneOf(raw), text: raw });
    if (STAGE_END.test(raw)) current = NO_STAGE;
  });
  return { lines, stages };
}

/**
 * Stage cards for StageProgress: each stage is done, running, failed or pending,
 * judged from which stages the log reached and how the build ended.
 */
export function stageStates(stages, build) {
  return stages.map((name, index) => {
    const last = index === stages.length - 1;
    let state = 'done';
    if (last && build.status === 'running') state = 'running';
    else if (last && build.status !== 'success') state = build.status === 'aborted' ? 'aborted' : 'failed';
    return { name, state };
  });
}
