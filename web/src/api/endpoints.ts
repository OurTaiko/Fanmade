import { chartPath, endpoints as shared } from '@sitekit/api/endpoints'

export const endpoints = {
  ...shared,
  resources: (id: string) => `${chartPath(id)}/resources`,
} as const
