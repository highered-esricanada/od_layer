// Precision qualification is mandatory in fragment shaders.
precision highp float;

// These are the origin/destination indexes assocated with the current feature
varying float v_originIndex;
varying float v_destinationIndex;

varying vec2 v_typeAndAntiAlias;

// These will be used to index the texture vertically indicates the active
// zone to use for obtaining colors from a 2D texture.
uniform float u_activeZoneIndex;

// The lookup table as a 2D texture.
uniform sampler2D u_dataTexture;

// Provide the dimensions of the source data matrix, and the
// input texture size:
uniform float u_dataOrigins; // Rows
uniform float u_dataDestinations;  // Columns
uniform float u_textureRows;
uniform float u_textureCols;

// Indicates the directionality of the origin/destination rendering
//   0 == outward (from active zone to others)
//   1 == inward (to active zone from others)
uniform float u_renderDirection;

// parameters for scaling values to colours:
uniform float u_renderFromValue;
uniform float u_renderToValue;
uniform float u_renderMidValue;
uniform vec4 u_renderFromColor;
uniform vec4 u_renderToColor;
uniform vec4 u_renderMidColor;
uniform float u_useMidColor;
uniform vec4 u_noDataColor;
uniform vec4 u_activeColor;

// Indicates the border should be rendered
//   0 == no border
//   1 == border
uniform float u_renderBorder;
uniform vec4 u_borderColor;

// Used to scale values from 0 to 1 to their original values:
uniform float u_scaleValueMin;
uniform float u_scaleValueMax;

// Converts the row/column index for a cell of the original data matrix to the
// row/column/rgba index for the corresponding value passed to this shader as
// a texture.
vec3 data_index_to_texel_coords(vec2 data_coords) {
  float num_values = u_dataOrigins * u_dataDestinations; // number of unique values in the original OD matrix
  float num_texels = ceil(num_values / 4.0);  // number of actual texels with data (the last texel might have fewer than 4 values)
  float value_index = data_coords.x + data_coords.y * u_dataOrigins;  // The positional index of the current value in the list of all possible values (in the original OD matrix)
  float texel_row = floor( (value_index / 4.0) / u_textureCols );  // the corresponding texel row that would contain this value
  float texel_col = floor(value_index  / 4.0) - (texel_row * u_textureCols); // the corresponding texel column that would contain this value
  float texel_val = mod(value_index, 4.0); // the index of the value within the rgba values of a given texel

  // return vec3 with the column (x), row (y), rgba (z) coordinates:
  return vec3(texel_col, texel_row, texel_val);
}

vec4 scale255rgb(vec4 rgba) {
  return vec4(rgba.r/255.0, rgba.g/255.0, rgba.b/255.0, rgba.a);
}

vec4 render_color(float val) {

  if (u_useMidColor == 0.0) {
    // Only use 'from' and 'to' values...
    float val_position = 0.0;
    if (u_renderFromValue > u_renderToValue) {
      // 'from' value is higher than the 'to' value, so colour is scaled between the 'to' color (min) and the 'from' color (max)
      val_position = (clamp(val, u_renderToValue, u_renderFromValue) - u_renderToValue) / (u_renderFromValue - u_renderToValue);
      return mix(u_renderToColor, u_renderFromColor, val_position);
    } else {
      // 'to' value is higher than the 'from' value, so colour is scaled between the 'from' color (min) and the 'to' color (max)
      val_position = (clamp(val, u_renderFromValue, u_renderToValue) - u_renderFromValue) / (u_renderToValue - u_renderFromValue);
      return mix(u_renderFromColor, u_renderToColor, val_position);
    }

  } else if (val >= u_renderMidValue) {
    // Value is above the value for the middle color...
    float val_position = 0.0;
    if (u_renderFromValue > u_renderMidValue) {
      // the 'from' value is higher than the 'to' value, so colour is scaled between the mid-color (min) and from-color (max)
      val_position = (clamp(val, u_renderMidValue, u_renderFromValue) - u_renderMidValue) / (u_renderFromValue - u_renderMidValue);
      return mix(u_renderMidColor, u_renderFromColor, val_position);
    } else {
      // the 'from' value is lower than the 'to' value, so colour is scaled between the mid-color (min) and to-color (max)
      val_position = (clamp(val, u_renderMidValue, u_renderToValue) - u_renderMidValue) / (u_renderToValue - u_renderMidValue);
      return mix(u_renderMidColor, u_renderToColor, val_position);
    }
  } else {
    // value is below the value for the middle color...
    float val_position = 0.0;
    if (u_renderFromValue > u_renderMidValue) {

      val_position = (clamp(val, u_renderToValue, u_renderMidValue) - u_renderToValue) / (u_renderMidValue - u_renderToValue);
      return mix(u_renderToColor, u_renderMidColor, val_position);
    } else {
      val_position = (clamp(val, u_renderFromValue, u_renderMidValue) - u_renderFromValue) / (u_renderMidValue - u_renderFromValue);
      return mix(u_renderFromColor, u_renderMidColor, val_position);
    }
  }

}

