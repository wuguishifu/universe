import Image from 'next/image';
import Link from 'next/link';

import { ProjectDocument } from '../../../prismicio-types';
import { cn } from '../../lib/utils';
import { backgroundClass } from '../../slices/background';

export function ProjectItem({ project }: { project: ProjectDocument }) {
  return (
    <Link href={`/projects/${project.uid}`}>
      <div
        className={cn('w-full px-6 py-8 rounded-xl transition-all duration-300 cursor-pointer hover:scale-[102%]', [
          backgroundClass(project.data.color_scheme, { useDarkClass: true }),
        ])}
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
          <h2 className="text-foreground text-center">{project.data.title}</h2>
          <p className="text-foreground">{project.data.description}</p>
        </div>
      </div>
    </Link>
  );
}
