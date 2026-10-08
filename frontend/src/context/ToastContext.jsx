import { createContext, useContext, useState, useCallback } from 'react';
import ToastContainer from '../components/Toast/ToastContainer';

const ToastContext = createContext(null);

const TOAST_TTL_MS = 4000;

/**
 * ToastProvider — holds the active toast list and renders the overlay.
 *
 * State: toasts — array of { id, type, message }.
 * Each toast auto-dismisses after TOAST_TTL_MS or when closed manually.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (type, message) => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev, { id, type, message }]);
      setTimeout(() => removeToast(id), TOAST_TTL_MS);
    },
    [removeToast]
  );

  const value = {
    success: (message) => addToast('success', message),
    error: (message) => addToast('error', message),
    info: (message) => addToast('info', message),
  };

  return (
    <ToastContext.Provider value={value}>
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      {children}
    </ToastContext.Provider>
  );
}

/**
 * useToast — convenience hook to consume ToastContext.
 * Returns { success, error, info }. Throws if used outside ToastProvider.
 */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (ctx === null) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}

export default ToastContext;
