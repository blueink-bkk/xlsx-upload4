const fs = require('fs-extra');
const path = require('path');
const assert = require('assert');

module.exports = function mk_search_index(inputs, patterns, o) {
  o = o ||{}
  const hhd = {}; // directories where files found
  const index = {}; // for each baseName => list of {fn, fsize, mt}
  const _index = {};

  if (inputs.length<=0) return [];

  inputs.forEach(absolutePath=>{
    // validate folder exists.
    if (!fs.existsSync(absolutePath)) throw `fatal-@538 <${absolutePath}> not found.`
    if (!fs.statSync(absolutePath).isDirectory()) throw `fatal-@539 <${absolutePath}> not a directory.`
  });

  let nfiles =0;
  let total_size =0; // for all files visited (found)

  inputs.forEach(absolutePath=>{
  for (const fn of walkSync(absolutePath, patterns)) {
      // do something with it
//      if ((argv.phase ==2)&&(argv.verbose)) {
//        console.info(`${++nfiles} ${fn}`);
//      }
      const stats = fs.statSync(fn)
      const base = path.basename(fn)
      const dirname = path.dirname(fn)
      total_size += stats.size;

      // frequence
      hhd[dirname] = hhd[dirname] || 0;
      hhd[dirname]++;

      const new_data = { // override existing
        fn,
        fsize: stats.size,
        mt: stats.mtime.toString()
      }

      if (_index[fn]) {
        _index[fn] = new_data; // override obsolete-one.
        // is already in index[base].files
      } else {
        _index[fn] = new_data; // override obsolete-one.
        index[base] = index[base] || {files:[]}
        index[base].files.push(new_data);
//        total_moved += stats.size;
      }
      /*
          check on fsize.
          Raise sflag if not all the files have same size.
          That will prevent any copy or move operation.
      */
      index[base].fsize = index[base].fsize || stats.size;
      if (index[base].fsize != stats.size) {
        index[base].sflag = true;
      }

      index[base].mt = index[base].mt || new_data.mt;
      if (index[base].mt != new_data.mt) {
        index[base].mtflag = true;
      }

      index[base].latest_revision = index[base].latest_revision || new_data.mt;
      if (index[base].latest_revision > new_data.mt) {
        index[base].latest_revision = new_data.mt;
      }
    }
  })
  console.log(`searchIndex contains ${Object.keys(index).length} entries (unique-basename)`)
  console.log(`searchIndex has ??? files not found in main-directory`)
  if (o.verbose) {
    // show stats on folders,...
  }
  return index;
} // mk_search_index


function *walkSync(dir,patterns) {
  const files = fs.readdirSync(dir, 'utf8');
//  console.log(`scanning-dir: <${dir}>`)
  for (const file of files) {
    try {
      const pathToFile = path.join(dir, file);
      if (file.startsWith('.')) continue; // should be an option to --exclude
        const fstat = fs.statSync(pathToFile);
      const isSymbolicLink = fs.statSync(pathToFile).isSymbolicLink();
      if (isSymbolicLink) continue;

      const isDirectory = fs.statSync(pathToFile).isDirectory();
      if (isDirectory) {
        if (file.startsWith('.')) continue;
          yield *walkSync(pathToFile, patterns);
      } else {
        if (file.startsWith('.')) continue;
        let failed = false;
        for (pat of patterns) {
          const regex = new RegExp(pat,'gi');
          if (file.match(regex)) continue;
          failed = true;
          break;
        };
        if (!failed)
        yield pathToFile;
      }
    }
    catch(err) {
      console.log(`ALERT on file:${ path.join(dir, file)} err:`,err)
//      console.log(`ALERT err:`,err)
      continue;
    }
  }
}
