function trackEvent(eventName, props) {
  if (typeof window === "undefined") return;
  if (!window.plausible) return;
  window.plausible(eventName, props ? { props } : undefined);
}

window.trackEvent = trackEvent;
