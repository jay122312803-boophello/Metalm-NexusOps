import { useAuth } from '../contexts/AuthContext.jsx'

export default function Can({ perm, children, fallback = null }) {
  const auth = useAuth()
  if (!auth) return fallback
  if (auth.hasPerm(perm)) return children
  return fallback
}

