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

import filter from 'lodash/filter'
import findIndex from 'lodash/findIndex'
import get from 'lodash/get'
import head from 'lodash/head'
import flatMap from 'lodash/flatMap'
import concat from 'lodash/concat'
import orderBy from 'lodash/orderBy'
import unionBy from 'lodash/unionBy'
import { getTickets } from '@/utils/api'

// initial state
const state = {
  all: [],
  subscription: undefined
}

// getters
const getters = {
  items (state) {
    return state.all
  },
  itemsByProjectAndName (state) {
    return (projectName, name) => {
      const metadata = {
        projectName,
        state: 'open'
      }
      if (name) {
        metadata.name = name
      }
      return filter(state.all, { metadata })
    }
  },
  latestUpdated (state, getters) {
    return (projectName, name) => {
      const issues = getters.itemsByProjectAndName(projectName, name)
      const latestUpdatedIssue = head(issues)
      return get(latestUpdatedIssue, 'metadata.updated_at')
    }
  },
  labels (state, getters) {
    return (projectName, name) => {
      const issues = getters.itemsByProjectAndName(projectName, name)
      const labels = flatMap(issues, 'data.labels')
      return unionBy(labels, 'id')
    }
  }
}

// actions
const actions = {
  setSubscription ({ commit }, subscription) {
    if (subscription) {
      commit('SUBSCRIBE', subscription)
    } else {
      commit('UNSUBSCRIBE')
    }
  },
  async subscribed ({ commit }) {
    const items = get(await getTickets(), 'data.items')
    commit('RECEIVE', items)
  },
  unsubscribed ({ commit }) {
    commit('CLEAR_ALL')
  },
  clearAll ({ commit }) {
    commit('CLEAR_ALL')
  },
  handleEvent ({ commit }, { type, object }) {
    switch (type) {
      case 'ADDED':
      case 'MODIFIED':
        commit('PUT_ITEM', object)
        break
      case 'DELETED':
        commit('DELETE_ITEM', object)
        break
      default:
        console.error('Undhandled event type', type)
    }
  }
}

// mutations
const mutations = {
  SUBSCRIBE (state, value) {
    if (value) {
      state.subscription = value
    }
  },
  UNSUBSCRIBE (state) {
    state.subscription = undefined
  },
  RECEIVE (state, items) {
    state.all = orderByUpdatedAt(items)
  },
  PUT_ITEM (state, item) {
    const items = state.all
    const key = get(item, 'metadata.number')
    const index = findIndex(items, ['metadata.number', key])
    if (index !== -1) {
      const oldItem = items[index]
      if (get(oldItem, 'metadata.updated_at') <= get(item, 'metadata.updated_at')) {
        items.splice(index, 1, item)
      }
    } else {
      state.all = orderByUpdatedAt(concat(items, item))
    }
  },
  DELETE_ITEM (state, item) {
    const items = state.all
    const key = get(item, 'metadata.number')
    const index = findIndex(items, ['metadata.number', key])
    if (index !== -1) {
      items.splice(index, 1)
    }
  },
  CLEAR_ALL (state) {
    state.all = []
  }
}

function orderByUpdatedAt (items, order = 'desc') {
  return orderBy(items, ['metadata.updated_at'], [order])
}

export default {
  namespaced: true,
  state,
  getters,
  actions,
  mutations
}
