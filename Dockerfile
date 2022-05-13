# See here for image contents: https://github.com/microsoft/vscode-dev-containers/blob/v0.222.0/containers/typescript-node/.devcontainer/Dockerfile

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

ENV GOLANG_VERSION 1.17.7

RUN set -eux; \
	arch="$(dpkg --print-architecture)"; arch="${arch##*-}"; \
	url=; \
	case "$arch" in \
		'amd64') \
			url='https://dl.google.com/go/go1.17.7.linux-amd64.tar.gz'; \
			sha256='02b111284bedbfa35a7e5b74a06082d18632eff824fd144312f6063943d49259'; \
			;; \
		'armel') \
			export GOARCH='arm' GOARM='5' GOOS='linux'; \
			;; \
		'armhf') \
			url='https://dl.google.com/go/go1.17.7.linux-armv6l.tar.gz'; \
			sha256='874774f078b182fa21ffcb3878467eb5cb7e78bbffa6343ea5f0fbe47983433b'; \
			;; \
		'arm64') \
			url='https://dl.google.com/go/go1.17.7.linux-arm64.tar.gz'; \
			sha256='a5aa1ed17d45ee1d58b4a4099b12f8942acbd1dd09b2e9a6abb1c4898043c5f5'; \
			;; \
		'i386') \
			url='https://dl.google.com/go/go1.17.7.linux-386.tar.gz'; \
			sha256='5d5472672a2e0252fe31f4ec30583d9f2b320f9b9296eda430f03cbc848400ce'; \
			;; \
		'mips64el') \
			export GOARCH='mips64le' GOOS='linux'; \
			;; \
		'ppc64el') \
			url='https://dl.google.com/go/go1.17.7.linux-ppc64le.tar.gz'; \
			sha256='2262fdee9147eb61fd1e719cfd19b9c035009c14890de02b5a77071b0a577405'; \
			;; \
		's390x') \
			url='https://dl.google.com/go/go1.17.7.linux-s390x.tar.gz'; \
			sha256='24dd117581d592f52b4cf45d75ae68a6a1e42691a8671a2d3c2ddd739894a1e4'; \
			;; \
		*) echo >&2 "error: unsupported architecture '$arch' (likely packaging update needed)"; exit 1 ;; \
	esac; \
	build=; \
	if [ -z "$url" ]; then \
# https://github.com/golang/go/issues/38536#issuecomment-616897960
		build=1; \
		url='https://dl.google.com/go/go1.17.7.src.tar.gz'; \
		sha256='c108cd33b73b1911a02b697741df3dea43e01a5c4e08e409e8b3a0e3745d2b4d'; \
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
# From https://github.com/microsoft/vscode-dev-containers/blob/v0.222.0/containers/go/.devcontainer/base.Dockerfile

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

COPY --from=rr /rr-5.5.0-* /tmp/

RUN set -eux; \
		cd /tmp; \
		rr_target="rr-5.5.0-Linux-$(uname -m).deb"; \
		[ -f "${rr_target}" ] || wget "https://github.com/rr-debugger/rr/releases/download/5.5.0/${rr_target}"; \
		sudo dpkg -i "${rr_target}";

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