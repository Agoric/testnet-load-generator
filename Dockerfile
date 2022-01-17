# See here for image contents: https://github.com/microsoft/vscode-dev-containers/blob/v0.209.3/containers/typescript-node/.devcontainer/Dockerfile

# [Choice] Node.js version (use -bullseye variants on local arm64/Apple Silicon): 16, 14, 12, 16-bullseye, 14-bullseye, 12-bullseye, 16-buster, 14-buster, 12-buster
ARG VARIANT=16-bullseye
FROM mcr.microsoft.com/vscode/devcontainers/typescript-node:${VARIANT} as dev-env

# [Optional] Uncomment this section to install additional OS packages.
# RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
#     && apt-get -y install --no-install-recommends <your-package-list-here>

# [Optional] Uncomment if you want to install an additional version of node using nvm
# ARG EXTRA_NODE_VERSION=10
# RUN su node -c "source /usr/local/share/nvm/nvm.sh && nvm install ${EXTRA_NODE_VERSION}"

# [Optional] Uncomment if you want to install more global node packages
# RUN su node -c "npm install -g <your-package-list -here>"

##############################
# From https://github.com/docker-library/golang/blob/master/1.17/bullseye/Dockerfile

ENV PATH /usr/local/go/bin:$PATH

ENV GOLANG_VERSION 1.17.4

RUN set -eux; \
	arch="$(dpkg --print-architecture)"; arch="${arch##*-}"; \
	url=; \
	case "$arch" in \
		'amd64') \
			url='https://dl.google.com/go/go1.17.4.linux-amd64.tar.gz'; \
			sha256='adab2483f644e2f8a10ae93122f0018cef525ca48d0b8764dae87cb5f4fd4206'; \
			;; \
		'armel') \
			export GOARCH='arm' GOARM='5' GOOS='linux'; \
			;; \
		'armhf') \
			url='https://dl.google.com/go/go1.17.4.linux-armv6l.tar.gz'; \
			sha256='f34d25f818007345b716b316908115ba462f3f0dbd4343073020b544b4ae2320'; \
			;; \
		'arm64') \
			url='https://dl.google.com/go/go1.17.4.linux-arm64.tar.gz'; \
			sha256='617a46bd083e59877bb5680998571b3ddd4f6dcdaf9f8bf65ad4edc8f3eafb13'; \
			;; \
		'i386') \
			url='https://dl.google.com/go/go1.17.4.linux-386.tar.gz'; \
			sha256='276bda8e8efa59482b0be87394566e02ff7a860b65e8b6ccc90c026dbcab1f74'; \
			;; \
		'mips64el') \
			export GOARCH='mips64le' GOOS='linux'; \
			;; \
		'ppc64el') \
			url='https://dl.google.com/go/go1.17.4.linux-ppc64le.tar.gz'; \
			sha256='d185567480d9e335d4d9274804ef9fa796b01e53c7290a744871d0c0fac2f248'; \
			;; \
		's390x') \
			url='https://dl.google.com/go/go1.17.4.linux-s390x.tar.gz'; \
			sha256='63e4e2065aa3139b4d9a203fa7e39a810f67e9f4753492726d485c17c37cd817'; \
			;; \
		*) echo >&2 "error: unsupported architecture '$arch' (likely packaging update needed)"; exit 1 ;; \
	esac; \
	build=; \
	if [ -z "$url" ]; then \
# https://github.com/golang/go/issues/38536#issuecomment-616897960
		build=1; \
		url='https://dl.google.com/go/go1.17.4.src.tar.gz'; \
		sha256='4bef3699381ef09e075628504187416565d710660fec65b057edf1ceb187fc4b'; \
		echo >&2; \
		echo >&2 "warning: current architecture ($arch) does not have a compatible Go binary release; will be building from source"; \
		echo >&2; \
	fi; \
	\
	wget -O go.tgz.asc "$url.asc"; \
	wget -O go.tgz "$url" --progress=dot:giga; \
	echo "$sha256 *go.tgz" | sha256sum -c -; \
	\
# https://github.com/golang/go/issues/14739#issuecomment-324767697
	GNUPGHOME="$(mktemp -d)"; export GNUPGHOME; \
