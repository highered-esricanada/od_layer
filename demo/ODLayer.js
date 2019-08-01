define([
  "esri/layers/Layer",
  "esri/views/2d/layers/BaseLayerViewGL2D",

  "./bundles/app.js"
], function(
  Layer,
  BaseLayerViewGL2D,

  engine
){

  var ODLayerView2D = BaseLayerViewGL2D.createSubclass({
    properties: {
      app: engine.Application
    },

    constructor: function() {
    },

    attach: function() {
      var re_render = function(){
        this.render_zone(this.layer.zone, true);
      }.bind(this);

      this.watch_zone_data = this.layer.watch("zone_data", re_render);
      this.watch_direction = this.layer.watch("render_direction_outward", re_render);
      this.watch_colour = this.layer.watch("render_colour", re_render);
      this.watch_zone = this.layer.watch("zone", re_render);

      const app = new engine.Application();
      app.load(this.layer.zone_boundaries, this.layer.zone_id_column, true).then(() => {
        this.app = app;
        this.requestRender();
      });
    },

    detach: function() {
      this.watch_zone_data.remove();
      this.watch_direction.remove();
      this.watch_colour.remove();
      this.watch_zone.remove();

      this.app.dispose();
      this.app = null;
    },

    toRGB: function(hexColor) {
      return hexColor.slice(1).match(/../g).map((c,i)=>(('0x'+c)/(i-3?1:255)) / 255);
    },

    render: function(renderParameters) {
      if (!this.app) {
        return;
      }

      this.app.setView(
        renderParameters.state.center,
        renderParameters.state.rotation,
        renderParameters.state.resolution,
        renderParameters.state.pixelRatio,
        renderParameters.state.size
      );

      this.app.render(renderParameters.context);
      this.requestRender();
    },

    render_zone: function(render_zone_id, force) {
      var zone_colours = {default: [0.0, 0.0, 0.0, 0.0]};
      if (!this.layer.zone_data) return;
      if (!this.layer.zone_data.zone_ids) this.app.setColours(zone_colours);

      var zone_index = this.layer.zone_data.zone_ids.indexOf(render_zone_id);
      if (zone_index==-1) this.app.setColours(zone_colours);

      if (render_zone_id == this.last_zone && !force) return;
      this.last_zone = render_zone_id;

      var zone_values;
      if (this.layer.render_direction_outward) {
        // To render the values for travelling *from* a zone *to* all others,
        // we need to pull out a row of data that corresponds to the
        // selected zone:
        zone_values = this.layer.zone_data.data[zone_index];
      } else {
        // To render the values for travelling *to* a zone *from* all others,
        // we need to extract a column from the data that corresponds to the
        // selected zone:
        zone_values = this.layer.zone_data.data.map(function(row){
          return row[zone_index];
        });
      }

      var stdev = this.standardDeviation(zone_values);
      var mean = this.average(zone_values);
      var minus1stdev = mean - stdev;
      var plus1stdev = mean + stdev;
      var min = zone_values[0];
      var max = zone_values[0];

      for (var zone_index in zone_values)
      {

        var zone_value = zone_values[zone_index];
        var src_colour = this.layer.render_colour || {r: 255, g: 0, b: 0, a: 1};
        var multiplier = 1-(zone_value - minus1stdev)/(plus1stdev - minus1stdev);
        var red = src_colour.r/255 * multiplier;
        var green = src_colour.g/255 * multiplier;
        var blue = src_colour.b/255 * multiplier;
        var alpha = src_colour.a * multiplier;

        min = Math.min(min, zone_value);
        max = Math.max(max, zone_value);


        var zone_id = this.layer.zone_data.zone_ids[zone_index];
        if (render_zone_id == zone_id) zone_colours[zone_id] = [1, 1, 1, 0.7];
        else zone_colours[zone_id] = [red, green, blue, alpha];
      }

      this.app.setColours(zone_colours);
      this.layer.zone_render_values = {
        minus1stdev: minus1stdev,
        plus1stdev: plus1stdev,
        min: min,
        max: max,
        mean: mean
      };
      this.layer.zone_colours = zone_colours;
    },

    standardDeviation: function(values){
      var avg = this.average(values);

      var squareDiffs = values.map(function(value){
        var diff = value - avg;
        var sqrDiff = diff * diff;
        return sqrDiff;
      });

      var avgSquareDiff = this.average(squareDiffs);

      var stdDev = Math.sqrt(avgSquareDiff);
      return stdDev;
    },

    average: function(data){
      var sum = data.reduce(function(sum, value){
        return sum + value;
      }, 0);

      var avg = sum / data.length;
      return avg;
    } //,

    // // Hit testing on the regular feature layer is faster than this...
    //hitTest: function(x, y) {
    //  var hit = this.view.toMap({x: x, y: y});

    //  for (var i in this.layer.zone_boundaries.features) {
    //    var zone = this.layer.zone_boundaries.features[i];
    //    if (zone.geometry.contains(hit)) {
    //      zone.layer = this.layer;
    //      return zone;
    //    }
    //  }
    //}
  });

  return Layer.createSubclass({
    properties: {
      zone_boundaries: {},  // Expected to be a featureset of polygons - at least one attribute needs to be present to represent zone IDs
      zone_id_column: {},  // Name of the column that will be used to identify zones (does not need to be unique per polygon)
      zone_data: {},  // an object with two properties: data: a 2-dimensional array of values for representing traveling from each origin zone (rows) to all destination zones (columns), zone_ids (a list of zone_ids that are in the same order as rows/columns of the data)
      zone: {},  // the id of the zone to render
      render_direction_outward: {}, // If true, will render travel from selected zone to all others.  If false, will render travel to selected zone from all others.
      render_colour: {}, // A colour object that is used for the lowest time, lowest cost, etc.  (e.g., for red: {r:255, g:0, b: 0, a: 1})
      zone_render_values: {}, // a watchable property that is updated with the min/max/mean of the currently displayed values, plus the plus1stdev/minus1stdev values used for rendering colours.
      zone_colours: {}  // a watchable property that is the lookup used for applying colours to each zone
    },

    constructor() {
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
