'use client';

import { useEffect } from 'react';

export function ParallaxDriver() {
  useEffect(() => {
    const handleScroll = () => {
      if (document.documentElement.classList.contains('reduce-effects')) return;
      const scrollY = window.scrollY;
      const root = document.documentElement;
      const viewportHeight = window.innerHeight;

      root.style.setProperty('--parallax-1', `${-scrollY * 0.05}px`);
      root.style.setProperty('--parallax-2', `${-scrollY * 0.07}px`);
      root.style.setProperty('--parallax-3', `${-scrollY * 0.09}px`);

      const parallax4Value = -scrollY * 0.11;
      const maxParallax4 = -viewportHeight;
      const cappedParallax4 = Math.max(parallax4Value, maxParallax4);
      root.style.setProperty('--parallax-4', `${cappedParallax4}px`);
    };

    handleScroll();

    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  return null;
}
