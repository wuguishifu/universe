'use client';

import { useEffect } from 'react';

export function ParallaxBackground() {
  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      const root = document.documentElement;
      const viewportHeight = window.innerHeight;

      // Different speeds for each layer (background to foreground)
      // Negative values make layers move up as you scroll down (parallax effect)
      // Layer 1 (background) moves slowest, Layer 4 (foreground) moves fastest
      // Increased multipliers for more noticeable effect
      root.style.setProperty('--parallax-1', `${-scrollY * 0.05}px`);
      root.style.setProperty('--parallax-2', `${-scrollY * 0.07}px`);
      root.style.setProperty('--parallax-3', `${-scrollY * 0.09}px`);

      // Layer 4 (foreground) - limit max scroll to -100vh so the bottom color section stays visible
      const parallax4Value = -scrollY * 0.11;
      const maxParallax4 = -viewportHeight; // Stop when image has scrolled up by 100vh
      const cappedParallax4 = Math.max(parallax4Value, maxParallax4);
      root.style.setProperty('--parallax-4', `${cappedParallax4}px`);
    };

    // Set initial values
    handleScroll();

    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  return <div className="fixed inset-0 bg-[#0b121bd0] z-[-1000] pointer-events-none" />;
}
