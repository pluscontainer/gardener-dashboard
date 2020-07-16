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
import assign from 'lodash/assign'
import forEach from 'lodash/forEach'
import pick from 'lodash/pick'
import omit from 'lodash/omit'
import map from 'lodash/map'
import get from 'lodash/get'
import replace from 'lodash/replace'
import transform from 'lodash/transform'
import isEqual from 'lodash/isEqual'
import isObject from 'lodash/isObject'
import orderBy from 'lodash/orderBy'
import toLower from 'lodash/toLower'
import padStart from 'lodash/padStart'
import filter from 'lodash/filter'
import includes from 'lodash/includes'
import some from 'lodash/some'
import split from 'lodash/split'
import join from 'lodash/join'
import set from 'lodash/set'
import head from 'lodash/head'
import keyBy from 'lodash/keyBy'
import sample from 'lodash/sample'
import isEmpty from 'lodash/isEmpty'
import cloneDeep from 'lodash/cloneDeep'
import throttle from 'lodash/throttle'
import semver from 'semver'
import { getShoot, getShoots, getUnhealthyShoots, getShootInfo, getShootSeedInfo, createShoot, deleteShoot, getShootAddonKyma } from '@/utils/api'
import { getSpecTemplate, getDefaultZonesNetworkConfiguration, getControlPlaneZone } from '@/utils/createShoot'
import { isNotFound } from '@/utils/error'
import {
  isShootStatusHibernated,
  isReconciliationDeactivated,
  isStatusProgressing,
  getCreatedBy,
  getProjectName,
  shootHasIssue,
  purposesForSecret,
  shortRandomString,
  shootAddonList,
  utcMaintenanceWindowFromLocalBegin,
  randomLocalMaintenanceBegin,
  generateWorker
} from '@/utils'
import { isUserError, errorCodesFromArray } from '@/utils/errorCodes'

