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

import get from 'lodash/get'
import replace from 'lodash/replace'
import filter from 'lodash/filter'
import concat from 'lodash/concat'
import pick from 'lodash/pick'
import isEqual from 'lodash/isEqual'

import { isNotFound } from '@/utils/error'

import {
  getShoot,
  getShoots,
  getShootInfo,
  getShootSeedInfo,
  createShoot,
  deleteShoot,
  getShootAddonKyma
} from '@/utils/api'

import {
  shootHasIssue
} from '@/utils'

import {
  getKey,
  isSortRequired,
  updateSortedShoots,
  updateFilteredShoots,
  getInitialShootResource,
  getItemByKey
} from './helpers'

const uriPattern = /^([^:/?#]+:)?(\/\/[^/?#]*)?([^?#]*)(\?[^#]*)?(#.*)?/

async function * fetchShootsIterator (params) {
  do {
    const { metadata, items } = get(await getShoots({}, { params }), 'data')
    if (metadata.continue) {
      params.continue = metadata.continue
    } else if (params.continue) {
      delete params.continue
    }
    yield items
  } while (params.continue)
}

async function fetchShoots (context, subscription) {
  const { commit } = context
  commit('SET_LOADING', true)
  try {
    const { namespace, name, unhealthy } = subscription
    if (namespace && name) {
      const item = get(await getShoot({ namespace, name }), 'data')
      commit('RECEIVE', [item])
    } else if (namespace) {
      const items = get(await getShoots({ namespace }), 'data.items')
      commit('RECEIVE', items)
      updateSortedShoots(context)
    } else {
      const params = { limit: 100 }
      if (unhealthy) {
        params.labelSelector = 'shoot.gardener.cloud/status!=healthy'
      }
      let items = []
      for await (const chunk of fetchShootsIterator(params)) {
        items = concat(items, chunk)
        commit('RECEIVE', items)
        updateSortedShoots(context)
      }
    }
  } catch (err) {
    console.error('Failed to fetch shoots', err)
  }
  commit('SET_LOADING', false)
}

const actions = {
  setSubscription ({ commit, rootState }, subscription) {
    if (subscription) {
      const namespace = rootState.namespace
      if (namespace === '_all') {
        const onlyShootsWithIssues = rootState.onlyShootsWithIssues
        if (onlyShootsWithIssues) {
          subscription.unhealthy = true
        }
      } else {
        subscription.namespace = namespace
      }
      commit('SUBSCRIBE', subscription)
    } else {
      commit('UNSUBSCRIBE')
    }
  },
  subscribed (context) {
    const { commit, state } = context
    const subscription = state.subscription
    if (subscription) {
      commit('CLEAR_ALL')
      fetchShoots(context, subscription)
    }
  },
  unsubscribed ({ commit }) {
    commit('CLEAR_ALL')
  },
  clearAll ({ commit }) {
    commit('CLEAR_ALL')
  },
  handleEvents ({ commit, state, rootState, rootGetters }, events) {
    const onlyShootsWithIssues = rootState.namespace === '_all' && rootState.onlyShootsWithIssues
    let sortRequired
    const modifications = []
    const predicate = ({ type, object }) => {
      const key = getKey(object.metadata)
      const item = getItemByKey(state, key)
      switch (type) {
        case 'ADDED':
        case 'MODIFIED': {
          if (!onlyShootsWithIssues || shootHasIssue(object)) {
            if (item) {
              if (object.metadata.resourceVersion !== item.metadata.resourceVersion) {
                modifications.push([object, item])
                return true
              }
            } else {
              sortRequired = true
              return true
            }
          }
          break
        }
        case 'DELETED': {
          if (item) {
            sortRequired = true
            return true
          }
          break
        }
      }
      return false
    }
    events = filter(events, predicate)
    commit('HANDLE_EVENTS', events)
    if (!sortRequired) {
      for (const [object, item] of modifications) {
        if (isSortRequired({ state, rootGetters }, object, item)) {
          sortRequired = true
          break
        }
      }
    }
    if (sortRequired) {
      updateSortedShoots({ commit, state, rootState, rootGetters })
    }
  },
  create ({ rootState }, data) {
    const namespace = data.metadata.namespace || rootState.namespace
    return createShoot({ namespace, data })
  },
  delete ({ commit }, { namespace, name }) {
    return deleteShoot({ namespace, name })
  },
  /**
   * Return the given info for a single shoot with the namespace/name.
   * This ends always in a server/backend call.
   */
  async getInfo ({ commit }, { namespace, name }) {
    try {
      const { data: info } = await getShootInfo({ namespace, name })
      if (info.serverUrl) {
        const [, scheme, host] = uriPattern.exec(info.serverUrl)
        const authority = `//${replace(host, /^\/\//, '')}`
        const pathname = info.dashboardUrlPath
        info.dashboardUrl = [scheme, authority, pathname].join('')
        info.dashboardUrlText = [scheme, host].join('')
      }

      if (info.seedShootIngressDomain) {
        const baseHost = info.seedShootIngressDomain
        info.grafanaUrlUsers = `https://gu-${baseHost}`
        info.grafanaUrlOperators = `https://go-${baseHost}`
        info.prometheusUrl = `https://p-${baseHost}`
        info.alertmanagerUrl = `https://au-${baseHost}`
        info.kibanaUrl = `https://k-${baseHost}`
      }
      const key = getKey({ namespace, name })
      commit('RECEIVE_INFO', [key, info])
    } catch (error) {
      // shoot info not found -> ignore if KubernetesError
      if (isNotFound(error)) {
        return
      }
      throw error
    }
  },
  async getSeedInfo ({ commit }, { namespace, name }) {
    try {
      const { data: info } = await getShootSeedInfo({ namespace, name })
      const key = getKey({ namespace, name })
      commit('RECEIVE_SEED_INFO', [key, info])
    } catch (error) {
      // shoot seed info not found -> ignore if KubernetesError
      if (isNotFound(error)) {
        return
      }
      throw error
    }
  },
  async getAddonKyma ({ commit }, { namespace, name }) {
    try {
      const { data: info } = await getShootAddonKyma({ namespace, name })
      const key = getKey({ namespace, name })
      commit('RECEIVE_ADDON_KYMA', [key, info])
    } catch (error) {
      // shoot addon kyma not found -> ignore if KubernetesError
      if (isNotFound(error)) {
        return
      }
      throw error
    }
  },
  setSelection ({ commit, dispatch, state }, metadata) {
    if (!metadata) {
      return commit('SET_SELECTION', null)
    }
    const { namespace, name } = metadata
    const key = getKey({ namespace, name })
    if (getItemByKey(state, key)) {
      commit('SET_SELECTION', { namespace, name })
      if (!state.infos[key]) {
        return dispatch('getInfo', { namespace, name })
      }
    }
  },
  setListSortParams ({ commit, state, rootState, rootGetters }, options) {
    const sortParams = pick(options, ['sortBy', 'sortDesc'])
    if (!isEqual(sortParams, state.sortParams)) {
      commit('SET_SORT_PARAMS', sortParams)
      updateSortedShoots({ commit, state, rootState, rootGetters })
    }
  },
  setListSearchValue ({ commit, state, rootState, rootGetters }, searchValue) {
    if (!isEqual(searchValue, state.searchValue)) {
      commit('SET_SEARCH_VALUE', searchValue)
      updateFilteredShoots({ commit, state, rootState, rootGetters })
    }
  },
  setShootListFilters ({ commit, state, rootState, rootGetters }, value) {
    commit('SET_SHOOT_LIST_FILTERS', value)
    updateFilteredShoots({ commit, state, rootState, rootGetters })
  },
  setShootListFilter ({ commit, state, rootState, rootGetters }, filterValue) {
    if (state.shootListFilters) {
      commit('SET_SHOOT_LIST_FILTER', filterValue)
      updateFilteredShoots({ commit, state, rootState, rootGetters })
    }
  },
  setNewShootResource ({ commit }, shootResource) {
    commit('SET_NEW_SHOOT_RESOURCE', shootResource)
  },
  resetNewShootResource ({ commit, rootState, rootGetters }) {
    commit('RESET_NEW_SHOOT_RESOURCE', getInitialShootResource({ rootState, rootGetters }))
  }
}

export default actions
