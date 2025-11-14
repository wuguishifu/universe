import { buttonVariants, cn } from '@wuguishifu/ui-web';
import Link from 'next/link';

import { createClient } from '../prismicio';

export async function ShowMeButton() {
  const client = createClient();

  const allProjects = await client.getAllByType('project');
  const randomProject = allProjects[Math.floor(Math.random() * allProjects.length)];

  return (
    <Link
      href={`/projects/${randomProject.uid}`}
      className={cn(
        buttonVariants({ variant: 'default', size: 'lg' }),
        'animate-fade-in delay-600 text-xl fill-mode-both',
      )}
    >
      Show me something cool!
    </Link>
  );
}
