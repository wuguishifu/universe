'use client';

import { api } from '@universe/platform/convex/contracts';
import { Spinner } from '@universe/ui-web';
import { useQuery } from '../../../modules/convex/use-query';
import { Section } from '../../../modules/layout/section';

export function ReadingList() {
  const { data: items, isPending } = useQuery(api.sapphire.v1.readingList.list);

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
    <Section>
      <div className="font-vga divide-y divide-white/5">
        {items.map((item) => (
          <div
            key={item._id}
            className="py-3 first:pt-0 last:pb-0 flex flex-col gap-0.5"
          >
            <span className="font-jersey text-lg leading-snug">
              {item.name}
            </span>
            {item.notes && (
              <p className="text-white/70 text-sm leading-relaxed">
                {item.notes}
              </p>
            )}
            {item.recommendedBy && (
              <p className="text-white/70 text-sm leading-relaxed">
                recommended by:{' '}
                <span className="underline">{item.recommendedBy}</span>
              </p>
            )}
            <span className="text-white/30 text-xs">
              {new Date(item._creationTime).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}
