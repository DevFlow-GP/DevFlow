import { useCallback, useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Card from '../ui/Card';
import FormField from '../ui/FormField';
import Modal from '../ui/Modal';
import Select from '../ui/Select';
import { ROUTES } from '../../config/navigation';
import { api } from '../../services/api';

/** Rename, change branch or Jenkins job, delete. Only the owner can save; others get the API's 403 message. */
export default function ProjectSettings({ project, onSaved }) {
  const navigate = useNavigate();
  const nameId = useId();
  const branchId = useId();
  const jobId = useId();
  const [name, setName] = useState(project.name);
  const [branch, setBranch] = useState(project.branch);
  const [job, setJob] = useState(project.jenkins_job ?? '');
  const [branches, setBranches] = useState([project.branch]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .listGitHubBranches(project.repo_full_name)
      .then((result) => {
        if (cancelled) return;
        const names = result.branches.map((item) => item.name);
        if (!names.includes(project.branch)) names.unshift(project.branch);
        setBranches(names);
      })
      .catch(() => {
        /* GitHub unavailable: keep the current branch as the only option */
      });
    return () => {
      cancelled = true;
    };
  }, [project.repo_full_name, project.branch]);

  const changed = {};
  if (name.trim() && name.trim() !== project.name) changed.name = name.trim();
  if (branch !== project.branch) changed.branch = branch;
  if (job.trim() !== (project.jenkins_job ?? '')) changed.jenkins_job = job.trim() || null;
  const dirty = Object.keys(changed).length > 0;

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      onSaved(await api.updateProject(project.id, changed));
      setMessage({ tone: 'success', icon: 'check_circle', title: 'Saved', text: 'Project settings updated.' });
    } catch (err) {
      setMessage({ tone: 'error', icon: 'error', title: "Couldn't save", text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const closeConfirm = useCallback(() => setConfirmOpen(false), []);

  const remove = async () => {
    setDeleting(true);
    try {
      await api.deleteProject(project.id);
      navigate(ROUTES.projects, { replace: true });
    } catch (err) {
      setConfirmOpen(false);
      setDeleting(false);
      setMessage({ tone: 'error', icon: 'error', title: "Couldn't delete the project", text: err.message });
    }
  };

  return (
    <Card padding="lg" className="stack stack--md" id="settings">
      <h3 className="panel-title panel-title--flush">Project settings</h3>
      {message && (
        <Alert tone={message.tone} icon={message.icon} title={message.title}>
          {message.text}
        </Alert>
      )}
      <form className="form" onSubmit={save}>
        <FormField label="Name" htmlFor={nameId}>
          <input id={nameId} className="input" value={name} maxLength={255} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label="Branch to build" htmlFor={branchId} hint="Checked on GitHub when you save.">
          <Select id={branchId} options={branches} value={branch} onChange={(e) => setBranch(e.target.value)} />
        </FormField>
        <FormField
          label="Jenkins job"
          htmlFor={jobId}
          hint="Temporary: DevFlow will create and manage a job per project. Leave empty to unlink."
        >
          <input id={jobId} className="input input--mono" value={job} onChange={(e) => setJob(e.target.value)} />
        </FormField>
        <div className="button-row">
          <Button type="submit" icon="save" disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>

      <div className="danger-zone">
        <div>
          <div className="danger-zone__title">Delete this project</div>
          <p className="text-muted danger-zone__text">
            Removes the project from DevFlow. The GitHub repository and past Jenkins builds aren't touched.
          </p>
        </div>
        <Button variant="danger" icon="delete" onClick={() => setConfirmOpen(true)}>
          Delete project
        </Button>
      </div>

      <Modal
        open={confirmOpen}
        onClose={closeConfirm}
        title={`Delete ${project.name}?`}
        actions={
          <>
            <Button variant="ghost" onClick={closeConfirm} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" icon="delete" onClick={remove} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete project'}
            </Button>
          </>
        }
      >
        This can't be undone.
      </Modal>
    </Card>
  );
}
