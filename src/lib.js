'use strict';

import fs       from 'fs';
import readline from 'readline';
import _        from 'underscore';
import async    from 'async';
import Promise  from 'bluebird';

const FIELDS = ['timestamp', 'elb', 'client:port', 'backend:port', 'request_processing_time', 'backend_processing_time', 'response_processing_time', 'elb_status_code', 'backend_status_code', 'received_bytes', 'sent_bytes', 'request', 'requested_resource', 'user_agent', 'total_time', 'count'];

export default async function ({ logs = [], files = [], cols = ['count', 'requested_resource'], prefixes = [], sortBy = 0, limit = 10, ascending = false }) {
  return new Promise((pass, fail) => {
    // Fail when user requests a column that is not support by the analyzer
    if (cols.some(c => !~FIELDS.indexOf(c)))
      return fail('One or more of requested columns does not exist.');

    // Fail when user gives a sortBy value for a non-existent column
    if (sortBy < 0 || sortBy > cols.length - 1)
      return fail('Invalid \'sortBy\' parameter. \'sortBy\' cannot be lower than 0 or greater than number of columns.');

    const PROCESSOR = generateProcessor({
      cols: cols,
      sortBy: sortBy,
      limit: limit,
      ascending: ascending
    });

    const FILTER = generateFilter(prefixes);

    parseFiles(files, PROCESSOR.process.bind(PROCESSOR, FILTER))
    .then(function () {
      let logs = PROCESSOR.getResults();

      if (ascending)
        logs = logs.slice(0, limit);
      else
        logs = logs.slice(logs.length - limit).reverse();

      pass(logs);
    })
    .catch(fail);
  })
}

// Reads files line by line and passes them
// to the processor function
function parseFiles(files, processFunc) {
  return new Promise((pass, fail) => {
    // Loop through files
    async.map(files, function (file, next) {
      const RL = readline.createInterface({
        input: fs.createReadStream(file)
      });

      // Read file contents
      RL.on('line', line => {
        processFunc(line);
      });

      RL.on('close', next);

    }, err => {
      if (err) return fail(err);
      pass();
    });
  });
}

// Generates a filter function depending on prefixes
function generateFilter (prefixes) {
  if (prefixes.length === 0)
    return null;

  return line =>
    _.every(prefixes, (p, i) =>
      !p && p !== 0 || line[i] && line[i].toString().startsWith(p)
    );
}

function generateProcessor ({ cols, sortBy, ascending, limit }) {
  const COUNT_INDEX = cols.indexOf('count');

  if (COUNT_INDEX > -1) {
    let counts = {};
    let tempCols = cols.slice(0);

    tempCols.splice(COUNT_INDEX, 1);

    return {
      process: function (filterFunc, line) {
        line = parseLine(line);
        line = _.map(tempCols, c => line[c]);

        // Drop the line if any of the columns requested does not exist in this line
        if (line.some(c => !c && c !== 0))
          return;

        // Count column is not in 'line' at this moment
        // so we are defining a new variable that includes it
        let tempLine = line.slice();
        if (filterFunc && COUNT_INDEX !== sortBy && !filterFunc(line.splice))
          return;

        // stringifying columns serves as a multi-column group_by
        const LINESTRING = JSON.stringify(line);
        counts[LINESTRING] = counts[LINESTRING] ? counts[LINESTRING] + 1 : 1;
      },

      getResults: function () {
        let q = _.chain(counts)
          .pairs()
          .map(function (l) {
            const COUNT = l[1];
            l = JSON.parse(l[0]);
            l.splice(COUNT_INDEX, 0, COUNT);
            return l;
          });

        if (typeof filterFunc === 'function')
          q = q.filter(filterFunc);

        return q.sortBy(sortBy).value();
      }
    };
  }
  else {
    const TEMP_COLS = cols.slice(0);
    let outputLines = [];

    return {
      process: function (filterFunc, line) {
        line = parseLine(line);
        line = _.map(TEMP_COLS, c => line[c]);

        // Drop the line if any of the columns requested does not exist in this line
        if (line.some(c => !c && c !== 0))
          return;

        if (filterFunc && !filterFunc(line))
          return;

        const FIRSTLINE = _.first(outputLines);

        // Add lines until the limit is reached
        if (outputLines.length < limit) {
          outputLines = splice( outputLines, line, sortBy );
        }
        // Drop lines immediately that are below the last item
        // of currently sorted list. Otherwise add them and
        // drop the last item.
        else {
          let compare;

          if (typeof FIRSTLINE[sortBy] === 'number' && typeof line[sortBy] === 'number')
            compare = FIRSTLINE[sortBy] < line[sortBy] ? -1 : 1;
          else
            compare = String(FIRSTLINE[sortBy]).localeCompare(line[sortBy]);

          if (!ascending && compare === 1 || ascending && compare === -1)
            return;

          outputLines = splice( outputLines, line, sortBy );
          outputLines.shift();
        }
      },

      getResults: function () {
        return outputLines;
      }
    }
  }
}

// sort while inserting
function splice (lines, newLine, sortBy) {
  let l = lines.length
    , compare;

  while (l--) {
    if (typeof lines[l][sortBy] === 'number' && typeof newLine[sortBy] === 'number')
      compare = lines[l][sortBy] < newLine[sortBy] ? -1 : 1;
    else
      compare = String(lines[l][sortBy]).localeCompare(newLine[sortBy]);

    if (compare < 0)
      break;
  }

  lines.splice(l + 1, 0, newLine);
  return lines;
}

// line parser function
// @todo: will be customisable to be used for logs
// other than ELB's
function parseLine (line) {
  const ATTRIBUTES = line.split(' ');
  let user_agent = '';

  for (let i = 14; i < ATTRIBUTES.length - 2; i++) {
    user_agent = user_agent + ATTRIBUTES[i] + " ";
  }

  return {
    'timestamp': ATTRIBUTES[0],
    'elb': ATTRIBUTES[1],
    'client:port': ATTRIBUTES[2],
    'backend:port': ATTRIBUTES[3],
    'request_processing_time': ATTRIBUTES[4],
    'backend_processing_time': ATTRIBUTES[5],
    'response_processing_time': ATTRIBUTES[6],
    'elb_status_code': ATTRIBUTES[7],
    'backend_status_code': ATTRIBUTES[8],
    'received_bytes': ATTRIBUTES[9],
    'sent_bytes': ATTRIBUTES[10],
    'request': ATTRIBUTES[11] +' '+ ATTRIBUTES[12] +' '+ ATTRIBUTES[13],
    'requested_resource': ATTRIBUTES[12],
    'user_agent': user_agent,
    'total_time': parseFloat(ATTRIBUTES[4]) + parseFloat(ATTRIBUTES[5]) + parseFloat(ATTRIBUTES[6])
  };
}
