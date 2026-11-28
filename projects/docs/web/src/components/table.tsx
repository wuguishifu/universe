import { ReactNode } from 'react';

import { cn } from '@libs/web-ui';

export function Table({
  head,
  rows,
  nowrapColumns = [0],
}: {
  head: string[];
  rows: ReactNode[][];
  /** indexes of columns that shouldn't wrap (defaults to the first column) */
  nowrapColumns?: number[];
}) {
  return (
    <div className="my-4 overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted">
          <tr>
            {head.map((label) => (
              <th key={label} className="px-4 py-2 font-semibold">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={cn(
                    'px-4 py-2 align-top',
                    nowrapColumns.includes(j) && 'whitespace-nowrap',
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
