'use client';

import { Check, Copy, ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@libs/ui-web';

export type AppItemProps = {
  title: string;
} & (
  | {
      type: 'download';
      link: string;
      homepage: string;
    }
  | {
      type: 'command';
      command: string;
      homepage: string;
    }
);

export function AppItem(props: AppItemProps) {
  return (
    <div>
      <p className="font-jersey text-xl leading-snug">{props.title}</p>
      <a
        className="font-jersey text-lg leading-snug text-white/30 flex items-center gap-2"
        href={props.homepage}
        target="_blank"
        rel="noopener noreferrer"
      >
        <span>{props.homepage}</span>
        <ExternalLink size={12} />
      </a>
      {props.type === 'command' && (
        <AppItemCommand command={props.command} className="mt-2" />
      )}
    </div>
  );
}

function AppItemCommand({
  command,
  className,
}: {
  command: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    copiedTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div
      className={cn(
        'px-4 py-2 border border-gray-400/10 rounded-sm flex flex-row items-center justify-between',
        className,
      )}
    >
      <p className="font-scp">{command}</p>
      <button
        className="size-8 items-center justify-center flex hover:bg-gray-400/10 transition-all duration-150 rounded-md"
        onClick={handleCopy}
      >
        {copied ? (
          <Check size={16} className="status-ok" />
        ) : (
          <Copy size={16} />
        )}
      </button>
    </div>
  );
}
