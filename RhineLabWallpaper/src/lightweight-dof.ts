import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { SharedDepthAO, SharedDepthBokeh } from './shared-depth';

const vertexShader = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const depthFunctions = `
#include <packing>
uniform sampler2D tDepth;
uniform float nearClip, farClip, focus, aperture, maxblur, width;
varying vec2 vUv;
float distanceAt(vec2 uv) {
  return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, nearClip, farClip);
}
float radiusAt(float z) { return min(abs(focus - z) * aperture, maxblur); }
`;

/** Approximate DOF: one quarter-size, depth-aware blur pass. No glass layer,
 * no additional scene render when AO already provides a hardware depth texture.
 * Keep the original Bokeh path available for visual comparison and rollback.
 */
export class LightweightDOF extends SharedDepthBokeh {
  lightweight = false;
  private blurWidth = 1;
  private blurHeight = 1;
  private fullWidth = 1;
  private fullHeight = 1;
  private blurred = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  private fallbackDepth = new THREE.WebGLRenderTarget(1, 1, { depthTexture: new THREE.DepthTexture(1, 1) });
  private depthMaterial = new THREE.MeshDepthMaterial({ blending: THREE.NoBlending });
  private common = {
    tDepth: { value: null as THREE.Texture | null },
    nearClip: { value: 5 }, farClip: { value: 300 },
    focus: { value: 25 }, aperture: { value: .0018 }, maxblur: { value: .011 }, width: { value: 1 },
  };
  private blur = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    uniforms: { ...this.common, tColor: { value: null as THREE.Texture | null }, aspect: { value: 1 } },
    vertexShader,
    fragmentShader: `${depthFunctions}
uniform sampler2D tColor;
uniform float aspect;
void main() {
  float z = distanceAt(vUv);
  vec2 radius = vec2(1.0, aspect) * radiusAt(z) * .32;
  vec4 color = texture2D(tColor, vUv) * 2.0;
  float weight = 2.0;
  for (int i = 0; i < 8; i++) {
    float angle = float(i) * .785398163;
    float w = 1.0;
    vec2 sampleUV = clamp(vUv + radius * vec2(cos(angle), sin(angle)), vec2(0.0), vec2(1.0));
    // Avoid pulling a sharp foreground cassette into the defocused background.
    float dz = abs(distanceAt(sampleUV) - z);
    w *= 1.0 - smoothstep(max(.7, z * .012), max(1.4, z * .025), dz);
    color += texture2D(tColor, sampleUV) * w;
    weight += w;
  }
  gl_FragColor = color / weight;
}`,
  });
  private composite = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    uniforms: { ...this.common, tSharp: { value: null as THREE.Texture | null }, tBlur: { value: this.blurred.texture } },
    vertexShader,
    fragmentShader: `${depthFunctions}
uniform sampler2D tSharp, tBlur;
void main() {
  float amount = smoothstep(.6, 2.5, radiusAt(distanceAt(vUv)) * width);
  gl_FragColor = mix(texture2D(tSharp, vUv), texture2D(tBlur, vUv), amount);
}`,
  });
  private screenQuad = new FullScreenQuad(this.blur);
  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, private aoSource: () => SharedDepthAO) {
    super(scene, camera, { focus: 25, aperture: .0018, maxblur: .011 }, aoSource);
  }
  setSize(width: number, height: number) {
    super.setSize(width, height);
    this.fullWidth = width; this.fullHeight = height;
    this.blurWidth = Math.max(1, Math.ceil(width / 4));
    this.blurHeight = Math.max(1, Math.ceil(height / 4));
    this.blurred.setSize(this.blurWidth, this.blurHeight);
    // Depth stays half-size when AO is disabled; only the blur is quarter-size.
    this.fallbackDepth.setSize(Math.max(1, Math.ceil(width / 2)), Math.max(1, Math.ceil(height / 2)));
  }
  get metrics() {
    const ao = this.aoSource();
    if (!this.lightweight) return { method: 'original-bokeh', width: this.fullWidth, height: this.fullHeight,
      depthSource: ao.enabled && ao.width === this.fullWidth && ao.height === this.fullHeight ? 'existing-ao-packed-depth' : 'full-resolution-depth-pass' };
    return { method: 'quarter-resolution-depth-blur', width: this.blurWidth, height: this.blurHeight,
      depthSource: ao.enabled ? 'existing-ao-depth' : 'half-resolution-depth-pass' };
  }
  render(renderer: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget, delta: number, mask: boolean) {
    if (!this.lightweight) return super.render(renderer, write, read, delta, mask);
    const autoClear = renderer.autoClear;
    const oldTarget = renderer.getRenderTarget();
    const oldOverride = this.scene.overrideMaterial;
    const oldColor = renderer.getClearColor(new THREE.Color());
    const oldAlpha = renderer.getClearAlpha();
    const oldLayers = this.camera.layers.mask;
    try {
      renderer.autoClear = false;
      const ao = this.aoSource();
      if (ao.enabled) this.common.tDepth.value = ao.normalRenderTarget.depthTexture;
      else {
        // Layer 1 contains only cosmetic projected shadows, never scene depth.
        this.camera.layers.disable(1);
        this.scene.overrideMaterial = this.depthMaterial;
        renderer.setRenderTarget(this.fallbackDepth);
        renderer.setClearColor(0xffffff, 1);
        renderer.clear(); renderer.render(this.scene, this.camera);
        this.scene.overrideMaterial = oldOverride;
        this.camera.layers.mask = oldLayers;
        this.common.tDepth.value = this.fallbackDepth.depthTexture;
      }
      const input = this.uniforms as Record<string, { value: number }>;
      for (const key of ['focus', 'aperture', 'maxblur'] as const) this.common[key].value = input[key].value;
      const camera = this.camera as THREE.PerspectiveCamera;
      this.common.nearClip.value = camera.near; this.common.farClip.value = camera.far;
      this.common.width.value = this.fullWidth;
      this.screenQuad.material = this.blur;
      this.blur.uniforms.tColor.value = read.texture;
      this.blur.uniforms.aspect.value = this.fullWidth / this.fullHeight;
      renderer.setRenderTarget(this.blurred); this.screenQuad.render(renderer);
      this.composite.uniforms.tSharp.value = read.texture;
      this.screenQuad.material = this.composite;
      renderer.setRenderTarget(this.renderToScreen ? null : write); this.screenQuad.render(renderer);
    } finally {
      this.scene.overrideMaterial = oldOverride; this.camera.layers.mask = oldLayers;
      renderer.autoClear = autoClear; renderer.setClearColor(oldColor, oldAlpha); renderer.setRenderTarget(oldTarget);
    }
  }
  dispose() {
    super.dispose(); this.blurred.dispose(); this.fallbackDepth.dispose();
    this.depthMaterial.dispose(); this.blur.dispose(); this.composite.dispose(); this.screenQuad.dispose();
  }
}
