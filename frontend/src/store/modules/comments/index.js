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
  handleEvents ({ commit }, events) {
    commit('HANDLE_EVENTS', events)
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
  HANDLE_EVENTS (state, events) {
    for (const { type, object } of events) {
      const number = get(object, 'metadata.number')
      const key = get(object, 'metadata.id')
      const items = state.all[number]
      switch (type) {
        case 'ADDED':
        case 'MODIFIED': {
          if (!items) {
            return Vue.set(state.all, number, [object])
          } else {
            const index = findIndex(items, ['metadata.id', key])
            if (index !== -1) {
              const item = items[index]
              if (get(item, 'metadata.updated_at') <= get(object, 'metadata.updated_at')) {
                items.splice(index, 1, object)
              }
            } else {
              state.all[number] = orderByUpdatedAt(concat(items, object))
            }
          }
          break
        }
        case 'DELETED': {
          if (items) {
            const index = findIndex(items, ['metadata.id', key])
            if (index !== -1) {
              items.splice(index, 1)
            }
          }
          break
        }
        default:
          console.error('Undhandled event type', type)
      }
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
