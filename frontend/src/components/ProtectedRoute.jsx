import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * ProtectedRoute — guards customer routes that require authentication.
 *
 * - While auth state is hydrating, render a loading indicator.
 * - If there is no authenticated user, redirect to /login, preserving the
 *   intended destination in location state so the login flow can send the
 *   user back after a successful sign-in.
 * - Otherwise render the matched child routes via <Outlet />.
 */
export default function ProtectedRoute() {
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
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