# https://www.google.com/linuxrepositories/
	gpg --batch --keyserver keyserver.ubuntu.com --recv-keys 'EB4C 1BFD 4F04 2F6D DDCC  EC91 7721 F63B D38B 4796'; \
# let's also fetch the specific subkey of that key explicitly that we expect "go.tgz.asc" to be signed by, just to make sure we definitely have it
	gpg --batch --keyserver keyserver.ubuntu.com --recv-keys '2F52 8D36 D67B 69ED F998  D857 78BD 6547 3CB3 BD13'; \
	gpg --batch --verify go.tgz.asc go.tgz; \
	gpgconf --kill all; \
	rm -rf "$GNUPGHOME" go.tgz.asc; \
	\
	tar -C /usr/local -xzf go.tgz; \
	rm go.tgz; \
	\
	if [ -n "$build" ]; then \
		savedAptMark="$(apt-mark showmanual)"; \
		apt-get update; \
		apt-get install -y --no-install-recommends golang-go; \
		\
		( \
			cd /usr/local/go/src; \
# set GOROOT_BOOTSTRAP + GOHOST* such that we can build Go successfully
			export GOROOT_BOOTSTRAP="$(go env GOROOT)" GOHOSTOS="$GOOS" GOHOSTARCH="$GOARCH"; \
			./make.bash; \
		); \
		\
		apt-mark auto '.*' > /dev/null; \
		apt-mark manual $savedAptMark > /dev/null; \
		apt-get purge -y --auto-remove -o APT::AutoRemove::RecommendsImportant=false; \
		rm -rf /var/lib/apt/lists/*; \
		\
# pre-compile the standard library, just like the official binary release tarballs do
		go install std; \
# go install: -race is only supported on linux/amd64, linux/ppc64le, linux/arm64, freebsd/amd64, netbsd/amd64, darwin/amd64 and windows/amd64
#		go install -race std; \
		\
# remove a few intermediate / bootstrapping files the official binary release tarballs do not contain
		rm -rf \
			/usr/local/go/pkg/*/cmd \
			/usr/local/go/pkg/bootstrap \
			/usr/local/go/pkg/obj \
			/usr/local/go/pkg/tool/*/api \
			/usr/local/go/pkg/tool/*/go_bootstrap \
			/usr/local/go/src/cmd/dist/dist \
		; \
	fi; \
	\
	go version

ENV GOPATH /go
ENV PATH $GOPATH/bin:$PATH
RUN mkdir -p "$GOPATH/src" "$GOPATH/bin" && chmod -R 777 "$GOPATH"
#WORKDIR $GOPATH

##############################
# From https://github.com/microsoft/vscode-dev-containers/blob/v0.209.3/containers/go/.devcontainer/base.Dockerfile

COPY library-scripts/go-debian.sh /tmp/library-scripts/

# Install Go tools
ENV GO111MODULE=auto
RUN bash /tmp/library-scripts/go-debian.sh "none" "/usr/local/go" "${GOPATH}" "node" "false" \
    && apt-get clean -y && rm -rf /var/lib/apt/lists/*

RUN rm -rf /tmp/library-scripts

# Add Tini
ENV TINI_VERSION v0.19.0
ADD https://github.com/krallin/tini/releases/download/${TINI_VERSION}/tini /tini
RUN chmod +x /tini

##############################
FROM dev-env

ARG USER_UID=1000
ARG USER_GID=$USER_UID

ENV IS_DOCKER=true
ENV SDK_SRC=/src
ENV OUTPUT_DIR=/out
ENV SDK_REVISION=
ENV SDK_REPO=
ENV SDK_BUILD=0
ENV NVM_RC_VERSION=

WORKDIR /app
COPY --chown=$USER_UID:$USER_GID . .

RUN mkdir -p $SDK_SRC $OUTPUT_DIR /home/node/.cache/yarn /go/pkg/mod && \
	chown -R $USER_UID:$USER_GID $SDK_SRC $OUTPUT_DIR /home/node/.cache /go && \
	chown $USER_UID:$USER_GID /app

USER $USER_UID

ENTRYPOINT ["/tini", "--", "/app/start.sh", "--no-reset", "--test-data.docker"]