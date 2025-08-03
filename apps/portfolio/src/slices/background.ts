import { ProjectDocumentData } from '../../prismicio-types';

export function backgroundClass(
  colorScheme: ProjectDocumentData['color_scheme'],
  { useDarkClass = false } = {},
): string {
  switch (colorScheme) {
    case 'Blue':
      return `gradient-blue py-2 ${useDarkClass ? 'dark' : ''}`;
    case 'Green':
      return 'gradient-green py-2';
    case 'Red':
      return `gradient-red py-2 ${useDarkClass ? 'dark' : ''}`;
    case 'Blurple':
      return `gradient-blurple py-2 ${useDarkClass ? 'dark' : ''}`;
    case 'Peach':
      return `gradient-peach py-2 ${useDarkClass ? 'dark' : ''}`;
  }
}
