FROM node:24-alpine
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/alvince.sqlite UPLOAD_DIR=/data/uploads COOKIE_SECURE=true
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY scripts ./scripts
COPY public ./public
RUN mkdir -p /data/uploads && chown -R node:node /app /data
USER node
EXPOSE 3000
CMD ["node", "server/index.js"]
