import { ProjectDocument } from '../../../prismicio-types';
import { ProjectsContainer } from '../../components/projects/projects-container';
import { createClient } from '../../prismicio';

const requiredProps = [
  'project.title',
  'project.description',
  'project.color_scheme',
  'project.display_image',
];

export const metadata = {
  title: 'Bo | Projects',
};

export default async function Projects() {
  const client = createClient();
  const allDocuments = await client.getAllByType('project', {
    fetch: requiredProps,
  });
  const projects = allDocuments.filter(
    (doc): doc is ProjectDocument => doc.type === 'project',
  );

  return (
    <div className="px-16 w-full flex-1 mt-8 max-w-7xl">
      <ProjectsContainer projects={projects} />
    </div>
  );
}
