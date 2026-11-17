import { useId } from 'react';
import FormField from '../ui/FormField';
import SegmentedControl from '../ui/SegmentedControl';
import Select from '../ui/Select';
import FormSection from './FormSection';

const SOURCE_OPTIONS = [
  { value: 'github', label: 'Link GitHub Repo' },
  { value: 'paste', label: 'Paste Code Directly' },
];

/**
 * repositories: [{ value, label }]; branches: string[].
 * `notice` (e.g. "connect GitHub first") replaces the pickers when set.
 * `repositoriesHint` / `branchesHint` explain loading or truncated lists.
 */
export default function SourceSection({
  source,
  onSourceChange,
  repositories,
  repository,
  onRepositoryChange,
  repositoriesDisabled = false,
  repositoriesHint,
  branches,
  branch,
  onBranchChange,
  branchesDisabled = false,
  branchesHint,
  notice,
  code,
  onCodeChange,
}) {
  const repoId = useId();
  const branchId = useId();
  const codeId = useId();

  return (
    <FormSection step={2} title="Code Source Ingestion">
      <div className="tab-bar">
        <SegmentedControl
          variant="pills"
          label="Code source"
          options={SOURCE_OPTIONS}
          value={source}
          onChange={onSourceChange}
        />
      </div>

      {notice}

      {source === 'github' && !notice && (
        <div className="form-grid form-grid--3">
          <FormField
            label="Select Git Repository"
            htmlFor={repoId}
            hint={repositoriesHint}
            className="form-grid__span-2"
          >
            <Select
              id={repoId}
              mono
              options={repositories}
              value={repository}
              disabled={repositoriesDisabled}
              onChange={(event) => onRepositoryChange(event.target.value)}
            />
          </FormField>
          <FormField label="Target Branch" htmlFor={branchId} hint={branchesHint}>
            <Select
              id={branchId}
              mono
              options={branches}
              value={branch}
              disabled={branchesDisabled}
              onChange={(event) => onBranchChange(event.target.value)}
            />
          </FormField>
        </div>
      )}

      {source === 'paste' && (
        <FormField label="Inline Application Entrypoint (e.g., main.go or server.js)" htmlFor={codeId} className="field--mono">
          <textarea
            id={codeId}
            className="code-editor dark-scroll"
            rows={6}
            spellCheck={false}
            value={code}
            onChange={(event) => onCodeChange(event.target.value)}
          />
        </FormField>
      )}
    </FormSection>
  );
}
