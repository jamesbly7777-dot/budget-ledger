FROM node:22-slim

RUN npm install -g pnpm

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json tsconfig.base.json ./

# Copy all package.json files so pnpm can resolve the workspace
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/ledger-app/package.json ./artifacts/ledger-app/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/db/package.json ./lib/db/

# Install all workspace dependencies
RUN pnpm install --no-frozen-lockfile

# Copy all source files
COPY . .

# Build api-server (also builds ledger-app frontend internally)
RUN pnpm --filter @workspace/api-server run build

EXPOSE 8080

CMD ["node", "--enable-source-maps", "./artifacts/api-server/dist/index.mjs"]
