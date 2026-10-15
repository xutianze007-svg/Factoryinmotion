declare module 'n8ao' {
  import type { Pass } from 'postprocessing';
  import type { Camera, Color, Scene } from 'three';
  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: {
      aoRadius: number;
      distanceFalloff: number;
      intensity: number;
      color: Color;
      gammaCorrection: boolean;
      halfRes: boolean;
      screenSpaceRadius: boolean;
      [k: string]: unknown;
    };
    setQualityMode(mode: string): void;
    setSize(width: number, height: number): void;
  }
}
