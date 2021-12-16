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

// These are the corresponding indices o.
attribute float a_originIndex;
attribute float a_destinationIndex;

// The a_originIndex and a_destinationIndex values get copied into These
// variables so they can be passed to the fragment shader.
varying float v_originIndex;
varying float v_destinationIndex;

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
  v_typeAndAntiAlias = a_typeAndAntiAlias;

  // copy the a_odCoord to v_originIndex and v_destinationIndex;
  v_originIndex = a_originIndex;
  v_destinationIndex = a_destinationIndex;
}
