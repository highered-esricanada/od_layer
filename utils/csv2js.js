/**
 * Convert a CSV file with origin/destination data containing integer Zone IDs
 * as column headers, and Zone IDs the first value in each row into a JSON file
 * with a list of Zone IDs in sequential order, and a corresponding
 * 2-dimensional array with rows/columns that correspond to the sorted list of
 * IDs, and values that have been rounded to a specified number of decimal
 * places.
 *
 * Decimal places to retain for a given dataset is determined by a hard-coded
 * lookup that matches the number of decimals to retain based on known
 * filenames.  If a filename is not recognized, then the number of decimals
 * retained will default to the input decimals from the commandline argument
 * or 2 if this is not specified.
 *
 * If the input path is to a folder instead of a single CSV file, then all CSV
 * files found within it will be parsed to JSON.
 *
 * Usage: path/to/node path/to/csv2js.js path/to[/od_matrix.csv] <decimals>
 */

const fs = require('fs');
const path = require('path');
const input_path = path.resolve(process.argv[2]);
const input_decimals = (process.argv[3] || 2) * 1;

const decimal_lookup = {
  'acost': 2,
  'atime': 0,
  'atoll': 2,
  'average_distance': 1,
  'bpenalty': 2,
  'ccost': 2,
  'distance': 1,
  'ptt': 0,
  'tfare': 2,
  'tivtt': 0,
  'transit_time': 0,
  'true_transit_time': 0,
  'twait': 1,
  'twalk': 1
}

if (fs.statSync(input_path).isDirectory()) {
  filewalker(input_path).filter(function(file){
    if (/\.csv$/gi.test(file)) {
      parse_csv(file)
    }
  });
} else {
  parse_csv(input_path);
}

function parse_csv(csv_path, decimals)
{

  var retain_decimals = decimal_lookup[path.basename(csv_path.toLowerCase(), ".csv")] || decimals || input_decimals;
  var factor = Math.pow(10, retain_decimals);

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

  var data = fs.readFileSync(csv_path, {encoding: 'utf8'})
  const rows = data.split("\n").map(function(r){
    return r.trim().split(',');
  }).filter(function(r){
    return r.length > 1;
  });

  const zone_ids = rows[0].slice(1).map(function(id) { return parseInt(id); });

  var rows_dict = {};
  for (var i in rows)
  {
    if (i>0)
    {
      var row = rows[i];
      var row_dict = {};
      var row_zone = parseInt(row[0]);
      for (var j in row)
      {
        if (j>0) {
          row_dict[zone_ids[j-1]] = Math.round(parseFloat(row[j])*factor)/factor;
        }
      }
      if (row_zone>0) rows_dict[row_zone] = row_dict;
      else {
        console.error("Invalid Zone ID for row:", i, row);
        process.exit(1);
      }
    }
  }

  zone_ids.sort(function(a,b){ return a-b; });
  zone_data = {zone_ids: zone_ids, data: []};

  for (var i in zone_ids) {
    var row_zone = zone_ids[i];
    var row = []
    for (var j in zone_ids) {
      var col_zone = zone_ids[j];
      row.push(rows_dict[row_zone][col_zone]);
    }
    zone_data.data.push(row);
  }

  fs.writeFileSync(
    csv_path.replace(/\.csv$/gi, '.json'),
    JSON.stringify(zone_data)
  );
}

function filewalker(dir) {
    let results = [];

    var list = fs.readdirSync(dir)

    list.forEach(function(file){
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
