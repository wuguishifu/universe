'use client';

import { useEffect, useRef } from 'react';
import { quickLinkClassName } from './links-section';

const highlightClassName = 'links-section-highlight';

export function LinksHighlighter() {
  const timeouts = useRef<
    Record<
      string,
      {
        timeoutId: NodeJS.Timeout;
        element: Element;
      }
    >
  >({});

  useEffect(() => {
    const allLinks = document.getElementsByClassName(quickLinkClassName);

    function highlightLink() {
      const randomIndex = Math.floor(Math.random() * allLinks.length);
      const randomLink = allLinks[randomIndex];
      if (!randomLink) return;

      randomLink.classList.add(highlightClassName);
      const timeout = setTimeout(() => {
        randomLink.classList.remove(highlightClassName);
        const { [randomLink.textContent]: _, ...rest } = timeouts.current;
        timeouts.current = rest;
      }, 2000);
      timeouts.current[randomLink?.textContent] = {
        timeoutId: timeout,
        element: randomLink,
      };
    }

    highlightLink();
    const interval = setInterval(() => {
      highlightLink();
    }, 5000);

    return () => {
      clearInterval(interval);
      Object.values(timeouts.current).forEach(({ timeoutId, element }) => {
        clearTimeout(timeoutId);
        element.classList.remove(highlightClassName);
      });
    };
  }, []);

  return null;
}
