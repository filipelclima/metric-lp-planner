/**
 * Page transition between Planner / Top pools / Portfolio / Compare. The template remounts on navigation, so the
 * CSS animation (fade + 6px slide, 180ms; fade only with reduced motion) replays. Pure CSS: the server HTML is
 * never hidden waiting for JS.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-in">{children}</div>;
}
