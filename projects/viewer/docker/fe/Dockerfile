# ==============================================================================
# 🐳 Module: Dockerfile (viewer-fe)
# Description: Development Vite Dev Server container for viewer frontend with HMR
# Last Updated: 2026-06-16
# ==============================================================================

FROM node:22-bookworm

WORKDIR /app

# Install frontend dependencies
COPY src/frontend/package*.json ./
RUN npm install && npm cache clean --force

# Copy frontend source code
COPY src/frontend .

# Expose Vite development port
EXPOSE 5173

# Run Vite dev server bound to all interfaces
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
