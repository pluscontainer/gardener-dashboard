//
// Copyright (c) 2020 by SAP SE or an SAP affiliate company. All rights reserved. This file is licensed under the Apache Software License, v. 2 except as noted otherwise in the LICENSE file
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

'use strict'

const ioClient = require('socket.io-client')
const http = require('http')
const pEvent = require('p-event')
const { find } = require('lodash')

const kubernetesClient = require('../../lib/kubernetes-client')
const io = require('../../lib/io')
const watches = require('../../lib/watches')
const cache = require('../../lib/cache')
const { authorization } = require('../../lib/services')
const { expect } = require('chai')
const { isAdmin } = require('../../lib/services/authorization')

module.exports = function ({ sandbox, auth }) {
  /* eslint no-unused-expressions: 0 */

  let server
  let ioServer
  let socket
  let serverSocket

  const client = {}
  let createClientStub
  let isAdminStub
  let findProjectByNamespaceStub
  let getProjectsStub

  const projectList = [
    {
      metadata: { name: 'foo' },
      spec: {
        namespace: 'foo',
        members: [
          { kind: 'User', name: 'foo@example.org' }
        ]
      }
    },
    {
      metadata: { name: 'bar' },
      spec: {
        namespace: 'bar',
        members: [
          { kind: 'User', name: 'bar@example.org' }
        ]
      }
    },
    {
      metadata: { name: 'baz' },
      spec: {
        namespace: 'baz',
        members: [
          { kind: 'User', name: 'foo@example.org' },
          { kind: 'User', name: 'bar@example.org' },
          { kind: 'User', name: 'baz@example.org' }
        ]
      }
    }
  ]

  function setupIoServer (server) {
    try {
      const stubs = {}
      for (const key of Object.keys(watches)) {
        stubs[key] = sandbox.stub(watches, key)
      }
      ioServer = io()
      for (const stub of Object.values(watches)) {
        expect(stub).to.be.calledOnce
        expect(stub.firstCall.args).to.have.length(1)
        expect(stub.firstCall.args[0]).to.be.equal(ioServer)
      }
      ioServer.attach(server)
    } finally {
      sandbox.restore()
    }
  }

  async function connect (userId) {
    // create stubs
    createClientStub = sandbox
      .stub(kubernetesClient, 'createClient')
      .returns(client)
    isAdminStub = sandbox
      .stub(authorization, 'isAdmin')
      .callsFake(({ id }) => id === 'admin@example.org')
    findProjectByNamespaceStub = sandbox
      .stub(cache, 'findProjectByNamespace')
      .callsFake(namespace => {
        return find(projectList, ['spec.namespace', namespace])
      })
    getProjectsStub = sandbox
      .stub(cache.cache, 'getProjects')
      .returns(projectList)
    // create client connection
    const { address: hostname, port } = server.address()
    const origin = `http://[${hostname}]:${port}`
    const user = auth.createUser({ id: userId })
    const [
      cookie,
      bearer
    ] = await Promise.all([
      user.cookie,
      user.bearer
    ])
    socket = ioClient(origin, {
      path: '/api/events',
      extraHeaders: { cookie },
      reconnectionDelay: 0,
      forceNew: true,
      transports: ['websocket']
    })
    socket.connect()
    const connectionPromise = pEvent(ioServer, 'connection', {
      timeout: 1000
    })
    await pEvent(socket, 'connect', {
      timeout: 1000,
      rejectionEvents: ['error', 'connect_error']
    })
    serverSocket = await connectionPromise
    // expectations
    expect(socket.connected).to.be.true
    expect(createClientStub).to.be.calledOnceWith({ auth: { bearer } })
    expect(isAdminStub).to.be.calledOnce
    expect(isAdminStub.firstCall.args).to.have.length(1)
    expect(isAdminStub.firstCall.args[0]).to.have.property('id', userId)
  }

  function subscribe (topic, options = {}) {
    return new Promise((resolve, reject) => {
      const filter = new URLSearchParams(options).toString()
      socket.emit('subscribe', { topic, filter }, ({ error } = {}) => {
        if (!error) {
          resolve()
        } else {
          reject(new Error(error))
        }
      })
    })
  }

  function unsubscribe (topic) {
    return new Promise((resolve, reject) => {
      socket.emit('unsubscribe', { topic }, ({ error } = {}) => {
        if (!error) {
          resolve()
        } else {
          reject(new Error(error))
        }
      })
    })
  }

  before(async function () {
    server = http.createServer()
    server.listen(0, 'localhost')
    await pEvent(server, 'listening', {
      timeout: 1000
    })
    setupIoServer(server)
  })

  after(function () {
    server.close()
    if (ioServer) {
      ioServer.close()
    }
  })

  afterEach(function () {
    if (socket.connected) {
      socket.disconnect()
    }
  })

  describe('shoots', function () {
    describe('member', function () {
      beforeEach(async function () {
        await connect('foo@example.org')
      })

      it('should subscribe shoots for a namespace', async function () {
        const namespace = 'foo'
        await subscribe('shoots', { namespace })
        expect(findProjectByNamespaceStub).to.be.calledOnceWithExactly(namespace)
        expect(Object.keys(serverSocket.rooms)).to.eql([
          socket.id,
          `subs://shoots/namespace/${namespace}/all-clusters`
        ])
        await unsubscribe('shoots')
        expect(Object.keys(serverSocket.rooms)).to.eql([
          socket.id
        ])
      })

      it('should subscribe shoots for all namespaces', async function () {
        await subscribe('shoots', {})
        expect(getProjectsStub).to.be.calledOnce
        expect(Object.keys(serverSocket.rooms)).to.eql([
          socket.id,
          'subs://shoots/namespace/foo/all-clusters',
          'subs://shoots/namespace/baz/all-clusters'
        ])
        await unsubscribe('shoots')
        expect(Object.keys(serverSocket.rooms)).to.eql([
          socket.id
        ])
      })

      it('should subscribe single shoot', async function () {
        const namespace = 'baz'
        const name = 'foo'
        await subscribe('shoots', { namespace, name })
        expect(findProjectByNamespaceStub).to.be.calledOnceWithExactly(namespace)
        expect(Object.keys(serverSocket.rooms)).to.eql([
          socket.id,
          `subs://shoots/namespace/${namespace}/cluster/${name}`
        ])
        await unsubscribe('shoots')
        expect(Object.keys(serverSocket.rooms)).to.eql([
          socket.id
        ])
      })
    })

    describe('admin', function () {
      beforeEach(async function () {
        await connect('admin@example.org')
      })

      it('should subscribe shoots for all namespaces', async function () {
        await subscribe('shoots', {})
        expect(getProjectsStub).not.to.be.called
        expect(Object.keys(serverSocket.rooms)).to.eql([
          socket.id,
          'subs://shoots/all-namespaces/all-clusters'
        ])
        await unsubscribe('shoots')
        expect(Object.keys(serverSocket.rooms)).to.eql([
          socket.id
        ])
      })
    })
  })

  describe('tickets', function () {
    beforeEach(async function () {
      await connect('baz@example.org')
    })

    it('should subscribe tickets', async function () {
      await subscribe('tickets')
      expect(Object.keys(serverSocket.rooms)).to.eql([
        socket.id,
        'subs://tickets'
      ])
      await unsubscribe('tickets')
      expect(Object.keys(serverSocket.rooms)).to.eql([
        socket.id
      ])
    })
  })

  describe('comments', function () {
    beforeEach(async function () {
      await connect('bar@example.org')
    })

    it('should subscribe ticket comments', async function () {
      const namespace = 'bar'
      const name = 'foo'
      await subscribe('comments', { namespace, name })
      expect(Object.keys(serverSocket.rooms)).to.eql([
        socket.id,
        `subs://comments/project/${namespace}/cluster/${name}`
      ])
      await unsubscribe('comments')
      expect(Object.keys(serverSocket.rooms)).to.eql([
        socket.id
      ])
    })
  })
}
