import Toast from './Toast';

/**
 * ToastContainer — fixed overlay (top-right, z-50) that renders active toasts.
 * Receives the toast array and a removeToast callback from ToastProvider.
 */
export default function ToastContainer({ toasts, removeToast }) {
  if (!toasts.length) return null;

  return (
    <div
      aria-label="Notifications"
      className="fixed top-4 right-4 z-50 flex flex-col gap-2"
    >
      {toasts.map((t) => (
        <Toast
          key={t.id}
          type={t.type}
          message={t.message}
          onClose={() => removeToast(t.id)}
        />
      ))}
    </div>
  );
}
