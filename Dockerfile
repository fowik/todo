FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    RTU_HEADLESS=true \
    RTU_PROFILE_DIR=/data/rtu-sessions \
    MAX_RTU_JOBS=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npx playwright install --with-deps chromium \
    && mkdir -p /data/rtu-sessions && chown -R node:node /data /app
COPY --chown=node:node index.html app.js style.css config.js server.js hosting-auth.js ./
USER node
EXPOSE 8000
CMD ["node", "server.js"]
