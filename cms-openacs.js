
const assert = require('assert');
const massive = require('massive');
const monitor = require('pg-monitor');
const hash = require('object-hash');

//import R from 'ramda';
//const nspell = require('./nspell.js')
//console.log(`nspell.vdico:`,nspell.vdico);

const verbose = false;
var db ; //= massive(conn); // a promise
var package_id;
var app_folder_id;


// ============================================================================

exports.get_connection = function(){
  assert(db)
  return db;
}

function _assert(b, o, err_message) {
  if (!b) {
    console.log(`######[${err_message}]_ASSERT=>`,o);
    console.trace(`######[${err_message}]_ASSERT`);
    throw {
      message: err_message // {message} to be compatible with other exceptions.
    }
  }
}

// ============================================================================

exports.open_cms = async (cmd) =>{

//  console.log(`exports.open_cms cmd:`,cmd)
  assert(cmd.host);
  assert(cmd.database);
  assert(cmd.user);
  assert(cmd.password);
  assert(cmd.app_instance); // name

  // defaults:
  cmd.port = cmd.port || 5432;

  const conn__ = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'museum-openacs',
    user: process.env.DB_USER,
    password: process.env.DB_PASS
  };


//  package_id = cmd.package_id;

//  cmd.pg_monitor = cmd.pg_monitor || process.env.DB_MONITOR;

  db = await massive(cmd);
  if (cmd.pg_monitor) {
    monitor.attach(db.driverConfig);
    console.log(`pg-monitor attached-Ok.`);
  }

  await set_metadata(cmd);
  assert(package_id)
  assert(app_folder_id)
//  assert(authors_folder_id)
//  assert(publishers_folder_id)
  return {db,package_id,app_folder_id}
}

// ============================================================================

exports.close_cms = async (cmd) =>{
  db.pgp.end();
}

// ============================================================================


async function set_metadata(cmd) {

  /*
      FIRST: locate the app_folder, then get the package_id.
  */

  const find_app_folder = `
    select * from cms_folders f
    join cr_items i on (i.item_id = f.folder_id)
    where (i.parent_id = -100)
    and (i.name = $1)
  `;

  let app_folder = await db.query(find_app_folder,
    [cmd.app_instance], {single:true}
  )

  if (!app_folder) {
    console.log('Unable to get instance metadata - create the instance')
    throw 'fatal-unable to get metadata'
  }

//  console.log(`found app_folder `,app_folder); throw 'stop-96'

  package_id = app_folder.package_id;
  app_folder_id = app_folder.folder_id;


} // get metadata(package_id)


// === AUTHOR =================================================================


exports.cms_author__new_Obsolete = async function(o) {
  assert (app_folder_id)
  assert (package_id)
  assert(o.unique_name, `Missing o.unique_name`);    // cr_items.name unique
  assert(o.title, `Missing title`);          // cr_revisions.title

  const checksum = hash(o, {algorithm: 'md5', encoding: 'base64' }) // goes int cr_revision.
//    return db.query('select content_item__new($1) as data',
  return db.query('select cms_author__new($1)',
    [{
      parent_id: app_folder_id,
      name: o.unique_name,
      package_id,
      text: null, //JSON.stringify(o),
      description: "author initial data",
      title: o.title, // goes int cr_revision.
      jsonb_data: o,
      checksum
    }],
    {single:true});
} // cms_author__new(o)


// === AUTHOR =================================================================

exports.author__new = async function (o) {
  assert(app_folder_id)
  assert(o.title)
  o.name = o.name || o.title; // special name should be done before.
  console.log(`author__new o.name:`,o.name)
  o.description = o.description || `Initial author revision for <${o.title}>`;
  const {name, title, description} = o;

  // title is <last> (<first-middle>) <post-data>.
  // (package_id, o.name) UNIQUE : title after normalization.
  // Normalization => <last>-<first/middle>-<post-data>  with spaces replaced by dashes.

  const data = Object.assign({},{title,description});
  const checksum = hash(data, {algorithm: 'md5', encoding: 'base64' }) // goes int cr_revision.

//    return db.query('select content_item__new($1) as data',
  return db.query('select cms_author__new($1)',
    [{
      parent_id: app_folder_id,
      name,
      package_id,
      text: null, //JSON.stringify(o),
      description,
      title,
      jsonb_data: data,
      checksum
    }],
    {single:true})
    .then(retv=>{
      return retv
    })
    .catch(err=>{
      console.log(`author__new:: error:`,err.message)
      o.error = err.message;
      throw o;
    });
} // cms_author__new(o)


