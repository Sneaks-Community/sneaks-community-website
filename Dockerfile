FROM node:26-alpine AS builder

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package.json package-lock.json* ./

# Install all dependencies (including devDependencies) for build
RUN npm install

# Copy application files
COPY src/ ./src/
COPY public/ ./public/
COPY config/ ./config/
COPY user-assets/ ./user-assets/
COPY tsconfig.json .
COPY eslint.config.mjs .
COPY .nvmrc .

# Build the project (esbuild bundles the TypeScript server)
RUN npm run build

# Stage 2: Production environment
FROM node:26-alpine AS production

WORKDIR /usr/src/app

# Only copy the essential package files
COPY package.json package-lock.json* ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy the build output from the builder stage
COPY --from=builder /usr/src/app/dist ./dist
# Copy the public static files (copied during build stage, already includes minified assets)
COPY --from=builder /usr/src/app/public ./public
# Copy user-assets (may contain custom overrides at runtime)
COPY --from=builder /usr/src/app/user-assets ./user-assets
# Note: config/ is mounted via volume at runtime, not baked into the image

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodejs

# Switch to non-root user
USER nodejs

# Expose port 3000
EXPOSE 3000

# Set image metadata labels
LABEL org.opencontainers.image.title="sneaks-community-website"
LABEL org.opencontainers.image.description="Sneak's Community Website"
LABEL org.opencontainers.image.source="https://github.com/Sneaks-Community/sneaks-community-website"
LABEL org.opencontainers.image.version="0.2.0"

# Set Node environment to production
ENV NODE_ENV=production

# Health check: query the /health endpoint to verify the application is ready
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --spider --no-verbose http://127.0.0.1:3000/health || exit 1

# Start the server
CMD ["node", "dist/index.js"]
