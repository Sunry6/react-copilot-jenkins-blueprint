import jenkins.model.*
import hudson.security.*
import hudson.model.*
import jenkins.security.ApiTokenProperty
import com.cloudbees.hudson.plugins.folder.Folder
import org.jenkinsci.plugins.workflow.job.WorkflowJob
import org.jenkinsci.plugins.workflow.cps.CpsFlowDefinition

// Local-only demo sandbox credentials — NEVER use outside localhost!
def instance = Jenkins.getInstance()
def hudsonRealm = new HudsonPrivateSecurityRealm(false)
def adminUser = hudsonRealm.getUser("devops-admin") ?: hudsonRealm.createAccount("devops-admin", "LocalDemoAdmin!")
def devBot = hudsonRealm.getUser("dev-bot") ?: hudsonRealm.createAccount("dev-bot", "LocalDemoBot!")
instance.setSecurityRealm(hudsonRealm)

def strategy = new GlobalMatrixAuthorizationStrategy()
strategy.add(Jenkins.ADMINISTER, "devops-admin")
strategy.add(Jenkins.READ, "dev-bot")
strategy.add(Item.READ, "dev-bot")
strategy.add(Item.DISCOVER, "dev-bot")
strategy.add(Item.BUILD, "dev-bot")
strategy.add(Item.WORKSPACE, "dev-bot")
instance.setAuthorizationStrategy(strategy)

def tokenFile = new File("/var/jenkins_home/dev-bot-token.txt")
if (!tokenFile.exists() || tokenFile.text.trim().isEmpty()) {
    def res = devBot.getProperty(ApiTokenProperty.class).tokenStore.generateNewToken("local-sandbox")
    devBot.save()
    tokenFile.text = res.plainValue + "\n"
}

def getOrCreateFolder = { String name, String desc ->
    def f = instance.getItem(name) ?: instance.createProject(Folder.class, name)
    f.setDescription(desc)
    f.save()
    return f
}

def devFolder = getOrCreateFolder("dev", "Simulated DevOps CI & Release folder")
def uatFolder = getOrCreateFolder("uat", "Simulated DevOps UAT CD folder")
def envChoices = ["env1", "env2", "env3", "env4", "env5", "sim"] as String[]

def createJob = { Folder folder, String name, List<ParameterDefinition> params, String script ->
    def job = folder.getItem(name) ?: folder.createProject(WorkflowJob.class, name)
    job.removeProperty(ParametersDefinitionProperty.class)
    job.addProperty(new ParametersDefinitionProperty(params))
    job.setDefinition(new CpsFlowDefinition(script, true))
    job.save()
}

createJob(devFolder, "react-demo-ci", [
    new StringParameterDefinition("BRANCH", "develop-202701", "Release branch"),
    new StringParameterDefinition("GIT_COMMIT", "", "Commit SHA"),
    new ChoiceParameterDefinition("ENV", envChoices, "Target env"),
    new StringParameterDefinition("SIMULATE_DELAY_SEC", "2", "Simulated build time"),
    new StringParameterDefinition("SIMULATE_FAIL", "false", "Set true to test alerting")
], '''
pipeline {
  agent any
  stages {
    stage('Build') {
      steps {
        sh \'\'\'
          set -e
          if [ "${SIMULATE_FAIL}" = "true" ]; then
            echo "Simulated CI error in src/utils/pricing.ts" >&2
            exit 1
          fi
          sleep "${SIMULATE_DELAY_SEC:-2}"
          SHORT_SHA=$(echo "${GIT_COMMIT:-localdev}" | cut -c1-8)
          ARTIFACT_VER="${BRANCH}-ci.${BUILD_NUMBER}-${SHORT_SHA}"
          mkdir -p /var/jenkins_home/artifacts/ci
          echo "{\\"artifactVersion\\":\\"${ARTIFACT_VER}\\"}" > "/var/jenkins_home/artifacts/ci/${ARTIFACT_VER}.json"
          echo "ARTIFACT_VERSION=${ARTIFACT_VER}"
        \'\'\'
      }
    }
  }
}
'''.stripIndent())

createJob(devFolder, "react-demo-release", [
    new StringParameterDefinition("BRANCH", "develop-202701", "Release branch"),
    new StringParameterDefinition("GIT_COMMIT", "", "Commit SHA"),
    new ChoiceParameterDefinition("ENV", envChoices, "Target env"),
    new StringParameterDefinition("ARTIFACT_VERSION", "", "Artifact version from CI"),
    new StringParameterDefinition("SIMULATE_DELAY_SEC", "2", "Simulated release time")
], '''
pipeline {
  agent any
  stages {
    stage('Release') {
      steps {
        sh \'\'\'
          set -e
          test -f "/var/jenkins_home/artifacts/ci/${ARTIFACT_VERSION}.json"
          sleep "${SIMULATE_DELAY_SEC:-2}"
          REL_MONTH=$(echo "${BRANCH}" | sed -E 's/^develop-//')
          RELEASE_VER="rel-${REL_MONTH}.${BUILD_NUMBER}"
          mkdir -p /var/jenkins_home/artifacts/releases
          echo "{\\"releaseVersion\\":\\"${RELEASE_VER}\\",\\"artifactVersion\\":\\"${ARTIFACT_VERSION}\\"}" > "/var/jenkins_home/artifacts/releases/${RELEASE_VER}.json"
          echo "RELEASE_VERSION=${RELEASE_VER}"
        \'\'\'
      }
    }
  }
}
'''.stripIndent())

createJob(uatFolder, "react-demo-cd", [
    new ChoiceParameterDefinition("ENV", envChoices, "Target UAT env"),
    new StringParameterDefinition("RELEASE_VERSION", "", "Release version"),
    new StringParameterDefinition("BRANCH", "develop-202701", "Source branch"),
    new StringParameterDefinition("GIT_COMMIT", "", "Commit SHA"),
    new StringParameterDefinition("SIMULATE_DELAY_SEC", "2", "Simulated deploy time")
], '''
pipeline {
  agent any
  stages {
    stage('Deploy') {
      steps {
        sh \'\'\'
          set -e
          sleep "${SIMULATE_DELAY_SEC:-2}"
          mkdir -p "/var/jenkins_home/deployments/uat/${ENV}"
          echo "{\\"env\\":\\"${ENV}\\",\\"branch\\":\\"${BRANCH}\\",\\"releaseVersion\\":\\"${RELEASE_VERSION}\\",\\"commit\\":\\"${GIT_COMMIT}\\"}" > "/var/jenkins_home/deployments/uat/${ENV}/release.json"
          echo "DEPLOY_URL=https://${ENV}.uat.example.internal/"
        \'\'\'
      }
    }
  }
}
'''.stripIndent())

instance.save()