// === ARTICLE ================================================================

/*

    Minimum:
    - item_id
    - data

    Optional:
    - title defaults to name
    - description
    - is_live

*/

exports.article__new = function (o) {
  assert (app_folder_id)
  assert (package_id)

  if (!o.name) {
    console.log(o)
    throw 'fatal-242 unique-name missing.'
  }
  assert (o.title)

  const checksum = hash(o.data, {algorithm: 'md5', encoding: 'base64' }) // goes int cr_revision.

//    return db.query('select content_item__new($1) as data',
  return db.query('select cms_article__new($1)',
  [{
      parent_id: app_folder_id,
      name: o.name,
      package_id,
      text: null, //JSON.stringify(o),
      description: "publisher initial data",
      title: o.title, // goes int cr_revision.
      jsonb_data: o.data,
      checksum
  }],{single:true})
  .then(retv=>{
    return retv.cms_article__new
  })
  .catch(err=>{
    console.log(`cms.article__new(name:${o.name}) error:`,err.message)
    o.error = err.message;
    return o;
  });

} // cms_article__new(o)

// === ARTICLE ================================================================

exports.article__new_revision = function (o) {
  assert (app_folder_id)
  assert (package_id)
  assert (o.data)

  const {item_id, title, name, data} = o;
  assert (data)

  if (!o.name) {
    console.log(o)
    throw 'fatal-242 unique-name missing.'
  }
  assert (o.title)
  assert (item_id && o.item_id)

  const checksum = hash(o.data, {algorithm: 'md5', encoding: 'base64' }) // goes int cr_revision.

//    return db.query('select content_item__new($1) as data',
  return db.query('select cms_article__new_revision($1)',
  [{
      parent_id: app_folder_id,
      item_id,
      name,
      package_id,
      text: null, //JSON.stringify(o),
      description: `cms-article revision xid:${o.data.xid}`,
      title, // goes int cr_revision.
      jsonb_data: data,
      checksum
  }],{single:true})
  .then(retv=>{
    return retv.cms_article__new_revision
  })
  .catch(err=>{
    console.log(`cms.article__new_revision(name:${o.name}) error:`,err.message)
    o.error = err.message;
    return o;
  });

} // article__new_revision(o)

// === ARTICLE ================================================================

exports.cms_article__new_revision_Obsolete = function (o) {
  if (!o.item_id) {
    console.log('cms_article__new_revision o:',o)
    throw 'fatal-798'
  }
  assert (o.data)
//  assert (title)  defaults to name
//  assert (o.name == o.data.name) // o.name CAN'T BE CHANGED.

  const new_checksum = hash(o.data, {algorithm: 'md5', encoding: 'base64' }) // goes int cr_revision.
  if (o.checksum == new_checksum) {
    //console.log('latest revision up-to-date. Nothing to do.')
    console.log(`article revision (latest) is up-to-date. Nothing to do. <${o.name}>`)
    return {
      retCode: 'Ok',
      msg: 'this article is up-to-date.',
      item_id: o.item_id,
      revision_id: o.revision_id
    };
  }

  console.log(`data.checksum:${o.checksum} == new_checksum:${new_checksum}`);

//    console.log(`article__new_revision o:`,data);

  return db.query('select cms_article__new_revision($1)',
    [{
      item_id: o.item_id,
      description:"article revision",
      text: null, // JSON.stringify(o),
      is_live:true,
      title: o.title || o.name,
      jsonb_data: o.data,
      checksum: new_checksum
    }]
    ,{single:true})
  .then(retv =>{
    return retv.cms_article__new_revision
  })
  .catch(err=>{
    console.log(err)
    return {
      err:err
    }
  });

}

