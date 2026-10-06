# Smokescreen publishes no releases or images; build a pinned commit.
FROM golang:1.26-bookworm AS build
ARG SMOKESCREEN_COMMIT=d533c7aa3eb3ffd2a3fe275dc3bb01dcd2dfa4ea
WORKDIR /src
RUN git init -q . \
    && git remote add origin https://github.com/stripe/smokescreen.git \
    && git fetch -q --depth 1 origin "${SMOKESCREEN_COMMIT}" \
    && git checkout -q FETCH_HEAD \
    && CGO_ENABLED=0 go build -mod=vendor -trimpath -ldflags='-s -w' -o /out/smokescreen .

FROM gcr.io/distroless/static-debian12:nonroot
LABEL org.opencontainers.image.title="Pulpo workspace egress proxy" \
      org.opencontainers.image.description="Smokescreen HTTP(S) proxy for Pulpo agent workspaces"
COPY --from=build /out/smokescreen /usr/local/bin/smokescreen
USER nonroot
EXPOSE 4750
ENTRYPOINT ["/usr/local/bin/smokescreen"]
CMD ["--config-file=/etc/smokescreen/config.yaml"]
