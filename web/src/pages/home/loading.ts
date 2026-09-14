/** Keep offscreen cover requests out of the opening image's network budget. */
export function observeHomepageShowcase(element: Element | null, onVisible: () => void) {
    if (!element || typeof IntersectionObserver === "undefined") {
        onVisible();
        return;
    }
    const observer = new IntersectionObserver(
        (entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            observer.disconnect();
            onVisible();
        },
        { rootMargin: "0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
}
