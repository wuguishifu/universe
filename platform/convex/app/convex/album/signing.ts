// Only imports aws4fetch, so its spec can run this file on Node's type stripping.
import { AwsV4Signer } from 'aws4fetch';

/**
 * Album URLs are presigned GETs against Garage's public endpoint, so media never passes through
 * Convex or the cluster. A URL is signed as of the start of a signing window and lasts twice as
 * long as one, so it's valid for at least a whole window after the one it was signed in.
 *
 * The client passes the window (`currentSigningWindow(Date.now())`) as a query argument. That keeps
 * queries deterministic, so Convex's cache never serves a URL that has expired, and it keeps URLs
 * identical within a window, so browsers cache the media too.
 */
export const SIGNING_WINDOW_MS = 6 * 60 * 60 * 1000;
export const URL_TTL_SECONDS = (2 * SIGNING_WINDOW_MS) / 1000;

export function currentSigningWindow(now: number): number {
  return Math.floor(now / SIGNING_WINDOW_MS);
}

/**
 * Whether a client's window is one to sign for: the current one or a neighbor, for clocks a
 * little off or a page that's been open across a boundary. Anything else would mint URLs that
 * are already expired, or that aren't valid yet.
 */
export function isAcceptableSigningWindow(
  window: number,
  now: number,
): boolean {
  return (
    Number.isInteger(window) &&
    Math.abs(window - currentSigningWindow(now)) <= 1
  );
}

export type SigningConfig = {
  /** Garage's public S3 endpoint, e.g. https://s3-public.wuguishifu.dev. */
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/**
 * Reads the deployment's signing env vars. In production the key should be a read-only Garage key
 * for the album's buckets: anything it can read, anyone can be handed a URL for.
 */
export function signingConfigFromEnv(
  env: Record<string, string | undefined>,
): SigningConfig {
  const read = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`${name} is not set on this deployment`);
    return value;
  };
  return {
    endpoint: read('ALBUM_S3_PUBLIC_ENDPOINT').replace(/\/+$/, ''),
    region: read('ALBUM_S3_REGION'),
    accessKeyId: read('ALBUM_S3_ACCESS_KEY_ID'),
    secretAccessKey: read('ALBUM_S3_SECRET_ACCESS_KEY'),
  };
}

export type SignOptions = {
  /**
   * Asks S3 to serve the object as a download with this file name (`response-content-disposition`).
   * Garage ignores it, so the album's originals also carry the header themselves (the upload script
   * sets it); this is for stores that honor it.
   */
  downloadName?: string;
};

export type Signer = (
  object: { bucket: string; key: string },
  options?: SignOptions,
) => Promise<string>;

/** Signs path-style GET URLs for one window, sharing the derived signing key between them. */
export function createSigner(config: SigningConfig, window: number): Signer {
  const datetime = amzDatetime(window * SIGNING_WINDOW_MS);
  const cache = new Map<string, ArrayBuffer>();
  return (object, options = {}) => {
    const url = new URL(
      `${config.endpoint}/${encodePathSegment(object.bucket)}/${encodeKey(object.key)}`,
    );
    if (options.downloadName !== undefined) {
      url.searchParams.set(
        'response-content-disposition',
        attachmentDisposition(options.downloadName),
      );
    }
    return signUrl(url, { ...config, datetime, cache });
  };
}

/** Presigns a GET for `url`, valid for `URL_TTL_SECONDS` (or `expiresSeconds`) from `datetime`. */
export async function signUrl(
  url: URL,
  {
    region,
    accessKeyId,
    secretAccessKey,
    datetime,
    expiresSeconds = URL_TTL_SECONDS,
    cache,
  }: Omit<SigningConfig, 'endpoint'> & {
    /** ISO 8601 basic format, e.g. 20130524T000000Z. */
    datetime: string;
    expiresSeconds?: number;
    cache?: Map<string, ArrayBuffer>;
  },
): Promise<string> {
  const unsigned = new URL(url);
  unsigned.searchParams.set('X-Amz-Expires', String(expiresSeconds));
  const signer = new AwsV4Signer({
    method: 'GET',
    url: unsigned.toString(),
    accessKeyId,
    secretAccessKey,
    service: 's3',
    region,
    datetime,
    signQuery: true,
    cache,
  });
  const { url: signed } = await signer.sign();
  return signed.toString();
}

function amzDatetime(at: number): string {
  return new Date(at).toISOString().replace(/[:-]|\.\d{3}/g, '');
}

/**
 * S3's own encoding (RFC 3986: everything but unreserved characters), so the path that's sent is
 * exactly the one that's signed. `encodeURIComponent` leaves `!'()*` alone, and album folders
 * have names like "2022-06-12 GRADUATION!".
 */
export function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function encodeKey(key: string): string {
  return key.split('/').map(encodePathSegment).join('/');
}

/** `attachment` with an ASCII fallback name and the real one as RFC 5987 `filename*`. */
export function attachmentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodePathSegment(name)}`;
}
