import { Mesh } from "./meshes";
import { PTOR } from "./layouts";

export function createCanopyMesh(gl: WebGLRenderingContext, trees: { x: number, y: number }[], particlesPerTree: number): Mesh {
  const vertexData: number[] = [];
  const indexData: number[] = [];

  for (let i = 0; i < trees.length; ++i) {
    const px = trees[i].x;
    const py = trees[i].y;

    for (let j = 0; j < particlesPerTree; ++j) {
      const r0 = Math.random();
      const r1 = Math.random();
      const r2 = Math.random();

      vertexData.push(
        px, py, 10 * j / particlesPerTree,     0, 0,     -15, -15, 0, r0, r1, r2,
        px, py, 10 * j / particlesPerTree,     1, 0,      15, -15, 0, r0, r1, r2,
        px, py, 10 * j / particlesPerTree,     0, 1,     -15,  15, 0, r0, r1, r2,
        px, py, 10 * j / particlesPerTree,     1, 1,      15,  15, 0, r0, r1, r2,
      );

      const baseVertex = (i * particlesPerTree + j) * 4;

      indexData.push(
        baseVertex + 0, baseVertex + 1, baseVertex + 2,
        baseVertex + 1, baseVertex + 3, baseVertex + 2
      );
    }
  }

  const mesh = new Mesh(gl, PTOR, new Float32Array(vertexData).buffer, new Uint16Array(indexData).buffer);

  return mesh;
}
