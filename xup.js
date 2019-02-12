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

String.prototype.RemoveAccents = function () {
//  var strAccents = strAccents.split('');
 var strAccents = this.split('');
 var strAccentsOut = new Array();
 var strAccentsLen = strAccents.length;
 var accents = 'ÀÁÂÃÄÅàáâãäåÒÓÔÕÕÖØòóôõöøÈÉÊËèéêëðÇçÐÌÍÎÏìíîïÙÚÛÜùúûüÑñŠšŸÿýŽž';
 var accentsOut = "AAAAAAaaaaaaOOOOOOOooooooEEEEeeeeeCcDIIIIiiiiUUUUuuuuNnSsYyyZz";
 for (var y = 0; y < strAccentsLen; y++) {
   if (accents.indexOf(strAccents[y]) != -1) {
     strAccentsOut[y] = accentsOut.substr(accents.indexOf(strAccents[y]), 1);
   } else
     strAccentsOut[y] = strAccents[y];
 }
 strAccentsOut = strAccentsOut.join('');
 return strAccentsOut;
}

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
//const password = argv.password || process.env.PGPASSWORD;
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
  console.log(`
    ----------------------------------------
    MISSING password,
    use option -p <password>
    or set environment variable PGPASSWORD.
    EXIT.
    ----------------------------------------
    `);
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


let s3publisher_id =null;

cms.open_cms(db_conn)
.then(async (retv) =>{
  //console.log(Object.keys(retv))
  const db = retv.db;
  package_id = retv.package_id;
  if (argv.pg_monitor) {
    monitor.attach(db.driverConfig);
  }
  await main(db);
  cms.close_cms();
})
.catch(err=>{
  console.log(`db_conn:`,db_conn)
  cms.close_cms();
  console.log('fatal err:',err)
  console.trace();
  throw `fatal-247 err =>"${err.message}"`
})

/*
     1. load xlsx
     2. get package_id, folder_id (app_folder)
     3. get s3publisher_id
     4. option zero-catalogs, then reload catIndex
     5. option zero-constructeurs, then reload pIndex
     6. option zero-articles, then reload s3Index
     7. option zero-auteurs, then reload auIndex
     8. commit missing construteurs-catalogs
     9. commit missing auteurs-articles
*/

const catIndex = {};
const s3Index = {};
const pIndex = {}; // constructeurs.
const auIndex = {};

