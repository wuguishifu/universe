'use client';

import Link from 'next/link';
import { api } from '@universe/hydrogen-kore';
import { cn, Spinner } from '@universe/ui-web';
import { useQuery } from '../../convex/use-query';
import { Section } from '../../layout/section';

export function Statuses() {
  const { data, isPending } = useQuery(api.sapphire.v1.systemStatuses.list);

  return (
    <Section className="font-vga">
      <div className="flex items-center gap-2">
        <span>system status:</span>
        {isPending && <Spinner />}
        <span
          className={cn({
            'status-ok': data?.status === 'ok',
            'status-degraded': data?.status === 'degraded',
            'status-down': data?.status === 'down',
          })}
        >
          {data?.status}
        </span>
      </div>
      {isPending ? null : (
        <div className="grid grid-cols-2">
          {data?.statuses.map((service) => {
            const content = (
              <>
                <span>
                  [{' '}
                  <span
                    className={cn({
                      'status-ok': service.status === 'ok',
                      'status-down': service.status === 'down',
                    })}
                  >
                    {service.status.toUpperCase()}
                  </span>{' '}
                  ]
                </span>
                <span
                  style={{
                    marginLeft: service.status === 'ok' ? '3ch' : '1ch',
                  }}
                  className="group-hover:underline underline-offset-4"
                >
                  {service.serviceName}
                  {service.link && '↗'}
                </span>
              </>
            );

            if (service.link) {
              return (
                <Link
                  key={service._id}
                  href={service.link}
                  target="_blank"
                  className="group"
                >
                  {content}
                </Link>
              );
            }

            return <div key={service._id}>{content}</div>;
          })}
        </div>
      )}
    </Section>
  );
}