const uriPattern = /^([^:/?#]+:)?(\/\/[^/?#]*)?([^?#]*)(\?[^#]*)?(#.*)?/

// initial state
const state = {
  shoots: {},
  infos: {},
  seedInfos: {},
  addonKyma: {},
  sortedShoots: [],
  filteredShoots: [],
  events: [],
  sortRequired: false,
  sortParams: undefined,
  searchValue: undefined,
  selection: undefined,
  shootListFilters: undefined,
  newShootResource: undefined,
  initialNewShootResource: undefined
}

// getters
const getters = {
  sortedItems (state, getters) {
    return map(state.filteredShoots, getters.itemByKey)
  },
  itemByKey (state) {
    return key => {
      const shoot = state.shoots[key]
      if (shoot) {
        return {
          ...shoot,
          info: state.infos[key],
          seedInfo: state.seedInfos[key],
          addonKyma: state.addonKyma[key]
        }
      }
    }
  },
  itemByNamespaceAndName (state, getters) {
    return ({ namespace, name }) => getters.itemByKey(getKey({ namespace, name }))
  },
  selectedItem (state, getters) {
    if (state.selection) {
      return getters.itemByKey(state.selection)
    }
  },
  getShootListFilters (state) {
    return state.shootListFilters
  },
  newShootResource (state) {
    return state.newShootResource
  },
  initialNewShootResource (state) {
    return state.initialNewShootResource
  }
}

// actions
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
  async subscribed ({ commit, state, rootState, rootGetters }) {
    const subscription = state.subscription
    if (subscription) {
      commit('CLEAR_ALL')
      commit('CLEAR_EVENTS')
      commit('SET_SHOOTS_LOADING', true, { root: true })
      const { namespace, name, unhealthy } = subscription
      let items
      if (namespace && name) {
        const item = get(await getShoot({ namespace, name }), 'data')
        items = [item]
      } else if (namespace) {
        items = get(await getShoots({ namespace }), 'data.items')
      } else if (unhealthy) {
        items = get(await getUnhealthyShoots(), 'data.items')
      } else {
        items = get(await getShoots(), 'data.items')
      }
      commit('RECEIVE', items)
      updateSortedShoots({ commit, state, rootState, rootGetters })
      commit('SET_SHOOTS_LOADING', false, { root: true })
    }
  },
  unsubscribed ({ commit }) {
    commit('CLEAR_ALL')
  },
  clearAll ({ commit }) {
    commit('CLEAR_ALL')
  },
  handleEvent (context, event) {
    const { commit } = context
    commit('ADD_EVENT', event)
    throttledProcessEvents(context)
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
  },
  ADD_EVENT (state, event) {
    state.events.push(event)
  },
  CLEAR_EVENTS () {
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

const throttledProcessEvents = throttle(processEvents, 3000, { trailing: true })

function processEvents ({ commit, state, rootState, rootGetters }) {
  const onlyShootsWithIssues = rootState.namespace === '_all' && rootState.onlyShootsWithIssues
  const events = state.events
  commit('CLEAR_EVENTS')
  for (const { type, object } of events) {
    switch (type) {
      case 'ADDED':
      case 'MODIFIED': {
        if (!onlyShootsWithIssues || shootHasIssue(object)) {
          commit('PUT_ITEM', object)
        }
        break
      }
      case 'DELETED': {
        commit('DELETE_ITEM', object)
        break
      }
    }
  }
  if (state.sortRequired) {
    updateSortedShoots({ commit, state, rootState, rootGetters })
    commit('SET_SORT_REQUIRED', false)
  }
}

function getKey ({ namespace, name }) {
  return namespace + '/' + name
}

function getItemByKey (state, key) {
  return state.shoots[key]
}

// Deep diff between two object, using lodash
function difference (object, baseObject) {
  const iteratee = (accumulator, value, key) => {
    const baseValue = baseObject[key]
    if (!isEqual(value, baseValue)) {
      accumulator[key] = isObject(value) && isObject(baseValue) ? difference(value, baseValue) : value
    }
  }
  return transform(object, iteratee)
}

function isSortRequired (state, newItem, oldItem) {
  const sortBy = head(get(state, 'sortParams.sortBy'))
  if (includes(['name', 'infrastructure', 'project', 'createdAt', 'createdBy', 'ticketLabels'], sortBy)) {
    return false // these values cannot change
  }
  if (sortBy === 'lastOperation') {
    return true // don't check in this case as most put events will be lastOperation anyway
  }
  const rootGetters = {
    ticketLabels () {}
  }
  const changes = difference(oldItem, newItem)
  return !!getRawVal({ rootGetters }, changes, sortBy)
}

function getRawVal ({ rootGetters }, item, column) {
  const metadata = item.metadata
  const spec = item.spec
  switch (column) {
    case 'purpose':
      return get(spec, 'purpose')
    case 'lastOperation':
      return get(item, 'status.lastOperation')
    case 'createdAt':
      return metadata.creationTimestamp
    case 'createdBy':
      return getCreatedBy(metadata)
    case 'project':
      return getProjectName(metadata)
    case 'k8sVersion':
      return get(spec, 'kubernetes.version')
    case 'infrastructure':
      return `${get(spec, 'provider.type')} ${get(spec, 'region')}`
    case 'seed':
      return get(item, 'spec.seedName')
    case 'ticketLabels': {
      const labels = rootGetters.ticketLabels(metadata)
      return join(map(labels, 'name'), ' ')
    }
    default:
      return get(metadata, column)
  }
}

function getSortVal ({ rootGetters }, item, sortBy) {
  const value = getRawVal({ rootGetters }, item, sortBy)
  const status = item.status
  switch (sortBy) {
    case 'purpose':
      switch (value) {
        case 'infrastructure':
          return 0
        case 'production':
          return 1
        case 'development':
          return 2
        case 'evaluation':
          return 3
        default:
          return 4
      }
    case 'lastOperation': {
      const operation = value || {}
      const inProgress = operation.progress !== 100 && operation.state !== 'Failed' && !!operation.progress
      const lastErrors = get(item, 'status.lastErrors', [])
      const isError = operation.state === 'Failed' || lastErrors.length
      const allErrorCodes = errorCodesFromArray(lastErrors)
      const userError = isUserError(allErrorCodes)
      const ignoredFromReconciliation = isReconciliationDeactivated(get(item, 'metadata', {}))

      if (ignoredFromReconciliation) {
        if (isError) {
          return 400
        } else {
          return 450
        }
      } else if (userError && !inProgress) {
        return 200
      } else if (userError && inProgress) {
        const progress = padStart(operation.progress, 2, '0')
        return `3${progress}`
      } else if (isError && !inProgress) {
        return 0
      } else if (isError && inProgress) {
        const progress = padStart(operation.progress, 2, '0')
        return `1${progress}`
      } else if (inProgress) {
        const progress = padStart(operation.progress, 2, '0')
        return `6${progress}`
      } else if (isShootStatusHibernated(status)) {
        return 500
      }
      return 700
    }
    case 'readiness': {
      const errorConditions = filter(get(status, 'conditions'), condition => get(condition, 'status') !== 'True')
      const lastErrorTransitionTime = head(orderBy(map(errorConditions, 'lastTransitionTime')))
      return lastErrorTransitionTime
    }
    case 'ticket': {
      const { namespace, name } = item.metadata
      return rootGetters.latestUpdatedTicketByNameAndNamespace({ namespace, name })
    }
    default:
      return toLower(value)
  }
}

function getSortedKeys ({ state, rootGetters }) {
  const sortBy = head(get(state, 'sortParams.sortBy'))
  const sortDesc = get(state, 'sortParams.sortDesc', [false])
  const sortOrder = head(sortDesc) ? 'desc' : 'asc'

  let items = Object.values(state.shoots)
  if (sortBy) {
    const sortbyNameAsc = (a, b) => {
      const nameA = getRawVal({ rootGetters }, a, 'name')
      const nameB = getRawVal({ rootGetters }, b, 'name')

      if (nameA > nameB) {
        return 1
      } else if (nameA < nameB) {
        return -1
      }
      return 0
    }
    const inverse = sortOrder === 'desc' ? -1 : 1
    switch (sortBy) {
      case 'k8sVersion': {
        items.sort((a, b) => {
          const versionA = getRawVal({ rootGetters }, a, sortBy)
          const versionB = getRawVal({ rootGetters }, b, sortBy)

          if (semver.gt(versionA, versionB)) {
            return 1 * inverse
          } else if (semver.lt(versionA, versionB)) {
            return -1 * inverse
          } else {
            return sortbyNameAsc(a, b)
          }
        })
        break
      }
      case 'readiness': {
        items.sort((a, b) => {
          const readinessA = getSortVal({ rootGetters }, a, sortBy)
          const readinessB = getSortVal({ rootGetters }, b, sortBy)

          if (readinessA === readinessB) {
            return sortbyNameAsc(a, b)
          } else if (!readinessA) {
            return 1
          } else if (!readinessB) {
            return -1
          } else if (readinessA > readinessB) {
            return 1 * inverse
          } else {
            return -1 * inverse
          }
        })
        break
      }
      default: {
        items = orderBy(items, [
          item => getSortVal({ rootGetters }, item, sortBy),
          'metadata.name'
        ], [
          sortOrder,
          'asc'
        ])
      }
    }
  }
  return map(items, item => getKey(item.metadata))
}

function getFilteredKeys ({ state, rootState, rootGetters }) {
  let keys = state.sortedShoots
  if (state.searchValue) {
    const predicate = key => {
      const item = getItemByKey(state, key)
      for (const value of state.searchValue) {
        if (includes(getRawVal({ rootGetters }, item, 'name'), value)) {
          return true
        }
        if (includes(getRawVal({ rootGetters }, item, 'infrastructure'), value)) {
          return true
        }
        if (includes(getRawVal({ rootGetters }, item, 'seed'), value)) {
          return true
        }
        if (includes(getRawVal({ rootGetters }, item, 'project'), value)) {
          return true
        }
        if (includes(getRawVal({ rootGetters }, item, 'createdBy'), value)) {
          return true
        }
        if (includes(getRawVal({ rootGetters }, item, 'purpose'), value)) {
          return true
        }
        if (includes(getRawVal({ rootGetters }, item, 'k8sVersion'), value)) {
          return true
        }
        if (includes(getRawVal({ rootGetters }, item, 'ticketLabels'), value)) {
          return true
        }
      }
      return false
    }
    keys = filter(keys, predicate)
  }
  if (rootState.namespace === '_all' && rootState.onlyShootsWithIssues) {
    if (get(state, 'shootListFilters.progressing', false)) {
      const predicate = key => {
        const item = getItemByKey(state, key)
        return !isStatusProgressing(get(item, 'metadata', {}))
      }
      keys = filter(keys, predicate)
    }
    if (get(state, 'shootListFilters.userIssues', false)) {
      const predicate = key => {
        const item = getItemByKey(state, key)
        const lastErrors = get(item, 'status.lastErrors', [])
        const allLastErrorCodes = errorCodesFromArray(lastErrors)
        const conditions = get(item, 'status.conditions', [])
        const allConditionCodes = errorCodesFromArray(conditions)
        return !isUserError(allLastErrorCodes) && !isUserError(allConditionCodes)
      }
      keys = filter(keys, predicate)
    }
    if (get(state, 'shootListFilters.deactivatedReconciliation', false)) {
      const predicate = key => {
        const item = getItemByKey(state, key)
        return !isReconciliationDeactivated(get(item, 'metadata', {}))
      }
      keys = filter(keys, predicate)
    }
    if (get(state, 'shootListFilters.hideTicketsWithLabel', false)) {
      const predicate = key => {
        const item = getItemByKey(state, key)
        const hideClustersWithLabels = get(rootState.cfg, 'ticket.hideClustersWithLabels')
        if (!hideClustersWithLabels) {
          return true
        }

        const ticketsForCluster = rootGetters.ticketsByNamespaceAndName(get(item, 'metadata', {}))
        if (!ticketsForCluster.length) {
          return true
        }

        const ticketsWithoutHideLabel = filter(ticketsForCluster, ticket => {
          const labelNames = map(get(ticket, 'data.labels'), 'name')
          const ticketHasHideLabel = some(hideClustersWithLabels, hideClustersWithLabel => includes(labelNames, hideClustersWithLabel))
          return !ticketHasHideLabel
        })
        return ticketsWithoutHideLabel.length > 0
      }
      keys = filter(keys, predicate)
    }
  }
  return keys
}

function updateSortedShoots ({ commit, state, rootState, rootGetters }) {
  commit('SET_SORTED_SHOOTS', getSortedKeys({ state, rootState, rootGetters }))
  commit('SET_FILTERED_SHOOTS', getFilteredKeys({ state, rootState, rootGetters }))
}

function updateFilteredShoots ({ commit, state, rootState, rootGetters }) {
  commit('SET_FILTERED_SHOOTS', getFilteredKeys({ state, rootState, rootGetters }))
}

function getInitialShootResource ({ rootState, rootGetters }) {
  const shootResource = {
    apiVersion: 'core.gardener.cloud/v1beta1',
    kind: 'Shoot',
    metadata: {
      namespace: rootState.namespace
    }
  }

  const infrastructureKind = head(rootGetters.sortedCloudProviderKindList)
  set(shootResource, 'spec', getSpecTemplate(infrastructureKind))

  const cloudProfileName = get(head(rootGetters.cloudProfilesByCloudProviderKind(infrastructureKind)), 'metadata.name')
  set(shootResource, 'spec.cloudProfileName', cloudProfileName)

  const secret = head(rootGetters.infrastructureSecretsByCloudProfileName(cloudProfileName))
  set(shootResource, 'spec.secretBindingName', get(secret, 'metadata.bindingName'))

  const region = head(rootGetters.regionsWithSeedByCloudProfileName(cloudProfileName))
  set(shootResource, 'spec.region', region)

  const loadBalancerProviderName = head(rootGetters.loadBalancerProviderNamesByCloudProfileNameAndRegion({ cloudProfileName, region }))
  if (!isEmpty(loadBalancerProviderName)) {
    set(shootResource, 'spec.provider.controlPlaneConfig.loadBalancerProvider', loadBalancerProviderName)
  }
  const secretDomain = get(secret, 'data.domainName')
  const floatingPoolName = head(rootGetters.floatingPoolNamesByCloudProfileNameAndRegionAndDomain({ cloudProfileName, region, secretDomain }))
  if (!isEmpty(floatingPoolName)) {
    set(shootResource, 'spec.provider.infrastructureConfig.floatingPoolName', floatingPoolName)
  }

  const allLoadBalancerClassNames = rootGetters.loadBalancerClassNamesByCloudProfileName(cloudProfileName)
  if (!isEmpty(allLoadBalancerClassNames)) {
    const loadBalancerClassNames = [
      includes(allLoadBalancerClassNames, 'default')
        ? 'default'
        : head(allLoadBalancerClassNames)
    ]
    set(shootResource, 'spec.provider.controlPlaneConfig.loadBalancerClasses', loadBalancerClassNames)
  }

  const partitionIDs = rootGetters.partitionIDsByCloudProfileNameAndRegion({ cloudProfileName, region })
  const partitionID = head(partitionIDs)
  if (!isEmpty(partitionID)) {
    set(shootResource, 'spec.provider.infrastructureConfig.partitionID', partitionID)
  }
  const firewallImages = rootGetters.firewallImagesByCloudProfileName(cloudProfileName)
  const firewallImage = head(firewallImages)
  if (!isEmpty(firewallImage)) {
    set(shootResource, 'spec.provider.infrastructureConfig.firewall.image', firewallImage)
  }
  const firewallSizes = map(rootGetters.firewallSizesByCloudProfileNameAndRegionAndZones({ cloudProfileName, region, zones: [partitionID] }), 'name')
  const firewallSize = head(firewallSizes)
  if (!isEmpty(firewallSize)) {
    set(shootResource, 'spec.provider.infrastructureConfig.firewall.size', firewallImage)
  }
  const allFirewallNetworks = rootGetters.firewallNetworksByCloudProfileNameAndPartitionId({ cloudProfileName, partitionID })
  const firewallNetworks = find(allFirewallNetworks, { key: 'internet' })
  if (!isEmpty(firewallNetworks)) {
    set(shootResource, 'spec.provider.infrastructureConfig.firewall.networks', firewallNetworks)
  }

  const name = shortRandomString(10)
  set(shootResource, 'metadata.name', name)

  const purpose = head(purposesForSecret(secret))
  set(shootResource, 'spec.purpose', purpose)

  const kubernetesVersion = rootGetters.defaultKubernetesVersionForCloudProfileName(cloudProfileName)
  set(shootResource, 'spec.kubernetes.version', kubernetesVersion.version)

  const allZones = rootGetters.zonesByCloudProfileNameAndRegion({ cloudProfileName, region })
  const zones = allZones.length ? [sample(allZones)] : undefined
  const zonesNetworkConfiguration = getDefaultZonesNetworkConfiguration(zones, infrastructureKind, allZones.length)
  if (zonesNetworkConfiguration) {
    set(shootResource, 'spec.provider.infrastructureConfig.networks.zones', zonesNetworkConfiguration)
  }

  const worker = omit(generateWorker(zones, cloudProfileName, region), ['id'])
  const workers = [worker]
  set(shootResource, 'spec.provider.workers', workers)

  const controlPlaneZone = getControlPlaneZone(workers, infrastructureKind)
  if (controlPlaneZone) {
    set(shootResource, 'spec.provider.controlPlaneConfig.zone', controlPlaneZone)
  }

  const addons = {}
  forEach(filter(shootAddonList, addon => addon.visible), addon => {
    set(addons, [addon.name, 'enabled'], addon.enabled)
  })
  const kymaEnabled = get(addons, 'kyma.enabled', false)
  delete addons.kyma
  set(shootResource, 'spec.addons', addons)
  if (rootGetters.isKymaFeatureEnabled && kymaEnabled) {
    set(shootResource, 'metadata.annotations["experimental.addons.shoot.gardener.cloud/kyma"]', 'enabled')
  }

  const { utcBegin, utcEnd } = utcMaintenanceWindowFromLocalBegin({ localBegin: randomLocalMaintenanceBegin(), timezone: rootState.localTimezone })
  const maintenance = {
    timeWindow: {
      begin: utcBegin,
      end: utcEnd
    },
    autoUpdate: {
      kubernetesVersion: true,
      machineImageVersion: true
    }
  }
  set(shootResource, 'spec.maintenance', maintenance)

  let hibernationSchedule = get(rootState.cfg.defaultHibernationSchedule, purpose)
  hibernationSchedule = map(hibernationSchedule, schedule => {
    return {
      ...schedule,
      location: rootState.localTimezone
    }
  })
  set(shootResource, 'spec.hibernation.schedules', hibernationSchedule)

  return shootResource
}

export default {
  namespaced: true,
  state,
  getters,
  actions,
  mutations
}
