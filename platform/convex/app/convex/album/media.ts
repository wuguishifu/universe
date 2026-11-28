import { ConvexError } from 'convex/values';

import type { Doc } from '../_generated/dataModel';

import {
  createSigner,
  isAcceptableSigningWindow,
  type Signer,
  signingConfigFromEnv,
} from './signing';
import type { Derivative } from './validators';

/**
 * A signer for a public query's `signingWindow` argument.
 *
 * @throws ConvexError `bad_signing_window` for a window too far from now.
 */
export function signerFor(signingWindow: number): Signer {
  if (!isAcceptableSigningWindow(signingWindow, Date.now())) {
    throw new ConvexError({ code: 'bad_signing_window' as const });
  }
  return createSigner(signingConfigFromEnv(process.env), signingWindow);
}

export type SignedMedia = {
  url: string;
  width?: number;
  height?: number;
  durationMs?: number;
};

export async function signDerivative(
  sign: Signer,
  derivative: Derivative | undefined,
): Promise<SignedMedia | null> {
  if (!derivative) return null;
  return {
    url: await sign(derivative),
    width: derivative.width,
    height: derivative.height,
    durationMs: derivative.durationMs,
  };
}

/** An album as public queries return it. */
export async function publicAlbum(
  sign: Signer,
  album: Doc<'albumAlbums'>,
  cover: Doc<'albumItems'> | null,
) {
  return {
    id: album._id,
    slug: album.slug,
    title: album.title,
    itemCount: album.readyCount,
    startAt: album.startAt ?? null,
    endAt: album.endAt ?? null,
    cover: await signDerivative(sign, cover?.derivatives.thumb),
  };
}
