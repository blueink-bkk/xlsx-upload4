//import _ from 'lodash'
const _ = require('lodash');


// ----------------------------------------------------------------------------

exports.Object_update = function (o,o2){
    Object.keys(o).forEach(k=>{
      if (o2[k]) o[k] = o2[k];
    })
    return o;
}

exports.Object_check_list = function(o, s, fn) {
  const v = s.split(/[,\s]/).filter(p=>(p && !o[p]));
  if (fn) {
    if (v.length >0) {
      console.log("************************************************************")
      console.log(`ALERT check_missing reported ${v.length} error(s) in object: {${Object.keys(o).join(', ')}}`)
      v.forEach(it=>{
        console.log(` -- MISSING "${it}"`)
      })
      console.log("************************************************************")
    }
    fn((v.length>0)?v:null);
    return;
  }

  return (v.length>0)?v:null;
}


// ----------------------------------------------------------------------------

exports.check_missing = function (o,s,fn) {
  const v = s.split(/[,\s]/).filter(p=>(p && !o[p]));
  if (fn) {
    if (v.length >0) {
      console.log("************************************************************")
      console.log(`ALERT check_missing reported ${v.length} error(s) in object: {${Object.keys(o).join(', ')}}`)
      v.forEach(it=>{
        console.log(` -- MISSING "${it}"`)
      })
      console.log("************************************************************")
    }
    fn.apply(v);
    return;
  }
  return (v.length>0)?v:null;
}

exports.undefine = function(o,s) { // NO cloning here.
  s.split(/[,\s]/).forEach(p =>{o[p]=undefined;})
  return o;
}

exports.pick = function(o,s) { // NO cloning here.
  return _.pick(o, s.split(/[,\s]/))
}

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

exports.RemoveAccents = function(s) {
  return s.RemoveAccents;
}
// ---------------------------------------------------------------------------

exports.nor1 = function(s) {
  // strip accents.
  const v = s && (''+s).toLowerCase()
  .replace(/[^a-z]/g,' ')
  .replace(/\s+/g,'-')
  .split('-')
  .filter(it=>(it.length>2));

  if (v.length>0) return v.join('-');
  return '*undefined*'
}

exports.nor_au = function(s) {
  // strip accents.
  const s2 = s && (''+s).toLowerCase()
  .RemoveAccents()
  .replace(/\(/g,'-')
  .replace(/[\(\)\.]/g,' ')
//  .replace(/[^a-z]/g,' ')
  .replace(/\s+/g,'')
//  .split('-')
//  .filter(it=>(it.length>1));

//  if (v.length>0) return v.join('-');
//  return '*undefined*'
  return s2;
}

exports.nor_au2 = function(s) {
  // strip accents.
  const h = {};
  const v = s && (''+s).toLowerCase()
  .RemoveAccents()
  .replace(/[\(\)\-\.\']/g,' ')
//  .replace(/[^a-z]/g,' ')
  .replace(/\s+/g,'') // insenstive to spaces, dots, dashes and ().
  .split('')
  .forEach(cc=>{
    h[cc] = h[cc] || 0;
    h[cc] ++;
  })

  const s2 = Object.keys(h).map(cc=>{
    return (h[cc]>1)?`${cc}${h[cc]}`:cc;
  })

//  .filter(it=>(it.length>1));

//  if (v.length>0) return v.join('-');
//  return '*undefined*'
  return s2.join('');
}
