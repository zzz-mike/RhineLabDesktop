import * as THREE from 'three';

export const SHADOW_LAYER = 1;
export const SHADOW_FLOOR_Y = -4.618;

/** Directional projection onto the fixed floor. The same transform is evaluated
 * in the vertex shader (four vertices per cassette, no shadow-map render).
 */
export function projectShadowPoint(point: THREE.Vector3, light: THREE.Vector3, target = new THREE.Vector3()) {
  const height = point.y - SHADOW_FLOOR_Y;
  return target.set(point.x - height * light.x / light.y, SHADOW_FLOOR_Y, point.z - height * light.z / light.y);
}

/** A reusable soft silhouette, shared by background and extracted cassettes.
 * Existing AO and surface shading retain contact/detail shading. This explicitly
 * approximates floor shadows; it does not reproduce shadows onto other cassettes.
 */
export class ProjectedShadows {
  readonly group = new THREE.Group();
  private geometry: THREE.PlaneGeometry;
  private material: THREE.MeshBasicMaterial;
  private array?: THREE.InstancedMesh;
  private foreground?: THREE.InstancedMesh;
  private scratch = new THREE.Matrix4();
  constructor(bounds: THREE.Box3, light: THREE.Vector3) {
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    this.geometry = new THREE.PlaneGeometry(size.x + .10, size.y + .08);
    this.geometry.translate(center.x, center.y, center.z);
    this.material = new THREE.MeshBasicMaterial({ color: '#514536', transparent: true, opacity: .24, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, fog: true });
    const slope = new THREE.Vector2(-light.x / light.y, -light.z / light.y);
    this.material.onBeforeCompile = shader => {
      shader.uniforms.shadowSlope = { value: slope };
      shader.vertexShader = 'varying vec2 vShadowUV; varying float vShadowHeight; uniform vec2 shadowSlope;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
        vShadowUV = uv;
        vec4 shadowWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          shadowWorld = instanceMatrix * shadowWorld;
        #endif
        shadowWorld = modelMatrix * shadowWorld;
        vShadowHeight = shadowWorld.y - ${SHADOW_FLOOR_Y};
        shadowWorld.xz += vShadowHeight * shadowSlope;
        shadowWorld.y = ${SHADOW_FLOOR_Y};
        vec4 mvPosition = viewMatrix * shadowWorld;
        gl_Position = projectionMatrix * mvPosition;
      `);
      shader.fragmentShader = 'varying vec2 vShadowUV; varying float vShadowHeight;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <alphamap_fragment>', `
        if (vShadowHeight < 0.0) discard;
        vec2 edge = min(vShadowUV, 1.0 - vShadowUV);
        float softness = clamp(.025 + vShadowHeight * .006, .025, .11);
        diffuseColor.a *= smoothstep(0.0, softness, edge.x) * smoothstep(0.0, softness, edge.y);
        diffuseColor.a *= 1.0 / (1.0 + vShadowHeight * .04);
      `);
    };
    this.material.customProgramCacheKey = () => 'rhine-projected-shadow-v1';
    this.group.name = 'mac-projected-shadows';
  }
  private mesh(capacity: number) {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    mesh.layers.set(SHADOW_LAYER);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(mesh);
    return mesh;
  }
  sync(source: THREE.InstancedMesh | undefined, models: THREE.Group[]) {
    if (source) {
      if (!this.array || this.array.instanceMatrix !== source.instanceMatrix) {
        if (this.array) { this.group.remove(this.array); this.array.dispose(); }
        this.array = this.mesh(source.instanceMatrix.count);
        this.array.instanceMatrix = source.instanceMatrix;
      }
      this.array.count = source.count;
    }
    if (!this.foreground || this.foreground.instanceMatrix.count < models.length) {
      if (this.foreground) { this.group.remove(this.foreground); this.foreground.dispose(); }
      this.foreground = this.mesh(Math.max(8, models.length * 2));
    }
    this.foreground.count = models.length;
    for (let i = 0; i < models.length; i++) {
      // Models live directly under the identity scene; do not depend on a later
      // updateMatrixWorld when syncing extracted/returning cassette transforms.
      this.scratch.compose(models[i].position, models[i].quaternion, models[i].scale);
      this.foreground.setMatrixAt(i, this.scratch);
    }
    this.foreground.instanceMatrix.needsUpdate = true;
  }
}
