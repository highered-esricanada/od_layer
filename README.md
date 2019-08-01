# Origin-Destination Visualization Layer for the ArcGIS API for JavaScript (4.12+)

This is an experimental sample that contains significant portions of the [source code](https://github.com/damix911/ds-demo-2019) for the *Postcard from Esri* demo [presented](https://www.esri.com/en-us/about/events/devsummit/agenda/agenda) at the [Esri Developer Summit 2019](https://www.esri.com/en-us/about/events/devsummit/overview)

The purpose of the Origin-Destination layer in this project is to enable interactive visualization of origin-destination data matrices associated with polygon geometry data.  It uses code derived from the original Esri sample for drawing polygons in a [custom WebGL layer view](https://developers.arcgis.com/javascript/latest/sample-code/custom-gl-visuals/index.html) to display zones.  Colours are applied to each zone using a lookup object that is calculated on-the-fly from an origin-destination matrix to display the amount of time, cost, or other measures that relate to travelling to or from a selected zone and all other zones.  With this implementation, the displayed colours on the map can be updated very rapidly, making the visualization of the differences in origin-destination relationships across a dataset with many zones fluid and interactive.

When a given zone is chosen, then the values associated with travelling to/from that zone and all other zones are analyzed.  A colour range is calculated representing +/- one standard deviation from the mean of all values.  Then a colour for each zone is calculated based on this range and saved in a dictionary object.  As the WebGL layer view draws each zone, it uses the colour assigned to the corresponding zone from the dictionary object.

### Demo

To view a single layer, open the following URL (*Caution: this sample downloads ~30-50mb of data on startup, and for each additional variable you choose to view once loaded.*) [https://highered-esricanada.github.io/od_layer/demo/index.html](https://highered-esricanada.github.io/od_layer/demo/index.html).  The demo app provides the following functionality:

* You can select the variable to view and the time period from the controls in the bottom left.  
* Mouseover or click on the map to select the origin/destination zone (double-click on the map to disable/enable the mouseover effect).
* To reverse the travel direction (to/from the selected zone), click the button near the top left.
* If you don't like the display colour, click on the legend display switch between primary/secondary colours.
* It *does* work on smartphone browsers (be sure to use it on wifi, or you'll quickly drain your data plan!)

A second demo presents a 2x2 dashboard-like view allowing you to simultaneously compare four different views (e.g., travel times for four different time periods).  This will load 4x the data as the first demo, and is best viewed on desktop browsers with (give it time to load all of the data): [https://highered-esricanada.github.io/od_layer/demo/dashboard.html](https://highered-esricanada.github.io/od_layer/demo/dashboard.html)

### Data requirements

Zone features must be provided as an input FeatureSet containing polygon geometries and at least one attribute that can be used as a Zone identifier.  Polygon geometries must be single-part polygons - if your data contain multi-part polygons, [explode](https://pro.arcgis.com/en/pro-app/help/editing/explode-a-multipart-feature.htm) them into individual single-part polygons.  Each polygon must be assigned an attribute that can be used as a zone identifier - this does not need to be unique (e.g., in the case of exploded multi-part polygons).

Origin-destination data must be provided as an object containing two properties: `zone_ids` and `data`.  The `zone_ids` property must contain an array of identifiers that relate to each of the zone features.  The `data` property must be 2-dimensional array of values representing the origin-destination matrix.  Each item at the top level of the array is viewed as a row of values, and each value within a row corresponds with a column.  The position of each row and column corresponds with the order of zone identifiers listed in the `zone_ids` property.  The row position is expected to reflect an origin, and column positions represent a destination.  For example, a row will represent values associated with travel ***from*** an origin zone ***to*** all other possible destination zones.  A column (values taken from a specified position within all rows) represents travel ***to*** a single destination zone ***from*** all other zones.

#### Prepare O/D data matrices

If you have origin-destination data in CSV format, with the first column and first row containing the zone identifiers, you can use the `utils/csv2js.js` Node script to re-format them to the expected JSON file format.

*Note: this sample uses the mapbox earcut module for polygon triangulation, which will not correctly handle multi-polygon geometries.  If you have zone geometries that contain multi-polygon features, you must 'explode' these into individual polygons.  As long as the exploded parts all share the same zone identifier used in your origin-destination matrix data, it will display correctly when rendered by the ODLayer.*

### `ODLayer` class usage

The constructor for the `ODLayer` class requires an object with the following properties:

| Property | Description |
| --- | --- |
| `zone_boundaries` |  FeatureSet JSON object containing polygons with zone identifier attributes  assigned to them. |
| `zone_id_column` | The name of the attribute to be used as zone identifiers. |
| `render_colour` | A Colour object compatible with the [`esri/Colour`](https://developers.arcgis.com/javascript/latest/api-reference/esri-Color.html) class (e.g., for red: `{r: 255, g:0, b: 0, a: 1}`), which is used to display zones with +1 standard deviation or better from the mean in terms of travel time or cost (lower values are better).  Zones that fall at or below -1 standard deviation from the mean or lower will be transparent. |
| `zone_data` | An object containing `data` and `zone_ids` properties (outlined above in the data requirements). |
| `zone` | The identifier of the selected zone to render. |
| `render_direction_outward` | If true, the layer is rendered to display travel from the selected zone to all others.  If false, the layer is rendered to display travel to the selected zone from all others. |

The `ODLayer` has the following additional watchable property:

| Property | Description |
| --- | --- |
| `zone_render_values` | Set as an object that provides the values calculated for the selected origin or destination zone, including the following properties: `min`, `mean`, `max`, `plus1stdev`, `minus1stdev` - the last two are the min/max values used to render colours on the map. |

### development

Clone this repo, install Node, then from a commandline execute the following from the od_layer directory to install required modules:

`npm install`

After the dependencies are installed, run the following command to build and watch the TypeScript bundle:

`npm run-script build`

Leave the above command running, and as you edit any of the TypeScript files in the `src/` folder, the `bundles/app.js` module will be automatically rebuilt.

The `ODLayer` class is defined in `demo/ODLayer.js` - it uses the compiled `bundles/app.js` module for the WebGL rendering.

### Acknowledgements

This work is a result of ongoing collaboration related the iCity project, with Eric Miller and researchers at the [University of Toronto Transportation Research Institute](https://uttri.utoronto.ca/).