async function main(db) {
  const retv1 = await db.query(`
    select * from cms_instances where name = 'cms-236393';
    `,[],{single:true})

  const {package_id, folder_id} = retv1;
  _assert(package_id, retv1, 'Missing package_id')
  _assert(folder_id, retv1, 'Missing folder_id')

  await (async ()=>{
    const title = 's3publisher';
    const name = utils.nor_au2(title);
    const s3 = await cms.publisher__new({
      name,
      title,
      data: {name,title}
    })
    const {item_id:parent_id} = s3;
    _assert(parent_id, s3, 'fatal-1397 Unable to get s3publisher parent_id');
    s3publisher_id = parent_id;
  })();

  assert(s3publisher_id)

  // -----------------------------------------------------------------------
  if (argv[`zero-cat`]) {
    console.log(`zero-catalogues plz wait...`)
    const retv = await db.query(`
      delete
      from acs_objects o
      using cr_items as i
      where o.package_id = $1
      and o.object_type = 'cms-article'
      and i.parent_id != $2
    ;`,[package_id, s3publisher_id], {single:true});
    console.log(`zero-catalogues retv:`,retv);
  }


  ; await (async ()=>{
    const retv5 = await db.query(`
      select item_id, title, name
      from cms_articles__directory
      where package_id = $1
      and parent_id != $2
    ;`,[package_id, s3publisher_id], {single:false});

    console.log(`Found ${retv5.length} catalogs in CMS. dumping on "cms-catalogs-directory.json"`);

    if (argv['zero-cat'] && (retv5.length >0)) {
      console.log(`
        ==================================================
        FATAL: a (--zero-cat) was requested,
        but CMS gives ${retv.length} catalogs!
        EXIT.
        ==================================================
        `);
      process.exit(-1);
    }

    retv5.forEach(it => {catIndex[it.name] = it;});
    jsonfile.writeFileSync('cms-catalogs-directory.json',catIndex,{spaces:2});
    console.log(`catIndex: ${retv5.length} catalogues`)
  })()

  // -----------------------------------------------------------------------

  if (argv[`zero-constructeurs`]) {
    console.log(`zero-constructeurs plz wait...`)
    const retv = await db.query(`
      delete
      from acs_objects o
      using cr_items as i
      where o.package_id = $1
      and o.object_type = 'cms-publisher'
      and i.item_id != $2;
    `,[package_id, s3publisher_id], {single:true});

    console.log(`zero-constructeurs retv:`,retv);
  }

  // -------------------------------------------------------------------------
  ; await (async ()=>{
    const retv4 = await db.query(`
      select item_id, title, name
      from cms_publishers__directory
      where package_id = $1
      and item_id != $2;
    ;`,[package_id, s3publisher_id], {single:false});

    console.log(`Found ${retv4.length} registered constructeurs in CMS. dumping on "cms-constructeurs-directory.json"`);
    retv4.forEach(it => {pIndex[it.name] = it;});
    jsonfile.writeFileSync('cms-constructeurs-directory.json',pIndex,{spaces:2});
  })();

  // -----------------------------------------------------------------------

  if (argv[`zero-auteurs`]) {
    console.log(`zero-auteurs plz wait...`)
    const retv = await db.query(`
      delete
      from acs_objects o
      using cr_items as i
      where o.package_id = $1
      and o.object_type = 'cms-author'
      and i.parent_id = 236394
    ;`,[package_id], {single:true});
    console.log(`zero-auteurs retv:`,retv);
  }

  // -----------------------------------------------------------------------

  ; await (async ()=>{
    const retv4 = await db.query(`
      select item_id, title, name
      from cms_authors__directory
      where package_id = $1;
    `,[package_id], {single:false});

    console.log(`Found ${retv4.length} registered auteurs in CMS. dumping on "cms-auteurs-directory.json"`);

    if (argv['zero-auteurs'] && (retv4.length >0)) {
      console.log(`
        ==================================================
        FATAL: a (--zero-auteurs) was requested,
        but CMS gives ${retv.length} auteurs!
        EXIT.
        ==================================================
        `);
      process.exit(-1);
    }

    retv4.forEach(it => {auIndex[it.name] = it;});
    jsonfile.writeFileSync('cms-auteurs-directory.json',auIndex,{spaces:2});
  })()

  // -----------------------------------------------------------------------

  if (argv[`zero-articles`]) {
    console.log(`zero-articles plz wait...`)
    const retv = await db.query(`
      delete
      from acs_objects o
      using cr_items as i
      where o.package_id = $1
      and o.object_type = 'cms-article'
      and i.parent_id = $2
    ;`,[package_id, s3publisher_id], {single:true});
    console.log(`zero-articles retv:`,retv);
  }

  // -----------------------------------------------------------------------

  ; await (async ()=>{
    const retv5 = await db.query(`
      select item_id, title, name
      from cms_articles__directory
      where package_id = $1
      and parent_id = $2
    ;`,[package_id, s3publisher_id], {single:false});

    console.log(`Found ${retv5.length} articles in CMS. dumping on "cms-articles-directory.json"`);

    if (argv['zero-articles'] && (retv5.length >0)) {
      console.log(`
        ==================================================
        FATAL: a (--zero-articles) was requested,
        but CMS gives ${retv.length} articles!
        EXIT.
        ==================================================
        `);
      process.exit(-1);
    }

    retv5.forEach(it => {s3Index[it.name] = it;});
    jsonfile.writeFileSync('cms-articles-directory.json',s3Index,{spaces:2});
    console.log(`s3Index: ${retv5.length} articles(s3)`)
  })()

  // -----------------------------------------------------------------------
  await update_auIndex(xlsx) // with option to (--commit).
  //  (auteurs_Index, pdf_Index)

  // -----------------------------------------------------------------------
  /*
  if (argv[`zero-aa`]) {
    console.log(`zero-aa plz wait...`)
    const retv = await db.query(`
      delete
      from acs_objects o
      using cr_items as i
      where o.package_id = $1
      and o.object_type = 'cms-author'
      and i.parent_id = 236394
    ;`,[package_id], {single:true});
    console.log(`zero-auteurs retv:`,retv);
  }*/


  await commit_aa_relations(auIndex);

  await update_pIndex(xlsx);
}


