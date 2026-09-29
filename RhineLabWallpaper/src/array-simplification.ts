import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { themeMaterial } from './theme-material';

const surface = (mesh: THREE.Mesh) => mesh.userData.surface ??
  (mesh.material as THREE.Material).name.replace(/(?:\.\d+)+$/, '');

/** The source cover has a real cutout under Index_Inlay. Fill it just behind
 * the insert so hiding the insert reveals the cover, not the brown interior.
 * All bundled precision and assembly assets use the same measured slot.
 */
export function fillIndexCutout(source: THREE.BufferGeometry) {
  const patch = new THREE.PlaneGeometry(.25, .224).translate(-2.158977, 3.588, .205);
  const geometry = mergeGeometries([source, patch], false);
  patch.dispose();
  if (!geometry) throw new Error('Unable to fill index cutout');
  return geometry;
}

/** A small deterministic texture, computed once per scene, never per frame.
 * It suggests a matte warm-white panel without sampling the scene behind it.
 * This is a runtime material approximation, not a replacement authored GLB.
 */
export function createMatteCoverTexture(size = 128) {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = y / (size - 1), u = x / (size - 1);
    const lift = THREE.MathUtils.smoothstep(v, .02, .92);
    const edge = Math.min(u, 1 - u, v, 1 - v);
    const grain = (((Math.imul(x + 17, 73856093) ^ Math.imul(y + 31, 19349663)) >>> 0) % 101 / 100 - .5) * .007;
    const level = THREE.MathUtils.clamp(.84 + .15 * lift + .01 * (1 - THREE.MathUtils.smoothstep(edge, 0, .035)) + grain, 0, 1);
    const i = (y * size + x) * 4;
    pixels[i] = Math.round(level * 255);
    pixels[i + 1] = Math.round(level * 254);
    pixels[i + 2] = Math.round(level * 251);
    pixels[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.name = 'mac-array-matte-cover';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export function createMatteCoverGeometry(source: THREE.BufferGeometry) {
  const geometry = source.clone();
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  const width = bounds.max.x - bounds.min.x, height = bounds.max.y - bounds.min.y;
  const position = geometry.getAttribute('position');
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    uv[i * 2] = (position.getX(i) - bounds.min.x) / width;
    uv[i * 2 + 1] = (position.getY(i) - bounds.min.y) / height;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

/** Replace the two existing corner fasteners with capped 12-sided cylinders.
 * Preserve their measured centers/radii/depth; no slots, washers or screw heads.
 * Keep both in one geometry so the instance batch does not gain draw calls.
 */
export function createCylinderFasteners(source: THREE.BufferGeometry, segments = 12) {
  source.computeBoundingBox();
  const bounds = source.boundingBox!;
  const middle = (bounds.min.x + bounds.max.x) / 2;
  const groups = [new THREE.Box3(), new THREE.Box3()];
  const position = source.getAttribute('position'), point = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i);
    groups[point.x < middle ? 0 : 1].expandByPoint(point);
  }
  const cylinders = groups.map(box => {
    if (box.isEmpty()) throw new Error('Expected two corner fastener groups');
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y) / 2;
    if (radius > .25 || radius <= 0 || size.z <= 0) throw new Error('Unexpected fastener bounds');
    const cylinder = new THREE.CylinderGeometry(radius, radius, size.z, segments, 1, false);
    cylinder.rotateX(Math.PI / 2);
    cylinder.translate(center.x, center.y, center.z);
    return cylinder;
  });
  const geometry = mergeGeometries(cylinders, false);
  cylinders.forEach(cylinder => cylinder.dispose());
  if (!geometry) throw new Error('Unable to combine corner fasteners');
  geometry.computeBoundingBox();
  return geometry;
}

type Replacement = {
  mesh: THREE.InstancedMesh;
  originalGeometry: THREE.BufferGeometry;
  geometry: THREE.BufferGeometry;
  originalMaterial: THREE.Material;
  material: THREE.Material;
};

/** Only owns background replacements. Selected/returning/viewer models and
 * CardAppearance's original palettes are deliberately never registered here.
 */
export class ArraySimplification {
  private replacements: Replacement[] = [];
  private texture?: THREE.DataTexture;
  private enabled = false;
  constructor(arrays: THREE.InstancedMesh[], theme: THREE.InstancedBufferAttribute, subduedIndex: { value: number }) {
    for (const mesh of arrays) {
      const name = surface(mesh);
      if (name !== 'Frosted_Polymer' && name !== 'Titanium_Fasteners') continue;
      const originalMaterial = mesh.material as THREE.Material;
      const geometry = name === 'Frosted_Polymer'
        ? createMatteCoverGeometry(mesh.geometry) : createCylinderFasteners(mesh.geometry);
      geometry.setAttribute('archiveTheme', theme);
      let material = originalMaterial;
      if (name === 'Frosted_Polymer') {
        this.texture = createMatteCoverTexture();
        const cover = new THREE.MeshStandardMaterial({
          name: originalMaterial.name,
          color: '#fff7ed', map: this.texture,
          roughness: .58, metalness: 0, envMapIntensity: .35,
          side: THREE.DoubleSide,
        });
        themeMaterial(cover, name, true, subduedIndex);
        material = cover;
      }
      this.replacements.push({mesh, originalGeometry: mesh.geometry, geometry, originalMaterial, material});
    }
  }
  setEnabled(enabled: boolean) {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    for (const entry of this.replacements) {
      const { mesh, geometry, originalGeometry, originalMaterial, material } = entry;
      mesh.userData.arrayGeometryOverride = enabled ? geometry : undefined;
      mesh.geometry = enabled ? geometry : mesh.userData.arrayBaseGeometry ?? originalGeometry;
      if (mesh.geometry.getAttribute('archiveTheme') !== originalGeometry.getAttribute('archiveTheme'))
        mesh.geometry.setAttribute('archiveTheme', originalGeometry.getAttribute('archiveTheme'));
      mesh.material = enabled ? material : originalMaterial;
      mesh.userData.fullMaterial = mesh.material;
      if (mesh.userData.fastMaterial) {
        mesh.userData.fastMaterial.dispose();delete mesh.userData.fastMaterial;
      }
    }
  }
  /** Expansion replaces the shared theme attribute, including inactive geometry. */
  setThemeAttribute(theme: THREE.InstancedBufferAttribute) {
    for (const entry of this.replacements) {
      entry.geometry.setAttribute('archiveTheme', theme);
      entry.originalGeometry.setAttribute('archiveTheme', theme);
    }
  }
  get active() { return this.enabled; }
  get matteCover() { return this.replacements.find(entry => surface(entry.mesh) === 'Frosted_Polymer')?.material as THREE.MeshStandardMaterial | undefined; }
  dispose() {
    for (const entry of this.replacements) {
      entry.geometry.dispose();
      if (entry.material !== entry.originalMaterial) entry.material.dispose();
    }
    this.texture?.dispose();
    this.replacements = [];
  }
}
