//import { loadImage, createTexture, loadJson } from "./misc";
import { Actor } from "./scene";
import { mat4, vec4, vec2, vec3 } from "gl-matrix";
import { Mesh, IGeometry } from "./meshes";
import { Program, Material, ColouredPolygonProgram } from "./programs";
import * as layouts from "./layouts";
//import { createCanopyMesh } from "./geometries";
import { origin } from "./defs";
import earcut from "earcut";

export class Application {
  private initialized = false;
  private disposed = false;
  private colours: any = {
    default: [0.0, 0.0, 0.0, 0.0]
  };
  private outlines: any = {
    default: [0.1, 0.1, 0.1, 0.6]
  };

  private showOutlines: boolean = false;

  // All the objects in the scene
  private actors: Actor[] = [];

  // Per-frame uniforms
  private view: mat4 = mat4.create();
  private project: mat4 = mat4.create();

  // Programs whose per-frame uniforms have been set
  private framePrograms = new Set<Program>();

  // Programs
  private zoneProgram: Program;

  // Geometries
  private zoneFills: any[] = []; // {geometry: IGeometry, zone: number}
  private zoneOutlines: any[] = []; // {geometry: IGeometry, zone: number}

  // Zone FeatureSet
  private zoneFeatureSet: any;

  // Zone identifier attribute
  private zoneIdColumn: string;

  // View - original
  center = vec2.fromValues(0, 0);
  rotation = 0;
  resolution = 1;
  pixelRatio: number;
  size = vec2.fromValues(0, 0);

  // View - processed
  translation = vec3.create();

  constructor(private backgroundColor?: vec4) {
  }

  setColours(colours?: any)
  {
    if (colours) this.colours = colours;

    for (const actor of this.actors) {
      if (actor.zone && !actor.outline) {
        actor.colour = vec4.fromValues.apply(null,this.colours[actor.zone]||this.colours.default);
      }
    }
  }

  setOutlines(outlines?: any)
  {
    if (outlines) this.outlines = outlines;

    for (const actor of this.actors) {
      if (actor.zone && actor.outline) {
        actor.colour = vec4.fromValues.apply(null,this.outlines[actor.zone]||this.outlines.default);
      }
    }
  }

  async load(zoneFeatureSet: any, zoneIdColumn: string, showOutlines: boolean) {
    this.zoneFeatureSet = zoneFeatureSet;
    this.zoneIdColumn = zoneIdColumn;
    this.showOutlines = showOutlines;
  }

  setView(center: [number, number], rotation: number, resolution: number, pixelRatio: number, size: [number, number]) {
    this.center[0] = center[0];
    this.center[1] = center[1];
    this.rotation = rotation;
    this.resolution = resolution;
    this.pixelRatio = pixelRatio;
    this.size[0] = size[0];
    this.size[1] = size[1];
  }

  render(gl: WebGLRenderingContext) {
    if (this.initialized && this.disposed) {
      this.doDispose(gl);
      return;
    }

    if (this.disposed) {
      return;
    }

    if (!this.initialized && !this.disposed) {
      this.doInitialize(gl);
      this.sceneSetup();
    }

    this.doRender(gl);
  }

  dispose() {
    this.disposed = true;
  }

  private sceneSetup() {

    // Zones
    for (let z in this.zoneFills)
    {
      const zone = new Actor(
        this.zoneFills[z].geometry,
        this.zoneProgram,
        null,
        this.zoneFills[z].zone,
        vec4.fromValues.apply(null,this.colours[this.zoneFills[z].zone]||this.colours.default)
      );
      zone.blendMode = "alpha";
      this.actors.push(zone);
    }

    // Zone Outlines
    for (let z in this.zoneOutlines)
    {
      const zone_outline = new Actor(
        this.zoneOutlines[z].geometry,
        this.zoneProgram,
        null,
        this.zoneOutlines[z].zone,
        vec4.fromValues.apply(null,this.outlines[this.zoneOutlines[z].zone]||this.outlines.default),
        true
      );
      zone_outline.blendMode = "add";
      this.actors.push(zone_outline);
    }
  }

