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

import io from 'socket.io-client'

function addEventListeners ({ socket, store }) {
  socket.on('connect', async () => {
    console.log(`socket ${socket.id} connection established`)
    store.dispatch('connected', socket)
  })
  socket.on('reconnect', attempt => {
    console.log(`socket ${socket.id} connection established after '${attempt}' attempt(s)`)
  })
  socket.on('disconnect', reason => {
    console.error(`socket ${socket.id} connection lost because`, reason)
    store.dispatch('disconnected', reason)
  })
  socket.on('connect_error', err => {
    console.error(`socket ${socket.id} connection error ${err}`)
  })
  socket.on('connect_timeout', () => {
    console.error(`socket ${socket.id} connection timeout`)
  })
  socket.on('reconnect_attempt', () => {
    console.log(`socket ${socket.id} reconnect attempt`)
  })
  socket.on('reconnecting', attempt => {
    console.log(`socket ${socket.id} reconnecting attempt number '${attempt}'`)
    store.dispatch('reconnecting', attempt)
  })
  socket.on('reconnect_error', err => {
    console.error(`socket ${socket.id} reconnect error ${err}`)
  })
  socket.on('reconnect_failed', () => {
    console.error(`socket ${socket.id} couldn't reconnect`)
  })
  socket.on('error', err => {
    console.error(`socket ${socket.id} error ${err}`)
  })
  socket.on('shoot', event => {
    store.dispatch('shoots/handleEvent', event)
  })
  socket.on('ticket', event => {
    store.dispatch('tickets/handleEvent', event)
  })
  socket.on('comment', event => {
    store.dispatch('comments/handleEvent', event)
  })
}

function emit (socket, eventName, subscription) {
  return new Promise((resolve, reject) => {
    let isPending = true
    const timeoutId = setTimeout(() => {
      isPending = false
      const err = new Error(`No acknowledgement received to event ${eventName} within 15 seconds`)
      err.code = 'ETIMEDOUT'
      reject(err)
    }, 15 * 1000)
    socket.emit(eventName, subscription, ({ error }) => {
      if (isPending) {
        clearTimeout(timeoutId)
        if (error) {
          reject(new Error(error))
        } else {
          resolve()
        }
      }
    })
  })
}

async function subscribe (socket, subscription) {
  if (!socket.connected) {
    return
  }
  try {
    await emit(socket, 'subscribe', subscription)
  } catch (err) {
    if (err.code === 'ETIMEDOUT') {
      throw new Error(`Subscription ${subscription} timed out`)
    }
    throw err
  }
}

async function unsubscribe (socket, subscription) {
  try {
    await emit(socket, 'unsubscribe', subscription)
  } catch (err) {
    if (err.code === 'ETIMEDOUT') {
      throw new Error(`Unsubscription ${subscription} timed out`)
    }
    throw err
  }
}

function connect ({ socket }) {
  if (!socket.connected) {
    socket.connect()
  }
}

function disconnect ({ socket }) {
  if (socket.connected) {
    socket.disconnect()
  }
}

async function subscribeTopic ({ socket, store }, topic) {
  try {
    const subscription = store.state[topic].subscription
    if (subscription) {
      const filter = new URLSearchParams(store.state[topic].subscription).toString()
      await subscribe(socket, { topic, filter })
      await store.dispatch(topic + '/subscribed')
    }
  } catch (err) {
    handleError(store, err)
  }
}

async function unsubscribeTopic ({ socket, store }, topic) {
  try {
    await unsubscribe(socket, { topic })
    await store.dispatch(topic + '/subscribed')
  } catch (err) {
    handleError(store, err)
  }
}

function handleError (store, err) {
  console.error('Subscription error', err)
  store.commit('SET_ALERT', { type: 'error', message: err.message })
}

function subscribeMutations (context) {
  context.store.subscribe(({ type }) => {
    switch (type) {
      case 'CONNECT':
        return connect(context)
      case 'DISCONNECT':
        return disconnect(context)
      case 'shoots/SUBSCRIBE':
        return subscribeTopic(context, 'shoots')
      case 'shoots/UNSUBSCRIBE':
        return unsubscribeTopic(context, 'shoots')
      case 'tickets/SUBSCRIBE':
        return subscribeTopic(context, 'tickets')
      case 'tickets/UNSUBSCRIBE':
        return unsubscribeTopic(context, 'tickets')
      case 'comments/SUBSCRIBE':
        return subscribeTopic(context, 'comments')
      case 'comments/UNSUBSCRIBE':
        return unsubscribeTopic(context, 'comments')
    }
  })
}

export default function createSocketPlugin () {
  const url = window.location.origin
  const socket = io(url, {
    path: '/api/events',
    transports: ['websocket'],
    autoConnect: false
  })
  return store => {
    const context = { socket, store }
    addEventListeners(context)
    subscribeMutations(context)
  }
}
