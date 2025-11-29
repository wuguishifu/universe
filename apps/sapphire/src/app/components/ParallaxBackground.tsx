import { ParallaxDriver } from './ParallaxDriver';

export function ParallaxBackground() {
  return (
    <>
      <div className="fixed inset-0 bg-[#090d12]/80 z-[-1000] pointer-events-none" />
      <div
        className="fixed inset-0 bg-cover bg-center bg-no-repeat z-[-1004] pointer-events-none"
        style={{
          backgroundImage: "url('/bg/1.png')",
          transform: 'translateY(var(--parallax-1, 0))',
        }}
      />
      <div
        className="fixed inset-0 bg-cover bg-center bg-no-repeat z-[-1003] pointer-events-none"
        style={{
          backgroundImage: "url('/bg/2.png')",
          transform: 'translateY(var(--parallax-2, 0))',
        }}
      />
      <div
        className="fixed inset-0 bg-cover bg-center bg-no-repeat z-[-1002] pointer-events-none"
        style={{
          backgroundImage: "url('/bg/3.png')",
          transform: 'translateY(var(--parallax-3, 0))',
        }}
      />
      <div
        className="fixed top-0 left-0 right-0 h-[200vh] bg-cover bg-no-repeat z-[-1001] pointer-events-none"
        style={{
          backgroundImage: "url('/bg/4.png')",
          backgroundPosition: 'top center',
          transform: 'translateY(var(--parallax-4, 0))',
        }}
      />
      <ParallaxDriver />
    </>
  );
}
