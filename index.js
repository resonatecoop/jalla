var path = require('path')
var mime = require('mime')
var assert = require('assert')
var serve = require('koa-static')
var { get } = require('koa-route')
var App = require('./lib/app')
var defer = require('./lib/defer')
var style = require('./lib/style')
var assets = require('./lib/assets')
var script = require('./lib/script')
var render = require('./lib/render')
var manifest = require('./lib/manifest')
var serviceWorker = require('./lib/service-worker')

module.exports = start

function start (entry, opts = {}) {
  assert(typeof entry === 'string', 'jalla: entry should be type string')
  entry = absolute(entry)

  var dir = path.dirname(entry)
  var sw = opts.sw && absolute(opts.sw, dir)
  var css = opts.css && absolute(opts.css, dir)
  var dist = typeof opts.serve === 'string' ? absolute(opts.serve) : 'dist'
  var app = new App(entry, Object.assign({}, opts, { sw, css }))
  var served = new Set()

  app.use(async function (ctx, next) {
    var start = Date.now()
    await next()
    app.emit('timing', Date.now() - start, ctx)
  })

  app.use(require('koa-conditional-get')())
  app.use(require('koa-etag')())

  if (opts.serve) {
    try {
      // pick up build map of existing build
      let map = require(absolute('.map.json', dist))
      Object.assign(app.context.assets, map.assets)
      map.files.forEach(function (file) {
        // emit faux bundle event
        app.emit('bundle:file', file)
      })
    } catch (err) {
      app.emit('error', Error('Could not find build map in serve directory'))
    }

    app.use(serve(path.resolve(dir, dist), { maxage: 60 * 60 * 24 * 365 }))
  } else {
    app.on('bundle:asset', onasset)
    app.on('register:asset', onasset)
    if (app.env !== 'development') app.use(defer(app, (ctx, next) => next()))
    if (sw) app.use(serviceWorker(sw, path.basename(sw, '.js'), app))
    app.use(style(css, 'bundle', app))
    app.use(script(entry, 'bundle', app))
    assets(app)
  }

  app.use(render(entry, app))
  app.use(get('/manifest.json', manifest(app)))

  return app

  // serve assets from memory
  // (str, str, Buffer) -> void
  function onasset (file, uri, buff) {
    if (!served.has(uri)) {
      served.add(uri)
      var asset = app.context.assets[uri]
      app.use(get(asset.url, function (ctx, next) {
        ctx.type = mime.getType(uri)
        ctx.body = asset.buffer
      }))
    }
  }
}

// resolve file path (relative to dir) to absolute path
// (str, str?) -> str
function absolute (file, dir = '') {
  if (path.isAbsolute(file)) return file
  return path.resolve(dir, file)
}
