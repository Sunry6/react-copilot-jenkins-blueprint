// Optional Jenkinsfile `post` callback snippet for Zero-Polling Event-Driven mode.
// Add this block into `dev/ci`, `dev/release`, and `uat/cd` Jenkinsfiles when editable,
// setting `CALLBACK_EVENT` to:
//   - "jenkins-ci-finished"      (in dev/ci)
//   - "jenkins-release-finished" (in dev/release)
//   - "jenkins-cd-finished"      (in uat/cd)
//
// Requires a Jenkins secret text credential `ghes-cicd-dispatch-token`
// with minimal `contents: write` scope on the CICD repository only.

post {
    always {
        withCredentials([string(credentialsId: 'ghes-cicd-dispatch-token', variable: 'GHES_TOKEN')]) {
            sh '''
                set +e
                curl -fsSL -X POST \
                  -H "Accept: application/vnd.github+json" \
                  -H "Authorization: Bearer ${GHES_TOKEN}" \
                  "https://github.example.internal/api/v3/repos/my-org/frontend-cicd/dispatches" \
                  -d "{
                    \\"event_type\\": \\"${CALLBACK_EVENT}\\",
                    \\"client_payload\\": {
                      \\"status\\": \\"${currentBuild.currentResult}\\",
                      \\"branch\\": \\"${BRANCH}\\",
                      \\"env\\": \\"${ENV}\\",
                      \\"commit_sha\\": \\"${GIT_COMMIT}\\",
                      \\"artifact_version\\": \\"${ARTIFACT_VERSION}\\",
                      \\"release_version\\": \\"${RELEASE_VERSION}\\",
                      \\"pr_number\\": \\"${PR_NUMBER}\\",
                      \\"build_url\\": \\"${BUILD_URL}\\"
                    }
                  }"
            '''
        }
    }
}
