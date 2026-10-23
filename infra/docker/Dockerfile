FROM oven/bun:1.4.4 AS build
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

COPY . .
ARG COMMIT_SHA=unknown
ENV COMMIT_SHA=$COMMIT_SHA
RUN bun run build

FROM oven/bun:1.4.4 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=build --chown=bun:bun /app/package.json ./package.json

COPY --from=build --chown=bun:bun /app/public ./public
COPY --from=build --chown=bun:bun /app/.next/standalone ./
COPY --from=build --chown=bun:bun /app/.next/static ./.next/static
COPY --from=build --chown=bun:bun /app/package.json ./package.json
COPY --from=build --chown=bun:bun /app/scripts ./scripts
COPY --from=build --chown=bun:bun /app/src/lib/site-url.ts ./src/lib/site-url.ts
COPY --from=build --chown=bun:bun /app/src/lib/db/migrations ./src/lib/db/migrations

ARG COMMIT_SHA=unknown
ENV COMMIT_SHA=$COMMIT_SHA

USER bun

EXPOSE 3000

CMD ["bun", "server.js"]
