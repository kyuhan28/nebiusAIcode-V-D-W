# The image every user program runs in, one short-lived container per compile, run, trace, or
# test. It holds a pinned JDK, the runner's compile and trace helpers, and a non-root user.
# No user code is baked in; each job's files are mounted at /work for that job only.
#
#   docker build -t codeviz-java-sandbox:21 -f runner/sandbox.Dockerfile runner
#
# For production, pin by digest:
#   docker inspect --format '{{index .RepoDigests 0}}' eclipse-temurin:21.0.4_7-jdk-jammy
FROM eclipse-temurin:21.0.4_7-jdk-jammy AS build
WORKDIR /build
COPY src ./src
RUN javac -d classes $(find src -name '*.java')

FROM eclipse-temurin:21.0.4_7-jdk-jammy
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin sandbox
COPY --from=build /build/classes /opt/codeviz/classes
USER 10001:10001
WORKDIR /work
