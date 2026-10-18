'use client';

import { ExternalLink } from 'lucide-react';
import { Spinner } from '@libs/ui-web';
import { api } from '@platform/convex-contracts';
import { Section } from '../../components/section';
import { useQuery } from '../convex/use-query';

function getHost(url: string) {
  try {
    return new URL(url).host.split('.')[0];
  } catch {
    return url;
  }
}

export function DashboardList() {
  const { data: items, isPending } = useQuery(api.sapphire.dashboard.list);

  if (isPending) {
    return (
      <Section className="flex items-center justify-center">
        <Spinner className="animate-spin duration-4s" color="#ffffff80" />
      </Section>
    );
  }

  if (!items?.length) {
    return (
      <Section>
        <p className="font-vga text-white/40 text-sm">nothing here yet...</p>
      </Section>
    );
  }

  return (
    <Section className="py-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
        {items.map((item) => (
          <a
            key={item._id}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-3 px-3 py-2 border border-gray-400/10 rounded-sm hover:border-highlight/40 hover:bg-white/5 transition-colors duration-150"
          >
            <img
              src={item.iconUrl}
              alt=""
              width={32}
              height={32}
              className="size-8 shrink-0 rounded-sm object-contain"
            />
            <div className="flex flex-col min-w-0 flex-1">
              <span className="font-jersey text-xl leading-snug truncate group-hover:text-highlight transition-colors duration-150">
                {item.name}
              </span>
              <span className="font-vga text-xs text-white/30 truncate">
                {getHost(item.url)}
              </span>
            </div>
            <ExternalLink
              size={12}
              className="shrink-0 text-white/30 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
            />
          </a>
        ))}
      </div>
    </Section>
  );
}
