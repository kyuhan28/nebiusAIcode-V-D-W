# The image every user program runs in, one short-lived container per compile, run, trace, or
# test. It holds a pinned JDK, the runner's compile and trace helpers, and a non-root user.
# No user code is baked in; each job's files are mounted at /work for that job only.
#
#   docker build -t codeviz-java-sandbox:21 -f runner/sandbox.Dockerfile runner
#
# For production, pin by digest:
#   docker inspect --format '{{index .RepoDigests 0}}' eclipse-temurin:21.0.4_7-jdk-jammy
FROM eclipse-temurin:21-jdk-noble AS build
WORKDIR /build
COPY src ./src
RUN javac -d classes $(find src -name '*.java')

FROM eclipse-temurin:21-jdk-noble
# Python 3.12 (Ubuntu 24.04's python3) runs .py programs in the same container and limits as Java.
# Third-party packages go into a virtual environment at build time, from the pinned
# python-requirements.txt: programs never install anything, and nothing is downloaded at run time.
# Build with --build-arg PY_REQUIREMENTS=<file> to use a smaller or larger package set.
ARG PY_REQUIREMENTS=python-requirements.txt
# gcc and g++ 13 (Ubuntu 24.04) build C and C++ programs inside the container, with the sanitizer
# runtimes (AddressSanitizer, LeakSanitizer, UndefinedBehaviorSanitizer) every C/C++ run uses.
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv gcc g++ libc6-dev && rm -rf /var/lib/apt/lists/*
COPY ${PY_REQUIREMENTS} /opt/codeviz/python-requirements.txt
RUN python3 -m venv /opt/codeviz/pyenv \
 && /opt/codeviz/pyenv/bin/pip install --no-cache-dir -r /opt/codeviz/python-requirements.txt \
 && /opt/codeviz/pyenv/bin/pip freeze > /opt/codeviz/python-installed.txt \
 && (MPLCONFIGDIR=/opt/codeviz/mpl-cache MPLBACKEND=Agg /opt/codeviz/pyenv/bin/python -c "import matplotlib.pyplot" || true) \
 && chmod -R a+rX /opt/codeviz
ENV PATH=/opt/codeviz/pyenv/bin:$PATH
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin sandbox
COPY --from=build /build/classes /opt/codeviz/classes
USER 10001:10001
WORKDIR /work
