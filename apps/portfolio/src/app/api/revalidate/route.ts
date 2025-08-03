import { revalidateTag } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

import { createClient, PRISMIC_SECRET_HEADER, repositoryName } from '../../../prismicio';

type RequestBody = {
  type: 'api-update' | 'test-trigger';
  masterRef: string;
  domain: string;
  apiUrl: string;
  documents: string[];
};

const client = createClient({
  fetchOptions: undefined,
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const headers = req.headers;
  const secret = headers.get(PRISMIC_SECRET_HEADER);
  if (secret !== process.env.PRISMIC_REVALIDATE_SECRET) {
    return NextResponse.json({ revalidated: false, message: 'Forbidden' }, { status: 403 });
  }

  const clearAll = req.nextUrl.searchParams.get('clearAll') === 'true';

  if (clearAll) {
    revalidateTag(repositoryName);
    return NextResponse.json({ revalidated: true, now: Date.now() }, { status: 200 });
  }

  const data: RequestBody = await req.json();
  if (!data.documents) {
    return NextResponse.json({ revalidated: false, message: 'No documents provided' }, { status: 400 });
  }

  const pages = await Promise.all(data.documents.map((id) => client.getByID(id)));
  for (const page of pages) {
    if (page.uid) {
      revalidateTag(page.uid);
    }

    if (!page.uid && page.type) {
      revalidateTag(page.type);
    }
  }

  return NextResponse.json({ revalidated: true, now: Date.now() }, { status: 200 });
}
