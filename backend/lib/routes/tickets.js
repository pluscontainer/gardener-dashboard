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

const express = require('express')
const { map, flatten } = require('lodash')
const { UnprocessableEntity } = require('../errors')
const cache = require('../cache')
const { tickets } = require('../services')

const ticketCache = cache.getTicketCache()

function getIssues () {
  return ticketCache.getIssues()
}

function getIssueComments (number) {
  return tickets.getIssueComments({ number })
}

async function getComments ({ namespace, name }) {
  if (!namespace || !name) {
    throw new UnprocessableEntity('Parameters "namespace" and "name" are required')
  }
  const project = cache.findProjectByNamespace(namespace)
  const projectName = project.metadata.name
  const numbers = ticketCache.getIssueNumbersForNameAndProjectName({
    projectName,
    name
  })
  return flatten(await Promise.all(map(numbers, getIssueComments)))
}

const router = module.exports = express.Router()

router.route('/')
  .get((req, res, next) => {
    try {
      res.send(getIssues())
    } catch (err) {
      next(err)
    }
  })

router.route('/comments')
  .get(async (req, res, next) => {
    try {
      res.send(await getComments(req.query))
    } catch (err) {
      next(err)
    }
  })
