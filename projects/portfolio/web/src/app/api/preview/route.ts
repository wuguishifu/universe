import { redirectToPreviewURL } from '@prismicio/next';
import { NextRequest } from 'next/server';

import { createClient } from '../../../prismicio';

export async function GET(request: NextRequest): Promise<void> {
  const client = createClient();
  await redirectToPreviewURL({ client, request });
}
