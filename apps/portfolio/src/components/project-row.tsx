import Image from 'next/image';
import Link from 'next/link';

import { cn } from '../lib/utils';

import 'remixicon/fonts/remixicon.css';

type ProjectRowProps = {
  href: string;
  reversed?: boolean;
  background?: string;
  project: {
    title: string;
    meta: string;
    description: string;
  };
  hideShadow?: boolean;
  animationDelay?: number;
  quickCode?: boolean;
};

export default function ProjectRow({
  href,
  reversed,
  background,
  project,
  hideShadow = false,
  animationDelay = 0,
  quickCode = false,
}: ProjectRowProps) {
  return (
    <Link
      href={href}
      className={cn(
        `flex flex-col ${reversed ? 'md:flex-row' : 'md:flex-row-reverse'} md:gap-8`,
        'p-4 md:p-8 rounded-xl items-center animate-fade-in fill-mode-both w-full',
        background,
      )}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <div className="flex-1 gap-8 flex flex-col justify-between pb-4 md:py-4 overflow-hidden flex-shrink-0">
        <h1 className="text-4xl md:text-5xl font-bold gap-2 text-white my-0">
          {project.title} <i className="ri-external-link-line" />
        </h1>
        <div className="text-lg opacity-70 md:block hidden text-white">{project.description}</div>
      </div>
      <div className="flex-1 flex-shrink">
        <Image
          className={cn('rounded-lg', hideShadow ? '' : 'float')}
          src={`/projects/${project.meta}/thumbnail.png`}
          alt={`${project.title} Thumbnail`}
        />
      </div>
    </Link>
  );
}
