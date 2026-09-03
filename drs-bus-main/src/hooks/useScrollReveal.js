import { useEffect } from "react";

/**
 * Fades + slides in any element with a data-reveal attribute the first
 * time it enters the viewport. One technique, reused everywhere it's
 * applied — respects prefers-reduced-motion via the CSS in index.css.
 */
export default function useScrollReveal() {
  useEffect(() => {
    const els = document.querySelectorAll("[data-reveal]");

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );

    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
}
