//
// SPDX-FileCopyrightText: 2021 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

'use strict'

const { basename } = require('path')
const { helm } = fixtures

const renderTemplates = helm.renderTemplatesFn(basename(__dirname), 'charts/application')

describe('gardener-dashboard', function () {
  describe('clusterrole', function () {
    let templates

    beforeEach(() => {
      templates = [
        'clusterrole'
      ]
    })

    it('should render the template with default values', async function () {
      const values = {}
      const documents = await renderTemplates(templates, values)
      expect(documents).toHaveLength(1)
      const [clusterRole] = documents
      expect(clusterRole).toMatchSnapshot()
    })
  })
})
