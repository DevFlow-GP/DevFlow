# DevFlow

DevSecOps platform for connecting GitHub repositories, selecting deployment templates, and deploying Dockerized apps through Jenkins pipelines with built-in security scanning.

This is the backend: a FastAPI service backed by PostgreSQL. It talks to GitHub (OAuth, repos,
branches) and to Jenkins, where the pipelines defined in the
[JTE repository](https://github.com/ucouldcallmeEL/JTE) run the builds.

- [How it fits together](#how-it-fits-together)
- [Code layout](#code-layout)
- [Local setup](#local-setup)
- [Configuration](#configuration)
- [End-to-end workflow](#end-to-end-workflow)
- [API reference](#api-reference)
- [Errors](#errors)
- [Jenkins integration](#jenkins-integration)
- [Rate limits](#rate-limits)
- [Testing](#testing)
- [Not implemented yet](#not-implemented-yet)

## How it fits together

```
 Frontend (React, :5173) ──HTTP + Bearer token──► DevFlow API (FastAPI, :8000) ──► PostgreSQL
                                                     │            │
                                          OAuth, repos, branches  │  trigger builds, poll status, read logs
                                                     ▼            ▼
                                                  GitHub      Jenkins (:8080) running JTE templates
                                                                  │
                                                                  └─ clones the project's repo and runs the pipeline
```

1. A user signs up and links GitHub.
2. They create a **project** from one of their repositories and pick a branch. DevFlow picks the
   project's **pipeline** (JTE template) from the repo's language, or they choose one.
3. The first build creates the project's own **Jenkins job** in that template's folder
   (`user-apps/<pipeline>/<project id>`). Every build runs it **with the project's repo and
   branch as parameters**. The JTE pipeline then checks out that repo and builds it.
4. DevFlow doesn't store build state. Every build read goes to Jenkins, which is the source of truth.

## Code layout

```
app/
  main.py          App factory: routers, CORS, error handler
  api/             HTTP layer: routes, request validation, response shaping
    dependencies.py  Shared dependencies: DB session, current user, role checks, service factories
  services/        Business rules: permissions, which job, which repo, error mapping
  integrations/    Clients for outside systems (GitHub, Jenkins, email). No business rules.
  repositories/    Database queries
  models/          SQLAlchemy tables
  schemas/         Pydantic request/response models
  core/            Config, database, security (JWT, hashing), exceptions, rate limits
alembic/           Database migrations
scripts/           create_admin.py, jenkins_smoke.py
tests/             pytest suite; fakes.py has in-memory GitHub, Jenkins and email
```

A request goes `api/` → `services/` → `integrations/` and `repositories/`. Integrations raise
their own errors (`JenkinsError`, ...). Services turn them into `AppError` subclasses, and
`main.py` turns those into JSON responses.

## Local setup

Requires Python 3.12 and Docker.

    cp .env.example .env             # then fill in JWT_SECRET (and GitHub / Jenkins, below)
    docker compose up -d postgres    # PostgreSQL 16; also creates devflow_test for pytest
    python3 -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    alembic upgrade head             # create / update the schema
    uvicorn app.main:app --reload    # http://localhost:8000, interactive docs at /docs
    pytest

After changing a model in `app/models/`, run
`alembic revision --autogenerate -m "describe change"` and review the generated file.

Create the first platform admin (public registration can't):

    python -m scripts.create_admin --email admin@example.com --name "Admin"

### GitHub

Projects are created from GitHub repositories, so GitHub is needed for anything beyond auth.

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.
2. Set the callback URL to `http://localhost:8000/github/callback` (must equal `GITHUB_REDIRECT_URI`).
3. Put the client id and secret in `.env`, and generate `GITHUB_TOKEN_ENCRYPTION_KEY`:
   `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`

### Jenkins

Jenkins comes from the JTE repository's Docker Compose file, which builds a Jenkins LTS image with
Python and Docker installed:

    cd ../../JTE
    docker compose up -d --build     # http://localhost:8080, data in the jte_jenkins_home volume

Then:

1. Log in. On a fresh volume, the first password is printed by
   `docker compose exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword`.
2. Create an API token: your user → Security → API Token → Add new Token. To build private
   repos, this user also needs the Credentials Create and Update permissions (an admin has them).
3. Set `JENKINS_URL=http://localhost:8080`, `JENKINS_USER` and `JENKINS_TOKEN` in `.env`.
4. Check the connection with the [smoke test](#manual-check-against-a-real-jenkins).

> `docker-compose.yml` here doesn't pass the `GITHUB_*` or `JENKINS_*` variables to the `api`
> container yet. Run the API with `uvicorn` to use GitHub and builds. Inside that container,
> Jenkins would be at `http://host.docker.internal:8080`, not `localhost`.

## Configuration

All settings come from environment variables or `.env` (see `app/core/config.py`).

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | (required) | `postgresql+asyncpg://...` |
| `JWT_SECRET` | (required) | At least 32 characters. `python -c "import secrets; print(secrets.token_hex(32))"` |
| `JWT_ALGORITHM` | `HS256` | |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `30` | |
| `FRONTEND_URL` | `http://localhost:5173` | Where emailed links and the GitHub redirect send the browser |
| `CORS_ALLOWED_ORIGINS` | Vite dev server | JSON list of browser origins allowed to call the API |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | unset | GitHub OAuth App. Without them `/github` returns `503` |
| `GITHUB_REDIRECT_URI` | `http://localhost:8000/github/callback` | Must match the OAuth App |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | unset | Fernet key that encrypts stored GitHub tokens |
| `JENKINS_URL`, `JENKINS_USER`, `JENKINS_TOKEN` | unset | Jenkins API token (not the password). Without them the build endpoints return `503` |
| `EMAIL_BACKEND` | `console` | `console` prints emails to the API log; `smtp` sends them |
| `EMAIL_FROM`, `SMTP_*` | | SMTP server for `EMAIL_BACKEND=smtp` |
| `EMAIL_VERIFICATION_EXPIRE_HOURS` | `24` | |
| `PASSWORD_RESET_EXPIRE_MINUTES` | `30` | |
| `RATE_LIMIT_ENABLED` | `true` | Turn off only for load tests |

## End-to-end workflow

The full path from a new account to a finished build. Every call after login sends
`Authorization: Bearer <access_token>`. The same steps work from Swagger at `/docs`.

```bash
API=http://localhost:8000

# 1. Register (or log in) and keep the token
TOKEN=$(curl -s -X POST $API/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"dev@example.com","password":"S3cure-pass!","full_name":"Dev"}' | jq -r .access_token)
AUTH="Authorization: Bearer $TOKEN"

# 2. Link GitHub: open the returned URL in a browser and approve
curl -s "$API/github/connect?access=public" -H "$AUTH"      # → {"authorization_url": "..."}
curl -s $API/github/connection -H "$AUTH"                   # → {"connected": true, ...}

# 3. Create a project from a repository (pipeline is picked from the repo's language)
PROJECT=$(curl -s -X POST $API/projects -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"repo_full_name":"ucouldcallmeEL/py-simple","branch":"main"}' | jq -r .id)

# 4. Trigger a build → {"queue_id": 42}. The first one creates the project's Jenkins job.
curl -s -X POST $API/projects/$PROJECT/builds -H "$AUTH"

# 5. Poll the queue item until state is "started" and build_number is set
curl -s $API/projects/$PROJECT/builds/queue/42 -H "$AUTH"

# 6. Poll the build until status is no longer "running", then read the log
curl -s $API/projects/$PROJECT/builds/7 -H "$AUTH"
curl -s $API/projects/$PROJECT/builds/7/log -H "$AUTH"
```

## API reference

Request bodies are JSON. Optional fields are marked. The interactive docs at `/docs` show the
exact schemas.

### Health (no auth)

- `GET /health`: liveness, `200` while the process is running. Doesn't touch the database.
- `GET /health/ready`: readiness, `200` if PostgreSQL answers within 2 s, otherwise `503`.

### Auth

- `POST /auth/register`: `email`, `password`, `full_name`, optional `role` (default
  `application_developer`), optional `company_name`
  (creates the company with you as `owner` plus one `Default` team). Returns a token.
- `POST /auth/login`: `email`, `password`. Returns a token.
- `POST /auth/verify-email`: `token` from the emailed link (sent on register). No login needed.
- `POST /auth/resend-verification`: needs a token; emails a new verification link.
- `POST /auth/forgot-password`: `email`. Always `202`, whether or not the account exists.
- `POST /auth/reset-password`: `token` from the emailed link, `new_password`. The link works once.
- `GET /auth/me`: needs `Authorization: Bearer <access_token>`.
- `GET /session`: same auth. Returns what the app shell shows: `user` (`name`, `initials`, `email`)
  and `workspace` (`slug`, `name`, `initials`, `cluster`), or `workspace: null` without a company.
  `slug` is generated from the company name; `cluster` is always `null` until deployments exist.

Emailed links open the frontend at `/verify-email?token=...` and `/reset-password?token=...`;
those pages POST the token to the endpoints above. With `EMAIL_BACKEND=console` (the default)
emails are printed to the API log instead of being sent.

### Account settings (needs a token)

- `PATCH /users/me`: `full_name` and/or `email`. A new email needs `current_password`, becomes
  unverified and gets a verification link; the old address is notified.
- `POST /users/me/password`: `current_password`, `new_password`. Signs out every session and
  returns a fresh token.
- `DELETE /users/me`: body `{"password": ...}`. Deletes the account and its projects, revokes
  GitHub access, and deletes the company if you're its only member.

Changing or resetting the password invalidates every access token issued before it.

### GitHub (needs a token)

| Endpoint | Parameters | Returns |
|---|---|---|
| `GET /github/connect` | query `access`: `public` (public repos only) or `private` (public and private) | `{authorization_url}`. The frontend sends the browser there. |
| `GET /github/callback` | `code`, `state` (sent by GitHub) | Redirects the browser back to the frontend. Not called directly. |
| `GET /github/connection` | | `{connected, username, access, connected_at}` |
| `DELETE /github/connection` | | `204`. Revokes DevFlow's access on GitHub and deletes the stored token. |
| `GET /github/repos` | query `page` (≥1, default 1), `per_page` (1–100, default 30) | `{repositories: [{id, name, full_name, private, html_url, default_branch, description, language, updated_at}], page, per_page, has_next}`, most recently updated first |
| `GET /github/repos/{owner}/{repo}/branches` | path `owner`, `repo`; query `page`, `per_page` | `{default_branch, branches: [{name, protected}], page, per_page, has_next}` |

`/github/connect` returns JSON rather than redirecting because a browser navigation can't carry
the `Authorization` header. GitHub tokens are stored encrypted.

### Projects (needs a token)

A project is a GitHub repository registered on DevFlow. You see projects you own plus your
team's. Only the owner can change, delete or build one.

| Endpoint | Parameters | Returns |
|---|---|---|
| `POST /projects` | `repo_full_name` (`owner/repo`); optional `name` and `description` (default to GitHub's), optional `branch` (defaults to the repo's default branch), optional `pipeline` (defaults from the repo's language) | `201` + project. Checks on GitHub that the repo and branch exist and you can access them. Doesn't touch Jenkins. |
| `GET /projects` | | List of projects |
| `GET /projects/{id}` | | Project |
| `PATCH /projects/{id}` | any of `name`, `description` (`null` clears it), `branch` (checked on GitHub), `pipeline` | Updated project. A new `pipeline` deletes the old Jenkins job; the next build creates the new one. |
| `DELETE /projects/{id}` | | `204`. Also deletes the project's Jenkins job, if DevFlow created it. |

A project looks like:

```json
{
  "id": "…uuid…", "name": "py-simple", "description": null,
  "repo_url": "https://github.com/ucouldcallmeEL/py-simple", "repo_full_name": "ucouldcallmeEL/py-simple",
  "default_branch": "main", "branch": "main", "is_private": false,
  "pipeline": "python", "jenkins_job": "user-apps/python/…project uuid…",
  "owner_id": "…uuid…", "team_id": "…uuid…", "created_at": "2026-11-18T10:00:00Z"
}
```

`pipeline` is the JTE template that builds the project: `python`, `node`, `go` or `dockerfile`.
Without one, it's picked from GitHub's `language` for the repo: Python → `python`, JavaScript and
TypeScript → `node`, Go → `go`, anything else (or none) → `dockerfile`. It can't be set to `null`.

`jenkins_job` is read-only: the full name of the job DevFlow created for the project
(`user-apps/<pipeline>/<project id>`), or `null` until the first build.

### Builds (needs a token)

All under `/projects/{project_id}/builds`. Before the first build, the list is empty and the
other read endpoints return `404`.

| Endpoint | Parameters | Returns |
|---|---|---|
| `POST /projects/{id}/builds` | | `202 {queue_id}`. Owner only. Queues a build of the project's job with its repo and branch. For a private repo, it first stores the owner's GitHub token in Jenkins ([details](#private-repositories)). |
| `GET /projects/{id}/builds/queue/{queue_id}` | path `queue_id` (≥1) | `{queue_id, state, build_number, reason}` |
| `GET /projects/{id}/builds` | query `limit` (1–100, default 20) | List of builds, newest first |
| `GET /projects/{id}/builds/{number}` | path `number` (≥1) | Build |
| `GET /projects/{id}/builds/{number}/log` | path `number` | Console output so far, as `text/plain` |

**Queue item** `state`:
- `queued`: waiting for an executor; `reason` says why, e.g. "Waiting for next available executor".
- `started`: `build_number` is set. Switch to polling the build.
- `cancelled`: someone cancelled it on Jenkins.

Jenkins forgets queue items a few minutes after they start. After that the queue endpoint returns `404`.

**Build**:

```json
{ "number": 7, "status": "running", "started_at": "2026-11-18T10:00:00Z", "duration_ms": 0,
  "url": "http://localhost:8080/job/user-apps/job/python/job/<project id>/7/" }
```

`status` is `running`, `success`, `failure`, `unstable`, `aborted` or `not_built`. `duration_ms` is
`0` while it's running.

## Errors

Errors are JSON: `{"detail": "..."}`. A `401` also carries `WWW-Authenticate: Bearer`, and a `429`
carries `Retry-After` (seconds). Request validation errors are FastAPI's standard `422` format.

| Status | Meaning (examples) |
|---|---|
| `400` | Invalid or expired verification / password reset link |
| `401` | Missing, invalid or expired token; wrong email or password |
| `403` | Not allowed: not the project owner, wrong role, wrong current password, inactive account |
| `404` | Project or build not found (also returned for projects you can't see) |
| `409` | Conflict: email taken, GitHub not connected or needs reconnecting (also when building a private repo with a revoked token), project already exists for this repo |
| `422` | Repo or branch not found / not accessible |
| `429` | Too many attempts, see [rate limits](#rate-limits) |
| `502` | GitHub or Jenkins couldn't be reached, or Jenkins rejected DevFlow's credentials |
| `503` | GitHub or Jenkins isn't configured on this server; Jenkins has no folder for the project's pipeline (`user-apps/<pipeline>`) |

## Jenkins integration

### Job lifecycle

DevFlow creates and owns one job per project, named `user-apps/<pipeline>/<project id>`
(`app/services/jenkins_jobs.py`). The UUID keeps the name unique, stable across renames, and
safe in URLs.

- **Created** on the project's first build, from `JOB_CONFIG_XML`: a JTE ad-hoc pipeline with the
  three parameters below, keeping the last 50 builds and running one build at a time. Creating a
  project never touches Jenkins, so it works while Jenkins is down. A job deleted by hand on
  Jenkins is recreated by the next build.
- **Replaced** when the project's `pipeline` changes: the old job is deleted and `jenkins_job`
  is cleared; the next build creates the job in the new folder.
- **Deleted** with the project.

Deleting is best effort: a Jenkins outage is logged and doesn't block changing or deleting the
project. DevFlow only ever deletes a job whose name is the one it would create for that project,
never a job made by hand. Migration 0006 cleared every `jenkins_job` linked before, since those
jobs were hand-made.

**Prerequisite:** the folders `user-apps/python`, `user-apps/node`, `user-apps/go` and
`user-apps/dockerfile` must exist on Jenkins, each loading its JTE template. DevFlow doesn't create
folders. Building a project whose folder is missing returns `503` ("Jenkins isn't set up for go
projects yet") and creates nothing.

### Contract with the JTE jobs

Every DevFlow job is a **parameterized** pipeline that accepts:

| Parameter | Sent by DevFlow | Used by |
|---|---|---|
| `GIT_REPO_URL` | `https://github.com/<repo_full_name>.git` | JTE `git_checkout` step |
| `GIT_BRANCH` | the project's `branch` | JTE `git_checkout` step |
| `GIT_CREDENTIALS_ID` | private repos only: `devflow-github-<owner user id>` | JTE `git_checkout` step, to authenticate the clone |

The jobs live under the `user-apps` folder in Jenkins. That folder (and its `python`, `node`,
`go`, ... subfolders) loads pipeline configuration from `pipeline_templates/user_apps` in the JTE
repository. The template's stages decide what a build does: checkout, install dependencies,
test, scan, package, deploy.

### What happens on `POST /projects/{id}/builds`

```
api/pipelines.py           trigger_build
  └─ PipelineService.trigger_build(user, project_id)
       ├─ loads the project; 404 if you can't see it, 403 if you don't own it
       ├─ _ensure_job(project) → "user-apps/python/<project id>"
       │    ├─ JenkinsClient.job_exists(job); if not, create_job(job, JOB_CONFIG_XML)
       │    │    (503 if the user-apps/python folder is missing)
       │    └─ saves project.jenkins_job (kept even if the trigger below fails)
       ├─ _build_params(project) → {"GIT_REPO_URL": ..., "GIT_BRANCH": ...}
       ├─ private repo only:
       │    ├─ GitHubService.get_clone_credentials → checks the token on GitHub, returns (login, token)
       │    ├─ JenkinsClient.put_credentials("devflow-github-<owner id>", login, token)
       │    └─ params["GIT_CREDENTIALS_ID"] = "devflow-github-<owner id>"
       └─ JenkinsClient.trigger_build(job, params)
            POST /job/user-apps/job/python/job/<project id>/buildWithParameters
            ← 201, Location: /queue/item/42/        → returns 42
```

Jenkins assigns the build number only once an executor picks the item up. That's why the API
returns a `queue_id` first, and the client polls the queue item and then the build.

### Private repositories

Jenkins needs a credential to clone a private repo. DevFlow uses the project owner's GitHub
OAuth token, which already has the `repo` scope, because the owner connected GitHub with
`access=private` to create the project.

- **Where the token goes:** a username/password credential in Jenkins' global store, with id
  `devflow-github-<owner user id>`. Username is the GitHub login, password is the token. The build
  gets only the id in `GIT_CREDENTIALS_ID`. Build parameters are visible to anyone who can see the
  job, so the token is never put in them. Jenkins stores the credential encrypted and masks it in
  logs.
- **When:** before every build of a private project. This picks up a new token after the owner
  reconnects GitHub. There's one credential per user, shared by all their projects.
- **Checks first:** the token is checked against GitHub before anything is sent to Jenkins. A
  revoked token gives `409` ("reconnect your GitHub account") and nothing is queued.
- **Who it acts as:** builds always use the **owner's** access, since only the owner can trigger them.

Public projects send no credential.

### `JenkinsClient` (`app/integrations/jenkins.py`)

A thin async client for the Jenkins REST API. It knows nothing about projects or users. Every
method returns `None` when Jenkins answers `404`, and raises `JenkinsError` when Jenkins is
unreachable, rejects the credentials (`401`/`403`), or answers unexpectedly. The token is never logged.

| Method | Parameters | Returns | Jenkins call |
|---|---|---|---|
| `trigger_build(job, params=None)` | `job`: full job name; `params`: dict of build parameters. `None` for a job without parameters, `{}` for the job's defaults | queue item id, or `None` if the job doesn't exist | `POST {job}/build`, or `{job}/buildWithParameters` when `params` is given |
| `get_queue_item(queue_id)` | `queue_id` | `JenkinsQueueItem(id, job_path, cancelled, build_number, why)`, or `None` once Jenkins forgets it | `GET /queue/item/{id}/api/json` |
| `list_builds(job, *, limit)` | `job`, `limit` | list of `JenkinsBuild`, newest first | `GET {job}/api/json?tree=builds[...]{0,limit}` |
| `get_build(job, number)` | `job`, `number` | `JenkinsBuild(number, result, building, started_at, duration_ms, url)` | `GET {job}/{number}/api/json` |
| `get_console_text(job, number)` | `job`, `number` | console output as a string | `GET {job}/{number}/consoleText` |
| `put_credentials(credential_id, *, username, password, description)` | credential id and its username/password | nothing; creates the credential or replaces it | `POST /credentials/store/system/domain/_/credential/{id}/config.xml`, falling back to `.../createCredentials` if it doesn't exist |
| `job_exists(job)` | `job` | `True`, or `False` on `404` | `GET {job}/api/json?tree=name` |
| `create_job(job, config_xml)` | `job`: full name; `config_xml`: the job's `config.xml` | `True` (also when the job already exists, so racing first builds both succeed); `False` if the parent folder is missing | `POST {parent}/createItem?name=<last segment>` (`application/xml`) |
| `delete_job(job)` | `job` | nothing; a job that's already gone counts as deleted | `POST {job}/doDelete` (`200` or a redirect) |
| `job_path(job)` (function) | `job` | URL path; `"team/my app"` → `/job/team/job/my%20app/` | |

A plain `/build` on a parameterized job gets `400` from Jenkins, and parameters sent to a job
without any are rejected too, so `params` must match the job.

### `PipelineService` (`app/services/pipeline_service.py`)

The business rules around builds. Methods take the current `User` and a `project_id`.

| Method | Rules |
|---|---|
| `trigger_build(user, project_id)` | Owner only. Creates the project's job if needed (`_ensure_job`), then sends the project's repo and branch as parameters, plus the owner's clone credential for a private repo. Returns the queue id. |
| `get_queued_build(user, project_id, queue_id)` | Visible to teammates. Queue ids are global on Jenkins, so it returns `404` for an item that belongs to another job. |
| `list_builds(user, project_id, *, limit)` | Visible to teammates. `[]` before the first build or when the job was deleted on Jenkins. |
| `get_build(user, project_id, number)` | Visible to teammates. |
| `get_build_log(user, project_id, number)` | Visible to teammates. |

`JenkinsError` becomes `502`, a missing pipeline folder `503`, and a missing build or queue item
(or any read before the first build) `404`. The read methods use the saved `jenkins_job` and make
no Jenkins call while it's `null`.
`PipelineService` gets `GitHubService` only for private repos. Without GitHub configured, building
one returns `503`.

`GitHubService.get_clone_credentials(user, full_name)` returns `(github_login, token)` after
checking on GitHub that the token still reaches the repo.

## Rate limits

Repeated attempts get `429` with a `Retry-After` header (seconds). Limits live in
`app/core/rate_limit.py`: login 20 per 5 min per IP, and 5 wrong passwords per 15 min per email
(the account is then locked for that window, even with the right password; a password reset
lifts it); register 10 per hour per IP; forgot-password 5 per 15 min per IP and 3 per hour per
email; resend-verification 3 per hour; 5 wrong current passwords per 15 min on settings.
Counters are in memory per process, so they reset on restart and each worker counts separately.

To protect an endpoint, add a `CurrentUserDep` parameter, or `Depends(require_roles(...))`,
both from `app/api/dependencies.py`.

## Testing

    docker compose up -d postgres    # tests use the devflow_test database
    pytest                           # whole suite
    pytest tests/test_pipelines.py -v

The suite never calls GitHub, Jenkins or an SMTP server. `tests/fakes.py` has in-memory versions
(`FakeGitHubClient`, `FakeJenkinsClient`, `FakeEmailSender`) that `tests/conftest.py` swaps in
through FastAPI dependency overrides. `FakeJenkinsClient` keeps triggered builds in a queue until
a test calls `start()`, like a build waiting for an executor. It also records the parameters each
build was triggered with in `params`, the jobs it created (`created_configs`, `create_calls`) and
deleted (`deleted_jobs`). Jobs can only be created in its `folders`; remove one to simulate a
missing template folder. `tests/test_jenkins_client.py` runs the real `JenkinsClient` against a
mock HTTP transport to check URLs and status handling.

### Manual check against a real Jenkins

`scripts/jenkins_smoke.py` runs the real `JenkinsClient` against the Jenkins in `.env`. It needs
no database, login or GitHub. It triggers a build, waits for it to start, polls until it
finishes, then prints recent builds and the console log. Run it from this folder:

    python -m scripts.jenkins_smoke user-apps/python/py-test                    # job's default repo
    python -m scripts.jenkins_smoke user-apps/python/py-test owner/repo [branch] # another repo/branch
    python -m scripts.jenkins_smoke MY-APP --plain                              # job without parameters

For a private repo, set `GITHUB_LOGIN` and `GITHUB_TOKEN` (a token that can read the repo, e.g. a
fine-grained PAT with *Contents: read*). The script stores them as the Jenkins credential
`devflow-smoke-test` and passes its id, the same way DevFlow does:

    GITHUB_LOGIN=me GITHUB_TOKEN=github_pat_... python -m scripts.jenkins_smoke user-apps/python/py-test me/private-repo

| Output | Cause |
|---|---|
| `Could not reach Jenkins` | Jenkins isn't running, or `JENKINS_URL` is wrong |
| `rejected DevFlow's credentials (HTTP 401)` | Wrong `JENKINS_USER`, or the password was used instead of an API token |
| `Job '...' does not exist` | Job name is wrong. Names are case-sensitive. |
| `Triggering a build returned HTTP 400` | Parameters don't match the job: `--plain` on a parameterized job, or the reverse |
| `Saving credentials returned HTTP ...` | The Jenkins user lacks Credentials permissions, or the Credentials plugin is missing |
| Build fails at Checkout with `Authentication failed` / `repository not found` | The token can't read that repo |
| `ModuleNotFoundError: app` | Not run from `backend/` with `python -m` |

## Not implemented yet

- **Repo visibility changes:** `is_private` is recorded when the project is created. If a public
  repo is made private later, its builds won't send a credential and the clone fails.
- **Cleaning up credentials:** disconnecting GitHub or deleting the account doesn't delete the
  user's `devflow-github-*` credential from Jenkins. The token in it is revoked on GitHub, so it no
  longer works.
- **Build history in DevFlow:** builds aren't stored; everything is read live from Jenkins.
  (`models/pipeline_run.py` exists for this.)
- **Deployments, scans, templates, monitoring, webhooks:** `api/`, `services/` and
  `integrations/` have empty placeholder modules for these. They aren't routed yet.
- **Frontend:** it uses the auth, session, GitHub and project endpoints, but not the build
  endpoints. The dashboard and job details pages still show mock data.
- **Docker Compose:** the `api` service doesn't get the `GITHUB_*` or `JENKINS_*` variables.
