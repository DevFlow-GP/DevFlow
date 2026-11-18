export const ROUTES = {
  landing: '/',
  projects: '/projects',
  newProject: '/projects/new',
  signUp: '/auth',
  signIn: '/auth?mode=signin',
  forgotPassword: '/forgot-password',
  // The backend emails links to these two, with ?token=...
  verifyEmail: '/verify-email',
  resetPassword: '/reset-password',
  settings: '/settings',
  // Also where the backend sends the browser back to after GitHub.
  githubIntegration: '/integrations/github',
};

/** A project's page: details, Run build and build history. */
export const projectRoute = (projectId) => `/projects/${projectId}`;

/** One build of a project: stages and console output. */
export const buildRoute = (projectId, number) => `/projects/${projectId}/builds/${number}`;

/** Query param on the auth page holding the path to return to after signing in. */
export const REDIRECT_PARAM = 'next';

/** Sign-in URL that returns the user to `path` once authenticated. */
export function signInRedirect(path) {
  return `${ROUTES.signIn}&${REDIRECT_PARAM}=${encodeURIComponent(path)}`;
}

/** Only follow same-app paths ("/projects"), never absolute or protocol-relative URLs. */
export function safeRedirectPath(path) {
  return path && path.startsWith('/') && !path.startsWith('//') ? path : null;
}

/** Landing page sections reachable from the top navigation bar. */
export const LANDING_SECTIONS = [
  { id: 'how-it-works', label: 'How it works' },
  { id: 'capabilities', label: 'Capabilities' },
  { id: 'comparison', label: 'Teams' },
  { id: 'faq', label: 'Docs & FAQ' },
];

export const MOBILE_NAV_ITEMS = [
  { label: 'Home', icon: 'home', to: ROUTES.landing },
  { label: 'Projects', icon: 'dns', to: ROUTES.projects },
  { label: 'New Project', icon: 'add_circle', to: ROUTES.newProject },
  { label: 'Sign in', icon: 'group_add', to: ROUTES.signUp, guestOnly: true },
];

/**
 * Side navigation on workspace screens (projects list, integrations, settings).
 * Items with `soon` are planned screens, shown disabled. The item whose `to`
 * matches the current page is highlighted.
 */
export const WORKSPACE_NAV = {
  main: [
    { label: 'Projects', icon: 'conversion_path', to: ROUTES.projects },
    { label: 'Deployments', icon: 'rocket_launch', soon: true },
    { label: 'Infrastructure', icon: 'dns', soon: true },
    { label: 'Observability', icon: 'monitoring', soon: true },
    { label: 'GitHub', icon: 'link', to: ROUTES.githubIntegration },
    { label: 'Settings', icon: 'settings', to: ROUTES.settings },
  ],
  footer: [{ label: 'Documentation', icon: 'menu_book', soon: true }],
};

/** Side navigation on a project's pages; `section` marks the current one. */
export function projectNav(projectId, section) {
  return [
    { label: 'Overview', icon: 'dashboard', to: projectRoute(projectId), active: section === 'overview' },
    { label: 'Builds & Logs', icon: 'terminal', to: `${projectRoute(projectId)}#builds`, active: section === 'build' },
    { label: 'Metrics & Trace', icon: 'monitoring', soon: true },
    { label: 'Settings', icon: 'tune', to: `${projectRoute(projectId)}#settings` },
    { label: 'All Projects', icon: 'dns', to: ROUTES.projects },
  ];
}
