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
import map from 'lodash/map'
import some from 'lodash/some'

import {
  addKymaAddon
} from '@/utils'

import {
  getSubjectRules,
  getKubeconfigData
} from '@/utils/api'

// actions
const actions = {
  fetchAll ({ dispatch }, resources) {
    const iteratee = (value, key) => dispatch(key, value)
    return Promise
      .all(map(resources, iteratee))
      .catch(err => {
        dispatch('setError', err)
      })
  },
  fetchCloudProfiles ({ dispatch }) {
    return dispatch('cloudProfiles/getAll')
      .catch(err => {
        dispatch('setError', err)
      })
  },
  fetchProjects ({ dispatch }) {
    return dispatch('projects/getAll')
      .catch(err => {
        dispatch('setError', err)
      })
  },
  fetchMembers ({ dispatch }) {
    return dispatch('members/getAll')
      .catch(err => {
        dispatch('setError', err)
      })
  },
  fetchInfrastructureSecrets ({ dispatch }) {
    return dispatch('infrastructureSecrets/getAll')
      .catch(err => {
        dispatch('setError', err)
      })
  },
  clearShoots ({ dispatch }) {
    return dispatch('shoots/clearAll')
      .catch(err => {
        dispatch('setError', err)
      })
  },
  clearIssues ({ dispatch }) {
    return dispatch('tickets/clearAll')
      .catch(err => {
        dispatch('setError', err)
      })
  },
  clearComments ({ dispatch }) {
    return dispatch('comments/clearAll')
      .catch(err => {
        dispatch('setError', err)
      })
  },
  getShootInfo ({ dispatch }, { name, namespace }) {
    return dispatch('shoots/getInfo', { name, namespace })
      .catch(err => {
        dispatch('setError', err)
      })
  },
  getShootSeedInfo ({ dispatch }, { name, namespace }) {
    return dispatch('shoots/getSeedInfo', { name, namespace })
      .catch(err => {
        dispatch('setError', err)
      })
  },
  getShootAddonKyma ({ dispatch }, { name, namespace }) {
    return dispatch('shoots/getAddonKyma', { name, namespace })
      .catch(err => {
        dispatch('setError', err)
      })
  },
  subscribeShoot ({ dispatch }, { name }) {
    return dispatch('shoots/setSubscription', { name })
  },
  subscribeShoots ({ dispatch }) {
    return dispatch('shoots/setSubscription', {})
  },
  unsubscribeShoots ({ dispatch }) {
    return dispatch('shoots/setSubscription', undefined)
  },
  subscribeTickets ({ dispatch }) {
    return dispatch('tickets/setSubscription', {})
  },
  unsubscribeTickets ({ dispatch }) {
    return dispatch('tickets/setSubscription', undefined)
  },
  subscribeComments ({ dispatch }, { name }) {
    return dispatch('comments/setSubscription', { name })
  },
  unsubscribeComments ({ dispatch }) {
    return dispatch('comments/setSubscription', undefined)
  },
  setSelectedShoot ({ dispatch }, metadata) {
    return dispatch('shoots/setSelection', metadata)
      .catch(err => {
        dispatch('setError', err)
      })
  },
  setShootListSortParams ({ dispatch }, options) {
    return dispatch('shoots/setListSortParams', options)
      .catch(err => {
        dispatch('setError', err)
      })
  },
  setShootListFilters ({ dispatch }, value) {
    return dispatch('shoots/setShootListFilters', value)
      .catch(err => {
        dispatch('setError', err)
      })
  },
  setShootListFilter ({ dispatch }, { filter, value }) {
    return dispatch('shoots/setShootListFilter', { filter, value })
      .catch(err => {
        dispatch('setError', err)
      })
  },
  setShootListSearchValue ({ dispatch }, searchValue) {
    return dispatch('shoots/setListSearchValue', searchValue)
      .catch(err => {
        dispatch('setError', err)
      })
  },
  setNewShootResource ({ dispatch }, data) {
    return dispatch('shoots/setNewShootResource', data)
  },
  resetNewShootResource ({ dispatch }) {
    return dispatch('shoots/resetNewShootResource')
  },
  createProject ({ dispatch }, data) {
    return dispatch('projects/create', data)
      .then(res => {
        dispatch('setAlert', { message: 'Project created', type: 'success' })
        return res
      })
  },
  patchProject ({ dispatch }, data) {
    return dispatch('projects/patch', data)
  },
  updateProject ({ dispatch }, data) {
    return dispatch('projects/update', data)
      .then(res => {
        dispatch('setAlert', { message: 'Project updated', type: 'success' })
        return res
      })
  },
  deleteProject ({ dispatch }, data) {
    return dispatch('projects/delete', data)
      .then(res => {
        dispatch('setAlert', { message: 'Project deleted', type: 'success' })
        return res
      })
  },
  createInfrastructureSecret ({ dispatch }, data) {
    return dispatch('infrastructureSecrets/create', data)
      .then(res => {
        dispatch('setAlert', { message: 'Infractructure secret created', type: 'success' })
        return res
      })
  },
  updateInfrastructureSecret ({ dispatch }, data) {
    return dispatch('infrastructureSecrets/update', data)
      .then(res => {
        dispatch('setAlert', { message: 'Infractructure secret updated', type: 'success' })
        return res
      })
  },
  deleteInfrastructureSecret ({ dispatch }, data) {
    return dispatch('infrastructureSecrets/delete', data)
      .then(res => {
        dispatch('setAlert', { message: 'Infractructure secret deleted', type: 'success' })
        return res
      })
  },
  createShoot ({ dispatch }, data) {
    return dispatch('shoots/create', data)
      .then(res => {
        dispatch('setAlert', { message: 'Cluster created', type: 'success' })
        return res
      })
  },
  deleteShoot ({ dispatch }, { name, namespace }) {
    return dispatch('shoots/delete', { name, namespace })
      .then(res => {
        dispatch('setAlert', { message: 'Cluster marked for deletion', type: 'success' })
        return res
      })
  },
  async addMember ({ dispatch }, payload) {
    const result = await dispatch('members/add', payload)
    await dispatch('setAlert', { message: 'Member added', type: 'success' })
    return result
  },
  async updateMember ({ dispatch }, payload) {
    const result = await dispatch('members/update', payload)
    await dispatch('setAlert', { message: 'Member updated', type: 'success' })
    return result
  },
  async deleteMember ({ dispatch }, payload) {
    try {
      const result = await dispatch('members/delete', payload)
      await dispatch('setAlert', { message: 'Member deleted', type: 'success' })
      return result
    } catch (err) {
      await dispatch('setError', { message: `Delete member failed. ${err.message}` })
    }
  },
  setConfiguration ({ commit, state, getters }, value) {
    commit('SET_CONFIGURATION', value)

    if (getters.isKymaFeatureEnabled) {
      addKymaAddon(value.kyma)
    }

    const alertBanner = value.alert
    if (alertBanner) {
      commit('SET_ALERT_BANNER', alertBanner)
    }

    const conditions = value.knownConditions
    if (conditions) {
      commit('SET_CONDITIONS', conditions)
    }

    return state.cfg
  },
  async setNamespace ({ commit, dispatch, state }, namespace) {
    commit('SET_NAMESPACE', namespace)
    await dispatch('refreshSubjectRules', namespace)
    return state.namespace
  },
  async refreshSubjectRules ({ commit, state }, namespace) {
    try {
      const { data: subjectRules } = await getSubjectRules({ namespace })
      commit('SET_SUBJECT_RULES', subjectRules)
    } catch (err) {
      commit('SET_SUBJECT_RULES', undefined)
      throw err
    }
    return state.subjectRules
  },
  async fetchKubeconfigData ({ commit, state }) {
    if (!state.kubeconfigData) {
      const { data } = await getKubeconfigData()
      commit('SET_KUBECONFIG_DATA', data)
    }
  },
  async setOnlyShootsWithIssues ({ commit, dispatch, state }, value) {
    commit('SET_ONLY_SHOOTS_WITH_ISSUES', value)
    await dispatch('subscribeShoots')
    return state.onlyShootsWithIssues
  },
  setUser ({ commit, state }, value) {
    if (value) {
      commit('SET_USER', value)
      commit('CONNECT')
    } else {
      commit('SET_USER', null)
      commit('DISCONNECT')
    }
    return state.user
  },
  unsetUser ({ commit }) {
    commit('SET_USER', null)
    commit('DISCONNECT', false)
  },
  setSidebar ({ commit, state }, value) {
    commit('SET_SIDEBAR', value)
    return state.sidebar
  },
  setLoading ({ commit, state }) {
    commit('SET_LOADING', true)
    return state.loading
  },
  unsetLoading ({ commit, state }) {
    commit('SET_LOADING', false)
    return state.loading
  },
  setShootsLoading ({ commit, state }) {
    commit('SET_SHOOTS_LOADING', true)
    return state.shootsLoading
  },
  unsetShootsLoading ({ commit, state, getters }, namespaces) {
    const currentNamespace = !some(namespaces, namespace => !getters.isCurrentNamespace(namespace))
    if (currentNamespace) {
      commit('SET_SHOOTS_LOADING', false)
    }
    return state.shootsLoading
  },
  connected ({ commit, dispatch }) {
    commit('SET_WEBSOCKET_CONNECTION_ERROR', null)
    const topics = ['shoots', 'tickets', 'comments']
    for (const topic of topics) {
      commit(topic + '/SUBSCRIBE')
    }
  },
  disconnected ({ commit }, reason) {
    commit('SET_WEBSOCKET_CONNECTION_ERROR', { reason })
  },
  reconnecting ({ commit }, attempt) {
    commit('SET_WEBSOCKET_CONNECTION_ERROR', { reconnectAttempt: attempt })
  },
  setError ({ commit, state }, value) {
    commit('SET_ALERT', { message: get(value, 'message', ''), type: 'error' })
    return state.alert
  },
  setAlert ({ commit, state }, value) {
    commit('SET_ALERT', value)
    return state.alert
  },
  setAlertBanner ({ commit, state }, value) {
    commit('SET_ALERT_BANNER', value)
    return state.alertBanner
  },
  setDraggingDragAndDropId ({ dispatch }, draggingDragAndDropId) {
    return dispatch('draggable/setDraggingDragAndDropId', draggingDragAndDropId)
  },
  setSplitpaneResize ({ commit, state }, value) { // TODO setSplitpaneResize called too often
    commit('SPLITPANE_RESIZE', value)
    return state.splitpaneResize
  }
}

export default actions
