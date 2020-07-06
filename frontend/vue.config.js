const path = require('path')
const fs = require('fs')

const version = fs.readFileSync(path.resolve(__dirname, '../VERSION'), 'utf8').toString('utf8').trim()
const kibibyte = 1024

process.env.VUE_APP_VERSION = version

module.exports = {
  pages: {
    index: {
      entry: 'src/main.js',
      template: 'public/index.html',
      filename: 'index.html',
      title: 'Kubernetes Gardener'
    }
  },
  chainWebpack (config) {
    config.performance
      .maxEntrypointSize(1024 * kibibyte)
      .maxAssetSize(1024 * kibibyte)
  },
  configureWebpack (config) {
    config.externals = /^ws$/i
  },
  css: process.env.NODE_ENV === 'production'
    ? { extract: { ignoreOrder: true } }
    : undefined,
  devServer: {
    proxy: {
      '/api': {
        target: 'http://localhost:3030',
        changeOrigin: true,
        ws: true
      },
      '/auth': {
        target: 'http://localhost:3030'
      },
      '/config.json': {
        target: 'http://localhost:3030'
      }
    }
  }
}
