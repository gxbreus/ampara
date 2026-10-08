# Etapa de build: compila um binário estático (sem cgo), que roda numa imagem sem libc.
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/adocao ./cmd/adocao

# Imagem final: só o binário, sobre a distroless static, sem shell e sem usuário root.
# As migrations vão embutidas no binário (go:embed).
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/adocao /adocao
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/adocao"]
