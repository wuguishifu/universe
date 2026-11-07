import { ReactNode } from 'react';

export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="code rounded bg-muted px-1.5 py-0.5 text-[0.85em]">
      {children}
    </code>
  );
}

export function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="code my-4 overflow-x-auto rounded-lg border bg-muted p-4 text-sm leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}
