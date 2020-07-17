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

import map from 'lodash/map'
import flatMap from 'lodash/flatMap'
import filter from 'lodash/filter'
import uniq from 'lodash/uniq'
import get from 'lodash/get'
import includes from 'lodash/includes'
import isEmpty from 'lodash/isEmpty'
import compact from 'lodash/compact'
import difference from 'lodash/difference'
import intersection from 'lodash/intersection'
import find from 'lodash/find'
import pick from 'lodash/pick'
import sortBy from 'lodash/sortBy'
import cloneDeep from 'lodash/cloneDeep'
import max from 'lodash/max'
import template from 'lodash/template'
import toPairs from 'lodash/toPairs'
import fromPairs from 'lodash/fromPairs'
import moment from 'moment-timezone'
import semver from 'semver'

import {
  gravatarUrlGeneric,
  displayName,
  fullDisplayName,
  getDateFormatted,
  canI
} from '@/utils'

import {
  vendorNameFromImageName,
  vendorNeedsLicense,
  mapAccessRestrictionForInput,
  mapAccessRestrictionForDisplay,
  firstItemMatchingVersionClassification,
  isValidRegion,
  matchesPropertyOrEmpty
} from './helpers'

const getters = {
  apiServerUrl (state) {
    return get(state.cfg, 'apiServerUrl', window.location.origin)
  },
  cloudProfileList (state) {
    return state.cloudProfiles.all
  },
  cloudProfileByName (state, getters) {
    return (name) => {
      return getters['cloudProfiles/cloudProfileByName'](name)
    }
  },
  cloudProfilesByCloudProviderKind (state) {
    return (cloudProviderKind) => {
      const predicate = item => item.metadata.cloudProviderKind === cloudProviderKind
      const filteredCloudProfiles = filter(state.cloudProfiles.all, predicate)
      return sortBy(filteredCloudProfiles, 'metadata.name')
    }
  },
  machineTypesOrVolumeTypesByCloudProfileNameAndRegionAndZones (state, getters) {
    const machineAndVolumeTypePredicate = unavailableItems => {
      return item => {
        if (item.usable === false) {
          return false
        }
        if (includes(unavailableItems, item.name)) {
          return false
        }
        return true
      }
    }

    return ({ type, cloudProfileName, region, zones }) => {
      if (!cloudProfileName) {
        return []
      }
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      if (!cloudProfile) {
        return []
      }
      const items = cloudProfile.data[type]
      if (!region || !zones) {
        return items
      }
      const regionObject = find(cloudProfile.data.regions, { name: region })
      let regionZones = get(regionObject, 'zones', [])
      regionZones = filter(regionZones, regionZone => includes(zones, regionZone.name))
      const unavailableItems = flatMap(regionZones, zone => {
        if (type === 'machineTypes') {
          return zone.unavailableMachineTypes
        } else if (type === 'volumeTypes') {
          return zone.unavailableVolumeTypes
        }
      })
      return filter(items, machineAndVolumeTypePredicate(unavailableItems))
    }
  },
  machineTypesByCloudProfileName (state, getters) {
    return ({ cloudProfileName }) => {
      return getters.machineTypesByCloudProfileNameAndRegionAndZones({ cloudProfileName })
    }
  },
  machineTypesByCloudProfileNameAndRegionAndZones (state, getters) {
    return ({ cloudProfileName, region, zones }) => {
      return getters.machineTypesOrVolumeTypesByCloudProfileNameAndRegionAndZones({ type: 'machineTypes', cloudProfileName, region, zones })
    }
  },
  volumeTypesByCloudProfileName (state, getters) {
    return ({ cloudProfileName }) => {
      return getters.volumeTypesByCloudProfileNameAndRegionAndZones({ cloudProfileName })
    }
  },
  volumeTypesByCloudProfileNameAndRegionAndZones (state, getters) {
    return ({ cloudProfileName, region, zones }) => {
      return getters.machineTypesOrVolumeTypesByCloudProfileNameAndRegionAndZones({ type: 'volumeTypes', cloudProfileName, region, zones })
    }
  },
  machineImagesByCloudProfileName (state, getters) {
    return (cloudProfileName) => {
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      const machineImages = get(cloudProfile, 'data.machineImages')

      const mapMachineImages = (machineImage) => {
        const versions = filter(machineImage.versions, ({ version, expirationDate }) => {
          if (!semver.valid(version)) {
            console.error(`Skipped machine image ${machineImage.name} as version ${version} is not a valid semver version`)
            return false
          }
          return true
        })
        versions.sort((a, b) => {
          return semver.rcompare(a.version, b.version)
        })

        return map(versions, ({ version, expirationDate, classification }) => {
          const vendorName = vendorNameFromImageName(machineImage.name)
          const name = machineImage.name

          return {
            key: name + '/' + version,
            name,
            version,
            classification,
            isPreview: classification === 'preview',
            isSupported: classification === 'supported',
            isDeprecated: classification === 'deprecated',
            isExpired: expirationDate && moment().isAfter(expirationDate),
            expirationDate,
            expirationDateString: getDateFormatted(expirationDate),
            vendorName,
            icon: vendorName,
            needsLicense: vendorNeedsLicense(vendorName)
          }
        })
      }

      return flatMap(machineImages, mapMachineImages)
    }
  },
  zonesByCloudProfileNameAndRegion (state, getters) {
    return ({ cloudProfileName, region }) => {
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      if (cloudProfile) {
        return map(get(find(cloudProfile.data.regions, { name: region }), 'zones'), 'name')
      }
      return []
    }
  },
  accessRestrictionNoItemsTextForCloudProfileNameAndRegion (state, getters) {
    return ({ cloudProfileName: cloudProfile, region }) => {
      const noItemsText = get(state, 'cfg.accessRestriction.noItemsText', 'No access restriction options available for region ${region}') // eslint-disable-line no-template-curly-in-string

      const compiled = template(noItemsText)
      return compiled({
        region,
        cloudProfile
      })
    }
  },
  accessRestrictionDefinitionsByCloudProfileNameAndRegion (state, getters) {
    return ({ cloudProfileName, region }) => {
      if (!cloudProfileName) {
        return undefined
      }
      if (!region) {
        return undefined
      }

      const labels = getters.labelsByCloudProfileNameAndRegion({ cloudProfileName, region })
      if (isEmpty(labels)) {
        return undefined
      }

      const items = get(state, 'cfg.accessRestriction.items')
      return filter(items, ({ key }) => {
        if (!key) {
          return false
        }
        return labels[key] === 'true'
      })
    }
  },
  accessRestrictionsForShootByCloudProfileNameAndRegion (state, getters) {
    return ({ shootResource, cloudProfileName, region }) => {
      const definitions = getters.accessRestrictionDefinitionsByCloudProfileNameAndRegion({ cloudProfileName, region })

      let accessRestrictionsMap = map(definitions, definition => mapAccessRestrictionForInput(definition, shootResource))
      accessRestrictionsMap = compact(accessRestrictionsMap)
      return fromPairs(accessRestrictionsMap)
    }
  },
  selectedAccessRestrictionsForShootByCloudProfileNameAndRegion (state, getters) {
    return ({ shootResource, cloudProfileName, region }) => {
      const definitions = getters.accessRestrictionDefinitionsByCloudProfileNameAndRegion({ cloudProfileName, region })
      const accessRestrictions = getters.accessRestrictionsForShootByCloudProfileNameAndRegion({ shootResource, cloudProfileName, region })

      return compact(map(definitions, definition => mapAccessRestrictionForDisplay({ definition, accessRestriction: accessRestrictions[definition.key] })))
    }
  },
  labelsByCloudProfileNameAndRegion (state, getters) {
    return ({ cloudProfileName, region }) => {
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      if (cloudProfile) {
        return get(find(cloudProfile.data.regions, { name: region }), 'labels')
      }
      return {}
    }
  },
  defaultMachineImageForCloudProfileName (state, getters) {
    return (cloudProfileName) => {
      const machineImages = getters.machineImagesByCloudProfileName(cloudProfileName)
      const defaultMachineImage = firstItemMatchingVersionClassification(machineImages)
      return pick(defaultMachineImage, 'name', 'version')
    }
  },
  shootList (state, getters) {
    return getters['shoots/sortedItems']
  },
  selectedShoot (state, getters) {
    return getters['shoots/selectedItem']
  },
  projectList (state) {
    return state.projects.all
  },
  projectByNamespace (state) {
    return namespace => {
      return find(state.projects.all, ['metadata.namespace', namespace])
    }
  },
  project (state, getters) {
    return getters.projectByNamespace(state.namespace)
  },
  projectNameByNamespace (state, getters) {
    return namespace => {
      return get(getters.projectByNamespace(namespace), 'metadata.name')
    }
  },
  projectName (state, getters) {
    return getters.projectNameByNamespace(state.namespace)
  },
  projectNamesFromProjectList (state, getters) {
    return map(state.projects.all, 'metadata.name')
  },
  costObjectSettings (state) {
    const costObject = state.cfg.costObject
    if (!costObject) {
      return undefined
    }

    const title = costObject.title || ''
    const description = costObject.description || ''
    const regex = costObject.regex
    const errorMessage = costObject.errorMessage

    return {
      regex,
      title,
      description,
      errorMessage
    }
  },
  memberList (state, getters) {
    return state.members.all
  },
  infrastructureSecretList (state) {
    return state.infrastructureSecrets.all
  },
  getInfrastructureSecretByName (state, getters) {
    return ({ namespace, name }) => {
      return getters['infrastructureSecrets/getInfrastructureSecretByName']({ namespace, name })
    }
  },
  namespaces (state) {
    return map(state.projects.all, 'metadata.namespace')
  },
  cloudProviderKindList (state) {
    return uniq(map(state.cloudProfiles.all, 'metadata.cloudProviderKind'))
  },
  sortedCloudProviderKindList (state, getters) {
    return intersection(['aws', 'azure', 'gcp', 'openstack', 'alicloud', 'metal', 'vsphere'], getters.cloudProviderKindList)
  },
  regionsWithSeedByCloudProfileName (state, getters) {
    return (cloudProfileName) => {
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      if (!cloudProfile) {
        return []
      }
      const seeds = cloudProfile.data.seeds
      if (!seeds) {
        return []
      }
      const uniqueSeedRegions = uniq(map(seeds, 'data.region'))
      const uniqueSeedRegionsWithZones = filter(uniqueSeedRegions, isValidRegion(getters, cloudProfileName, cloudProfile.metadata.cloudProviderKind))
      return uniqueSeedRegionsWithZones
    }
  },
  regionsWithoutSeedByCloudProfileName (state, getters) {
    return (cloudProfileName) => {
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      if (cloudProfile) {
        const regionsInCloudProfile = map(cloudProfile.data.regions, 'name')
        const regionsInCloudProfileWithZones = filter(regionsInCloudProfile, isValidRegion(getters, cloudProfileName, cloudProfile.metadata.cloudProviderKind))
        const regionsWithoutSeed = difference(regionsInCloudProfileWithZones, getters.regionsWithSeedByCloudProfileName(cloudProfileName))
        return regionsWithoutSeed
      }
      return []
    }
  },
  minimumVolumeSizeByCloudProfileNameAndRegion (state, getters) {
    return ({ cloudProfileName, region }) => {
      const defaultMinimumSize = '20Gi'
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      if (!cloudProfile) {
        return defaultMinimumSize
      }
      const seedsForCloudProfile = cloudProfile.data.seeds
      const seedsMatchingCloudProfileAndRegion = find(seedsForCloudProfile, { data: { region } })
      return max(map(seedsMatchingCloudProfileAndRegion, 'volume.minimumSize')) || defaultMinimumSize
    }
  },
  floatingPoolNamesByCloudProfileNameAndRegionAndDomain (state, getters) {
    return ({ cloudProfileName, region, secretDomain }) => {
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      const floatingPools = get(cloudProfile, 'data.providerConfig.constraints.floatingPools')
      let availableFloatingPools = filter(floatingPools, matchesPropertyOrEmpty('region', region))
      availableFloatingPools = filter(availableFloatingPools, matchesPropertyOrEmpty('domain', secretDomain))

      const hasRegionSpecificFloatingPool = find(availableFloatingPools, fp => !!fp.region && !fp.nonConstraining)
      if (hasRegionSpecificFloatingPool) {
        availableFloatingPools = filter(availableFloatingPools, { region })
      }
      const hasDomainSpecificFloatingPool = find(availableFloatingPools, fp => !!fp.domain && !fp.nonConstraining)
      if (hasDomainSpecificFloatingPool) {
        availableFloatingPools = filter(availableFloatingPools, { domain: secretDomain })
      }

      return uniq(map(availableFloatingPools, 'name'))
    }
  },
  loadBalancerProviderNamesByCloudProfileNameAndRegion (state, getters) {
    return ({ cloudProfileName, region }) => {
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      const loadBalancerProviders = get(cloudProfile, 'data.providerConfig.constraints.loadBalancerProviders')
      let availableLoadBalancerProviders = filter(loadBalancerProviders, matchesPropertyOrEmpty('region', region))
      const hasRegionSpecificLoadBalancerProvider = find(availableLoadBalancerProviders, lb => !!lb.region)
      if (hasRegionSpecificLoadBalancerProvider) {
        availableLoadBalancerProviders = filter(availableLoadBalancerProviders, { region })
      }
      return uniq(map(availableLoadBalancerProviders, 'name'))
    }
  },
  loadBalancerClassNamesByCloudProfileName (state, getters) {
    return (cloudProfileName) => {
      const loadBalancerClasses = getters.loadBalancerClassesByCloudProfileName(cloudProfileName)
      return uniq(map(loadBalancerClasses, 'name'))
    }
  },
  loadBalancerClassesByCloudProfileName (state, getters) {
    return (cloudProfileName) => {
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      return get(cloudProfile, 'data.providerConfig.constraints.loadBalancerConfig.classes')
    }
  },
  partitionIDsByCloudProfileNameAndRegion (state, getters) {
    return ({ cloudProfileName, region }) => {
      // Partion IDs equal zones for metal infrastructure
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      if (get(cloudProfile, 'metadata.cloudProviderKind') !== 'metal') {
        return
      }
      const partitionIDs = getters.zonesByCloudProfileNameAndRegion({ cloudProfileName, region })
      return partitionIDs
    }
  },
  firewallSizesByCloudProfileNameAndRegionAndZones (state, getters) {
    return ({ cloudProfileName, region }) => {
      // Firewall Sizes equals to list of image types for this zone
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      if (get(cloudProfile, 'metadata.cloudProviderKind') !== 'metal') {
        return
      }
      const firewallSizes = getters.machineTypesByCloudProfileNameAndRegionAndZones({ cloudProfileName, region })
      return firewallSizes
    }
  },
  firewallImagesByCloudProfileName (state, getters) {
    return (cloudProfileName) => {
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      return get(cloudProfile, 'data.providerConfig.firewallImages')
    }
  },
  firewallNetworksByCloudProfileNameAndPartitionId (state, getters) {
    return ({ cloudProfileName, partitionID }) => {
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      const networks = get(cloudProfile, ['data', 'providerConfig', 'firewallNetworks', partitionID])
      return map(toPairs(networks), ([key, value]) => {
        return {
          key,
          value,
          text: `${key} [${value}]`
        }
      })
    }
  },

  infrastructureSecretsByInfrastructureKind (state) {
    return (infrastructureKind) => {
      return filter(state.infrastructureSecrets.all, ['metadata.cloudProviderKind', infrastructureKind])
    }
  },
  infrastructureSecretsByCloudProfileName (state) {
    return (cloudProfileName) => {
      return filter(state.infrastructureSecrets.all, ['metadata.cloudProfileName', cloudProfileName])
    }
  },
  shootByNamespaceAndName (state, getters) {
    return ({ namespace, name }) => {
      return getters['shoots/itemByNamespaceAndName']({ namespace, name })
    }
  },
  ticketsByNamespaceAndName (state, getters) {
    return ({ namespace, name }) => {
      const projectName = getters.projectNameByNamespace(namespace)
      return getters['tickets/itemsByProjectAndName'](projectName, name)
    }
  },
  latestUpdatedTicketByNameAndNamespace (state, getters) {
    return ({ namespace, name }) => {
      const projectName = getters.projectNameByNamespace(namespace)
      return getters['tickets/latestUpdated'](projectName, name)
    }
  },
  ticketLabels (state, getters) {
    return ({ namespace, name }) => {
      const projectName = getters.projectNameByNamespace(namespace)
      return getters['tickets/labels'](projectName, name)
    }
  },
  ticketCommentsByIssueNumber (state, getters) {
    return ({ issueNumber }) => {
      return getters['comments/itemsByTicket'](issueNumber)
    }
  },
  kubernetesVersions (state, getters) {
    return (cloudProfileName) => {
      const cloudProfile = getters.cloudProfileByName(cloudProfileName)
      const allVersions = get(cloudProfile, 'data.kubernetes.versions', [])
      const validVersions = filter(allVersions, ({ expirationDate, version }) => {
        if (!semver.valid(version)) {
          console.error(`Skipped Kubernetes version ${version} as it is not a valid semver version`)
          return false
        }
        return true
      })
      return map(validVersions, version => {
        const classification = version.classification
        return {
          ...version,
          isPreview: classification === 'preview',
          isSupported: classification === 'supported',
          isDeprecated: classification === 'deprecated',
          isExpired: version.expirationDate && moment().isAfter(version.expirationDate),
          expirationDateString: getDateFormatted(version.expirationDate)
        }
      })
    }
  },
  sortedKubernetesVersions (state, getters) {
    return (cloudProfileName) => {
      const kubernetsVersions = cloneDeep(getters.kubernetesVersions(cloudProfileName))
      kubernetsVersions.sort((a, b) => {
        return semver.rcompare(a.version, b.version)
      })
      return kubernetsVersions
    }
  },
  defaultKubernetesVersionForCloudProfileName (state, getters) {
    return (cloudProfileName) => {
      const k8sVersions = getters.sortedKubernetesVersions(cloudProfileName)
      return firstItemMatchingVersionClassification(k8sVersions)
    }
  },
  isAdmin (state) {
    return get(state.user, 'isAdmin', false)
  },
  ticketList (state) {
    return state.tickets.all
  },
  username (state) {
    const user = state.user
    return user ? user.email || user.id : ''
  },
  userExpiresAt (state) {
    const user = state.user
    return user ? user.exp * 1000 : 0
  },
  avatarUrl (state, getters) {
    return gravatarUrlGeneric(getters.username)
  },
  displayName (state) {
    const user = state.user
    return user ? user.name || displayName(user.id) : ''
  },
  fullDisplayName (state) {
    const user = state.user
    return user ? user.name || fullDisplayName(user.id) : ''
  },
  alertMessage (state) {
    return get(state, 'alert.message', '')
  },
  alertType (state) {
    return get(state, 'alert.type', 'error')
  },
  alertBannerMessage (state) {
    return get(state, 'alertBanner.message', '')
  },
  alertBannerType (state) {
    return get(state, 'alertBanner.type', 'error')
  },
  currentNamespaces (state, getters) {
    if (state.namespace === '_all') {
      return getters.namespaces
    }
    if (state.namespace) {
      return [state.namespace]
    }
    return []
  },
  isCurrentNamespace (state, getters) {
    return namespace => includes(getters.currentNamespaces, namespace)
  },
  isWebsocketConnectionError (state) {
    return get(state, 'websocketConnectionError') !== null
  },
  websocketConnectAttempt (state) {
    return get(state, 'websocketConnectionError.reconnectAttempt')
  },
  getShootListFilters (state, getters) {
    return getters['shoots/getShootListFilters']
  },
  newShootResource (state, getters) {
    return getters['shoots/newShootResource']
  },
  initialNewShootResource (state, getters) {
    return getters['shoots/initialNewShootResource']
  },
  hasGardenTerminalAccess (state, getters) {
    return getters.isTerminalEnabled && getters.canCreateTerminals && getters.isAdmin
  },
  hasControlPlaneTerminalAccess (state, getters) {
    return getters.isTerminalEnabled && getters.canCreateTerminals && getters.isAdmin
  },
  hasShootTerminalAccess (state, getters) {
    return getters.isTerminalEnabled && getters.canCreateTerminals
  },
  isTerminalEnabled (state, getters) {
    return get(state, 'cfg.features.terminalEnabled', false)
  },
  isKymaFeatureEnabled (state, getters) {
    return get(state, 'cfg.features.kymaEnabled', false)
  },
  canCreateTerminals (state) {
    return canI(state.subjectRules, 'create', 'dashboard.gardener.cloud', 'terminals')
  },
  canCreateShoots (state) {
    return canI(state.subjectRules, 'create', 'core.gardener.cloud', 'shoots')
  },
  canPatchShoots (state) {
    return canI(state.subjectRules, 'patch', 'core.gardener.cloud', 'shoots')
  },
  canDeleteShoots (state) {
    return canI(state.subjectRules, 'delete', 'core.gardener.cloud', 'shoots')
  },
  canGetSecrets (state) {
    return canI(state.subjectRules, 'list', '', 'secrets')
  },
  canCreateProject (state) {
    return canI(state.subjectRules, 'create', 'core.gardener.cloud', 'projects')
  },
  canPatchProject (state, getters) {
    const name = getters.projectName
    return canI(state.subjectRules, 'patch', 'core.gardener.cloud', 'projects', name)
  },
  canDeleteProject (state, getters) {
    const name = getters.projectName
    return canI(state.subjectRules, 'delete', 'core.gardener.cloud', 'projects', name)
  },
  draggingDragAndDropId (state, getters) {
    return getters['draggable/draggingDragAndDropId']
  },
  focusedElementId (state) {
    return state.focusedElementId
  },
  splitpaneResize (state) {
    return state.splitpaneResize
  },
  isKubeconfigEnabled (state) {
    return !!(get(state, 'kubeconfigData.oidc.clientId') && get(state, 'kubeconfigData.oidc.clientSecret'))
  }
}

export default getters
