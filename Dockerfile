FROM node:26-alpine AS builder

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package.json package-lock.json* ./

# Install all dependencies (including devDependencies) for build
RUN npm ci

# Copy application files
COPY src/ ./src/
COPY public/ ./public/
COPY config/ ./config/
COPY user-assets/ ./user-assets/
COPY tsconfig.json .

# Build the project (esbuild bundles the TypeScript server)
RUN npm run build

# Stage 2: Production dependencies only
FROM node:26-alpine AS deps

WORKDIR /usr/src/app

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev --ignore-scripts

# Stage 3: Root production image (distroless)
FROM gcr.io/distroless/nodejs26-debian13:latest AS production-root

WORKDIR /usr/src/app

# Set Node environment to production
ENV NODE_ENV=production

# Production dependencies from the deps stage
COPY --from=deps /usr/src/app/node_modules ./node_modules
# The build output from the builder stage
COPY --from=builder /usr/src/app/dist ./dist
# The public static files (copied during build stage, already includes minified assets)
COPY --from=builder /usr/src/app/public ./public
# user-assets (may contain custom overrides at runtime)
COPY --from=builder /usr/src/app/user-assets ./user-assets
# Note: config/ is mounted via volume at runtime, not baked into the image

# Expose port 3000
EXPOSE 3000

# Set image metadata labels
LABEL org.opencontainers.image.title="sneaks-community-website"
LABEL org.opencontainers.image.description="Sneak's Community Website"
LABEL org.opencontainers.image.source="https://github.com/Sneaks-Community/sneaks-community-website"

# Health check: query the /health endpoint to verify the application is ready.
# Distroless has no wget/shell, so use node's built-in fetch (no dependencies).
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# node is the ENTRYPOINT in the distroless image; pass the bundle as its argument
CMD ["dist/index.js"]

# Stage 4: Non-root production image (default)
# Identical to the root image but runs as the built-in "nonroot" user
# (uid 65532). This is the recommended default; see docker-compose.yml.
FROM production-root AS production

USER nonroot
