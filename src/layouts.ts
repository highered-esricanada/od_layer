export interface IAttribute {
  name: string;
  size: number;
  type: number;
  normalized: boolean;
  stride: number;
  offset: number;
}

export type VertexLayout = (gl: WebGLRenderingContext) => IAttribute[];

export const P = (gl: WebGLRenderingContext) => [
  {
    name: "a_position",
    size: 3,
    type: gl.FLOAT,
    normalized: false,
    stride: 12,
    offset: 0
  }
];

export const PS = (gl: WebGLRenderingContext) => [
  {
    name: "a_position",
    size: 3,
    type: gl.FLOAT,
    normalized: false,
    stride: 16,
    offset: 0
  },
  {
    name: "a_scalar",
    size: 1,
    type: gl.FLOAT,
    normalized: false,
    stride: 16,
    offset: 12
  }
];

export const PO = (gl: WebGLRenderingContext) => [
  {
    name: "a_position",
    size: 3,
    type: gl.FLOAT,
    normalized: false,
    stride: 20,
    offset: 0
  },
  {
    name: "a_offset",
    size: 2,
    type: gl.FLOAT,
    normalized: false,
    stride: 20,
    offset: 12
  }
];

export const POR = (gl: WebGLRenderingContext) => [
  {
    name: "a_position",
    size: 3,
    type: gl.FLOAT,
    normalized: false,
    stride: 36,
    offset: 0
  },
  {
    name: "a_offset",
    size: 2,
    type: gl.FLOAT,
    normalized: false,
    stride: 36,
    offset: 12
  },
  {
    name: "a_random",
    size: 4,
    type: gl.FLOAT,
    normalized: false,
    stride: 36,
    offset: 20
  }
];

export const PTOR = (gl: WebGLRenderingContext) => [
  {
    name: "a_position",
    size: 3,
    type: gl.FLOAT,
    normalized: false,
    stride: 44,
    offset: 0
  },
  {
    name: "a_texcoord",
    size: 2,
    type: gl.FLOAT,
    normalized: false,
    stride: 44,
    offset: 12
  },
  {
    name: "a_offset",
    size: 3,
    type: gl.FLOAT,
    normalized: false,
    stride: 44,
    offset: 20
  },
  {
    name: "a_random",
    size: 3,
    type: gl.FLOAT,
    normalized: false,
    stride: 44,
    offset: 32
  }
];