// ============================================================================

exports.article__delete = function(item_id) {
  return db.query(`
    delete from acs_objects o
    using cr_items as i
    where (o.object_id = item_id)
    and o.package_id = $(package_id)
    and o.object_type = 'cms-author'
    and i.parent_id = $(app_folder_id);
    `,{package_id, app_folder_id})
  .then(retv =>{
    console.log('retv:',retv)
    return retv;
  })
  .catch(err=>{
    return {error:err.mesage}
  })
}

// ============================================================================

exports.drop_publisher = function(cmd) {
  _assert (cmd.item_id, cmd, 'fatal-348 : Missing item_id')
  const {item_id} = cmd;

  return db.query(`
    delete from acs_objects o
    using cr_items as i
    where (o.object_id = item_id)
    and o.package_id = $(package_id)
    and o.object_type = 'cms-publisher'
    and i.parent_id = $(app_folder_id)
    and i.item_id = $(item_id)
    ;
    `,{package_id, app_folder_id, item_id})
  .then(retv =>{
    console.log('retv:',retv)
    return retv;
  })
  .catch(err=>{
    return {error:err.mesage}
  })
}

// ============================================================================


exports.publisher__new = function (data) {
  assert (app_folder_id)
  assert (package_id)
  assert (data.name, `fatal-234 Missing Name`);          // cr_revisions.title

  data.title = data.title || data.name;

  if (!data.name) {
    console.log(data)
    throw 'fatal-242 unique-name missing.'
  }

  const checksum = hash(data, {algorithm: 'md5', encoding: 'base64' }) // goes int cr_revision.


//    return db.query('select content_item__new($1) as data',
  return db.query('select * from cms_publisher__new($1)',
    [{
      parent_id: app_folder_id,
      name: data.name,
      package_id,
      text: null, //JSON.stringify(o),
      description: "publisher initial data",
      title: data.title, // goes int cr_revision.
      jsonb_data: data,
      checksum
    }],
    {single:true})
    .then(retv=>{
      _assert(retv.cms_publisher__new)
      return retv.cms_publisher__new;
    })
} // cms_publisher__new(o)

// ============================================================================

exports.publisher__new_revision = function (o) {
  assert (app_folder_id)
  assert (package_id)
  assert (o.item_id, `fatal-234 Missing item_id`);          // cr_revisions.title

  if (o.data.name) o.data.name = undefined;
  if (o.title != o.data.title) {
    o.title = o.data.title;
  }

  const checksum = hash(o.data, {algorithm: 'md5', encoding: 'base64' }) // goes int cr_revision.

//    return db.query('select content_item__new($1) as data',
  return db.query('select cms_publisher__new_revision($1)',
    [{
      parent_id: app_folder_id,
      name: data.name,
      package_id,
      text: null, //JSON.stringify(o),
      description: "publisher initial data",
      title: data.title, // goes int cr_revision.
      jsonb_data: data,
      checksum
    }],{single:true})
  .then(retv =>{
    return retv.cms_publisher__new_revision
  })
} // cms_publisher__new(o)

// ============================================================================

