/**
 * Convert a CSV file with origin/destination data containing integer Zone IDs
 * as column headers, and Zone IDs as the first value in each row into a JSON
 * object that contains a list of Zone IDs in sequential order, and a
 * corresponding 1-dimensional array of all values in the CSV, with each row
 * appended in sequential order.
 *
 * If the input path is to a folder instead of a single CSV file, then all CSV
 * files found within it will be parsed to JSON.
 *
 * Usage: path/to/node path/to/csv2js.js path/to[/od_matrix.csv]
 */

const fs = require('fs');
const path = require('path');
const protobuf = require('protobufjs');

const input_path = path.resolve(process.argv[2]).replace(/\\/g,'/');

const proto = JSON.parse(fs.readFileSync('../src/matrix.proto.json'));
const root = protobuf.Root.fromJSON(proto);
ODMatrix = root.lookupType("od_layer.ODMatrix");

// A function for walking paths to find all subdirectories and files...
let filewalker = dir => {
    let results = [];

    var list = fs.readdirSync(dir)

    list.forEach(file => {
      file = path.resolve(dir, file);

      var stat = fs.statSync(file);

      if (stat && stat.isDirectory()) {
        results = results.concat(filewalker(file));
      } else {
        results.push(file);
      }
    });

    return results;
};

// A function that parses a CSV file and converts them into a protobuf binary file
let parse_csv = (csv_path, decimals) => {
  // Make sure we can read the file...
  try {
    if (fs.existsSync(csv_path)) {
      console.log("Reading data from CSV file:", csv_path);
    } else {
      console.error("Cannot find CSV file:", csv_path);
      process.exit(1);
    }
  } catch(err) {
    console.error(err);
    process.exit(1);
  }

  // Read the file as regular text, and split each line by commas, store as
  // an array of arrays (i.e., rows)...
  var data = fs.readFileSync(csv_path, {encoding: 'utf8'})
  const rows = data.split("\n").map(
    r => r.trim().split(',')
  ).filter(r => r.length > 1);

  // The destination ids (i.e., the ids in the first row, skipping the first column)
  const destination_ids = rows[0].slice(1).map(id => parseInt(id));

  // The origin ids (9.e., the ids in the first column, skipping the first row)
  // This will be populated as each row is parsed.
  const origin_ids = [];

  // The zone ids for rows (i.e., the origin) should be the first columnn of
  // each row.  As we loop through all of the rows, get the current row's
  // zone ID, and its values.  Each row's values will be stored initially as a
  // dictionary object with each column's zone ID as the key.  All rows are
  // subsequently stored in a dictionary object with the row's zone ID as the
  // key (this is to ensure order of rows/columns relative to a list of zone IDs
  // can be maintained in the final output)
  var rows_dict = {};
  for (var i in rows) {
    if (i>0) {
      var row = rows[i];
      var row_dict = {};
      var origin_id = parseInt(row[0]);
      for (var j in row) {
        if (j>0) {
          row_dict[destination_ids[j-1]] = parseFloat(row[j]);
        }
      }
      rows_dict[origin_id] = row_dict;
      origin_ids.push(origin_id);
    }
  }

  // Sort zone IDs (they usually already in the correct order, but just
  // to be sure...)
  destination_ids.sort((a,b) => a - b);
  origin_ids.sort((a,b) => a - b);

  // Prepare the dictionary that will store the data:
  zone_data = {
    destination_ids: destination_ids,
    origin_ids: origin_ids,
    data: []
  };

  // Loop through all the sequential zone IDs for each row, and again for each
  // column, and append the values to the data property of the zone_data object.
  for (var i in origin_ids) {
    var origin_id = origin_ids[i];
    for (var j in destination_ids) {
      var destination_id = destination_ids[j];
      zone_data.data.push(rows_dict[origin_id][destination_id]);
    }
  }

  let pb_path = csv_path.replace(/\.csv$/gi, '.pb')
  fs.writeFileSync(pb_path, ODMatrix.encode(zone_data).finish());
  return pb_path;
}

// If the specified input is a directory, a summary metadata file will be
// written to describe all of the available data files that have been prepared.
let file_metadata = false;
if (fs.statSync(input_path).isDirectory()) {
  file_metadata = {};
  filewalker(input_path).filter(file => {
    if (/\.csv$/gi.test(file)) {
      // convert each CSV file...
      let pb_file = parse_csv(file).replace(/\\/g,"/");

      // Get the parts of the path (within the input path...)
      let file_path = pb_file.substr(input_path.length, pb_file.length - input_path.length).replace(/^\//,'');
      let file_parts = file_path.split("/");

      // Start at the root metadata for each filename...
      let current_dir = file_metadata;

      // Traverse each part of the path...
      file_parts.forEach((part, i) => {
        if (i == (file_parts.length - 1)) {

          // If this is the last part of the path, it's the file basename.  Add
          // it to the list of files for the current subdirectory:
          if (!current_dir.files) current_dir.files = [];
          current_dir.files.push(part);

        } else {


          // For folders within the path, add a new subdir if it's not already present
          if (!current_dir.subdirs) current_dir.subdirs = {};
          if (!current_dir.subdirs[part]) current_dir.subdirs[part] = {};

          // Recurse into the new subdir...
          current_dir = current_dir.subdirs[part];
        }
      });
    }
  });

  fs.writeFileSync(
    input_path + "/metadata.json",
    JSON.stringify(file_metadata)
  );
} else {
  // If this command is executed with just one file path, then convert the one file.
  parse_csv(input_path);
}
