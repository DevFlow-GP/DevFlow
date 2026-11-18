# DevFlow Frontend

React + Vite implementation of the DevFlow prototype.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

## Routes

| Path                                   | Page                                                      | Login |
| -------------------------------------- | --------------------------------------------------------- | ----- |
| `/`                                    | Landing page                                              |       |
| `/auth`                                | Create account (`?mode=signin` for sign in)               |       |
| `/forgot-password`                     | Request a password reset email                            |       |
| `/reset-password?token=…`              | Choose a new password (link from the email)               |       |
| `/verify-email?token=…`                | Confirm the email address (link from the email)           |       |
| `/projects`                            | Projects list; a row opens the project                    | yes   |
| `/projects/new`                        | New project form; creates the project and starts a build  | yes   |
| `/projects/:projectId`                 | Project: Run build, build history, settings               | yes   |
| `/projects/:projectId/builds/:number`  | One build: stages and live console log                    | yes   |
| `/integrations/github`                 | Connect GitHub                                            | yes   |
| `/settings`                            | Account: profile, email verification, password, delete    | yes   |

`/dashboard` and `/job` (the old mock screens) redirect to `/projects`.

Builds are polled while they run (`hooks/usePolling.js`): the project page every 3 s,
the build page every 2.5 s. Stages are read from Jenkins' `[Pipeline]` markers in the
log (`utils/jenkinsLog.js`) until the backend exposes them.

## Structure

```
public/api/            Static copy for the landing page, auth page and New Project options
src/
  services/api.js      All data fetching (swap VITE_API_BASE_URL for a real API)
  hooks/useApi.js      { data, loading, error, reload } for any fetcher
  context/             ThemeContext (light/dark), SessionContext (user + workspace)
  config/navigation.js Routes and navigation menus
  utils/               classNames, status mapping, notifications, inline-code formatter
  styles/global.css    Design tokens, light/dark themes and every component style
  components/
    ui/                Reusable primitives (Button, Card, DataTable, Modal, …)
    layout/            Navbar, mobile nav, side nav, page shells
    landing/ projects/ project/ new-project/ job/ auth/   Feature components
    dashboard/         Deployment widgets, unused until deployments exist
  pages/               One file per screen
```

## Theming

Colors are CSS custom properties defined on `:root` / `[data-theme='dark']` and
`[data-theme='light']` in `src/styles/global.css`. The navbar toggle switches
themes and remembers the choice in `localStorage` (default: dark).
