import { useContext } from 'react'
import { WorkspaceContext } from './WorkspaceContext'
import type { WorkspaceContextValue } from './WorkspaceContext'

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext)
  if (value === null) {
    throw new Error('useWorkspace must be used inside WorkspaceProvider')
  }
  return value
}
