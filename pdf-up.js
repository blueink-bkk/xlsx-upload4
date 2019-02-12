#! /usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const assert = require('assert');

const Massive = require('massive');
const monitor = require('pg-monitor');
const pdfjsLib = require('pdfjs-dist');
const yaml = require('js-yaml');
const jsonfile = require('jsonfile');
const utils = require('./dkz-lib.js');
const hash = require('object-hash');
const cms = require('./cms-openacs.js');

const argv = require('yargs')
  .alias('q','phase')
  .alias('f','file')
  .alias('d','dir')
  .alias('a','all')
  .alias('v','verbose').count('verbose')
  .boolean('pg-monitor')
  .boolean('commit')
  .options({
    'commit': {default:false},
    'phase': {default:0},
    'stop': {default:true}, // stop when error, if --no-stop, show error.
    'show-collisions': {default:false, alias:'k'},
    'pg-monitor': {default:true},
    'limit': {default:99999}, // stop when error, if --no-stop, show error.
    'zero-auteurs': {default:false}, //
  }).argv;

  var yaml_env;

  ;(()=>{
    const yaml_env_file = argv['yaml-env'] || './.env.yaml';
    try {
      yaml_env = yaml.safeLoad(fs.readFileSync(yaml_env_file, 'utf8'));
      //console.log('env:',yaml_env);
    } catch (err) {
      console.log(err.message);-
      console.log(`
        Fatal error opening env-file <${yaml_env_file}>
        Try again using option -y
        ex: ./upload3 -y .env-32024-ultimheat
        `)
      process.exit(-1);
    }
  })();


const verbose = argv.verbose;
const password = argv.password || process.env.PGPASSWORD;
const host = argv.host || process.env.PGHOST || 'inhelium.com';
const port = argv.port || process.env.PGPORT || '5432';
const database = argv.database || process.env.PGDATABASE || 'cms-oacs';
const user = argv.user || process.env.PGUSER || 'postgres';
const limit = argv.limit || 99999;

const db_conn = {
  host: argv.host || process.env.PGHOST || yaml_env.host,
  port: argv.port || process.env.PGPORT || yaml_env.port,
  database: argv.database || process.env.PGDATABASE || yaml_env.database,
  user: argv.user || process.env.PGUSER || yaml_env.user,
  password: argv.password || process.env.PGPASSWORD,
  pg_monitor: argv.pg_monitor || yaml_env.pg_monitor,
  app_instance: argv.app_instance || yaml_env.app_instance
}

if (!db_conn.password) {
  console.log(`MISSING or invalid password in:`,db_conn);
  return;
}

var xlsx_fn = argv._[0] || yaml_env.xlsx;
if (!xlsx_fn) {
    console.log('Missing xlsx file.');
    return;
}

if (!fs.existsSync(xlsx_fn)) {
  console.log(`xlsx file <${xlsx_fn}> does not exist.`);
  process.exit(-1);
} else {
  console.log(`processing xlsx file <${xlsx_fn}>`);
}

const xlsx = require('./xlsx2json.js')(xlsx_fn);

let deleted_Count =0;
let xlsx_Count =0;
;(()=>{
  xlsx.forEach(it=>{
    xlsx_Count ++;
    if (it.deleted) deleted_Count ++;
  })
  console.log(`xlsx total-rows:${xlsx_Count} deleted:${deleted_Count}`)
})()

// -----------------------------------------------------------------------
const pdf_search_inputs = yaml_env.pdf_inputs; // ARRAY.

const searchIndex = require('./mk-search-index.js')(pdf_search_inputs, ['\.pdf$'])

xlsx_missing_in_searchIndex(searchIndex);


// -----------------------------------------------------------------------
let db = null;
let pdf_root_folder =null; //folder_id
const pdfdir ={};

cms.open_cms(db_conn)
.then(async (retv) =>{
  //console.log(Object.keys(retv))
  db = retv.db;
  package_id = retv.package_id;
  if (argv.pg_monitor) {
    monitor.attach(db.driverConfig);
  }
  await main(db);
  cms.close_cms();
  console.log(`EXIT1 Ok.`)
})
.catch(err=>{
  console.log(`db_conn:`,db_conn)
  cms.close_cms();
  console.log('fatal err:',err)
  console.trace();
  throw `fatal-247 err =>"${err.message}"`
})

// ==========================================================================

