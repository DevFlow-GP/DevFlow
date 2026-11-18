import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Avatar from '../ui/Avatar';
import Icon from '../ui/Icon';
import { ROUTES } from '../../config/navigation';
import { useSession } from '../../context/SessionContext';

/** Avatar button (initials, or a person icon for guests): who is signed in, Settings and Sign out. */
export default function UserMenu() {
  const { user, signOut } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={containerRef}>
      <Avatar
        as="button"
        type="button"
        className="user-menu__trigger"
        title={user?.name ?? 'Guest'}
        aria-label="Account"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        {user ? user.initials : <Icon name="person" size="xl" />}
      </Avatar>
      {open && (
        <div id={panelId} className="user-menu__panel">
          <div className="user-menu__name">{user?.name ?? 'Guest'}</div>
          {user?.email && <div className="user-menu__email">{user.email}</div>}
          {user ? (
            <div className="user-menu__actions">
              <Link to={ROUTES.settings} className="user-menu__item" onClick={() => setOpen(false)}>
                <Icon name="settings" size="sm" /> Account settings
              </Link>
              <button
                type="button"
                className="user-menu__item"
                onClick={() => {
                  setOpen(false);
                  signOut();
                  navigate(ROUTES.landing);
                }}
              >
                <Icon name="logout" size="sm" /> Sign out
              </button>
            </div>
          ) : (
            <div className="user-menu__actions">
              <Link to={ROUTES.signIn} className="user-menu__item" onClick={() => setOpen(false)}>
                <Icon name="login" size="sm" /> Sign in
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
