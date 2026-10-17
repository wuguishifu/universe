import Image from 'next/image';
import { Section } from '../components/section';

export default function Index() {
  return (
    <main className="w-full flex flex-col gap-2">
      <Section>
        <div className="flex items-center gap-2">
          <Image
            src="/cats/yawn.gif"
            width={32}
            height={32}
            alt="Yawning cat"
            unoptimized
          />
          <h2>
            welcome to wuguishifu.dev<i className="text-sm">★</i>
          </h2>
        </div>
      </Section>
    </main>
  );
}
