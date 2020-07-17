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

import moment from 'moment-timezone'

const state = {
  cfg: null,
  kubeconfigData: null,
  ready: false,
  namespace: null,
  subjectRules: { // selfSubjectRules for state.namespace
    resourceRules: null,
    nonResourceRules: null,
    incomplete: false,
    evaluationError: null
  },
  onlyShootsWithIssues: true,
  connectSocket: false,
  sidebar: true,
  user: null,
  redirectPath: null,
  loading: false,
  alert: null,
  alertBanner: null,
  shootsLoading: false,
  websocketConnectionError: null,
  localTimezone: moment.tz.guess(),
  focusedElementId: null,
  splitpaneResize: null,
  splitpaneLayouts: {},
  conditionCache: {
    APIServerAvailable: {
      displayName: 'API Server',
      shortName: 'API',
      description: 'Indicates whether the shoot\'s kube-apiserver is healthy and available. If this is in error state then no interaction with the cluster is possible. The workload running on the cluster is most likely not affected.'
    },
    ControlPlaneHealthy: {
      displayName: 'Control Plane',
      shortName: 'CP',
      description: 'Indicates whether all control plane components are up and running.',
      showAdminOnly: true
    },
    EveryNodeReady: {
      displayName: 'Nodes',
      shortName: 'N',
      description: 'Indicates whether all nodes registered to the cluster are healthy and up-to-date. If this is in error state there then there is probably an issue with the cluster nodes. In worst case there is currently not enough capacity to schedule all the workloads/pods running in the cluster and that might cause a service disruption of your applications.'
    },
    SystemComponentsHealthy: {
      displayName: 'System Components',
      shortName: 'SC',
      description: 'Indicates whether all system components in the kube-system namespace are up and running. Gardener manages these system components and should automatically take care that the components become healthy again.'
    }
  }
}
export default state
