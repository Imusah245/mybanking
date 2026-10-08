/**
 * EmptyState — a centered placeholder for empty data views.
 *
 * props:
 *   title   — heading text
 *   message — supporting description
 *   icon    — optional node rendered above the title
 *   action  — optional node (e.g. a Button) rendered below the message
 */

export default function EmptyState({ title, message, icon, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      {icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          {icon}
        </div>
      )}
      {title && (
        <h3 className="text-base font-semibold text-slate-800">{title}</h3>
      )}
      {message && (
        <p className="mt-1 max-w-sm text-sm text-slate-500">{message}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
