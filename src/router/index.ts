import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

export const PROJECT_VIEWS = ['analyzer', 'list', 'kanban', 'gantt', 'activity'] as const;
export type ProjectView = (typeof PROJECT_VIEWS)[number];

const VIEW_STORAGE_KEY = 'fb.view';

export function lastProjectView(): ProjectView {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored && (PROJECT_VIEWS as readonly string[]).includes(stored)) {
      return stored as ProjectView;
    }
  } catch {
    /* stockage indisponible */
  }
  return 'kanban';
}

function rememberView(view: string): void {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    /* stockage indisponible */
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { public: true } },
    { path: '/', name: 'projects', component: () => import('@/views/ProjectsView.vue') },
    {
      path: '/p/:projectId(\\d+)',
      component: () => import('@/views/project/ProjectLayout.vue'),
      children: [
        { path: '', name: 'project', redirect: (to) => ({ name: lastProjectView(), params: to.params, query: to.query }) },
        { path: 'analyzer', name: 'analyzer', component: () => import('@/views/project/AnalyzerView.vue'), meta: { view: 'analyzer' } },
        { path: 'list', name: 'list', component: () => import('@/views/project/ListView.vue'), meta: { view: 'list' } },
        { path: 'kanban', name: 'kanban', component: () => import('@/views/project/KanbanView.vue'), meta: { view: 'kanban' } },
        { path: 'gantt', name: 'gantt', component: () => import('@/views/project/GanttView.vue'), meta: { view: 'gantt' } },
        { path: 'activity', name: 'activity', component: () => import('@/views/project/ActivityView.vue'), meta: { view: 'activity' } },
        { path: 'settings', name: 'settings', component: () => import('@/views/project/SettingsView.vue'), meta: { view: 'settings' } },
      ],
    },
    {
      path: '/admin',
      component: () => import('@/views/admin/AdminLayout.vue'),
      meta: { admin: true },
      children: [
        {
          path: '',
          name: 'admin',
          // Première page d'administration autorisée pour l'utilisateur.
          redirect: () => {
            const auth = useAuthStore();
            if (auth.can('users.view')) return { name: 'admin-users' };
            if (auth.can('roles.manage')) return { name: 'admin-roles' };
            if (auth.can('tokens.manage')) return { name: 'admin-tokens' };
            if (auth.can('monitoring.view')) return { name: 'admin-performance' };
            return { name: 'admin-logs' };
          },
        },
        { path: 'users', name: 'admin-users', component: () => import('@/views/admin/UsersView.vue'), meta: { permission: 'users.view' } },
        { path: 'roles', name: 'admin-roles', component: () => import('@/views/admin/RolesView.vue'), meta: { permission: 'roles.manage' } },
        { path: 'tokens', name: 'admin-tokens', component: () => import('@/views/admin/TokensView.vue'), meta: { permission: 'tokens.manage' } },
        { path: 'performance', name: 'admin-performance', component: () => import('@/views/admin/PerformanceView.vue'), meta: { permission: 'monitoring.view' } },
        { path: 'logs', name: 'admin-logs', component: () => import('@/views/admin/LogsView.vue'), meta: { permission: 'logs.view' } },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.public) {
    return auth.isAuthenticated && to.name === 'login' ? { path: '/' } : true;
  }
  if (!auth.isAuthenticated) {
    return { name: 'login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} };
  }
  if (to.meta.admin && !auth.canAdmin) {
    return { path: '/' };
  }
  if (typeof to.meta.permission === 'string' && !auth.can(to.meta.permission)) {
    return { name: 'projects' };
  }
  return true;
});

router.afterEach((to) => {
  if (typeof to.meta.view === 'string' && to.meta.view !== 'settings') {
    rememberView(to.meta.view);
  }
});

export default router;
