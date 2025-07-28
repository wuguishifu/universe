import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Bo | About',
};

export default function AboutLayout({ children }: { children: Readonly<React.ReactNode> }) {
  return <div className="max-w-[60rem] h-full px-8">{children}</div>;
}
