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

import Vue from 'vue'
import findIndex from 'lodash/findIndex'
import get from 'lodash/get'
import groupBy from 'lodash/groupBy'
import concat from 'lodash/concat'
import orderBy from 'lodash/orderBy'
import { getComments } from '@/utils/api'

// initial state
const state = {
  all: {},
  subscription: undefined
}

// getters
const getters = {
  itemsByTicket (state) {
    return number => {
      return get(state.all, number)
    }
  }
}

// actions
const actions = {
  setSubscription ({ commit, rootState }, subscription) {
    if (subscription) {
      subscription.namespace = rootState.namespace
      commit('SUBSCRIBE', subscription)
    } else {
      commit('UNSUBSCRIBE')
    }
  },
  async subscribed ({ commit, rootState }) {
    const subscription = state.subscription
    if (subscription) {
      const { namespace, name } = subscription
      const items = get(await getComments({ namespace, name }), 'data.items')
      commit('RECEIVE', items)
    }
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
    state.all = groupBy(orderByUpdatedAt(items), 'metadata.number')
  },
  PUT_ITEM (state, item) {
    const number = get(item, 'metadata.number')
    if (!state.all[number]) {
      return Vue.set(state.all, number, [item])
    }
    const items = state.all[number]
    const key = get(item, 'metadata.id')
    const index = findIndex(items, ['metadata.id', key])
    if (index !== -1) {
      const oldItem = items[index]
      if (get(oldItem, 'metadata.updated_at') <= get(item, 'metadata.updated_at')) {
        items.splice(index, 1, item)
      }
    } else {
      state.all[number] = orderByUpdatedAt(concat(items, item))
    }
  },
  DELETE_ITEM (state, item) {
    const number = get(item, 'metadata.number')
    if (!state.all[number]) {
      return
    }
    const items = state.all[number]
    const key = get(item, 'metadata.id')
    const index = findIndex(items, ['metadata.id', key])
    if (index !== -1) {
      items.splice(index, 1)
    }
  },
  CLEAR_ALL (state) {
    state.all = {}
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
