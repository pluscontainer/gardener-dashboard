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
import split from 'lodash/split'
import keyBy from 'lodash/keyBy'
import assign from 'lodash/assign'
import cloneDeep from 'lodash/cloneDeep'

import {
  getKey,
  getItemByKey,
  isSortRequired
} from './helpers'

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
    state.shoots = keyBy(items, ({ metadata }) => getKey(metadata))
  },
  RECEIVE_INFO (state, [key, info]) {
    const item = getItemByKey(state, key)
    if (item !== undefined) {
      Vue.set(state.infos, key, info)
    }
  },
  RECEIVE_SEED_INFO (state, [key, info]) {
    const item = getItemByKey(state, key)
    if (item !== undefined) {
      Vue.set(state.seedInfos, key, info)
    }
  },
  RECEIVE_ADDON_KYMA (state, [key, info]) {
    const item = getItemByKey(state, key)
    if (item !== undefined) {
      Vue.set(state.addonKyma, key, info)
    }
  },
  SET_SORT_REQUIRED (state, value) {
    state.sortRequired = value
  },
  PUT_ITEM (state, newItem) {
    const key = getKey(newItem.metadata)
    const oldItem = getItemByKey(state, key)
    if (oldItem) {
      if (oldItem.metadata.resourceVersion !== newItem.metadata.resourceVersion) {
        if (isSortRequired(state, newItem, oldItem)) {
          state.sortRequired = true
        }
        Vue.set(state.shoots, key, assign(oldItem, newItem))
      }
    } else {
      state.sortRequired = true
      Vue.set(state.shoots, key, newItem)
    }
  },
  DELETE_ITEM (state, { metadata } = {}) {
    const key = getKey(metadata)
    if (getItemByKey(state, key)) {
      state.sortRequired = true
      Vue.delete(state.shoots, key)
    }
  },
  CLEAR_ALL (state) {
    state.shoots = {}
    state.sortedShoots = []
    state.filteredShoots = []
    state.events = []
  },
  ADD_EVENT (state, event) {
    state.events.push(event)
  },
  CLEAR_EVENTS (state) {
    state.events = []
  },
  SET_SELECTION (state, metadata) {
    state.selection = metadata
  },
  SET_SORTED_SHOOTS (state, items) {
    state.sortedShoots = items
  },
  SET_FILTERED_SHOOTS (state, items) {
    state.filteredShoots = items
  },
  SET_SORT_PARAMS (state, sortParams) {
    state.sortParams = sortParams
  },
  SET_SEARCH_VALUE (state, searchValue) {
    if (searchValue && searchValue.length > 0) {
      state.searchValue = split(searchValue, ' ')
    } else {
      state.searchValue = undefined
    }
  },
  SET_SHOOT_LIST_FILTERS (state, value) {
    state.shootListFilters = value
  },
  SET_SHOOT_LIST_FILTER (state, { filter, value }) {
    Vue.set(state.shootListFilters, filter, value)
  },
  SET_NEW_SHOOT_RESOURCE (state, value) {
    state.newShootResource = value
  },
  RESET_NEW_SHOOT_RESOURCE (state, value) {
    state.newShootResource = value
    state.initialNewShootResource = cloneDeep(value)
  }
}

export default mutations
