import { useId, useState } from 'react';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import FormField from '../ui/FormField';
import { api } from '../../services/api';

/**
 * Shown while the project has no Jenkins job. Temporary: once the backend creates a
 * job per project on the first build (flagged, per-project jobs), this goes away.
 */
export default function LinkJenkinsJob({ project, onLinked }) {
  const inputId = useId();
  const [job, setJob] = useState('user-apps/python/py-test');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onLinked(await api.updateProject(project.id, { jenkins_job: job.trim() }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Alert icon="link_off" title="Link a Jenkins job to run builds">
      <form className="inline-form" onSubmit={save}>
        <FormField
          label="Jenkins job"
          htmlFor={inputId}
          hint="Full job name, folders separated by '/'. DevFlow will create this automatically later."
        >
          <input
            id={inputId}
            className="input input--mono input--sm"
            value={job}
            onChange={(event) => setJob(event.target.value)}
            required
          />
        </FormField>
        <Button type="submit" size="sm" icon="link" disabled={saving || !job.trim()}>
          {saving ? 'Linking…' : 'Link job'}
        </Button>
      </form>
      {error && <div className="text-error inline-form__error">{error}</div>}
    </Alert>
  );
}
