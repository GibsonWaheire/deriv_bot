import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'

const DEV_BYPASS = import.meta.env.DEV

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isLoggedIn } = useAuthStore()
  return (isLoggedIn || DEV_BYPASS) ? <>{children}</> : <Navigate to="/login" replace />
}
