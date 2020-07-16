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

const logger = require('../logger')
const { registerHandler } = require('./common')
const { shootHasIssue } = require('../utils')
const { tickets } = require('../services')
const {
  dashboardClient // privileged client for the garden cluster
} = require('../kubernetes-client')
const { bootstrapper } = require('../services/terminals')

async function deleteTickets ({ namespace, name }) {
  try {
    await tickets.deleteTickets({ namespace, name })
  } catch (error) {
    logger.error('failed to delete tickets for %s/%s: %s', namespace, name, error)
  }
}

module.exports = (io, { shootsWithIssues = new Set() } = {}) => {
  const emitter = dashboardClient['core.gardener.cloud'].shoots.watchListAllNamespaces()
  registerHandler(emitter, async event => {
    const { type, object } = event
    const uid = object.metadata.uid
    const namespace = encodeURIComponent(object.metadata.namespace)
    const name = encodeURIComponent(object.metadata.name)

    io.to(`subs://shoots/${namespace}/${name}`)
      .to(`subs://shoots/${namespace}`)
      .to('subs://shoots')
      .emit('shoot', event)

    if (shootHasIssue(object)) {
      io.to(`subs://unhealthy.shoot/${namespace}`)
        .to('subs://unhealthy.shoot')
        .emit('shoot', event)
      if (!shootsWithIssues.has(uid)) {
        shootsWithIssues.add(uid)
      } else if (type === 'DELETED') {
        shootsWithIssues.delete(uid)
      }
    } else if (shootsWithIssues.has(uid)) {
      const deletedEvent = {
        type: 'DELETED',
        object
      }
      io.to(`subs://unhealthy.shoots/${namespace}`)
        .to('subs://unhealthy.shoots')
        .emit('shoot', deletedEvent)
      shootsWithIssues.delete(uid)
    }

    switch (type) {
      case 'ADDED':
        bootstrapper.bootstrapResource(object)
        break
      case 'MODIFIED':
        if (bootstrapper.isResourcePending(object)) {
          bootstrapper.bootstrapResource(object)
        }
        break
      case 'DELETED':
        if (bootstrapper.isResourcePending(object)) {
          bootstrapper.removePendingResource(object)
        }
        deleteTickets(object.metadata)
        break
    }
  })
}
