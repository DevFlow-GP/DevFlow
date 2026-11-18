"""Manual check of JenkinsClient against a real Jenkins.

    python -m scripts.jenkins_smoke user-apps/python/py-test            # job's default repo
    python -m scripts.jenkins_smoke user-apps/python/py-test owner/repo [branch]
    python -m scripts.jenkins_smoke MY-APP --plain                      # job without parameters

Private repo: set GITHUB_LOGIN and GITHUB_TOKEN (a token that can read the repo,
e.g. a fine-grained PAT with Contents: read). The script stores them in Jenkins
as the credential "devflow-smoke-test" and passes its id, like DevFlow does:
    GITHUB_LOGIN=me GITHUB_TOKEN=github_pat_... python -m scripts.jenkins_smoke user-apps/python/py-test me/private-repo
"""

import asyncio
import os
import sys

from app.core.config import get_settings
from app.integrations.jenkins import JenkinsClient, JenkinsError

args = [a for a in sys.argv[1:] if a != "--plain"]
PLAIN = "--plain" in sys.argv
JOB = args[0] if args else "user-apps/python/py-test"
GITHUB_LOGIN = os.environ.get("GITHUB_LOGIN")
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN")
SMOKE_CREDENTIAL_ID = "devflow-smoke-test"

if PLAIN:
    PARAMS = None
else:
    # Same parameters PipelineService sends; empty means the job's defaults.
    PARAMS = {}
    if len(args) > 1:
        PARAMS["GIT_REPO_URL"] = f"https://github.com/{args[1]}.git"
    if len(args) > 2:
        PARAMS["GIT_BRANCH"] = args[2]


async def main() -> None:
    s = get_settings()
    client = JenkinsClient(url=s.jenkins_url, user=s.jenkins_user, token=s.jenkins_token)

    if GITHUB_TOKEN and PARAMS is not None:
        print(f"0) Storing GitHub token for {GITHUB_LOGIN} as credential {SMOKE_CREDENTIAL_ID} ...")
        await client.put_credentials(
            SMOKE_CREDENTIAL_ID,
            username=GITHUB_LOGIN or "x-access-token",
            password=GITHUB_TOKEN,
            description="DevFlow smoke test",
        )
        PARAMS["GIT_CREDENTIALS_ID"] = SMOKE_CREDENTIAL_ID

    # Print params without exposing anything secret (only the credential id is in there).
    print(f"1) Triggering {JOB} on {s.jenkins_url} with params {PARAMS} ...")
    queue_id = await client.trigger_build(JOB, PARAMS)
    if queue_id is None:
        sys.exit(f"Job '{JOB}' does not exist on Jenkins")
    print(f"   queued, queue id = {queue_id}")

    print("2) Waiting for an executor ...")
    number = None
    for _ in range(30):
        item = await client.get_queue_item(queue_id)
        print(f"   {item}")
        if item and item.build_number:
            number = item.build_number
            break
        await asyncio.sleep(2)
    if number is None:
        sys.exit("Build never started")

    print(f"3) Build #{number} started; polling until it finishes ...")
    while True:
        build = await client.get_build(JOB, number)
        print(f"   building={build.building} result={build.result}")
        if not build.building:
            break
        await asyncio.sleep(3)

    print("4) Recent builds:")
    for b in await client.list_builds(JOB, limit=5):
        print(f"   #{b.number} {b.result} {b.started_at:%Y-%m-%d %H:%M:%S} {b.duration_ms}ms")

    print("5) Console log:")
    print(await client.get_console_text(JOB, number))


try:
    asyncio.run(main())
except JenkinsError as exc:
    sys.exit(f"JenkinsError: {exc}")
