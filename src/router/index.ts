import { createRouter, createWebHistory } from '@ionic/vue-router'
import { authConfigured, isNativeApp } from '@/services/auth'
import { useAuthStore } from '@/stores/auth'

const routes = [
  {
    path: '/',
    component: () => import('@/views/LandingView.vue'),
  },
  {
    path: '/auth',
    component: () => import('@/views/AuthView.vue'),
  },
  {
    path: '/verify-email',
    component: () => import('@/views/VerifyEmailView.vue'),
  },
  {
    path: '/admin',
    component: () => import('@/views/AdminView.vue'),
    meta: { requiresAuth: true, adminOnly: true },
  },
  {
    path: '/tabs',
    component: () => import('@/layouts/TabsLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        redirect: '/tabs/home',
      },
      {
        path: 'home',
        component: () => import('@/views/HomeView.vue'),
      },
      {
        path: 'map',
        component: () => import('@/views/MapView.vue'),
      },
      {
        path: 'groups',
        component: () => import('@/views/GroupsView.vue'),
      },
      {
        path: 'messages',
        component: () => import('@/views/MessagesView.vue'),
      },
      {
        path: 'profile',
        component: () => import('@/views/ProfileView.vue'),
      },
    ],
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

router.beforeEach(async (to) => {
  if (isNativeApp && to.path === '/auth' && to.query.mode === 'register') {
    return {
      path: '/auth',
      query: { ...to.query, mode: 'login' },
    }
  }

  if (!to.meta.requiresAuth) return true

  const auth = useAuthStore()
  try {
    await auth.initialize()
  } catch {
    return {
      path: '/auth',
      query: { mode: 'login', redirect: to.fullPath, reason: 'session' },
    }
  }

  if (!authConfigured || !auth.user) {
    return { path: '/auth', query: { mode: 'login', redirect: to.fullPath } }
  }

  if (!auth.user.emailVerified) {
    auth.setPendingVerificationEmail(auth.user.email)
    return { path: '/verify-email', query: { redirect: to.fullPath } }
  }

  if (to.meta.adminOnly && !auth.isAdmin) {
    return { path: '/', query: { notice: 'admin-only' } }
  }

  return true
})

export default router
