define([
  "module",

  "esri/core/watchUtils",
  "esri/core/promiseUtils",
  "esri/request",

  "esri/geometry/Polyline",

  "esri/rest/support/FeatureSet",

  "esri/layers/Layer",
  "esri/layers/FeatureLayer",

  "esri/views/2d/layers/BaseLayerViewGL2D",

  "https://cdn.jsdelivr.net/npm/gl-matrix@3.3.0/gl-matrix-min.js"
], function(
  module,

  watchUtils,
  promiseUtils,
  esriRequest,

  Polyline,

  FeatureSet,

  Layer,
  FeatureLayer,

  BaseLayerViewGL2D,

  glMatrix
){
  // Default shaders are in separate files stored in the same location as the
  // ODLayer.js file (having them separate makes it easier to view and edit the
  // WebGL code as C syntax)
  const vertex_shader_url = module.uri.split("/").slice(0,-1).join("/")+"/vertex.shader";
  const fragment_shader_url = module.uri.split("/").slice(0,-1).join("/")+"/fragment.shader";

  // A JSON represntation of the ODMatrix protocol buffer object required as a data source:
  const matrix_proto_url = module.uri.split("/").slice(0,-1).join("/")+"/matrix.proto.json";

  // This will be a promise object that should return the ODMatrix prototype:
  let getODMatrix = new Promise((resolve) => {
    esriRequest(matrix_proto_url, {responseType: "json"}).then(response => {
      let root = protobuf.Root.fromJSON(response.data);
      ODMatrix = root.lookupType("od_layer.ODMatrix");
      resolve(ODMatrix);
    });
  });


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

  function scale255rgb(color) {
    return {r: color.r/255, g: color.g/255, b: color.b/255, a: color.a};
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

      // This will store the max texture size supported by the current device:
      this.maxTextureSize = false;

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
      const updateZoneData = this.updateZoneData.bind(this);
      const updateZoneDataUrl = this.updateZoneDataUrl.bind(this);

      this.watch_zone_boundaries = this.watch("layer.zone_boundaries", updateFeatures);
      this.watch_active_zone_id = this.watch("layer.active_zone_id", requestRender);
      this.watch_color_table = this.watch("color_table", requestRender);
      this.watch_zone_data_url = this.watch("layer.zone_data_url", updateZoneDataUrl);
      this.watch_zone_data = this.watch('layer.zone_data', updateZoneData);
      this.watch_render_direction = this.watch('layer.render_direction_outward', requestRender);
      this.watch_render_from_color = this.watch('layer.render_from_color', requestRender);
      this.watch_render_to_color = this.watch('layer.render_to_color', requestRender);
      this.watch_render_mid_color = this.watch('layer.render_mid_color', requestRender);
      this.watch_render_active_color = this.watch('layer.render_active_color', requestRender);
      this.watch_render_nodata_color = this.watch('layer.render_nodata_color', requestRender);
    },

    // When a new URL is provided for zone data, download it, and decode
    // it usign the ODMatrix protocol buffer.
    updateZoneDataUrl: function() {
      if (!this.layer.zone_data_url) return;

      getODMatrix.then(ODMatrix => {

        fetch(this.layer.zone_data_url).then(
          response => response.arrayBuffer()
        ).then(buffer => {
          this.layer.zone_data = ODMatrix.decode(new Uint8Array(buffer));
        });
      });
    },

    // We listen for changes to the zone_boundaries of the layer
    // and trigger the generation of new frames. A frame rendered while
    // `needsUpdate` is true may cause an update of the vertex and
    // index buffers.
    updateFeatures: function() {
      // Tessellate graphics.
      this.promises = [];

      // For each polygon we tessellate a polygon mesh...
      this.layer.zone_boundaries.features.forEach((g, index) => {
        this.promises.push(
          this.tessellatePolygon(g.geometry).then(mesh => {
            return {
              mesh: mesh,
              type: "polygon",
              rowIndex: index,
              zone_id: g.attributes[this.layer.zone_id_column]
            };
          })
        );
      });

      // ...and the associated polyline.
      this.layer.zone_boundaries.features.forEach((g, index) => {
        const polylineGeometry = new Polyline({
          spatialReference: g.geometry.spatialReference,
          paths: g.geometry.rings
        });

        this.promises.push(
          this.tessellatePolyline(polylineGeometry, this.layer.border_width >= 0 ? this.layer.border_width : 1.5).then(mesh => {
            return {
              mesh: mesh,
              type: "polyline",
              rowIndex: index,
              zone_id: g.attributes[this.layer.zone_id_column]
            };
          })
        );
      });

      promiseUtils.all(this.promises).then(
        items => {
          this.items = items;
          this.needsUpdate = true;
          this.requestRender();
        }
      );
    },

    // When the layer.zone_data property is updated, this will be triggered.
    // It can also be called if other options are updated that affect how
    // colours should be defined.
    updateZoneData: function(force) {

      // If no data are loaded, do nothing...
      if (!this.layer.zone_data) return;

      // If we already have zone rendering values, do not re-generate it unless forced
      if (!!this.zone_render_values && !force) return;

      // If the zone_data are new or changed, update zone ID lookups...
      if (this.last_zone_data !== this.layer.zone_data) {
        this.last_zone_data = this.layer.zone_data;

        // Create a lookup that relates a zone ID to its index in the features list
        this.zone_id_feature_index = {};
        for (let idx = 0; idx < this.layer.zone_boundaries.features.length; idx++) {
          this.zone_id_feature_index[this.layer.zone_boundaries.features[idx].attributes[this.layer.zone_id_column]] = idx;
        }

        // Create lookups that relate zone IDs to their index in the
        // origin/destination ID lists in the OD matrix data object:
        this.origin_id_data_index = {};
        this.destination_id_data_index = {};
        for (let idx = 0; idx < this.last_zone_data.origin_ids.length; idx++) {
          this.origin_id_data_index[this.last_zone_data.origin_ids[idx]] = idx;
        }
        for (let idx = 0; idx < this.last_zone_data.destination_ids.length; idx++) {
          this.destination_id_data_index[this.last_zone_data.destination_ids[idx]] = idx;
        }
      }

      // Get min/max for scaling values between 0 and 1:
      const min = minimum(this.last_zone_data.data);
      const max = maximum(this.last_zone_data.data);

      // Create either a single colour ramp, or colour ramp with a mid-value...
      if (!this.layer.render_mid_value && this.layer.render_mid_value !== 0) {

        // If values are provided for scaling colors, use those...
        if (
          (!!this.layer.render_from_value || this.layer.render_from_value===0) &&
          (!!this.layer.render_to_value || this.layer.render_to_value===0)
        ) {
          this.layer.zone_render_values = {
            scale_from: this.layer.render_from_value,
            scale_to: this.layer.render_to_value,
            scale_mid: (this.layer.render_to_value - this.layer.render_from_value) / 2,
            use_mid: false,
            min: min,
            max: max
          }

        //Otherwise, calculate stats to pick an appropriate min/max...
        } else {
          const num_origins = this.last_zone_data.origin_ids.length;
          const mean = average(this.last_zone_data.data);
          const stdev = standardDeviation(this.last_zone_data.data, mean);
          const minus1stdev = mean - stdev;
          const plus1stdev = mean + stdev;

          this.layer.zone_render_values = {
            scale_from: minus1stdev,
            scale_to: plus1stdev,
            scale_mid: (plus1stdev + minus1stdev)/2,
            use_mid: false,
            min: min,
            max: max
          }
        }
      } else {

        if (
          (!!this.layer.render_from_value || this.layer.render_from_value===0) &&
          (!!this.layer.render_to_value || this.layer.render_to_value===0)
        ) {
          this.layer.zone_render_values = {
            scale_from: this.layer.render_from_value,
            scale_to: this.layer.render_to_value,
            scale_mid: this.layer.render_mid_value,
            use_mid: true,
            min: min,
            max: max
          }
        } else {
          const above_values = this.last_zone_data.data.filter(function(value){ return value > this.layer.render_mid_value; }, this);
          const below_values = this.last_zone_data.data.filter(function(value){ return value < this.layer.render_mid_value; }, this);

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

          this.layer.zone_render_values = {
            scale_from: below_minus1stdev,
            scale_to: above_plus1stdev,
            scale_mid: this.layer.render_mid_value,
            use_mid: true,
            min: min,
            max: max
          };
        }
      }

      this.requestRender();

      this.layer.emit('zone-data-updated');
    },

    // Called once a custom layer is added to the map.layers collection and this layer view is instantiated.
    attach: function(a) {

      const shaders_ready = () => {

        const gl = this.context;

        // Identify the maximum texture size permitted by the device:
        if (!this.maxTextureSize) this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);

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
          this.vertex_shader_src,
          this.fragment_shader_src,
          {
            a_position: 0,
            a_offset: 1,
            a_typeAndAntiAlias: 2,
            a_originIndex: 3,
            a_destinationIndex: 4
          },
          [
            "u_transform",
            "u_rotation",
            "u_display",
            "u_activeZoneIndex",
            "u_renderDirection",
            "u_renderFromValue",
            "u_renderToValue",
            "u_renderMidValue",
            "u_renderFromColor",
            "u_renderToColor",
            "u_renderMidColor",
            "u_noDataColor",
            "u_activeColor",
            "u_useMidColor",
            "u_renderBorder",
            "u_borderColor",
            "u_dataOrigins",
            "u_dataDestinations",
            "u_textureRows",
            "u_textureCols",
            "u_dataTexture",
            "u_scaleValueMin",
            "u_scaleValueMax"
          ]
        );

        // Handle hovering.
        this.watch_mapview_hover = this.view.on("pointer-move", event => {
          const mapPoint = this.view.toMap({x: event.x, y: event.y});
          this.updateVisualization("hover", mapPoint);
        });

        // Handle clicks.
        this.watch_mapview_click = this.view.on("click", event => {
          if (event.button === 0 && !this.hover_enabled) {
            const mapPoint = this.view.toMap({x: event.x, y: event.y});
            this.updateVisualization("click", mapPoint);
          }
        });

        this.updateZoneData();
      }

      // Load default shader code if custom shader code is not provided:
      if (!this.vertex_shader_src || !this.fragment_shader_src) {

        // Load default the vertex and fragment shader source code:
        let vertex_shader_req = esriRequest(vertex_shader_url, {responseType: "text"});
        let fragment_shader_req = esriRequest(fragment_shader_url, {responseType: "text"});

        vertex_shader_req.then(response => this.vertex_shader_src = response.data);
        fragment_shader_req.then(response => this.fragment_shader_src = response.data);

        promiseUtils.eachAlways([
          vertex_shader_req,
          fragment_shader_req
        ]).then(results => {
          let err = false;
          results.forEach(result => {
            if (result.error){
              console.log(result.error);
              err = true;
            }
          });
          if (!err) shaders_ready();
        })
      } else {
        // Load the shaders...since custom shader code was provided, there is
        // no need to load the vertex.shader and fragment.shader files.
        shaders_ready();
      }
    },

    // Called once a custom layer is removed from the map.layers collection and this layer view is destroyed.
    detach: function() {
      // Stop watching layer properties.
      this.watch_zone_boundaries.remove();
      this.watch_active_zone_id.remove();
      this.watch_color_table.remove();
      this.watch_zone_data_url.remove();
      this.watch_zone_data.remove();
      this.watch_render_direction.remove();
      this.watch_mapview_click.remove();
      this.watch_mapview_hover.remove();
      this.watch_mapview_double_click.remove();
      this.watch_render_from_color.remove();
      this.watch_render_to_color.remove()
      this.watch_render_mid_color.remove()
      this.watch_render_active_color.remove()
      this.watch_render_nodata_color.remove();

      const gl = this.context;

      // Delete buffers and programs.
      gl.deleteBuffer(this.vertexBuffer);
      gl.deleteBuffer(this.indexBuffer);
      gl.deleteProgram(this.featuresProgram);
    },

    // Updates the texture used by the shaders, if needed.
    _updateTextureTable: function (gl) {
      if (this._last_texture_data === this.layer.zone_data) {
        return;
      }

      this._last_texture_data = this.layer.zone_data;

      gl.deleteTexture(this._textureTable);
      this._textureTable = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._textureTable);

      // We will be passing the raw values into a texture as RGBA colour values.  The point
      // of doing so is to get 4x the amount of data passed into the shader, and minimize the
      // the amount of calculations and memory required inthe  JavaScript code.  Each value
      // in the source data will be sequentially inserted into each row, colum, rgba value.
      // The shader will then use input uniform paramters to translate origin/destination
      // zone IDs relative to the input OD matrix into row, column, rgba coordiantes in a
      // texture that stores the same data in its RGBA values.  Additional uniform parameters
      // will define how each value should be converted a display colour.

      // Get the deimensions of the input OD matrix:
      const dataOrigins = this._dataOrigins = this._last_texture_data.origin_ids.length;
      const dataDestinations = this._dataDestinations = this._last_texture_data.destination_ids.length;
      const totalValues = this._totalValues = dataOrigins * dataDestinations;

      // Max texture width will be used as the max width:
      const textureCols = this._textureCols = this.maxTextureSize;

      // Number of rows is determined to accomodate the total number of values in
      // the input data matrix
      const textureRows = this._textureRows = Math.ceil(totalValues / 4 / textureCols);

      // Can't load the entire OD on this device....
      if (textureRows > this.maxTextureSize) {
        console.error("Unable to load entire OD matrix (" + dataOrigins + " x " + dataDestinations + " = " + dataOrigins * dataDestinations + " - exceeds maximum of " + this.maxTextureSize * this.maxTextureSize * 4 + ")");
      }

      // We need to pad the data array with arbitrary values to fill any empty pixels
      // that would be on the last row of data:
      while (this._last_texture_data.data.length < (textureCols * textureRows * 4)) {
        this._last_texture_data.data.push(0);
      }

      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, textureCols, textureRows, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(this._last_texture_data.data.map(value => (value - this.layer.zone_render_values.min) / (this.layer.zone_render_values.max - this.layer.zone_render_values.min) * 255)));
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
      const active_zone_index = this.layer.active_zone_id != null ? (
        this.layer.render_direction_outward ?
        this.origin_id_data_index[this.layer.active_zone_id] :
        this.destination_id_data_index[this.layer.active_zone_id]
      ) : -1;
      gl.uniform1f(this.featuresProgram.uniforms.u_activeZoneIndex, active_zone_index);

      // these are the uniforms that describe the input dimensions of the OD Matrix, and the resulting
      // dimensions of the texture that is being used to pass its values...
      gl.uniform1f(this.featuresProgram.uniforms.u_dataOrigins, this._dataOrigins);
      gl.uniform1f(this.featuresProgram.uniforms.u_dataDestinations, this._dataDestinations);
      gl.uniform1f(this.featuresProgram.uniforms.u_textureRows, this._textureRows);
      gl.uniform1f(this.featuresProgram.uniforms.u_textureCols, this._textureCols);


      // These are the uniforms that describe how to convert values in the data into colours:
      gl.uniform1f(this.featuresProgram.uniforms.u_renderDirection, this.layer.render_direction_outward ? 1 : 0);
      gl.uniform1f(this.featuresProgram.uniforms.u_renderBorder, this.layer.render_border ? 1 : 0);
      gl.uniform1f(this.featuresProgram.uniforms.u_renderFromValue, this.layer.zone_render_values.scale_from);
      gl.uniform1f(this.featuresProgram.uniforms.u_renderToValue, this.layer.zone_render_values.scale_to);
      gl.uniform1f(this.featuresProgram.uniforms.u_renderMidValue, this.layer.zone_render_values.use_mid ? this.layer.zone_render_values.scale_mid : 0);
      gl.uniform4fv(this.featuresProgram.uniforms.u_renderFromColor, Object.values(scale255rgb(this.layer.render_from_color)));
      gl.uniform4fv(this.featuresProgram.uniforms.u_renderToColor, Object.values(scale255rgb(this.layer.render_to_color)));
      gl.uniform4fv(this.featuresProgram.uniforms.u_renderMidColor, this.layer.zone_render_values.use_mid ? Object.values(scale255rgb(this.layer.render_mid_color)) : [0, 0, 0, 0]);
      gl.uniform4fv(this.featuresProgram.uniforms.u_noDataColor, this.layer.render_nodata_color ? Object.values(scale255rgb(this.layer.render_nodata_color)) : [0, 0, 0, 0]);
      gl.uniform4fv(this.featuresProgram.uniforms.u_activeColor, this.layer.render_active_color ? Object.values(scale255rgb(this.layer.render_active_color)) : [1, 1, 1, 1]);
      gl.uniform4fv(this.featuresProgram.uniforms.u_borderColor, this.layer.border_color ? Object.values(scale255rgb(this.layer.border_color)) : [.4,.4,.4,.0]);
      gl.uniform1f(this.featuresProgram.uniforms.u_useMidColor, this.layer.zone_render_values.use_mid ? 1 : 0);
      gl.uniform1f(this.featuresProgram.uniforms.u_scaleValueMin, this.layer.zone_render_values.min);
      gl.uniform1f(this.featuresProgram.uniforms.u_scaleValueMax, this.layer.zone_render_values.max);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._textureTable);
      gl.uniform1i(this.featuresProgram.uniforms.u_dataTexture, 0);

      // Bind and configure buffers.
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      gl.enableVertexAttribArray(this.featuresProgram.attributes.a_position);
      gl.enableVertexAttribArray(this.featuresProgram.attributes.a_offset);
      gl.enableVertexAttribArray(this.featuresProgram.attributes.a_typeAndAntiAlias);
      gl.enableVertexAttribArray(this.featuresProgram.attributes.a_originIndex);
      gl.enableVertexAttribArray(this.featuresProgram.attributes.a_destinationIndex);
      gl.vertexAttribPointer(this.featuresProgram.attributes.a_position, 2, gl.FLOAT, false, 32, 0);
      gl.vertexAttribPointer(this.featuresProgram.attributes.a_offset, 2, gl.FLOAT, false, 32, 8);
      gl.vertexAttribPointer(this.featuresProgram.attributes.a_typeAndAntiAlias, 2, gl.FLOAT, false, 32, 16);
      gl.vertexAttribPointer(this.featuresProgram.attributes.a_originIndex, 1, gl.FLOAT, false, 32, 24);
      gl.vertexAttribPointer(this.featuresProgram.attributes.a_destinationIndex, 1, gl.FLOAT, false, 32, 28);

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
      this.abortControllers[action] = new AbortController();

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
      const vertexData = new Float32Array(vertexCount * 8);
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
          vertexData[currentVertex * 8 + 0] = v.x - this.centerAtLastUpdate[0];
          vertexData[currentVertex * 8 + 1] = v.y - this.centerAtLastUpdate[1];
          vertexData[currentVertex * 8 + 2] = v.xOffset;
          vertexData[currentVertex * 8 + 3] = v.yOffset;
          vertexData[currentVertex * 8 + 4] = item.type === "polygon" ? 0 : 1;
          vertexData[currentVertex * 8 + 5] = item.type === "polygon" ? 0.5 : v.vTexcoord;
          vertexData[currentVertex * 8 + 6] = (this.origin_id_data_index && this.origin_id_data_index[item.zone_id] >= 0) ? this.origin_id_data_index[item.zone_id] : -1;
          vertexData[currentVertex * 8 + 7] = (this.destination_id_data_index && this.destination_id_data_index[item.zone_id] >= 0) ? this.destination_id_data_index[item.zone_id] : -1;
          currentVertex++;
        }
      }

      window.vertexData = vertexData;
      window.gl = gl;

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
      // These are the boundaries used for rendering the origins/destnations - a polygon featureset is expected...
      zone_boundaries: {
        type: FeatureSet
      },
      zone_id_column: {},  // Name of the column/attribute that will be used to identify zones (does not need to be unique per polygon)
      zone_data_url: {},  // A URL that points to a protocol-buffer formatted OD Matrix
      zone_data: {},  // an object with two properties: data: a 2-dimensional array of values for representing traveling from each origin zone (rows) to all destination zones (columns), zone_ids (a list of zone_ids that are in the same order as rows/columns of the data)
      active_zone_id: {}, // The id of the currently active zone

      // If true, will render travel from selected zone to all others.  If false, will render travel to selected zone from all others.
      render_direction_outward: {},

      // If specified, these values define the start/end (and optionally mid) values and colours used for rendering
      render_from_value: null,  // defaults to mean minus 1 standard deviation if unspecified
      render_to_value: null,   // no midpoint is used if unspecified...just from/to
      render_mid_value: null,  // defaults to mean plus 1 standard deviation if unspecified
      render_from_color: {},   // defaults to opaque red if unspecified (e.g., {r: 255, g: 0, b: 0, a: 1})
      render_to_color: {},     // defaults to transparent black if unspecified ({r: 0, g: 0, b: 0, a: 0})
      render_mid_color: {},    // defaults to transparent black if unspecified ({r: 0, g: 0, b: 0, a: 0})

      // a watchable property that is updated with the min/max/mean of the currently displayed values (i.e., if they are not specified by the properties above above, then values represented here are derived from mean/standard-deviation of values in the matrix)
      zone_render_values: {},

      // If false, no border is rendered by the shaders (e.g., it may be better to just draw the fatureset itself for this)
      render_border: false,
      border_color: {},  // defaults to a translucent grey
      boreder_width: {},  // deafults to 1.5

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
    },

    fetchODMatrix: function(url) {
      return new Promise(resolve => {
        getODMatrix.then(ODMatrix => {
          fetch(url).then(
            response => response.arrayBuffer()
          ).then(buffer => {
            resolve(ODMatrix.decode(new Uint8Array(buffer)));
          });
        });
      });
    }
  });
});
