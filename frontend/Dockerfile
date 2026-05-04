###############################################
# Stage 1: Clone upstream repo, apply patches, build
###############################################
FROM node:20-alpine AS builder

RUN apk add --no-cache git

WORKDIR /app

# Clone the upstream Crew Editor repo
RUN git clone --depth 1 https://github.com/glenwrhodes/crew_editor.git .

# Apply our patches: overwrite/add specific files
COPY patches/vite.config.ts ./vite.config.ts
COPY patches/api.ts ./src/utils/api.ts
COPY patches/ExportModal.tsx ./src/components/modals/ExportModal.tsx

# Install dependencies and build
RUN npm ci
RUN npm run build

###############################################
# Stage 2: Serve the built static files
###############################################
FROM nginx:alpine

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy our nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built static files
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
