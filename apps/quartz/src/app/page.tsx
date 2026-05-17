import Image from 'next/image';

import { ShowMeButton } from '../components/show-me-button';

export default function Home() {
  return (
    <div className="flex items-start md:items-center w-full h-full justify-center max-w-5xl px-16 md:px-8 flex-1">
      <div className="flex-1 place-content-center z-10 flex flex-col gap-6 mt-12 md:mt-0 select-none">
        <h1 className="text-7xl animate-fade-in fill-mode-both m-0 text-center md:text-left">
          Hey there!
        </h1>
        <h1 className="text-5xl animate-fade-in delay-200 fill-mode-both m-0 text-center md:text-left">
          I&apos;m <span className="text-blue">Bo Bramer</span>.
        </h1>
        <p className="text-[1.2em] text-grey animate-fade-in delay-400 fill-mode-both m-0 text-center md:text-left">
          I rebuild this thing every like 2 months cuz I get sick of something.
          Maybe I&apos;ll make up my mind someday (I won&apos;t lmao).
        </p>
        <div className="flex justify-center md:justify-start mt-12 md:mt-0">
          <ShowMeButton />
        </div>
      </div>
      <div className="flex-0 md:flex-1 place-content-center select-none pointer-events-none">
        <div className="fixed inset-x-0 flex justify-center md:left-[55%] md:justify-start h-4/5 md:bottom-0 -bottom-102.5 animate-[fade-in_1.5s] fill-mode-both delay-200">
          <Image
            src="/chibi-reflected.png"
            alt="chibi bo"
            width={780}
            height={1032}
            className="h-full w-auto object-cover object-left"
          />
        </div>
      </div>
    </div>
  );
}