console.log(`Entering async-mode.`);
/*
============================================================================
helpers.
============================================================================
*/

async function update_auIndex(xlsx) {
  let s3_committedCount =0;
  let committedCount =0;
  let missedCount1 =0;
  let missedCount2 =0;
  let missedCount3 =0;
  let totalArticles =0;

  for (ix in xlsx) {
    const it = xlsx[ix];
    if (it.deleted) continue;
    if (it.sec !=3) continue;
    totalArticles ++; // s3-articles.

    /*
        STEP 1: find the article - create if not found.
    */

    const s3_title = `${it.yp}-${it.indexNames[0]}`;
    const s3_name = `mapp-article3-${it.xid}`;

    if (!s3Index[s3_name]) {
      if (argv.commit) {
        s3Index[s3_name] = await commit_article(it);
        s3_committedCount ++;
        if (verbose) {
          console.log(`after commit s3Index[${s3_name}]:`,s3Index[s3_name])
        }
        _assert(s3Index[s3_name], s3Index[s3_name], `fata-@303 s3Index not updated for <${s3_title}> xid:${it.xid}`)
        if (s3_committedCount >=limit) break;
      } else {
        if (verbose) {
          console.log(`${missedCount2} ALERT article <${s3_title}> not found`)
        }
      }
    }
    // re-test.
    _assert(s3Index[s3_name], it, `fatal-@315 Unable to locate article <${s3_name}>`)
    _assert(Array.isArray(it.auteurs), it, 'fatal-@198 missing auteur or auteurs not an Array.')

    /*
        STEP 2: find the auteur - create if not found.
    */

    const au_title = it.auteurs[0]; // official name for auteur instead of h1.
    const au_name = utils.nor_au2(au_title +'auteur');
    if (!auIndex[au_name]) {
      missedCount2++
      // IF COMMIT ALLOWED
      if (argv.commit) {
        auIndex[au_name] = await commit_auteur(au_name, au_title);
        committedCount ++;
        if (verbose) {
          console.log(`after commit auIndex[${au_name}]:`,auIndex[au_name])
        }
        _assert(auIndex[au_name], auIndex[au_name], `auIndex not updated for <${au_title}>`)
        if (committedCount >=limit) break;
      } else {
        if (verbose) {
          console.log(`${missedCount2} ALERT auteur <${au_title}> not found, ADDING...`)
        }
      }
    }

    if (auIndex[au_name]) {
      /*
          FIRST check if article exists in cms
          an article is found by its name.
      */
      auIndex[au_name].articles = auIndex[au_name].articles || [];
      auIndex[au_name].articles.push(it);
    } else {
      missedCount3 ++;
    }
  } // each line xlsx
  console.log(`update-auIndex missed1:${missedCount1} missed2:${missedCount2} committed:${committedCount}`)
  console.log(`update-auIndex missed3:${missedCount3} `)
  console.log(`update-auIndex totalArticles:${totalArticles} `)
}

// ---------------------------------------------------------------------------

async function commit_aa_relations(auIndex) {
  let noaCount =0;
  let nauteurs =0;
  let totalArticles =0;
  for (auName in auIndex) {
    nauteurs ++;
    const auteur = auIndex[auName];
//    console.log(`auteur <${auteur.title}>[${auteur.name}] articles:${auteur.articles.length}`)
    if (auteur.articles.length >0) {
//      console.log(`<${auteur.title} has ${auteur.articles.length} articles`)
      totalArticles += auteur.articles.length;
      const s = new Set(auteur.articles);
      _assert(s.size == auteur.articles.length, auteur, `doublons in articles set.size:${s.size}`)
      for (ix in auteur.articles) {
        const article = auteur.articles[ix];
        await commit_relation_article_auteur(article,auteur)
      }
    } else {
//      console.log(`ALERT auteur <${auteur.title}>[${auteur.name}] articles:${auteur.articles.length}`)
      noaCount++;
    }
  }
  console.log(`update_aa_relations: ${noaCount}:(${nauteurs}) auteurs without articles (total:${totalArticles})`)
  return;

  async function commit_relation_article_auteur(article,auteur) {
    if (verbose) {
      console.log(`commit_relation_article_auteur <${article.indexNames[0]}>[${article.item_id}]-----><${auteur.title}>`)
    }
  }
}


