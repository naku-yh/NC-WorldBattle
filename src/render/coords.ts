import * as THREE from 'three';

/** Tile centre in world units. Tile (0,0) is the corner nearest the camera on the left. */
export function worldOf(x: number, y: number, n: number): THREE.Vector3 {
  return new THREE.Vector3(x - (n - 1) / 2, 0, (n - 1) / 2 - y);
}
