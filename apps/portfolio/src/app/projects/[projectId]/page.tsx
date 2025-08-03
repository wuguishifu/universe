import { PageProps } from '@wuguishifu/utils-web';
import { notFound } from 'next/navigation';

import { AllDocumentTypes, ProjectDocument } from '../../../../prismicio-types';
import { createClient } from '../../../prismicio';
import { components } from '../../../slices';
import { PageContext, SliceZoneWithContext } from '../../../slices/context';

function verifyParams(page: AllDocumentTypes): page is ProjectDocument {
  return page.type === 'project';
}

export default async function ProjectPage({ params }: PageProps<never, { projectId: string }>) {
  const { projectId } = await params;
  const client = createClient();
  const page = await client.getByUID('project', projectId).catch(() => notFound());

  if (page.uid && !verifyParams(page)) {
    notFound();
  }

  const context: PageContext = {
    colorScheme: page.data.color_scheme,
  };

  return (
    <main className="w-full">
      <SliceZoneWithContext slices={page.data.slices} components={components} context={context} />
    </main>
  );
}