void main() {

  // Lookup value from the active zone.
  // if render direction is forward, we will get vec2(activeZone, originIndex)
  // if render direction is backwards, we will get vec2(destinationIndex, activeZoneIndex)
  vec2 data_coords = vec2(
    (u_renderDirection == 1.0 ? v_destinationIndex : u_activeZoneIndex), // destination is x (i.e, the column)
    (u_renderDirection == 1.0 ? u_activeZoneIndex : v_originIndex) // origin is y (i.e., the row)
  );

  // Convert origin/destination matrix coordinates to row/column/rgba coordinates in the texture
  vec3 texel_coords = data_index_to_texel_coords(vec2(
    (u_renderDirection == 1.0 ? u_activeZoneIndex : v_originIndex),
    (u_renderDirection == 1.0 ? v_destinationIndex : u_activeZoneIndex)
  ));

  // We add 0.5 to x and y to hit the center of a texel.
  vec4 texel = texture2D(u_dataTexture, vec2(
    (texel_coords.x + 0.5) / u_textureCols,
    (texel_coords.y + 0.5) / u_textureRows
  ));

  // Four values are in each texel - the actual value is at the z coordinate of the texel_coords:
  float val = (texel_coords.z == 0.0 ? texel.r : (texel_coords.z == 1.0 ? texel.g : (texel_coords.z == 2.0 ? texel.b : texel.a)));

  vec4 activeColor = u_activeZoneIndex < 0.0 ? u_noDataColor : (
    u_activeZoneIndex == (u_renderDirection == 1.0 ? v_destinationIndex : v_originIndex) ?
    vec4(1.0,1.0,1.0,1.0) :
    vec4(1.0 - val/255.0, 0.0, 0.0, 1.0)  // TODO: convert this to an actual rendered colour
  );

  // Map antialias value to a number between 0 and 1 such that:
  //   0.5  -->  1
  //     0  -->  0
  //     1  -->  0
  // This will have the effect of making all polygons solid and make polylines solid on the centerline and transparent on the edges.
  // If u_renderBorder == 0, then only polygon fill will be rendered, and no polylines:
  float border_alpha = pow(1.0 - (0.5 - v_typeAndAntiAlias.y) * (0.5 - v_typeAndAntiAlias.y) / 0.25, 1.5);

  // Re-scale values to their original values:
  val = (val * (u_scaleValueMax - u_scaleValueMin) + u_scaleValueMin);

  // Might be better to rewrite this without if statements
  if (v_typeAndAntiAlias.x==1.0) {
    // Draw the border...
    gl_FragColor = u_borderColor * border_alpha * u_renderBorder;
  } else {
    if (u_activeZoneIndex == -1.0) {
      // If there is no active zone, draw everthing with the no-data color....
      gl_FragColor = u_noDataColor * (u_renderBorder == 1.0 ? border_alpha : 1.0);
    } else if (u_activeZoneIndex == (u_renderDirection == 1.0 ? v_destinationIndex : v_originIndex)) {
      // If the current zone being drawn is the active zone, then draw it with the active-zone color...
      gl_FragColor = u_activeColor * (u_renderBorder == 1.0 ? border_alpha : 1.0);
    } else if (v_originIndex == -1.0 || v_destinationIndex == -1.0) {
      // If the current zone is not a valid or origin or destination relative to the active zone, then
      // render it with the no data color:
      gl_FragColor = u_noDataColor * (u_renderBorder == 1.0 ? border_alpha : 1.0);
    } else {
      // If we get here, then we can scale the color based on the min/mid/max colours and values supplied:
      //gl_FragColor = scale_colour(val, u_renderFromColor, u_renderMidColor, u_renderToColor)
      gl_FragColor = render_color(val) * (u_renderBorder == 1.0 ? border_alpha : 1.0);
    }
  }
}
