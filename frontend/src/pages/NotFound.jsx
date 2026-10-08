import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8">
      <h1 className="text-4xl font-bold text-slate-800 mb-4">404</h1>
      <p className="text-lg text-slate-600 mb-6">Page not found</p>
      <Link to="/" className="text-indigo-600 hover:text-indigo-800 font-medium">
        Go home
      </Link>
    </div>
  );
}
