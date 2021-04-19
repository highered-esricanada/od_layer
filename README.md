# Origin-Destination Visualization Layer for the ArcGIS API for JavaScript (4.18+)

This is an experimental sample that provides a custom layer class for the ArcGIS API for JavaScript that enables visualization of Origin/Destination data matrices using custom WebGL rendering implemented.  An earlier version of this sample was based source code from the [Postcard from Esri](https://github.com/damix911/ds-demo-2019) sample [presented](https://www.esri.com/en-us/about/events/devsummit/agenda/agenda) at the [Esri Developer Summit 2019](https://www.esri.com/en-us/about/events/devsummit/overview).  With great assistance from [Dario D'Amico](https://github.com/damix911), the current version of this project is being adapted to generate textures from origin/destination matrix data, and use these to more efficiently draw the origin/destination visualizations in custom WebGL renderer as a map layer with the ArcGIS API for JavaScript.

The purpose of the Origin-Destination layer in this project is to enable interactive visualization of origin-destination data matrices associated with polygon geometry data.  It uses code derived from samples provided by Esri (by Dario D'Amico) to draw polygons in a [custom WebGL layer view](https://developers.arcgis.com/javascript/latest/sample-code/custom-gl-visuals/index.html) to display zones.  When an origin/destination matrix is loaded, a 2d texture is generated and used as a lookup for colours to assign to each zone based on the row/column indicies of the original origin/destination matrix as pixel coordinates in the texture.  The WebGL shader that draws the polygons obtains these values from the texture on-the-fly as the layer is drawn on the map. As a user interacts with the map, the current 'active' zone is updated, and this affects which origin/destination values are rendered on the map.  With this approach, the custom layer is able to interactively display the amount of time, cost, or other measures that relate to travelling to or from a selected zone and all other zones. The selected zone can be specified by hovering the mouse cursor or clicking the mouse on the map layer. With the displayed colours on the map updated very rapidly by the WebGL shader, it is an intuitive and interactive experience to visualize and compare different patterns in origin-destination relationships across a dataset with many zones.

### Demo

To view a single layer, open the following URL (*Caution: this sample downloads ~30-50mb of data on startup, and for each additional variable you choose to view once loaded.*) [https://highered-esricanada.github.io/od_layer/demo/index.html](https://highered-esricanada.github.io/od_layer/demo/index.html).

[![Demo 1](demo/images/demo1.png)](https://highered-esricanada.github.io/od_layer/demo/index.html)

The demo app provides the following functionality:

* You can select the variable to view and the time period from the controls in the bottom left.  
* Mouseover or click on the map to select the origin/destination zone (double-click on the map to disable/enable the mouseover effect).
* To reverse the travel direction (to/from the selected zone), click the button near the top left.
* If you don't like the display colour, click on the legend display switch between primary/secondary colours.
* It *does* work on smartphone browsers (be sure to use it on wifi, or you'll quickly drain your data plan!)

A second demo presents a 2x2 dashboard-like view allowing you to simultaneously compare four different views (e.g., travel times for four different time periods).  This will load 4x the data as the first demo.  It is best viewed on desktop browsers with (give it time to load the data and generate textures for all four maps): [https://highered-esricanada.github.io/od_layer/demo/dashboard.html](https://highered-esricanada.github.io/od_layer/demo/dashboard.html)

[![Demo 2](demo/images/demo2.png)](https://highered-esricanada.github.io/od_layer/demo/dashboard.html)

A third demo shows an option added to render values differently, with two gradients for values above/below a specified midpoint.  In this example, the difference between either cost or time associated with driving an automobile vs. taking public transit is calculated between two O/D matrices, and this difference is visualized using a different colour for values above zero (higher cost/time associated with transit) and below zero (higher cost or time associated with driving in an automobile).  Note that this demo will download about ~60-80mb on startup to load two O/D matrices of data: [https://highered-esricanada.github.io/od_layer/demo/difference.html](https://highered-esricanada.github.io/od_layer/demo/difference.html)

[![Demo 3](demo/images/demo3.png)](https://highered-esricanada.github.io/od_layer/demo/difference.html)

### Data requirements

Zone features must be provided as an input FeatureSet containing polygon geometries and at least one attribute that can be used as a Zone identifier. Each polygon must be assigned an attribute that can be used as a zone identifier - this identifier must be unique.

Origin-destination data must be provided as an object containing two properties: `zone_ids` and `data`.  The `zone_ids` property must contain an array of identifiers that relate to each of the zone features, and must correspond with the identifier you have assigned to your zone features.  The `data` property must be 2-dimensional array of values representing the origin-destination matrix.  Each item at the top level of the array is viewed as a row of values, and each value within a row corresponds with a column.  The position of each row and column corresponds with the order of zone identifiers listed in the `zone_ids` property.  The row position is expected to reflect an origin, and column positions represent a destination.  For example, a row will represent values associated with travel ***from*** an origin zone ***to*** all other possible destination zones.  A column (values taken from a specified position within all rows) represents travel ***to*** a single destination zone ***from*** all other zones.

#### Prepare O/D data matrices

If you have origin-destination data in CSV format, with the first column and first row containing the zone identifiers, you can use the `utils/csv2js.js` Node script to re-format them to the expected JSON file format.

### `ODLayer` class usage

The constructor for the `ODLayer` class requires an object with the following properties:

| Property | Description |
| --- | --- |
| `zone_boundaries` |  FeatureSet object containing polygons with zone identifier attributes  assigned to them. |
| `zone_id_column` | The name of the attribute to be used as zone identifiers. |
| `render_color` | A Colour object compatible with the [`esri/Color`](https://developers.arcgis.com/javascript/latest/api-reference/esri-Color.html) class (e.g., for red: `{r: 255, g:0, b: 0, a: 1}`), which is used to display zones with +1 standard deviation or better from the mean in terms of travel time or cost (lower values are better).  Zones that fall at or below -1 standard deviation from the mean or lower will be transparent. If the `render_midpoint` is property is defined (below), then this property must instead be defined as an object with two colour objects assigned as `above` and `below`. |
| `zone_data` | An object containing `data` and `zone_ids` properties (outlined above in the data requirements). |
| `active_zone_id` | The identifier of the selected zone to render. |
| `render_direction_outward` | If true, the layer is rendered to display travel from the selected zone to all others.  If false, the layer is rendered to display travel to the selected zone from all others. |
| `render_midpoint` | If this property is `null` (default) then a single colour gradient using the `render_colour` is applied to the visualization.  If it is set to numerical value, then `render_colour` must be an object with `above` and `below` properties set as colour objects.  The midpoint will be transparent, while colours will be used in gradients that increase in intensity/opacity for values further away from the midpoint, using corresponding `above` and `below` colours. |
| `render_border` | If false, the WebGL shader will not draw polygon boundaries. |
| `hover_enabled` | If true, the layer will update it's active_zone_id and render correspondingly as the mouse cursor moves over the layer. |
| `hover_enabled` | If true, the layer will update it's active_zone_id and render correspondingly as the mouse cursor is clicked on the layer. |

The `ODLayer` class also has the following additional watchable properties:

| Property | Description |
| --- | --- |
| `zone_render_values` | Set as an object that provides the values calculated for the selected origin or destination zone, including the following properties: `min`, `mean`, `max`, `plus1stdev`, `minus1stdev`, and `count` - the last two are the min/max values used to render colours on the map. If `render_midpoint` is used, then this will instead be an object with two `above` and `below` properties containing the same values that correspond to values in the data that lie above or below the specified midpoint. |
| `zone_colours` | This simple array representing RGBA values for every column and every row in the origin/destination matrix.  This is the property used to generate the texture for assigning colours to the layer's polygon geometries in WebGL.  The first three RGB values are 0-255, and the fourthe is 0-1 representing alpha/transparency. |

### development

This is a pure JavaScript library.  The ODLayer class can be added to any custom ArcGIS JavaScript API object by importing the `src/ODLayer.js` script (e.g., refer to the demo HTML samples).


### Acknowledgements

This work is a result of ongoing collaboration related the iCity project, with Eric Miller and researchers at the [University of Toronto Transportation Research Institute](https://uttri.utoronto.ca/).

Thanks to [Dario D'Amico](https://github.com/damix911) for providing valuable assistance, and excellent samples for developing custom WebGL layers.
