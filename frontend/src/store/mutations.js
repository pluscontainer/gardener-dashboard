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

import merge from 'lodash/merge'

const mutations = {
  SET_CONFIGURATION (state, value) {
    state.cfg = value
  },
  SET_READY (state, value) {
    state.ready = value
  },
  SET_NAMESPACE (state, value) {
    if (value !== state.namespace) {
      state.namespace = value
      // no need to subscribe for shoots here as this is done in the router on demand (as not all routes require the shoots to be loaded)
    }
  },
  SET_SUBJECT_RULES (state, value) {
    state.subjectRules = value
  },
  SET_KUBECONFIG_DATA (state, value) {
    state.kubeconfigData = value
  },
  SET_ONLY_SHOOTS_WITH_ISSUES (state, value) {
    state.onlyShootsWithIssues = value
  },
  SET_USER (state, value) {
    state.user = value
  },
  CONNECT (state) {
    state.connectSocket = true
  },
  DISCONNECT (state) {
    state.connectSocket = false
  },
  SET_SIDEBAR (state, value) {
    state.sidebar = value
  },
  SET_LOADING (state, value) {
    state.loading = value
  },
  SET_SHOOTS_LOADING (state, value) {
    state.shootsLoading = value
  },
  SET_WEBSOCKET_CONNECTION_ERROR (state, value) {
    if (value) {
      state.websocketConnectionError = merge({}, state.websocketConnectionError, value)
    } else {
      state.websocketConnectionError = null
    }
  },
  SET_ALERT (state, value) {
    state.alert = value
  },
  SET_ALERT_BANNER (state, value) {
    state.alertBanner = value
  },
  SET_CONDITION (state, { conditionKey, conditionValue }) {
    Vue.set(state.conditionCache, conditionKey, conditionValue)
  },
  SET_FOCUSED_ELEMENT_ID (state, value) {
    state.focusedElementId = value
  },
  UNSET_FOCUSED_ELEMENT_ID (state, value) {
    if (state.focusedElementId === value) {
      state.focusedElementId = null
    }
  },
  SPLITPANE_RESIZE (state, value) {
    state.splitpaneResize = value
  }
}

export default mutations
