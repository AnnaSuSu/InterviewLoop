import { useEffect, useRef } from "react";

interface ScrollRevealOptions {
  threshold?: number;
  root?: Element | null;
  rootMargin?: string;
}

/**
 * Intersection Observer hook — adds `data-revealed` when element enters viewport once.
 * Pair with `.scroll-reveal` CSS class for the fade-in transition.
 */
export default function useScrollReveal<T extends HTMLElement = HTMLElement>({
  threshold = 0.12,
  root = null,
  rootMargin = "0px",
}: ScrollRevealOptions = {}) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    )?.matches;

    if (reducedMotion || typeof IntersectionObserver === "undefined") {
      el.setAttribute("data-revealed", "");
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.setAttribute("data-revealed", "");
          observer.unobserve(el);
        }
      },
      { threshold, root, rootMargin }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [root, rootMargin, threshold]);

  return ref;
}
