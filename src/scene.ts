import { IGeometry } from "./meshes";
import { mat4, vec4 } from "gl-matrix";
import { Program, Material } from "./programs";

export class Actor {
  public model = mat4.create();
  public blendMode: "opaque" | "add" | "multiply" | "alpha" = "opaque";

  constructor(public geometry: IGeometry, public program: Program, public material?: Material, public zone?: number, public colour?: vec4, public outline?: boolean) {
  }

  draw(gl: WebGLRenderingContext) {
    this.geometry.draw(gl);
  }
}
