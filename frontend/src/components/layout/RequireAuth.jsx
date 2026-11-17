import { Navigate, Outlet, useLocation } from 'react-router-dom';
import AsyncContent from '../ui/AsyncContent';
import { signInRedirect } from '../../config/navigation';
import { useSession } from '../../context/SessionContext';

/**
 * Route guard: guests are sent to sign in, then returned to the page they asked for.
 * While a stored session is being restored it waits, so a refresh doesn't bounce
 * signed-in users to the sign-in page.
 */
export default function RequireAuth() {
  const { isAuthenticated, loading, error, reload } = useSession();
  const location = useLocation();

  if (loading || error) {
    return (
      <AsyncContent state={{ loading, error, reload }} loadingLabel="Restoring your session…">
        {() => null}
      </AsyncContent>
    );
  }
  if (!isAuthenticated) {
    return <Navigate to={signInRedirect(location.pathname + location.search)} replace />;
  }
  return <Outlet />;
}
