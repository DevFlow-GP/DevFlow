import { useLocation } from 'react-router-dom';
import Button from '../ui/Button';
import SideNav, { SideNavHeader } from '../layout/SideNav';
import { ROUTES, WORKSPACE_NAV } from '../../config/navigation';

export default function WorkspaceSideNav({ workspace }) {
  const { pathname } = useLocation();
  const items = WORKSPACE_NAV.main.map((item) => ({ ...item, active: item.to === pathname }));

  return (
    <SideNav
      label="DevFlow main side navigation"
      header={
        <SideNavHeader
          initials={workspace?.initials ?? ''}
          title={workspace?.name ?? '…'}
          titleTone="primary"
          subtitle={workspace?.cluster ?? ''}
        />
      }
      cta={
        <Button icon="add" block to={ROUTES.newProject}>
          New Pipeline
        </Button>
      }
      items={items}
      footerItems={WORKSPACE_NAV.footer}
    />
  );
}
