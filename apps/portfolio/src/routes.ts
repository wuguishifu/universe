import { BuildQueryURLArgs } from '@prismicio/client';

export const routes: NonNullable<BuildQueryURLArgs['routes']> = [
  {
    type: 'project',
    path: '/projects/:uid',
  },
];
