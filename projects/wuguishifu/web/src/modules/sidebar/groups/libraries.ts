import { Eye, Hammer, Package, Workflow } from 'lucide-react';

import { NavGroup } from '../types';

export const librariesGroup: NavGroup = {
  id: 'libraries',
  label: 'Libraries',
  items: [
    {
      id: 'observability',
      icon: Eye,
      label: 'Observability',
      href: '/libs/observability',
      children: [{ label: 'crash-observer', href: '/libs/crash-observer' }],
    },
    {
      id: 'product',
      icon: Package,
      label: 'Product',
      href: '/libs/product',
      children: [{ label: 'graphics-i18n', href: 'https://i18n.graphics' }],
    },
    {
      id: 'generators',
      icon: Hammer,
      label: 'Nx Generators',
      href: '/libs/nx-generators',
      children: [
        { label: 'nx-convex', href: '/libs/nx-convex' },
        {
          label: 'nx-expo-native-modules',
          href: '/libs/nx-expo-native-modules',
        },
      ],
    },
    {
      id: 'automation',
      icon: Workflow,
      label: 'Automation',
      href: '/libs/automation',
      children: [
        { label: 'version-bump-workflow', href: '/libs/version-bump-workflow' },
      ],
    },
  ],
};
