import { ProjectDocumentData } from '../../prismicio-types';

export function backgroundClass(colorScheme: ProjectDocumentData['color_scheme']): string {
  switch (colorScheme) {
    case 'Blue':
      return 'gradient-blue text-white py-8';
    case 'Green':
      return 'gradient-green py-8';
    case 'Red':
      return 'gradient-red py-8';
    case 'Blurple':
      return 'gradient-blurple py-8';
    case 'Peach':
      return 'gradient-peach py-8';
  }
}
