FROM node:22-slim AS nodebin

FROM jenkins/jenkins:lts-jdk21

USER root
COPY --from=nodebin /usr/local/bin/node /usr/local/bin/node
COPY --from=nodebin /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && \
    ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

USER jenkins
RUN jenkins-plugin-cli --plugins \
    workflow-aggregator:latest \
    cloudbees-folder:latest \
    git:latest \
    matrix-auth:latest \
    credentials-binding:latest

COPY --chown=jenkins:jenkins init.groovy.d/01-setup.groovy /usr/share/jenkins/ref/init.groovy.d/01-setup.groovy

ENV JAVA_OPTS="-Djenkins.install.runSetupWizard=false"
