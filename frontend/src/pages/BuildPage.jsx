import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import JobHeader from '../components/job/JobHeader';
import LogsPanel from '../components/job/LogsPanel';
import StageProgress from '../components/job/StageProgress';
import Page from '../components/layout/Page';
import Alert from '../components/ui/Alert';
import AsyncContent from '../components/ui/AsyncContent';
import useApi from '../hooks/useApi';
import usePolling from '../hooks/usePolling';
import { projectRoute } from '../config/navigation';
import { api } from '../services/api';
import { parseJenkinsLog, stageStates } from '../utils/jenkinsLog';
import { isBuildActive } from '../utils/status';

const POLL_MS = 2500;

function BuildView({ project, number }) {
  const navigate = useNavigate();
  const [rerunning, setRerunning] = useState(false);
  const [rerunError, setRerunError] = useState(null);

  // Build and log are fetched together so the status and the log stay in step.
  const fetchBuild = useCallback(async () => {
    const [build, log] = await Promise.all([api.getBuild(project.id, number), api.getBuildLog(project.id, number)]);
    return { build, log };
  }, [project.id, number]);
  const state = usePolling(fetchBuild, { intervalMs: POLL_MS, shouldPoll: (data) => isBuildActive(data?.build) });

  const parsed = useMemo(() => parseJenkinsLog(state.data?.log ?? ''), [state.data?.log]);

  const rerun = async () => {
    setRerunning(true);
    setRerunError(null);
    try {
      const { queue_id: queueId } = await api.triggerBuild(project.id);
      // The project page follows the queued build until it gets a number.
      navigate(projectRoute(project.id), { state: { queueId } });
    } catch (err) {
      setRerunError(err.message);
      setRerunning(false);
    }
  };

  return (
    <AsyncContent state={state} loadingLabel={`Loading build #${number}…`}>
      {({ build, log }) => (
        <>
          <JobHeader project={project} build={build} onRerun={rerun} rerunning={rerunning} />
          <div className="job-body">
            {rerunError && (
              <Alert tone="error" icon="error" title="Couldn't start a build">
                {rerunError}
              </Alert>
            )}
            <StageProgress stages={stageStates(parsed.stages, build)} />
            <LogsPanel
              lines={parsed.lines}
              stages={parsed.stages}
              rawText={log}
              fileName={`${project.name}-build-${build.number}.log`}
              live={isBuildActive(build)}
            />
          </div>
        </>
      )}
    </AsyncContent>
  );
}

export default function BuildPage() {
  const { projectId, number } = useParams();
  const fetchProject = useCallback(() => api.getProject(projectId), [projectId]);
  const project = useApi(fetchProject);

  return (
    <Page variant="plain">
      <AsyncContent state={project} loadingLabel="Loading project…">
        {(data) => <BuildView project={data} number={Number(number)} />}
      </AsyncContent>
    </Page>
  );
}
