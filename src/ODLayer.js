define([
  "esri/core/watchUtils",
  "esri/core/promiseUtils",

  "esri/geometry/Polyline",

  "esri/tasks/support/FeatureSet",

  "esri/layers/Layer",
  "esri/layers/FeatureLayer",

  "esri/views/2d/layers/BaseLayerViewGL2D",

  "https://cdn.jsdelivr.net/npm/gl-matrix@3.3.0/gl-matrix-min.js"
], function(
  watchUtils,
  promiseUtils,

  Polyline,

  FeatureSet,

  Layer,
  FeatureLayer,

  BaseLayerViewGL2D,

  glMatrix
){

  const vertex_shader_src = `
    // Transforms from map units to pixels.
    uniform mat3 u_transform;

    // Rotates offset vectors in screen space according to map rotation.
    uniform mat3 u_rotation;

    // Transforms from pixels to normalized device coordinates (NDC).
    uniform mat3 u_display;

    // Position of the vertex in map units.
    attribute vec2 a_position;

    // Offset vectors; used to give polylines a thickness in screen space;
    // they are set to (0, 0) for polygons.
    attribute vec2 a_offset;

    // The first component (a_typeAndAntiAlias.x) containst the type of the
    // mesh; it's 0 for polygons and 1 for polylines. The second component
    // (a_typeAndAntiAlias.y) is a value used for antialias for lines; it is
    // set to 0.5 for polygons, which means that we don't care about antialising
    // polygons, while for polylines it is 0.5 on the centerline and 0 and 1 on
    // the edges.
    attribute vec2 a_typeAndAntiAlias;

    // This is the index of the feature in the order provided by the the featureSet.
    attribute float a_index;

    // The a_index value gets copied into this varying and passed to the fragment shader.
    varying float v_columnIndex;

    // The a_typeAndAntiAlias gets copied into this varying and passed to the fragment shader.
    varying vec2 v_typeAndAntiAlias;

    void main() {
      // Rotate the offset vectors.
      vec3 transformedOffset = u_rotation * vec3(a_offset, 0.0);

      // Compute position on the vertex in screen space (pixels).
      vec3 screenPosition = u_transform * vec3(a_position, 1.0) + transformedOffset;

      // Convert position to NDC.
      gl_Position.xy = (u_display * vec3(screenPosition.xy, 1.0)).xy;
      gl_Position.zw = vec2(0.0, 1.0);

      // Copy attributes to varyings for use by the fragment shader.
      v_columnIndex = a_index;
      v_typeAndAntiAlias = a_typeAndAntiAlias;
    }
  `;

  const fragment_shader_src = `
    // Precision qualification is mandatory in fragment shaders.
    precision mediump float;

    // This will be used to index the texture horizontally.
    varying float v_columnIndex;
    varying vec2 v_typeAndAntiAlias;

    // These will be used to index the texture vertically indicates the active
    // zone to use for obtaining colors from a 2D texture.
    uniform float u_activeZoneIndex;

    // Indicates the directionality of the origin/destination rendering
    //   0 == outward (from active zone to others)
    //   1 == inward (to active zone from others)
    uniform float u_renderDirection;

    // Indicates the border should be rendered
    //   0 == no border
    //   1 == border
    uniform float u_renderBorder;

    // The lookup table as a 2D texture.
    uniform sampler2D u_colorTable;

    // The texture is square and the size of the side is equal
    // to the number of features. Current implementation is limited
    // in the number of features it can handle, but should be at
    // least 4096.
    uniform float u_colorTableSize;

    void main() {
      // Lookup value from the active row.
      // We add 0.5 to hit the center of the texel.
      // Also, if the row index was -1, we default the value to 0.
      vec2 activeTexcoords = vec2(
        ((u_renderDirection == 1.0 ? v_columnIndex : u_activeZoneIndex) + 0.5) / u_colorTableSize,
        ((u_renderDirection == 1.0 ? u_activeZoneIndex : v_columnIndex) + 0.5) / u_colorTableSize
      );

      vec4 activeColor = u_activeZoneIndex < 0.0 ? vec4(0.0) :
        (u_activeZoneIndex == v_columnIndex ? vec4(255,255,255,1) : texture2D(u_colorTable, activeTexcoords));

      // The polygon color is a combination of red and green, while the polyline color
      // is always gray (if u_renderBorder == 1)
      vec3 color = mix(vec3(activeColor.r, activeColor.g, activeColor.b), vec3(0.2), v_typeAndAntiAlias.x);

      // Map antialias value to a number between 0 and 1 such that:
      //   0.5  -->  1
      //     0  -->  0
      //     1  -->  0
      // This will have the effect of making all polygons solid and make polylines solid on the centerline
      // and transparent on the edges.
      // If u_renderBorder == 0, then only polygon fill will be rendered, and no polylines:
      float alpha = u_renderBorder == 1.0 ? pow(1.0 - (0.5 - v_typeAndAntiAlias.y) * (0.5 - v_typeAndAntiAlias.y) / 0.25, 1.5) : 1.0 - v_typeAndAntiAlias.x;

      // We use premultiplied alpha, that is, the alpha also multiplies the RGB part.
      gl_FragColor = vec4(color, activeColor.a) * alpha;
    }
  `;

  function standardDeviation(values, avg){
    if (!avg) avg = average(values);

    // return the square root of the average squared difference from the mean:
    return Math.sqrt(average(
      values.map(function(value){
        return Math.pow(value - avg, 2);
      })
    ));
  }

  function average(data){
    return data.reduce(function(sum, value){
      return sum + value;
    }, 0) / data.length;
  }

  function minimum(data)
  {
    return data.reduce(function(max, value){
      return Math.min(max, value);
    }, data[0]);
  }

  function maximum(data)
  {
    return data.reduce(function(max, value){
      return Math.max(max, value);
    }, data[0]);
  }

  // Creates a program from a pair of <script type="text/x-shader"> snippets,
  // with user-defined attribute locations and uniforms.
  function createProgram(gl, vs_src, fs_src, attributes, uniforms) {
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vs_src);
    gl.compileShader(vs);

    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fs_src);
    gl.compileShader(fs);

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);

    for (const locationName in attributes) {
      gl.bindAttribLocation(program, attributes[locationName], locationName);
    }

    gl.linkProgram(program);

    const uniformLocations = {};

    for (const uniformName of uniforms) {
      uniformLocations[uniformName] = gl.getUniformLocation(program, uniformName);
    }

    gl.deleteShader(vs);
    gl.deleteShader(fs);

    return {
      program: program,
      attributes: attributes,
      uniforms: uniformLocations
    }
  }

  // Subclasses the custom layer view from BaseLayerViewGL2D.
  const ODLayerView2D = BaseLayerViewGL2D.createSubclass({
    properties: {
      color_table: {}
    },

    constructor: function(props) {

      // Transforms from map units to pixels.
      this.transform = glMatrix.mat3.create();

      // Rotates offset vectors in screen space according to map rotation.
      this.rotation = glMatrix.mat3.create();

      // Transforms from pixels to NDC.
      this.display = glMatrix.mat3.create();

       // Represents a half-screen translation in pixels.
      this.screenTranslation = glMatrix.vec2.create();

      // A translation vector from the current center of the view in map units
      // to the local origin of the geometry; the position of a vertex of a feature
      // in map units is given by its encoded position in the vertex buffers, plus
      // this vector; note that we never carry out this addition in the shader
      // program, because it would be too imprecise on 32-bit floating point
      // hardware; instead we use this vector to translate the `transform` matrix
      // so that its components become smaller and more manageable using the
      // limited precision available.
      this.translationToCenter = glMatrix.vec2.create();

      // Whether the vertex and index buffers need to be updated
      // due to a change in the layer data.
      this.needsUpdate = false;

      // This is used to abort the actions initiated by clicks and hovering when
      // a new event occurs before the original has completed.
      this.abortControllers = {
        hover: null,
        click: null
      };

      this.inMemoryFeatureLayer = new FeatureLayer({
        source: props.layer.zone_boundaries.features,
        fields: props.layer.zone_boundaries.fields,
        objectIdField: "OBJECTID",
        geometryType: "polygon"
      });

      const updateFeatures = this.updateFeatures.bind(this);
      const requestRender = this.requestRender.bind(this);
      const updateColorTable = this.updateColorTable.bind(this);

      this.watch_zone_boundaries = this.watch("layer.zone_boundaries", updateFeatures);
      this.watch_active_zone_id = this.watch("layer.active_zone_id", requestRender);
      this.watch_color_table = this.watch("color_table", requestRender);
      this.watch_zone_data = this.watch('layer.zone_data', updateColorTable);
      this.watch_render_direction = this.watch('layer.render_direction_outward', requestRender);
      this.watch_render_color = this.watch('layer.render_color', function(){ updateColorTable(true); })
    },

    // We listen for changes to the zone_boundaries of the layer
    // and trigger the generation of new frames. A frame rendered while
    // `needsUpdate` is true may cause an update of the vertex and
    // index buffers.
    updateFeatures: function(arguments) {
      // Tessellate graphics.
      this.promises = [];

      // For each polygon we tessellate a polygon mesh...
      this.layer.zone_boundaries.features.forEach(function (g, index) {
        this.promises.push(
          this.tessellatePolygon(g.geometry).then(function(mesh) {
            return {
              mesh: mesh,
              type: "polygon",
              rowIndex: index
            };
          })
        );
      }.bind(this));

      // ...and the associated polyline.
      this.layer.zone_boundaries.features.forEach(function (g, index) {
        const polylineGeometry = new Polyline({
          spatialReference: g.geometry.spatialReference,
          paths: g.geometry.rings
        });

        this.promises.push(
          this.tessellatePolyline(polylineGeometry, 1.5).then(function(mesh) {
            return {
              mesh: mesh,
              type: "polyline",
              rowIndex: index
            };
          })
        );
      }.bind(this));

      promiseUtils.all(this.promises).then(
        function(items) {
          this.items = items;
          this.needsUpdate = true;
          this.requestRender();
        }.bind(this)
      );
    },

    // When the layer.zone_data property is updated, this will be triggered.
    // It can also be called if other options are updated that affect how
    // colours should be defined.
    updateColorTable: function(force) {

      // If no data are loaded, do nothing...
      if (!this.layer.zone_data) return;

      // If we already have a colour table, do not re-generate it unless forced
      if (!!this.color_table && !force) return;

      // If the zone_data are new or changed, then a copy of the
      // raw values in a simple array will be extracted for calculating stats.
      // Otherwise
      if (this.last_zone_data !== this.layer.zone_data) {
        this.last_zone_data = this.layer.zone_data;

        // Create a lookup that relates a zone ID to its index in the features list
        this.zone_id_feature_index = {};
        for (let idx = 0; idx < this.layer.zone_boundaries.features.length; idx++) {
          this.zone_id_feature_index[this.layer.zone_boundaries.features[idx].attributes[this.layer.zone_id_column]] = idx;
        }

        // Create a lookup that relates a zone ID to its index in the O/D data matrix
        this.zone_id_data_index = {};
        for (let idx = 0; idx < this.last_zone_data.zone_ids.length; idx++) {
          this.zone_id_data_index[this.last_zone_data.zone_ids[idx]] = idx;
        }

        this.zone_values = [].concat.apply([], this.last_zone_data.data);
      }

      const color_table = [];
      if (!this.layer.render_midpoint && this.layer.render_midpoint !==0) {
        const mean = average(this.zone_values);
        const stdev = standardDeviation(this.zone_values, mean);
        const minus1stdev = mean - stdev;
        const plus1stdev = mean + stdev;
        const min = minimum(this.zone_values);
        const max = maximum(this.zone_values);

        for (let from_index = 0; from_index < this.layer.zone_boundaries.features.length; from_index++) {
          const from_zone = this.layer.zone_boundaries.features[from_index];

          for (let to_index = 0; to_index < this.layer.zone_boundaries.features.length; to_index++) {
            const to_zone = this.layer.zone_boundaries.features[to_index];

            // Get the o/d matrix value that correspondes to the current pair of zones
            const cell_value = this.last_zone_data.data[
              this.zone_id_data_index[from_zone.attributes[this.layer.zone_id_column]]
            ][
              this.zone_id_data_index[to_zone.attributes[this.layer.zone_id_column]]
            ];

            const src_color = this.layer.render_color || {r: 255, g: 0, b: 0, a: 1};
            const multiplier = 1-(cell_value - minus1stdev)/(plus1stdev - minus1stdev);
            color_table.push(
              src_color.r * multiplier > 255 ? 255 : Math.max(src_color.r * multiplier, 0),
              src_color.g * multiplier > 255 ? 255 : Math.max(src_color.g * multiplier, 0),
              src_color.b * multiplier > 255 ? 255 : Math.max(src_color.b * multiplier, 0),
              src_color.a * multiplier > 1 ? 1 : Math.max(src_color.a * multiplier, 0)
            );
          }
        }

        this.color_table = color_table;
        this.layer.zone_render_values = {
          minus1stdev: minus1stdev,
          plus1stdev: plus1stdev,
          min: min,
          max: max,
          mean: mean
        }
        this.layer.zone_colors = this.color_table;

      } else {
        const above_values = this.zone_values.filter(function(value){ return value > this.layer.render_midpoint; }, this);
        const below_values = this.zone_values.filter(function(value){ return value < this.layer.render_midpoint; }, this);

        const above_mean = average(above_values);
        const above_stdev = standardDeviation(above_values, above_mean);
        const above_minus1stdev = above_mean - above_stdev;
        const above_plus1stdev = above_mean + above_stdev;
        const above_min = minimum(above_values);
        const above_max = maximum(above_values);

        const below_mean = average(below_values);
        const below_stdev = standardDeviation(below_values, below_mean);
        const below_minus1stdev = below_mean - below_stdev;
        const below_plus1stdev = below_mean + below_stdev;
        const below_min = minimum(below_values);
        const below_max = maximum(below_values);

        for (let from_index = 0; from_index < this.layer.zone_boundaries.features.length; from_index++) {
          const from_zone = this.layer.zone_boundaries.features[from_index];

          for (let to_index = 0; to_index < this.layer.zone_boundaries.features.length; to_index++) {
            const to_zone = this.layer.zone_boundaries.features[to_index];

            // Get the o/d matrix value that correspondes to the current pair of zones
            const cell_value = this.last_zone_data.data[
              this.zone_id_data_index[from_zone.attributes[this.layer.zone_id_column]]
            ][
              this.zone_id_data_index[to_zone.attributes[this.layer.zone_id_column]]
            ];

            if (cell_value > this.layer.render_midpoint) {
              const src_color = this.layer.render_color.above || {r: 255, g: 0, b: 0, a: 1};
              const multiplier = (cell_value - this.layer.render_midpoint)/(above_plus1stdev - this.layer.render_midpoint);
              //const multiplier = (cell_value - above_minus1stdev)/(above_plus1stdev - above_minus1stdev);

              color_table.push(
                src_color.r * multiplier > 255 ? 255 : Math.max(src_color.r * multiplier, 0),
                src_color.g * multiplier > 255 ? 255 : Math.max(src_color.g * multiplier, 0),
                src_color.b * multiplier > 255 ? 255 : Math.max(src_color.b * multiplier, 0),
                src_color.a * multiplier > 1 ? 1 : Math.max(src_color.a * multiplier, 0)
              );
            } else {
              const src_color = this.layer.render_color.below || {r: 0, g: 0, b: 255, a: 1};
              const multiplier = 1-(cell_value - below_minus1stdev)/(this.layer.render_midpoint - below_minus1stdev);
              //const multiplier = 1-(cell_value - below_minus1stdev)/(below_plus1stdev - below_minus1stdev);

              color_table.push(
                src_color.r * multiplier > 255 ? 255 : Math.max(src_color.r * multiplier, 0),
                src_color.g * multiplier > 255 ? 255 : Math.max(src_color.g * multiplier, 0),
                src_color.b * multiplier > 255 ? 255 : Math.max(src_color.b * multiplier, 0),
                src_color.a * multiplier > 1 ? 1 : Math.max(src_color.a * multiplier, 0)
              );
            }
          }
        }

        this.color_table = color_table;
        this.layer.zone_render_values = {
          above: {
            minus1stdev: above_minus1stdev,
            plus1stdev: above_plus1stdev,
            min: above_min,
            max: above_max,
            mean: above_mean,
            count: above_values.length
          },
          below: {
            minus1stdev: below_minus1stdev,
            plus1stdev: below_plus1stdev,
            min: below_min,
            max: below_max,
            mean: below_mean,
            count: below_values.length
          }
        };
        this.layer.zone_colors = this.color_table;
      }

      this.requestRender();

      this.layer.emit('color-table-updated');
    },

    // Called once a custom layer is added to the map.layers collection and this layer view is instantiated.
    attach: function(a) {
      const gl = this.context;

      // Create the vertex and index buffer. They are initially empty. We need to track the
      // size of the index buffer because we use indexed drawing.
      this.vertexBuffer = gl.createBuffer();
      this.indexBuffer = gl.createBuffer();

      // Number of indices in the index buffer.
      this.indexBufferSize = 0;

      // When certain conditions occur, we update the buffers and re-compute and re-encode
      // all the attributes. When buffer update occurs, we also take note of the current center
      // of the view state, and we reset a vector called `translationToCenter` to [0, 0], meaning that the
      // current center is the same as it was when the attributes were recomputed.
      this.centerAtLastUpdate = glMatrix.vec2.fromValues(
        this.view.state.center[0],
        this.view.state.center[1]
      );

      // Creates the shader program.
      this.featuresProgram = createProgram(
        gl,
        this.vertex_shader_src || vertex_shader_src,
        this.fragment_shader_src || fragment_shader_src,
        {
          a_position: 0,
          a_offset: 1,
          a_typeAndAntiAlias: 2,
          a_index: 3
        },
        [
          "u_transform",
          "u_rotation",
          "u_display",
          "u_activeZoneIndex",
          "u_renderDirection",
          "u_renderBorder",
          "u_colorTableSize",
          "u_colorTable"
        ]
      );

      // Handle hovering.
      this.watch_mapview_hover = this.view.on("pointer-move", function (event) {
        const mapPoint = this.view.toMap({x: event.x, y: event.y});
        this.updateVisualization("hover", mapPoint);
      }.bind(this));

      // Handle clicks.
      this.watch_mapview_click = this.view.on("click", function (event) {
        if (event.button === 0 && !this.hover_enabled) {
          const mapPoint = this.view.toMap({x: event.x, y: event.y});
          this.updateVisualization("click", mapPoint);
        }
      }.bind(this));

      this.updateColorTable();
    },

    // Called once a custom layer is removed from the map.layers collection and this layer view is destroyed.
    detach: function() {
      // // Stop watching layer properties.
      // this.watch_zone_boundaries.remove();
      // this.watch_active_zone_id.remove();
      // this.watch_zone_data.remove();
      // this.watch_render_direction.remove();
      this.watch_mapview_click.remove();
      this.watch_mapview_hover.remove();
      this.watch_mapview_double_click.remove();

      const gl = this.context;

      // Delete buffers and programs.
      gl.deleteBuffer(this.vertexBuffer);
      gl.deleteBuffer(this.indexBuffer);
      gl.deleteProgram(this.featuresProgram);
    },

    // Updates the texture when the table changes on the layer.
    _updateTextureTable: function (gl) {
      if (this._lastColorTable === this.color_table) {
        return;
      }

      this._lastColorTable = this.color_table;

      gl.deleteTexture(this._textureTable);
      this._textureTable = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._textureTable);
      const size = Math.sqrt(this._lastColorTable.length / 4);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(this._lastColorTable));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    },

    // Called every time a frame is rendered.
    render: function(renderParameters) {

      // Do nothing if there is no zone data.
      if (!this.layer.zone_data) return;

      const gl = renderParameters.context;
      const state = renderParameters.state;

      this._updateTextureTable(gl);

      // Update vertex positions. This may trigger an update of
      // the vertex coordinates contained in the vertex buffer.
      // There are three kinds of updates:
      //  - Modification of the layer.graphics collection ==> Buffer update
      //  - The view state becomes non-stationary ==> Only view update, no buffer update
      //  - The view state becomes stationary ==> Buffer update
      this.updatePositions(renderParameters);

      // If there is nothing to render we return.
      if (this.indexBufferSize === 0) {
        return;
      }

      // Update view `transform` matrix.
      glMatrix.mat3.identity(this.transform);
      this.screenTranslation[0] = (state.pixelRatio * state.size[0]) / 2;
      this.screenTranslation[1] = (state.pixelRatio * state.size[1]) / 2;
      glMatrix.mat3.translate(
        this.transform,
        this.transform,
        this.screenTranslation
      );
      glMatrix.mat3.rotate(
        this.transform,
        this.transform,
        (Math.PI * state.rotation) / 180
      );
      glMatrix.mat3.scale(this.transform, this.transform, [
        state.pixelRatio / state.resolution,
        -state.pixelRatio / state.resolution
      ]);
      glMatrix.mat3.translate(this.transform, this.transform, this.translationToCenter);

      // Update view `rotation` matrix.
      glMatrix.mat3.identity(this.rotation);
      glMatrix.mat3.rotate(
        this.rotation,
        this.rotation,
        (Math.PI * state.rotation) / 180
      );

      // Update view `display` matrix; it converts from pixels to normalized device coordinates.
      glMatrix.mat3.identity(this.display);
      glMatrix.mat3.translate(this.display, this.display, [-1, 1]);
      glMatrix.mat3.scale(this.display, this.display, [
        2 / (state.pixelRatio * state.size[0]),
        -2 / (state.pixelRatio * state.size[1])
      ]);

      // Bind and configure the program.
      gl.useProgram(this.featuresProgram.program);
      gl.uniformMatrix3fv(this.featuresProgram.uniforms.u_transform, false, this.transform);
      gl.uniformMatrix3fv(this.featuresProgram.uniforms.u_rotation, false, this.rotation);
      gl.uniformMatrix3fv(this.featuresProgram.uniforms.u_display, false, this.display);
      const active_zone_index = this.layer.active_zone_id != null ? this.zone_id_feature_index[this.layer.active_zone_id] : -1;
      gl.uniform1f(this.featuresProgram.uniforms.u_activeZoneIndex, active_zone_index);
      gl.uniform1f(this.featuresProgram.uniforms.u_renderDirection, this.layer.render_direction_outward ? 1 : 0);
      gl.uniform1f(this.featuresProgram.uniforms.u_renderBorder, this.layer.render_border ? 1 : 0);
      gl.uniform1f(this.featuresProgram.uniforms.u_colorTableSize, Math.sqrt(this.color_table.length / 4));
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._textureTable);
      gl.uniform1i(this.featuresProgram.uniforms.u_colorTable, 0);

      // Bind and configure buffers.
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      gl.enableVertexAttribArray(this.featuresProgram.attributes.a_position);
      gl.enableVertexAttribArray(this.featuresProgram.attributes.a_offset);
      gl.enableVertexAttribArray(this.featuresProgram.attributes.a_typeAndAntiAlias);
      gl.enableVertexAttribArray(this.featuresProgram.attributes.a_index);
      gl.vertexAttribPointer(this.featuresProgram.attributes.a_position, 2, gl.FLOAT, false, 28, 0);
      gl.vertexAttribPointer(this.featuresProgram.attributes.a_offset, 2, gl.FLOAT, false, 28, 8);
      gl.vertexAttribPointer(this.featuresProgram.attributes.a_typeAndAntiAlias, 2, gl.FLOAT, false, 28, 16);
      gl.vertexAttribPointer(this.featuresProgram.attributes.a_index, 1, gl.FLOAT, false, 28, 24);

      // Enable premultiplied alpha blending.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      // Draw all polygons and polylines with a single draw call.
      gl.drawElements(
        gl.TRIANGLES,
        this.indexBufferSize,
        gl.UNSIGNED_INT,
        0
      );
    },

    // Called when the user clicks with the left mouse button or hovers.
    updateVisualization: function(action, mapPoint) {
      // Abort pending action.
      if (this.abortControllers[action]) {
        this.abortControllers[action].abort();
      }

      // Re-create the abort controller.
      this.abortControllers[action] = promiseUtils.createAbortController();

      // Query the polygon under the mouse pointer.
      this.inMemoryFeatureLayer.queryFeatures({
        geometry: mapPoint,
        spatialRelationship: "intersects",
        outFields: [this.layer.zone_id_column]
      }, {
        signal: this.abortControllers[action].signal
      }).then((result) => {
        this.abortControllers[action] = null;

        const feature = result && result.features && result.features[0];

        if (!feature) {
          return;
        }


        if (action == "hover" && this.layer.hover_enabled) {
          this.layer.active_zone_id = feature.attributes[this.layer.zone_id_column];
        } else if (action === "click" && this.layer.click_enabled) {
          this.layer.active_zone_id = feature.attributes[this.layer.zone_id_column];
        }
      })
      .catch((error) => {
        if (!promiseUtils.isAbortError(error)) {
          throw error;
        }
      });
    },

    // Called internally from render().
    updatePositions: function(renderParameters) {
      const gl = renderParameters.context;
      const stationary = renderParameters.stationary;
      const state = renderParameters.state;

      // If we are not stationary we simply update the `translationToCenter` vector.
      if (!stationary) {
        glMatrix.vec2.sub(
          this.translationToCenter,
          this.centerAtLastUpdate,
          state.center
        );
        this.requestRender();
        return;
      }

      // If we are stationary, the `layer.zone_boundaries` collection has not changed, and
      // we are centered on the `centerAtLastUpdate`, we do nothing.
      if (
        !this.needsUpdate &&
        this.translationToCenter[0] === 0 &&
        this.translationToCenter[1] === 0
      ) {
        return;
      }

      // Otherwise, we record the new encoded center, which implies a reset of the `translationToCenter` vector,
      // we record the update time, and we proceed to update the buffers.
      this.centerAtLastUpdate.set(state.center);
      this.translationToCenter[0] = 0;
      this.translationToCenter[1] = 0;
      this.needsUpdate = false;

      // Allocate vertex and index buffers.
      const vertexCount = this.items.reduce(function(vertexCount, item) {
        return vertexCount + item.mesh.vertices.length;
      }, 0);
      const indexCount = this.items.reduce(function(indexCount, item) {
        return indexCount + item.mesh.indices.length;
      }, 0);
      const vertexData = new Float32Array(vertexCount * 7);
      const indexData = new Uint32Array(indexCount);
      let currentVertex = 0;
      let currentIndex = 0;

      for (const item of this.items) {
        // Write indices.
        for (let i = 0; i < item.mesh.indices.length; ++i) {
          const idx = item.mesh.indices[i];
          indexData[currentIndex] = currentVertex + idx;
          currentIndex++;
        }

        // Write vertices.
        for (let i = 0; i < item.mesh.vertices.length; ++i) {
          const v = item.mesh.vertices[i];
          vertexData[currentVertex * 7 + 0] = v.x - this.centerAtLastUpdate[0];
          vertexData[currentVertex * 7 + 1] = v.y - this.centerAtLastUpdate[1];
          vertexData[currentVertex * 7 + 2] = v.xOffset;
          vertexData[currentVertex * 7 + 3] = v.yOffset;
          vertexData[currentVertex * 7 + 4] = item.type === "polygon" ? 0 : 1;
          vertexData[currentVertex * 7 + 5] = item.type === "polygon" ? 0.5 : v.vTexcoord;
          vertexData[currentVertex * 7 + 6] = item.rowIndex;
          currentVertex++;
        }
      }

      // Uploads data to the GPU
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexData, gl.STATIC_DRAW);

      // Records number of indices.
      this.indexBufferSize = indexCount;
    }
  });

  return Layer.createSubclass({
    properties: {
      zone_boundaries: {
        type: FeatureSet
      },
      zone_id_column: {},  // Name of the column/attribute that will be used to identify zones (does not need to be unique per polygon)
      zone_data: {},  // an object with two properties: data: a 2-dimensional array of values for representing traveling from each origin zone (rows) to all destination zones (columns), zone_ids (a list of zone_ids that are in the same order as rows/columns of the data)
      active_zone_id: {}, // The id of the currently active zone
      render_direction_outward: {}, // If true, will render travel from selected zone to all others.  If false, will render travel to selected zone from all others.
      render_color: {}, // A colour object that is used for the lowest time, lowest cost, etc.  (e.g., for red: {r:255, g:0, b: 0, a: 1}).  If render_midpoint is set (below), it could be an object with two properties 'above' and 'below' that contain colour objects.
      zone_render_values: {}, // a watchable property that is updated with the min/max/mean of the currently displayed values, plus the plus1stdev/minus1stdev values used for rendering colours.
      zone_colors: {},  // a watchable property that is the lookup used for applying colours to each zone
      render_midpoint: null, // a watchable property - if not null, it is expected to be a numerical value representing the midpoint used for classifying above/below values.
      render_border: false,
      hover_enabled: true,
      click_enabled: true
    },

    constructor() {
      this.active_zone_id = null;
    },

    createLayerView: function(view) {
      if (view.type === "2d") {
        return new ODLayerView2D({
          view: view,
          layer: this
        });
      }
    }
  });
});
