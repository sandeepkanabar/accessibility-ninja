FROM node:22-alpine
RUN apk add --no-cache unzip
WORKDIR /app
COPY app/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund
COPY app/ ./
ENV PORT=8080 NODE_USE_SYSTEM_CA=1
EXPOSE 8080
USER node
CMD ["node", "-r", "@opentelemetry/auto-instrumentations-node/register", "server.js"]
