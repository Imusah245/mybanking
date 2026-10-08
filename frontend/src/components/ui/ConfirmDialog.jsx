/**
 * ConfirmDialog — a modal confirmation overlay.
 *
 * props:
 *   open         — when false, renders null
 *   title        — heading text
 *   message      — body text / node
 *   confirmLabel — confirm button label (default 'Confirm')
 *   cancelLabel  — cancel button label (default 'Cancel')
 *   onConfirm    — called when the confirm button is clicked
 *   onCancel     — called on cancel button or backdrop click
 *   loading      — when true, disables the confirm button and shows a spinner
 *   danger       — when true, the confirm button uses the danger variant
 */

import Button from './Button';

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  loading = false,
  danger = false,
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/50"
        onClick={loading ? undefined : onCancel}
        aria-hidden="true"
      />

      {/* Dialog card */}
      <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        {title && (
          <h2
            id="confirm-dialog-title"
            className="text-lg font-semibold text-slate-900"
          >
            {title}
          </h2>
        )}

        {message && (
          <div className="mt-2 text-sm text-slate-600">{message}</div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="secondary"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
