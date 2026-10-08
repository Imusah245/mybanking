/**
 * Card — a white surface for grouping content.
 *
 * props:
 *   children  — card body
 *   className — extra classes merged onto the outer surface
 *   title     — optional header title; renders a bordered header row
 */

export default function Card({ children, className = '', title }) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}
    >
      {title && (
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-800">{title}</h2>
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}
