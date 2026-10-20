import styles from "./grid-space.module.css";

/** The workspace's grid floor in plain CSS, used when there is no 3D scene to put it in. */
export function GridSpace() {
  return (
    <div className={styles.space} aria-hidden="true">
      <div className={styles.horizon} />
      <div className={styles.floor} />
    </div>
  );
}
