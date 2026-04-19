FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
RUN npm i -g serve
COPY --from=build /app/dist ./dist
ENV PORT=8080
CMD ["sh", "-c", "serve -s dist -l $PORT"]
