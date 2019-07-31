import { Program } from "./programs";
import { IAttribute, VertexLayout } from "./layouts";
import { createVertexBuffer, createIndexBuffer } from "./misc";

export class VertexBinding {
  private vertexBuffer: WebGLBuffer;
  private attributes: IAttribute[];

  constructor(vertexBuffer: WebGLBuffer, attributes: IAttribute[]) {
    this.vertexBuffer = vertexBuffer;
    this.attributes = attributes;
  }

  bindToProgram(gl: WebGLRenderingContext, program: Program) {
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);

    for (const attribute of this.attributes) {
      const location = program.locations[attribute.name];
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, attribute.size, attribute.type, attribute.normalized, attribute.stride, attribute.offset);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }
}

export class VertexStream {
  private vertexBindings: VertexBinding[];

  constructor(vertexBindings: VertexBinding[]) {
    this.vertexBindings = vertexBindings;
  }

  bindToProgram(gl: WebGLRenderingContext, program: Program) {
    for (let i = 0; i < 8; ++i) {
      gl.disableVertexAttribArray(i);
    }

    for (const binding of this.vertexBindings) {
      binding.bindToProgram(gl, program);
    }
  }
}

export class IndexedVertexStream {
  private vertexStream: VertexStream;
  private indexBuffer: WebGLBuffer;

  constructor(vertexStream: VertexStream, indexBuffer: WebGLBuffer) {
    this.vertexStream = vertexStream;
    this.indexBuffer = indexBuffer;
  }

  bindToProgram(gl: WebGLRenderingContext, program: Program) {
    this.vertexStream.bindToProgram(gl, program);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
  }
}

export interface IGeometry {
  mesh: Mesh;
  draw(gl: WebGLRenderingContext): void;
}

export class Mesh {
  private vertexStream: VertexStream | IndexedVertexStream;
  private vertexBuffer: WebGLBuffer;
  private indexBuffer?: WebGLBuffer;
  private outline: boolean = false;

  constructor(gl: WebGLRenderingContext, vertexLayout: VertexLayout, vertexData: ArrayBuffer, indexData?: ArrayBuffer, outline?: boolean) {
    this.vertexBuffer = createVertexBuffer(gl, vertexData);
    this.outline = !!outline;
    const binding = new VertexBinding(this.vertexBuffer, vertexLayout(gl));
    const vertexStream = new VertexStream([binding]);

    if (indexData) {
      this.indexBuffer = createIndexBuffer(gl, indexData);
      this.vertexStream = new IndexedVertexStream(vertexStream, this.indexBuffer);
    }
    else {
      this.vertexStream = vertexStream;
    }
  }

  bindToProgram(gl: WebGLRenderingContext, program: Program) {
    this.vertexStream.bindToProgram(gl, program);
  }

  dispose(gl: WebGLRenderingContext) {
    gl.deleteBuffer(this.vertexBuffer);
    this.vertexBuffer = null;

    if (this.indexBuffer) {
      gl.deleteBuffer(this.indexBuffer);
      this.indexBuffer = null;
    }

    this.vertexStream = null;
  }

  draw(gl: WebGLRenderingContext, from: number, count: number) {
    this.slice(from, count).draw(gl);
  }

  slice(from: number, count: number): IGeometry {
    return {
      mesh: this,
      draw(gl: WebGLRenderingContext) {
        if (this.mesh.indexBuffer) {
          gl.drawElements(this.mesh.outline ? gl.LINES : gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 2 * from);
        }
        else {
          gl.drawArrays(this.mesh.outline ? gl.LINE_STRIP : gl.TRIANGLES, from, count);
        }
      }
    }
  }
}
