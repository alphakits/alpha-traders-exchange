import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const { assertContainerNodeRuntime, resolveContainerOrigin, validateContainerRequest } = require('./container-origin.cjs');
const Server = require('next/dist/server/next-server').default;
const { NextRequestAdapter } = require('next/dist/server/web/spec-extension/adapters/next-request');
const { NextRequest } = require('next/server');
const originSource = readFileSync(new URL('../src/lib/request-origin.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(originSource, {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const loadedModule = {exports:{}};
vm.runInNewContext(compiled, {module:loadedModule,exports:loadedModule.exports,URL});
const {hasTrustedSameOrigin}=loadedModule.exports;
const preview={NODE_ENV:'production',VERCEL:'1',VERCEL_ENV:'preview',VERCEL_URL:'reviewed-preview.vercel.app',PORT:'8080'};
const expected=resolveContainerOrigin(preview);
function request(headers={}) {return {method:'POST',url:'/api/check',headers:{host:expected.hostname,'x-forwarded-proto':'https',...headers}};}

for(const version of ['24.21.0','24.22.0','22.20.0','25.0.0','24.22.1-rc.1','invalid']) {
  test(`startup rejects runtime below the approved boundary ${version}`,()=>assert.throws(()=>assertContainerNodeRuntime(version)));
}
for(const version of ['24.22.1','24.22.2','24.23.0']) {
  test(`startup accepts approved Node24 runtime ${version}`,()=>assert.doesNotThrow(()=>assertContainerNodeRuntime(version)));
}
const configSource=readFileSync(new URL('./container-next-config.cjs',import.meta.url),'utf8');
function runtimeConfig(config){
  const loaded={exports:{}};
  vm.runInNewContext(configSource,{module:loaded,__dirname:'/fixture',require(name){
    if(name==='node:fs')return {readFileSync:()=>JSON.stringify({config})};
    if(name==='node:path')return require(name);
    throw Error('Unexpected config dependency');
  }});
  return JSON.parse(JSON.stringify(loaded.exports));
}
test('runtime config preserves baked application settings and rehydrates Next internal defaults',()=>{
  const result=runtimeConfig({distDir:'.next',images:{formats:['image/avif','image/webp']},env:{PUBLIC_FIXTURE:'value'},experimental:{cpus:1,trustHostHeader:true,isExperimentalCompile:false},htmlLimitedBots:{},configFileName:'next.config.ts',amp:{canonicalBase:''}});
  assert.deepEqual(result,{distDir:'.next',images:{formats:['image/avif','image/webp']},env:{PUBLIC_FIXTURE:'value'},experimental:{cpus:1}});
});
for(const config of [null,{distDir:'elsewhere'},{distDir:'.next',output:'standalone'},{distDir:'.next',output:'export'}]) {
  test(`rejects incompatible runtime build configuration ${JSON.stringify(config)}`,()=>assert.throws(()=>runtimeConfig(config)));
}

test('Preview pins the deployment environment hostname, independent of site URL',()=>{
  assert.deepEqual(resolveContainerOrigin({...preview,NEXT_PUBLIC_SITE_URL:'https://different-site.example'}),{origin:'https://reviewed-preview.vercel.app',hostname:'reviewed-preview.vercel.app',port:443});
});
for (const [key,value] of [['NODE_ENV','development'],['VERCEL','0'],['VERCEL_ENV','development'],['PORT','80'],['VERCEL_URL',''],['VERCEL_URL','https://reviewed-preview.vercel.app'],['VERCEL_URL','evil.example'],['VERCEL_URL','good.vercel.app/evil'],['VERCEL_URL','good.vercel.app:443'],['VERCEL_URL','good.vercel.app,evil.example'],['VERCEL_URL','good.vercel.app@evil.example'],['VERCEL_URL','good.vercel.app\n']]) {
  test(`rejects invalid server-owned Preview setting ${key}=${JSON.stringify(value)}`,()=>assert.throws(()=>resolveContainerOrigin({...preview,[key]:value})));
}
test('production uses one configured HTTPS canonical origin',()=>{
  assert.equal(resolveContainerOrigin({...preview,VERCEL_ENV:'production',NEXT_PUBLIC_SITE_URL:'https://www.example.com'}).origin,'https://www.example.com');
});
for(const value of ['http://www.example.com','https://user:secret@www.example.com','https://www.example.com/private','https://www.example.com?token=x','https://www.example.com:8443','https://127.0.0.1','https://host.localhost','https://fixture.invalid']) {
  test(`rejects invalid canonical origin ${value}`,()=>assert.throws(()=>resolveContainerOrigin({...preview,VERCEL_ENV:'production',NEXT_PUBLIC_SITE_URL:value})));
}
test('valid ingress is normalized without changing Origin or Sec-Fetch-Site',()=>{
  const req=request({host:'REVIEWED-PREVIEW.VERCEL.APP:443','x-forwarded-host':expected.hostname,'x-forwarded-port':'8080',origin:expected.origin,'sec-fetch-site':'same-origin'});
  assert.equal(validateContainerRequest(req,expected),null);
  assert.equal(req.headers.host,expected.hostname);assert.equal(req.headers['x-forwarded-port'],'443');
  assert.equal(req.headers.origin,expected.origin);assert.equal(req.headers['sec-fetch-site'],'same-origin');
});
for(const host of [undefined,'attacker.example','reviewed-preview.vercel.app.attacker.example','reviewed-preview.vercel.app:8080','reviewed-preview.vercel.app.','reviewed-preview.vercel.app,attacker.example',['reviewed-preview.vercel.app','attacker.example']]) {
  test(`rejects unknown or ambiguous Host ${JSON.stringify(host)}`,()=>assert.equal(validateContainerRequest(request({host}),expected),421));
}
test('rejects conflicting forwarded host even when Host is correct',()=>assert.equal(validateContainerRequest(request({'x-forwarded-host':'attacker.example'}),expected),421));
for(const proto of [undefined,'http','https,http',['https','http']]) {
  test(`rejects absent or ambiguous ingress protocol ${JSON.stringify(proto)}`,()=>assert.equal(validateContainerRequest(request({'x-forwarded-proto':proto}),expected),400));
}
test('rejects duplicate raw Host fields',()=>{
  assert.equal(validateContainerRequest({...request(),rawHeaders:['Host',expected.hostname,'hOsT','attacker.example']},expected),421);
  assert.equal(validateContainerRequest({...request(),rawHeaders:['Host',expected.hostname]},expected),null);
});
test('reproduces old standalone origin failure and preserves CSRF using pinned Next logical origin',()=>{
  const adapt=(hostname,port,origin)=>{
    const req=request({origin,'sec-fetch-site':'same-origin'});
    Server.prototype.attachRequestMeta.call({fetchHostname:hostname,port,nextConfig:{experimental:{}}},req,{query:{}},true);
    return NextRequestAdapter.fromNodeNextRequest(req,new AbortController().signal);
  };
  const old=adapt('0.0.0.0',8080,expected.origin);
  assert.equal(old.nextUrl.origin,'https://0.0.0.0:8080');assert.equal(hasTrustedSameOrigin(old),false);
  const fixed=adapt(expected.hostname,443,expected.origin);
  assert.equal(fixed.nextUrl.origin,expected.origin);assert.equal(hasTrustedSameOrigin(fixed),true);
  assert.equal(hasTrustedSameOrigin(adapt(expected.hostname,443,'https://attacker.example')),false);
  const crossSite=adapt(expected.hostname,443,expected.origin);crossSite.headers.set('sec-fetch-site','cross-site');
  assert.equal(hasTrustedSameOrigin(crossSite),false);
});
test('normalized middleware logical URL has the pinned public origin and safe redirects',()=>{
  // NextNodeServer.runMiddleware constructs this URL using its hostname/port,
  // rather than Host or x-forwarded-host. The listener remains separate.
  const req=new NextRequest(`https://${expected.hostname}:${expected.port}/en/protected`,{headers:{host:'attacker.example'}});
  assert.equal(req.nextUrl.origin,expected.origin);
  assert.equal(new URL('/en/login',req.url).origin,expected.origin);
});
