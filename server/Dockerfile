FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node server/src ./server/src
RUN mkdir -p /app/server/data && chown node:node /app/server/data
USER node
ENV HOST=0.0.0.0 PORT=8787
EXPOSE 8787
CMD ["node", "server/src/index.mjs"]
