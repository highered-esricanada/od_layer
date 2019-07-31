// Vertex and fragment shaders for animation and lighting.

// GLSL noise algorithms adapted from https://gist.github.com/patriciogonzalezvivo/670c22f3966e662d2f83.

import { createProgram } from "./misc";
import { mat4, vec3, vec4 } from "gl-matrix";

export type Material = any;

export class BaseProgram {
  private program: WebGLProgram;

  constructor(gl: WebGLRenderingContext, vsSrc: string, fsSrc: string, public locations: {[attributeName: string]: number}) {
    this.program = createProgram(gl, vsSrc, fsSrc, locations);
  }

  use(gl: WebGLRenderingContext) {
    gl.useProgram(this.program);
  }

  protected getUniformLocation(gl: WebGLRenderingContext, name: string) {
    return gl.getUniformLocation(this.program, name);
  }

  dispose(gl: WebGLRenderingContext) {
    gl.deleteProgram(this.program);
  }
}

export abstract class MaterialProgram extends BaseProgram {
  private material: Material;

  updateMaterial(gl: WebGLRenderingContext, material: Material) {
    if (this.material === material) {
      return;
    }

    this.doUpdateMaterial(gl, material);
  }

  protected abstract doUpdateMaterial(gl: WebGLRenderingContext, material: Material): void;
}

export class ColouredPolygonProgram extends MaterialProgram {
  private modelLocation: WebGLUniformLocation;
  private viewLocation: WebGLUniformLocation;
  private projectLocation: WebGLUniformLocation;
  private color: WebGLUniformLocation;

  constructor(gl: WebGLRenderingContext) {
    super(gl, `
      precision highp float;

      attribute vec4 a_position;
      attribute float a_scalar;

      uniform mat4 u_model;
      uniform mat4 u_view;
      uniform mat4 u_project;

      varying vec2 v_position;
      uniform vec4 u_color;

      void main(void) {

        mat4 viewModel = u_view * u_model;
        gl_Position = u_project * viewModel * a_position;

        v_position = a_position.xy;
      }
    `, `
      precision highp float;

      uniform vec4 u_color;

      void main() {
          gl_FragColor = u_color;
      }
    `, {
      "a_position": 0,
      "a_scalar": 1
    });

    this.modelLocation = this.getUniformLocation(gl, "u_model");
    this.viewLocation = this.getUniformLocation(gl, "u_view");
    this.projectLocation = this.getUniformLocation(gl, "u_project");
    this.color = this.getUniformLocation(gl, "u_color");
  }

  updateView(gl: WebGLRenderingContext, view: mat4) {
    gl.uniformMatrix4fv(this.viewLocation, false, view);
  }

  updateModel(gl: WebGLRenderingContext, model: mat4) {
    gl.uniformMatrix4fv(this.modelLocation, false, model);
  }

  updateProject(gl: WebGLRenderingContext, project: mat4) {
    gl.uniformMatrix4fv(this.projectLocation, false, project);
  }

  updateColor(gl: WebGLRenderingContext, color: vec4) {
    gl.uniform4fv(this.color, color);
  }

  protected doUpdateMaterial(gl: WebGLRenderingContext, material: Material): void {

  }
}

export type Program = ColouredPolygonProgram;
