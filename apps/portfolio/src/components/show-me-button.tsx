'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

import { Button } from './ui/button';

const redirectionUrls = [
  '/projects/molecular',
  '/projects/ptable',
  '/projects/mujank',
  '/projects/engine3d',
  '/projects/marching-cubes',
  '/projects/planets',
  '/projects/cloudsafe',
];

export default function ShowMeButton() {
  const router = useRouter();

  const handleClick = useCallback(() => {
    router.push(redirectionUrls[Math.floor(Math.random() * redirectionUrls.length)]);
  }, [router]);

  return (
    <Button className="animate-fade-in animation-delay-600 text-xl fill-mode-both" size="lg" onClick={handleClick}>
      Show me something cool!
    </Button>
  );
}