exports.publisher__save = function (o) {

  const {item_id, name, title, checksum} = o;

  const jsonb_data = o.jsonb_data || o.data; // defaults to data.
  //assert(checksum)
  //console.log(jsonb_data); throw 'stop-463'
  const new_checksum = hash(jsonb_data, {algorithm: 'md5', encoding: 'base64' }) // goes int cr_revision.

  if (!o.item_id) {
    // it's a new publisher.
    return db.query('select cms_publisher__new($1)',
      [{
        parent_id: app_folder_id,
        name,
        package_id,
        text: null, //JSON.stringify(o),
        description: "publisher initial data",
        title,
        jsonb_data, // will be redirected into cr_revision.data
        checksum: new_checksum
      }],{single:true})
      .then(retv2 =>{
        const retv = retv2.cms_publisher__new[0].cms_publisher__new_; // MESSY
        console.log(`[cms-openacs]publisher__save retv:`,retv)
        _assert(retv.item_id, retv, 'fatal-465 Missing item_id')
        _assert(retv.revision_id, retv, 'fatal-466 Missing revision_id')
        return retv;
      })
      .catch(err =>{
        console.log(`ALERT CRASH err:`,err)
        o.error = [err.message,'cms_publisher__new'];
        return o;
      });
  } else {
    // if (o.force_new_revision) ....
    /*
    if (checksum == new_checksum) {
      if (!o.force_new_revision ) {
        if (verbose)
        console.log(`cms.publisher__save:: No change in checksum - skipping new_revision :${o.title}`);
        return {
          retCode: 'ok',
          info: 'cms.publisher__save:: No change in checksum - skipping new_revision'
        }
      }
    } */


    //console.log(`[cms.publisher__save] checksum (force:${o.force_new_revision}) [${checksum}]=>[${new_checksum}]`);


/*
    return db.query('select cms_publisher__new_revision($1)',
      [{
        parent_id: app_folder_id,
        item_id,
        name,
        package_id,
        text: null, //JSON.stringify(o),
        description: "publisher initial data",
        title, // goes int cr_revision.
        jsonb_data,
        checksum: new_checksum
      }],
      {single:true})*/


      const description = o.description || `publisher-${item_id} revision`;

      return db.query('select cms_revision__new($1)',
        [{
          item_id,
          title, // cr_revision.title
          description,
          jsonb_data,
          checksum,
//          parent_id: app_folder_id,
//          name,
//          package_id,
        }],{single:true})
      .then(retv =>{
        return retv.cms_revision__new;
      })
/*
      .then(retv =>{
        const o2 = retv.cms_revision__new;
        assert(!o2.error);
        assert(o2.latest_revision)
        assert(!o.latest_revision)
        o.latest_revision = o2.latest_revision;
        // console.log(o);
        return o;
      })
      .catch(err =>{
        console.log(`[publisher__save] ALERT : (${err.message}) err:`,err)
        o.error = [err.message,'cms_publisher__new_revision'];
        return o;
      });
      */
  }
}

// ----------------------------------------------------------------------------

exports.article__save = async function (o) {

  const {item_id, parent_id, xid, name, title, data, checksum} = o;
  assert(data)
  assert(parent_id)

  const new_checksum = hash(data, {algorithm: 'md5', encoding: 'base64' }) // goes int cr_revision.
//  const parent_id = app_folder_id;
  const description = o.description || `cms.article xid:${xid}`;

  if (!o.item_id) {
    return db.query('select cms_article__new($1)',
      [{
        parent_id,
        name,
        package_id,
        text: null, //JSON.stringify(o),
        description,
        title,
        jsonb_data: data, // will be redirected into cr_revision.data
        checksum
      }],
      {single:true})
      .then(retv =>{
        return {
          revision_id: retv.cms_article__new
        }
      })
      .catch(err =>{
        o.error = [err.message,'cms_article__new'];
        return o;
      });
  } else {
    // if (o.force_new_revision) ....
    if (checksum == new_checksum) {
      if (!o.force_new_revision ) {
        if (verbose) {
          console.log(`cms.article__save:: No change in checksum - skipping article new_revision item_id:${item_id}`);
        }
        return {
          retCode: 'ok',
          info: 'cms.article__save:: No change in checksum - skipping article new_revision'
        }
      }
    }

    console.log(`[cms.article__save] checksum [${checksum}]=>[${new_checksum}]`)

/*
    return db.query('select cms_article__new_revision($1)',
      [{
        parent_id,
        item_id,
        name,
        package_id,
        text: null, //JSON.stringify(o),
        description,
        title, // goes int cr_revision.
        jsonb_data: data,
        checksum: new_checksum
      }],
      {single:true})
      */

      const retv = await db.query('select cms_revision__new($1)',
        [{
          item_id,
          title,            // cr_revision.title
          description,      // cr_revision.description
          jsonb_data: data,
          checksum: new_checksum
          /*
          parent_id,
          name,
          package_id,
          text: null, //JSON.stringify(o),
          */
        }],
        {single:true});

//      console.log('retv.cms_revision__new');

     return retv.cms_revision__new;
/*
      .then(retv =>{
        const o2 = retv.cms_revision__new;
        return o2;
      })
      .catch(err =>{
        o.error = [err.message,'cms_article__new_revision'];
        return o;
      });*/
  }
}

