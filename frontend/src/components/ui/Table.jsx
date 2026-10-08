/**
 * Table — a responsive, styled data table.
 *
 * props:
 *   columns — array of { key, header, render? }
 *             render(row, index) overrides the default row[key] cell content.
 *   rows    — array of row objects
 *   rowKey  — fn(row, index) => key, or a string naming the key field
 *             (defaults to the row index)
 *   empty   — node rendered in place of the table body when rows is empty
 */

function resolveRowKey(rowKey, row, index) {
  if (typeof rowKey === 'function') return rowKey(row, index);
  if (typeof rowKey === 'string' && row != null) return row[rowKey];
  return index;
}

export default function Table({ columns = [], rows = [], rowKey, empty = null }) {
  if (!rows || rows.length === 0) {
    return empty;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, index) => (
            <tr
              key={resolveRowKey(rowKey, row, index)}
              className="transition-colors hover:bg-slate-50"
            >
              {columns.map((col) => (
                <td key={col.key} className="px-4 py-3 text-slate-700">
                  {col.render ? col.render(row, index) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
