declare module '*.svg' {
  const content: string;
  export const ReactComponent: import('react').FunctionComponent<
    import('react').SVGProps<SVGSVGElement>
  >;
  export default content;
}
declare module '*.jpg';
declare module '*.png';
declare module '*.css';
