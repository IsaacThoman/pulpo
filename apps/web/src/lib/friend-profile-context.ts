import { createContext } from 'react'
import type { FriendProfile } from '@pulpo/contracts'

export const FriendProfileContext = createContext<((profile: FriendProfile) => void) | undefined>(undefined)
