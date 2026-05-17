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
import { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buttonVariants, cn } from '@universe/ui-web';
import { createClient } from '../../prismicio';

import 'remixicon/fonts/remixicon.css';

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

  return (
    <div className="w-full flex-1">
      <div className="flex flex-col z-10 justify-center h-full max-w-5xl mx-auto px-8 xl:px-0">
        <h1 className="text-[4em] font-bold pb-2 animate-fade-in fill-mode-both m-0 text-center md:text-left">
          {page.data.title}
        </h1>
        <p className="text-[1.2em] text-grey animate-fade-in fill-mode-both delay-200">
          Hi! My name is{' '}
          <Link
            href="https://linkedin.com/in/bo-bramer"
            target="_blank"
            className="underline underline-offset-4 text-blue"
          >
            Bo Bramer
          </Link>{' '}
          and I&apos;m a full-stack engineer with a degree in chemical
          engineering from the University of California, Irvine. Currently,
          I&apos;m a senior software engineer at{' '}
          <Link
            href="https://solidstarts.com"
            className="underline underline-offset-4 text-blue"
            target="_blank"
          >
            Solid Starts
          </Link>{' '}
          where I work on mobile apps using React Native with Typescript,
          Kotlin, and Swift. Here&apos;s the full tech stack I&apos;m using at
          work:
        </p>
        <div className="animate-fade-in fill-mode-both delay-400 flex flex-row items-center flex-wrap max-w-screen-sm w-full mx-auto gap-x-16 gap-y-4 mt-4 justify-between">
          <a
            className="cursor-pointer"
            href="https://reactnative.dev/"
            target="_blank"
            tabIndex={-1}
          >
            <div className="flex flex-col items-center w-20">
              <SiReact className="size-16 text-[#61DAFB]" />
              <p className="text-sm select-none">React Native</p>
            </div>
          </a>
          <a
            className="cursor-pointer"
            href="https://expo.dev/"
            target="_blank"
            tabIndex={-1}
          >
            <div className="flex flex-col items-center w-20">
              <SiExpo className="size-16 text-[#000020] dark:text-white" />
              <p className="text-sm select-none">Expo</p>
            </div>
          </a>
          <a
            className="cursor-pointer"
            href="https://www.typescriptlang.org/"
            target="_blank"
            tabIndex={-1}
          >
            <div className="flex flex-col items-center w-20">
              <SiTypescript className="size-16 text-[#3178C6]" />
              <p className="text-sm select-none">TypeScript</p>
            </div>
          </a>
          <a
            className="cursor-pointer"
            href="https://kotlinlang.org"
            target="_blank"
            tabIndex={-1}
          >
            <div className="flex flex-col items-center w-20">
              <SiKotlin className="size-16 text-[#7F52FF]" />
              <p className="text-sm select-none">Kotlin</p>
            </div>
          </a>
          <a
            className="cursor-pointer"
            href="https://www.swift.org/"
            target="_blank"
            tabIndex={-1}
          >
            <div className="flex flex-col items-center w-20">
              <SiSwift className="size-16 text-[#F05138]" />
              <p className="text-sm select-none">Swift</p>
            </div>
          </a>
          <a
            className="cursor-pointer"
            href="https://nestjs.com/"
            target="_blank"
            tabIndex={-1}
          >
            <div className="flex flex-col items-center w-20">
              <SiNestjs className="size-16 text-[#F05138]" />
              <p className="text-sm select-none">NestJS</p>
            </div>
          </a>
          <a
            className="cursor-pointer"
            href="https://www.postgresql.org/"
            target="_blank"
            tabIndex={-1}
          >
            <div className="flex flex-col items-center w-20">
              <SiConvex className="size-16 text-[#232F3E] dark:text-white" />
              <p className="text-sm select-none">Convex</p>
            </div>
          </a>
          <a
            className="cursor-pointer"
            href="https://nx.dev/"
            target="_blank"
            tabIndex={-1}
          >
            <div className="flex flex-col items-center w-20">
              <SiNx className="size-16 text-[#232F3E] dark:text-white" />
              <p className="text-sm select-none">Nx</p>
            </div>
          </a>
          <div className="w-20 h-0" />
        </div>
        {/* <p className="text-[1.2em] text-grey animate-fade-in fill-mode-both delay-400">
          You can learn more about what I do at work{' '}
          <Link href="/resume" className="underline underline-offset-4 text-blue">
            here
          </Link>
          !
        </p> */}
        <p className="text-[1.2em] text-grey animate-fade-in fill-mode-both delay-600">
          The most recent side project I&apos;ve been working on is{' '}
          <Link
            href="/projects/topaz"
            className="underline underline-offset-4 text-blue"
            target="_blank"
          >
            Topaz
          </Link>
          , a self-hostable thermostat automation app that allows you to set up
          custom automations for your smart thermostat using a simple and
          intuitive UI. It also records data from your thermostat so you can see
          how your house heats and cools over time. Right now, I'm working on a
          feature that will give you insights on how you can optimize your
          thermostat settings to save energy and money using historical data and
          machine learning.
        </p>
        <p className="text-[1.2em] text-grey animate-fade-in fill-mode-both delay-800">
          You can learn more about me below!
        </p>
        <div className="pt-2 w-full flex flex-row items-center gap-4 animate-fade-in delay-1000 fill-mode-both">
          <SocialMediaButton
            href="mailto:bramer.bo@gmail.com"
            icon="ri-at-line"
          />
          <SocialMediaButton
            href="https://github.com/wuguishifu"
            icon="ri-github-fill"
          />
          <SocialMediaButton
            href="https://www.linkedin.com/in/bo-bramer/"
            icon="ri-linkedin-fill"
          />
          <SocialMediaButton
            href="https://instagram.com/theonetheycallbo"
            icon="ri-instagram-line"
          />
        </div>
      </div>
    </div>
  );
}

function SocialMediaButton({ href, icon }: { href: string; icon: string }) {
  return (
    <Link
      href={href}
      target="_blank"
      className={cn(
        buttonVariants({ variant: 'default', size: 'icon' }),
        'rounded-full',
      )}
    >
      <i className={cn(icon, 'text-2xl')} />
    </Link>
  );
}
