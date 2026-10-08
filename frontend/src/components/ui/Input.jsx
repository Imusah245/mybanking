/**
 * Input — a labelled text input with hint and error states.
 *
 * props:
 *   label    — visible label text
 *   id       — input id (also links the label); falls back to `name`
 *   type     — native input type (default 'text')
 *   value    — controlled value
 *   onChange — change handler
 *   error    — error message string; when set the field turns red and
 *              sets aria-invalid
 *   hint     — helper text shown below when there is no error
 *   required — marks the field required (shows an asterisk)
 *   ...rest  — forwarded to the underlying <input>
 */

export default function Input({
  label,
  id,
  type = 'text',
  value,
  onChange,
  error,
  hint,
  required = false,
  className = '',
  ...rest
}) {
  const inputId = id || rest.name;
  const describedBy = error
    ? `${inputId}-error`
    : hint
      ? `${inputId}-hint`
      : undefined;

  const borderClasses = error
    ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
    : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-500';

  return (
    <div className={className}>
      {label && (
        <label
          htmlFor={inputId}
          className="mb-1 block text-sm font-medium text-slate-700"
        >
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </label>
      )}

      <input
        id={inputId}
        type={type}
        value={value}
        onChange={onChange}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 shadow-sm transition-colors focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 ${borderClasses}`}
        {...rest}
      />

      {error ? (
        <p id={`${inputId}-error`} className="mt-1 text-sm text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1 text-sm text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
