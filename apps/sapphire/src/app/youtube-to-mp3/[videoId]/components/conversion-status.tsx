'use client';

import { Download } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@universe/hydrogen-kore';
import { cn, Spinner } from '@universe/ui-web';
import { useQuery } from '../../../../modules/convex/use-query';
import { Section } from '../../../../modules/layout/section';
import { getDownloadUrl } from '../../actions';

export function ConversionStatus({ videoId }: { videoId: string }) {
  const { data: record, isPending } = useQuery(
    api.silver.converter.audioConversions.getRecord,
    { youtubeId: videoId },
  );

  if (isPending) {
    return (
      <Section className="flex items-center justify-center">
        <Spinner className="animate-spin duration-4s" color="#ffffff80" />
      </Section>
    );
  }

  if (!record) {
    return (
      <Section className="font-vga">
        <p className="text-white/40 text-sm">
          no conversion found for this video...
        </p>
        <Link
          href="/youtube-to-mp3"
          className="text-sm underline underline-offset-4"
        >
          convert a video
        </Link>
      </Section>
    );
  }

  const inProgress = record.status === 'queued' || record.status === 'processing';

  return (
    <Section className="font-vga">
      <div className="flex items-center gap-2">
        <span>{videoId}:</span>
        <span
          className={cn({
            'status-degraded': inProgress,
            'status-ok': record.status === 'completed',
            'status-down': record.status === 'failed',
          })}
        >
          {record.status.toUpperCase()}
        </span>
        {inProgress && <Spinner />}
      </div>
      {record.statusDescription && (
        <p className="text-white/70 text-sm mt-1">{record.statusDescription}</p>
      )}
      {record.status === 'failed' && (
        <Link
          href="/youtube-to-mp3"
          className="text-sm underline underline-offset-4"
        >
          try again
        </Link>
      )}
      {record.status === 'completed' && <DownloadButton videoId={videoId} />}
    </Section>
  );
}

function DownloadButton({ videoId }: { videoId: string }) {
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    setIsFetching(true);
    setError(null);
    try {
      const result = await getDownloadUrl(videoId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      window.location.assign(result.url);
    } catch {
      setError('failed to get download link');
    } finally {
      setIsFetching(false);
    }
  };

  return (
    <div className="mt-2">
      <button
        onClick={handleDownload}
        disabled={isFetching}
        className="px-4 py-2 border border-gray-400/20 rounded-sm hover:bg-gray-400/10 transition-all duration-150 disabled:opacity-50 flex items-center gap-2"
      >
        {isFetching ? <Spinner /> : <Download size={16} />}
        download mp3
      </button>
      {error && <p className="status-down text-sm mt-1">{error}</p>}
    </div>
  );
}