// ---------------------------------------------------------------------------

function relink(xlsx, auteurs_Index, pdf_Index) {
  let relCount =0;
  let pCount =0;
  let pNoLinks =0; // auteurs without catalogs

  for (key in auteurs_Index) {
    const p = auteurs_Index[key];
    if (p.links) {
//      console.log(`-- <${p.title}>`,p.links.size);
      relCount += p.links.size;
    } else {
      pNoLinks ++;
      console.log(`-- <${p.title}> NO LINKS`);
    }
    pCount ++;
  }

  console.log(`
    ---------------------------------------------
    ${pCount} auteurs
    ${relCount} relations added.
    ${pNoLinks} auteurs without catalogs.
    ---------------------------------------------
    `)
}

// ---------------------------------------------------------------------------

async function commit_auteur(name,title) {
  _assert(argv.commit, argv, 'fatal-@331 commiting when (--commit) not set')
  const data = {
    name,
    title
  };
  const new_revision = {
    item_id:null,
    name,
    title,
    checksum: hash(data, {algorithm: 'md5', encoding: 'base64' }),
    data
  }
  const retv = await cms.author__save(new_revision);
  _assert(!retv.error, new_revision, `fatal-@420 auteur <${title}> already in DB.`)
//  console.log(`commit_auteur retv:`,retv)
  return retv;
}

// ---------------------------------------------------------------------------

async function commit_article(it) {
  _assert(!it.item_id, it, 'fatal-@438 not ready.')
  const {xid, sec,
    yp, circa,
    pic,
    h1, // titre de l'article
    h2,
    fr, en, zh,
    mk,
    co, ci, sa,
    links, transcription, restricted,
    indexNames, // entries in index.
    auteurs:_auteurs // to avoid confict with global auteurs[]
  } = it; // from xlsx, reformat adding publisherName.

  _assert(Array.isArray(indexNames) && (indexNames.length>0), it, 'fatal-1284 indexNames not an Array or null')
  _assert(Array.isArray(_auteurs) && (_auteurs.length>0), it, 'fatal-1285 auteurs not an Array or null')

  const name = `mapp-article3-${xid}`;
  const title = `${yp}-${indexNames[0]}`;

  const data = {
    xid, sec, yp, circa, pic, co,
    h1, h2, fr, en, zh, mk, ci, sa,
    links, transcription, restricted,
    auteurs:_auteurs, // should we use the normalized form ?
    indexNames
  }

  const checksum = hash(data, {algorithm: 'md5', encoding: 'base64' });

  const a1 = {
    item_id: null,
    parent_id: s3publisher_id,
    name,
    title, // indexName
    data,
//      xid, // is known for new catalogs.
//      auteurs: _auteurs,
//      indexNames, // for index.
    checksum,
    dirty: true
  }

  const w1 = await cms.article__save(a1);
  _assert(!w1.error, {a1,w1}, 'fatal-@485 Unable to commit article(S3)')

  const retv = w1.revision_id; // MESSYYYYYY
  console.log(`new article(s3) committed item_id:${retv.item_id} revision_id:${retv.revision_id} [${a1.name}]<${a1.title}>`)
  return a1;
}

// ---------------------------------------------------------------------------