async function main(db) {
  const {package_id, folder_id} = await select_cms_instance(db);
  const {folder_id:_pdf_root_folder} = await select_cms_pdf_root_folder(db);
  pdf_root_folder = _pdf_root_folder; // aie.

  if (argv[`zero-pdf`]) {
    console.log(`zero-pdf plz wait...`)
    const retv = zero_pdf(db);
    console.log(`zero-pdf retv:`,retv);
  }

  const vf = await cms.pdf__directory();
  vf.forEach(it => {pdfdir[it.name] = it;})
  if (true) {
    console.log(`pdf-directory contains ${Object.keys(pdfdir).length} file-names`)
  }

  await update_pdf_directory(pdfdir);

}

// ==========================================================================

async function select_cms_instance(db) {
  const retv1 = await db.query(`
    select * from cms_instances where name = 'cms-236393';
    `,[],{single:true})

  const {package_id, folder_id} = retv1
  _assert(package_id, retv1, 'fatal-@139 Missing package_id')
  _assert(folder_id, retv1, 'fatal-@140 Missing folder_id')
  return retv1;
}

// --------------------------------------------------------------------------

async function select_cms_pdf_root_folder(db) {
  const retv2 = await db.query(`
    select folder_id from cms_folders where name = 'pdf-root' and package_id = $1;
    `,[package_id], {single:true});

  if (!retv2) {
    console.log(`
      pdf-root folder is not found in package_id:${package_id}
      restart the program with option --create-pdf-root
      `);
    program.exit(-1)
  }

  const {folder_id:pdf_root_folder} = retv2;
  _assert(pdf_root_folder, retv2, 'Missing pdf_root_folder')
  console.log(`pdf-root-folder found at ${pdf_root_folder} Ok.`)
  return retv2;
}

// --------------------------------------------------------------------------

async function zero_pdf(db, root_folder) {
  const retv = await db.query(`
    delete
    from acs_objects o
    using cr_items as i
    where o.package_id = $1
    and o.object_type = 'pdf_file'
    and i.parent_id = $2
  ;`,[package_id, root_folder], {single:true});

}

// --------------------------------------------------------------------------

function xlsx_missing_in_searchIndex(searchIndex) {
  _assert(searchIndex, searchIndex, 'fatal-@190 Missing searchIndex')
  const ufn = {};
  const primary_folder = pdf_search_inputs[0];
  let alternateHits =0;
  let missingCount =0;

  for (ix in xlsx) {
    const it = xlsx[ix];
    if (it.deleted) continue;
    const files = it.links;
    files.forEach(file =>{
      const fn = file.fn +'.pdf';
      ufn[fn] = ufn[fn] || [];
      ufn[fn]++;
      if (!searchIndex[fn]) {
        console.log(`-- file ${fn} not found in searchIndex`)
        missingCount ++;
      } else {
        // check for primary folder...
        const dirname = path.dirname(searchIndex[fn].files[0].fn);
        if (dirname != primary_folder) {
          console.log(`-- file ${fn} found in alternate folder: ${dirname}`)
          alternateHits ++;
        }
      }
    })
  }; // each xlsx
  console.log(`xlsx-missing-in-searchIndex: ${missingCount} not found
    ${alternateHits} were found in alternate folders.
    `)
}

// --------------------------------------------------------------------------

async function update_pdf_directory(pdfIndex) {
  const ufn = {};
  const primary_folder = pdf_search_inputs[0];
  let alternateHits =0;
  let missingCount =0;
  let committedCount =0;

  for (ix in xlsx) {
    const it = xlsx[ix];
    if (it.deleted) continue;
    for (j in it.links) {
      const file = it.links[j];
      const fn = file.fn +'.pdf';
      const name = nor_fn(fn)
      ufn[name] = ufn[name] || []; ufn[name]++;
      if (!pdfIndex[name]) {
        if (verbose) {
          console.log(`-- file ${fn} [${name}] not found in pdfIndex`)
        }
        missingCount ++;
        if (argv.commit) {
          if (!searchIndex[fn]) {
            console.log(`Unable to find <${fn}> Skipping commit.`)
          } else {
            await commit_pdf(db,fn);
            committedCount ++;
            if (committedCount >=limit) break;
          }
        }
      }
    } // each pdf.
    if (committedCount >=limit) {
      console.log(`
        ----------------------------------------
        limit ${limit} reached (committed:${committedCount})
        EXIT.
        ----------------------------------------
        `)
      process.exit(-1)
      break; // need to repeat this test.
    }
  }; // each xlsx


  console.log(`update_pdf_directory: ${Object.keys(ufn).length} xpdf not found in CMS (pdfdir).`)
  if (missingCount>0) {
    console.log(`
      --------------------------------------------------
      restart using option (--commit) to restore in CMS.
      --------------------------------------------------
      `);
    process.exit(-1);
  }
} // update-pdf-directory

