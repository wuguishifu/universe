import Image from 'next/image';

export default function NotFound() {
  return (
    <main className="w-full flex flex-col items-center justify-center gap-2">
      <h2 className="rotate-5 mt-52 mr-48">out of service</h2>
      <p className="-rotate-3">(404)</p>
      <Image
        className="mr-20"
        src="/cats/box2.gif"
        width={32}
        height={32}
        alt="box cat"
        unoptimized
      />
    </main>
  );
}
