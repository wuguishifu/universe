import Image from 'next/image';

import ShowMeButton from '../components/show-me-button';

export default function Home() {
  return (
    <div className="flex items-center w-full h-full justify-center max-w-screen-xl px-8">
      <div className="flex-1 place-content-center z-10 flex flex-col gap-6">
        <h1 className="text-7xl animate-fade-in fill-mode-both m-0">Hey there!</h1>
        <h1 className="text-5xl animate-fade-in animation-delay-200 fill-mode-both m-0">
          I&apos;m <span className="text-blue">Bo Bramer</span>.
        </h1>
        <p className="text-[1.2em] text-grey animate-fade-in animation-delay-400 fill-mode-both m-0">
          I build things. Most recently I&apos;ve been working with React Native, Expo, NestJS, and PostgreSQL. Feel
          free snoop around or reach out to me!
        </p>
        <div>
          <ShowMeButton />
        </div>
      </div>
      <div className="flex-1 place-content-center hidden md:block">
        <div className="fixed left-[55%] h-4/5 bottom-0 animate-[fade-in_1.5s] fill-mode-both animation-delay-200">
          <Image src="/chibi/chibi-reflected.png" alt="chibi bo" width={780} height={1032} className="h-full w-auto" />
        </div>
      </div>
    </div>
  );
}
