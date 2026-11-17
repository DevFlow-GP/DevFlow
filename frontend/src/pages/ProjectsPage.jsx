import { useState } from 'react';
import Page from '../components/layout/Page';
import PageHeader from '../components/layout/PageHeader';
import ProjectFilters, { filterProjects } from '../components/projects/ProjectFilters';
import ProjectsTable from '../components/projects/ProjectsTable';
import WorkspaceSideNav from '../components/projects/WorkspaceSideNav';
import AsyncContent from '../components/ui/AsyncContent';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import { ROUTES } from '../config/navigation';
import { useSession } from '../context/SessionContext';
import useApi from '../hooks/useApi';
import { api } from '../services/api';

const INITIAL_FILTERS = { query: '' };

export default function ProjectsPage() {
  const { workspace } = useSession();
  const state = useApi(api.getProjects);
  const [filters, setFilters] = useState(INITIAL_FILTERS);

  return (
    <Page variant="sidebar">
      <WorkspaceSideNav workspace={workspace} />

      <main className="page-main">
        <div className="container container--6xl stack">
          <PageHeader
            title="Projects"
            description="Your projects and your team's, each linked to a GitHub repository and branch."
            actions={
              <Button icon="add" iconSize="base" to={ROUTES.newProject}>
                New project
              </Button>
            }
          />

          <AsyncContent state={state} loadingLabel="Loading projects…">
            {(projects) =>
              projects.length === 0 ? (
                <EmptyState
                  icon="rocket"
                  title="No projects yet"
                  description={`Create a project from one of your GitHub repositories to start using the ${workspace?.name ?? ''} workspace.`}
                  action={
                    <Button icon="add" to={ROUTES.newProject}>
                      Create your first project
                    </Button>
                  }
                />
              ) : (
                <>
                  <ProjectFilters filters={filters} onChange={setFilters} />
                  <ProjectsTable projects={filterProjects(projects, filters)} />
                </>
              )
            }
          </AsyncContent>
        </div>
      </main>
    </Page>
  );
}
