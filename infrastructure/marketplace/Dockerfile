FROM node:22-alpine
WORKDIR /app
RUN npm install fastify @fastify/cors pg
COPY server.js .
EXPOSE 3020
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3020/health || exit 1
CMD ["node", "server.js"]