  private doInitialize(gl: WebGLRenderingContext) {

    this.zoneProgram = new ColouredPolygonProgram(gl);

    // Load zone geometries
    {
      for (let z in this.zoneFeatureSet.features)
      {
        let zone = this.zoneFeatureSet.features[z].attributes[this.zoneIdColumn];
        let geometry = this.zoneFeatureSet.features[z].geometry;
        let flattened = earcut.flatten(geometry.rings);
        let triangles = earcut(flattened.vertices, flattened.holes, flattened.dimensions);
        let fill_vertices: number[] = [];
        let outline_vertices: number[] = [];

        for (let i = 0; i < flattened.vertices.length; i += 2) {
          let x = flattened.vertices[i + 0] - origin[0];
          let y = flattened.vertices[i + 1] - origin[1];
          fill_vertices.push(x, y, 0, 1);
          if (this.showOutlines) outline_vertices.push(x, y, 0);
        }

        this.zoneFills.push({
          geometry: new Mesh(
            gl,
            layouts.PS,
            new Float32Array(fill_vertices).buffer, new Uint16Array(triangles).buffer
          ).slice(0, triangles.length),
          zone: zone
        });
        if (this.showOutlines) this.zoneOutlines.push({
          geometry: new Mesh(
            gl,
            layouts.P,
            new Float32Array(outline_vertices).buffer, null, true
          ).slice(0, outline_vertices.length/3),
          zone: zone
        });
      }
    }

    // We are done
    this.initialized = true;
  }

  private doRender(gl: WebGLRenderingContext) {

    if (this.backgroundColor) {
      const bg = this.backgroundColor;
      gl.clearColor(bg[0], bg[1], bg[2], bg[3]);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    const near = 0.1;
    const far = 100;

    mat4.identity(this.view);
    mat4.rotateZ(this.view, this.view, -Math.PI * this.rotation / 180);
    this.translation[0] = -(this.center[0] - origin[0]);
    this.translation[1] = -(this.center[1] - origin[1]);
    this.translation[2] = -far;
    mat4.translate(this.view, this.view, this.translation);

    const W = (this.resolution * (this.size[0]) / (far / near));
    const H = (this.resolution * (this.size[1]) / (far / near));
    mat4.frustum(this.project, -W / 2, W / 2, -H / 2, H / 2, near, far);
    gl.viewport(0, 0, this.size[0] * this.pixelRatio, this.size[1] * this.pixelRatio);

    this.framePrograms.clear();

    for (const actor of this.actors) {
      if (actor.blendMode === "opaque") {
        gl.disable(gl.BLEND);
      } else {
        gl.enable(gl.BLEND);

        if (actor.blendMode === "add") {
          gl.blendFunc(gl.ONE, gl.ONE);
        } else if (actor.blendMode === "multiply") {
          gl.blendFunc(gl.ONE, gl.SRC_COLOR);
        }
        else if (actor.blendMode === "alpha") {
          gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        }

        gl.blendEquation(gl.FUNC_ADD);
      }

      const mesh = actor.geometry.mesh;
      const program = actor.program;

      program.use(gl);
      mesh.bindToProgram(gl, program);

      if (!this.framePrograms.has(program)) {
        this.framePrograms.add(program);
        if (!actor.zone) this.updateFrameUniforms(gl, program);
      }

      if (actor.zone)
      {
        this.updateFrameUniforms(gl, program, actor.colour, actor.outline);
      }

      if ("updateMaterial" in program && actor.material) {
        program.updateMaterial(gl, actor.material);
      }

      this.updateActorUniforms(gl, program, actor);

      gl.depthFunc(gl.LEQUAL);
      actor.draw(gl);
    }
  }

  // Dispose WebGL resources
  private doDispose(gl: WebGLRenderingContext) {
    for (const zoneGeometry of this.zoneFills) {
       zoneGeometry.mesh.dispose(gl);
    }
  }

  private updateFrameUniforms(gl: WebGLRenderingContext, program: Program, colour?: vec4, outline?: boolean) {
    if ("updateView" in program) {
      program.updateView(gl, this.view);
    }

    if ("updateProject" in program) {
      program.updateProject(gl, this.project);
    }

    if ("updateColor" in program)
    {
      program.updateColor(gl, colour?colour:(vec4.fromValues.apply(null,(outline?this.outlines:this.colours).default)));
    }
  }

  private updateActorUniforms(gl: WebGLRenderingContext, program: Program, actor: Actor) {
    if ("updateModel" in program) {
      program.updateModel(gl, actor.model);
    }
  }
}
