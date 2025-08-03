'use client';

import { useCallback } from 'react';
import { Masonry } from 'react-plock';

import { ProjectItem } from './project-item';
import { ProjectDocument } from '../../../prismicio-types';

export function ProjectsContainer({ projects }: { projects: ProjectDocument[] }) {
  const renderItem = useCallback((project: ProjectDocument) => {
    return <ProjectItem key={project.id} project={project} />;
  }, []);

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
