import { performancePlugin, macDisplaySettings } from "./mac-performance";
import { macPixelBudget } from "./mac-pixel-budget";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { renderDimensions, type RenderQuality } from "./render-quality";

export function applyTextureQuality(
  root: THREE.Object3D,
  renderer: THREE.WebGLRenderer,
  quality: RenderQuality,
) {
  const maximum = Math.min(
    quality.anisotropy,
    renderer.capabilities.getMaxAnisotropy(),
  );
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture && !value.isRenderTargetTexture)
          textures.add(value);
      }
    }
  });
  for (const texture of textures) {
    if (texture.anisotropy === maximum) continue;
    texture.anisotropy = maximum;
    texture.needsUpdate = true;
  }
}

export function resizeQuality(
  renderer: THREE.WebGLRenderer,
  composer: EffectComposer,
  host: HTMLElement,
  quality: RenderQuality,
  superPerformance = false,
) {
  const width = Math.max(1, host.clientWidth),
    height = Math.max(1, host.clientHeight);
  const upstreamBudget = superPerformance ? 921_600 : 8_294_400;
  const original = renderDimensions(quality, width, height,
    host.getBoundingClientRect().width / width, devicePixelRatio,
    renderer.capabilities.maxTextureSize, upstreamBudget);
  const display = macDisplaySettings();
  const manual = display?.scale != null;
  const budget = macPixelBudget(quality, performancePlugin('lowLoad'), upstreamBudget, display, devicePixelRatio);
  const dimensions = renderDimensions(budget.quality, width, height,
    host.getBoundingClientRect().width / width, devicePixelRatio,
    renderer.capabilities.maxTextureSize, budget.budget);
  renderer.setPixelRatio(dimensions.ratio);
  renderer.setSize(width, height);
  composer.setPixelRatio(dimensions.ratio);
  composer.setSize(width, height);
  renderer.transmissionResolutionScale = quality.transmission;
  host.dataset.renderQuality = JSON.stringify({
    ...dimensions,
    macLowLoad: !manual && performancePlugin('lowLoad'),
    macManualScale: manual ? display.scale : null,
    originalWidth: original.width, originalHeight: original.height,
    pixelFraction: dimensions.width * dimensions.height / (original.width * original.height),
    antialias: quality.antialias,
    transmission: quality.transmission,
    anisotropy: Math.min(
      quality.anisotropy,
      renderer.capabilities.getMaxAnisotropy(),
    ),
    superPerformance,
  });
  return dimensions;
}

export function createViewerPipeline(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
) {
  const composer = new EffectComposer(renderer);
  const smaa = new SMAAPass();
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(smaa);
  composer.addPass(new OutputPass());
  return { composer, smaa };
}