// --------------------------------------------------------------------------

async function commit_pdf(db, baseName) {
  const primary_folder = pdf_search_inputs[0];
  assert(pdf_root_folder);

  _assert(searchIndex[baseName], baseName, `fata-@285 Missing file`)
  _assert(searchIndex[baseName].files[0].fn, searchIndex[baseName].files, `fata-@286 Missing file`)
  const dirname = path.dirname(searchIndex[baseName].files[0].fn);
  _assert(dirname == primary_folder, dirname, 'fatal-@289')
  const fullName = searchIndex[baseName].files[0].fn
  const doc = await pdfjsLib.getDocument(fullName);

  console.log(`committing npages:${doc.numPages} for <${baseName}>`);

  const retv3 = await db.query(`
    select * from cms_revision__commit($1)
    `,[{
    parent_id: pdf_root_folder,
    title: baseName,
    item_subtype: 'pdf_file',
    package_id,
    name: nor_fn(baseName),
    data: {
      dirname, // origin folder - just for infos.
    },
    verbose:1
  }], {single:true});


  if (verbose) console.log(`retv3:`,retv3)
  _assert(retv3, retv3, 'Invalid cr_item1')
  _assert(retv3.cms_revision__commit, retv3, 'Invalid cr_item2')

  const {item_id, revision_id} = retv3.cms_revision__commit;
  _assert(item_id && revision_id, retv3, 'Invalid cr_item')

  for (let pageNo=1; pageNo <=doc.numPages; pageNo++) {
    const page = await doc.getPage(pageNo);
    const textContent = await page.getTextContent();
    const raw_text = textContent.items
      .map(it => it.str).join(' ')
      .replace(/\s+/g,' ')
      .replace(/\.\.+/g,'.');

    if (argv.commit) {
      try {
//          console.log(`-- page ${pageNo} raw_text:${raw_text.length}`);
        const o = {
          revision_id,
          url:baseName, pageNo,
          raw_text
        };
        const db2 = db.cms;
//          const retv = await db.cms.pdf_page__commit(o);
        const retv = await db.query(`select cms.pdf_page__commit($1)`,[o], {single:true});
//          console.log(`-- page ${pageNo} raw_text:${raw_text.length} retv:`,retv.pdf_page__commit)
        if (retv.error) {
          console.log(`-- pdf ${baseName}##${pageNo} =>retv:`,retv.pdf_page__commit)
        } else {
          if (verbose) {
            console.log(`--SUCCESS pdf_page_commit ${baseName}##${pageNo} revision_id:${retv.pdf_page__commit.revision_id}`)
            console.log(`-- pdf ${baseName}##${pageNo} =>retv:`,retv.pdf_page__commit)
          }
        }
      }
      catch(err) {
        console.log(err)
      }
    }
  }; // each page
} // commit_pdf

// --------------------------------------------------------------------------
function _assert(b, o, err_message) {
  if (!b) {
    console.log(`######[${err_message}]_ASSERT=>`,o);
    console.trace(`######[${err_message}]_ASSERT`);
    throw {
      message: err_message // {message} to be compatible with other exceptions.
    }
  }
}

// ---------------------------------------------------------------------------

function nor_fn(s) {
  const charCodeZero = "0".charCodeAt(0);
  const charCodeNine = "9".charCodeAt(0);
  function isDigitCode(n) {
     return(n.charCodeAt(0) >= charCodeZero && n.charCodeAt(0) <= charCodeNine);
  }
  // strip accents.
  const tail = [];
  const h = {};
  const v = s && (''+s).toLowerCase()
  .RemoveAccents()
  .replace(/20[0-9]{6}/,' ') // remove revision date
  .replace(/[\(\)\-\.\']/g,' ')
//  .replace(/[^a-z]/g,' ')
  .replace(/\s+/g,'') // insenstive to spaces, dots, dashes and ().
  .split('')
  .forEach(cc=>{
    if (isDigitCode(cc)) {
      tail.push(cc)
    } else {
      h[cc] = h[cc] || 0;
      h[cc] ++;
    }
  })

  const s2 = Object.keys(h).map(cc=>{
    return (h[cc]>1)?`${cc}${h[cc]}`:cc;
  })

  const s3 = s2.join('')+tail.join('');
//  console.log(`nor_fn(${s})=>(${s3})`)
  return s3
}

// ---------------------------------------------------------------------------
