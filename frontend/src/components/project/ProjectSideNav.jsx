import SideNav, { SideNavHeader } from '../layout/SideNav';
import StatusDot from '../ui/StatusDot';
import { projectNav } from '../../config/navigation';

const initialsOf = (name) =>
  name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');

/** Left sidebar on a project's pages: the project, its sections, and where it builds from. */
export default function ProjectSideNav({ project, section }) {
  return (
    <SideNav
      label="Project navigation"
      header={
        <SideNavHeader
          initials={initialsOf(project.name)}
          avatarTone="secondary"
          title={project.name}
          subtitle={
            <>
              <StatusDot /> {project.branch}
            </>
          }
        />
      }
      items={projectNav(project.id, section)}
      footer={
        <div className="sidenav__meta">
          Jenkins job: <strong>{project.jenkins_job ?? 'not linked'}</strong>
        </div>
      }
    />
  );
}
