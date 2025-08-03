import { ProjectDocumentData } from '../../prismicio-types';

export function backgroundClass(
  colorScheme: ProjectDocumentData['color_scheme'],
  { useDarkClass = false } = {},
): string {
  switch (colorScheme) {
    case 'Blue':
      return `gradient-blue py-8 ${useDarkClass ? 'dark' : ''}`;
    case 'Green':
      return 'gradient-green py-8';
    case 'Red':
      return `gradient-red dark py-8 ${useDarkClass ? 'dark' : ''}`;
    case 'Blurple':
      return `gradient-blurple dark py-8 ${useDarkClass ? 'dark' : ''}`;
    case 'Peach':
      return `gradient-peach dark py-8 ${useDarkClass ? 'dark' : ''}`;
  }
}
