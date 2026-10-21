FROM node:24-bookworm-slim AS frontend
WORKDIR /app
COPY Jeopardy/package.json Jeopardy/package-lock.json ./Jeopardy/
RUN npm ci --prefix Jeopardy
COPY Jeopardy/ ./Jeopardy/
RUN npm --prefix Jeopardy run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3001 HOST=0.0.0.0 JEOPARDY_DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY Jeopardy/server/ ./Jeopardy/server/
COPY Jeopardy/package.json ./Jeopardy/package.json
COPY --from=frontend /app/Jeopardy/dist/ ./Jeopardy/dist/
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "Jeopardy/server/index.js"]
