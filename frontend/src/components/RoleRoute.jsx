import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * RoleRoute — guards routes that require a specific user role (e.g. ADMIN).
 *
 * - While auth state is hydrating, render a loading indicator.
 * - If there is no authenticated user, redirect to /admin/login, preserving
 *   the intended destination so the admin login flow can return the user.
 * - If the user is authenticated but lacks the required role, bounce them to
 *   the customer dashboard (/dashboard).
 * - Otherwise render the matched child routes via <Outlet />.
 *
 * @param {{ role: string }} props - required role, e.g. 'ADMIN'.
 */
export default function RoleRoute({ role }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-slate-500">
        Loading…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }

  if (user.role !== role) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
