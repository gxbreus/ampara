# deps: instala todas as dependências, inclusive as de desenvolvimento (typescript, tsx).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# build: compila o TypeScript para dist/.
FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# runtime: só as dependências de produção e o JavaScript compilado, como usuário node.
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3010
CMD ["node", "dist/server.js"]
