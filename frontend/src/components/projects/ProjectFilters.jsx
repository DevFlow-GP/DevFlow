import Icon from '../ui/Icon';

/**
 * Search box above the projects table. Status and framework filters return
 * once projects have deployments and templates to filter by.
 */
export default function ProjectFilters({ filters, onChange }) {
  return (
    <div className="toolbar">
      <div className="search-field">
        <Icon name="search" size="base" className="search-field__icon" />
        <input
          id="project-filter"
          type="text"
          className="input input--search"
          placeholder="Filter projects by name, repository or branch…"
          aria-label="Filter projects"
          value={filters.query}
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
        />
      </div>
    </div>
  );
}

export function filterProjects(projects, { query }) {
  const needle = query.trim().toLowerCase();
  if (!needle) return projects;
  return projects.filter((project) =>
    [project.name, project.repo_full_name, project.branch].some((value) => value.toLowerCase().includes(needle)),
  );
}
