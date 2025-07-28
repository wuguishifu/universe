import Image from 'next/image';

type ToggleImageProps = {
  light: string;
  dark: string;
  alt: string;
};

export default function ToggleImage({ light, dark, alt }: ToggleImageProps) {
  return (
    <>
      <Image alt={alt} src={light} className="w-full h-full object-cover dark:hidden" />
      <Image alt={alt} src={dark} className="w-full h-full object-cover dark:block hidden" />
    </>
  );
}
