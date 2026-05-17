import { asImageSrc, isFilled } from '@prismicio/client';
import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageProps } from '@universe/utils-web';

import { createClient } from '../../../prismicio';
import { components } from '../../../slices';
import { PageContext, SliceZoneWithContext } from '../../../slices/context';

export default async function ProjectPage({
  params,
}: PageProps<never, { projectId: string }>) {
  const { projectId } = await params;
  const client = createClient();
  const page = await client
    .getByUID('project', projectId)
    .catch(() => notFound());

  if (page.uid) {
    notFound();
  }

  const context: PageContext<'project'> = {
    colorScheme: page.data.color_scheme,
    sliceIds: page.data.slices.map((slice) => slice.id),
  };

  return (
    <div className="w-full flex-1">
      <SliceZoneWithContext
        slices={page.data.slices}
        components={components}
        context={context}
      />
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ projectId: string }>;
}): Promise<Metadata> {
  const { projectId } = await params;
  const client = createClient();
  const page = await client
    .getByUID('project', projectId)
    .catch(() => notFound());

  const title = isFilled.keyText(page.data.meta_title)
    ? page.data.meta_title
    : undefined;
  const description = isFilled.keyText(page.data.meta_description)
    ? page.data.meta_description
    : undefined;
  const metaImage = isFilled.image(page.data.meta_image)
    ? page.data.meta_image
    : undefined;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: metaImage && [asImageSrc(metaImage)],
    },
  };
}

// prerender only the params from `generateStaticParams` at build time
// if a request comes for a path that hasn't been generated then next.js will
// server-render it on-demand
export const dynamicParams = true;

export async function generateStaticParams() {
  const client = createClient();
  const allProjects = await client.getAllByType('project');

  return allProjects.map((project) => ({
    projectId: project.uid,
  }));
}
