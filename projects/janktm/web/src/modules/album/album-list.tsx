'use client';

import { useQuery } from 'convex/react';

import { api } from '@platform/convex-contracts';

/** Matches SIGNING_WINDOW_MS in convex/album/signing.ts. */
const SIGNING_WINDOW_MS = 6 * 60 * 60 * 1000;

export function AlbumList() {
  const albums = useQuery(api.album.albums.list, {
    signingWindow: Math.floor(Date.now() / SIGNING_WINDOW_MS),
  });

  if (albums === undefined) {
    return <p className="text-muted-foreground">Loading…</p>;
  }
  if (albums.length === 0) {
    return <p className="text-muted-foreground">No albums yet.</p>;
  }
  return (
    <ul className="space-y-2">
      {albums.map((album) => (
        <li key={album.id} className="flex justify-between gap-4">
          <span className="font-medium">{album.title}</span>
          <span className="text-muted-foreground">{album.itemCount} items</span>
        </li>
      ))}
    </ul>
  );
}
