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
import cloneDeep from 'lodash/cloneDeep'

import {
  getKey,
  getItemByKey
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
  HANDLE_EVENTS (state, events) {
    for (const { type, object } of events) {
      const key = getKey(object.metadata)
      switch (type) {
        case 'ADDED':
        case 'MODIFIED': {
          Vue.set(state.shoots, key, object)
          break
        }
        case 'DELETED': {
          Vue.delete(state.shoots, key)
          break
        }
      }
    }
  },
  CLEAR_ALL (state) {
    state.shoots = {}
    state.infos = {}
    state.seedInfos = {}
    state.addonKyma = {}
    state.sortedShoots = []
    state.filteredShoots = []
    state.sortRequired = false
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
  },
  SET_LOADING (state, value) {
    state.loading = value
  }
}

export default mutations
