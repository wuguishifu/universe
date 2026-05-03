'use client';

import { useQuery } from 'convex/react';
import { api } from '@universe/hydrogen-kore';
import { Section } from '../../../modules/layout/section';

export function ReadingList() {
  const items = useQuery(api.sapphire.v1.readingList.list);

  if (!items?.length) {
    return (
      <Section>
        <p className="font-smooch text-white/40 text-sm">nothing here yet...</p>
      </Section>
    );
  }

  return (
    <Section>
      <div className="font-smooch divide-y divide-white/5">
        {items.map((item) => (
          <div
            key={item._id}
            className="py-3 first:pt-0 last:pb-0 flex flex-col gap-0.5"
          >
            <span className="font-jersey text-highlight text-lg leading-snug">
              {item.name}
            </span>
            <p className="text-white/70 text-sm leading-relaxed">
              {item.notes}
            </p>
            <p className="text-white/70 text-sm leading-relaxed">
              recommended by: {item.recommendedBy}
            </p>
            <span className="text-white/30 text-xs">
              {new Date(item.createdAt).toLocaleDateString('en-US', {
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
