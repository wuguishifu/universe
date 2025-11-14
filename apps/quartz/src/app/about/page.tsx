import {
  SiExpo,
  SiKotlin,
  SiNestjs,
  SiNx,
  SiPostgresql,
  SiReact,
  SiSwift,
  SiTypescript,
} from '@icons-pack/react-simple-icons';
import { buttonVariants, cn } from '@wuguishifu/ui-web';
import { Metadata } from 'next';
import Link from 'next/link';

import 'remixicon/fonts/remixicon.css';

export const metadata: Metadata = {
  title: 'Bo | About',
};

export default function About() {
  return (
    <div className="w-full flex-1">
      <div className="flex flex-col z-10 justify-center h-full max-w-5xl mx-auto px-8 xl:px-0">
        <h1 className="text-[4em] font-bold pb-2 animate-fade-in fill-mode-both m-0 text-center md:text-left">
          What&apos;s Poppin!
        </h1>
        <p className="text-[1.2em] text-grey animate-fade-in fill-mode-both delay-200">
          Hi! My name is <span className="text-blue">Bo Bramer</span>, and I&apos;m a full-stack engineer with a degree
          in chemical engineering from the University of California, Irvine. Currently, I&apos;m a software engineer for{' '}
          <Link href="https://inkitt.com" className="underline underline-offset-4 text-blue" target="_blank">
            Inkitt
          </Link>{' '}
          where I mainly work with React Native and TypeScript. Here&apos;s the full tech stack I&apos;m using at work:
        </p>
        <div className="animate-fade-in fill-mode-both delay-400 flex flex-row items-center flex-wrap max-w-screen-sm w-full mx-auto gap-x-16 gap-y-4 mt-4 justify-between">
          <a className="cursor-pointer" href="https://reactnative.dev/" target="_blank" tabIndex={-1}>
            <div className="flex flex-col items-center w-20">
              <SiReact className="size-16 text-[#61DAFB]" />
              <p className="text-sm select-none">React Native</p>
            </div>
          </a>
          <a className="cursor-pointer" href="https://expo.dev/" target="_blank" tabIndex={-1}>
            <div className="flex flex-col items-center w-20">
              <SiExpo className="size-16 text-[#000020] dark:text-white" />
              <p className="text-sm select-none">Expo</p>
            </div>
          </a>
          <a className="cursor-pointer" href="https://www.typescriptlang.org/" target="_blank" tabIndex={-1}>
            <div className="flex flex-col items-center w-20">
              <SiTypescript className="size-16 text-[#3178C6]" />
              <p className="text-sm select-none">TypeScript</p>
            </div>
          </a>
          <a className="cursor-pointer" href="https://kotlinlang.org" target="_blank" tabIndex={-1}>
            <div className="flex flex-col items-center w-20">
              <SiKotlin className="size-16 text-[#7F52FF]" />
              <p className="text-sm select-none">Kotlin</p>
            </div>
          </a>
          <a className="cursor-pointer" href="https://www.swift.org/" target="_blank" tabIndex={-1}>
            <div className="flex flex-col items-center w-20">
              <SiSwift className="size-16 text-[#F05138]" />
              <p className="text-sm select-none">Swift</p>
            </div>
          </a>
          <a className="cursor-pointer" href="https://nestjs.com/" target="_blank" tabIndex={-1}>
            <div className="flex flex-col items-center w-20">
              <SiNestjs className="size-16 text-[#F05138]" />
              <p className="text-sm select-none">NestJS</p>
            </div>
          </a>
          <a className="cursor-pointer" href="https://www.postgresql.org/" target="_blank" tabIndex={-1}>
            <div className="flex flex-col items-center w-20">
              <SiPostgresql className="size-16 text-[#232F3E] dark:text-white" />
              <p className="text-sm select-none">PostgreSQL</p>
            </div>
          </a>
          <a className="cursor-pointer" href="https://nx.dev/" target="_blank" tabIndex={-1}>
            <div className="flex flex-col items-center w-20">
              <SiNx className="size-16 text-[#232F3E] dark:text-white" />
              <p className="text-sm select-none">Nx</p>
            </div>
          </a>
          <div className="w-20 h-0" />
        </div>
        <p className="text-[1.2em] text-grey animate-fade-in fill-mode-both delay-400">
          You can learn more about what I do at work{' '}
          <Link href="/resume" className="underline underline-offset-4 text-blue">
            here
          </Link>
          !
        </p>
        <p className="text-[1.2em] text-grey animate-fade-in fill-mode-both delay-600">
          The most recent side project I&apos;ve been working on is{' '}
          <Link
            href="https://github.com/wuguishifu/tungsten"
            className="underline underline-offset-4 text-blue"
            target="_blank"
          >
            Tungsten
          </Link>
          , a self-hostable note-taking app that supports markdown formatting, LaTeX, and vim input. It saves files to
          the native file system, so you don&apos;t need to worry about any lock-in when transfering notes in or out.
        </p>
        <p className="text-[1.2em] text-grey animate-fade-in fill-mode-both delay-800">
          You can learn more about me below!
        </p>
        <div className="pt-2 w-full flex flex-row items-center gap-4 animate-fade-in delay-1000 fill-mode-both">
          <SocialMediaButton href="mailto:bramer.bo@gmail.com" icon="ri-at-line" />
          <SocialMediaButton href="https://github.com/wuguishifu" icon="ri-github-fill" />
          <SocialMediaButton href="https://www.linkedin.com/in/bo-bramer/" icon="ri-linkedin-fill" />
          <SocialMediaButton href="https://instagram.com/theonetheycallbo" icon="ri-instagram-line" />
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
      className={cn(buttonVariants({ variant: 'default', size: 'icon' }), 'rounded-full')}
    >
      <i className={cn(icon, 'text-2xl')} />
    </Link>
  );
}
