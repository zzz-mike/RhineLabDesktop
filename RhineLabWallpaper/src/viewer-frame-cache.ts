import * as THREE from 'three';
import { RenderState } from './render-state.ts';
/** Conservative cache of rendered inputs. Animation simulation continues every frame. */
export class ViewerFrameCache {
  private state = new RenderState();
  private lastDraw = -Infinity;
  invalidate() { this.state.invalidate(); }
  shouldRender(scene: THREE.Scene, camera: THREE.PerspectiveCamera, inputs: (number|string)[], time: number) {
    const state = this.state;
    scene.updateMatrixWorld(); camera.updateMatrixWorld();
    state.begin(); state.add(...inputs);
    state.floats(...camera.projectionMatrix.elements, ...camera.matrixWorldInverse.elements);
    scene.traverse(object => {
      state.add(object.id, Number(object.visible));
      // Compare the actual float32 transform reaching the shader, including camera movement.
      if (object instanceof THREE.Mesh) {
        object.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, object.matrixWorld);
        state.floats(...object.modelViewMatrix.elements);
        state.add(object.geometry.id);
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          // Renderer mutates material.version for double-sided transmission; don't track it.
          const m = material as THREE.MeshPhysicalMaterial;
          state.add(m.uuid, m.map?.uuid, m.map?.version, m.normalMap?.version);
          state.floats(m.opacity, m.roughness, m.metalness, m.transmission, m.thickness, m.clearcoat, m.color?.r, m.color?.g, m.color?.b);
        }
      }
    });
    const changed = state.end();
    // A low-frequency refresh is a conservative fallback for future upstream inputs.
    if (!changed && time - this.lastDraw < 1) return false;
    this.lastDraw = time; return true;
  }
}
