#!/usr/bin/env node
// Release-kontroll: jookseb GitHub Actionsis (ja käsitsi: node tools/check_release.js [repo-juur]).
// Ei muuda midagi, ainult kontrollib. Väljub koodiga 1, kui leiab vea.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const errors = [];
const fail = msg => errors.push(msg);
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

// Täpse tähesuurusega olemasolu kontroll (GitHub Pages on case-sensitive, Windows/macOS mitte).
function existsExact(rel){
  const parts = rel.replace(/^\.\//, '').split('/');
  let dir = root;
  for(const part of parts){
    let names;
    try{ names = fs.readdirSync(dir); }catch(e){ return false; }
    if(!names.includes(part)) return false;
    dir = path.join(dir, part);
  }
  return true;
}

const html = read('index.html');
const sw = read('offline-sw.js');

// 1. Süntaks: offline-sw.js ja iga inline <script> index.html-is.
try{ new vm.Script(sw, {filename:'offline-sw.js'}); }catch(e){ fail('offline-sw.js süntaksiviga: ' + e.message); }
const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, scriptNo = 0;
while((m = scriptRe.exec(html))){
  const attrs = m[1];
  if(/\bsrc\s*=/.test(attrs)) continue;
  const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs);
  if(type && !/^(text|application)\/(javascript|ecmascript)$/i.test(type[1]) && type[1] !== 'module') continue;
  scriptNo++;
  if(type && type[1] === 'module') continue; // module'i vm.Script ei parsi
  try{ new vm.Script(m[2], {filename:'index.html <script #' + scriptNo + '>'}); }
  catch(e){ fail('index.html <script #' + scriptNo + '> süntaksiviga: ' + e.message); }
}

// 2. Versioonid: APP_BUILD ja SW_VERSION peavad klappima.
const appBuild = (/APP_BUILD\s*=\s*'([^']+)'/.exec(html) || [])[1];
const swVersion = (/SW_VERSION\s*=\s*'([^']+)'/.exec(sw) || [])[1];
if(!appBuild) fail('index.html: APP_BUILD puudub');
if(!swVersion) fail('offline-sw.js: SW_VERSION puudub');
if(appBuild && swVersion && swVersion !== 'offline-' + appBuild){
  fail(`Versioonid ei klapi: APP_BUILD='${appBuild}', SW_VERSION='${swVersion}' (oodatud 'offline-${appBuild}')`);
}
if((html.match(/APP_BUILD\s*=\s*'/g) || []).length !== 1) fail('index.html: APP_BUILD peab olema defineeritud täpselt ühes kohas (SW loeb seda regexiga)');

// 3. Media cache nimi ei tohi muutuda (muidu kaovad kasutajate offline-pildid).
const MEDIA_NAME = 'tehnikatuvastus-offline-final-v13';
if(!sw.includes(`MEDIA_CACHE = '${MEDIA_NAME}'`)) fail('offline-sw.js: MEDIA_CACHE nimi on muutunud (peab olema ' + MEDIA_NAME + ')');
if(!html.includes(`OFFLINE_CACHE_NAME = '${MEDIA_NAME}'`)) fail('index.html: OFFLINE_CACHE_NAME on muutunud (peab olema ' + MEDIA_NAME + ')');

// 4. Last-known-good shelli leping: mõlemad pooled peavad teadet toetama.
if(!sw.includes("'shell-healthy'")) fail("offline-sw.js ei käsitle teadet 'shell-healthy'");
if(!html.includes("type:'shell-healthy'")) fail("index.html ei saada teadet 'shell-healthy'");
if(!html.includes('__bootErrors')) fail('index.html: varajane __bootErrors loendur puudub');

// 5. SW fetch-haru järjekord: virtuaalpilt -> navigate -> reload/no-store bypass -> SWR.
const iVirtual = sw.indexOf("'/__offline_image__/'");
const iNav = sw.indexOf("event.request.mode === 'navigate'");
const iBypass = sw.indexOf("event.request.cache === 'reload'");
const iSwr = sw.lastIndexOf('staleWhileRevalidate(event)');
if(!(iVirtual >= 0 && iNav > iVirtual && iBypass > iNav && iSwr > iBypass)) fail('offline-sw.js: fetch-haru järjekord on vale (virtuaalpilt → navigate → reload/no-store → SWR)');

// 6. offline-assets.json: kõik kirjed olemas (täpne tähesuurus), dubleerimata, ja iga index.html-i lokaalne pilt on nimekirjas.
let manifest = [];
try{ manifest = JSON.parse(read('offline-assets.json')); }catch(e){ fail('offline-assets.json ei parsi: ' + e.message); }
if(!Array.isArray(manifest)) { fail('offline-assets.json peab olema massiiv'); manifest = []; }
const seen = new Set();
for(const entry of manifest){
  if(typeof entry !== 'string'){ fail('offline-assets.json: kirje ei ole string: ' + JSON.stringify(entry)); continue; }
  if(seen.has(entry)) fail('offline-assets.json: dubleeriv kirje ' + entry);
  seen.add(entry);
  if(entry === './') continue;
  if(!existsExact(entry)) fail('offline-assets.json viitab puuduvale failile (või vale tähesuurusega): ' + entry);
}
const referenced = new Set();
const imgRe = /["'`(]\s*(?:\.\/)?(images\/[A-Za-z0-9_\-./]+\.(?:jpe?g|png|webp|gif|svg|avif))/gi;
while((m = imgRe.exec(html))) referenced.add(m[1]);
for(const rel of referenced){
  if(!existsExact(rel)) fail('index.html viitab puuduvale pildile (või vale tähesuurusega): ' + rel);
  if(!seen.has('./' + rel)) fail('Pilt ei ole offline-assets.json-is (offline-is puudu): ./' + rel);
}
for(const required of ['./index.html', './offline-sw.js', './offline-assets.json', './manifest.json']){
  if(!seen.has(required)) fail('offline-assets.json-ist puudub ' + required);
}

if(errors.length){
  console.error('Release-kontroll EBAÕNNESTUS (' + errors.length + '):');
  errors.forEach(e => console.error(' - ' + e));
  process.exit(1);
}
console.log(`Release-kontroll OK · ${appBuild} / ${swVersion} · ${scriptNo} skripti, ${referenced.size} lokaalset pilti, ${manifest.length} manifesti kirjet`);
