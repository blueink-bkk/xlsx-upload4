var XLSX = require('xlsx'); // npm install xlsx
var jsonfile = require('jsonfile');


// ===========================================================================
module.exports = (xlsx_fn)=>{
var workbook = XLSX.readFile(xlsx_fn, {cellDates:true});
const sheet1 = workbook.SheetNames[0];
// console.log(sheet1)

const results = [];
var total_entries = 0;

//console.log('>> (before sheet_to_csv) etime21.1: ', new Date()-startTime);
const json = XLSX.utils.sheet_to_json(workbook.Sheets[sheet1],{
    header:[
      "xid",              // A
      "sec",              // B
      "yp",               // C
      "circa",            // D
      "pic",              // E : jpeg
      "co",               // F : country
      "h1",               // G
      'isoc',             // H
      "h2",               // I
      'root',             // J : other name, author (root-name)!
      'yf',               // K : year founded
      'fr',               // L : texte francais
      'mk',               // M : marque
      'en', 'zh',         // N,O : english chinese
      'ci', 'sa',         // P,Q : city, street address
      'links',            // R : pdf[]
      'flags',             // S : [RT..]
      'npages',           // T : number of pages
      'rev',              // U : revision date (Update)
      'com',              // V : comments
      'ori'               // W : origine source du document.
    ], range:1
}); // THIS IS THE HEAVY LOAD.
//console.log('>> (after sheet_to_csv)  etime21.2: ', new Date()-startTime);

//bi += 1;
//console.log(' -- New batch: ',bi, ' at: ',new Date()-startTime);
//console.log(`xlsx2json sheet1: ${json.length} lines.`);

//console.log(`writing file "xlsx2json.json"`)
jsonfile.writeFileSync('xlsx2json.json',json,{spaces:2})

require('./reformat.js')(json);
//jsonfile.writeFileSync('xlsx2json-reformatted.json',json,{spaces:2})

return json;
};
