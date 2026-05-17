import 'remixicon/fonts/remixicon.css';

import {
  SiConvex,
  SiExpo,
  SiKotlin,
  SiNestjs,
  SiNx,
  SiReact,
  SiSwift,
  SiTypescript,
} from '@icons-pack/react-simple-icons';
import { isFilled } from '@prismicio/client';
import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RichText } from '../../components/text/text';
import { createClient } from '../../prismicio';
import { SocialMediaButton } from './components/social-media-button';
import { TechStackItem } from './components/tech-stack-item';

export const metadata: Metadata = {
  title: 'Bo | About',
};

export default async function About() {
  const client = createClient();
  const query = await client.getByType('about').catch(() => notFound());
  const page = query.results[0];

  if (!page) {
    return notFound();
  }

  const paragraph1Data = isFilled.richText(page.data.paragraph_1)
    ? page.data.paragraph_1
    : null;

  const paragraph2Data = isFilled.richText(page.data.paragraph_2)
    ? page.data.paragraph_2
    : null;

  return (
    <div className="w-full flex-1">
      <div className="flex flex-col z-10 justify-center h-full max-w-5xl mx-auto px-8 xl:px-0">
        <h1 className="text-[4em] font-bold pb-2 animate-fade-in fill-mode-both m-0 text-center md:text-left">
          {page.data.title}
        </h1>
        {paragraph1Data && (
          <section
            className="text-[1.2em] text-grey animate-fade-in fill-mode-both delay-200"
            id="p1"
          >
            <RichText content={paragraph1Data} />
          </section>
        )}
        <section
          className="animate-fade-in fill-mode-both delay-400 flex flex-row items-center flex-wrap max-w-screen-sm w-full mx-auto gap-x-16 gap-y-4 mt-4 justify-between"
          id="stack"
        >
          {techStackConfig.map((item) => (
            <TechStackItem key={item.label} {...item} />
          ))}
        </section>
        {paragraph2Data && (
          <section
            className="text-[1.2em] text-grey animate-fade-in fill-mode-both delay-600"
            id="p2"
          >
            <RichText content={paragraph2Data} />
          </section>
        )}
        <section
          className="text-[1.2em] text-grey animate-fade-in fill-mode-both delay-800"
          id="learn-more"
        >
          You can learn more about me below!
        </section>
        <section
          className="pt-2 w-full flex flex-row items-center gap-4 animate-fade-in delay-1000 fill-mode-both"
          id="social"
        >
          {socialMediaConfig.map((item) => (
            <SocialMediaButton key={item.href} {...item} />
          ))}
        </section>
      </div>
    </div>
  );
}

const socialMediaConfig = [
  {
    href: 'mailto:bramer.bo@gmail.com',
    icon: 'ri-at-line',
  },
  {
    href: 'https://github.com/wuguishifu',
    icon: 'ri-github-fill',
  },
  {
    href: 'https://www.linkedin.com/in/bo-bramer/',
    icon: 'ri-linkedin-fill',
  },
  {
    href: 'https://instagram.com/theonetheycallbo',
    icon: 'ri-instagram-line',
  },
] as const;

const techStackConfig = [
  {
    href: 'https://reactnative.dev/',
    Icon: SiReact,
    iconClassName: 'text-[#61DAFB]',
    label: 'React Native',
  },
  {
    href: 'https://expo.dev/',
    Icon: SiExpo,
    iconClassName: 'text-[#000020] dark:text-white',
    label: 'Expo',
  },
  {
    href: 'https://www.typescriptlang.org/',
    Icon: SiTypescript,
    iconClassName: 'text-[#3178C6]',
    label: 'TypeScript',
  },
  {
    href: 'https://kotlinlang.org/',
    Icon: SiKotlin,
    iconClassName: 'text-[#7F52FF]',
    label: 'Kotlin',
  },
  {
    href: 'https://www.swift.org/',
    Icon: SiSwift,
    iconClassName: 'text-[#F05138]',
    label: 'Swift',
  },
  {
    href: 'https://nestjs.com/',
    Icon: SiNestjs,
    iconClassName: 'text-[#F05138]',
    label: 'NestJS',
  },
  {
    href: 'https://www.convex.dev/',
    Icon: SiConvex,
    iconClassName: 'text-[#232F3E] dark:text-white',
    label: 'Convex',
  },
  {
    href: 'https://nx.dev/',
    Icon: SiNx,
    iconClassName: 'text-[#232F3E] dark:text-white',
    label: 'Nx',
  },
] as const;