// ----------------------------------------------------------------------------

/*

      The only difference between article_save and author_save is the parent_id
      It could be done by the caller.

*/

exports.author__save = async function (o) {

  const {item_id, xid, name, title, data, checksum, revision_id} = o;
  let {parent_id} = o;
  assert(data)
  assert(!parent_id)
  parent_id = parent_id || app_folder_id,
  assert(parent_id)

  const new_checksum = hash(data, {algorithm: 'md5', encoding: 'base64' }) // goes int cr_revision.
//  const parent_id = app_folder_id;
  const description = o.description || `cms.author xid:${xid}`;

  if (!o.item_id) {
    return db.query('select cms_author__new($1)',
      [{
        parent_id,
        name,
        package_id,
        text: null, //JSON.stringify(o),
        description,
        title,
        jsonb_data: data, // will be redirected into cr_revision.data
        checksum: new_checksum
      }],
      {single:true})
      .then(retv =>{
        return {
          revision_id: retv.cms_author__new,
          retCode: 'Ok',
          info: 'cms_author__new'
        }
      })
      .catch(err =>{
        o.error = [err.message,'cms_author__new'];
        return o;
      });
  } else {
    // if (o.force_new_revision) ....
    if (checksum == new_checksum) {
      if (!o.force_new_revision ) {
        if (verbose)
        console.log(`cms.author__save:: No change in checksum - skipping author new_revision item_id:${item_id}`);
        return {
          revision_id, // original
          retCode: 'ok',
          info: 'cms.author__save:: No change in checksum - skipping author new_revision',
        }
      }
    }

    if (!checksum)
    console.log(`#### ALERT checksum [${checksum}]=>[${new_checksum}]`)


    return db.query('select cms_author__new_revision($1)',
      [{
        parent_id,
        item_id,
        name,
        package_id,
        text: null, //JSON.stringify(o),
        description,
        title, // goes int cr_revision.
        jsonb_data: data,
        checksum: new_checksum
      }],
      {single:true})
      .then(retv =>{
        return {
          revision_id: retv.cms_author__new_revision,
          retCode: 'Ok',
          message: 'new_revision'
        }
      })
      .catch(err =>{
        o.error = [err.message,'cms_author__new_revision'];
        return o;
      });
  }
}



// ============================================================================

exports.publishers__directory = async function () {
  const retv = await db.query(`
    select *
    from cms_publishers__directory
    where package_id = $1`,[package_id]);

  console.log('cms.publishers_directory length:', retv.length)
  return retv;
}


// ============================================================================

exports.authors__directory = async function () {
  const retv = await db.query(`
    select *
    from cms_authors__directory
    where package_id = $1`,[package_id]);

  //console.log('cms.authors_directory length:', retv.length)
  return retv;
}

// ============================================================================

exports.articles__directory = async function() {
  const retv= await db.query(`
    select *
    from cms_articles__directory
    where package_id = $1
    ;`, [package_id]);

  console.log('cms.articles_directory length:', retv.length)
  return retv;
}

// ============================================================================

exports.catalogs__directory = async function() {
  const retv= await db.query(`
    select *
    from cms_articles__directory
    where package_id = $1
    and (data->>'sec' != '3')
    ;`, [package_id]);

  console.log('cms.catalogs_directory length:', retv.length)
  return retv;
}

// ============================================================================

exports.pdf__directory = async function() {
  const retv= await db.query(`
    select *
    from cms_pdf__directory
    where package_id = $1
    ;`, [package_id]);

  console.log('cms.pdf__directory length:', retv.length)
  return retv;
}
// ============================================================================

exports.index_auteurs_titres_pdf = function(){
  return db.query(`
    select mapp_index_auteurs();
    `,{single:true})
  .then(retv =>{
    return retv[0].mapp_index_auteurs
  })
  .catch(err=>{
    return {
      error:err.message
    }
  })
}



// ============================================================================
