"""The Jenkins jobs DevFlow creates and owns: one per project.

Each job lives in the folder of its JTE template, user-apps/<pipeline>, which
supplies the pipeline; the job itself only declares the build parameters.
"""

from app.models.project import Pipeline, Project

JOBS_ROOT = "user-apps"

# GitHub's `language` for a repository -> the template that builds it.
LANGUAGE_PIPELINES = {
    "Python": Pipeline.python,
    "JavaScript": Pipeline.node,
    "TypeScript": Pipeline.node,
    "Go": Pipeline.go,
}


def pipeline_for_language(language: str | None) -> Pipeline:
    """Anything else (or no detected language) builds from the repo's Dockerfile."""
    return LANGUAGE_PIPELINES.get(language or "", Pipeline.dockerfile)


def job_name(project: Project) -> str:
    """e.g. user-apps/python/3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90

    The project's UUID is unique, survives renames, and is safe in URLs.
    """
    return f"{JOBS_ROOT}/{project.pipeline.value}/{project.id}"


# config.xml for a new job. Mirrors the hand-made py-test job: a JTE ad-hoc
# pipeline (the folder's template applies) with the three string parameters
# PipelineService passes. One build per project at a time.
JOB_CONFIG_XML = """<?xml version='1.1' encoding='UTF-8'?>
<flow-definition plugin="workflow-job">
  <description>Managed by DevFlow. Changes here are overwritten.</description>
  <keepDependencies>false</keepDependencies>
  <properties>
    <org.jenkinsci.plugins.workflow.job.properties.DisableConcurrentBuildsJobProperty/>
    <jenkins.model.BuildDiscarderProperty>
      <strategy class="hudson.tasks.LogRotator">
        <numToKeep>50</numToKeep><daysToKeep>-1</daysToKeep>
        <artifactDaysToKeep>-1</artifactDaysToKeep><artifactNumToKeep>-1</artifactNumToKeep>
      </strategy>
    </jenkins.model.BuildDiscarderProperty>
    <hudson.model.ParametersDefinitionProperty>
      <parameterDefinitions>
        <hudson.model.StringParameterDefinition><name>GIT_REPO_URL</name><trim>true</trim></hudson.model.StringParameterDefinition>
        <hudson.model.StringParameterDefinition><name>GIT_BRANCH</name><defaultValue>main</defaultValue><trim>true</trim></hudson.model.StringParameterDefinition>
        <hudson.model.StringParameterDefinition><name>GIT_CREDENTIALS_ID</name><trim>true</trim></hudson.model.StringParameterDefinition>
      </parameterDefinitions>
    </hudson.model.ParametersDefinitionProperty>
  </properties>
  <definition class="org.boozallen.plugins.jte.job.AdHocTemplateFlowDefinition" plugin="templating-engine">
    <configProvider class="org.boozallen.plugins.jte.job.ConsoleAdHocTemplateFlowDefinitionConfiguration">
      <pipelineConfig><providePipelineConfig>false</providePipelineConfig></pipelineConfig>
      <defaultTemplate><provideDefaultTemplate>false</provideDefaultTemplate></defaultTemplate>
    </configProvider>
  </definition>
  <triggers/>
  <disabled>false</disabled>
</flow-definition>
"""
