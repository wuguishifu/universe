import Image from 'next/image';

import { Section } from '../../modules/layout/section';

export function MainColumn() {
  return (
    <>
      <Section>
        <div className="flex items-center gap-2">
          <Image
            src="/cats/yawn.gif"
            width={32}
            height={32}
            alt="Yawning cat"
            unoptimized
          />
          <h1 className="font-jersey text-4xl text-highlight pulse">
            welcome to wuguishifu.dev<i className="text-sm">★</i>
          </h1>
        </div>
      </Section>
    </>
  );
}
