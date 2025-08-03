import { revalidateTag } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

import { PRISMIC_SECRET_HEADER } from '../../../prismicio';

export function POST(req: NextRequest): Promise<NextResponse> {
  const headers = req.headers;
  const secret = headers.get(PRISMIC_SECRET_HEADER);
  if (secret !== process.env.PRISMIC_REVALIDATE_SECRET) {
    return Promise.resolve(NextResponse.json({ revalidated: false, message: 'Forbidden' }, { status: 403 }));
  }

  revalidateTag('prismic');

  return Promise.resolve(NextResponse.json({ revalidated: true, now: Date.now() }, { status: 200 }));
}
