import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@universe/ui-web';

import { ProjectDocument } from '../../../prismicio-types';
import { backgroundClass } from '../../slices/background';

export function ProjectItem({
  project,
  rowIndex,
}: {
  project: ProjectDocument;
  rowIndex: number;
}) {
  return (
    <Link href={`/projects/${project.uid}`}>
      <div
        className={cn(
          'w-full px-6 py-8 rounded-xl cursor-pointer hover:scale-[102%] animate-fade-in fill-mode-both',
          [backgroundClass(project.data.color_scheme, { useDarkClass: true })],
        )}
        style={{
          transitionProperty: 'all',
          transitionDuration: '300ms',
          animationDelay: `${rowIndex * 100}ms`,
        }}
      >
        <div className="w-full aspect-video relative select-none pointer-events-none">
          <Image
            src={project.data.display_image.url ?? ''}
            alt={project.data.display_image.alt ?? ''}
            fill={true}
            className="object-contain rounded-lg"
          />
        </div>
        <div className="select-none pointer-events-none">
          <h2 className="text-foreground text-center text-4xl my-2">
            {project.data.title}
          </h2>
          <p className="text-foreground text-lg">{project.data.description}</p>
        </div>
      </div>
    </Link>
  );
}
