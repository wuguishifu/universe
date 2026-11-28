import type { Metadata } from 'next';

import { AlbumList } from '../../modules/album/album-list';

export const metadata: Metadata = { title: 'Album · Jank™' };

/** Behind sign-in (see proxy.ts). A placeholder until the album's real pages land. */
export default function AlbumPage() {
  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <h1 className="mb-6 font-display text-4xl font-semibold">Album</h1>
      <AlbumList />
    </main>
  );
}