async function update_pIndex(xlsx) {
  let committedCount =0;
  let missedCount1 =0;
  let missedCount2 =0;
  let cat_committedCount =0;

  for (ix in xlsx) {
    const it = xlsx[ix];
    if (it.deleted) continue;
    if (it.sec ==3) continue
    _assert(Array.isArray(it.indexNames), it, 'fatal-@132 indexNames.')

    /*
        STEP 1: find the constructeur - create if not found.
    */

    const p = it.indexNames[0]; // official name for constructeur instead of h1.
    const p_name = utils.nor_au2(p);
    if (!pIndex[p_name]) {
      missedCount2++
      // IF COMMIT ALLOWED
      if (argv.commit) {
        pIndex[p_name] = await commit_constructeur(p_name, p);
        committedCount ++;
        if (committedCount >=limit) break;
      } else {
        if (verbose) {
          console.log(`${missedCount2} ALERT constructeur <${p}> not found, ADDING...`)
        }
      }
    }

    if (pIndex[p_name]) {
      pIndex[p_name].catalogs = pIndex[p_name].catalogs || [];
      pIndex[p_name].catalogs.push(it);
    }

    /*
        STEP 2: find the catalog - create if not found.
        then link to the constructeur.
    */

    const cat_title = `${it.yp}-${it.indexNames[0]}`;
    const cat_name = `mapp-catalog-${it.xid}`;

    if (!catIndex[cat_name]) {
      if (argv.commit) {
        catIndex[cat_name] = await commit_catalog(it, pIndex[p_name].item_id);
        cat_committedCount ++;
        if (verbose) {
          console.log(`after commit catIndex[${cat_name}]:`,catIndex[cat_name])
        }
        _assert(catIndex[cat_name], catIndex[cat_name], `fata-@303 catIndex not updated for <${cat_title}> xid:${it.xid}`)
        if (cat_committedCount >=limit) break;
      } else {
        if (verbose) {
          console.log(`${missedCount2} ALERT catalog <${cat_title}> not found`)
        }
      }
    }
    // re-test.
    _assert(catIndex[cat_name], it, `fatal-@315 Unable to locate catalog <${cat_name}>`)
//    _assert(Array.isArray(it.auteurs), it, 'fatal-@198 missing auteur or auteurs not an Array.')

  } // each line xlsx
  console.log(`update-pIndex missed1:${missedCount1} missed2:${missedCount2} committed:${committedCount}`)
}

// ---------------------------------------------------------------------------


async function commit_catalog(it, constructeur_id) {
  _assert(!it.item_id, it, 'fatal-@438 not ready.')
  const {xid, sec,
    yp, circa,
    pic,
    h1, // titre de l'article
    h2,
    fr, en, zh,
    mk,
    co, ci, sa,
    links, transcription, restricted,
    indexNames, // entries in index.
//    auteurs:_auteurs // to avoid confict with global auteurs[]
  } = it; // from xlsx, reformat adding publisherName.

  _assert(Array.isArray(indexNames) && (indexNames.length>0), it, 'fatal-1284 indexNames not an Array or null')
//  _assert(Array.isArray(_auteurs) && (_auteurs.length>0), it, 'fatal-1285 auteurs not an Array or null')

  const name = `mapp-catalog-${xid}`;
  const title = `${yp}-${indexNames[0]}`;

  const data = {
    xid, sec, yp, circa, pic, co,
    h1, h2, fr, en, zh, mk, ci, sa,
    links, transcription, restricted,
//    auteurs:_auteurs, // should we use the normalized form ?
    indexNames
  }

  const checksum = hash(data, {algorithm: 'md5', encoding: 'base64' });

  const a1 = {
    item_id: null,
    parent_id: constructeur_id,
    name,
    title, // indexName
    data,
//      xid, // is known for new catalogs.
//      auteurs: _auteurs,
//      indexNames, // for index.
    checksum,
    dirty: true
  }

  const w1 = await cms.article__save(a1);
  _assert(!w1.error, {a1,w1}, 'fatal-@485 Unable to commit catalog.')

  const retv = w1.revision_id; // MESSYYYYYY
  console.log(`new catalog committed item_id:${retv.item_id} revision_id:${retv.revision_id} [${a1.name}]<${a1.title}>  sec:${a1.data.sec} xid:${a1.data.xid}`)
  return a1;
}

// ---------------------------------------------------------------------------

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
//  .replace(/20[0-9]{6}/,' ') // remove revision date NO ! max.
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
