import { ProjectDocumentData } from '../../prismicio-types';

export function backgroundClass(colorScheme: ProjectDocumentData['color_scheme']): string {
  switch (colorScheme) {
    case 'Blue':
      return 'gradient-blue dark py-8';
    case 'Green':
      return 'gradient-green py-8';
    case 'Red':
      return 'gradient-red dark py-8';
    case 'Blurple':
      return 'gradient-blurple dark py-8';
    case 'Peach':
      return 'gradient-peach dark py-8';
  }
}
