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

import forEach from 'lodash/forEach'
import omit from 'lodash/omit'
import map from 'lodash/map'
import get from 'lodash/get'
import transform from 'lodash/transform'
import isEqual from 'lodash/isEqual'
import isObject from 'lodash/isObject'
import orderBy from 'lodash/orderBy'
import toLower from 'lodash/toLower'
import padStart from 'lodash/padStart'
import filter from 'lodash/filter'
import includes from 'lodash/includes'
import some from 'lodash/some'
import join from 'lodash/join'
import set from 'lodash/set'
import head from 'lodash/head'
import sample from 'lodash/sample'
import isEmpty from 'lodash/isEmpty'
import semver from 'semver'
import { v4 as uuidv4 } from 'uuid'

import {
  getSpecTemplate,
  getDefaultZonesNetworkConfiguration,
  getControlPlaneZone
} from '@/utils/createShoot'

import {
  isShootStatusHibernated,
  isReconciliationDeactivated,
  isStatusProgressing,
  getCreatedBy,
  purposesForSecret,
  shortRandomString,
  shootAddonList,
  utcMaintenanceWindowFromLocalBegin,
  randomLocalMaintenanceBegin,
  parseSize
} from '@/utils'

import {
  isUserError,
  errorCodesFromArray
} from '@/utils/errorCodes'

export function getKey ({ namespace, name }) {
  return namespace + '/' + name
}

export function getItemByKey (state, key) {
  return state.shoots[key]
}

// Deep diff between two object, using lodash
export function difference (object, baseObject) {
  const iteratee = (accumulator, value, key) => {
    const baseValue = baseObject[key]
    if (!isEqual(value, baseValue)) {
      accumulator[key] = isObject(value) && isObject(baseValue) ? difference(value, baseValue) : value
    }
  }
  return transform(object, iteratee)
}

export function isSortRequired ({ state, rootGetters }, newItem, oldItem) {
  const sortBy = head(get(state, 'sortParams.sortBy'))
  if (includes(['name', 'infrastructure', 'project', 'createdAt', 'createdBy', 'ticketLabels'], sortBy)) {
    return false // these values cannot change
  }
  if (sortBy === 'lastOperation') {
    return true // don't check in this case as most put events will be lastOperation anyway
  }
  const changes = difference(oldItem, newItem)
  return !!getRawVal({ rootGetters }, changes, sortBy)
}

export function getRawVal ({ rootGetters }, item, column) {
  const { metadata, spec } = item
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
      return rootGetters.projectNameByNamespace(metadata.namespace)
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

export function getSortVal ({ rootGetters }, item, sortBy) {
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

export function getSortedKeys ({ state, rootGetters }) {
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

export function getFilteredKeys ({ state, rootState, rootGetters }) {
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

export function updateSortedShoots ({ commit, state, rootState, rootGetters }) {
  commit('SET_SORTED_SHOOTS', getSortedKeys({ state, rootState, rootGetters }))
  commit('SET_FILTERED_SHOOTS', getFilteredKeys({ state, rootState, rootGetters }))
}

export function updateFilteredShoots ({ commit, state, rootState, rootGetters }) {
  commit('SET_FILTERED_SHOOTS', getFilteredKeys({ state, rootState, rootGetters }))
}

export function getInitialWorker ({ rootGetters }, { cloudProfileName, region, zones }) {
  const id = uuidv4()
  const name = `worker-${shortRandomString(5)}`
  if (zones && zones.length) {
    zones = [sample(zones)]
  }
  const machineTypesForZone = rootGetters.machineTypesByCloudProfileNameAndRegionAndZones({ cloudProfileName, region, zones })
  const machineType = get(head(machineTypesForZone), 'name')
  const volumeTypesForZone = rootGetters.volumeTypesByCloudProfileNameAndRegionAndZones({ cloudProfileName, region, zones })
  const volumeType = get(head(volumeTypesForZone), 'name')
  const machineImage = rootGetters.defaultMachineImageForCloudProfileName(cloudProfileName)
  const minVolumeSize = rootGetters.minimumVolumeSizeByCloudProfileNameAndRegion({ cloudProfileName, region })
  const defaultVolumeSize = parseSize(minVolumeSize) <= parseSize('50Gi') ? '50Gi' : minVolumeSize
  const worker = {
    id,
    name,
    minimum: 1,
    maximum: 2,
    maxSurge: 1,
    machine: {
      type: machineType,
      image: machineImage
    },
    zones
  }
  if (volumeType) {
    worker.volume = {
      type: volumeType,
      size: defaultVolumeSize
    }
  }

  return worker
}

export function getInitialShootResource ({ rootState, rootGetters }) {
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

  const worker = omit(getInitialWorker({ rootGetters }, { cloudProfileName, region, zones }), ['id'])
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

  const localBegin = randomLocalMaintenanceBegin()
  const timezone = rootState.localTimezone
  const { utcBegin, utcEnd } = utcMaintenanceWindowFromLocalBegin({ localBegin, timezone })
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
