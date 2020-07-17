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
import get from 'lodash/get'
import some from 'lodash/some'
import compact from 'lodash/compact'
import find from 'lodash/find'
import head from 'lodash/head'
import lowerCase from 'lodash/lowerCase'
import fromPairs from 'lodash/fromPairs'
import isEqual from 'lodash/isEqual'

export function vendorNameFromImageName (imageName) {
  const lowerCaseName = lowerCase(imageName)
  if (lowerCaseName.includes('coreos')) {
    return 'coreos'
  } else if (lowerCaseName.includes('ubuntu')) {
    return 'ubuntu'
  } else if (lowerCaseName.includes('gardenlinux')) {
    return 'gardenlinux'
  } else if (lowerCaseName.includes('suse') && lowerCaseName.includes('jeos')) {
    return 'suse-jeos'
  } else if (lowerCaseName.includes('suse') && lowerCaseName.includes('chost')) {
    return 'suse-chost'
  }
  return undefined
}

export function vendorNeedsLicense (vendorName) {
  return vendorName === 'suse-jeos' || vendorName === 'suse-chost'
}

export function matchesPropertyOrEmpty (path, srcValue) {
  return object => {
    const objValue = get(object, path)
    if (!objValue) {
      return true
    }
    return isEqual(objValue, srcValue)
  }
}

export function isValidRegion (getters, cloudProfileName, cloudProviderKind) {
  return region => {
    if (cloudProviderKind === 'azure') {
      // Azure regions may not be zoned, need to filter these out for the dashboard
      return !!getters.zonesByCloudProfileNameAndRegion({ cloudProfileName, region }).length
    }

    // Filter regions that are not defined in cloud profile
    const cloudProfile = getters.cloudProfileByName(cloudProfileName)
    if (cloudProfile) {
      return some(cloudProfile.data.regions, ['name', region])
    }

    return true
  }
}

export function mapOptionForInput (optionValue, shootResource) {
  const key = get(optionValue, 'key')
  if (!key) {
    return
  }

  const isSelectedByDefault = false
  const inputInverted = get(optionValue, 'input.inverted', false)
  const defaultValue = inputInverted ? !isSelectedByDefault : isSelectedByDefault
  const rawValue = get(shootResource, ['metadata', 'annotations', key], `${defaultValue}`) === 'true'
  const value = inputInverted ? !rawValue : rawValue

  const option = {
    value
  }
  return [key, option]
}

export function mapAccessRestrictionForInput (accessRestrictionDefinition, shootResource) {
  const key = get(accessRestrictionDefinition, 'key')
  if (!key) {
    return
  }

  const isSelectedByDefault = false
  const inputInverted = get(accessRestrictionDefinition, 'input.inverted', false)
  const defaultValue = inputInverted ? !isSelectedByDefault : isSelectedByDefault
  const rawValue = get(shootResource, ['spec', 'seedSelector', 'matchLabels', key], `${defaultValue}`) === 'true'
  const value = inputInverted ? !rawValue : rawValue

  let optionsPair = map(get(accessRestrictionDefinition, 'options'), option => mapOptionForInput(option, shootResource))
  optionsPair = compact(optionsPair)
  const options = fromPairs(optionsPair)

  const accessRestriction = {
    value,
    options
  }
  return [key, accessRestriction]
}

export function mapOptionForDisplay ({ optionDefinition, option: { value } }) {
  const {
    key,
    display: {
      visibleIf = false,
      title = key,
      description
    }
  } = optionDefinition

  const optionVisible = visibleIf === value
  if (!optionVisible) {
    return undefined // skip
  }

  return {
    key,
    title,
    description
  }
}

export function mapAccessRestrictionForDisplay ({ definition, accessRestriction: { value, options } }) {
  const {
    key,
    display: {
      visibleIf = false,
      title = key,
      description
    },
    options: optionDefinitions
  } = definition

  const accessRestrictionVisible = visibleIf === value
  if (!accessRestrictionVisible) {
    return undefined // skip
  }

  const optionsList = compact(map(optionDefinitions, optionDefinition => mapOptionForDisplay({ optionDefinition: optionDefinition, option: options[optionDefinition.key] })))

  return {
    key,
    title,
    description,
    options: optionsList
  }
}

// Return first item with classification supported, if no item has classification supported
// return first item with classifiction undefined, if no item matches these requirements,
// return first item in list
export function firstItemMatchingVersionClassification (items) {
  let defaultItem = find(items, { classification: 'supported' })
  if (defaultItem) {
    return defaultItem
  }

  defaultItem = find(items, machineImage => {
    return machineImage.classification === undefined
  })
  if (defaultItem) {
    return defaultItem
  }

  return head(items)
}
