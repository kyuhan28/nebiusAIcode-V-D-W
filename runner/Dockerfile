# The runner service: the trusted job manager. It never executes user code itself; it starts a
# fresh container from the sandbox image (sandbox.Dockerfile) for every job, which is why it
# needs the Docker CLI and access to the Docker daemon.
FROM eclipse-temurin:21.0.4_7-jdk-jammy AS build
WORKDIR /build
COPY src ./src
RUN javac -d classes $(find src -name '*.java')

FROM eclipse-temurin:21.0.4_7-jdk-jammy
COPY --from=docker:27.3.1-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=build /build/classes /opt/runner/classes
COPY bin /opt/runner/bin
ENV RUNNER_HOST=0.0.0.0 RUNNER_PORT=8787 RUNNER_HOME=/opt/runner
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD ["java", "-cp", "/opt/runner/classes", "-version"]
CMD ["java", "-Xmx512m", "-XX:+UseSerialGC", "-cp", "/opt/runner/classes", "codeviz.runner.Server"]
