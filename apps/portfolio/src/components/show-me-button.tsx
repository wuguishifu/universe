import Link from 'next/link';

import { cn } from '../lib/utils';
import { createClient } from '../prismicio';
import { buttonVariants } from './ui/button';

export async function ShowMeButton() {
  const client = createClient();

  const allProjects = await client.getAllByType('project');
  const randomProject = allProjects[Math.floor(Math.random() * allProjects.length)];

  return (
    <Link
      href={`/projects/${randomProject.uid}`}
      className={cn(
        buttonVariants({ variant: 'default', size: 'lg' }),
        'animate-fade-in animation-delay-600 text-xl fill-mode-both',
      )}
    >
      Show me something cool!
    </Link>
  );
}
