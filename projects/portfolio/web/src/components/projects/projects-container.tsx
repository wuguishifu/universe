'use client';

import { Masonry } from 'react-plock';

import { ProjectDocument } from '../../../prismicio-types';

import { ProjectItem } from './project-item';

function renderItem(project: ProjectDocument, rowIndex: number) {
  return <ProjectItem key={project.id} project={project} rowIndex={rowIndex} />;
}

export function ProjectsContainer({
  projects,
}: {
  projects: ProjectDocument[];
}) {
  return (
    <Masonry
      items={projects}
      config={{
        columns: [1, 2, 3],
        gap: [24, 16, 8],
        media: [640, 960, 1280],
      }}
      render={renderItem}
    />
  );
}
