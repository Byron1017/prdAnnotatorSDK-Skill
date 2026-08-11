export function observeNavigation(window, onRouteChange) {
  const { history } = window;
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  const notify = () => onRouteChange({
    pathname: window.location.pathname,
    hash: window.location.hash
  });

  history.pushState = function (...args) {
    const result = originalPush.apply(this, args);
    notify();
    return result;
  };
  history.replaceState = function (...args) {
    const result = originalReplace.apply(this, args);
    notify();
    return result;
  };
  window.addEventListener("popstate", notify);
  window.addEventListener("hashchange", notify);

  return () => {
    history.pushState = originalPush;
    history.replaceState = originalReplace;
    window.removeEventListener("popstate", notify);
    window.removeEventListener("hashchange", notify);
  };
}
