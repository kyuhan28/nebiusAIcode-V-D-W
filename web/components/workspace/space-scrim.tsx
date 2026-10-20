/**
 * The white grid floor behind 2D views (the call stack stage, the inheritance diagram, the start
 * screen), matching the grid under the 3D scenes. Styles are in app/globals.css.
 */
export function SpaceScrim() {
  return (
    <div className="cv-grid-space" aria-hidden="true">
      <div className="cv-grid-floor" />
    </div>
  );
}
