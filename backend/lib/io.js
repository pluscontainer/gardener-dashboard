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

const _ = require('lodash')
const socketIO = require('socket.io')
const logger = require('./logger')
const security = require('./security')
const { Forbidden } = require('./errors')

const kubernetesClient = require('./kubernetes-client')
const watches = require('./watches')
const cache = require('./cache')

function socketAuthentication (io) {
  const authenticate = security.authenticateSocket(kubernetesClient)
  io.use(async (socket, next) => {
    logger.debug('Socket %s authenticating', socket.id)
    try {
      const user = await authenticate(socket)
      logger.debug('Socket %s authenticated (user %s)', socket.id, user.id)
      next()
    } catch (err) {
      logger.error('Socket %s authentication failed: "%s"', socket.id, err.message)
      next(new Forbidden(err.message))
    }
  })
}

function getUserFromSocket (socket) {
  const user = _.get(socket, 'client.user')
  if (!user) {
    logger.error('Could not get client.user from socket', socket.id)
  }
  return user
}

function joinRoom (socket, room) {
  return new Promise((resolve, reject) => {
    socket.join(room, err => {
      if (err) {
        return reject(err)
      }
      logger.debug('Socket %s joined room "%s"', socket.id, room)
      resolve()
    })
  })
}

function leaveRoom (socket, room) {
  return new Promise((resolve, reject) => {
    socket.leave(room, err => {
      if (err) {
        return reject(err)
      }
      logger.debug('Socket %s left room "%s"', socket.id, room)
      resolve()
    })
  })
}

function isMemberOfNamespace (user, namespace) {
  if (user.isAdmin) {
    return true
  }
  const project = cache.findProjectByNamespace(namespace)
  return _
    .chain(project)
    .get('spec.members')
    .findIndex({
      kind: 'User',
      name: user.id
    })
    .gte(0)
    .value()
}

function leaveRooms (socket, pattern) {
  const predicate = room => {
    if (room === socket.id) {
      return false
    }
    return pattern.test(room)
  }
  const leaveRoomPromises = _
    .chain(socket.rooms)
    .keys()
    .filter(predicate)
    .map(room => leaveRoom(socket, room))
    .value()
  return Promise.all(leaveRoomPromises)
}

function onConnection (socket) {
  async function subscribe (socket, subscription) {
    const topic = subscription.topic
    const searchParams = new URLSearchParams(subscription.filter)
    switch (topic) {
      case 'shoots': {
        await unsubscribeShoots(socket)
        const namespace = searchParams.get('namespace')
        if (!namespace) {
          const unhealthy = searchParams.get('unhealthy') === 'true'
          return subscribeShootsAllNamespaces(socket, { unhealthy })
        }
        const name = searchParams.get('name')
        return subscribeShoots(socket, { namespace, name })
      }
      case 'tickets': {
        await unsubscribeTickets(socket)
        return subscribeTickets(socket)
      }
      case 'comments': {
        await unsubscribeComments(socket)
        const namespace = searchParams.get('namespace')
        const name = searchParams.get('name')
        return subscribeComments(socket, { namespace, name })
      }
    }
  }

  function subscribeShoots (socket, { namespace, name }) {
    const user = getUserFromSocket(socket)
    if (!isMemberOfNamespace(user, namespace)) {
      throw new Forbidden(`User ${user.id} has no authorization for namespace ${namespace}`)
    }
    let pathname = '/namespace/' + encodeURIComponent(namespace)
    if (name) {
      pathname += '/cluster/' + encodeURIComponent(name)
    } else {
      pathname += '/all-clusters'
    }
    return joinRoom(socket, 'subs://shoots' + pathname)
  }

  function subscribeShootsAllNamespaces (socket, { unhealthy }) {
    const user = getUserFromSocket(socket)
    if (!user.isAdmin) {
      throw new Forbidden(`User ${user.id} has no authorization for all namespaces`)
    }
    let pathname = '/all-namespaces'
    if (unhealthy) {
      pathname += '/unhealthy-clusters'
    } else {
      pathname += '/all-clusters'
    }
    return joinRoom(socket, 'subs://shoots' + pathname)
  }

  async function subscribeTickets (socket) {
    await joinRoom(socket, 'subs://tickets')
  }

  async function subscribeComments (socket, { namespace, name }) {
    const project = cache.findProjectByNamespace(namespace)
    const pathname = '/project/' + encodeURIComponent(project.metadata.name) + '/cluster/' + encodeURIComponent(name)
    await joinRoom(socket, 'subs://comments' + pathname)
  }

  function unsubscribe (socket, subscription) {
    const topic = subscription.topic
    switch (topic) {
      case 'shoots': {
        return unsubscribeShoots(socket)
      }
      case 'tickets': {
        return unsubscribeTickets(socket)
      }
      case 'comments': {
        return unsubscribeComments(socket)
      }
    }
  }

  function unsubscribeShoots (socket) {
    return leaveRooms(socket, /^subs:\/\/shoots/)
  }

  function unsubscribeTickets (socket) {
    return leaveRooms(socket, /^subs:\/\/tickets/)
  }

  function unsubscribeComments (socket) {
    return leaveRooms(socket, /^subs:\/\/comments/)
  }

  logger.debug('Socket %s connected', socket.id)

  socket.on('disconnect', reason => {
    logger.debug('Socket %s disconnected. Reason: %s', socket.id, reason)
  })

  socket.on('subscribe', async (subscription, callback) => {
    const response = {}
    try {
      await subscribe(socket, subscription)
    } catch (err) {
      console.log('subscription', err)
      _.set(response, 'error', err.message)
    }
    callback(response)
  })

  socket.on('unsubscribe', async (subscription, callback) => {
    const response = {}
    try {
      await unsubscribe(socket, subscription)
    } catch (err) {
      _.set(response, 'error', err.message)
    }
    callback(response)
  })
}

function init () {
  const io = socketIO({
    path: '/api/events',
    serveClient: false
  })

  socketAuthentication(io)

  // handle connection
  io.on('connection', onConnection)

  // start watches
  for (const watch of Object.values(watches)) {
    watch(io)
  }
  // return io instance
  return io
}

module.exports = init
