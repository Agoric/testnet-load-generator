# See here for image contents: https://github.com/microsoft/vscode-dev-containers/blob/v0.222.0/containers/typescript-node/.devcontainer/Dockerfile

# [Choice] Node.js version (use -bullseye variants on local arm64/Apple Silicon): 16, 14, 12, 16-bullseye, 14-bullseye, 12-bullseye, 16-buster, 14-buster, 12-buster
ARG VARIANT=18-bullseye
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
# From https://github.com/docker-library/golang/blob/master/1.19/bullseye/Dockerfile

ENV PATH /usr/local/go/bin:$PATH

ENV GOLANG_VERSION 1.20.5

RUN set -eux; \
	arch="$(dpkg --print-architecture)"; arch="${arch##*-}"; \
	url=; \
	case "$arch" in \
		'amd64') \
			url='https://dl.google.com/go/go1.20.5.linux-amd64.tar.gz'; \
			sha256='d7ec48cde0d3d2be2c69203bc3e0a44de8660b9c09a6e85c4732a3f7dc442612'; \
			;; \
		'armel') \
			export GOARCH='arm' GOARM='5' GOOS='linux'; \
			;; \
		'armhf') \
			url='https://dl.google.com/go/go1.20.5.linux-armv6l.tar.gz'; \
			sha256='79d8210efd4390569912274a98dffc16eb85993cccdeef4d704e9b0dfd50743a'; \
			;; \
		'arm64') \
			url='https://dl.google.com/go/go1.20.5.linux-arm64.tar.gz'; \
			sha256='aa2fab0a7da20213ff975fa7876a66d47b48351558d98851b87d1cfef4360d09'; \
			;; \
		'i386') \
			url='https://dl.google.com/go/go1.20.5.linux-386.tar.gz'; \
			sha256='d394ac8fecf66812c78ffba7fb9a265bb1b9917564c7fd77f0edb0df6d5777a1'; \
			;; \
		'mips64el') \
			export GOARCH='mips64le' GOOS='linux'; \
			;; \
		'ppc64el') \
			url='https://dl.google.com/go/go1.20.5.linux-ppc64le.tar.gz'; \
			sha256='049b8ab07d34077b90c0642138e10207f6db14bdd1743ea994a21e228f8ca53d'; \
			;; \
		's390x') \
			url='https://dl.google.com/go/go1.20.5.linux-s390x.tar.gz'; \
			sha256='bac14667f1217ccce1d2ef4e204687fe6191e6dc19a8870cfb81a41f78b04e48'; \
			;; \
		*) echo >&2 "error: unsupported architecture '$arch' (likely packaging update needed)"; exit 1 ;; \
	esac; \
	build=; \
	if [ -z "$url" ]; then \
# https://github.com/golang/go/issues/38536#issuecomment-616897960
		build=1; \
		url='https://dl.google.com/go/go1.20.5.src.tar.gz'; \
		sha256='9a15c133ba2cfafe79652f4815b62e7cfc267f68df1b9454c6ab2a3ca8b96a88'; \
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
# add backports for newer go version for bootstrap build: https://github.com/golang/go/issues/44505
		( \
			. /etc/os-release; \
			echo "deb https://deb.debian.org/debian $VERSION_CODENAME-backports main" > /etc/apt/sources.list.d/backports.list; \
			\
			apt-get update; \
			apt-get install -y --no-install-recommends -t "$VERSION_CODENAME-backports" golang-go; \
		); \
		\
		export GOCACHE='/tmp/gocache'; \
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
# remove a few intermediate / bootstrapping files the official binary release tarballs do not contain
		rm -rf \
			/usr/local/go/pkg/*/cmd \
			/usr/local/go/pkg/bootstrap \
			/usr/local/go/pkg/obj \
			/usr/local/go/pkg/tool/*/api \
			/usr/local/go/pkg/tool/*/go_bootstrap \
			/usr/local/go/src/cmd/dist/dist \
			"$GOCACHE" \
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

# Install Terraform and Ansible to speed up agoric-sdk deployment tests
COPY library-scripts/install-terraform-ansible.sh /tmp/library-scripts/
RUN bash /tmp/library-scripts/install-terraform-ansible.sh

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